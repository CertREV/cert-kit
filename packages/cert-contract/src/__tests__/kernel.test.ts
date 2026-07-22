import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import {
	base64urlEncode,
	type CertDeliveryEnvelope,
	type CertPayload,
	type CertSubject,
	importEd25519PublicKey,
	isTombstone,
	type ResolvePublicKeyByKid,
	renderVerdict,
	verifyArtifact,
	verifyDetachedSignature,
	verifyEnvelope,
	verifySignatureOnly,
	verifyTombstone,
} from '../index.js'
// SIGN path is Node-only and lives on the signer subpath now.
import { localEd25519Signer, type SignWith, signPayloadEd25519, signTombstone } from '../signer.js'

const KID = 'test-key-1'

function makePayload(overrides: Partial<CertPayload> = {}): CertPayload {
	return {
		contractVersion: 1,
		certId: 'cert_test_1',
		subject: {
			platform: 'shopify',
			externalId: 'gid://shopify/Article/999',
			logicalArticleId: 'art_logical_1',
			canonicalUrls: ['https://brand.com/blogs/news/post'],
			installationId: 'inst_1',
			contentDigest: 'f'.repeat(64),
		},
		content: {
			expert: {
				displayName: 'Dr. Test Expert',
				credentials: [{ abbreviation: 'PhD', fullName: 'Doctor of Philosophy' }],
				profileUrl: 'https://certrev.com/experts/test',
				photoUrl: null,
			},
			author: { name: 'Author', title: 'Editor' },
			memo: 'Looks good.',
			certifiedAt: '2026-06-21T12:00:00.000Z',
			contentModifiedAt: null,
			verifyUrl: 'https://certrev.com/verify/cert_test_1',
			display: { badgeStyle: 'full' },
		},
		lifecycle: {
			issuedAt: '2026-06-21T12:00:00.000Z',
			expiresAt: '2099-01-01T00:00:00.000Z',
			revokedAt: null,
			revision: 1,
		},
		...overrides,
	}
}

