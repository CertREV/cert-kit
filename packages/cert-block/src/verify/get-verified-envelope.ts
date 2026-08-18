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
 *
 * `verdict.reason` is the ONLY signal a consumer gets when a badge does not appear (this
 * package logs nothing), so every failure path here reports what ACTUALLY failed rather than
 * a convenient catch-all. Every fetch also carries a deadline: a hung origin fails closed at
 * `timeoutMs` instead of holding the render open (see ./fetch-with-deadline).
 */

import type {
	CertDeliveryArtifact,
	CertSuppressReason,
	CertVerdict,
	RenderContext,
	ResolvePublicKeyByKid,
} from '../contract/kernel.js'
import { verifyArtifact } from '../contract/kernel.js'
import { TtlCache } from './cache.js'
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithDeadline } from './fetch-with-deadline.js'

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
	/** PUSH/native: an artifact already read from a Shopify app-owned metafield (or any
	 *  native store). The caller fetched it via the Storefront API; we just verify it. The
	 *  value may be the parsed artifact — a full envelope OR the slim revocation tombstone —
	 *  or its JSON string (metafields store strings). */
	| {
			readonly kind: 'metafield'
			readonly value: CertDeliveryArtifact | string | null | undefined
	  }

export interface GetVerifiedEnvelopeOptions {
	readonly source: EnvelopeSource
	/** kid → public-key resolver (see ./resolve-kid). Required: no verify without keys. */
	readonly resolveKid: ResolvePublicKeyByKid
	/** Render context: the platform + externalId this edge IS, plus optional live hash. */
	readonly context: RenderContext
	/** Injectable fetch for tests / non-global-fetch runtimes. */
	readonly fetchImpl?: typeof fetch
	/** Cache override (per-instance). Defaults to the module-level shared cache. */
	readonly cache?: TtlCache<CertVerdict>
	/** TTL in ms for a RENDER verdict written by this call (default: the cache's own positive
	 *  TTL — 60_000 on the shared cache). A suppress verdict keeps the cache's short negative
	 *  TTL regardless, so a longer `ttlMs` can never make a transient failure sticky. */
	readonly ttlMs?: number
	/** Deadline in ms for the Delivery API fetch (default `DEFAULT_FETCH_TIMEOUT_MS`, 3s).
	 *  Ignored by the metafield source, which does no I/O. */
	readonly timeoutMs?: number
}

/** Module-level shared cache so all calls in a process coordinate by default. */
const sharedVerdictCache = new TtlCache<CertVerdict>({ ttlMs: 60_000, negativeTtlMs: 5_000 })

function suppress(reason: CertSuppressReason): CertVerdict {
	return { decision: 'suppress', reason }
}

/**
 * What sourcing produced: an artifact to verify, or the TRUTHFUL reason it produced none.
 *
 * WHY a reason per failure, and why these reasons: the verdict's `reason` is the only thing a
 * consumer sees when a badge silently doesn't render. Every sourcing failure used to collapse
 * to 'unsupported_contract_version', which is FALSE for a 404 and for an unreachable origin —
 * it sends whoever is debugging to inspect a contractVersion that was never in play.
 *
 * `CertSuppressReason` (owned by @certrev/cert-contract) has no member for a TRANSPORT
 * failure, and inventing one here would be a cross-package contract change. So the mapping
 * is: nothing is published for this subject → 'subject_mismatch'; a body arrived that could
 * not be parsed → 'unsupported_contract_version' (true as written); the origin could not be
 * read at all → 'unsupported_contract_version' as the least-wrong member — it asserts nothing
 * about the credential itself, which every other member would.
 */
type SourceOutcome =
	| { readonly ok: true; readonly artifact: CertDeliveryArtifact }
	| { readonly ok: false; readonly reason: CertSuppressReason }

