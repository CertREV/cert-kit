import { createHash, createPrivateKey, type KeyObject, sign as nodeSign } from 'node:crypto'
import { base64urlEncode } from './base64.js'
import { canonicalBytes, canonicalPayloadBytes, canonicalTombstoneBytes } from './canonical.js'
import {
	type CertContent,
	type CertDeliveryEnvelope,
	type CertLifecycle,
	type CertPayload,
	type CertSignature,
	type CertSubject,
	type CertTombstone,
	type CertTombstoneSignable,
	CONTRACT_VERSION,
	SIGNATURE_ALG,
	type SignatureAlg,
} from './types.js'

// Re-exported on the signer subpath so issuer-side callers get the `sig` wire encoder
// without reaching into the base64 module. (Was `base64urlEncodeSig` on the old main entry.)
export { base64urlEncode } from './base64.js'

/**
 * The ISSUER side of the contract — the counterpart to the VerdictKernel.
 *
 * NODE-ONLY. This module is published on the `@certrev/cert-contract/signer` subpath, NOT
 * the main entry, because it imports `node:crypto` (Ed25519 keygen/sign + SHA-256). The
 * issuer (portal) runs in Node; the render edges (which only VERIFY) never import this, so
 * the main entry stays edge-runtime safe. SHA-256 (`sha256Hex`/`sha256OfCanonical`) lives
 * here for the same reason — only the issuer computes `subject.contentDigest`.
 *
 * THE PIPELINE (the only shape the issuer is allowed to mint through):
 *   assemble FACTS → buildPayload → canonicalPayloadBytes (RFC-8785 JCS) → sign →
 *   assembleEnvelope.
 *
 * Two design rules this module enforces structurally:
 *
 *   1. SIGN FACTS, NOT RENDERED JSON-LD. `assembleCertFacts` takes the structured
 *      facts (expert, author, memo, dates, verifyUrl, display) and the identity
 *      binding; the JSON-LD is NEVER part of the payload, so schema.org churn never
 *      forces a re-sign.
 *
 *   2. THE SIGNATURE IS DETACHED Ed25519 OVER canonicalPayloadBytes(payload). The
 *      bytes are produced by the SAME canonicalizer the kernel verifies against
 *      (`canonical.ts`), so the issuer and every edge — TS, PHP, Go — hash byte-
 *      identical input. The signer is PLUGGABLE (`SignBytes`): a local Node key for
 *      tests, GCP KMS `asymmetric-sign` in production, the gcloud CLI for a local
 *      real-key proof. The raw-64-byte Ed25519 signature is identical whichever signs.
 */

// ── Facts in → payload out ───────────────────────────────────────────────────────

/** The structured FACTS an issuer assembles a credential from. Mirrors `CertContent`
 *  exactly — this is the "what the expert certified" half, free of identity/lifecycle. */
export interface CertFacts {
	readonly expert: CertContent['expert']
	readonly author: CertContent['author']
	readonly memo: string | null
	readonly certifiedAt: string
	readonly contentModifiedAt: string | null
	readonly verifyUrl: string
	/** @deprecated v0.2 — OPTIONAL: presentation evicted to `brand_render_defs`. The issuer
	 *  no longer assembles a `display` block; when absent, `buildPayload` omits it so the
	 *  signed bytes carry no `display` key. Kept optional so old callers still verify. */
	readonly display?: CertContent['display']
	/** v0.5 (POR-10481) — the certified article's TITLE (the certificate modal's "Certifies the
	 *  article" block). Optional + omit-when-undefined: a mint that doesn't set it stays BYTE-IDENTICAL
	 *  to a pre-v0.5 envelope; a mint that sets it carries the key on the signed `content`. */
	readonly articleTitle?: string | null
	/** v0.5 (POR-10481) — a display-only pretty cert id (`CR-YYYY-NNNN`) for the modal meta row: a
	 *  deterministic derivation of `certId`+year, NOT a second identity (verifyUrl is the real link).
	 *  Same omit-when-undefined byte-neutrality as `articleTitle`. */
	readonly displayCertId?: string | null
}

/** Everything needed to mint a payload: the stable identity binding (subject), the
 *  certified facts (content), and the validity window (lifecycle). */
export interface MintPayloadInput {
	readonly certId: string
	readonly subject: CertSubject
	readonly facts: CertFacts
	readonly lifecycle: CertLifecycle
}

/** Assemble the unsigned `CertPayload` from facts + identity + lifecycle. Pure +
 *  deterministic; this is the value that gets canonicalized and signed. */