describe('sign + verify round-trip (generated Ed25519 keypair)', () => {
	let publicKey: KeyObject
	let privateKey: KeyObject
	let resolveKid: ResolvePublicKeyByKid

	beforeAll(() => {
		;({ publicKey, privateKey } = generateKeyPairSync('ed25519'))
		// A real edge resolver hands the WebCrypto kernel declarative key bytes (here the
		// SPKI base64), NOT a Node KeyObject. The kernel imports it via WebCrypto.
		const spkiBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
		resolveKid = (kid) => (kid === KID ? { format: 'spki-base64', base64: spkiBase64 } : null)
	})

	function sign(payload: CertPayload): CertDeliveryEnvelope {
		return {
			payload,
			signature: {
				alg: 'ed25519',
				kid: KID,
				sig: signPayloadEd25519(payload, privateKey),
				signedAt: '2026-06-21T12:00:00.000Z',
			},
		}
	}

	it('a freshly signed envelope renders, carrying the verified payload', async () => {
		const env = sign(makePayload())
		const verdict = await verifyEnvelope(env, resolveKid, {
			platform: 'shopify',
			externalId: 'gid://shopify/Article/999',
			now: new Date('2026-06-22T00:00:00.000Z'),
		})
		expect(verdict.decision).toBe('render')
		if (verdict.decision === 'render') {
			expect(verdict.payload.certId).toBe('cert_test_1')
		}
	})

	it('low-level detached signature verifies over JCS(payload)', async () => {
		const payload = makePayload()
		const sig = signPayloadEd25519(payload, privateKey)
		const spkiBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
		const cryptoKey = await importEd25519PublicKey({ format: 'spki-base64', base64: spkiBase64 })
		expect(await verifyDetachedSignature(payload, sig, cryptoKey)).toBe(true)
	})

	it('verifySignatureOnly succeeds for an authentic envelope', async () => {
		const env = sign(makePayload())
		expect(await verifySignatureOnly(env, resolveKid)).toEqual({ ok: true })
	})

	// ── Tamper detection ─────────────────────────────────────────────────────────

	it('a tampered payload (field changed after signing) fails verification', async () => {
		const env = sign(makePayload())
		const tampered: CertDeliveryEnvelope = {
			...env,
			payload: { ...env.payload, certId: 'cert_FORGED' },
		}
		expect(await verifySignatureOnly(tampered, resolveKid)).toEqual({ ok: false, reason: 'invalid_signature' })
		const verdict = await verifyEnvelope(tampered, resolveKid, {
			platform: 'shopify',
			externalId: 'gid://shopify/Article/999',
		})
		expect(verdict).toEqual({ decision: 'suppress', reason: 'invalid_signature' })
	})

	it('a tampered nested subject (re-pointed externalId) fails verification', async () => {
		const env = sign(makePayload())
		const moved: CertDeliveryEnvelope = {
			...env,
			payload: { ...env.payload, subject: { ...env.payload.subject, externalId: 'gid://shopify/Article/OTHER' } },
		}
		expect(await verifySignatureOnly(moved, resolveKid)).toEqual({ ok: false, reason: 'invalid_signature' })
	})

	it('a signature from a different key fails verification', async () => {
		const { privateKey: otherPriv } = generateKeyPairSync('ed25519')
		const payload = makePayload()
		const env: CertDeliveryEnvelope = {
			payload,
			signature: {
				alg: 'ed25519',
				kid: KID,
				sig: signPayloadEd25519(payload, otherPriv),
				signedAt: payload.lifecycle.issuedAt,
			},
		}
		expect(await verifySignatureOnly(env, resolveKid)).toEqual({ ok: false, reason: 'invalid_signature' })
	})

	it('a garbage signature fails closed (no throw)', async () => {
		const payload = makePayload()
		const env: CertDeliveryEnvelope = {
			payload,
			signature: {
				alg: 'ed25519',
				kid: KID,
				sig: base64urlEncode(new Uint8Array(64)),
				signedAt: payload.lifecycle.issuedAt,
			},
		}
		expect(await verifySignatureOnly(env, resolveKid)).toEqual({ ok: false, reason: 'invalid_signature' })
	})

	// ── Crypto-phase fail-closed branches ──────────────────────────────────────────

	it('unknown kid → suppress unknown_key', async () => {
		const env = sign(makePayload())
		const verdict = await verifyEnvelope({ ...env, signature: { ...env.signature, kid: 'nope' } }, resolveKid, {
			platform: 'shopify',
			externalId: 'gid://shopify/Article/999',
		})
		expect(verdict).toEqual({ decision: 'suppress', reason: 'unknown_key' })
	})

	it('wrong alg → suppress unsupported_alg', async () => {
		const env = sign(makePayload())
		// biome-ignore lint/suspicious/noExplicitAny: forcing an invalid alg for the negative path
		const bad = { ...env, signature: { ...env.signature, alg: 'rsa' as any } }
		expect(
			(await verifyEnvelope(bad, resolveKid, { platform: 'shopify', externalId: 'gid://shopify/Article/999' }))
				.decision,
		).toBe('suppress')
		expect(await verifySignatureOnly(bad, resolveKid)).toEqual({ ok: false, reason: 'unsupported_alg' })
	})

	it('unknown contractVersion → suppress unsupported_contract_version', async () => {
		const env = sign(makePayload())
		// biome-ignore lint/suspicious/noExplicitAny: forcing an unsupported version
		const bad = { ...env, payload: { ...env.payload, contractVersion: 2 as any } }
		expect(await verifySignatureOnly(bad, resolveKid)).toEqual({ ok: false, reason: 'unsupported_contract_version' })
	})

	it('a throwing resolver fails closed to suppress (never bubbles)', async () => {
		const env = sign(makePayload())
		const throwing: ResolvePublicKeyByKid = () => {
			throw new Error('resolver exploded')
		}
		const verdict = await verifyEnvelope(env, throwing, {
			platform: 'shopify',
			externalId: 'gid://shopify/Article/999',
		})
		expect(verdict.decision).toBe('suppress')
	})

	// ── Policy phase (renderVerdict) over an authentic payload ─────────────────────

	it('platform mismatch → suppress platform_mismatch', () => {
		expect(renderVerdict(makePayload(), { platform: 'wordpress', externalId: 'gid://shopify/Article/999' })).toEqual({
			decision: 'suppress',
			reason: 'platform_mismatch',
		})
	})

	it('externalId mismatch → suppress subject_mismatch', () => {
		expect(
			renderVerdict(makePayload(), { platform: 'shopify', externalId: 'gid://shopify/Article/DIFFERENT' }),
		).toEqual({
			decision: 'suppress',
			reason: 'subject_mismatch',
		})
	})

	it('revoked → suppress revoked', () => {
		const p = makePayload({
			lifecycle: {
				issuedAt: '2026-06-21T12:00:00.000Z',
				expiresAt: '2099-01-01T00:00:00.000Z',
				revokedAt: '2026-06-21T13:00:00.000Z',
				revision: 2,
			},
		})
		expect(renderVerdict(p, { platform: 'shopify', externalId: 'gid://shopify/Article/999' })).toEqual({
			decision: 'suppress',
			reason: 'revoked',
		})
	})

	it('expired (now >= expiresAt) → suppress expired', () => {
		const p = makePayload({
			lifecycle: {
				issuedAt: '2026-01-01T00:00:00.000Z',
				expiresAt: '2026-02-01T00:00:00.000Z',
				revokedAt: null,
				revision: 1,
			},
		})
		expect(
			renderVerdict(p, {
				platform: 'shopify',
				externalId: 'gid://shopify/Article/999',
				now: new Date('2026-03-01T00:00:00.000Z'),
			}),
		).toEqual({ decision: 'suppress', reason: 'expired' })
	})

	it('content drift (live hash != subject.contentDigest) → suppress content_drift', () => {
		expect(
			renderVerdict(makePayload(), {
				platform: 'shopify',
				externalId: 'gid://shopify/Article/999',
				liveContentHash: 'a'.repeat(64),
			}),
		).toEqual({ decision: 'suppress', reason: 'content_drift' })
	})

	it('matching live hash → render', () => {
		const v = renderVerdict(makePayload(), {
			platform: 'shopify',
			externalId: 'gid://shopify/Article/999',
			liveContentHash: 'f'.repeat(64),
		})
		expect(v.decision).toBe('render')
	})

	it('no contentDigest bound → drift check skipped (renders even with a live hash)', () => {
		const p = makePayload({
			subject: { ...makePayload().subject, contentDigest: null },
		})
		const v = renderVerdict(p, {
			platform: 'shopify',
			externalId: 'gid://shopify/Article/999',
			liveContentHash: 'deadbeef',
		})
		expect(v.decision).toBe('render')
	})

	it('contentDigest bound but edge cannot read live content → drift check skipped → render', () => {
		const v = renderVerdict(makePayload(), { platform: 'shopify', externalId: 'gid://shopify/Article/999' })
		expect(v.decision).toBe('render')
	})
})

