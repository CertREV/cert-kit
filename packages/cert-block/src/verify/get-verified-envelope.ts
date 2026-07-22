/**
 * ─────────────────────────────────────────────────────────────────────────────
 * getVerifiedEnvelope — the server-side fetch + verify + cache entry point
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The headless edge calls this ONCE per render in its server loader (Hydrogen loader,
 * Next server component / route handler, Builder server fetch). It:
 *   1. SOURCES the signed `CertDeliveryEnvelope` from EITHER a Shopify metafield (already
 *      fetched via the Storefront API) OR the public Delivery API
 *      (`GET /api/cert/v1/delivery/{platform}/{externalId}`).
 *   2. Runs the shared VerdictKernel (signature + subject/lifecycle/drift), FAIL-CLOSED.
 *   3. Caches the resulting verdict per-instance (TTL + single-flight) so concurrent SSR
 *      renders don't stampede the origin.
 *
 * It returns a `CertVerdict`: `{ decision: 'render', payload }` → render the badge +
 * JSON-LD; `{ decision: 'suppress', reason }` → render NOTHING. Any error (network,
 * malformed JSON, throwing resolver) collapses to a `suppress` verdict — never throws
 * into the render path, never renders an unverified credential.
 */

import type { CertDeliveryEnvelope, CertVerdict, RenderContext, ResolvePublicKeyByKid } from '../contract/kernel.js'
import { verifyEnvelope } from '../contract/kernel.js'
import { TtlCache } from './cache.js'

/** Where the signed envelope comes from. Exactly one of the two source shapes. */
export type EnvelopeSource =
	/** PULL: the public, CDN-cacheable Delivery API. The helper fetches it. */
	| {
			readonly kind: 'delivery_api'
			/** Base URL of the portal Delivery API, e.g. 'https://portal.certrev.com'. */
			readonly baseUrl: string
			readonly platform: string
			readonly externalId: string
	  }
	/** PUSH/native: an envelope already read from a Shopify app-owned metafield (or any
	 *  native store). The caller fetched it via the Storefront API; we just verify it. The
	 *  value may be the parsed envelope or its JSON string (metafields store strings). */
	| {
			readonly kind: 'metafield'
			readonly value: CertDeliveryEnvelope | string | null | undefined
	  }

export interface GetVerifiedEnvelopeOptions {
	readonly source: EnvelopeSource
	/** kid → public-key resolver (see ./resolve-kid). Required: no verify without keys. */
	readonly resolveKid: ResolvePublicKeyByKid
	/** Render context: the platform + externalId this edge IS, plus optional live hash. */
	readonly context: Omit<RenderContext, 'now'> & { readonly now?: Date }
	/** Injectable fetch for tests / non-global-fetch runtimes. */
	readonly fetchImpl?: typeof fetch
	/** Cache override (per-instance). Defaults to the module-level shared cache. */
	readonly cache?: TtlCache<CertVerdict>
	/** Positive verdict TTL ms (default 60_000). */
	readonly ttlMs?: number
}

/** Module-level shared cache so all calls in a process coordinate by default. */
const sharedVerdictCache = new TtlCache<CertVerdict>({ ttlMs: 60_000, negativeTtlMs: 5_000 })

function suppress(
	reason: CertVerdict extends { decision: 'suppress' }
		? never
		: Extract<CertVerdict, { decision: 'suppress' }>['reason'],
): CertVerdict {
	return { decision: 'suppress', reason }
}

function parseEnvelope(value: CertDeliveryEnvelope | string | null | undefined): CertDeliveryEnvelope | null {
	if (value == null) return null
	if (typeof value !== 'string') return value
	try {
		return JSON.parse(value) as CertDeliveryEnvelope
	} catch {
		return null
	}
}

function deliveryApiUrl(s: Extract<EnvelopeSource, { kind: 'delivery_api' }>): string {
	const base = s.baseUrl.replace(/\/+$/, '')
	return `${base}/api/cert/v1/delivery/${encodeURIComponent(s.platform)}/${encodeURIComponent(s.externalId)}`
}

