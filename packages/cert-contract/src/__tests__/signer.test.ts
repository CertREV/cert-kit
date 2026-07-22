import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalizeJson, canonicalPayloadBytes } from '../canonical.js'
import { base64urlDecode, type ResolvePublicKeyByKid, verifyEnvelope } from '../kernel.js'
import { buildPayload, localEd25519Signer, type MintPayloadInput, mintEnvelope } from '../signer.js'
import type { CertPayload } from '../types.js'

const baseInput: MintPayloadInput = {
	certId: 'cert_signer_001',
	subject: {
		platform: 'shopify',
		externalId: 'gid://shopify/Article/999',
		logicalArticleId: 'art_signer',
		canonicalUrls: ['https://brand.example.com/blogs/news/signer'],
		installationId: 'inst_signer',
		contentDigest: 'e'.repeat(64),
	},
	facts: {
		expert: {
			displayName: 'Dr. Signer',
			credentials: [{ abbreviation: 'MD', fullName: 'Doctor of Medicine' }],
			profileUrl: 'https://certrev.com/experts/signer',
			photoUrl: null,
		},
		author: { name: 'CertREV', title: null },
		memo: 'Minted via the signer pipeline. 世界 🎯',
		certifiedAt: '2026-06-21T12:00:00.000Z',
		contentModifiedAt: null,
		verifyUrl: 'https://certrev.com/verify/cert_signer_001',
		display: { badgeStyle: 'full', showExpertPhoto: true },
	},
	lifecycle: {
		issuedAt: '2026-06-21T12:00:00.000Z',
		expiresAt: '2099-01-01T00:00:00.000Z',
		revokedAt: null,
		revision: 1,
	},
}

describe('signer: facts → canonicalize → sign → envelope', () => {
	it('buildPayload assembles facts into the canonical payload shape (no JSON-LD)', () => {
		const payload = buildPayload(baseInput)
		expect(payload.contractVersion).toBe(1)
		expect(payload.content.expert.displayName).toBe('Dr. Signer')
		// JSON-LD is NOT in the signed payload — only structured facts.
		expect(payload).not.toHaveProperty('schema')
		expect(payload.content).not.toHaveProperty('jsonLd')
	})

	it('mintEnvelope signs the JCS bytes and the kernel renders the verified payload', async () => {
		const { publicKey, privateKey } = generateKeyPairSync('ed25519')
		const kid = 'local-test-key'
		const envelope = await mintEnvelope(baseInput, {
			kid,
			sign: localEd25519Signer(privateKey),
			signedAt: baseInput.lifecycle.issuedAt,
		})

		expect(envelope.signature.alg).toBe('ed25519')
		expect(envelope.signature.kid).toBe(kid)
		// base64url with no padding; 64 raw bytes → 86 base64url chars.
		expect(envelope.signature.sig).toMatch(/^[A-Za-z0-9_-]{86}$/)
		expect(base64urlDecode(envelope.signature.sig).length).toBe(64)

		// Edge resolver hands the WebCrypto kernel declarative key bytes (SPKI base64), not
		// a Node KeyObject.
		const spkiBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
		const resolveKid: ResolvePublicKeyByKid = (k) => (k === kid ? { format: 'spki-base64', base64: spkiBase64 } : null)
		const verdict = await verifyEnvelope(envelope, resolveKid, {
			platform: 'shopify',
			externalId: 'gid://shopify/Article/999',
			liveContentHash: 'e'.repeat(64),
			now: new Date('2026-06-22T00:00:00.000Z'),
		})
		expect(verdict.decision).toBe('render')
		if (verdict.decision === 'render') expect(verdict.payload.certId).toBe('cert_signer_001')
	})

	it('a tampered payload under the same signature fails closed', async () => {
		const { publicKey, privateKey } = generateKeyPairSync('ed25519')
		const kid = 'local-test-key'
		const envelope = await mintEnvelope(baseInput, { kid, sign: localEd25519Signer(privateKey) })
		const tampered = { ...envelope, payload: { ...envelope.payload, certId: 'cert_FORGED' } as CertPayload }
		const spkiBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
		const resolveKid: ResolvePublicKeyByKid = (k) => (k === kid ? { format: 'spki-base64', base64: spkiBase64 } : null)
		const verdict = await verifyEnvelope(tampered, resolveKid, {
			platform: 'shopify',
			externalId: 'gid://shopify/Article/999',
		})
		expect(verdict).toEqual({ decision: 'suppress', reason: 'invalid_signature' })
	})

	it('rejects a signer that returns a non-64-byte signature (DER / digest blob)', async () => {
		await expect(mintEnvelope(baseInput, { kid: 'bad', sign: () => new Uint8Array(70) })).rejects.toThrow(/64-byte/)
	})
})

