/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The issuer key SET a card trusts (2.0.0): baked keys first, then CertREV's signed published set
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Through 1.3.x the Builder card trusted exactly one baked key (`cert-issuer-1`), so a key rotation would have needed
 * every brand to install a new package. 2.0 trusts a SET without adding a trust root:
 *
 *  1. A kid the package bakes resolves to the baked key, always (a published set never overrides a baked key).
 *  2. Any other kid makes ONE read of the delivery origin's published key set, `GET <origin>/api/cert/v1/keys`
 *     (`credentials: 'omit'`, the card's deadline): a browser reads it at most once per page and origin, a server at
 *     most once per origin per hour (single-flight, a failure remembered for ten minutes).
 *  3. The set is accepted only when it is signed by a BAKED kid, over the RFC 8785 bytes of exactly this object:
 *
 *       { kind: 'certrev.keyset', v: 1, issuedAt, keys: [{ kid, crv: 'Ed25519', x }] }     (x: base64url, 32 bytes)
 *
 *     answered as `{ keyset, signature: { alg: 'ed25519', kid, sig, signedAt? } }`. Refused: another `kind` or `v`
 *     (an envelope, a tombstone or a release record can never verify as a key set: their signed bytes are other
 *     objects), a set whose `issuedAt` is older than the one already accepted from that origin (no rollback), a set
 *     whose keys do not hold its signer's kid with the same key (it may not drop or replace the key that vouches for
 *     it), a malformed key, a signature that does not verify.
 *  4. Anything else (no route, a network error, a refused set) leaves the kid unknown: the kernel suppresses the
 *     envelope with `unknown_key`, so the card renders nothing and reports, exactly as for an unknown kid in 1.3.x.
 *
 * The route is the portal's (ADR 0001 section 3 addendum). Today every envelope is signed by the baked
 * `cert-issuer-1`, so step 2 never runs and nothing is fetched.
 */

import {
	base64urlDecode,
	canonicalBytes,
	type Ed25519PublicKeyInput,
	importEd25519PublicKey,
	type ResolvePublicKeyByKid,
} from '../contract/kernel.js'
import { TtlCache } from './cache.js'
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithDeadline } from './fetch-with-deadline.js'

/** Where an origin publishes its key set. */
export const KEY_SET_PATH = '/api/cert/v1/keys'

/** The signed object, exactly as the portal canonicalizes and signs it. */
export interface PublishedKeySet {
	readonly kind: 'certrev.keyset'
	readonly v: 1
	readonly issuedAt: string
	readonly keys: ReadonlyArray<{ readonly kid: string; readonly crv: 'Ed25519'; readonly x: string }>
}

/** An accepted set: the keys it publishes, and when it was issued (for the no-rollback rule). */
export interface AcceptedKeySet {
	readonly issuedAt: number
	readonly keys: ReadonlyMap<string, Ed25519PublicKeyInput>
}

const ED25519 = { name: 'Ed25519' } as const

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'

function rawKey(x: unknown): Uint8Array | null {
	if (!isString(x) || !/^[A-Za-z0-9_-]+$/.test(x)) return null
	try {
		const bytes = base64urlDecode(x)
		return bytes.length === 32 ? bytes : null
	} catch {
		return null
	}
}

/** Ed25519 verify under a declared key or an imported one; any failure (a bad key, no WebCrypto Ed25519) is false. */
async function verifies(key: Ed25519PublicKeyInput | CryptoKey, sig: Uint8Array, bytes: Uint8Array): Promise<boolean> {
	try {
		const imported = 'format' in (key as object) ? await importEd25519PublicKey(key as Ed25519PublicKeyInput) : key
		// Fresh ArrayBuffer-backed copies: WebCrypto's BufferSource excludes a SharedArrayBuffer view.
		return await crypto.subtle.verify(ED25519, imported as CryptoKey, new Uint8Array(sig), new Uint8Array(bytes))
	} catch {
		return false
	}
}

/**
 * Judge one key-set response body against the baked keys (and the set already accepted from the same origin, for
 * the no-rollback rule). Returns the accepted set, or null. Never throws.
 */
