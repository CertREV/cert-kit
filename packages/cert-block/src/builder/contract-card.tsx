/**
 * The contract-1 card face (2.0.0): one Builder block printing CertREV's server-rendered card verbatim.
 *
 * The block's wrapper holds, as its `dangerouslySetInnerHTML`, exactly `cardHtml(card, names)`: the document's head
 * fragment, the block's part hosts in page order, both CertREV dialog hosts and the runtime's tag (`card-contract.ts`).
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
 *    injected. The server's HTML carries the same tag in the wrapper, which the parser runs; the runtime's init is
 *    idempotent, so a page with two blocks loads it twice at most and starts it once.
 * Both run in a layout effect, before the browser paints the inserted card, so a client-mounted card never shows an
 * empty frame.
 */

import * as React from 'react'
import { type CardDocumentV1, type CardPartName, cardHtml } from './card-contract.js'
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
	script.src = runtime.src
	script.integrity = runtime.integrity
	script.crossOrigin = 'anonymous'
	script.defer = true
	script.setAttribute(INJECTED_RUNTIME_ATTRIBUTE, '')
	document.head.appendChild(script)
}

export function ContractCardFace(props: {
	readonly card: CardDocumentV1
	readonly names: readonly CardPartName[]
	/** The record that names this card (`ssr-seed.ts`): the browser repaints it from here with no read. */
	readonly seed: string
}) {
	const ref = React.useRef<HTMLDivElement>(null)
	const html = cardHtml(props.card, props.names)
	const { card } = props
	useBrowserLayoutEffect(() => {
		const wrapper = ref.current
		if (!wrapper) return
		attachCardRoots(wrapper, html)
		injectCardRuntime(card)
	}, [html, card])
	return (
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
}
