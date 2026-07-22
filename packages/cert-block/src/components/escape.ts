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
 */

const HTML_ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
}

/** Escape text for safe inclusion in HTML element content or double-quoted attributes. */
export function escapeHtml(input: string): string {
	return input.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c)
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
	if (!input) return null
	const trimmed = input.trim()
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
	if (!input) return null
	const v = input.trim()
	if (v === '') return null
	if (/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) return v
	if (/^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/]+\)$/.test(v)) return v
	if (/^[a-zA-Z]{1,32}$/.test(v)) return v
	return null
}

/** Collapse interior whitespace + trim. Used to normalize display text. */
export function tidyText(input: string | null | undefined): string {
	return (input ?? '').replace(/\s+/g, ' ').trim()
}
