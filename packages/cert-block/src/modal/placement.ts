/**
 * Cert-card PLACEMENT for the single `target: body` CertREV app embed.
 *
 * The embed renders globally just before `</body>` — the only theme-app-extension primitive that
 * reliably renders on modern themes (Horizon and others forbid app blocks inside the blog-post
 * content section, so an in-content app block isn't available). On DOM-ready this module, ONCE:
 *
 *   (a) Relocates the @graph `<script data-certrev-graph>` into `<head>`. JSON-LD is inert, so the
 *       move is invisible + reliable: JS-executing crawlers (Google + most AI fetchers) read it
 *       head-side, while non-JS fetchers still read the server-rendered copy that shipped in
 *       `<body>`. The AEO payload is never gambled on body-only.
 *   (b) Repositions the TWO cert wrappers to mirror the legacy iframe layout (iframe→native parity),
 *       BOTH anchored off the html-generator's `#references` list so they land in the SAME article:
 *         • `.certrev-card-wrap` (`data-certrev-anchor="top"`)   → the TOP of the article content
 *           that OWNS `#references` (the contributors banner sat at the top of the legacy `body_html`).
 *         • `.certrev-memo-wrap` (`data-certrev-anchor="bottom"`) → the BOTTOM, just before the
 *           references list if present (where the legacy inline memo sat), else after the article.
 *       When no references exist, each falls back to a chrome-aware semantic-landmark / theme-class
 *       scan, with a STYLED end-of-article fallback when nothing matches.
 *   (c) Records the matched tier on each wrap as `data-certrev-placement` — the observability the
 *       pre-launch theme-matrix sweep + the POR-9578 liveness check read, so a silent misplacement
 *       becomes an inspectable signal rather than a surprise on a real brand's store.
 *
 * It runs BEFORE the badge re-verify pass and never moves a wrap twice, so the `<certrev-badge>`
 * element is never detached/re-attached mid-verify (no duplicate Delivery-API calls).
 */

/** Anchor tiers for the BOTTOM (memo) wrap, best→worst — landmarks first (stable across themes),
 *  theme classes last, above the styled body-bottom fallback. The memo is appended AFTER the matched
 *  anchor (or just before the references list). */
export const PLACEMENT_ANCHORS: ReadonlyArray<{ readonly selector: string; readonly tier: string }> = [
	{ selector: 'main article', tier: 'article' },
	{ selector: 'article', tier: 'article' },
	{ selector: 'main', tier: 'main' },
	{ selector: '.article-template__content', tier: 'theme-class' },
	{ selector: '[id^="ArticleContent"]', tier: 'theme-class' },
	{ selector: '.rte', tier: 'theme-class' },
]

/** Anchor tiers for the TOP (contributors card) wrap. Body-CONTENT containers come FIRST so the
 *  `afterbegin` insert lands above the article text but below the title/hero — matching the legacy
 *  contributors banner's first-in-`body_html` position. The post-level landmarks (`article`/`main`)
 *  are the fallback (an `afterbegin` there may land above an in-element title; acceptable + flagged
 *  for per-theme tuning, and observable via the recorded tier). */
export const TOP_ANCHORS: ReadonlyArray<{ readonly selector: string; readonly tier: string }> = [
	{ selector: '.article-template__content', tier: 'theme-class' },
	{ selector: '[id^="ArticleContent"]', tier: 'theme-class' },
	{ selector: '.rte', tier: 'theme-class' },
	{ selector: 'main article', tier: 'article' },
	{ selector: 'article', tier: 'article' },
	{ selector: 'main', tier: 'main' },
]

/** The union of TOP_ANCHORS selectors — the shapes that count as an "article content container". The
 *  card resolves its anchor by walking UP from `#references` (`closest`) to the nearest of these, so
 *  it lands in the exact article body that owns the references — never a same-classed element that
 *  merely precedes the article in document order (see placeWrap + SITE_CHROME_SELECTOR). */
export const TOP_CONTENT_SELECTOR = TOP_ANCHORS.map((a) => a.selector).join(', ')

/** Site-chrome containers a cert wrap must NEVER anchor into. The anchor selectors (`.rte` / `article`
 *  / `main`) are NOT article-exclusive on real merchant themes: a VISIBLE announcement bar, header,
 *  footer, nav, or cart drawer often carries its own `.rte` that precedes the article in document
 *  order — IntelliPure's announcement bar is literally `<div class="announcement__content … rte">`.
 *  `isRenderable` can't reject those (they're visible), so `querySelector('.rte')` returned the
 *  announcement bar and the contributors card was injected there instead of the article (POR-9809 —
 *  "contributors not showing"). Placement scopes anchors out of chrome STRUCTURALLY via this set. */
