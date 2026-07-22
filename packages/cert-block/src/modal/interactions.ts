/**
 * Cert-card INTERACTIONS for the native Shopify cert experience.
 *
 * Progressive enhancement, delegated from the document (one listener, survives the placement
 * reposition). Two behaviours (POR-9827 chevron model):
 *
 *   • Accordion bios — a contributor row carrying `[data-certrev-acc]` toggles its `.open` class
 *     (revealing the row's `.acc-bio` in place; the name caret rotates via CSS) and mirrors the
 *     state on `aria-expanded`. A click on a link inside the row (e.g. the "Compensated expert"
 *     cue) is NOT a toggle. Keyboard: Enter/Space on the role=button row.
 *   • In-page modals: a `[data-certrev-modal-open]` control opens the unified
 *     `<certrev-cert-modal>` element (POR-10102) via its `.open('cert'|'expert')` method. Bare /
 *     `"cert"` opens the certificate dialog; `"expert"` opens the reviewer dialog. With no JS / no
 *     element / no envelope a link control falls back to its href (the certificate or the CertREV
 *     profile page). The element owns its OWN close plumbing (× / Close / backdrop / Esc) inside its
 *     shadow root — a shadow click is retargeted to the host, so a document delegate can't see it.
 *
 * No crypto, no network — pure DOM. Idempotent install (guarded so a double-load can't double-bind).
 */

import { CERT_MODAL_TAG } from './certrev-cert-modal.js'

export const ACC_ATTR = 'data-certrev-acc'
export const MODAL_OPEN_ATTR = 'data-certrev-modal-open'
export const INITIALS_ATTR = 'data-certrev-initials'
export const CARD_SELECTOR = '.certrev-card'

/** The dialog a `data-certrev-modal-open` control targets. */
export type ModalKind = 'cert' | 'expert'

/** The `<certrev-cert-modal>` element's public surface (defined in certrev-cert-modal.ts). */
interface CertModalElement extends HTMLElement {
	open(kind: ModalKind): boolean
}

/** Avatar base classes whose `--initials` variant is the SSR no-photo fallback (kept in lockstep
 *  with certrev-badge.liquid / certrev-memo.liquid). A broken <img> is swapped to `{base} {base}--initials`. */
const AVATAR_BASE_CLASSES = ['avatar', 'certrev-memo__avatar'] as const

/** Documents that already have the delegated handlers, so a double script-load can't double-bind. */
const installedDocs = new WeakSet<Document>()

/** Toggle a contributor row's accordion bio open/closed (the `.open` class drives the CSS reveal +
 *  caret rotation) and mirror the state on aria-expanded. */
export function toggleAccordion(row: Element): void {
	const open = row.classList.toggle('open')
	row.setAttribute('aria-expanded', open ? 'true' : 'false')
}

/** Resolve a `data-certrev-modal-open` value to the dialog it opens. `"expert"` opens the reviewer
 *  modal; anything else (the bare attribute, or `"cert"`) opens the certificate modal. */
export function modalTargetKind(value: string | null): ModalKind {
	return value === 'expert' ? 'expert' : 'cert'
}

/** Open a cert dialog via the `<certrev-cert-modal>` element. Returns false (so the caller lets an
 *  href fall back) when the element is absent or declines (no envelope + no fetch source). */
export function openModal(doc: Document, kind: ModalKind): boolean {
	const el = doc.querySelector(CERT_MODAL_TAG) as CertModalElement | null
	if (el && typeof el.open === 'function') return el.open(kind)
	return false
}

/** Open the page's certificate modal (backward-compatible wrapper over openModal). */
export function openCertModal(doc: Document): boolean {
	return openModal(doc, 'cert')
}

function asElement(target: EventTarget | null): Element | null {
	return target && (target as Element).closest ? (target as Element) : null
}

/**
 * Replace a broken avatar `<img>` with its initials placeholder — the SAME markup the Liquid emits
 * when no photo URL is present. The SSR can't know a present URL will 404 (the canary's expert photo
 * does), so without this a broken-image icon shows instead of the clean initials circle.
 */
export function swapBrokenAvatar(img: HTMLImageElement): void {
	const initials = img.getAttribute(INITIALS_ATTR)
	if (initials == null) return
	const base = AVATAR_BASE_CLASSES.find((c) => img.classList.contains(c))
	if (!base) return
	const span = img.ownerDocument.createElement('span')
	span.className = `${base} ${base}--initials`
	span.setAttribute('aria-hidden', 'true')
	span.textContent = initials
	img.replaceWith(span)
}

/**
 * Swap every avatar that has ALREADY failed to load. A 404 fires `error` during parse — often
 * before this bundle runs — and `error` doesn't re-fire, so the live `error` listener alone misses
 * pre-init failures (observed on the canary). Safe to call repeatedly; only acts on broken imgs.
 */
export function sweepBrokenAvatars(doc: Document): void {
	for (const img of Array.from(doc.querySelectorAll<HTMLImageElement>(`img[${INITIALS_ATTR}]`))) {
		if (img.complete && img.naturalWidth === 0) swapBrokenAvatar(img)
	}
}

/** Install the delegated click + keydown handlers on the document, once. */
export function initCertInteractions(doc: Document): void {
	if (installedDocs.has(doc)) return
	installedDocs.add(doc)

	doc.addEventListener('click', (e) => {
		const el = asElement(e.target)
		if (!el) return

		// Modal open — intercept only when the element actually shows the dialog; else let the link navigate.
		// (Close is owned by the <certrev-cert-modal> element inside its shadow root.)
		const opener = el.closest(`[${MODAL_OPEN_ATTR}]`)
		if (opener) {
			if (openModal(doc, modalTargetKind(opener.getAttribute(MODAL_OPEN_ATTR)))) e.preventDefault()
			return
		}

		// Accordion — but never when a link inside the row was clicked (it has its own action).
		const row = el.closest(`[${ACC_ATTR}]`)
		if (row && !el.closest('a, button')) toggleAccordion(row)
	})

	// Broken avatar photos → initials placeholder. `error` events don't bubble, so listen in the
	// CAPTURE phase. One-shot per img (replaceWith removes it, so it can't re-fire).
	doc.addEventListener(
		'error',
		(e) => {
			const t = e.target as Element | null
			if (t && t.tagName === 'IMG' && t.hasAttribute(INITIALS_ATTR)) swapBrokenAvatar(t as HTMLImageElement)
		},
		true,
	)

	// Catch avatars that already failed before this listener attached (see sweepBrokenAvatars).
	sweepBrokenAvatars(doc)

	// Keyboard parity: Enter/Space activates a role=button accordion row or a modal-open row (a <div>
	// fires no native click on Enter). Native <a>/<button> triggers handle their own activation
	// (their click reaches the click handler above), so skip those here to avoid a double-fire.
	doc.addEventListener('keydown', (e) => {
		if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return
		const el = asElement(e.target)
		if (!el || el.closest('a, button')) return

		const opener = el.closest(`[${MODAL_OPEN_ATTR}]`)
		if (opener) {
			if (openModal(doc, modalTargetKind(opener.getAttribute(MODAL_OPEN_ATTR)))) {
				e.preventDefault()
				return
			}
		}

		const row = el.closest(`[${ACC_ATTR}]`)
		if (row) {
			e.preventDefault()
			toggleAccordion(row)
		}
	})
}

/** Run interactions setup once the DOM is parsed. */
export function initCertInteractionsOnReady(doc: Document): void {
	const run = (): void => initCertInteractions(doc)
	if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', run, { once: true })
	else run()
}
