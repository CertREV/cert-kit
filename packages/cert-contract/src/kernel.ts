import { base64ToBytes, base64urlDecode, base64urlEncode } from './base64.js'
import { canonicalPayloadBytes, canonicalTombstoneBytes } from './canonical.js'
import {
	type CertDeliveryArtifact,
	type CertDeliveryEnvelope,
	type CertPayload,
	type CertTombstone,
	type CertVerdict,
	CONTRACT_VERSION,
	SIGNATURE_ALG,
} from './types.js'
import type { CryptoKey } from './webcrypto-types.js'

/**
 * The VerdictKernel — the ONE algorithm every render edge runs, fail-closed.
 *
 * EDGE-RUNTIME SAFE. This module imports NO `node:crypto` and uses NO `Buffer`: Ed25519
 * verification goes through the WebCrypto SubtleCrypto API (`crypto.subtle.importKey` +
 * `crypto.subtle.verify`), which exists in Node 20+, Cloudflare Workers, Shopify Oxygen,
 * Vercel Edge, and browsers. The SIGN path (issuer-side, Node-only) lives on the
 * `@certrev/cert-contract/signer` subpath so the main entry never pulls a Node builtin.
 *
 * Pipeline (each step short-circuits to `suppress`):
 *   1. parse + shape-check the envelope; unknown contractVersion → suppress.
 *   2. signature.alg === 'ed25519'                              → else suppress.
 *   3. resolve signature.kid to a public key                    → else suppress.
 *   4. Ed25519-verify(sig) over canonicalize(payload)           → else suppress.
 *   5. subject.platform === edge platform                       → else suppress.
 *   6. subject.externalId === the article being rendered        → else suppress.
 *   7. lifecycle.revokedAt === null AND now < expiresAt         → else suppress.
 *   8. if a live content hash is supplied AND subject.contentDigest is non-null,
 *      they must be equal                                       → else suppress (drift).
 *   otherwise → render (carrying the verified payload).
 *
 * Steps 1–4 are CRYPTOGRAPHIC (verify): proves the bytes are authentic + untampered.
 * Steps 5–8 are POLICY (renderVerdict): the edge supplies its own context.
 * `verifyEnvelope` runs the whole pipeline; `verifySignatureOnly` / `renderVerdict`
 * are exposed for edges (e.g. an app proxy) that split the two phases.
 */

// ── base64 / base64url helpers (re-exported for callers; impl in ./base64) ───────────

export { base64urlDecode, base64urlEncode }

/**
 * Import an Ed25519 public key (as a WebCrypto `CryptoKey`) from common encodings, so a
 * kid resolver can hand the kernel whatever it has on the shelf:
 *   - 'spki-der'    : raw 44-byte SPKI DER bytes (what GCP KMS get-public-key returns, sans PEM armor)
 *   - 'spki-base64' : the base64 of those SPKI DER bytes (the string inside the PEM)
 *   - 'pem'         : a full PEM '-----BEGIN PUBLIC KEY-----' block
 *   - 'raw'         : the bare 32-byte Ed25519 public key
 */
export type Ed25519PublicKeyInput =
	| { readonly format: 'spki-der'; readonly bytes: Uint8Array }
	| { readonly format: 'spki-base64'; readonly base64: string }
	| { readonly format: 'pem'; readonly pem: string }
	| { readonly format: 'raw'; readonly bytes: Uint8Array }

const ED25519_ALG = { name: 'Ed25519' } as const

/** Strip PEM armor + whitespace and return the inner base64 (SPKI). */
function pemToSpkiBase64(pem: string): string {
	return pem
		.replace(/-----BEGIN [^-]+-----/g, '')
		.replace(/-----END [^-]+-----/g, '')
		.replace(/\s+/g, '')
}

/**
 * Import an `Ed25519PublicKeyInput` into a WebCrypto verify-only `CryptoKey`.
 * Async because `crypto.subtle.importKey` is async. Throws on a malformed key (the
 * caller — `verifyCryptographic` — catches and maps to 'unknown_key', fail-closed).
 */