export const SITE_CHROME_SELECTOR =
	'header, [role="banner"], [class*="announcement"], footer, [role="contentinfo"], nav, [role="navigation"], cart-drawer, .cart-drawer, .drawer, .mini-cart, .modal, [role="dialog"]'

/** Achieved-tier attribute the JS stamps on each wrap (CSS body-fallback styling + observability). */
export const PLACEMENT_ATTR = 'data-certrev-placement'
/** Desired-position marker the Liquid sets on each wrap: `top` (card) | `bottom` (memo). */
export const ANCHOR_TARGET_ATTR = 'data-certrev-anchor'
export const GRAPH_SELECTOR = 'script[type="application/ld+json"][data-certrev-graph]'
export const CARD_WRAP_SELECTOR = '.certrev-card-wrap'
export const MEMO_WRAP_SELECTOR = '.certrev-memo-wrap'
/** The floating-pill wrap (layout 'floating'). CSS owns its fixed placement; the JS only stamps it. */
export const PILL_WRAP_SELECTOR = '.certrev-pill-wrap'
/** Min free right gutter (px) beside the article column for the fixed rail. 320 rail + margins. */
export const RAIL_MIN_GUTTER = 384
/** Gap (px) between the article column's right edge and the fixed rail. */
export const RAIL_GAP = 24
/** The article's references list (emitted by html-generator into the clean body_html). The memo
 *  renders just before it, matching the legacy inline-memo position (memo → references). */
export const REFERENCES_SELECTOR = '#references'

export interface PlaceResult {
	/** Whether the wrapper was moved to an article anchor (false on the body-bottom fallback). */
	readonly anchored: boolean
	/** The matched anchor tier (`references` | `article` | `main` | `theme-class` | `body-fallback`). */
	readonly tier: string
}

export interface PlaceCertResult {
	/** Whether the @graph script was relocated into <head> this pass. */
	readonly graph: boolean
	/** Placement of the contributors card wrap (null when absent). */
	readonly card: PlaceResult | null
	/** Placement of the memo wrap (null when absent). */
	readonly memo: PlaceResult | null
}

/**
 * Whether `el` is RENDERABLE — not inside a `display:none` / `visibility:hidden` / `[hidden]` /
 * `aria-hidden` subtree. The guard exists because anchor selectors like `.rte` / `main` / `article`
 * are NOT article-exclusive on real merchant themes: a CLOSED cart-drawer / nav / search popup often
 * carries its own `.rte` (e.g. an empty-cart message) that sits BEFORE the article in document order,
 * so `querySelector('.rte')` returns the DRAWER's copy and the cert card gets relocated into a hidden
 * panel — invisible to the reader (observed live on IntelliPure's theme: the card landed in
 * `<cart-drawer hidden>`). Skipping hidden matches makes placement fall through to the visible article
 * content for BOTH the top card and the bottom memo.
 *
 * Walks ancestors via `getComputedStyle` + the hidden/aria-hidden attributes (NOT `offsetParent`,
 * which jsdom always reports null since it does no layout — that would false-reject everything in the
 * unit suite). Normal elements compute `display:block` / `visibility:visible` and pass.
 */
function isRenderable(el: Element): boolean {
	for (let node: Element | null = el; node; node = node.parentElement) {
		if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false
		const style = getComputedStyle(node as HTMLElement)
		if (style.display === 'none' || style.visibility === 'hidden') return false
	}
	return true
}

/**
 * Whether `el` sits inside SITE CHROME (announcement bar / header / footer / nav / cart drawer /
 * modal). Complements `isRenderable`: chrome anchors are usually VISIBLE, so the visibility guard
 * can't reject them — but a cert wrap must never anchor there. This is the guard that keeps the
 * contributors card out of IntelliPure's `.rte`-classed announcement bar (POR-9809).
 */
function isInSiteChrome(el: Element): boolean {
	return el.closest(SITE_CHROME_SELECTOR) !== null
}

/** Observability tier for an already-resolved container: the first anchor selector it matches
 *  (`theme-class` | `article` | `main`), defaulting to `article`. Used to record the tier of the
 *  `#references`-resolved card container so the placement attribute stays in the known vocabulary. */
function anchorTier(el: Element, anchors: ReadonlyArray<{ readonly selector: string; readonly tier: string }>): string {
	for (const { selector, tier } of anchors) if (el.matches(selector)) return tier
	return 'article'
}

/**
 * First anchor that exists, is RENDERABLE (not in a hidden drawer/popup), is NOT site chrome (a
 * visible announcement bar / header / nav — POR-9809), and is safely positionable relative to
 * `wrap`. Iterates ALL matches per selector (not just the first in document order) so an unusable
 * early match (a closed drawer's `.rte`, or the announcement bar's) is skipped for the article copy.
 */
