/**
 * Public-key resolution for the kernel's signature-verification step.
 *
 * The kernel needs a `kid → Ed25519 public key` resolver. CertREV publishes its public
 * key set (a JWKS-like document) so any edge can verify without a shared secret; rotation
 * is "publish N+1 keys, start signing with the new kid, retire the old once edges refresh".
 *
 * This module gives two resolvers:
 *   • `staticKidResolver(keys)` — for a key set baked into the deploy (the headless edge
 *     ships CertREV's current public keys as config; zero network at render time).
 *   • `fetchingKidResolver({ jwksUrl })` — fetches + caches the published key set, so a
 *     newly-rotated kid resolves without a redeploy. Cached with a long TTL (keys rotate
 *     rarely) + single-flight (no thundering herd on the JWKS endpoint).
 *
 * Both return the `Ed25519PublicKeyInput` shape the kernel accepts. The fetching resolver
 * understands the two encodings CertREV may publish: a PEM string, or a JWK with an
 * Ed25519 `x` (base64url raw key).
 */

import { base64urlDecode } from '@certrev/cert-contract'
import type { Ed25519PublicKeyInput, ResolvePublicKeyByKid } from '../contract/kernel.js'
import { TtlCache } from './cache.js'

/** A static map of kid → public key (PEM string or an explicit input). */
export type StaticKeySet = Readonly<Record<string, string | Ed25519PublicKeyInput>>

function asInput(v: string | Ed25519PublicKeyInput): Ed25519PublicKeyInput {
	// A bare string is treated as PEM (the common deploy-config form).
	return typeof v === 'string' ? { format: 'pem', pem: v } : v
}

/** Resolver over a key set baked into the deploy. No network at render time. */
export function staticKidResolver(keys: StaticKeySet): ResolvePublicKeyByKid {
	return (kid) => {
		const k = keys[kid]
		return k ? asInput(k) : null
	}
}

// ── JWKS-style published key set ──────────────────────────────────────────────────

interface PublishedJwk {
	readonly kid: string
	readonly kty?: string
	readonly crv?: string
	/** base64url raw 32-byte Ed25519 public key (OKP/Ed25519). */
	readonly x?: string
	/** Alternatively, a PEM the publisher chose to ship. */
	readonly pem?: string
}

interface PublishedKeySetDoc {
	readonly keys: ReadonlyArray<PublishedJwk>
}

// Runtime-agnostic base64url decode from the contract (no `Buffer` — edge/Workers safe).
function base64urlToBytes(b64url: string): Uint8Array {
	return base64urlDecode(b64url)
}

function jwkToInput(jwk: PublishedJwk): Ed25519PublicKeyInput | null {
	if (jwk.pem) return { format: 'pem', pem: jwk.pem }
	if (jwk.x) {
		const bytes = base64urlToBytes(jwk.x)
		if (bytes.length === 32) return { format: 'raw', bytes }
	}
	return null
}

export interface FetchingKidResolverOptions {
	/** URL of CertREV's published key set (JWKS-like). */
	readonly jwksUrl: string
	/** Key-set cache TTL in ms (default 1h — keys rotate rarely). */
	readonly ttlMs?: number
	/** Injectable fetch for tests / non-global-fetch runtimes. */
	readonly fetchImpl?: typeof fetch
}

/**
 * Resolver that fetches + caches CertREV's published key set. A single fetch populates
 * all kids; concurrent misses single-flight through the cache. A kid absent from the
 * fetched set resolves to null (→ kernel suppresses 'unknown_key' — fail-closed).
 */
export function fetchingKidResolver(opts: FetchingKidResolverOptions): ResolvePublicKeyByKid {
	const fetchImpl = opts.fetchImpl ?? globalThis.fetch
	const cache = new TtlCache<Map<string, Ed25519PublicKeyInput>>({ ttlMs: opts.ttlMs ?? 3_600_000 })
	const CACHE_KEY = opts.jwksUrl

	async function loadKeySet(): Promise<Map<string, Ed25519PublicKeyInput>> {
		const map = new Map<string, Ed25519PublicKeyInput>()
		const res = await fetchImpl(opts.jwksUrl, { headers: { accept: 'application/json' } })
		if (!res.ok) return map // empty → every kid resolves null → fail closed
		const doc = (await res.json()) as PublishedKeySetDoc
		for (const jwk of doc.keys ?? []) {
			const input = jwkToInput(jwk)
			if (input && jwk.kid) map.set(jwk.kid, input)
		}
		return map
	}

	return async (kid) => {
		const keySet = await cache.getOrLoad(CACHE_KEY, loadKeySet, (m) => m.size === 0)
		return keySet.get(kid) ?? null
	}
}
