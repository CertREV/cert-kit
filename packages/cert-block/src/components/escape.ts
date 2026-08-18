/**
 * SSR-safe escaping + sanitization helpers.
 *
 * The components render certification FACTS that originate from brand / expert input
 * (display names, memos, titles, URLs). React escapes text children + attribute values
 * by default, so the JSX path is safe without extra work — but two surfaces need
 * explicit defense:
 *   1. URLs placed in href/src: a `javascript:` (or `data:`) scheme in a stored URL
 *      becomes an XSS vector the moment it's clicked. `safeHttpUrl` allows only http(s).
 *   2. The Web Component + JSON-LD paths build strings by hand (no JSX auto-escaping),
 *      so they call `escapeHtml` / `escapeAttribute` directly.
 *
 * Everything here is pure and runtime-agnostic (no DOM, no Node APIs) so it runs in a
 * server component, an edge runtime, and the Web Component identically.
 *
 * Every helper here is TYPE-HOSTILE-SAFE, and that is load-bearing rather than defensive
 * habit: these run downstream of `get-verified-envelope.ts`'s bare
 * `JSON.parse(...) as CertDeliveryEnvelope` cast, and `verifyEnvelope` checks the SIGNATURE,
 * never the SHAPE — so a number / object / array arrives where the contract promised a
 * string. A `TypeError` here is not a missing badge: under `renderToReadableStream` it aborts
 * the whole article route with zero HTML, and the Builder SDK ships no error boundary on its
 * node/edge builds. So the family's contract is NEVER THROW — see `asText`.
 */

/**
 * Coerce an untyped value to renderable text. The rule is deliberately narrow:
 *   • a string passes through untouched — every helper below preserves its exact string
 *     semantics, because `escapeHtml` is the ONLY XSS boundary four hand-built-HTML
 *     renderers have and any change to its string output is a security regression;
 *   • a finite number renders as its digits (a stray count is at least legible copy);
 *   • EVERYTHING ELSE — null, undefined, booleans, objects, arrays, functions, symbols,
 *     NaN/Infinity — renders as empty.
 *
 * The last clause is the important one, and it is why this is not `String(input)`. Blind
 * coercion would splice `[object Object]` (or a hostile `toString`'s payload) into the
 * article body, and on a null-prototype object it throws the very TypeError this exists to
 * prevent. A value that is not text is not copy; the correct render of it is nothing.
 *
 * Exported for `format.ts` only — so a helper there can't drift back to a bare dereference —
 * and deliberately NOT re-exported from the package entry: an internal invariant, not a
 * contract surface consumers should build on.
 */
export function asText(input: unknown): string {
	if (typeof input === 'string') return input
	if (typeof input === 'number') return Number.isFinite(input) ? String(input) : ''
	return ''
}

const HTML_ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
}

/** Escape text for safe inclusion in HTML element content or double-quoted attributes. */
export function escapeHtml(input: string | null | undefined): string {
	return asText(input).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c)
}

/** Alias kept explicit at call sites where the value lands in an attribute. */
export const escapeAttribute = escapeHtml

/**
 * Return the URL only if it is a safe absolute http(s) URL (or a protocol-relative or
 * site-relative URL), else null. Anything with a `javascript:`/`data:`/`vbscript:`/etc.
 * scheme — or that fails to parse — is rejected so it can never reach an href/src.
 * Callers treat null as "omit the link".
 */
export function safeHttpUrl(input: string | null | undefined): string | null {
	const trimmed = asText(input).trim()
	if (trimmed === '') return null
	// Site-relative or protocol-relative URLs are safe (no scheme to abuse).
	if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('?')) return trimmed
	try {
		const u = new URL(trimmed)
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
	} catch {
		return null
	}
}

/**
 * Validate a CSS color token for inline `style`. We accept only a conservative set
 * (`#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa` hex, `rgb()/rgba()/hsl()/hsla()` functions, and
 * a bare CSS keyword) so a stored `accentColor` can't inject `expression(...)`,
 * `url(...)`, or break out of the style attribute. Returns null on anything suspicious.
 */
export function safeCssColor(input: string | null | undefined): string | null {
	const v = asText(input).trim()
	if (v === '') return null
	if (/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) return v
	if (/^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/]+\)$/.test(v)) return v
	if (/^[a-zA-Z]{1,32}$/.test(v)) return v
	return null
}

/** Collapse interior whitespace + trim. Used to normalize display text. */
export function tidyText(input: string | null | undefined): string {
	return asText(input).replace(/\s+/g, ' ').trim()
}