export async function importEd25519PublicKey(input: Ed25519PublicKeyInput): Promise<CryptoKey> {
	switch (input.format) {
		case 'pem':
			return crypto.subtle.importKey('spki', base64ToBytes(pemToSpkiBase64(input.pem)), ED25519_ALG, false, ['verify'])
		case 'spki-base64':
			return crypto.subtle.importKey('spki', base64ToBytes(input.base64), ED25519_ALG, false, ['verify'])
		case 'spki-der':
			return crypto.subtle.importKey('spki', input.bytes, ED25519_ALG, false, ['verify'])
		case 'raw': {
			if (input.bytes.length !== 32) {
				throw new Error(`ed25519 raw public key must be 32 bytes, got ${input.bytes.length}`)
			}
			return crypto.subtle.importKey('raw', input.bytes, ED25519_ALG, false, ['verify'])
		}
	}
}

/**
 * A kid → public-key resolver. Returns a usable Ed25519 key for the given kid, or
 * null/undefined when the kid is unknown (→ suppress 'unknown_key'). May be async so
 * an edge can fetch+cache a published key set. Edge resolvers hand the kernel a
 * declarative `Ed25519PublicKeyInput` (raw/spki/pem bytes), or — if an edge already
 * imported the key — a WebCrypto `CryptoKey`.
 */
export type ResolvePublicKeyByKid = (
	kid: string,
) =>
	| Promise<Ed25519PublicKeyInput | CryptoKey | null | undefined>
	| Ed25519PublicKeyInput
	| CryptoKey
	| null
	| undefined

function isCryptoKey(k: Ed25519PublicKeyInput | CryptoKey): k is CryptoKey {
	// A WebCrypto CryptoKey has `type` + `algorithm` + a `usages` array; the input union
	// variants have `format`. We check `usages` (an Array) specifically so a Node
	// `KeyObject` — which also has a `.type` string but NO `.usages` — is NOT mistaken for
	// a WebCrypto key (edge resolvers hand inputs, not Node KeyObjects; this keeps a stray
	// one from silently misrouting into `crypto.subtle.verify`).
	if ('format' in (k as object)) return false
	const c = k as { type?: unknown; algorithm?: unknown; usages?: unknown }
	return typeof c.type === 'string' && typeof c.algorithm === 'object' && Array.isArray(c.usages)
}

async function asCryptoKey(k: Ed25519PublicKeyInput | CryptoKey): Promise<CryptoKey> {
	return isCryptoKey(k) ? k : importEd25519PublicKey(k)
}

// ── Phase 1: cryptographic verification ──────────────────────────────────────────

/** Low-level: does this detached base64url sig verify over canonicalize(payload)? */
export async function verifyDetachedSignature(
	payload: CertPayload,
	sigBase64url: string,
	publicKey: CryptoKey,
): Promise<boolean> {
	const bytes = canonicalPayloadBytes(payload)
	const sig = base64urlDecode(sigBase64url)
	try {
		return await crypto.subtle.verify(ED25519_ALG, publicKey, sig, bytes)
	} catch {
		return false
	}
}

type CryptoOk = { ok: true; key: CryptoKey }
type CryptoFail = { ok: false; reason: Extract<CertVerdict, { decision: 'suppress' }>['reason'] }

async function verifyCryptographic(
	envelope: CertDeliveryEnvelope,
	resolveKid: ResolvePublicKeyByKid,
): Promise<CryptoOk | CryptoFail> {
	const { payload, signature } = envelope ?? ({} as CertDeliveryEnvelope)

	// 1. shape + contract version
	if (!payload || !signature || payload.contractVersion !== CONTRACT_VERSION) {
		return { ok: false, reason: 'unsupported_contract_version' }
	}
	// 2. alg
	if (signature.alg !== SIGNATURE_ALG) {
		return { ok: false, reason: 'unsupported_alg' }
	}
	// 3. resolve kid
	const resolved = await resolveKid(signature.kid)
	if (!resolved) {
		return { ok: false, reason: 'unknown_key' }
	}
	let key: CryptoKey
	try {
		key = await asCryptoKey(resolved)
	} catch {
		return { ok: false, reason: 'unknown_key' }
	}
	// 4. verify
	if (!(await verifyDetachedSignature(payload, signature.sig, key))) {
		return { ok: false, reason: 'invalid_signature' }
	}
	return { ok: true, key }
}

