import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type ResolvePublicKeyByKid, verifyEnvelope } from '../kernel.js'
import { type MintPayloadInput, mintEnvelope, type SignBytes } from '../signer.js'

/**
 * Part B END-TO-END PROOF through the SIGNER MODULE: facts → mintEnvelope (JCS) →
 * REAL GCP KMS sign → verify with the TS VerdictKernel + the live SPKI public key.
 *
 * This is the signer-module-shaped counterpart to `real-sign-kms.test.ts`: instead of
 * hand-rolling the envelope, it drives the production `mintEnvelope` pipeline with a
 * `SignBytes` binding that shells out to `gcloud kms asymmetric-sign` against the LIVE
 * key (PureEdDSA, no digest, raw 64-byte output). Conditional on gcloud reachability —
 * a config-gated skip, never a flaky one.
 */

const KID =
	'projects/portal-486217/locations/global/keyRings/certrev-signing/cryptoKeys/cert-envelope-issuer/cryptoKeyVersions/1'

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAMWN956IOPjpAq900dL428VzA28TO/pVXnq3brwqUmwM=
-----END PUBLIC KEY-----`

function kmsAvailable(): boolean {
	try {
		execFileSync(
			'gcloud',
			[
				'kms',
				'keys',
				'versions',
				'describe',
				'1',
				'--key',
				'cert-envelope-issuer',
				'--keyring',
				'certrev-signing',
				'--location',
				'global',
				'--project',
				'portal-486217',
				'--format',
				'value(state)',
			],
			{ stdio: ['ignore', 'pipe', 'ignore'] },
		)
		return true
	} catch {
		return false
	}
}

/** A `SignBytes` that signs canonical bytes with the LIVE GCP KMS key via the gcloud CLI. */
const gcloudKmsSigner: SignBytes = (bytes) => {
	const dir = mkdtempSync(join(tmpdir(), 'cert-signer-kms-'))
	const bytesFile = join(dir, 'canonical.bin')
	const sigFile = join(dir, 'sig.bin')
	writeFileSync(bytesFile, Buffer.from(bytes))
	execFileSync(
		'gcloud',
		[
			'kms',
			'asymmetric-sign',
			'--version',
			'1',
			'--key',
			'cert-envelope-issuer',
			'--keyring',
			'certrev-signing',
			'--location',
			'global',
			'--project',
			'portal-486217',
			'--input-file',
			bytesFile,
			'--signature-file',
			sigFile,
		],
		{ stdio: ['ignore', 'ignore', 'inherit'] },
	)
	return new Uint8Array(readFileSync(sigFile))
}

const input: MintPayloadInput = {
	certId: 'cert_signer_kms_001',
	subject: {
		platform: 'shopify',
		externalId: 'gid://shopify/Article/13371337',
		logicalArticleId: 'art_signer_kms',
		canonicalUrls: ['https://brand.example.com/blogs/news/signer-kms'],
		installationId: 'inst_signer_kms',
		contentDigest: 'f'.repeat(64),
	},
	facts: {
		expert: {
			displayName: 'Dr. Real KMS',
			credentials: [{ abbreviation: 'MD', fullName: 'Doctor of Medicine' }],
			profileUrl: 'https://certrev.com/experts/realkms',
			photoUrl: null,
		},
		author: { name: 'CertREV', title: null },
		memo: 'Minted through the signer module, signed by the live GCP KMS root. 世界 🎯',
		certifiedAt: '2026-06-21T12:00:00.000Z',
		contentModifiedAt: null,
		verifyUrl: 'https://certrev.com/verify/cert_signer_kms_001',
		display: { badgeStyle: 'full', showExpertPhoto: true },
	},
	lifecycle: {
		issuedAt: '2026-06-21T12:00:00.000Z',
		expiresAt: '2099-01-01T00:00:00.000Z',
		revokedAt: null,
		revision: 1,
	},
}

const resolveKid: ResolvePublicKeyByKid = (kid) =>
	kid === KID ? ({ format: 'pem', pem: PUBLIC_KEY_PEM } as const) : null
const RUN = kmsAvailable()

describe.runIf(RUN)('signer module → live GCP KMS → VerdictKernel (Part B end-to-end)', () => {
	it('mintEnvelope + KMS signer produces an envelope the kernel renders', async () => {
		const envelope = await mintEnvelope(input, { kid: KID, sign: gcloudKmsSigner })
		expect(envelope.signature.alg).toBe('ed25519')
		expect(envelope.signature.kid).toBe(KID)
		expect(envelope.signature.sig).toMatch(/^[A-Za-z0-9_-]{86}$/) // 64 raw bytes, base64url

		const verdict = await verifyEnvelope(envelope, resolveKid, {
			platform: 'shopify',
			externalId: 'gid://shopify/Article/13371337',
			liveContentHash: 'f'.repeat(64),
			now: new Date('2026-06-22T00:00:00.000Z'),
		})
		expect(verdict.decision).toBe('render')
		if (verdict.decision === 'render') expect(verdict.payload.certId).toBe('cert_signer_kms_001')
	}, 30_000)

	it('a drifted live content hash suppresses the KMS-signed envelope', async () => {
		const envelope = await mintEnvelope(input, { kid: KID, sign: gcloudKmsSigner })
		const verdict = await verifyEnvelope(envelope, resolveKid, {
			platform: 'shopify',
			externalId: 'gid://shopify/Article/13371337',
			liveContentHash: '0'.repeat(64), // != subject.contentDigest
			now: new Date('2026-06-22T00:00:00.000Z'),
		})
		expect(verdict).toEqual({ decision: 'suppress', reason: 'content_drift' })
	}, 30_000)
})

if (!RUN) {
	describe('signer module → live GCP KMS → VerdictKernel (Part B end-to-end)', () => {
		it.skip('skipped — gcloud KMS not reachable (no auth / not installed)', () => {})
	})
}
