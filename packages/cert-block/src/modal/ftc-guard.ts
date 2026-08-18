/**
 * FTC disclosure tamper guard for the NATIVE Shopify cert render (iframe→native parity).
 *
 * In the cross-origin iframe model the expert-memo embed inlined the portal's
 * `ftcTamperGuardScript()`: a kill switch that blanks the memo if the verbatim FTC
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
 *   - COVERAGE, and it is narrower than it reads: `.certrev-memo` / `.certrev-memo-wrap` are portal
 *     LIQUID markup — NOTHING in this package emits either. So the kill switch covers the Liquid
 *     memo surface and nothing else. `<CertBadge>` and `render-badge-html.ts` emit the same
 *     `[data-ftc-line]` hook inside a `.certrev-badge` (no memo), and `renderCertBlock` emits no
 *     hook at all; on those surfaces a pass verifies nothing and says so (`'unguarded'`) rather
 *     than reporting success, and no observer is installed at all. Widening enforcement to the
 *     badge is a live design decision, not an omission — see `FtcEnforcementResult`.
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

/**
 * Link qualification for the notice's CertREV anchor — a CertREV link on a brand's page that the
 * brand did not author, so it carries the same qualification as every other anchor this package
 * emits. Deliberately a LOCAL literal rather than an import of `CERTREV_LINK_REL`
 * (`../components/rel.ts`): `src/modal/` imports NOTHING from `src/components/` by design — every
 * shared string here (`ftc-disclosure.ts`, `logo-paths.ts`, `display-strings.ts`) is a modal-local
 * copy so the browser IIFE never drags the SSR renderer in. `ftc-guard.test.ts` imports the
 * components constant and asserts this value stays a superset of it, so the copies cannot drift.
 *
 * `noreferrer` rides ON TOP of the shared tokens (which omit it): this is the only anchor the
 * package opens with `target="_blank"`, and it fires from a page whose operator has just stripped
 * the disclosure — withholding the referrer there is worth the token.
 */
const NOTICE_LINK_REL = 'nofollow sponsored noopener noreferrer'

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
		`<a href="https://certrev.com" style="color:#555" target="_blank" rel="${NOTICE_LINK_REL}">Learn more</a>.`
	memo.replaceWith(notice)
}

/**
 * What ONE enforcement pass actually established:
 *   - `'intact'`    — at least one memo was checked, and every one carried its verbatim, visible line.
 *   - `'tampered'`  — at least one memo failed the check and was neutralized.
 *   - `'unguarded'` — the document holds no `.certrev-memo`, so the pass checked nothing.
 *
 * `'unguarded'` used to be reported as `true`, indistinguishable from `'intact'`, and that
 * conflation was a correctness bug, not a cosmetic one: `.certrev-memo` is portal Liquid markup
 * this package never emits, so on every React / Web Component / `renderCertBlock` surface the pass
 * finds nothing and answered "all intact" about a disclosure it had never looked at — the kill
 * switch silently reporting success on exactly the surfaces it does not protect.
 *
 * The legitimate no-memo certified article (card only, no memo, no disclosure owed) lands here too,
 * and the guard genuinely cannot tell the two apart from the DOM alone. That is the point of a
 * third state rather than a second boolean: "nothing was verified" is the honest answer to both,
 * and it is the caller — which knows which surface it rendered — that can tell whether that is
 * expected or a coverage gap.
 */
export type FtcEnforcementResult = 'intact' | 'tampered' | 'unguarded'

/**
 * Enforce the disclosure across every memo in the doc: neutralize any whose disclosure isn't
 * intact. A doc with no `.certrev-memo` is a no-op — see `FtcEnforcementResult` for why that is
 * `'unguarded'` and not success.
 */
export function enforceFtcDisclosure(doc: Document): FtcEnforcementResult {
	const memos = Array.from(doc.querySelectorAll(MEMO_SELECTOR))
	if (!memos.length) return 'unguarded'
	let result: FtcEnforcementResult = 'intact'
	for (const memo of memos) {
		if (!isDisclosureIntact(memo)) {
			result = 'tampered'
			neutralizeMemo(memo)
		}
	}
	return result
}

/**
 * Install the guard once per document: enforce now (on DOM ready) and re-enforce on later DOM
 * mutations within the guarded subtree(s) — so a host script that strips / hides / edits the
 * disclosure after load still trips the kill switch. Idempotent.
 *
 * The observer scope is the memo wrap(s) — placement.ts relocates a wrap as a node, so the observer
 * tracks it wherever it moves — plus any memo sitting outside a wrap. When the document has
 * NEITHER, NO observer is installed at all. That bail-out is the whole storefront case, not an edge
 * one: this package emits neither selector (both are portal Liquid), so the old `<body>` fallback
 * was the only branch a React / Web Component / `renderCertBlock` page could take, and it pinned a
 * subtree + attributes + characterData observer — no `attributeFilter`, no coalescing — on the
 * host's entire page for the life of the tab, re-running an enforce pass on EVERY mutation a busy
 * storefront makes, to query a selector that could never match. A guard watching a page it cannot
 * act on is pure cost; `enforceFtcDisclosure`'s `'unguarded'` result is the correctness half of the
 * same gap.
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
		// The guarded roots: the stable wrap(s), plus any memo not inside one (in the Liquid shape a
		// wrap always contains its memo, so this is normally just the wraps). No root ⇒ no observer.
		const wraps = Array.from(doc.querySelectorAll(MEMO_WRAP_SELECTOR))
		const looseMemos = Array.from(doc.querySelectorAll(MEMO_SELECTOR)).filter(
			(memo) => !memo.closest(MEMO_WRAP_SELECTOR),
		)
		for (const node of [...wraps, ...looseMemos]) {
			const mo = new MO(run)
			mo.observe(node, { childList: true, subtree: true, characterData: true, attributes: true })
		}
	}

	if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true })
	else start()
}
