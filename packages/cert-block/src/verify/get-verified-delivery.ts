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
 * 1.2.0-canary.5: an optional design PIN (`design`, CertREV's own canary replica only) asks the Delivery
 * API for one saved design version (`?design=<v>[&designBrand=<brand>]`). The pin is part of the URL, so
 * it is part of the cache key: a pinned read never shares an entry with the unpinned one. Without a pin
 * the URL and the key are exactly what 1.1.0 built.
 *
 * `peekVerifiedDelivery` is the synchronous read of the same cache: a React component suspends on
 * `getVerifiedDelivery` once, then reads the settled value without a second promise (which is what
 * keeps a streaming SSR render from suspending forever on a fresh promise every retry).
 *
 * 1.2.0: a suppressed read that only failed to REACH CertREV (the fetch threw or hit its deadline, a 5xx or other
 * non-OK status but 404/410, a body that is not JSON or not an object) is marked `unreachable`. It says nothing
 * about the credential, so a cache with a stale window keeps a verified entry over it (stale-if-error), and the
 * card paints its options face instead of nothing. A definitive answer (404/410, a key or signature that does not
 * verify, a revoked, expired or mismatched artifact) is never `unreachable`. `readVerifiedDelivery` is the
 * synchronous read that also serves a stale entry while refreshing it.
 */

import type { CertChromeRenderDef } from '../builder/cert-chrome-data.js'
import type {
	CertDeliveryArtifact,
	CertPayload,
	CertSignature,
	CertSuppressReason,
	CertVerdict,
	RenderContext,
	ResolvePublicKeyByKid,
} from '../contract/kernel.js'
import { renderVerdict, verifyArtifact } from '../contract/kernel.js'
import { TtlCache } from './cache.js'
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithDeadline } from './fetch-with-deadline.js'

/**
 * What one Delivery read settles to, as cached: a verified payload + its def (and, from 1.2.0, the signature it
 * verified with, so a server render can hand the signed envelope to the browser), or the reason not.
 */
export type CachedDelivery =
	| {
			readonly kind: 'verified'
			readonly payload: CertPayload
			readonly renderDef: CertChromeRenderDef | null
			/** Absent only in a cache filled by hand (a test, a custom cache); a read always keeps it. */
			readonly signature?: CertSignature
	  }
	| {
			readonly kind: 'suppressed'
			readonly reason: CertSuppressReason
			/** 1.2.0: true when CertREV was not reached (no answer about the credential); see the module header. */
			readonly unreachable?: true
	  }

/** The answer for one render: the verdict AT THIS RENDER'S CLOCK, and the def to paint it with. */
export interface VerifiedDelivery {
	readonly verdict: CertVerdict
	/** The brand's render def, or null (no def resolved, a malformed one, or a suppress verdict). */
	readonly renderDef: CertChromeRenderDef | null
	/** The verified envelope's signature, on a `render` verdict whose read kept it; else undefined. */
	readonly signature?: CertSignature
	/** 1.2.0: on a suppress verdict, true when CertREV was not reached; else undefined. */
	readonly unreachable?: true
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
	/** Deadline in ms for the fetch (default `DEFAULT_FETCH_TIMEOUT_MS`, 3s; the Builder card's runtime passes 8s). */
	readonly timeoutMs?: number
	/**
	 * 1.2.0-canary.5: read one saved design version instead of the brand's live def. CertREV's own canary
	 * replica only; production brands never send it. Build it with `parseDesignPin`.
	 */
	readonly design?: DesignPin
}

/**
 * A design pin: the saved design `version` the Delivery API should serve the def for, and optionally the
 * brand whose saved design it is (`brand`, a brand key). The API answers a pin it cannot honour with a
 * 404 or a 503, which settle to suppressed like any other failed read.
 */
export interface DesignPin {
	readonly version: number
	readonly brand?: string
}

/** Shared per-process cache: 60s for a verified read, 5s for a suppressed one. */
const sharedDeliveryCache = new TtlCache<CachedDelivery>({ ttlMs: 60_000, negativeTtlMs: 5_000 })

function suppressed(reason: CertSuppressReason): CachedDelivery {
	return { kind: 'suppressed', reason }
}

