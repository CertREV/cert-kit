import { describe, expect, it, vi } from 'vitest'
import { makeSignedEnvelope } from '../contract/fixtures.js'
import type { CertDeliveryEnvelope } from '../contract/kernel.js'
import { verifyEnvelope } from '../contract/kernel.js'
import { TtlCache } from '../verify/cache.js'
import { getVerifiedEnvelope } from '../verify/get-verified-envelope.js'
import { staticKidResolver } from '../verify/resolve-kid.js'

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

	it('a missing metafield value fails closed to suppress', async () => {
		const { resolveKid } = makeSignedEnvelope()
		const verdict = await getVerifiedEnvelope({
			source: { kind: 'metafield', value: null },
			resolveKid,
			context: RENDER_CTX,
			cache: new TtlCache(),
		})
		expect(verdict.decision).toBe('suppress')
	})

	it('malformed JSON in a metafield fails closed (no throw)', async () => {
		const { resolveKid } = makeSignedEnvelope()
		const verdict = await getVerifiedEnvelope({
			source: { kind: 'metafield', value: '{not json' },
			resolveKid,
			context: RENDER_CTX,
			cache: new TtlCache(),
		})
		expect(verdict.decision).toBe('suppress')
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

	it('a 404 / 410 from the Delivery API fails closed to suppress', async () => {
		const { resolveKid } = makeSignedEnvelope()
		const fetchImpl = vi.fn(async () => new Response('', { status: 410 }))
		const verdict = await getVerifiedEnvelope({
			source: { kind: 'delivery_api', baseUrl: 'https://portal.certrev.com', platform: 'shopify', externalId: 'x' },
			resolveKid,
			context: RENDER_CTX,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			cache: new TtlCache(),
		})
		expect(verdict.decision).toBe('suppress')
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