function firstUsableAnchor(
	doc: Document,
	wrap: HTMLElement,
	anchors: ReadonlyArray<{ readonly selector: string; readonly tier: string }>,
): { readonly el: Element; readonly tier: string } | null {
	for (const { selector, tier } of anchors) {
		for (const el of Array.from(doc.querySelectorAll(selector))) {
			// Never anchor to the wrap itself or to an element that contains / is contained by it (that
			// would detach the wrap into its own subtree or no-op the move), never to a HIDDEN match, and
			// never into site chrome (a visible announcement bar / header / nav carrying its own `.rte`).
			if (el !== wrap && !el.contains(wrap) && !wrap.contains(el) && isRenderable(el) && !isInSiteChrome(el))
				return { el, tier }
		}
	}
	return null
}

/**
 * Reposition ONE wrap to its `data-certrev-anchor` target. Idempotent: a wrap already carrying
 * `data-certrev-placement` is left untouched (records the achieved tier on first pass).
 */
export function placeWrap(doc: Document, wrap: HTMLElement): PlaceResult {
	const existing = wrap.getAttribute(PLACEMENT_ATTR)
	if (existing) return { anchored: existing !== 'body-fallback', tier: existing }

	const anchorAttr = wrap.getAttribute(ANCHOR_TARGET_ATTR)

	// RAIL (layout 'sidebar'): pin the whole rail beside the article column when there's room, else
	// gracefully fall back to the banner-style in-flow TOP placement (a full-width card). The owner is
	// resolved exactly like the top card (`#references` → closest content container, chrome-aware).
	if (anchorAttr === 'rail') {
		const refs = doc.querySelector(REFERENCES_SELECTOR)
		const owner = refs?.closest(TOP_CONTENT_SELECTOR) ?? firstUsableAnchor(doc, wrap, TOP_ANCHORS)?.el ?? null
		const win = doc.defaultView
		if (owner && win && isRenderable(owner) && !isInSiteChrome(owner)) {
			const rect = owner.getBoundingClientRect()
			const gutter = win.innerWidth - rect.right
			if (gutter >= RAIL_MIN_GUTTER) {
				// Fixed gutter rail — the working "sticky" for an injected widget (a CSS-sticky float has no
				// stick room without theme layout control). The wrap stays at the embed point.
				wrap.style.setProperty('--certrev-rail-left', `${Math.round(rect.right + RAIL_GAP)}px`)
				wrap.setAttribute(PLACEMENT_ATTR, 'rail')
				return { anchored: true, tier: 'rail' }
			}
			// GRACEFUL FALLBACK: no gutter → banner-style in-flow top placement (full-width card).
			owner.insertAdjacentElement('afterbegin', wrap)
			const fallbackTier = anchorTier(owner, TOP_ANCHORS)
			wrap.setAttribute(PLACEMENT_ATTR, fallbackTier)
			return { anchored: true, tier: fallbackTier }
		}
		wrap.setAttribute(PLACEMENT_ATTR, 'body-fallback')
		return { anchored: false, tier: 'body-fallback' }
	}

	const target = anchorAttr === 'bottom' ? 'bottom' : 'top'
	let tier = 'body-fallback'

	if (target === 'top') {
		// Anchor the card to the TOP of the article CONTENT that OWNS `#references` — the same reliable
		// marker the memo uses at the bottom. `#references` (emitted by the html-generator, always present
		// on a certified article) lives INSIDE the body-content container, so `closest(TOP_CONTENT_SELECTOR)`
		// resolves the exact article `.rte` / `article` / `main` — never a same-classed site-chrome element
		// that merely precedes the article in document order (IntelliPure's `.rte` announcement bar, which
		// is visible so isRenderable can't reject it — POR-9809 "contributors not showing"). This also ties
		// the card + memo to the SAME article region by construction.
		const refs = doc.querySelector(REFERENCES_SELECTOR)
		const owner = refs?.closest(TOP_CONTENT_SELECTOR) ?? null
		if (
			owner &&
			owner !== wrap &&
			!owner.contains(wrap) &&
			!wrap.contains(owner) &&
			isRenderable(owner) &&
			!isInSiteChrome(owner)
		) {
			// First child of the content container → above the article text, below the title/hero.
			owner.insertAdjacentElement('afterbegin', wrap)
			tier = anchorTier(owner, TOP_ANCHORS)
		} else {
			// No references (rare) → fall back to the chrome-aware anchor scan.
			const found = firstUsableAnchor(doc, wrap, TOP_ANCHORS)
			if (found) {
				found.el.insertAdjacentElement('afterbegin', wrap)
				tier = found.tier
			}
		}
	} else {
		// Memo → just before the references list when one exists. The references are the reliable
		// bottom-of-content marker INDEPENDENT of which landmark matched: a theme can have a small hero
		// <article> BEFORE the content <article> (IntelliPure: `article banner` then `article
		// page-width`), and `firstUsableAnchor` matches the hero first — so `afterend(hero)` would
		// strand the memo at the TOP, above the card. Anchoring off `#references` (the html-generator's
		// references list, always present on a certified article) avoids that. The old code required the
		// refs to live INSIDE the matched landmark (`found.el.contains(refs)`), which failed exactly when
		// the matched landmark was the hero and the refs were in the separate content article.
		const refs = doc.querySelector(REFERENCES_SELECTOR)
		if (refs && refs !== wrap && !wrap.contains(refs) && !refs.contains(wrap) && isRenderable(refs)) {
			refs.insertAdjacentElement('beforebegin', wrap)
			tier = 'references'
		} else {
			const found = firstUsableAnchor(doc, wrap, PLACEMENT_ANCHORS)
			if (found) {
				found.el.insertAdjacentElement('afterend', wrap)
				tier = found.tier
			}
		}
	}

	wrap.setAttribute(PLACEMENT_ATTR, tier)
	return { anchored: tier !== 'body-fallback', tier }
}

