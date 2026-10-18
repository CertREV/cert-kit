/**
 * The Liquid semantics the reader snippets lean on, as small pure functions.
 *
 * The reader face is a byte-for-byte twin of the Shopify `certrev-reader-*` snippets, so the helpers below are not
 * "what a TypeScript author would write": each one reproduces what the Liquid filter or tag does with the same input
 * (which value counts as `blank`, which `default` replaces, how `contains` reads a string, what `strip_html` removes).
 * Where the snippets call another snippet (`certrev-safe-url`, `certrev-avatar-url`, `certrev-reader-first-name`,
 * `certrev-reader-date`) the port is named for it.
 *
 * Like every helper in this package they NEVER throw on a hostile type: the envelope is verified for its signature,
 * not its shape, so a number or an object can arrive where the contract promised a string. Values are read through
 * `rec` and `asText`, never dereferenced bare.
 */
import { asText, escapeHtml } from '../components/escape.js'

export type Rec = Readonly<Record<string, unknown>>

const NO_FIELDS: Rec = Object.freeze({})

/** An object's fields, or none: Liquid reads a missing field as nil, never an error. */
export function rec(value: unknown): Rec {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : NO_FIELDS
}

/** Liquid `escape` as Shopify (and this package) spell it: `&amp; &lt; &gt; &quot; &#39;`. */
export const esc = (value: unknown): string => escapeHtml(asText(value))

/** Liquid `default: fallback`: replaces nil, false and the empty string only (whitespace stays). */
export function orDefault(value: unknown, fallback: string): unknown {
	return value === undefined || value === null || value === false || value === '' ? fallback : value
}

/** `value | default: ''` read as text. */
export const textOr = (value: unknown, fallback = ''): string => asText(orDefault(value, fallback))

/** Liquid's `== blank` for the string-ish values the envelope carries: nil, false, empty or whitespace only. */
export const isBlank = (value: unknown): boolean => asText(value).trim() === ''

/** `{% if x %}` for a value read as a flag: Liquid treats only nil and false as false (the empty string is true). */
export const isTruthy = (value: unknown): boolean => value !== undefined && value !== null && value !== false

/** Whether a field carries a value after `| default: ''` (so `!= ''` in the snippet). */
export const isPresent = (value: unknown): boolean =>
	!(value === undefined || value === null || value === false || value === '')

/** Liquid `contains`: an array holds the needle, a string includes it, anything else does not. */
export function contains(container: unknown, needle: string): boolean {
	if (Array.isArray(container)) return container.some((item) => item === needle)
	if (typeof container === 'string') return container.includes(needle)
	return false
}

/**
 * Liquid `strip_html` as the portal's liquidjs harness runs it: raw-text blocks (`<script…</script>`, `<style…</style>`,
 * `<!-- … -->`) and then any `<…>` tag are dropped; an opener with no closer is not a block, and once no opener fits
 * the rest of the string is kept as it is. The snippets use it on every captured value because Shopify wraps each
 * `{% render %}` of an app snippet in `<!-- BEGIN/END app snippet -->` comments that would corrupt an attribute.
 */
export function stripHtml(input: string): string {
	const blocks = new Map<string, string>([
		['<script', '</script>'],
		['<style', '</style>'],
		['<!--', '-->'],
		['<', '>'],
	])
	let out = ''
	let i = 0
	while (i < input.length) {
		const lt = input.indexOf('<', i)
		if (lt < 0) return out + input.slice(i)
		out += input.slice(i, lt)
		for (const [opener, closer] of blocks) {
			if (!input.startsWith(opener, lt)) continue
			const end = input.indexOf(closer, lt + opener.length)
			if (end >= 0) {
				i = end + closer.length
				break
			}
			blocks.delete(opener)
		}
		if (i <= lt) return out + input.slice(lt)
	}
	return out
}

/** `{% capture x %}…{% endcapture %}` then `x | strip_html | strip`, which every snippet applies to a captured value. */
export const cleaned = (value: string): string => stripHtml(value).trim()

/**
 * `certrev-safe-url`: the trimmed URL when it is http(s), protocol-relative or site-relative (`/…`, `#…`), else ''.
 * A `javascript:`, `data:` or other scheme collapses to '' so the caller's `!= ''` guard drops the link or the photo.
 */
export function safeUrl(url: unknown): string {
	const u = textOr(url).trim()
	if (u === '') return ''
	const lower = u.toLowerCase()
	if (
		lower.startsWith('https://') ||
		lower.startsWith('http://') ||
		u.startsWith('//') ||
		u.startsWith('/') ||
		u.startsWith('#')
	)
		return u
	return ''
}

const ASSET_HOSTS: readonly string[] = ['assets.certrev.com', 'staging-assets.certrev.com']

/**
 * `certrev-avatar-url`: a CertREV asset-host photo is requested through the host's `cdn-cgi/image` resizer at
 * `width` square (the query string dropped, which the WAF allowlist pins to empty); any other URL, a lookalike host,
 * an `http://` or `//` form, or a URL already carrying `cdn-cgi/image/`, is returned as it is.
 */
export function avatarUrl(url: string, width: number): string {
	const u = url.trim()
	if (!u.includes('assets.certrev.com/')) return u
	const after = u.replace('https://', '')
	const host = after.split('/')[0] ?? ''
	if (!ASSET_HOSTS.includes(host)) return u
	const path = after.replace(host, '').replace('/', '').split('?')[0] ?? ''
	if (path.includes('cdn-cgi/image/')) return u
	return `https://${host}/cdn-cgi/image/width=${width},height=${width},fit=cover,format=auto,onerror=redirect/${path}`
}

const HONORIFICS: readonly string[] = [
	'dr.',
	'dr',
	'mr.',
	'mr',
	'mrs.',
	'mrs',
	'ms.',
	'ms',
	'prof.',
	'prof',
	'mx.',
	'mx',
]

/**
 * `certrev-reader-first-name`: the name's first word with a leading honorific (Dr., Mr., Mrs., Ms., Prof., Mx.,
 * any case) dropped; '' when nothing is left, which the caller words as "View profile".
 */
export function firstName(name: string): string {
	let clean = name.trim()
	const firstWord = (clean.split(' ')[0] ?? '').toLowerCase()
	if (HONORIFICS.includes(firstWord)) {
		const honorific = clean.split(' ')[0] ?? ''
		clean = clean.replace(honorific, '').trim()
	}
	return clean.split(' ')[0] ?? ''
}

const MONTHS: readonly string[] = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
]

/**
 * `certrev-reader-date`: "June 20, 2026" for an ISO timestamp, read in UTC (the portal harness's `date` filter does
 * the same). A value that is not a date prints nothing, so the caller's `!= ''` guard falls to the undated wording.
 */
export function longDate(iso: unknown): string {
	const parsed = new Date(asText(iso))
	if (Number.isNaN(parsed.getTime())) return ''
	return `${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCDate()}, ${parsed.getUTCFullYear()}`
}