export async function verifyKeySet(
	body: unknown,
	bakedResolveKid: ResolvePublicKeyByKid,
	previous?: AcceptedKeySet,
): Promise<AcceptedKeySet | null> {
	if (!isRecord(body) || !isRecord(body.keyset) || !isRecord(body.signature)) return null
	const { keyset, signature } = body
	if (keyset.kind !== 'certrev.keyset' || keyset.v !== 1) return null
	if (!isString(keyset.issuedAt)) return null
	const issuedAt = Date.parse(keyset.issuedAt)
	if (!Number.isFinite(issuedAt)) return null
	if (previous && issuedAt < previous.issuedAt) return null
	if (!Array.isArray(keyset.keys) || keyset.keys.length === 0) return null
	if (signature.alg !== 'ed25519' || !isString(signature.kid) || !isString(signature.sig)) return null

	// The signer must be a kid this package bakes.
	let baked: Ed25519PublicKeyInput | CryptoKey | null | undefined
	try {
		baked = await bakedResolveKid(signature.kid)
	} catch {
		return null
	}
	if (!baked) return null

	const keys = new Map<string, Ed25519PublicKeyInput>()
	for (const entry of keyset.keys) {
		if (!isRecord(entry) || !isString(entry.kid) || entry.kid === '' || entry.crv !== 'Ed25519') return null
		const bytes = rawKey(entry.x)
		if (!bytes || keys.has(entry.kid)) return null
		keys.set(entry.kid, { format: 'raw', bytes })
	}
	// The set must keep the key that signed it.
	const signerEntry = keys.get(signature.kid)
	if (!signerEntry) return null

	let sig: Uint8Array
	let bytes: Uint8Array
	try {
		sig = base64urlDecode(signature.sig)
		bytes = canonicalBytes(keyset)
	} catch {
		return null
	}
	if (!(await verifies(baked, sig, bytes))) return null
	// ... and publish it as the same key: the signature must verify under the published entry too.
	if (!(await verifies(signerEntry, sig, bytes))) return null
	return { issuedAt, keys }
}

export interface KeySetResolverOptions {
	/** The delivery origin the card reads (the marker's `baseUrl`). */
	readonly baseUrl: string
	/** The baked kids (the package's own trust root). */
	readonly bakedResolveKid: ResolvePublicKeyByKid
	readonly fetchImpl: typeof fetch
	readonly timeoutMs?: number
}

/** What one origin's published set settled to: accepted, or nothing (unknown kid). */
type Loaded = AcceptedKeySet | null

/** Server: one read per origin per hour, a failure remembered for ten minutes (single-flight across renders). */
const serverSets = new TtlCache<Loaded>({ ttlMs: 3_600_000, negativeTtlMs: 600_000, maxEntries: 50 })
/** Browser: one read per origin for the page's lifetime, whatever it settled to. */
const pageSets = new Map<string, Promise<Loaded>>()
/** The newest set accepted per origin (both runtimes), for the no-rollback rule. */
const acceptedSets = new Map<string, AcceptedKeySet>()

function originOf(baseUrl: string): string | null {
	try {
		return new URL(baseUrl).origin
	} catch {
		return null
	}
}

async function loadKeySet(origin: string, opts: KeySetResolverOptions): Promise<Loaded> {
	let res: Response
	try {
		res = await fetchWithDeadline(
			opts.fetchImpl,
			`${origin}${KEY_SET_PATH}`,
			{ headers: { accept: 'application/json' }, credentials: 'omit' },
			opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
		)
	} catch {
		return acceptedSets.get(origin) ?? null
	}
	if (!res.ok) return acceptedSets.get(origin) ?? null
	let body: unknown
	try {
		body = await res.json()
	} catch {
		return acceptedSets.get(origin) ?? null
	}
	const previous = acceptedSets.get(origin)
	const accepted = await verifyKeySet(body, opts.bakedResolveKid, previous)
	// A refused set (older, unsigned, malformed) never replaces one this origin already proved.
	if (!accepted) return previous ?? null
	acceptedSets.set(origin, accepted)
	return accepted
}

function publishedSet(origin: string, opts: KeySetResolverOptions): Promise<Loaded> {
	if (typeof document !== 'undefined') {
		let pending = pageSets.get(origin)
		if (!pending) {
			pending = loadKeySet(origin, opts)
			pageSets.set(origin, pending)
		}
		return pending
	}
	return serverSets.getOrLoad(
		origin,
		() => loadKeySet(origin, opts),
		(v) => v === null,
	)
}

/**
 * The resolver a card verifies with: the baked kids, then (for any other kid) the origin's published, signed set.
 * Never throws; an unresolved kid is null (`unknown_key`).
 */
export function keySetResolver(opts: KeySetResolverOptions): ResolvePublicKeyByKid {
	return async (kid) => {
		const baked = await opts.bakedResolveKid(kid)
		if (baked) return baked
		const origin = originOf(opts.baseUrl)
		if (!origin) return null
		const set = await publishedSet(origin, opts)
		return set?.keys.get(kid) ?? null
	}
}

/** Test seam: forget every published set (a new page and process). */
export function forgetKeySetsForTests(): void {
	serverSets.clear()
	pageSets.clear()
	acceptedSets.clear()
}