/** A read that did not reach CertREV: the same least-wrong reason as before 1.2.0, marked `unreachable`. */
function unreachable(): CachedDelivery {
	return { kind: 'suppressed', reason: 'unsupported_contract_version', unreachable: true }
}

const isUnreachable = (v: CachedDelivery): boolean => v.kind === 'suppressed' && v.unreachable === true

/** The Delivery route; a design pin adds `?design=<v>` and, with a brand, `&designBrand=<brand>`. */
export function deliveryUrl(baseUrl: string, platform: string, externalId: string, design?: DesignPin): string {
	const base = baseUrl.replace(/\/+$/, '')
	const url = `${base}/api/cert/v1/delivery/${encodeURIComponent(platform)}/${encodeURIComponent(externalId)}`
	if (!design) return url
	const brand = design.brand === undefined ? '' : `&designBrand=${encodeURIComponent(design.brand)}`
	return `${url}?design=${design.version}${brand}`
}

/** Cache key: the URL (origin and pin included) × the placement rendering it. No clock: the TTL bounds time. */
export function deliveryCacheKey(
	opts: Pick<GetVerifiedDeliveryOptions, 'baseUrl' | 'platform' | 'externalId' | 'context' | 'design'>,
): string {
	return `delivery:${deliveryUrl(opts.baseUrl, opts.platform, opts.externalId, opts.design)}|${encodeURIComponent(opts.context.platform)}:${encodeURIComponent(opts.context.externalId)}`
}

const isString = (v: unknown): v is string => typeof v === 'string'
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The pin's two grammars, the Delivery API's own: a version 1..999999999 with no leading zero, a brand key. */
const DESIGN_VERSION = /^[1-9][0-9]{0,8}$/
const DESIGN_BRAND = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/

/**
 * The pin the canary replica passes (`{ design, designBrand? }`, as `designPinFromUrl` returns it),
 * judged. `undefined` ONLY for undefined or null: no pin. A `design` (string or number) and an optional
 * `designBrand` string that both pass the API's grammars are a pin. Anything else is `'invalid'`,
 * including a `designBrand` without a valid `design`, and the card renders nothing for it: a pin that
 * cannot be read never falls back to the live design. Keys other than these two are ignored.
 */
export function parseDesignPin(raw: unknown): DesignPin | 'invalid' | undefined {
	if (raw === undefined || raw === null) return undefined
	if (!isRecord(raw)) return 'invalid'
	const { design, designBrand } = raw
	const version = typeof design === 'number' ? String(design) : design
	if (typeof version !== 'string' || !DESIGN_VERSION.test(version)) return 'invalid'
	if (designBrand !== undefined && (typeof designBrand !== 'string' || !DESIGN_BRAND.test(designBrand))) {
		return 'invalid'
	}
	return designBrand === undefined ? { version: Number(version) } : { version: Number(version), brand: designBrand }
}

/**
 * The raw pin on a page URL, for the canary replica to hand the card as Builder `context`:
 * `searchParams` `design` and `designBrand`, as strings (`design` is '' when only `designBrand` is
 * there, which `parseDesignPin` judges invalid). `undefined` when neither is present, or when `url`
 * does not parse. Never throws; a relative URL is read against a placeholder origin.
 */
export function designPinFromUrl(url: string | URL): { design: string; designBrand?: string } | undefined {
	let params: URLSearchParams
	try {
		params = new URL(url, 'http://x').searchParams
	} catch {
		return undefined
	}
	const design = params.get('design')
	const designBrand = params.get('designBrand')
	if (design === null && designBrand === null) return undefined
	return designBrand === null ? { design: design ?? '' } : { design: design ?? '', designBrand }
}

/**
 * The def sibling, shape-checked. Anything that is not the metafield shape is null, which paints
 * the preset default (the same thing an absent def paints): a def is presentation, never a claim,
 * so a malformed one degrades the styling and nothing else. The TOKEN VALUES are not judged here;
 * `resolveBlockTheme` re-validates each at paint time and drops what is not a safe value.
 */