/**
 * v0.2 WIRE-SHAPE GUARD (CP1) — the new per-field compliance vocabulary + compensation fact
 * must reach the SIGNED canonical bytes.
 *
 * `buildPayload` (signer.ts) enumerates content fields explicitly with NO spread, but copies
 * `expert`/`author` BY REFERENCE — so nested additions (`credentials[].complianceClass`/
 * `claimBearing`/`cardLabel`, `expert.compensationCue`/`bio`, `author.photoUrl`/`bio`) ride into
 * the JCS bytes for free. This is exactly why nesting-under-`expert` (vs a top-level `CertContent`
 * field a no-spread `buildPayload` would silently DROP) is the correct v0.2 placement. If a future
 * refactor stops copying `expert` by reference, these assertions red — that is the guard.
 */
describe('v0.2 wire-shape: nested compliance fields ride into the signed bytes (CP1 guard)', () => {
	const v02Input: MintPayloadInput = {
		...baseInput,
		certId: 'cert_v0_2_wire',
		facts: {
			...baseInput.facts,
			expert: {
				displayName: 'Dr. Jane Doe',
				credentials: [
					{
						abbreviation: 'RDN',
						fullName: 'Registered Dietitian Nutritionist',
						cardLabel: 'RD',
						complianceClass: 'gated',
						claimBearing: true,
					},
				],
				profileUrl: 'https://certrev.com/experts/jane',
				photoUrl: null,
				bio: 'Board-certified reviewer.',
				background: null,
				compensationCue: 'Compensated expert',
			},
			author: { name: 'Brand Team', title: null, photoUrl: null, bio: 'Editorial staff.' },
		},
	}

	it('mintEnvelope carries complianceClass/claimBearing/cardLabel + compensationCue/bio on content.expert.*', async () => {
		const { privateKey } = generateKeyPairSync('ed25519')
		const envelope = await mintEnvelope(v02Input, {
			kid: 'local-test-key',
			sign: localEd25519Signer(privateKey),
			signedAt: v02Input.lifecycle.issuedAt,
		})

		// Structural: the nested v0.2 fields survive buildPayload onto the verified payload shape.
		const cred = envelope.payload.content.expert.credentials[0]
		expect(cred.complianceClass).toBe('gated')
		expect(cred.claimBearing).toBe(true)
		expect(cred.cardLabel).toBe('RD')
		expect(envelope.payload.content.expert.compensationCue).toBe('Compensated expert')
		expect(envelope.payload.content.expert.bio).toBe('Board-certified reviewer.')
		expect(envelope.payload.content.author.photoUrl).toBe(null)
		expect(envelope.payload.content.author.bio).toBe('Editorial staff.')

		// The load-bearing assertion: the fields are present in the EXACT canonical bytes that were
		// signed (not just on the JS object). Decode the very bytes mintEnvelope passed to the signer.
		const signedCanonical = new TextDecoder().decode(canonicalPayloadBytes(envelope.payload))
		expect(signedCanonical).toContain('"complianceClass":"gated"')
		expect(signedCanonical).toContain('"claimBearing":true')
		expect(signedCanonical).toContain('"cardLabel":"RD"')
		expect(signedCanonical).toContain('"compensationCue":"Compensated expert"')
		expect(signedCanonical).toContain('"bio":"Board-certified reviewer."')
		// Same string as canonicalizeJson of the payload — the two canonicalizers agree.
		expect(signedCanonical).toBe(canonicalizeJson(envelope.payload))
	})
})

