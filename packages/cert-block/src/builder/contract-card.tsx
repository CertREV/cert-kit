/**
 * The contract-1 card face (2.0.0): one Builder block printing CertREV's server-rendered card verbatim.
 *
 * The block's wrapper holds, as its `dangerouslySetInnerHTML`, exactly `cardHtml(card, names)`: the block's part hosts
 * in page order and, in the block holding the document's first part, the head fragment, both CertREV dialog hosts and
 * the page's graph (`card-contract.ts`). 2.1.1: no runtime tag; the card loads the runtime itself (below).
 * Each host is a `<certrev-card>` with a declarative shadow root (`<template shadowrootmode="open">`), which the
 * browser's HTML parser attaches as it reads the server's page: the card is complete with JavaScript off, and no page
 * rule reaches inside it. React never reconciles the hosts (they are not React children), so the hosted runtime may
 * remove a revoked placement's hosts without React noticing.
 *
 * What the parser does not do, the card does once it has mounted (`useCardRoots`):
 *  - ATTACH ROOTS the parser never saw. A card React inserts (an in-app navigation, Builder's editor, React's own
 *    re-render after a hydration error) gets its HTML through `innerHTML`, which leaves a declarative template inert.
 *    The wrapper is re-parsed with `setHTMLUnsafe`, which attaches declarative roots; a browser without it (or without
 *    declarative shadow DOM at all) gets each root attached from its template (`attachShadow` with the template's mode
 *    and options, then the template's content). A host that already has its root is left alone, so a hydrated card,
 *    whose roots the parser attached, is not touched.
 *  - LOAD THE RUNTIME: once per page, into `document.head`, with its SRI integrity and `crossorigin="anonymous"`, unless
 *    the runtime is already running (its global guard) or already injected. Only the block that prints the page's
 *    assets loads it (`cardCarriesAssets`), on a client mount and on hydration of the server's page alike. 2.1.1: the
 *    server's HTML no longer carries the runtime's tag, so this is the one load: a script the page's own (nonced)
 *    bundle inserts is what a `'nonce-…' 'strict-dynamic'` policy allows, where a parser-inserted tag is blocked.
 * Both run in a layout effect, before the browser paints the inserted card, so a client-mounted card never shows an
 * empty frame; the roots are checked after every commit of the block, whatever React wrote. React writes the card only
 * when its HTML changes: the `dangerouslySetInnerHTML` object is kept per string, since React 19 rewrites `innerHTML`
 * for every new object (2.0.0 on React 19 rebuilt the card on each re-render, and the hosted runtime re-attached it).
 *
 * NO CONSOLE NOISE (2.0.1). In a browser that parses declarative roots, the HTML React itself writes names each
 * template's mode `data-certrev-shadowrootmode` instead of `shadowrootmode` (`clientCardHtml`): Chrome warns ("Found
 * declarative shadowrootmode attribute on a template, but declarative Shadow DOM is not being parsed") for every such
 * template `innerHTML` meets, and the layout effect re-parses the card's exact bytes anyway. The wrapper carries
 * `suppressHydrationWarning` (React never prints it): the server's wrapper holds attached roots where React expects
 * templates, which React's development build reported as a hydration mismatch on every page. React does not patch a
 * hydrated element's HTML, so the server's card stays as the parser built it. A server, and a DOM without declarative
 * roots (jsdom, an old browser), print the card's bytes unchanged.
 *
 * ONE BUILDER RULE, for the sidebar card only. The card's rail is a right float that the article's copy flows around
 * (the Appearance preview's layout, and every other CMS's). On a Builder page the block sits in Builder's own wrapper,
 * a flex item of the flex column that holds the entry's blocks, and a flex item contains its floats: the block spans
 * the column at the rail's height and no copy sits beside it. `BUILDER_CARD_FLOW_CSS` lets the float out of Builder's
 * wrappers, as 1.2.0-canary.6 did for the reader face: in a column that holds a printed rail, above the card's own
 * 820px breakpoint (below it the rail stacks as a block), the column lays its blocks out as blocks and still contains
 * the float, and the rail's block and the card wrapper become plain blocks. It reaches nothing inside the card (the
 * shadow root is out of its reach) and nothing on a page without a rail, or in a browser without `:has()`.
 */

