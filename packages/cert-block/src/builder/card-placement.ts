/**
 * 2.0.1: the card document's placement hints (`card.placement`, ADR 0001 §2), applied by the block in the browser, so
 * CertREV can move a banner's card and memo on a Builder page with no new install (Owen: the reviewer up top, the memo
 * at the end).
 *
 * A Builder page renders an entry as `[builder-content-id] > .builder-blocks > .builder-block`, one top-level block per
 * block the editor placed; the CertREV block is one of them. A hint names where a part belongs among those blocks:
 *
 *  - `content-start`: before the first block; with `after: 'leading-media'`, after a first block that is only media
 *    (an image, a picture, a video or an iframe, and no text);
 *  - `after-byline`: after the block that holds the article's byline: an element marked `data-certrev-anchor="byline"`
 *    first, else the first `[rel~="author"]`, `[itemprop="author"]`, `.byline`, `[class*="byline"]` or `address`;
 *  - `before-references`: before the block that opens the references (a heading or label reading References, Sources,
 *    Citations or Works cited, or an element whose id names references);
 *  - `content-end`: after the last block;
 *  - `pinned`, or any anchor this client does not know: where the editor put it.
 * An anchor that the page does not have falls back to the hint's `else`, and then to where the editor put it.
 *
 * Only a banner's parts move (`top`, `bottom`): a sidebar's rail floats beside the copy from the block the editor
 * placed, and a floating pill is pinned to the viewport. A part moves into a holder (`data-certrev-placed`) inserted
 * among the top-level blocks; the block itself stays where it was, with the card's head, dialogs and runtime.
 *
 * WHEN: in the browser only, after the page has loaded and React has hydrated (two frames after `load`), never during
 * a render or a hydration. With JavaScript off, and until then, every part is where the editor put it. A card React
 * prints again (a new document) or unmounts takes its moved parts with it first, so a part is never printed twice.
 */

import type { CardDocumentV1, CardPartName } from './card-contract.js'

const MOVABLE: readonly CardPartName[] = ['top', 'bottom']
const PLACED_ATTRIBUTE = 'data-certrev-placed'
const MEDIA = 'img, picture, video, iframe, svg'
const BYLINE_MARKED = '[data-certrev-anchor="byline"]'
const BYLINE = '[rel~="author"], [itemprop="author"], .byline, [class*="byline"], address'
const REFERENCES_TEXT = /^\s*(references|sources|citations|works cited)\s*:?\s*$/i
const REFERENCES_LABEL = 'h1, h2, h3, h4, h5, h6, strong, b, p, summary, dt, figcaption'

interface Hint {
	readonly anchor?: unknown
	readonly after?: unknown
	readonly else?: unknown
}

/** Where a part goes: before or after one of the top-level blocks, or to the end of the column. */
type Target = { readonly before: Element } | { readonly after: Element } | { readonly end: Element }

function hintFor(card: CardDocumentV1, part: CardPartName): Hint | null {
	const placement = (card as unknown as { placement?: unknown }).placement
	if (typeof placement !== 'object' || placement === null) return null
	const hint = (placement as Record<string, unknown>)[part]
	return typeof hint === 'object' && hint !== null ? (hint as Hint) : null
}

/** A block that is only media: an image (or picture, video, iframe, svg) and no text of its own. */
function mediaOnly(block: Element): boolean {
	return block.querySelector(MEDIA) !== null && (block.textContent ?? '').trim() === ''
}

function blockOf(node: Element, blocks: readonly Element[]): Element | null {
	return blocks.find((block) => block === node || block.contains(node)) ?? null
}

function referencesBlock(blocks: readonly Element[]): Element | null {
	for (const block of blocks) {
		if (/references|sources|citations/i.test(block.id)) return block
		if (block.querySelector('[id*="references" i], [id*="sources" i], [id*="citations" i]')) return block
		for (const label of Array.from(block.querySelectorAll(REFERENCES_LABEL))) {
			if (REFERENCES_TEXT.test(label.textContent ?? '')) return block
		}
	}
	return null
}

function bylineBlock(root: Element, blocks: readonly Element[], own: Element): Element | null {
	for (const selector of [BYLINE_MARKED, BYLINE]) {
		for (const node of Array.from(root.querySelectorAll(selector))) {
			const block = blockOf(node, blocks)
			if (block && block !== own) return block
		}
	}
	return null
}