export function parseRenderDef(value: unknown): CertChromeRenderDef | null {
	if (!isRecord(value)) return null
	const { v, preset, rung, tokens, hidden, barInkFg, accentFg, face: faceName, layout, customFace } = value
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
		// 1.2.0: the reader face's two keys. 1.1.x dropped both; they are kept only when well-formed, so a def that
		// carries neither parses to exactly the object 1.1.1 returned for it.
		...(accentFg === '#141414' || accentFg === '#ffffff' ? { accentFg } : {}),
		...(isString(faceName) ? { face: faceName } : {}),
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
			deliveryUrl(opts.baseUrl, opts.platform, opts.externalId, opts.design),
			{ headers: { accept: 'application/json' } },
			opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
		)
	} catch {
		// Unreachable, DNS/TLS, or the deadline. Same least-wrong member as getVerifiedEnvelope.
		return unreachable()
	}
	// Nothing served for this placement: never certified, or withdrawn. A LIVE revocation is a 200
	// tombstone, so a 4xx here genuinely means "no credential for this subject".
	if (res.status === 404 || res.status === 410) return suppressed('subject_mismatch')
	if (!res.ok) return unreachable()
	let body: unknown
	try {
		body = await res.json()
	} catch {
		return unreachable()
	}
	if (!isRecord(body)) return unreachable()
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
	// A `render` verdict came from an envelope (a tombstone never renders), so `signature` is the one just verified.
	const signature = isRecord(body.signature) ? (body.signature as unknown as CertSignature) : undefined
	return {
		kind: 'verified',
		payload: verdict.payload,
		renderDef: parseRenderDef(body.renderDef),
		...(signature ? { signature } : {}),
	}
}

/** Apply the render-time policy to a cached read: lifecycle + subject at THIS render's clock. */
export function settleDelivery(cached: CachedDelivery, context: RenderContext): VerifiedDelivery {
	if (cached.kind === 'suppressed') {
		return {
			verdict: { decision: 'suppress', reason: cached.reason },
			renderDef: null,
			...(cached.unreachable ? { unreachable: true as const } : {}),
		}
	}
	const verdict = renderVerdict(cached.payload, context)
	if (verdict.decision !== 'render') return { verdict, renderDef: null }
	return { verdict, renderDef: cached.renderDef, ...(cached.signature ? { signature: cached.signature } : {}) }
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
		isUnreachable,
	)
	return settleDelivery(cached, opts.context)
}

/**
 * 1.2.0, the synchronous read a render uses: the settled answer for a fresh cached read; or, inside the cache's
 * stale window, the stale read's answer at once while ONE background refresh (the same fetch `getVerifiedDelivery`
 * makes) replaces it; else `undefined`, and the caller awaits `getVerifiedDelivery`. The verdict is still settled
 * at `context.now`, so a stale payload that has expired or been revoked in its own fields still suppresses.
 */
export function readVerifiedDelivery(opts: GetVerifiedDeliveryOptions): VerifiedDelivery | undefined {
	const cache = opts.cache ?? sharedDeliveryCache
	const cached = cache.peekOrRefresh(
		deliveryCacheKey(opts),
		() => loadDelivery(opts),
		(v) => v.kind === 'suppressed',
		opts.ttlMs,
		isUnreachable,
	)
	return cached === undefined ? undefined : settleDelivery(cached, opts.context)
}

/**
 * The synchronous read: the settled answer when a fresh read is cached, else `undefined` (the
 * caller then awaits `getVerifiedDelivery`). Never fetches.
 */
export function peekVerifiedDelivery(
	opts: Pick<GetVerifiedDeliveryOptions, 'baseUrl' | 'platform' | 'externalId' | 'context' | 'cache' | 'design'>,
): VerifiedDelivery | undefined {
	const cached = (opts.cache ?? sharedDeliveryCache).peek(deliveryCacheKey(opts))
	return cached === undefined ? undefined : settleDelivery(cached, opts.context)
}

/** Drop the cached read for one placement (e.g. from a revocation webhook); with `design`, that pinned read. */
export function invalidateDelivery(
	opts: Pick<GetVerifiedDeliveryOptions, 'baseUrl' | 'platform' | 'externalId' | 'context' | 'design'>,
	cache: TtlCache<CachedDelivery> = sharedDeliveryCache,
): void {
	cache.delete(deliveryCacheKey(opts))
}

export { sharedDeliveryCache }
