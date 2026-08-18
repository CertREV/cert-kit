import { generateKeyPairSync, sign as nodeSign } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeMockPayload, makeSignedEnvelope } from '../contract/fixtures.js'
import type {
	CertDeliveryEnvelope,
	CertTombstone,
	CertTombstoneSignable,
	CertVerdict,
	Ed25519PublicKeyInput,
	ResolvePublicKeyByKid,
} from '../contract/kernel.js'
import { base64urlEncode, canonicalTombstoneBytes, verifyEnvelope } from '../contract/kernel.js'
import { TtlCache } from '../verify/cache.js'
import { DEFAULT_FETCH_TIMEOUT_MS } from '../verify/fetch-with-deadline.js'
import { getVerifiedEnvelope, invalidateVerdict } from '../verify/get-verified-envelope.js'
import { fetchingKidResolver, staticKidResolver } from '../verify/resolve-kid.js'

const RENDER_CTX = { platform: 'shopify', externalId: 'gid://shopify/Article/123456789' }

describe('kernel via the SDK binding (real Ed25519 over JCS)', () => {
	it('a freshly signed fixture envelope verifies + renders, carrying the payload', async () => {
		const { envelope, resolveKid } = makeSignedEnvelope()
		const verdict = await verifyEnvelope(envelope, resolveKid, { ...RENDER_CTX, now: new Date('2026-06-22T00:00:00Z') })
		expect(verdict.decision).toBe('render')
		if (verdict.decision === 'render') expect(verdict.payload.certId).toBe('cert_fixture_001')
	})

	it('a tampered payload fails the signature (fail-closed suppress)', async () => {
		const { envelope, resolveKid } = makeSignedEnvelope()
		const tampered: CertDeliveryEnvelope = { ...envelope, payload: { ...envelope.payload, certId: 'cert_FORGED' } }
		expect(await verifyEnvelope(tampered, resolveKid, RENDER_CTX)).toEqual({
			decision: 'suppress',
			reason: 'invalid_signature',
		})
	})

	it('an unknown kid suppresses unknown_key', async () => {
		const { envelope } = makeSignedEnvelope()
		const verdict = await verifyEnvelope(envelope, () => null, RENDER_CTX)
		expect(verdict).toEqual({ decision: 'suppress', reason: 'unknown_key' })
	})

	it('platform mismatch suppresses', async () => {
		const { envelope, resolveKid } = makeSignedEnvelope()
		expect(await verifyEnvelope(envelope, resolveKid, { ...RENDER_CTX, platform: 'wordpress' })).toEqual({
			decision: 'suppress',
			reason: 'platform_mismatch',
		})
	})

	it('revoked suppresses', async () => {
		const { envelope, resolveKid } = makeSignedEnvelope({
			lifecycle: {
				issuedAt: '2026-06-21T00:00:00Z',
				expiresAt: '2099-01-01T00:00:00Z',
				revokedAt: '2026-06-21T12:00:00Z',
				revision: 2,
			},
		})
		expect((await verifyEnvelope(envelope, resolveKid, RENDER_CTX)).decision).toBe('suppress')
	})

	it('expired suppresses', async () => {
		const { envelope, resolveKid } = makeSignedEnvelope({
			lifecycle: { issuedAt: '2026-01-01T00:00:00Z', expiresAt: '2026-02-01T00:00:00Z', revokedAt: null, revision: 1 },
		})
		const verdict = await verifyEnvelope(envelope, resolveKid, { ...RENDER_CTX, now: new Date('2026-03-01T00:00:00Z') })
		expect(verdict).toEqual({ decision: 'suppress', reason: 'expired' })
	})

	it('content drift (live hash != subject.contentDigest) suppresses', async () => {
		const { envelope, resolveKid } = makeSignedEnvelope()
		const verdict = await verifyEnvelope(envelope, resolveKid, { ...RENDER_CTX, liveContentHash: 'b'.repeat(64) })
		expect(verdict).toEqual({ decision: 'suppress', reason: 'content_drift' })
	})

	it('matching live hash renders', async () => {
		const digest = 'c'.repeat(64)
		const { envelope, resolveKid } = makeSignedEnvelope({
			subject: { ...makeSignedEnvelope().envelope.payload.subject, contentDigest: digest },
		})
		const verdict = await verifyEnvelope(envelope, resolveKid, { ...RENDER_CTX, liveContentHash: digest })
		expect(verdict.decision).toBe('render')
	})
})

