/**
 * Mock facts + a SIGNED envelope fixture for unit tests + local dev.
 *
 * `makeMockPayload` returns a complete, well-formed `CertPayload` (override any field).
 * `makeSignedEnvelope` generates an ephemeral Ed25519 keypair, signs the payload's RFC-
 * 8785 canonical bytes, and returns `{ envelope, resolveKid, publicKey }` so a test can
 * run the FULL kernel pipeline (real signature verification) against the fixture — no
 * mocking of the crypto.
 *
 * These helpers depend on Node's `crypto` (for keygen + signing on the ISSUER side, which
 * tests stand in for). The SDK's RUNTIME never signs — it only verifies — so this stays
 * test/dev-only and is not part of the public render API.
 *
 * The fixture signs over `canonicalPayloadBytes` from `@certrev/cert-contract` (RFC 8785),
 * the SAME bytes the real kernel recomputes on verify — so a fixture envelope verifies
 * end-to-end under the production `verifyEnvelope`, not a stand-in canonicalizer.
 */

import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import type {
	CertDeliveryEnvelope,
	CertPayload,
	Ed25519PublicKeyInput,
	ResolvePublicKeyByKid,
} from '@certrev/cert-contract'
// SIGN is Node-only and lives on the contract's signer subpath. Fixtures are themselves
// Node-only (they stand in for the issuer) and ship from the './fixtures' subpath, so the
// SDK's edge-safe main entry never pulls a Node builtin.
import { signPayloadEd25519 } from '@certrev/cert-contract/signer'

const FIXTURE_KID = 'certrev-fixture-key-1'

/** Build a complete mock payload. Pass overrides to exercise specific render branches. */
export function makeMockPayload(overrides: Partial<CertPayload> = {}): CertPayload {
	const base: CertPayload = {
		contractVersion: 1,
		certId: 'cert_fixture_001',
		subject: {
			platform: 'shopify',
			externalId: 'gid://shopify/Article/123456789',
			logicalArticleId: 'art_logical_abc',
			canonicalUrls: ['https://brand.example.com/blogs/skincare/retinol-guide'],
			installationId: 'inst_shopify_42',
			contentDigest: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
		},
		content: {
			expert: {
				displayName: 'Dr. Jane Doe',
				credentials: [
					{ abbreviation: 'MD', fullName: 'Doctor of Medicine' },
					{ abbreviation: 'FAAD', fullName: 'Fellow of the American Academy of Dermatology' },
				],
				profileUrl: 'https://certrev.com/experts/jane-doe',
				photoUrl: 'https://cdn.certrev.com/experts/jane-doe.jpg',
			},
			author: { name: 'Sam Writer', title: 'Senior Content Editor' },
			memo: 'I reviewed the retinol claims against current dermatology guidance; the concentrations and usage cadence cited are accurate and safely framed.',
			certifiedAt: '2026-06-21T15:30:00.000Z',
			contentModifiedAt: '2026-06-20T09:00:00.000Z',
			verifyUrl: 'https://certrev.com/verify/cert_fixture_001',
			display: {
				accentColor: '#7c3aed',
				showExpertPhoto: true,
				showAuthor: true,
				showMemo: true,
				badgeStyle: 'full',
			},
		},
		lifecycle: {
			issuedAt: '2026-06-21T15:30:00.000Z',
			expiresAt: '2099-01-01T00:00:00.000Z',
			revokedAt: null,
			revision: 1,
		},
		...overrides,
	}
	return base
}

export interface SignedEnvelopeFixture {
	readonly envelope: CertDeliveryEnvelope
	readonly resolveKid: ResolvePublicKeyByKid
	readonly publicKey: KeyObject
	readonly kid: string
}

/**
 * Generate a fresh keypair, sign the payload, and return everything a test needs to run
 * the kernel against a genuinely-valid envelope. The returned `resolveKid` resolves only
 * the fixture kid (any other kid → null → 'unknown_key').
 */
export function makeSignedEnvelope(overrides: Partial<CertPayload> = {}, kid = FIXTURE_KID): SignedEnvelopeFixture {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519')
	const payload = makeMockPayload(overrides)
	// Sign the RFC-8785 canonical bytes via the contract's signer — the SAME bytes the
	// edge-safe kernel recomputes on verify, so the fixture verifies end-to-end.
	const sig = signPayloadEd25519(payload, privateKey)

	const envelope: CertDeliveryEnvelope = {
		payload,
		signature: { alg: 'ed25519', kid, sig, signedAt: payload.lifecycle.issuedAt },
	}

	const spkiBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
	const keyInput: Ed25519PublicKeyInput = { format: 'spki-base64', base64: spkiBase64 }
	const resolveKid: ResolvePublicKeyByKid = (k) => (k === kid ? keyInput : null)

	return { envelope, resolveKid, publicKey, kid }
}

export { FIXTURE_KID }