/**
 * v0.5 WIRE-SHAPE GUARD (CP2) — the TOP-LEVEL content extensions `articleTitle`/`displayCertId` must
 * reach the SIGNED canonical bytes when supplied, and be OMITTED (byte-identical to a pre-v0.5 envelope)
 * when not. Unlike the nested `expert.*`/`author.*` fields (CP1, copied by reference), a top-level
 * `content` key only rides if `buildPayload` enumerates it — which v0.5 now does with an omit-when-
 * undefined spread mirroring `display`. If a future refactor stops enumerating them the "rides"
 * assertions red; if it stops omitting them the "byte-identical" assertion reds.
 */
describe('v0.5 wire-shape: top-level articleTitle/displayCertId ride the signed bytes (CP2 guard)', () => {
	it('carries articleTitle/displayCertId on content when supplied — in the exact signed bytes', async () => {
		const { privateKey } = generateKeyPairSync('ed25519')
		const input: MintPayloadInput = {
			...baseInput,
			certId: 'cert_v0_5_wire',
			facts: { ...baseInput.facts, articleTitle: 'Shea Butter: Evidence & Sourcing', displayCertId: 'CR-2026-BEE1' },
		}
		const envelope = await mintEnvelope(input, {
			kid: 'local-test-key',
			sign: localEd25519Signer(privateKey),
			signedAt: input.lifecycle.issuedAt,
		})

		expect(envelope.payload.content.articleTitle).toBe('Shea Butter: Evidence & Sourcing')
		expect(envelope.payload.content.displayCertId).toBe('CR-2026-BEE1')
		// The load-bearing assertion: the fields are present in the EXACT canonical bytes that were signed.
		const signedCanonical = new TextDecoder().decode(canonicalPayloadBytes(envelope.payload))
		expect(signedCanonical).toContain('"articleTitle":"Shea Butter: Evidence & Sourcing"')
		expect(signedCanonical).toContain('"displayCertId":"CR-2026-BEE1"')
		expect(signedCanonical).toBe(canonicalizeJson(envelope.payload))
	})

	it('OMITS the keys entirely when not supplied — byte-identical to a pre-v0.5 envelope', () => {
		// baseInput sets neither field → buildPayload must not emit the keys (never `"articleTitle":null`).
		const payload = buildPayload(baseInput)
		expect('articleTitle' in payload.content).toBe(false)
		expect('displayCertId' in payload.content).toBe(false)
		const canonical = canonicalizeJson(payload)
		expect(canonical).not.toContain('articleTitle')
		expect(canonical).not.toContain('displayCertId')
	})
})

/**
 * v0.2 DISPLAY EVICTION — a mint with `facts.display` OMITTED produces canonical bytes carrying
 * NO `display` key, and still VERIFIES + RENDERS under the kernel. Proves the never-write behavior
 * (`buildPayload` omits the key rather than emitting `display: undefined`) end-to-end.
 */
