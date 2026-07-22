/**
 * Generates `kms-crossverify-fixture.json` — a fixture signed by the LIVE GCP KMS root,
 * for the PHP test to verify against the REAL key (not just the in-repo fixture key).
 *
 * This closes the full triangle:
 *   TS canonical bytes  ==  PHP canonical bytes  ==  bytes the live KMS key signed,
 *   verified by BOTH the TS VerdictKernel AND PHP libsodium.
 *
 * Run (requires gcloud auth to portal-486217):
 *   node src/__tests__/generate-kms-php-fixture.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import canonicalize from 'canonicalize'

const __dirname = dirname(fileURLToPath(import.meta.url))

const KID =
	'projects/portal-486217/locations/global/keyRings/certrev-signing/cryptoKeys/cert-envelope-issuer/cryptoKeyVersions/1'
// Raw 32-byte public key = last 32 bytes of the live SPKI DER (base64 below).
const SPKI_BASE64 = 'MCowBQYDK2VwAyEAMWN956IOPjpAq900dL428VzA28TO/pVXnq3brwqUmwM='

const payload = {
	contractVersion: 1,
	certId: 'cert_kms_php_xverify_001',
	subject: {
		platform: 'wordpress',
		externalId: '90210',
		logicalArticleId: 'art_kms_php',
		canonicalUrls: ['https://brand.example.com/2026/06/retinol'],
		installationId: 'wpconn_kms',
		contentDigest: 'a1b2c3'.padEnd(64, '0'),
	},
	content: {
		expert: {
			displayName: 'Dr. Triangle Proof',
			credentials: [{ abbreviation: 'MD', fullName: 'Doctor of Medicine' }],
			profileUrl: 'https://certrev.com/experts/triangle',
			photoUrl: null,
		},
		author: { name: 'CertREV', title: null },
		memo: 'Signed by live GCP KMS, verified in PHP. 世界 🎯 café',
		certifiedAt: '2026-06-21T12:00:00.000Z',
		contentModifiedAt: null,
		verifyUrl: 'https://certrev.com/verify/cert_kms_php_xverify_001',
		display: { accentColor: '#0a0', showExpertPhoto: true, badgeStyle: 'full' },
	},
	lifecycle: {
		issuedAt: '2026-06-21T12:00:00.000Z',
		expiresAt: '2099-01-01T00:00:00.000Z',
		revokedAt: null,
		revision: 1,
	},
}

const canonical = canonicalize(payload)
const canonicalBytes = new TextEncoder().encode(canonical)
const canonicalHex = Buffer.from(canonicalBytes).toString('hex')
const sha256 = createHash('sha256').update(canonicalBytes).digest('hex')

// Sign the canonical bytes with the LIVE GCP KMS key (PureEdDSA, no digest).
const dir = mkdtempSync(join(tmpdir(), 'kms-php-fixture-'))
const bytesFile = join(dir, 'canonical.bin')
const sigFile = join(dir, 'sig.bin')
writeFileSync(bytesFile, Buffer.from(canonicalBytes))
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
const rawSig = readFileSync(sigFile)
if (rawSig.length !== 64) throw new Error(`expected 64-byte sig, got ${rawSig.length}`)
const sigBase64url = Buffer.from(rawSig).toString('base64url')

// Raw 32-byte public key from the live SPKI.
const spkiDer = Buffer.from(SPKI_BASE64, 'base64')
const rawPublic = spkiDer.subarray(spkiDer.length - 32)

const out = {
	$comment:
		'Live GCP KMS-signed fixture (kid = cert-envelope-issuer v1). PHP verifies this against the REAL signing root: re-canonicalize payload, assert bytes==canonicalHex, sodium_crypto_sign_verify_detached(sig, bytes, rawPublic).',
	kid: KID,
	publicKeyRawBase64: Buffer.from(rawPublic).toString('base64'),
	publicKeySpkiBase64: SPKI_BASE64,
	canonical,
	canonicalHex,
	sha256,
	envelope: {
		payload,
		signature: { alg: 'ed25519', kid: KID, sig: sigBase64url, signedAt: new Date().toISOString() },
	},
}

writeFileSync(join(__dirname, 'kms-crossverify-fixture.json'), `${JSON.stringify(out, null, '\t')}\n`)
console.log('wrote kms-crossverify-fixture.json')
console.log('  canonical sha256:', sha256)
console.log('  KMS sig (b64url):', sigBase64url)