/** One anchor, resolved among the top-level blocks other than the card's own; null when the page has no such place. */
function resolveAnchor(
	anchor: unknown,
	hint: Hint,
	root: Element,
	column: Element,
	blocks: readonly Element[],
	own: Element,
): Target | null {
	const others = blocks.filter((block) => block !== own)
	switch (anchor) {
		case 'content-start': {
			const first = others[0]
			if (!first) return null
			return hint.after === 'leading-media' && mediaOnly(first) ? { after: first } : { before: first }
		}
		case 'after-byline': {
			const byline = bylineBlock(root, blocks, own)
			return byline ? { after: byline } : null
		}
		case 'before-references': {
			const references = referencesBlock(others)
			return references ? { before: references } : null
		}
		case 'content-end':
			return others.length > 0 ? { end: column } : null
		default:
			return null
	}
}

/** True when the card's own block already sits where `target` would put the part. */
function alreadyThere(target: Target, own: Element, blocks: readonly Element[]): boolean {
	const index = blocks.indexOf(own)
	if ('before' in target) return blocks[index + 1] === target.before || (index === 0 && blocks[0] === target.before)
	if ('after' in target) return blocks[index - 1] === target.after
	return index === blocks.length - 1
}

/**
 * Apply the document's hints to the parts this block printed; returns the undo. A no-op, and a no-op undo, outside a
 * Builder page.
 *
 * The undo puts each moved part back in the block's wrapper, unless the wrapper already holds that part again (React
 * printed a new document into it, which it does before any effect cleanup runs) or has left the page (the card
 * unmounted): then the moved part is dropped with its holder. Either way no part is ever printed twice.
 */
export function applyCardPlacement(wrapper: Element, card: CardDocumentV1, names: readonly CardPartName[]): () => void {
	const root = wrapper.closest('[builder-content-id]')
	const column = root?.querySelector(':scope > .builder-blocks') ?? null
	if (!root || !column) return () => {}
	const blocks = Array.from(column.children).filter((child) => child.classList.contains('builder-block'))
	const own = blockOf(wrapper, blocks)
	if (!own) return () => {}
	const placed: {
		readonly holder: Element
		readonly host: Element
		readonly part: CardPartName
		readonly next: Node | null
	}[] = []
	for (const part of names) {
		if (!MOVABLE.includes(part)) continue
		const hint = hintFor(card, part)
		if (!hint) continue
		const host = wrapper.querySelector(`:scope > certrev-card[data-certrev-part="${part}"]`)
		if (!host) continue
		const target =
			resolveAnchor(hint.anchor, hint, root, column, blocks, own) ??
			(hint.else !== undefined ? resolveAnchor(hint.else, hint, root, column, blocks, own) : null)
		if (!target || alreadyThere(target, own, blocks)) continue
		const next = host.nextSibling
		const holder = (wrapper.ownerDocument ?? document).createElement('div')
		holder.setAttribute(PLACED_ATTRIBUTE, part)
		holder.setAttribute('data-certrev-face', 'card')
		if ('before' in target) column.insertBefore(holder, target.before)
		else if ('after' in target) column.insertBefore(holder, target.after.nextSibling)
		else column.appendChild(holder)
		holder.appendChild(host)
		placed.push({ holder, host, part, next })
	}
	return () => {
		for (const { holder, host, part, next } of placed) {
			const printedAgain = wrapper.querySelector(`:scope > certrev-card[data-certrev-part="${part}"]`) !== null
			if (wrapper.isConnected && !printedAgain) {
				wrapper.insertBefore(host, next && next.parentNode === wrapper ? next : null)
			}
			holder.remove()
		}
	}
}

/**
 * Run `apply` once the page has loaded and hydrated (two frames after `load`); returns a cancel that also undoes what
 * `apply` did.
 */
export function afterPageSettles(apply: () => () => void): () => void {
	let undo: (() => void) | null = null
	let cancelled = false
	const run = () => {
		if (cancelled) return
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				if (!cancelled) undo = apply()
			}),
		)
	}
	if (document.readyState === 'complete') run()
	else window.addEventListener('load', run, { once: true })
	return () => {
		cancelled = true
		window.removeEventListener('load', run)
		undo?.()
	}
}