describe('getVerifiedEnvelope — metafield source', () => {
	it('verifies an envelope read from a metafield (object form)', async () => {
		const { envelope, resolveKid } = makeSignedEnvelope()
		const verdict = await getVerifiedEnvelope({
			source: { kind: 'metafield', value: envelope },
			resolveKid,
			context: { ...RENDER_CTX, now: new Date('2026-06-22T00:00:00Z') },
			cache: new TtlCache(),
		})
		expect(verdict.decision).toBe('render')
	})

	it('verifies an envelope read from a metafield (JSON-string form)', async () => {
		const { envelope, resolveKid } = makeSignedEnvelope()
		const verdict = await getVerifiedEnvelope({
			source: { kind: 'metafield', value: JSON.stringify(envelope) },
			resolveKid,
			context: { ...RENDER_CTX, now: new Date('2026-06-22T00:00:00Z') },
			cache: new TtlCache(),
		})
		expect(verdict.decision).toBe('render')
	})

	it('a missing metafield value fails closed to subject_mismatch (nothing is certified here)', async () => {
		const { resolveKid } = makeSignedEnvelope()
		const verdict = await getVerifiedEnvelope({
			source: { kind: 'metafield', value: null },
			resolveKid,
			context: RENDER_CTX,
			cache: new TtlCache(),
		})
		// An ABSENT envelope is not a version problem: the reason must point the consumer at
		// the subject they asked for (wrong externalId / never certified), not at a payload
		// that was never fetched.
		expect(verdict).toEqual({ decision: 'suppress', reason: 'subject_mismatch' })
	})

	it('malformed JSON in a metafield fails closed to unsupported_contract_version (no throw)', async () => {
		const { resolveKid } = makeSignedEnvelope()
		const verdict = await getVerifiedEnvelope({
			source: { kind: 'metafield', value: '{not json' },
			resolveKid,
			context: RENDER_CTX,
			cache: new TtlCache(),
		})
		// Here the reason IS true — a value was present and could not be parsed.
		expect(verdict).toEqual({ decision: 'suppress', reason: 'unsupported_contract_version' })
	})

	it('DISTINCT metafield envelopes at one placement do NOT collide on a shared cache (value-keyed)', async () => {
		// Regression: the metafield cache key must include a hash of the envelope value, else
		// the first verdict (render) is served for a later, DIFFERENT envelope — a fail-closed
		// violation (an unverified/tampered credential rendered). Here a valid + a tampered
		// envelope share the SAME resolver, context, and cache; each must get its own verdict.
		const { envelope, resolveKid } = makeSignedEnvelope()
		const tampered: CertDeliveryEnvelope = {
			...envelope,
			payload: {
				...envelope.payload,
				content: {
					...envelope.payload.content,
					expert: { ...envelope.payload.content.expert, displayName: 'Dr. Forged' },
				},
			},
		}
		const cache = new TtlCache<import('../contract/kernel.js').CertVerdict>()
		const ctx = { ...RENDER_CTX, now: new Date('2026-06-22T00:00:00Z') }

		const validVerdict = await getVerifiedEnvelope({
			source: { kind: 'metafield', value: envelope },
			resolveKid,
			context: ctx,
			cache,
		})
		const tamperedVerdict = await getVerifiedEnvelope({
			source: { kind: 'metafield', value: tampered },
			resolveKid,
			context: ctx,
			cache,
		})

		expect(validVerdict.decision).toBe('render')
		expect(tamperedVerdict).toEqual({ decision: 'suppress', reason: 'invalid_signature' })
	})
})