describe('v0.2 display eviction: display-absent mint verifies + renders with no display key', () => {
	// baseInput WITHOUT facts.display — the never-write shape a v0.2 issuer emits.
	const displayAbsentInput: MintPayloadInput = (() => {
		const { display: _evicted, ...factsWithoutDisplay } = baseInput.facts
		return { ...baseInput, certId: 'cert_display_absent', facts: factsWithoutDisplay }
	})()

	it('canonical bytes carry no "display" key and the kernel renders the verified payload', async () => {
		const { publicKey, privateKey } = generateKeyPairSync('ed25519')
		const kid = 'local-test-key'
		const envelope = await mintEnvelope(displayAbsentInput, {
			kid,
			sign: localEd25519Signer(privateKey),
			signedAt: displayAbsentInput.lifecycle.issuedAt,
		})

		// No `display` KEY anywhere in content (match the key, NOT the "displayName" substring).
		expect(envelope.payload.content).not.toHaveProperty('display')
		const signedCanonical = new TextDecoder().decode(canonicalPayloadBytes(envelope.payload))
		expect(signedCanonical).not.toContain('"display":')
		// displayName is still present — the eviction drops the config block, not the identity field.
		expect(signedCanonical).toContain('"displayName":"Dr. Signer"')

		// Still verifies + renders under the v0.2 kernel (a valid facts-only envelope).
		const spkiBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
		const resolveKid: ResolvePublicKeyByKid = (k) => (k === kid ? { format: 'spki-base64', base64: spkiBase64 } : null)
		const verdict = await verifyEnvelope(envelope, resolveKid, {
			platform: 'shopify',
			externalId: 'gid://shopify/Article/999',
			liveContentHash: 'e'.repeat(64),
			now: new Date('2026-06-22T00:00:00.000Z'),
		})
		expect(verdict.decision).toBe('render')
		if (verdict.decision === 'render') expect(verdict.payload.certId).toBe('cert_display_absent')
	})
})

describe('PHP cross-verify fixture is internally consistent (TS side of the cross-language proof)', () => {
	const fx = JSON.parse(readFileSync(join(__dirname, 'php-crossverify-fixture.json'), 'utf8')) as {
		kid: string
		publicKeyRawBase64: string
		canonical: string
		canonicalHex: string
		envelope: { payload: CertPayload; signature: { sig: string } }
	}

	it('the fixture payload canonicalizes to the recorded JCS string + bytes', () => {
		expect(canonicalizeJson(fx.envelope.payload)).toBe(fx.canonical)
		expect(Buffer.from(canonicalPayloadBytes(fx.envelope.payload)).toString('hex')).toBe(fx.canonicalHex)
	})

	it('the recorded raw public key + signature verify the fixture envelope', async () => {
		// Reconstruct the public key from the 32 raw bytes the PHP test uses, prove the TS
		// kernel reaches the SAME verify result PHP will.
		const rawPub = new Uint8Array(Buffer.from(fx.publicKeyRawBase64, 'base64'))
		expect(rawPub.length).toBe(32)
		const resolveKid: ResolvePublicKeyByKid = (k) => (k === fx.kid ? { format: 'raw', bytes: rawPub } : null)
		const verdict = await verifyEnvelope(fx.envelope, resolveKid, {
			platform: 'wordpress',
			externalId: '4242',
			liveContentHash: 'd'.repeat(64),
			now: new Date('2026-06-22T00:00:00.000Z'),
		})
		expect(verdict.decision).toBe('render')
	})
})

describe('canonicalPayloadBytes: cross-language number safety guard', () => {
	it('accepts the safe-integer envelope payload (the real shape)', () => {
		const payload = buildPayload(baseInput)
		expect(() => canonicalPayloadBytes(payload)).not.toThrow()
	})

	it('throws on an integer beyond the IEEE-754 safe range (PHP/Go would diverge)', () => {
		const payload = buildPayload(baseInput)
		// 2^53 is the first integer a double cannot represent exactly → TS canonicalizes it
		// differently than a big-int JSON encoder would, so the signature wouldn't verify cross-language.
		const tampered = { ...payload, lifecycle: { ...payload.lifecycle, revision: 2 ** 53 } } as CertPayload
		expect(() => canonicalPayloadBytes(tampered)).toThrow(/safe integer/)
	})

	it('throws on a fractional number in the signed payload', () => {
		const payload = buildPayload(baseInput)
		const tampered = { ...payload, lifecycle: { ...payload.lifecycle, revision: 1.5 } } as CertPayload
		expect(() => canonicalPayloadBytes(tampered)).toThrow(/safe integer/)
	})

	it('reports the JSON path of the offending number', () => {
		const payload = buildPayload(baseInput)
		const tampered = { ...payload, lifecycle: { ...payload.lifecycle, revision: 2 ** 53 } } as CertPayload
		expect(() => canonicalPayloadBytes(tampered)).toThrow(/\$\.lifecycle\.revision/)
	})
})