/** Read the artifact out of a metafield value. Never throws. */
function parseMetafieldValue(value: CertDeliveryArtifact | string | null | undefined): SourceOutcome {
	// Absent — never certified, or the app cleared the metafield (Shopify writes an empty
	// string rather than deleting it). Nothing is published for this subject.
	if (value == null || (typeof value === 'string' && value.trim() === '')) {
		return { ok: false, reason: 'subject_mismatch' }
	}
	if (typeof value !== 'string') return { ok: true, artifact: value }
	try {
		return { ok: true, artifact: JSON.parse(value) as CertDeliveryArtifact }
	} catch {
		return { ok: false, reason: 'unsupported_contract_version' }
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
function metafieldValueKey(value: CertDeliveryArtifact | string | null | undefined): string {
	if (value == null) return 'null'
	const s = typeof value === 'string' ? value : JSON.stringify(value)
	return fnv1a(s)
}

/** WHICH artifact is being verified. For the delivery source that is the full URL — the base
 *  URL is part of the identity (a staging portal and production serve DIFFERENT envelopes for
 *  the same platform/externalId); for a metafield it's a hash of the value the caller passed. */
function sourceKey(source: EnvelopeSource): string {
	return source.kind === 'delivery_api' ? `api:${deliveryApiUrl(source)}` : `mf:${metafieldValueKey(source.value)}`
}

/** WHERE it is being rendered. `now` is deliberately NOT part of the key: elapsed time is what
 *  the TTL already bounds, and keying on an injected clock would turn the cache into a
 *  permanent miss for every caller that passes one. */
function placementKey(ctx: RenderContext): string {
	return `${encodeURIComponent(ctx.platform)}:${encodeURIComponent(ctx.externalId)}`
}

/** Everything in the key ABOVE the live content hash — one placement, all of its hashes. */
function placementPrefix(source: EnvelopeSource, ctx: RenderContext): string {
	return `${sourceKey(source)}|${placementKey(ctx)}|`
}

/**
 * Stable cache key per (artifact identity × placement × live content hash) — i.e. every input
 * the verdict actually depends on. Both source branches now key on the same three things: the
 * old delivery key (`api:<platform>:<externalId>`) named neither the base URL nor the render
 * context, so one entry was shared by a staging and a production portal, and — the dangerous
 * one — a verdict computed while the article matched its `contentDigest` was served for a
 * later render whose body had DRIFTED, rendering a credential the drift check would have
 * suppressed. The live hash goes LAST so `invalidateVerdict` can drop a placement by prefix.
 */
function cacheKey(source: EnvelopeSource, ctx: RenderContext): string {
	return `${placementPrefix(source, ctx)}${ctx.liveContentHash ?? '-'}`
}

/** Fetch the artifact from the Delivery API. Never throws: every failure comes back as the
 *  truthful suppress reason (see `SourceOutcome`). */
async function fetchFromDeliveryApi(
	s: Extract<EnvelopeSource, { kind: 'delivery_api' }>,
	fetchImpl: typeof fetch,
	timeoutMs: number,
): Promise<SourceOutcome> {
	let res: Response
	try {
		res = await fetchWithDeadline(fetchImpl, deliveryApiUrl(s), { headers: { accept: 'application/json' } }, timeoutMs)
	} catch {
		// Unreachable origin, DNS/TLS failure, or the deadline above. No transport member
		// exists in the contract enum; this is the least-wrong one.
		return { ok: false, reason: 'unsupported_contract_version' }
	}
	if (res.status === 404 || res.status === 410) {
		// The API serves nothing for this (platform, externalId): never certified, or the
		// placement was withdrawn. Revocation of a LIVE cert comes back 200 with a tombstone
		// so a 4xx here is genuinely "no credential for this subject" — which is
		// also the question the consumer needs to ask (is this the externalId I think it is?).
		return { ok: false, reason: 'subject_mismatch' }
	}
	if (!res.ok) {
		// 5xx / 429 / anything else: the origin is failing, not the credential. Transport gap
		// again — same least-wrong member, and the short negative TTL keeps it recoverable.
		return { ok: false, reason: 'unsupported_contract_version' }
	}
	try {
		return { ok: true, artifact: (await res.json()) as CertDeliveryArtifact }
	} catch {
		// A body arrived and could not be parsed — here the reason is literally true.
		return { ok: false, reason: 'unsupported_contract_version' }
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
			const sourced =
				opts.source.kind === 'delivery_api'
					? await fetchFromDeliveryApi(opts.source, fetchImpl, opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS)
					: parseMetafieldValue(opts.source.value)
			if (!sourced.ok) return suppress(sourced.reason)
			// `verifyArtifact` — not `verifyEnvelope` — because the Delivery API answers a
			// revoked cert with the slim signed TOMBSTONE. The envelope-only kernel
			// still fails closed on one, but it reports it as an unparseable envelope; the
			// artifact kernel verifies the tombstone's own signature + subject and says
			// 'revoked', which is both true and the thing a consumer needs to hear.
			// The kernel itself never throws (it fails closed), but guard the resolver too.
			try {
				return await verifyArtifact(sourced.artifact, opts.resolveKid, ctx)
			} catch {
				return suppress('unknown_key')
			}
		},
		isSuppress,
		opts.ttlMs,
	)
}

/**
 * Expose the shared cache so a revocation webhook handler can invalidate proactively. Drops
 * EVERY entry for this source at this placement, whatever live content hash each was cached
 * under — the webhook knows the article, never the body hash a given render observed, and an
 * invalidation that misses because of a hash mismatch is a revoked cert that keeps rendering.
 */
export function invalidateVerdict(
	source: EnvelopeSource,
	context: RenderContext,
	cache: TtlCache<CertVerdict> = sharedVerdictCache,
): void {
	cache.deletePrefix(placementPrefix(source, context))
}

export { sharedVerdictCache }