describe('getVerifiedEnvelope — Delivery API source', () => {
	it('fetches from GET /api/cert/v1/delivery/{platform}/{externalId} and verifies', async () => {
		const { envelope, resolveKid } = makeSignedEnvelope()
		const fetchImpl = vi.fn(async () => new Response(JSON.stringify(envelope), { status: 200 }))
		const verdict = await getVerifiedEnvelope({
			source: {
				kind: 'delivery_api',
				baseUrl: 'https://portal.certrev.com',
				platform: 'shopify',
				externalId: 'gid://shopify/Article/123456789',
			},
			resolveKid,
			context: { ...RENDER_CTX, now: new Date('2026-06-22T00:00:00Z') },
			fetchImpl: fetchImpl as unknown as typeof fetch,
			cache: new TtlCache(),
		})
		expect(verdict.decision).toBe('render')
		expect(fetchImpl).toHaveBeenCalledOnce()
		const calledUrl = (fetchImpl.mock.calls[0] as unknown[])[0] as string
		expect(calledUrl).toBe(
			'https://portal.certrev.com/api/cert/v1/delivery/shopify/gid%3A%2F%2Fshopify%2FArticle%2F123456789',
		)
	})

	it('SINGLE-FLIGHTS concurrent SSR renders — N renders → ONE fetch (thundering-herd guard)', async () => {
		const { envelope, resolveKid } = makeSignedEnvelope()
		let calls = 0
		const fetchImpl = vi.fn(async () => {
			calls++
			await new Promise((r) => setTimeout(r, 10))
			return new Response(JSON.stringify(envelope), { status: 200 })
		})
		const cache = new TtlCache<never>() as unknown as TtlCache<import('../contract/kernel.js').CertVerdict>
		const opts = {
			source: {
				kind: 'delivery_api' as const,
				baseUrl: 'https://portal.certrev.com',
				platform: 'shopify',
				externalId: 'gid://shopify/Article/123456789',
			},
			resolveKid,
			context: { ...RENDER_CTX, now: new Date('2026-06-22T00:00:00Z') },
			fetchImpl: fetchImpl as unknown as typeof fetch,
			cache,
		}
		const verdicts = await Promise.all([
			getVerifiedEnvelope(opts),
			getVerifiedEnvelope(opts),
			getVerifiedEnvelope(opts),
			getVerifiedEnvelope(opts),
			getVerifiedEnvelope(opts),
		])
		expect(verdicts.every((v) => v.decision === 'render')).toBe(true)
		expect(calls).toBe(1)
	})
})

const DELIVERY_SOURCE = {
	kind: 'delivery_api' as const,
	baseUrl: 'https://portal.certrev.com',
	platform: 'shopify',
	externalId: 'gid://shopify/Article/123456789',
}

/**
 * A SIGNED slim tombstone — the artifact the Delivery API serves at 200 for a
 * REVOKED cert. Signed for real (same trust root shape as the envelope fixture) because
 * `verifyTombstone` checks the signature before it will say 'revoked'.
 */
function makeSignedTombstone(): { tombstone: CertTombstone; resolveKid: ResolvePublicKeyByKid } {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519')
	const kid = 'certrev-fixture-tombstone-1'
	const signable: CertTombstoneSignable = {
		kind: 'tombstone',
		contractVersion: 1,
		subject: makeMockPayload().subject,
		revokedAt: '2026-06-22T12:00:00.000Z',
		revocationReason: 'cert_revoked',
	}
	const sig = base64urlEncode(new Uint8Array(nodeSign(null, canonicalTombstoneBytes(signable), privateKey)))
	const keyInput: Ed25519PublicKeyInput = {
		format: 'spki-base64',
		base64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
	}
	return {
		tombstone: { ...signable, signature: { alg: 'ed25519', kid, sig, signedAt: signable.revokedAt } },
		resolveKid: (k) => (k === kid ? keyInput : null),
	}
}

