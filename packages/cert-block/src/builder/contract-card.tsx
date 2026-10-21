/**
 * The contract-1 card face (2.0.0): one Builder block printing CertREV's server-rendered card verbatim.
 *
 * The block's wrapper holds, as its `dangerouslySetInnerHTML`, exactly `cardHtml(card, names)`: the block's part hosts
 * in page order and, in the block holding the document's first part, the head fragment, both CertREV dialog hosts and
 * the runtime's tag (`card-contract.ts`).
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
 *  - LOAD THE RUNTIME a React-inserted `<script>` never runs: once per page, into `document.head`, with its SRI
 *    integrity and `crossorigin="anonymous"`, unless the runtime is already running (its global guard) or already
 *    injected. Only the block that prints the runtime's tag loads it (`cardCarriesAssets`). The server's HTML carries
 *    the same tag in that block's wrapper, which the parser runs; the runtime's init is idempotent, so it starts once.
 * Both run in a layout effect, before the browser paints the inserted card, so a client-mounted card never shows an
 * empty frame.
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
import { type CardDocumentV1, type CardPartName, cardCarriesAssets, cardHtml } from './card-contract.js'
import { SEED_ATTRIBUTE } from './ssr-seed.js'

/** The global the hosted runtime sets once it has started (`Symbol.for('certrev.card-runtime')` on `document`). */
const RUNTIME_GUARD = Symbol.for('certrev.card-runtime')
/** Marks the runtime tag this package injected into `document.head`. */
const INJECTED_RUNTIME_ATTRIBUTE = 'data-certrev-card-runtime'

/** A layout effect in a browser; nothing on a server (where React would only warn about it). */
const useBrowserLayoutEffect = typeof document === 'undefined' ? () => {} : React.useLayoutEffect

/** Whether this host still holds an unattached declarative root. */
function pendingTemplate(host: Element): HTMLTemplateElement | null {
	if ((host as HTMLElement).shadowRoot) return null
	for (const child of Array.from(host.children)) {
		if (child instanceof HTMLTemplateElement && child.hasAttribute('shadowrootmode')) return child
	}
	return null
}

/** Attach one host's root from its template, as the parser would have: its mode, its options, its content. */
function attachFromTemplate(host: HTMLElement, template: HTMLTemplateElement): void {
	const mode = template.getAttribute('shadowrootmode') === 'closed' ? 'closed' : 'open'
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

export function ContractCardFace(props: {
	readonly card: CardDocumentV1
	readonly names: readonly CardPartName[]
	/** The record that names this card (`ssr-seed.ts`): the browser repaints it from here with no read. */
	readonly seed: string
}) {
	const ref = React.useRef<HTMLDivElement>(null)
	const html = cardHtml(props.card, props.names)
	const { card } = props
	const carriesAssets = cardCarriesAssets(card, props.names)
	useBrowserLayoutEffect(() => {
		const wrapper = ref.current
		if (!wrapper) return
		attachCardRoots(wrapper, html)
		if (carriesAssets) injectCardRuntime(card)
	}, [html, card, carriesAssets])
	const wrapper = (
		<div
			ref={ref}
			data-certrev-cert-chrome=""
			data-certrev-delivery=""
			data-certrev-face="card"
			data-certrev-contract={String(props.card.contract)}
			data-certrev-def-version={props.card.defVersion}
			{...{ [SEED_ATTRIBUTE]: props.seed }}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: CertREV's card document, printed only after it hashes to the digest the verified envelope signs
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	)
	if (!props.names.includes('rail')) return wrapper
	return (
		<>
			{wrapper}
			{/* biome-ignore lint/security/noDangerouslySetInnerHtml: a package constant; React would escape the `>` and `"` of its selectors */}
			<style data-certrev-builder-flow="" dangerouslySetInnerHTML={{ __html: BUILDER_CARD_FLOW_CSS }} />
		</>
	)
}