describe('public-key input encodings', () => {
	it('accepts spki-base64 + raw key inputs against a real signature', async () => {
		const { publicKey, privateKey } = generateKeyPairSync('ed25519')
		const spkiB64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
		const rawKey = new Uint8Array(
			publicKey.export({ format: 'jwk' }).x
				? Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url')
				: [],
		)
		const payload = makePayload()
		const env: CertDeliveryEnvelope = {
			payload,
			signature: {
				alg: 'ed25519',
				kid: KID,
				sig: signPayloadEd25519(payload, privateKey),
				signedAt: payload.lifecycle.issuedAt,
			},
		}
		expect(await verifySignatureOnly(env, () => ({ format: 'spki-base64', base64: spkiB64 }))).toEqual({ ok: true })
		expect(await verifySignatureOnly(env, () => ({ format: 'raw', bytes: rawKey }))).toEqual({ ok: true })
	})
})

// ── Tombstone: the slim revocation artifact (POR-10481) ───────────────────────────

describe('tombstone sign + verify (POR-10481)', () => {
	const KID = 'test-key-1'
	let publicKey: KeyObject
	let privateKey: KeyObject
	let resolveKid: ResolvePublicKeyByKid
	let signWith: SignWith

	const SUBJECT: CertSubject = {
		platform: 'shopify',
		externalId: 'gid://shopify/Article/999',
		logicalArticleId: 'art_logical_1',
		canonicalUrls: ['https://brand.com/blogs/news/post'],
		installationId: 'inst_1',
		contentDigest: 'f'.repeat(64),
	}
	const CTX = { platform: 'shopify', externalId: 'gid://shopify/Article/999' } as const

	beforeAll(() => {
		;({ publicKey, privateKey } = generateKeyPairSync('ed25519'))
		const spkiBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
		resolveKid = (kid) => (kid === KID ? { format: 'spki-base64', base64: spkiBase64 } : null)
		signWith = { kid: KID, sign: localEd25519Signer(privateKey), signedAt: '2026-06-21T13:00:00.000Z' }
	})

	const mint = (over: Partial<Parameters<typeof signTombstone>[0]> = {}, sw: SignWith = signWith) =>
		signTombstone(
			{ subject: SUBJECT, revokedAt: '2026-06-21T13:00:00.000Z', revocationReason: 'cert_revoked', ...over },
			sw,
		)

	it('isTombstone discriminates a tombstone from an envelope', async () => {
		const t = await mint()
		expect(isTombstone(t)).toBe(true)
		expect(isTombstone({ payload: makePayload(), signature: t.signature })).toBe(false)
	})

	it('a valid tombstone for THIS subject → suppress revoked (verifyArtifact + verifyTombstone)', async () => {
		const t = await mint()
		expect(await verifyArtifact(t, resolveKid, CTX)).toEqual({ decision: 'suppress', reason: 'revoked' })
		expect(await verifyTombstone(t, resolveKid, CTX)).toEqual({ decision: 'suppress', reason: 'revoked' })
	})

	it('carries NO certified content (subject + revocation facts + signature only) — privacy', async () => {
		const t = await mint()
		expect(Object.keys(t).sort()).toEqual([
			'contractVersion',
			'kind',
			'revocationReason',
			'revokedAt',
			'signature',
			'subject',
		])
		expect('content' in t).toBe(false)
		expect('payload' in t).toBe(false)
	})

	it('a tampered revokedAt (changed after signing) fails verification', async () => {
		const t = await mint()
		const tampered = { ...t, revokedAt: '2099-01-01T00:00:00.000Z' }
		expect(await verifyArtifact(tampered, resolveKid, CTX)).toEqual({
			decision: 'suppress',
			reason: 'invalid_signature',
		})
	})

	it('a re-pointed subject.externalId fails verification (the sig covers the subject)', async () => {
		const t = await mint()
		const moved = { ...t, subject: { ...t.subject, externalId: 'gid://shopify/Article/OTHER' } }
		expect(
			await verifyArtifact(moved, resolveKid, { platform: 'shopify', externalId: 'gid://shopify/Article/OTHER' }),
		).toEqual({ decision: 'suppress', reason: 'invalid_signature' })
	})

	it('a VALID tombstone for a DIFFERENT article → subject_mismatch (replay does not blank this one)', async () => {
		const t = await mint() // for article 999
		expect(
			await verifyArtifact(t, resolveKid, { platform: 'shopify', externalId: 'gid://shopify/Article/123' }),
		).toEqual({ decision: 'suppress', reason: 'subject_mismatch' })
	})

	it('wrong platform → suppress platform_mismatch', async () => {
		const t = await mint()
		expect(
			await verifyArtifact(t, resolveKid, { platform: 'wordpress', externalId: 'gid://shopify/Article/999' }),
		).toEqual({ decision: 'suppress', reason: 'platform_mismatch' })
	})

	it('unknown kid → suppress unknown_key', async () => {
		const t = await mint({}, { ...signWith, kid: 'nope' })
		expect(await verifyArtifact(t, resolveKid, CTX)).toEqual({ decision: 'suppress', reason: 'unknown_key' })
	})

	it('wrong alg → suppress unsupported_alg', async () => {
		const t = await mint()
		// biome-ignore lint/suspicious/noExplicitAny: forcing an invalid alg for the negative path
		const bad = { ...t, signature: { ...t.signature, alg: 'rsa' as any } }
		expect(await verifyArtifact(bad, resolveKid, CTX)).toEqual({ decision: 'suppress', reason: 'unsupported_alg' })
	})

	it('unknown contractVersion → suppress unsupported_contract_version', async () => {
		const t = await mint()
		// biome-ignore lint/suspicious/noExplicitAny: forcing an unsupported version
		const bad = { ...t, contractVersion: 2 as any }
		expect(await verifyArtifact(bad, resolveKid, CTX)).toEqual({
			decision: 'suppress',
			reason: 'unsupported_contract_version',
		})
	})

	it('a signature from a different key fails verification', async () => {
		const { privateKey: otherPriv } = generateKeyPairSync('ed25519')
		const t = await mint({}, { ...signWith, sign: localEd25519Signer(otherPriv) })
		expect(await verifyArtifact(t, resolveKid, CTX)).toEqual({ decision: 'suppress', reason: 'invalid_signature' })
	})

	it('verifyArtifact dispatches an ENVELOPE through the full pipeline (a valid envelope still renders)', async () => {
		const payload = makePayload()
		const env: CertDeliveryEnvelope = {
			payload,
			signature: {
				alg: 'ed25519',
				kid: KID,
				sig: signPayloadEd25519(payload, privateKey),
				signedAt: payload.lifecycle.issuedAt,
			},
		}
		const verdict = await verifyArtifact(env, resolveKid, {
			platform: 'shopify',
			externalId: 'gid://shopify/Article/999',
			now: new Date('2026-06-22T00:00:00.000Z'),
		})
		expect(verdict.decision).toBe('render')
	})

	it('an OLD envelope-only kernel (verifyEnvelope) receiving a tombstone fails CLOSED (safe blank)', async () => {
		const t = await mint()
		// verifyEnvelope reads `.payload` — a tombstone has none → unsupported_contract_version (suppress, blank).
		expect(await verifyEnvelope(t as unknown as CertDeliveryEnvelope, resolveKid, CTX)).toEqual({
			decision: 'suppress',
			reason: 'unsupported_contract_version',
		})
	})
})