describe('getVerifiedEnvelope — a suppress must say what ACTUALLY failed', () => {
	// A1: network failure, "nothing is published here", a revocation and an unreadable body are
	// four different bugs on the consumer's side. Collapsing all of them into
	// 'unsupported_contract_version' sends them to inspect a contractVersion that was never in
	// play — the mislabel is what turns a one-character typo into a lost day.
	const run = async (
		fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
		resolveKid?: ResolvePublicKeyByKid,
	) =>
		getVerifiedEnvelope({
			source: DELIVERY_SOURCE,
			resolveKid: resolveKid ?? makeSignedEnvelope().resolveKid,
			context: RENDER_CTX,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			cache: new TtlCache(),
		})

	it('404 — nothing published for this subject → subject_mismatch', async () => {
		expect(await run(async () => new Response('', { status: 404 }))).toEqual({
			decision: 'suppress',
			reason: 'subject_mismatch',
		})
	})

	it('410 Gone — this placement is no longer served → subject_mismatch', async () => {
		expect(await run(async () => new Response('', { status: 410 }))).toEqual({
			decision: 'suppress',
			reason: 'subject_mismatch',
		})
	})

	it('200 carrying a SIGNED tombstone → revoked, not a parse complaint', async () => {
		const { tombstone, resolveKid } = makeSignedTombstone()
		const verdict = await run(async () => new Response(JSON.stringify(tombstone), { status: 200 }), resolveKid)
		expect(verdict).toEqual({ decision: 'suppress', reason: 'revoked' })
	})

	it('a 5xx origin error → unsupported_contract_version (closest member; the enum has no transport reason)', async () => {
		expect(await run(async () => new Response('', { status: 503 }))).toEqual({
			decision: 'suppress',
			reason: 'unsupported_contract_version',
		})
	})

	it('a network throw → unsupported_contract_version (same gap in the contract enum)', async () => {
		expect(
			await run(async () => {
				throw new TypeError('fetch failed')
			}),
		).toEqual({ decision: 'suppress', reason: 'unsupported_contract_version' })
	})

	it('200 with an unreadable body → unsupported_contract_version (here the reason is TRUE)', async () => {
		expect(await run(async () => new Response('{not json', { status: 200 }))).toEqual({
			decision: 'suppress',
			reason: 'unsupported_contract_version',
		})
	})
})

describe('getVerifiedEnvelope — the delivery fetch has a DEADLINE (a hung origin must not hang the render)', () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	/** A fetch that never settles AND ignores the signal — the worst-case hung origin. */
	function hungFetch(): { impl: typeof fetch; signal: () => AbortSignal | undefined } {
		let seen: AbortSignal | undefined
		const impl = ((_url: string, init?: RequestInit) => {
			seen = init?.signal ?? undefined
			return new Promise<Response>(() => {})
		}) as unknown as typeof fetch
		return { impl, signal: () => seen }
	}

	it('a fetch that never settles aborts at the configured deadline and fails closed', { timeout: 3_000 }, async () => {
		vi.useFakeTimers()
		const hung = hungFetch()
		const pending = getVerifiedEnvelope({
			source: DELIVERY_SOURCE,
			resolveKid: makeSignedEnvelope().resolveKid,
			context: RENDER_CTX,
			fetchImpl: hung.impl,
			timeoutMs: 1_000,
			cache: new TtlCache(),
		})
		await vi.advanceTimersByTimeAsync(1_001)
		expect(await pending).toEqual({ decision: 'suppress', reason: 'unsupported_contract_version' })
		// The request is actually cancelled, not merely abandoned — the socket goes back.
		expect(hung.signal()?.aborted).toBe(true)
	})

	it('the DEFAULT deadline (3s) applies when the caller sets none', { timeout: 3_000 }, async () => {
		vi.useFakeTimers()
		const hung = hungFetch()
		const pending = getVerifiedEnvelope({
			source: DELIVERY_SOURCE,
			resolveKid: makeSignedEnvelope().resolveKid,
			context: RENDER_CTX,
			fetchImpl: hung.impl,
			cache: new TtlCache(),
		})
		await vi.advanceTimersByTimeAsync(DEFAULT_FETCH_TIMEOUT_MS + 1)
		expect((await pending).decision).toBe('suppress')
	})

	it('fetchingKidResolver — a hung JWKS endpoint resolves null at the deadline instead of hanging', {
		timeout: 3_000,
	}, async () => {
		vi.useFakeTimers()
		const hung = hungFetch()
		const resolve = fetchingKidResolver({
			jwksUrl: 'https://certrev.com/.well-known/cert-keys.json',
			fetchImpl: hung.impl,
			timeoutMs: 1_000,
		})
		const pending = resolve('certrev-fixture-key-1')
		await vi.advanceTimersByTimeAsync(1_001)
		// Fail-closed: no key set → every kid resolves null → the kernel suppresses 'unknown_key'.
		expect(await pending).toBeNull()
		expect(hung.signal()?.aborted).toBe(true)
	})
})