import * as React from 'react'
import { maybeSendBrowserHealth } from './card-beacon.js'
import { type CardDocumentV1, type CardPartName, cardCarriesAssets, cardHtml } from './card-contract.js'
import { afterPageSettles, applyCardPlacement } from './card-placement.js'
import { SEED_ATTRIBUTE } from './ssr-seed.js'

/** The global the hosted runtime sets once it has started (`Symbol.for('certrev.card-runtime')` on `document`). */
const RUNTIME_GUARD = Symbol.for('certrev.card-runtime')
/** Marks the runtime tag this package injected into `document.head`. */
const INJECTED_RUNTIME_ATTRIBUTE = 'data-certrev-card-runtime'

/** A layout effect in a browser; nothing on a server (where React would only warn about it). */
const useBrowserLayoutEffect = typeof document === 'undefined' ? () => {} : React.useLayoutEffect

/** What a client render prints in place of a template's `shadowrootmode` (the header comment). */
export const INERT_MODE_ATTRIBUTE = 'data-certrev-shadowrootmode'

/** Whether this DOM parses declarative shadow roots (a browser does; a server and jsdom do not). */
function parsesDeclarativeRoots(): boolean {
	return typeof HTMLTemplateElement === 'function' && 'shadowRootMode' in HTMLTemplateElement.prototype
}

/** The card's HTML as React writes it in such a browser: each template's mode under `INERT_MODE_ATTRIBUTE`. */
export function clientCardHtml(html: string): string {
	return html.replace(/<template\b([^>]*?)\sshadowrootmode=/gi, `<template$1 ${INERT_MODE_ATTRIBUTE}=`)
}

/** The template's declared mode, under either name. */
function declaredMode(template: Element): string | null {
	return template.getAttribute('shadowrootmode') ?? template.getAttribute(INERT_MODE_ATTRIBUTE)
}

/** Whether this host still holds an unattached declarative root. */
function pendingTemplate(host: Element): HTMLTemplateElement | null {
	if ((host as HTMLElement).shadowRoot) return null
	for (const child of Array.from(host.children)) {
		if (child instanceof HTMLTemplateElement && declaredMode(child) !== null) return child
	}
	return null
}

/** Attach one host's root from its template, as the parser would have: its mode, its options, its content. */
function attachFromTemplate(host: HTMLElement, template: HTMLTemplateElement): void {
	const mode = declaredMode(template) === 'closed' ? 'closed' : 'open'
	const init: ShadowRootInit & { clonable?: boolean; serializable?: boolean } = {
		mode,
		delegatesFocus: template.hasAttribute('shadowrootdelegatesfocus'),
		...(template.hasAttribute('shadowrootclonable') ? { clonable: true } : {}),
		...(template.hasAttribute('shadowrootserializable') ? { serializable: true } : {}),
	}
	const root = host.attachShadow(init)
	root.appendChild(template.content)
	template.remove()
}

/**
 * Give every host in `wrapper` its declarative root: a no-op where the parser attached them all; else the wrapper is
 * re-parsed from `html` with `setHTMLUnsafe` where the browser has it, or each pending root is attached from its
 * template. Returns how many hosts were pending (for tests and the replica's evidence).
 */
export function attachCardRoots(wrapper: Element, html: string): number {
	const pending = Array.from(wrapper.querySelectorAll('certrev-card')).filter((host) => pendingTemplate(host) !== null)
	if (pending.length === 0) return 0
	const parse = (wrapper as Element & { setHTMLUnsafe?: (html: string) => void }).setHTMLUnsafe
	if (typeof parse === 'function') {
		parse.call(wrapper, html)
		// A browser whose setHTMLUnsafe predates declarative roots leaves templates behind: attach those by hand.
		for (const host of Array.from(wrapper.querySelectorAll('certrev-card'))) {
			const template = pendingTemplate(host)
			if (template) attachFromTemplate(host as HTMLElement, template)
		}
		return pending.length
	}
	for (const host of pending) {
		const template = pendingTemplate(host)
		if (template) attachFromTemplate(host as HTMLElement, template)
	}
	return pending.length
}

