/**
 * The PHONE face's collapsible memo (1.1.0): the markup contract `renderCertBlock` emits when its
 * input asks for the responsive face, and the one toggle every host wires to it.
 *
 * On a viewport `NARROW_VIEWPORT` or narrower a long memo is clamped to `MEMO_COLLAPSED_LINES`
 * lines behind a native `<button>` that expands it; wider viewports show the whole memo and no
 * button. The state lives on the memo box (`data-certrev-memo="collapsed" | "open"`), never on a
 * class, so a host stylesheet's `.open` rules cannot reach it; the button mirrors it on
 * `aria-expanded` and in its label.
 *
 * Pure DOM, no React: the Builder card binds it on its wrapper, and any other host that paints the
 * responsive face (a portal preview, a web component) calls the same function.
 */

/** The memo box: the memo text and its toggle. The value is the state. */
export const MEMO_ATTR = 'data-certrev-memo'
/** The clamped text inside the box. */
export const MEMO_TEXT_ATTR = 'data-certrev-memo-text'
/** The expand/collapse button inside the box. */
export const MEMO_TOGGLE_ATTR = 'data-certrev-memo-toggle'

export const MEMO_EXPAND_LABEL = 'Read the full memo'
export const MEMO_COLLAPSE_LABEL = 'Show less'

/** The viewport at or under which the phone face applies. */
export const NARROW_VIEWPORT = '(max-width: 640px)'
/** Lines a collapsed memo keeps. */
export const MEMO_COLLAPSED_LINES = 4

/**
 * A memo shorter than this, with fewer line breaks than `MEMO_COLLAPSE_MIN_BREAKS`, fits its
 * collapsed lines on a phone (about 33 characters a line at 393px), so it gets no toggle: a button
 * that reveals nothing is noise.
 */
export const MEMO_COLLAPSE_MIN_CHARS = 160
export const MEMO_COLLAPSE_MIN_BREAKS = MEMO_COLLAPSED_LINES

/** Is this memo long enough to collapse on a phone? (No memo never does.) */
export function memoCollapses(memo: string | null | undefined): boolean {
	if (!memo) return false
	return memo.length > MEMO_COLLAPSE_MIN_CHARS || memo.split('\n').length - 1 >= MEMO_COLLAPSE_MIN_BREAKS
}

/** The toggle a click landed on (the button or anything inside it), or null. */
export function memoToggleFor(target: EventTarget | null): Element | null {
	const el = target as Element | null
	if (!el || typeof el.closest !== 'function') return null
	return el.closest(`[${MEMO_TOGGLE_ATTR}]`)
}

/**
 * Flip the memo box a toggle belongs to, mirroring the state on the button. Returns the new state
 * (true = expanded), or null when the button is not inside a memo box.
 */
export function toggleMemo(button: Element): boolean | null {
	const box = button.closest(`[${MEMO_ATTR}]`)
	if (!box) return null
	const open = box.getAttribute(MEMO_ATTR) !== 'open'
	box.setAttribute(MEMO_ATTR, open ? 'open' : 'collapsed')
	button.setAttribute('aria-expanded', open ? 'true' : 'false')
	button.textContent = open ? MEMO_COLLAPSE_LABEL : MEMO_EXPAND_LABEL
	return open
}