describe('getVerifiedEnvelope — the cache key must identify everything the verdict depends on', () => {
	const envelopeResponse = (envelope: CertDeliveryEnvelope) =>
		vi.fn(async () => new Response(JSON.stringify(envelope), { status: 200 }))

	it('two DIFFERENT baseUrls at the same platform/externalId do not share one entry', async () => {
		// Staging and production portals serve different envelopes for the same article. The old
		// key (`api:<platform>:<externalId>`) collided them: whichever rendered first won.
		const { envelope, resolveKid } = makeSignedEnvelope()
		const fetchImpl = envelopeResponse(envelope)
		const cache = new TtlCache<CertVerdict>()
		const common = {
			resolveKid,
			context: { ...RENDER_CTX, now: new Date('2026-06-22T00:00:00Z') },
			fetchImpl: fetchImpl as unknown as typeof fetch,
			cache,
		}
		await getVerifiedEnvelope({ ...common, source: { ...DELIVERY_SOURCE, baseUrl: 'https://portal.certrev.com' } })
		await getVerifiedEnvelope({ ...common, source: { ...DELIVERY_SOURCE, baseUrl: 'https://staging.certrev.com' } })
		expect(fetchImpl).toHaveBeenCalledTimes(2)
		expect((fetchImpl.mock.calls[0] as unknown[])[0]).toContain('portal.certrev.com')
		expect((fetchImpl.mock.calls[1] as unknown[])[0]).toContain('staging.certrev.com')
	})

	it('a CHANGED live content hash does not reuse the pre-drift render verdict (delivery)', async () => {
		// The dangerous direction: the entry cached while the article matched its digest was
		// served for a render whose body had since drifted → an unverified credential rendered.
		const digest = 'c'.repeat(64)
		const { envelope, resolveKid } = makeSignedEnvelope({
			subject: { ...makeMockPayload().subject, contentDigest: digest },
		})
		const fetchImpl = envelopeResponse(envelope)
		const cache = new TtlCache<CertVerdict>()
		const common = {
			source: DELIVERY_SOURCE,
			resolveKid,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			cache,
		}
		const now = new Date('2026-06-22T00:00:00Z')
		const clean = await getVerifiedEnvelope({ ...common, context: { ...RENDER_CTX, now, liveContentHash: digest } })
		const drifted = await getVerifiedEnvelope({
			...common,
			context: { ...RENDER_CTX, now, liveContentHash: 'd'.repeat(64) },
		})
		expect(clean.decision).toBe('render')
		expect(drifted).toEqual({ decision: 'suppress', reason: 'content_drift' })
	})

	it('a CHANGED live content hash does not reuse the pre-drift render verdict (metafield)', async () => {
		const digest = 'c'.repeat(64)
		const { envelope, resolveKid } = makeSignedEnvelope({
			subject: { ...makeMockPayload().subject, contentDigest: digest },
		})
		const cache = new TtlCache<CertVerdict>()
		const now = new Date('2026-06-22T00:00:00Z')
		const common = { source: { kind: 'metafield' as const, value: envelope }, resolveKid, cache }
		const clean = await getVerifiedEnvelope({ ...common, context: { ...RENDER_CTX, now, liveContentHash: digest } })
		const drifted = await getVerifiedEnvelope({
			...common,
			context: { ...RENDER_CTX, now, liveContentHash: 'd'.repeat(64) },
		})
		expect(clean.decision).toBe('render')
		expect(drifted).toEqual({ decision: 'suppress', reason: 'content_drift' })
	})

	it('invalidateVerdict drops the placement whatever live hash it was cached under', async () => {
		// A revocation webhook knows the placement, never the live body hash the render observed.
		const { envelope, resolveKid } = makeSignedEnvelope()
		const fetchImpl = envelopeResponse(envelope)
		const cache = new TtlCache<CertVerdict>()
		const common = {
			source: DELIVERY_SOURCE,
			resolveKid,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			cache,
		}
		const now = new Date('2026-06-22T00:00:00Z')
		const ctx = { ...RENDER_CTX, now, liveContentHash: makeMockPayload().subject.contentDigest }
		await getVerifiedEnvelope({ ...common, context: ctx })
		invalidateVerdict(DELIVERY_SOURCE, RENDER_CTX, cache)
		await getVerifiedEnvelope({ ...common, context: ctx })
		expect(fetchImpl).toHaveBeenCalledTimes(2)
	})
})

