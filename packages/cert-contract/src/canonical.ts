import canonicalizeLib from 'canonicalize'
import type { CertPayload, CertTombstoneSignable } from './types.js'

/**
 * RFC 8785 (JSON Canonicalization Scheme) canonicalization — EDGE-RUNTIME SAFE.
 *
 * These functions define the CROSS-LANGUAGE CONTRACT: the exact bytes that get signed
 * (and recomputed on verify). Any other language reproducing the envelope MUST produce
 * byte-identical output here — that is what `vectors.json` proves. We delegate JCS to
 * the vetted `canonicalize` npm package (RFC 8785) rather than hand-rolling lexicographic
 * key ordering / number formatting.
 *
 * `canonicalize` returns a JS string; per RFC 8785, non-ASCII rides as RAW UTF-8 (minimal
 * escaping — only U+0000..U+001F, '"' and '\' are escaped), NOT \uXXXX. The UTF-8 encoding of
 * that string is the canonical byte sequence. We encode explicitly (via `TextEncoder`, which
 * exists on every runtime) so callers reason about bytes, not strings. A twin in another
 * language MUST emit the same raw-UTF-8 bytes (that is what `vectors.json` pins), not \u-escapes.
 *
 * NOTE: SHA-256 (`sha256Hex` / `sha256OfCanonical`) lives on the issuer-side
 * `@certrev/cert-contract/signer` subpath, NOT here — it used `node:crypto`, and the
 * VERIFY path (which this module backs) never hashes. Keeping canonicalization free of
 * `node:crypto` is what lets the kernel + this module run on edge/Workers runtimes.
 */

// The `canonicalize` package ships a CJS default export. Under NodeNext/bundler interop
// it may arrive as the function itself or as `{ default: fn }`; normalize both.
const canonicalize: (value: unknown) => string | undefined =
	typeof canonicalizeLib === 'function'
		? canonicalizeLib
		: (canonicalizeLib as { default: (value: unknown) => string | undefined }).default

/**
 * Canonicalize an arbitrary JSON value to its RFC-8785 string form.
 * Throws if the value is not JSON-serializable (e.g. a BigInt, a circular ref).
 */
export function canonicalizeJson(value: unknown): string {
	const out = canonicalize(value)
	if (typeof out !== 'string') {
		throw new Error('canonicalize: value is not JSON-serializable')
	}
	return out
}

/** The canonical UTF-8 BYTES of a JSON value — exactly what gets signed/hashed. */
export function canonicalBytes(value: unknown): Uint8Array {
	return new TextEncoder().encode(canonicalizeJson(value))
}

/**
 * Fail-closed cross-language number guard for the SIGNED payload.
 *
 * RFC-8785 serializes numbers with ECMAScript `Number::toString`. For integers OUTSIDE
 * the IEEE-754 double safe range (|n| > 2^53 − 1) that representation can lose precision
 * or go exponential, whereas a PHP / Go / Java verifier using a big-integer JSON encoder
 * emits the exact integer — so the two sides would canonicalize to DIFFERENT bytes and a
 * valid signature would fail to verify (or, worse, a tampered one slip through). The
 * envelope's only integers are `contractVersion` and `lifecycle.revision`, both tiny, so
 * this never fires in practice; the guard makes the corner case fail LOUD here at sign
 * time rather than silently diverge across the language boundary at verify time.
 *
 * Every number in the signed payload must be a SAFE INTEGER. Non-finite, fractional, or
 * out-of-range numbers throw. (The general `canonicalBytes` is intentionally NOT guarded
 * — only the bytes PHP must reproduce are.)
 */
function assertCrossLangSafeNumbers(value: unknown, path = '$'): void {
	if (typeof value === 'number') {
		if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
			throw new Error(
				`canonicalPayloadBytes: number at ${path} (${value}) is not a safe integer — ` +
					`signed-payload numbers must be safe integers so PHP/Go/Java verifiers reproduce identical canonical bytes`,
			)
		}
		return
	}
	if (Array.isArray(value)) {
		value.forEach((v, i) => assertCrossLangSafeNumbers(v, `${path}[${i}]`))
		return
	}
	if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			assertCrossLangSafeNumbers(v, `${path}.${k}`)
		}
	}
}

/**
 * The signing input for a CertDeliveryEnvelope: the RFC-8785 canonical bytes of
 * `payload`. The Ed25519 signature is computed over exactly these bytes; the verifier
 * recomputes them and checks the detached signature against them. Guarded against
 * cross-language-unsafe numbers (see `assertCrossLangSafeNumbers`).
 */
export function canonicalPayloadBytes(payload: CertPayload): Uint8Array {
	assertCrossLangSafeNumbers(payload)
	return canonicalBytes(payload)
}

/**
 * POR-10481 — the signing input for a `CertTombstone`: the RFC-8785 canonical bytes of the
 * SIGNABLE fields (`kind`, `contractVersion`, `subject`, `revokedAt`, `revocationReason`).
 * The detached Ed25519 signature is computed over exactly these bytes and NEVER covers
 * itself, so the signable subset excludes `signature` — the issuer passes the
 * `CertTombstoneSignable` it built; a verifier derives it via
 * `const { signature, ...signable } = tombstone`. Both sides canonicalize the same fields;
 * JCS key-sorting makes the JS property order irrelevant. Guarded for cross-language-safe
 * numbers (its only number is `contractVersion`).
 */
export function canonicalTombstoneBytes(signable: CertTombstoneSignable): Uint8Array {
	assertCrossLangSafeNumbers(signable)
	return canonicalBytes(signable)
}
