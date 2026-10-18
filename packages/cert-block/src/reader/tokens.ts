/**
 * `certrev-reader-tokens`: the four CSS custom properties a reader section carries on its root, from the render def.
 *
 *   --cr-ba     the accent the card cap and pill paint: the def's `barInk`, else its `accentColor`, else navy
 *   --cr-ba-fg  the ink on that accent: white, or `#141414` when the def baked it for the colour that painted
 *   --cr-br     the corner radius
 *   --cr-bf     the font stack for the brand's `fontSlot`
 *
 * The values land inside a double-quoted `style` attribute, and they are held to the allow-list the Liquid snippet and
 * the PHP twin's def parser hold them to: a colour is `#RGB` or `#RRGGBB`, a radius one non-negative px / rem / em / %
 * length or a bare `0`, and anything else paints the default (navy, 14px). A denylist of characters is not enough: a
 * quote, a backslash, a comment opener or a bracket left in a value hides the `;` that ends it and swallows the
 * declarations after it. The variable names are the reader stylesheet's (`reader.css`), which `.certrev-reader`
 * declares defaults for.
 */
import { asText } from '../components/escape.js'
import { esc, rec, textOr } from './helpers.js'

/** The accent when the def has none: CertREV navy. */
const DEFAULT_ACCENT = '#0A1B3F'
const DEFAULT_RADIUS = '14px'
/** The foreground the def bakes for a light accent; anything else is the white default. */
const DARK_INK = '#141414'

/**
 * The font stack per `fontSlot`, in one table so the Liquid `certrev-reader-tokens` snippet and this one are compared
 * on a single list. An unknown or missing slot is the sans stack, as in the snippet. The stacks are the demo's own, byte
 * for byte: the reader block of `reader.css` declares certrev.com's own faces under these family names (DM Sans,
 * Playfair Display, Plus Jakarta Sans, JetBrains Mono) at `font-stretch: 101%`, which the reader root asks for, so the
 * legacy faces a page may also load are untouched. `system` has no demo stack and keeps the legacy one.
 */
function fontStack(slot: string): string {
	switch (slot) {
		case 'serif':
			return "'Playfair Display', ui-serif, Georgia, serif"
		case 'grotesk':
			return "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif"
		case 'mono':
			return "'JetBrains Mono', ui-monospace, monospace"
		case 'system':
			return "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
		default:
			return "'DM Sans', ui-sans-serif, system-ui, sans-serif"
	}
}

/** A colour is `#` and then 3 or 6 hex digits (ASCII only, no trailing newline), else '' (which the caller defaults). */
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
/**
 * A radius is a bare `0`, or digits with at most one `.` (not trailing) and then px, rem, em or %, else ''. `\d` is
 * ASCII here (no `u` flag), as the snippet's `0123456789.` is; the unit is case-sensitive.
 */
const LENGTH = /^(?:\d+|\d+\.\d+|\.\d+)(?:px|rem|em|%)$/

/** A colour token that is a hex colour, or '' (which the caller defaults). */
function hexColour(value: unknown): string {
	const text = textOr(value)
	return HEX.test(text) ? text : ''
}

/** A radius token that is a bare 0 or a non-negative length, or '' (which the caller defaults). */
function radius(value: unknown): string {
	const text = textOr(value)
	return text === '0' || LENGTH.test(text) ? text : ''
}

export interface ReaderTokens {
	/** The value of the section's `style` attribute. */
	readonly style: string
	/** The ink on the accent: `#ffffff` or `#141414`. The logo is white on the first and mono on the second. */
	readonly fg: string
}

export function readerTokens(def: unknown): ReaderTokens {
	const rd = rec(def)
	const tokens = rec(rd.tokens)

	const barInk = hexColour(tokens.barInk)
	const accent = hexColour(tokens.accentColor)
	const ba = barInk || accent || DEFAULT_ACCENT

	// The ink follows the value that painted the accent: a def with a bar ink takes the foreground baked for it
	// (barInkFg); one that paints its accent colour takes the one baked for that colour (accentFg).
	let fg = '#ffffff'
	if (barInk !== '') {
		if (rd.barInkFg === DARK_INK) fg = DARK_INK
	} else if (accent !== '' && rd.accentFg === DARK_INK) {
		fg = DARK_INK
	}

	const br = radius(tokens.cornerRadius) || DEFAULT_RADIUS
	const bf = fontStack(asText(tokens.fontSlot))
	return { style: `--cr-ba:${esc(ba)};--cr-ba-fg:${fg};--cr-br:${esc(br)};--cr-bf:${bf}`, fg }
}