/** Relocate the @graph into `<head>`, then reposition the card (top) + memo (bottom) wraps — ONCE. */
export function placeCert(doc: Document): PlaceCertResult {
	// (a) @graph → <head> (idempotent: skip if already there or absent).
	const graph = doc.querySelector(GRAPH_SELECTOR)
	let graphMoved = false
	if (graph && graph.parentNode !== doc.head) {
		doc.head.appendChild(graph)
		graphMoved = true
	}

	// (b)+(c) reposition each wrap to its target, once.
	const cardEl = doc.querySelector<HTMLElement>(CARD_WRAP_SELECTOR)
	const memoEl = doc.querySelector<HTMLElement>(MEMO_WRAP_SELECTOR)
	// The floating pill (layout 'floating') is CSS-fixed — no repositioning; stamp it for observability
	// only, so a live-liveness check still sees a placement attribute on the pill wrap.
	doc.querySelector<HTMLElement>(PILL_WRAP_SELECTOR)?.setAttribute(PLACEMENT_ATTR, 'pill-fixed')
	return {
		graph: graphMoved,
		card: cardEl ? placeWrap(doc, cardEl) : null,
		memo: memoEl ? placeWrap(doc, memoEl) : null,
	}
}

/**
 * A fixed sidebar rail only fits while the article column leaves ≥`RAIL_MIN_GUTTER` of right gutter;
 * a viewport shrink (resize / rotate) can erase it. Bind a debounced resize listener that re-measures
 * and, on gutter loss, DEMOTES the rail to the in-flow banner-style top placement — ONE-WAY (never
 * bounces back on scrollbar jitter): once demoted the listener detaches. No-op unless a fixed rail
 * exists. Idempotent per pass (a rail already demoted carries no `rail` placement so it's skipped).
 */
function bindRailResize(doc: Document): void {
	const win = doc.defaultView
	if (!win) return
	const wrap = doc.querySelector<HTMLElement>(`${MEMO_WRAP_SELECTOR}[${ANCHOR_TARGET_ATTR}="rail"]`)
	if (!wrap || wrap.getAttribute(PLACEMENT_ATTR) !== 'rail') return

	let timer: ReturnType<typeof setTimeout> | undefined
	const onResize = (): void => {
		if (timer) clearTimeout(timer)
		timer = setTimeout(() => {
			// Only act while still a fixed rail; once demoted we're done (one-way — no bounce-back).
			if (wrap.getAttribute(PLACEMENT_ATTR) !== 'rail') {
				win.removeEventListener('resize', onResize)
				return
			}
			const refs = doc.querySelector(REFERENCES_SELECTOR)
			const owner = refs?.closest(TOP_CONTENT_SELECTOR) ?? firstUsableAnchor(doc, wrap, TOP_ANCHORS)?.el ?? null
			const gutter = owner ? win.innerWidth - owner.getBoundingClientRect().right : 0
			if (gutter < RAIL_MIN_GUTTER) {
				// Demote to in-flow — clear the fixed var + attr, then re-run placement once (the rail
				// branch now measures a lost gutter → the banner-style top card fallback).
				wrap.style.removeProperty('--certrev-rail-left')
				wrap.removeAttribute(PLACEMENT_ATTR)
				placeWrap(doc, wrap)
				win.removeEventListener('resize', onResize)
			}
		}, 150)
	}
	win.addEventListener('resize', onResize)
}

/** Run placement once the DOM is parsed (mirrors `initBadgeRevalidation`'s readiness handling). */
export function initCertPlacement(doc: Document): void {
	const run = (): void => {
		placeCert(doc)
		bindRailResize(doc)
	}
	if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', run, { once: true })
	else run()
}