export function buildPayload(input: MintPayloadInput): CertPayload {
	const content: CertContent = {
		expert: input.facts.expert,
		author: input.facts.author,
		memo: input.facts.memo,
		certifiedAt: input.facts.certifiedAt,
		contentModifiedAt: input.facts.contentModifiedAt,
		verifyUrl: input.facts.verifyUrl,
		// v0.2 display eviction: include `display` ONLY when the caller still supplies it, so
		// a NEW (never-write) mint omits the key entirely (its canonical bytes carry no
		// `display`), while a legacy caller passing `display` produces BYTE-IDENTICAL content
		// to v0.1.x. Never emit `display: undefined` — that would depend on the canonicalizer
		// dropping undefined keys; omitting the property is unconditionally correct.
		...(input.facts.display !== undefined ? { display: input.facts.display } : {}),
		// v0.5 (POR-10481): thread the two TOP-LEVEL content extensions onto the signed bytes. Like
		// `display` above, OMIT-when-undefined so a mint that doesn't populate them stays byte-identical
		// to a pre-v0.5 envelope; only a mint that supplies them carries the keys. (Nested expert.*/
		// author.* extensions ride for free via the wholesale object copy above; a top-level key must be
		// enumerated here or it is silently dropped before signing.)
		...(input.facts.articleTitle !== undefined ? { articleTitle: input.facts.articleTitle } : {}),
		...(input.facts.displayCertId !== undefined ? { displayCertId: input.facts.displayCertId } : {}),
	}
	return {
		contractVersion: CONTRACT_VERSION,
		certId: input.certId,
		subject: input.subject,
		content,
		lifecycle: input.lifecycle,
	}
}

// ── SHA-256 (issuer-side; Node `createHash`) ──────────────────────────────────────
// Lives here, NOT on the main entry, because it uses `node:crypto`. Only the issuer
// computes content digests; the VERIFY path takes a pre-computed `liveContentHash` string.

/** Lowercase hex SHA-256 of arbitrary bytes. */
export function sha256Hex(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex')
}

/** Lowercase hex SHA-256 over the canonical bytes of a JSON value — the content-digest
 *  primitive used for `subject.contentDigest` and the golden vectors. */
export function sha256OfCanonical(value: unknown): string {
	return sha256Hex(canonicalBytes(value))
}

/** Lowercase hex SHA-256 over the canonicalized reviewed body — the value that becomes
 *  `subject.contentDigest`. The edge recomputes this over the LIVE body and the kernel
 *  suppresses on mismatch (drift). Exposed so the issuer and the edge compute the
 *  anti-drift anchor identically. */
export function computeContentDigest(canonicalBody: unknown): string {
	return sha256OfCanonical(canonicalBody)
}

// ── Ed25519 detached signing over JCS(payload) — for tests + local (non-KMS) signers ──

/**
 * Ed25519-sign the canonical bytes of `payload` with a Node Ed25519 private key.
 * Returns the base64url detached signature. The live issuer signs with GCP KMS
 * instead (which produces the identical raw 64-byte signature over the same bytes);
 * this helper exists for tests and for any signer holding a local key. (Moved here from
 * the kernel: signing is issuer-side and `nodeSign` is `node:crypto`, which must not
 * reach the edge-safe main entry.)
 */
export function signPayloadEd25519(payload: CertPayload, privateKey: KeyObject): string {
	const bytes = canonicalPayloadBytes(payload)
	const sig = nodeSign(null, bytes, privateKey)
	return base64urlEncode(new Uint8Array(sig))
}

// ── Pluggable signer ─────────────────────────────────────────────────────────────

/**
 * Signs the canonical payload bytes and returns the RAW 64-byte Ed25519 signature.
 * Implementations:
 *   - local Node key  → `nodeSign(null, bytes, key)` (see `localEd25519Signer`).
 *   - GCP KMS         → `client.asymmetricSign({ name: kid, data: bytes })` (no digest;
 *                        EC_SIGN_ED25519 is PureEdDSA over the raw input).
 *   - gcloud CLI      → `gcloud kms asymmetric-sign --input-file <bytes> ...`.
 * All three MUST be given the bytes from `canonicalPayloadBytes(payload)` verbatim.
 */
export type SignBytes = (canonicalBytes: Uint8Array) => Promise<Uint8Array> | Uint8Array

/** A local-key signer for tests / non-KMS issuers. Accepts a Node KeyObject or a PEM/DER
 *  private key. Produces the identical raw 64-byte signature GCP KMS would. */
export function localEd25519Signer(privateKey: KeyObject | string): SignBytes {
	const key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey
	return (bytes) => new Uint8Array(nodeSign(null, bytes, key))
}

// ── Mint: facts → canonicalize → sign → envelope ──────────────────────────────────

/**
 * Expected RAW (detached) signature byte length per algorithm — the structural check
 * `mintEnvelope` runs so a KMS/SDK that hands back DER or a digest-signed blob fails at
 * mint rather than shipping a malformed envelope a verifier silently rejects.
 *
 * KEYED BY `SignatureAlg` so a post-quantum migration is ADDITIVE (see the PQ note in
 * types.ts): widening `SignatureAlg` (e.g. `'ml-dsa-65'` → 3309 bytes) means adding ONE
 * entry here and passing `alg` in `SignWith`. The assertion logic never changes; it is no
 * longer a hard-coded `=== 64`. `satisfies` forces every `SignatureAlg` to have a length.
 */
