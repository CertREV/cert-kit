/**
 * ─────────────────────────────────────────────────────────────────────────────
 * getVerifiedDelivery — the envelope PLUS the brand's render def, from the Delivery API
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1.1.0. The Delivery API answers a Builder placement with the signed artifact and, beside it,
 * the brand's resolved render-def projection as a top-level `renderDef` sibling (the same shape a
 * Shopify store carries in its `render_def` metafield). The envelope's signature covers `payload`
 * only, so the sibling rides the response without touching the signed bytes, and a tombstone
 * carries none. `getVerifiedEnvelope` keeps discarding it; this reads it.
 *
 * The same fetch, deadline, kernel and fail-closed rules as `getVerifiedEnvelope` (every sourcing
 * failure reports the reason it actually is; nothing throws into the render path). Two things are
 * different, and both are the point:
 *
 *  1. WHAT IS CACHED is the cryptographically verified PAYLOAD, not the verdict. The lifecycle
 *     policy (revoked, expired) and the subject match are re-run by `renderVerdict` on EVERY call,
 *     with the caller's clock. So a payload that was valid when fetched and expires while cached
 *     stops rendering at its `expiresAt`, not at the next refetch; and a refetch after the TTL
 *     picks up a tombstone (revocation) or a changed def with no write on the brand's side.
 *  2. The CACHE KEY is the Delivery URL plus the rendering placement, so a staging and a
 *     production origin never share an entry, and neither do two placements.
 *
 * `peekVerifiedDelivery` is the synchronous read of the same cache: a React component suspends on
 * `getVerifiedDelivery` once, then reads the settled value without a second promise (which is what
 * keeps a streaming SSR render from suspending forever on a fresh promise every retry).
 */

import type { CertChromeRenderDef } from '../builder/cert-chrome-data.js'
import type {
	CertDeliveryArtifact,
	CertPayload,
	CertSuppressReason,
	CertVerdict,
	RenderContext,
	ResolvePublicKeyByKid,
} from '../contract/kernel.js'
import { renderVerdict, verifyArtifact } from '../contract/kernel.js'
import { TtlCache } from './cache.js'
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithDeadline } from './fetch-with-deadline.js'

/** What one Delivery read settles to, as cached: a verified payload + its def, or the reason not. */
export type CachedDelivery =
	| { readonly kind: 'verified'; readonly payload: CertPayload; readonly renderDef: CertChromeRenderDef | null }
	| { readonly kind: 'suppressed'; readonly reason: CertSuppressReason }

/** The answer for one render: the verdict AT THIS RENDER'S CLOCK, and the def to paint it with. */
export interface VerifiedDelivery {
	readonly verdict: CertVerdict
	/** The brand's render def, or null (no def resolved, a malformed one, or a suppress verdict). */
	readonly renderDef: CertChromeRenderDef | null
}

export interface GetVerifiedDeliveryOptions {
	/** Base URL of the CertREV app that serves the Delivery API, e.g. 'https://portal.certrev.com'. */
	readonly baseUrl: string
	readonly platform: string
	readonly externalId: string
	/** kid → public-key resolver. Required: no verify without keys. */
	readonly resolveKid: ResolvePublicKeyByKid
	/** Render context: the platform + externalId this edge IS, and the render's clock (`now`). */
	readonly context: RenderContext
	readonly fetchImpl?: typeof fetch
	/** Cache override. Defaults to the module-level shared delivery cache. */
	readonly cache?: TtlCache<CachedDelivery>
	/** TTL in ms for a VERIFIED read (default: the cache's positive TTL, 60_000 on the shared one). */
	readonly ttlMs?: number
	/** Deadline in ms for the fetch (default `DEFAULT_FETCH_TIMEOUT_MS`, 3s). */
	readonly timeoutMs?: number
}

/** Shared per-process cache: 60s for a verified read, 5s for a suppressed one. */
const sharedDeliveryCache = new TtlCache<CachedDelivery>({ ttlMs: 60_000, negativeTtlMs: 5_000 })

function suppressed(reason: CertSuppressReason): CachedDelivery {
	return { kind: 'suppressed', reason }
}

export function deliveryUrl(baseUrl: string, platform: string, externalId: string): string {
	const base = baseUrl.replace(/\/+$/, '')
	return `${base}/api/cert/v1/delivery/${encodeURIComponent(platform)}/${encodeURIComponent(externalId)}`
}

/** Cache key: the URL (origin included) × the placement rendering it. No clock: the TTL bounds time. */
export function deliveryCacheKey(
	opts: Pick<GetVerifiedDeliveryOptions, 'baseUrl' | 'platform' | 'externalId' | 'context'>,
): string {
	return `delivery:${deliveryUrl(opts.baseUrl, opts.platform, opts.externalId)}|${encodeURIComponent(opts.context.platform)}:${encodeURIComponent(opts.context.externalId)}`
}

const isString = (v: unknown): v is string => typeof v === 'string'
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The def sibling, shape-checked. Anything that is not the metafield shape is null, which paints
 * the preset default (the same thing an absent def paints): a def is presentation, never a claim,
 * so a malformed one degrades the styling and nothing else. The TOKEN VALUES are not judged here;
 * `resolveBlockTheme` re-validates each at paint time and drops what is not a safe value.
 */