/** Load the document's runtime once per page: unless it already runs, or this package already injected it. */
export function injectCardRuntime(card: CardDocumentV1): void {
	const runtime = card.assets.runtime
	if (!runtime || typeof document === 'undefined' || !document.head) return
	if ((document as unknown as Record<symbol, unknown>)[RUNTIME_GUARD]) return
	for (const script of Array.from(document.head.querySelectorAll(`script[${INJECTED_RUNTIME_ATTRIBUTE}]`))) {
		if (script.getAttribute('src') === runtime.src) return
	}
	const script = document.createElement('script')
	// Attributes, not IDL properties: the markup is then exactly the server's tag, wherever a property is not reflected.
	script.setAttribute('src', runtime.src)
	script.setAttribute('integrity', runtime.integrity)
	script.setAttribute('crossorigin', 'anonymous')
	script.defer = true
	script.setAttribute(INJECTED_RUNTIME_ATTRIBUTE, '')
	document.head.appendChild(script)
}

/** Builder's wrappers around a printed rail let its float out (the header comment). */
export const BUILDER_CARD_FLOW_CSS =
	'@media not all and (max-width: 820px){' +
	'.builder-blocks:has(> .builder-block > [data-certrev-face="card"] > certrev-card[data-certrev-part="rail"]){display:flow-root !important}' +
	'.builder-blocks > .builder-block:has(> [data-certrev-face="card"] > certrev-card[data-certrev-part="rail"]){display:block !important}' +
	'.builder-blocks > .builder-block > [data-certrev-face="card"]:has(> certrev-card[data-certrev-part="rail"]){display:block !important}' +
	'}'

/** One object for the flow rule's element, so React 19 never rewrites it on a re-render. */
const BUILDER_CARD_FLOW_HTML = { __html: BUILDER_CARD_FLOW_CSS }

export function ContractCardFace(props: {
	readonly card: CardDocumentV1
	readonly names: readonly CardPartName[]
	/** The record that names this card (`ssr-seed.ts`): the browser repaints it from here with no read. */
	readonly seed: string
	/** 2.0.1: the delivery origin the block read, where its sampled health beacon goes (`card-beacon.ts`). */
	readonly origin?: string
}) {
	const ref = React.useRef<HTMLDivElement>(null)
	const html = cardHtml(props.card, props.names)
	const printed = typeof document !== 'undefined' && parsesDeclarativeRoots() ? clientCardHtml(html) : html
	// One object per printed string: React 19 rewrites `innerHTML` whenever this prop is a new object (React 18 compared
	// the strings), which would replace the attached card on every re-render.
	const inner = React.useMemo(() => ({ __html: printed }), [printed])
	const { card } = props
	const carriesAssets = cardCarriesAssets(card, props.names)
	// After every commit of this block (a no-op while every root is attached): whatever React wrote, the card has its roots
	// before the browser paints.
	useBrowserLayoutEffect(() => {
		if (ref.current) attachCardRoots(ref.current, html)
	})
	useBrowserLayoutEffect(() => {
		if (ref.current && carriesAssets) injectCardRuntime(card)
	}, [card, carriesAssets])
	const { origin } = props
	React.useEffect(() => {
		maybeSendBrowserHealth(origin, card.subject.externalId)
	}, [origin, card])
	// 2.0.1: the document's placement hints, once the page has settled (`card-placement.ts`). Keyed on the printed HTML,
	// which the document and the parts decide, so a re-render that prints the same card moves nothing again.
	const placing = React.useRef({ card, names: props.names })
	placing.current = { card, names: props.names }
	// biome-ignore lint/correctness/useExhaustiveDependencies: `html` is the trigger on purpose; the document and parts are read from the ref
	React.useEffect(() => {
		const wrapper = ref.current
		if (!wrapper) return
		return afterPageSettles(() => applyCardPlacement(wrapper, placing.current.card, placing.current.names))
	}, [html])
	const wrapper = (
		<div
			ref={ref}
			data-certrev-cert-chrome=""
			data-certrev-delivery=""
			data-certrev-face="card"
			data-certrev-contract={String(props.card.contract)}
			data-certrev-def-version={props.card.defVersion}
			{...{ [SEED_ATTRIBUTE]: props.seed }}
			suppressHydrationWarning
			// biome-ignore lint/security/noDangerouslySetInnerHtml: CertREV's card document, printed only after it hashes to the digest the verified envelope signs
			dangerouslySetInnerHTML={inner}
		/>
	)
	if (!props.names.includes('rail')) return wrapper
	return (
		<>
			{wrapper}
			{/* biome-ignore lint/security/noDangerouslySetInnerHtml: a package constant; React would escape the `>` and `"` of its selectors */}
			<style data-certrev-builder-flow="" dangerouslySetInnerHTML={BUILDER_CARD_FLOW_HTML} />
		</>
	)
}