export const RAW_SIGNATURE_BYTE_LENGTHS = {
	ed25519: 64,
} satisfies Record<SignatureAlg, number>

/** What the issuer knows about the signing key + when it signed. */
export interface SignWith {
	/** Key id stamped into `signature.kid`; the verifier's resolver maps it to a public
	 *  key. For the live root this is the GCP KMS cryptoKeyVersion resource name. */
	readonly kid: string
	/** Produces the raw detached signature bytes over the canonical bytes (64 for Ed25519). */
	readonly sign: SignBytes
	/** Signature algorithm. Defaults to `SIGNATURE_ALG` (ed25519); drives both the stamped
	 *  `signature.alg` and the expected raw-signature length. Explicit only for a future
	 *  post-quantum alg — the Ed25519 path is untouched when omitted. */
	readonly alg?: SignatureAlg
	/** ISO-8601 signing time. Defaults to now; injectable for deterministic tests. */
	readonly signedAt?: string
}

/**
 * The one mint path: build the payload from facts, canonicalize it (RFC-8785), sign
 * the canonical bytes with the pluggable signer, and assemble the detached-signature
 * envelope. Asserts the signature is exactly the raw-byte length for `signWith.alg`
 * (64 for Ed25519) — a KMS/SDK that handed back DER or a digest-signed blob would fail
 * here rather than ship a malformed envelope a verifier silently rejects.
 */
export async function mintEnvelope(input: MintPayloadInput, signWith: SignWith): Promise<CertDeliveryEnvelope> {
	const alg: SignatureAlg = signWith.alg ?? SIGNATURE_ALG
	const payload = buildPayload(input)
	const bytes = canonicalPayloadBytes(payload)
	const rawSig = await signWith.sign(bytes)
	const sigBytes = rawSig instanceof Uint8Array ? rawSig : new Uint8Array(rawSig)
	const expectedLength = RAW_SIGNATURE_BYTE_LENGTHS[alg]
	if (sigBytes.length !== expectedLength) {
		throw new Error(
			`cert-contract signer: expected a raw ${expectedLength}-byte ${alg} signature, got ${sigBytes.length} bytes`,
		)
	}
	const signature: CertSignature = {
		alg,
		kid: signWith.kid,
		sig: base64urlEncode(sigBytes),
		signedAt: signWith.signedAt ?? new Date().toISOString(),
	}
	return { payload, signature }
}

// ── Mint: the slim revocation tombstone (POR-10481) ───────────────────────────────

/** The revocation facts a `signTombstone` call binds (the subject is reused verbatim). */
export interface MintTombstoneInput {
	readonly subject: CertSubject
	/** ISO-8601 moment of revocation. */
	readonly revokedAt: string
	/** WHY it was revoked (issuer-domain string; e.g. `cert_revoked`). */
	readonly revocationReason: string
}

/**
 * POR-10481 — mint the SLIM revocation tombstone: assemble the signable fields, canonicalize
 * them (RFC-8785 via `canonicalTombstoneBytes`), sign the canonical bytes with the pluggable
 * signer, and assemble the detached-signature tombstone. Mirrors `mintEnvelope` — same
 * `SignWith`, same raw-signature-length assertion (64 for Ed25519), same signer plug (a local
 * key for tests, GCP KMS in production). Carries NO certified content — a blanked badge must
 * not leak the expert's identity.
 */
export async function signTombstone(input: MintTombstoneInput, signWith: SignWith): Promise<CertTombstone> {
	const alg: SignatureAlg = signWith.alg ?? SIGNATURE_ALG
	const signable: CertTombstoneSignable = {
		kind: 'tombstone',
		contractVersion: CONTRACT_VERSION,
		subject: input.subject,
		revokedAt: input.revokedAt,
		revocationReason: input.revocationReason,
	}
	const bytes = canonicalTombstoneBytes(signable)
	const rawSig = await signWith.sign(bytes)
	const sigBytes = rawSig instanceof Uint8Array ? rawSig : new Uint8Array(rawSig)
	const expectedLength = RAW_SIGNATURE_BYTE_LENGTHS[alg]
	if (sigBytes.length !== expectedLength) {
		throw new Error(
			`cert-contract signer: expected a raw ${expectedLength}-byte ${alg} tombstone signature, got ${sigBytes.length} bytes`,
		)
	}
	const signature: CertSignature = {
		alg,
		kid: signWith.kid,
		sig: base64urlEncode(sigBytes),
		signedAt: signWith.signedAt ?? new Date().toISOString(),
	}
	return { ...signable, signature }
}
