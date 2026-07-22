/**
 * FTC disclosure tamper guard for the NATIVE Shopify cert render (iframe→native parity).
 *
 * In the cross-origin iframe model the expert-memo embed inlined `ftcTamperGuardScript()`
 * (src/lib/embed/ftc-disclosure.ts): a kill switch that blanks the memo if the verbatim FTC
 * material-connection disclosure is stripped, hidden, or altered — making the MSA §3
 * anti-stripping covenant TECHNICALLY enforced, not just contractual. The native memo renders
 * in the host theme's DOM (no sandbox), so without this it would lose that runtime enforcement.
 * This module restores it: on load + on later DOM mutation it verifies the in-DOM
 * `[data-ftc-line]` is present, carries the EXACT verbatim text, and is actually visible; if not,
 * it neutralizes the memo with a neutral notice so the memo NEVER renders without its disclosure.
 *
 * Native-specific semantics (differ from the iframe, which only existed when a memo did):
 *   - Enforcement is keyed on the MEMO element (`.certrev-memo`). A certified article with NO
 *     memo legitimately has no `.certrev-memo` and no disclosure — the guard does NOT fire
 *     (no false positive on the no-memo path).
 *   - On tamper it neutralizes ONLY the memo (never `document.body` — we're in the host page).
 *   - The contributors card is governed by the badge re-verify (`revalidate.ts`), not this guard;
 *     the card carries only the one-word "Compensated" cue, never the guarded disclosure.
 *
 * Pure DOM, no crypto, no network. The expected text is the single source of truth
 * `FTC_DISCLOSURE_LINE` (imported, not copied — so a reword can never desync this guard).
 */

import { FTC_DISCLOSURE_LINE } from './ftc-disclosure.js'

export const FTC_LINE_SELECTOR = '[data-ftc-line]'
export const MEMO_SELECTOR = '.certrev-memo'
export const MEMO_WRAP_SELECTOR = '.certrev-memo-wrap'
/** Marker on the neutral notice node that replaces a tampered memo (testable / idempotent). */
export const FTC_NEUTRALIZED_ATTR = 'data-certrev-ftc-neutralized'

/** Documents already guarded, so a double script-load can't double-bind. */
const guardedDocs = new WeakSet<Document>()

/** Visible = not display:none / visibility:hidden / opacity:0 and a non-zero box. */
function isVisible(el: Element): boolean {
	const win = el.ownerDocument.defaultView
	// No view (detached / SSR): we can't measure, so don't treat as hidden — the text/presence
	// checks still apply; only the layout-based hide vector is skipped.
	if (!win) return true
	const s = win.getComputedStyle(el)
	if (s.display === 'none' || s.visibility === 'hidden' || Number.parseFloat(s.opacity || '1') === 0) return false
	const r = el.getBoundingClientRect()
	return r.width > 0 && r.height > 0
}

/** True when a memo's disclosure line is present, exactly verbatim, and visible. */
export function isDisclosureIntact(memo: Element): boolean {
	const line = memo.querySelector(FTC_LINE_SELECTOR)
	if (!line) return false
	if ((line.textContent || '').trim() !== FTC_DISCLOSURE_LINE) return false
	return isVisible(line)
}

/**
 * Replace a tampered memo with a neutral, self-contained notice — no reviewer attribution, no
 * seal — so the surface can never read as an endorsement without its required disclosure.
 */
export function neutralizeMemo(memo: Element): void {
	const doc = memo.ownerDocument
	const notice = doc.createElement('div')
	notice.setAttribute(FTC_NEUTRALIZED_ATTR, '')
	notice.style.cssText =
		'font-family:system-ui,-apple-system,sans-serif;font-size:12px;color:#555;padding:12px;line-height:1.4'
	notice.innerHTML =
		'This CertREV verification cannot be displayed because its required disclosure was not shown. ' +
		'<a href="https://certrev.com" style="color:#555" target="_blank" rel="noopener noreferrer">Learn more</a>.'
	memo.replaceWith(notice)
}

/**
 * Enforce the disclosure across every memo in the doc: neutralize any whose disclosure isn't
 * intact. A doc with no `.certrev-memo` (no-memo article) is a no-op. Returns true if all memos
 * present were intact (or none existed).
 */
export function enforceFtcDisclosure(doc: Document): boolean {
	let allIntact = true
	for (const memo of Array.from(doc.querySelectorAll(MEMO_SELECTOR))) {
		if (!isDisclosureIntact(memo)) {
			allIntact = false
			neutralizeMemo(memo)
		}
	}
	return allIntact
}

/**
 * Install the guard once per document: enforce now (on DOM ready) and re-enforce on later DOM
 * mutations within the memo wrap(s) — so a host script that strips / hides / edits the disclosure
 * after load still trips the kill switch. Scoping the observer to the small `.certrev-memo-wrap`
 * subtree(s) keeps it cheap on a busy storefront page (cf. the iframe, which observed its whole
 * — tiny — body). Idempotent.
 */
export function installFtcGuard(doc: Document): void {
	if (guardedDocs.has(doc)) return
	guardedDocs.add(doc)

	const run = (): void => {
		enforceFtcDisclosure(doc)
	}

	const start = (): void => {
		run()
		const MO = doc.defaultView?.MutationObserver
		if (!MO) return
		// Observe the stable memo wrap(s) — placement.js relocates the wrap as a node, so the
		// observer tracks it wherever it moves. Fall back to <body> only if no wrap exists.
		const wraps = Array.from(doc.querySelectorAll(MEMO_WRAP_SELECTOR))
		const scope = wraps.length ? wraps : doc.body ? [doc.body] : []
		for (const node of scope) {
			const mo = new MO(run)
			mo.observe(node, { childList: true, subtree: true, characterData: true, attributes: true })
		}
	}

	if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true })
	else start()
}