/**
 * A short, fast, NON-cryptographic string hash (FNV-1a, 32-bit) — used ONLY to disambiguate
 * cache keys, never for security. Edge-safe (no node:crypto). Distinct envelope values for
 * the same placement must produce distinct keys so a push update (or, in tests/proofs,
 * verifying several different envelopes against one render context) can't be served a stale
 * verdict for a different envelope.
 */
function fnv1a(s: string): string {
	let h = 0x811c9dc5
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i)
		// 32-bit FNV prime multiply via shifts (stays in 32-bit unsigned)
		h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
	}
	return h.toString(16).padStart(8, '0')
}

/** A stable string form of the metafield value for hashing (parsed → canonical-ish JSON). */
function metafieldValueKey(value: CertDeliveryEnvelope | string | null | undefined): string {
	if (value == null) return 'null'
	const s = typeof value === 'string' ? value : JSON.stringify(value)
	return fnv1a(s)
}

/** Stable cache key per (source identity × render externalId × envelope value). */
function cacheKey(source: EnvelopeSource, ctx: RenderContext): string {
	if (source.kind === 'delivery_api') {
		return `api:${source.platform}:${source.externalId}`
	}
	// Metafield: key on the rendering identity AND a short hash of the envelope value, so a
	// push update (new envelope at the same placement) busts the entry, and verifying
	// different envelopes against one render context never collides on a stale verdict.
	return `mf:${ctx.platform}:${ctx.externalId}:${metafieldValueKey(source.value)}`
}

async function fetchFromDeliveryApi(
	s: Extract<EnvelopeSource, { kind: 'delivery_api' }>,
	fetchImpl: typeof fetch,
): Promise<CertDeliveryEnvelope | null> {
	const res = await fetchImpl(deliveryApiUrl(s), { headers: { accept: 'application/json' } })
	if (!res.ok) return null // 404 / 410 (revoked, no longer served) → no envelope → suppress
	try {
		return (await res.json()) as CertDeliveryEnvelope
	} catch {
		return null
	}
}

/**
 * Fetch (if needed), verify, and cache the certification verdict for one placement.
 * FAIL-CLOSED on every error path. Safe to call on every SSR render — the cache +
 * single-flight keep the origin load bounded.
 */
export async function getVerifiedEnvelope(opts: GetVerifiedEnvelopeOptions): Promise<CertVerdict> {
	const fetchImpl = opts.fetchImpl ?? globalThis.fetch
	const cache = opts.cache ?? sharedVerdictCache
	const ctx: RenderContext = { ...opts.context }
	const key = cacheKey(opts.source, ctx)

	const isSuppress = (v: CertVerdict) => v.decision !== 'render'

	return cache.getOrLoad(
		key,
		async () => {
			let envelope: CertDeliveryEnvelope | null
			try {
				envelope =
					opts.source.kind === 'delivery_api'
						? await fetchFromDeliveryApi(opts.source, fetchImpl)
						: parseEnvelope(opts.source.value)
			} catch {
				// Network/JSON failure → fail closed (do NOT render an unverified credential).
				return suppress('unsupported_contract_version')
			}
			if (!envelope) {
				// No envelope present (never certified / revoked + cleared / 404) → suppress.
				return suppress('unsupported_contract_version')
			}
			// The kernel itself never throws (it fails closed), but guard the resolver too.
			try {
				return await verifyEnvelope(envelope, opts.resolveKid, ctx)
			} catch {
				return suppress('unknown_key')
			}
		},
		isSuppress,
	)
}

/** Expose the shared cache so a revocation webhook handler can invalidate proactively. */
export function invalidateVerdict(
	source: EnvelopeSource,
	context: RenderContext,
	cache: TtlCache<CertVerdict> = sharedVerdictCache,
): void {
	cache.delete(cacheKey(source, context))
}

export { sharedVerdictCache }