/**
 * Phase-1-only entry point: parse + resolve kid + Ed25519-verify. Returns the
 * suppress reason on any failure, or { ok: true } when the bytes are authentic.
 * An app-proxy trust tier can run this server-side and hand the edge a short-lived
 * assertion; most edges just call `verifyEnvelope` (both phases).
 */
export async function verifySignatureOnly(
	envelope: CertDeliveryEnvelope,
	resolveKid: ResolvePublicKeyByKid,
): Promise<{ ok: true } | { ok: false; reason: Extract<CertVerdict, { decision: 'suppress' }>['reason'] }> {
	const r = await verifyCryptographic(envelope, resolveKid)
	return r.ok ? { ok: true } : { ok: false, reason: r.reason }
}

// ── Phase 2: policy verdict (subject / lifecycle / drift) ─────────────────────────

/** Edge-supplied context for the policy phase. */
export interface RenderContext {
	/** The platform this edge IS (e.g. 'shopify'). Must equal subject.platform. */
	readonly platform: string
	/** The stable external id of the article being rendered. Must equal
	 *  subject.externalId. */
	readonly externalId: string
	/** Lowercase hex SHA-256 of the LIVE article body, if the edge can read it.
	 *  Omit / null when the edge cannot observe content — the drift check is then
	 *  skipped (the issuer chose not to, or the surface can't). */
	readonly liveContentHash?: string | null
	/** Current time. Defaults to Date.now(); injectable for deterministic tests. */
	readonly now?: Date
}

/**
 * Phase-2-only: given an ALREADY-cryptographically-verified payload, apply the
 * subject/lifecycle/drift policy and produce a render-or-suppress verdict. Pure +
 * synchronous. Exposed so an app-proxy edge (which got phase 1 done server-side) can
 * still run policy locally.
 */
export function renderVerdict(payload: CertPayload, ctx: RenderContext): CertVerdict {
	const now = ctx.now ?? new Date()

	// 5. platform match
	if (payload.subject.platform !== ctx.platform) {
		return { decision: 'suppress', reason: 'platform_mismatch' }
	}
	// 6. subject (externalId) match
	if (payload.subject.externalId !== ctx.externalId) {
		return { decision: 'suppress', reason: 'subject_mismatch' }
	}
	// 7. lifecycle: not revoked, not expired
	if (payload.lifecycle.revokedAt !== null) {
		return { decision: 'suppress', reason: 'revoked' }
	}
	if (now.getTime() >= Date.parse(payload.lifecycle.expiresAt)) {
		return { decision: 'suppress', reason: 'expired' }
	}
	// 8. content drift — only when BOTH a bound digest and a live hash are present
	const bound = payload.subject.contentDigest
	const live = ctx.liveContentHash
	if (bound !== null && live != null && bound !== live) {
		return { decision: 'suppress', reason: 'content_drift' }
	}

	return { decision: 'render', payload }
}

// ── Full kernel: both phases, fail-closed ────────────────────────────────────────

/**
 * THE kernel entry point every render edge runs. Verifies the signature, then applies
 * policy. Returns `{ decision: 'render', payload }` only when EVERY check passes;
 * otherwise `{ decision: 'suppress', reason }`. Never throws on a bad envelope — a
 * malformed input fails closed to suppress, not to an exception that a caller might
 * swallow into a render.
 */
export async function verifyEnvelope(
	envelope: CertDeliveryEnvelope,
	resolveKid: ResolvePublicKeyByKid,
	ctx: RenderContext,
): Promise<CertVerdict> {
	let cryptoResult: CryptoOk | CryptoFail
	try {
		cryptoResult = await verifyCryptographic(envelope, resolveKid)
	} catch {
		// A throwing resolver / malformed key must fail closed, not bubble up.
		return { decision: 'suppress', reason: 'unknown_key' }
	}
	if (!cryptoResult.ok) {
		return { decision: 'suppress', reason: cryptoResult.reason }
	}
	return renderVerdict(envelope.payload, ctx)
}

// ── Tombstone: the slim revocation artifact (POR-10481) ───────────────────────────

/** Is this Delivery artifact the slim revocation tombstone (vs a full envelope)? Keys off
 *  the `kind: 'tombstone'` discriminator — an envelope carries no top-level `kind`. */
