import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { base64urlEncode, type CertPayload, canonicalPayloadBytes, verifyEnvelope } from '../index.js'

/**
 * REAL-SIGN PROOF against the LIVE GCP KMS Ed25519 signing root.
 *
 * Conditional: runs only when `gcloud` is on PATH AND can reach the KMS key version
 * (i.e. an authenticated dev/CI machine). On a machine without gcloud/auth the suite
 * skips — an acceptable config-gated skip (NOT a flaky skip). The deterministic
 * round-trip in kernel.test.ts already covers sign+verify with a generated keypair;
 * this test additionally proves interop with the production KMS key, the real kid, and
 * the real SPKI public key.
 */

const KID =
	'projects/portal-486217/locations/global/keyRings/certrev-signing/cryptoKeys/cert-envelope-issuer/cryptoKeyVersions/1'

// SPKI (PEM) of the live KMS public key (matches gcloud kms keys versions get-public-key).
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

function kmsSign(bytes: Uint8Array): Uint8Array {
	const dir = mkdtempSync(join(tmpdir(), 'cert-realsign-'))
	const bytesFile = join(dir, 'canonical.bin')
	const sigFile = join(dir, 'sig.bin')
	writeFileSync(bytesFile, Buffer.from(bytes))
	// PureEdDSA over the raw input — no --digest flag.
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

function makePayload(): CertPayload {
	return {
		contractVersion: 1,
		certId: 'cert_realproof_001',
		subject: {
			platform: 'shopify',
			externalId: 'gid://shopify/Article/8675309',
			logicalArticleId: 'art_realproof',
			canonicalUrls: ['https://brand.example.com/blogs/news/real-proof'],
			installationId: 'inst_realproof',
			contentDigest: 'c'.repeat(64),
		},
		content: {
			expert: {
				displayName: 'Dr. Real Proof',
				credentials: [{ abbreviation: 'MD', fullName: 'Doctor of Medicine' }],
				profileUrl: 'https://certrev.com/experts/real',
				photoUrl: null,
			},
			author: { name: 'CertREV', title: null },
			memo: 'Signed by the live GCP KMS root. 世界 🎯',
			certifiedAt: '2026-06-21T12:00:00.000Z',
			contentModifiedAt: null,
			verifyUrl: 'https://certrev.com/verify/cert_realproof_001',
			display: { badgeStyle: 'full', showExpertPhoto: true },
		},
		lifecycle: {
			issuedAt: '2026-06-21T12:00:00.000Z',
			expiresAt: '2099-01-01T00:00:00.000Z',
			revokedAt: null,
			revision: 1,
		},
	}
}

const resolveKid = (kid: string) => (kid === KID ? ({ format: 'pem', pem: PUBLIC_KEY_PEM } as const) : null)
const RUN = kmsAvailable()

describe.runIf(RUN)('live GCP KMS real-sign proof', () => {
	it('KMS-signs canonical(payload) and the kernel renders the verified payload', async () => {
		const payload = makePayload()
		const rawSig = kmsSign(canonicalPayloadBytes(payload))
		expect(rawSig.length).toBe(64) // raw Ed25519

		const envelope = {
			payload,
			signature: {
				alg: 'ed25519',
				kid: KID,
				sig: base64urlEncode(rawSig),
				signedAt: new Date().toISOString(),
			} as const,
		}
		const verdict = await verifyEnvelope(envelope, resolveKid, {
			platform: 'shopify',
			externalId: 'gid://shopify/Article/8675309',
			liveContentHash: 'c'.repeat(64),
			now: new Date('2026-06-22T00:00:00.000Z'),
		})
		expect(verdict.decision).toBe('render')
		if (verdict.decision === 'render') {
			expect(verdict.payload.certId).toBe('cert_realproof_001')
		}
	}, 30_000)

	it('a tampered payload with the SAME KMS signature fails closed', async () => {
		const payload = makePayload()
		const rawSig = kmsSign(canonicalPayloadBytes(payload))
		const tampered = {
			payload: { ...payload, certId: 'cert_FORGED_999' },
			signature: {
				alg: 'ed25519',
				kid: KID,
				sig: base64urlEncode(rawSig),
				signedAt: new Date().toISOString(),
			} as const,
		}
		const verdict = await verifyEnvelope(tampered, resolveKid, {
			platform: 'shopify',
			externalId: 'gid://shopify/Article/8675309',
		})
		expect(verdict).toEqual({ decision: 'suppress', reason: 'invalid_signature' })
	}, 30_000)
})

if (!RUN) {
	// Surface the skip reason without failing the suite on machines lacking gcloud/KMS auth.
	describe('live GCP KMS real-sign proof', () => {
		it.skip('skipped — gcloud KMS not reachable (no auth / not installed)', () => {})
	})
}
