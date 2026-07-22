/**
 * Generates `php-crossverify-fixture.json` — a TS-PRODUCED, Ed25519-SIGNED envelope
 * the PHP verifier test consumes to prove cross-language signature verification.
 *
 * It uses a FIXED, in-repo Ed25519 key pair (NOT the live KMS root — this fixture is a
 * pure cross-language verify proof, checked into the repo, so it must be deterministic
 * and carry its own public key). The PHP test:
 *   1. canonicalizes `payload` with Certrev_JCS, asserts the bytes == `canonicalHex`,
 *   2. sodium_crypto_sign_verify_detached(sig, canonicalBytes, publicKey) === true.
 *
 * Run: node src/__tests__/generate-php-fixture.mjs
 */
import { createHash, sign as nodeSign } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import canonicalize from 'canonicalize'

const __dirname = dirname(fileURLToPath(import.meta.url))

// A FIXED seed so the keypair (and thus the signature) is deterministic across runs.
// 32-byte Ed25519 seed → PKCS#8 private key. We build the PKCS#8 DER by hand from the
// seed (Ed25519 PKCS#8 = fixed 16-byte prefix + 32-byte seed).
const SEED = Buffer.from('cert-contract-php-crossverify-fix0', 'utf8').subarray(0, 32) // 32 bytes
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex') // Ed25519 PKCS#8 v1 header
const pkcs8 = Buffer.concat([PKCS8_PREFIX, SEED])
const { createPrivateKey, createPublicKey } = await import('node:crypto')
const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
const publicKey = createPublicKey(privateKey)

// Raw 32-byte public key (the last 32 bytes of the SPKI DER) for sodium verify in PHP.
const spkiDer = publicKey.export({ format: 'der', type: 'spki' })
const rawPublic = Buffer.from(spkiDer).subarray(spkiDer.length - 32)

// A representative CertPayload — exercises unicode, nulls, nested arrays/objects.
const payload = {
	contractVersion: 1,
	certId: 'cert_php_crossverify_001',
	subject: {
		platform: 'wordpress',
		externalId: '4242',
		logicalArticleId: 'art_php_xverify',
		canonicalUrls: ['https://brand.example.com/2026/06/shea-butter', 'https://brand.example.com/fr/beurre'],
		installationId: 'wpconn_77',
		contentDigest: 'd'.repeat(64),
	},
	content: {
		expert: {
			displayName: 'Dr. Élodie Müller',
			credentials: [
				{ abbreviation: 'MD', fullName: 'Doctor of Medicine' },
				{ abbreviation: 'PhD', fullName: 'Doctor of Philosophy' },
			],
			profileUrl: 'https://certrev.com/experts/elodie',
			photoUrl: null,
		},
		author: { name: 'Brand Team', title: null },
		memo: 'Verified across languages. 世界 → café ✅',
		certifiedAt: '2026-06-21T12:00:00.000Z',
		contentModifiedAt: null,
		verifyUrl: 'https://certrev.com/verify/cert_php_crossverify_001',
		display: { accentColor: '#0a0', showExpertPhoto: true, badgeStyle: 'full' },
		// v0.5 (POR-10481): the top-level content extensions, exercised cross-language. `articleTitle`
		// sorts before `author`; `displayCertId` after `display`. The curly apostrophe (U+2019) + CJK pin
		// that the PHP/Go JCS twin emits non-ASCII as RAW UTF-8 (RFC 8785 minimal escaping — only control
		// chars, '"' and '\' escaped), NOT \uXXXX, and sorts keys by UTF-16 code unit.
		articleTitle: 'Shea Butter: a reviewer’s evidence & sourcing note. 世界',
		displayCertId: 'CR-2026-7A2F',
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
const rawSig = nodeSign(null, canonicalBytes, privateKey) // raw 64-byte Ed25519 sig
const sigBase64url = Buffer.from(rawSig).toString('base64url')

const kid = 'php-crossverify-fixed-key-v1'
const out = {
	$comment:
		'TS-produced Ed25519 signature over RFC-8785 JCS(payload) of a CertPayload, for the PHP cross-language verify test. The PHP test re-canonicalizes payload, asserts bytes==canonicalHex, then sodium_crypto_sign_verify_detached(base64url-decode(signature.sig), canonicalBytes, base64-decode(publicKeyRawBase64)).',
	kid,
	publicKeyRawBase64: Buffer.from(rawPublic).toString('base64'),
	publicKeySpkiBase64: Buffer.from(spkiDer).toString('base64'),
	canonical,
	canonicalHex,
	sha256,
	envelope: {
		payload,
		signature: { alg: 'ed25519', kid, sig: sigBase64url, signedAt: '2026-06-21T12:00:00.000Z' },
	},
}

writeFileSync(join(__dirname, 'php-crossverify-fixture.json'), `${JSON.stringify(out, null, '\t')}\n`)
console.log('wrote php-crossverify-fixture.json')
console.log('  canonical sha256:', sha256)
console.log('  sig (base64url) :', sigBase64url)
console.log('  rawPublic (b64) :', Buffer.from(rawPublic).toString('base64'))