export function isTombstone(artifact: CertDeliveryArtifact): artifact is CertTombstone {
	return (artifact as { kind?: unknown } | null | undefined)?.kind === 'tombstone'
}

/**
 * Cryptographic verification for a `CertTombstone` — the SAME trust root + Ed25519 verify as
 * an envelope, but over `canonicalTombstoneBytes` (the signable fields, `signature` excluded).
 * A tombstone MUST be signed by the trust root: an unsigned / forged one can't blank a badge
 * (→ 'unknown_key' / 'invalid_signature', fail-closed).
 */
async function verifyTombstoneCryptographic(
	tombstone: CertTombstone,
	resolveKid: ResolvePublicKeyByKid,
): Promise<CryptoOk | CryptoFail> {
	const { signature } = tombstone ?? ({} as CertTombstone)
	// 1. shape + contract version (a tombstone carries `subject` + `signature`, no `payload`)
	if (!tombstone?.subject || !signature || tombstone.contractVersion !== CONTRACT_VERSION) {
		return { ok: false, reason: 'unsupported_contract_version' }
	}
	// 2. alg
	if (signature.alg !== SIGNATURE_ALG) {
		return { ok: false, reason: 'unsupported_alg' }
	}
	// 3. resolve kid
	const resolved = await resolveKid(signature.kid)
	if (!resolved) {
		return { ok: false, reason: 'unknown_key' }
	}
	let key: CryptoKey
	try {
		key = await asCryptoKey(resolved)
	} catch {
		return { ok: false, reason: 'unknown_key' }
	}
	// 4. verify over the canonical SIGNABLE bytes (the signature never covers itself)
	const { signature: _sig, ...signable } = tombstone
	const sig = base64urlDecode(signature.sig)
	let ok = false
	try {
		ok = await crypto.subtle.verify(ED25519_ALG, key, sig, canonicalTombstoneBytes(signable))
	} catch {
		ok = false
	}
	if (!ok) {
		return { ok: false, reason: 'invalid_signature' }
	}
	return { ok: true, key }
}

/**
 * The full verdict for a `CertTombstone`: verify it's authentically signed by the trust root,
 * then confirm its subject matches THIS edge's article (platform + externalId) — a tombstone
 * for another article must not blank this one. A valid, subject-matched tombstone →
 * `suppress: 'revoked'` (a blank badge). Fail-closed + never throws.
 */
export async function verifyTombstone(
	tombstone: CertTombstone,
	resolveKid: ResolvePublicKeyByKid,
	ctx: RenderContext,
): Promise<CertVerdict> {
	let cryptoResult: CryptoOk | CryptoFail
	try {
		cryptoResult = await verifyTombstoneCryptographic(tombstone, resolveKid)
	} catch {
		return { decision: 'suppress', reason: 'unknown_key' }
	}
	if (!cryptoResult.ok) {
		return { decision: 'suppress', reason: cryptoResult.reason }
	}
	if (tombstone.subject.platform !== ctx.platform) {
		return { decision: 'suppress', reason: 'platform_mismatch' }
	}
	if (tombstone.subject.externalId !== ctx.externalId) {
		return { decision: 'suppress', reason: 'subject_mismatch' }
	}
	return { decision: 'suppress', reason: 'revoked' }
}

/**
 * THE kernel entry point for a Delivery ARTIFACT — either a full `CertDeliveryEnvelope` or the
 * slim `CertTombstone` (POR-10481). Dispatches on the `kind: 'tombstone'` discriminator: a
 * tombstone verifies its own signature + subject match and always suppresses ('revoked'); an
 * envelope runs the full crypto + policy pipeline (identical to `verifyEnvelope`). Fail-closed,
 * never throws. New edges call THIS; `verifyEnvelope` stays for envelope-only callers — a
 * tombstone handed to the old envelope kernel fails-closed to suppress, which is the correct
 * blank-badge outcome for a revoked cert (see `CertTombstone`).
 */
export async function verifyArtifact(
	artifact: CertDeliveryArtifact,
	resolveKid: ResolvePublicKeyByKid,
	ctx: RenderContext,
): Promise<CertVerdict> {
	if (isTombstone(artifact)) {
		return verifyTombstone(artifact, resolveKid, ctx)
	}
	return verifyEnvelope(artifact, resolveKid, ctx)
}