export function parseRenderDef(value: unknown): CertChromeRenderDef | null {
	if (!isRecord(value)) return null
	const { v, preset, rung, tokens, hidden, barInkFg, layout, customFace } = value
	if (typeof v !== 'number' || !Number.isFinite(v)) return null
	if (!isString(preset) || !isString(rung) || !isRecord(tokens)) return null
	if (!Array.isArray(hidden) || !hidden.every(isString)) return null
	if (layout !== undefined && !isString(layout)) return null
	let face: CertChromeRenderDef['customFace']
	if (customFace !== undefined) {
		if (!isRecord(customFace) || !Array.isArray(customFace.placedFields) || !customFace.placedFields.every(isString)) {
			return null
		}
		face = { placedFields: [...customFace.placedFields] }
	}
	const tokenOut: Record<string, string> = {}
	for (const key of ['accentColor', 'surface', 'cornerRadius', 'fontSlot', 'barInk', 'inkColor'] as const) {
		if (isString(tokens[key])) tokenOut[key] = tokens[key]
	}
	return {
		v,
		preset,
		rung,
		tokens: tokenOut,
		...(barInkFg === '#141414' || barInkFg === '#ffffff' ? { barInkFg } : {}),
		hidden: [...hidden],
		...(layout !== undefined ? { layout } : {}),
		...(face ? { customFace: face } : {}),
	}
}

/** Fetch, parse and cryptographically verify one Delivery response. Never throws. */
async function loadDelivery(opts: GetVerifiedDeliveryOptions): Promise<CachedDelivery> {
	const fetchImpl = opts.fetchImpl ?? globalThis.fetch
	let res: Response
	try {
		res = await fetchWithDeadline(
			fetchImpl,
			deliveryUrl(opts.baseUrl, opts.platform, opts.externalId),
			{ headers: { accept: 'application/json' } },
			opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
		)
	} catch {
		// Unreachable, DNS/TLS, or the deadline. Same least-wrong member as getVerifiedEnvelope.
		return suppressed('unsupported_contract_version')
	}
	// Nothing served for this placement: never certified, or withdrawn. A LIVE revocation is a 200
	// tombstone, so a 4xx here genuinely means "no credential for this subject".
	if (res.status === 404 || res.status === 410) return suppressed('subject_mismatch')
	if (!res.ok) return suppressed('unsupported_contract_version')
	let body: unknown
	try {
		body = await res.json()
	} catch {
		return suppressed('unsupported_contract_version')
	}
	if (!isRecord(body)) return suppressed('unsupported_contract_version')
	let verdict: CertVerdict
	try {
		// `verifyArtifact`, so a tombstone verifies as itself and reports 'revoked'. The kernel reads
		// `payload` + `signature` (or the tombstone's own fields); the `renderDef` sibling is not
		// part of what is verified, and is never read unless the artifact verified.
		verdict = await verifyArtifact(body as unknown as CertDeliveryArtifact, opts.resolveKid, { ...opts.context })
	} catch {
		return suppressed('unknown_key')
	}
	if (verdict.decision !== 'render') return suppressed(verdict.reason)
	return { kind: 'verified', payload: verdict.payload, renderDef: parseRenderDef(body.renderDef) }
}

/** Apply the render-time policy to a cached read: lifecycle + subject at THIS render's clock. */
export function settleDelivery(cached: CachedDelivery, context: RenderContext): VerifiedDelivery {
	if (cached.kind === 'suppressed') return { verdict: { decision: 'suppress', reason: cached.reason }, renderDef: null }
	const verdict = renderVerdict(cached.payload, context)
	return { verdict, renderDef: verdict.decision === 'render' ? cached.renderDef : null }
}

/**
 * Fetch (if needed), verify, cache, and settle one Delivery read for one placement. FAIL-CLOSED:
 * the verdict is `render` only when the artifact verified against `resolveKid` AND, at
 * `context.now`, the payload is unrevoked, unexpired and for this placement.
 */
export async function getVerifiedDelivery(opts: GetVerifiedDeliveryOptions): Promise<VerifiedDelivery> {
	const cache = opts.cache ?? sharedDeliveryCache
	const cached = await cache.getOrLoad(
		deliveryCacheKey(opts),
		() => loadDelivery(opts),
		(v) => v.kind === 'suppressed',
		opts.ttlMs,
	)
	return settleDelivery(cached, opts.context)
}

/**
 * The synchronous read: the settled answer when a fresh read is cached, else `undefined` (the
 * caller then awaits `getVerifiedDelivery`). Never fetches.
 */
export function peekVerifiedDelivery(
	opts: Pick<GetVerifiedDeliveryOptions, 'baseUrl' | 'platform' | 'externalId' | 'context' | 'cache'>,
): VerifiedDelivery | undefined {
	const cached = (opts.cache ?? sharedDeliveryCache).peek(deliveryCacheKey(opts))
	return cached === undefined ? undefined : settleDelivery(cached, opts.context)
}

/** Drop every cached read for one placement (e.g. from a revocation webhook). */
export function invalidateDelivery(
	opts: Pick<GetVerifiedDeliveryOptions, 'baseUrl' | 'platform' | 'externalId' | 'context'>,
	cache: TtlCache<CachedDelivery> = sharedDeliveryCache,
): void {
	cache.delete(deliveryCacheKey(opts))
}

export { sharedDeliveryCache }