describe('getVerifiedEnvelope — ttlMs', () => {
	it('honours a caller-supplied positive TTL (it was a documented no-op)', async () => {
		const { envelope, resolveKid } = makeSignedEnvelope()
		const fetchImpl = vi.fn(async () => new Response(JSON.stringify(envelope), { status: 200 }))
		let clock = 0
		const cache = new TtlCache<CertVerdict>({ now: () => clock })
		const opts = {
			source: DELIVERY_SOURCE,
			resolveKid,
			context: { ...RENDER_CTX, now: new Date('2026-06-22T00:00:00Z') },
			fetchImpl: fetchImpl as unknown as typeof fetch,
			cache,
			ttlMs: 1_000,
		}
		expect((await getVerifiedEnvelope(opts)).decision).toBe('render')
		clock = 999
		await getVerifiedEnvelope(opts)
		expect(fetchImpl).toHaveBeenCalledTimes(1)
		clock = 1_001
		await getVerifiedEnvelope(opts)
		expect(fetchImpl).toHaveBeenCalledTimes(2)
	})

	it('a long ttlMs never lengthens a SUPPRESS entry — a transient failure still recovers fast', async () => {
		const { resolveKid } = makeSignedEnvelope()
		const fetchImpl = vi.fn(async () => new Response('', { status: 503 }))
		let clock = 0
		const cache = new TtlCache<CertVerdict>({ now: () => clock, negativeTtlMs: 5_000 })
		const opts = {
			source: DELIVERY_SOURCE,
			resolveKid,
			context: RENDER_CTX,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			cache,
			ttlMs: 600_000,
		}
		expect((await getVerifiedEnvelope(opts)).decision).toBe('suppress')
		clock = 5_001
		await getVerifiedEnvelope(opts)
		expect(fetchImpl).toHaveBeenCalledTimes(2)
	})
})

describe('staticKidResolver', () => {
	it('resolves a configured kid and returns null for an unknown one', async () => {
		const { envelope, publicKey, kid } = makeSignedEnvelope()
		const pem = publicKey.export({ format: 'pem', type: 'spki' }).toString()
		const resolver = staticKidResolver({ [kid]: pem })
		const verdict = await verifyEnvelope(envelope, resolver, { ...RENDER_CTX, now: new Date('2026-06-22T00:00:00Z') })
		expect(verdict.decision).toBe('render')
		expect(await resolver('nope')).toBeNull()
	})
})
