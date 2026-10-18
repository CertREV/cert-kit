/**
 * `certrev-reader-face`: the round avatar on a reader byline: the person's photo when there is one to paint, else their
 * initials, else (a person with no name to take them from) the silhouette. The span carries a size class (`sm` for the
 * author, none for the banner reviewer, `lg` for the memo and sidebar reviewer); the image is requested at `width`
 * square through the asset resizer.
 *
 * THE INITIALS ARE A BYTE SPEC the portal's Liquid snippets and the WordPress renderer repeat, so all three print the
 * same bytes: trim the name and split it on single spaces (`' '`) SKIPPING empty parts (two spaces in a row are one
 * gap: "Jane  Doe" gives "JD"); drop the FIRST part when, lowercased, it is one of the honorifics dr, mr, mrs, ms,
 * prof, mx (each with or without its trailing dot); take the first character, by code point, of each of the first two
 * parts left; uppercase them. Non-empty initials paint exactly
 * `<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><text x="20" y="20" text-anchor="middle"
 * dominant-baseline="central" font-size="15" font-weight="700">JD</text></svg>` (one line, the initials escaped);
 * empty ones paint the silhouette as before.
 *
 * "A photo to paint" is `show` with a URL that passes `safeUrl`. A def that hides `reviewerPhoto`, or
 * `display.showExpertPhoto: false`, passes `show: false`: the URL is never read, so it never reaches the page, and the
 * avatar is the initials (a hidden photo used to remove the avatar altogether; it removes the photo now).
 */
import { asText } from '../components/escape.js'
import { avatarUrl, cleaned, esc, safeUrl } from './helpers.js'

export type ReaderFaceSize = '' | 'sm' | 'lg'

export interface ReaderFaceInput {
	/** The photo URL on the envelope. */
	readonly photo: unknown
	/** Whether to ATTEMPT the photo: false never reads the URL (the initials show). */
	readonly show: boolean
	/** The person's display name, the initials' source; a hostile type reads as no name. */
	readonly name: unknown
	readonly size: ReaderFaceSize
	/** The pixel width the resizer is asked for. */
	readonly width: number
}

const SILHOUETTE =
	'<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><circle cx="20" cy="14.8" r="7"/><path d="M20 23.4c-6.9 0-12.6 4.8-13.8 11.2a20 20 0 0 0 27.6 0C32.6 28.2 26.9 23.4 20 23.4Z"/></svg>'

const HONORIFICS: ReadonlySet<string> = new Set([
	'dr',
	'dr.',
	'mr',
	'mr.',
	'mrs',
	'mrs.',
	'ms',
	'ms.',
	'prof',
	'prof.',
	'mx',
	'mx.',
])

/** The initials of a display name by the spec above: '' when the name leaves no first character to take. */
export function initialsOf(name: unknown): string {
	const parts = asText(name)
		.trim()
		.split(' ')
		.filter((part) => part !== '')
	if (HONORIFICS.has((parts[0] ?? '').toLowerCase())) parts.shift()
	return parts
		.slice(0, 2)
		.map((part) => Array.from(part)[0] ?? '')
		.join('')
		.toUpperCase()
}

const initialsSvg = (initials: string): string =>
	'<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><text x="20" y="20" text-anchor="middle" ' +
	`dominant-baseline="central" font-size="15" font-weight="700">${esc(initials)}</text></svg>`

const DIMENSION: Readonly<Record<ReaderFaceSize, number>> = { '': 42, sm: 36, lg: 46 }

export function readerFace({ photo, show, name, size, width }: ReaderFaceInput): string {
	const safe = show ? cleaned(safeUrl(photo)) : ''
	const src = cleaned(avatarUrl(safe, width))
	const dim = DIMENSION[size]
	const cls = size === '' ? 'certrev-r-face' : `certrev-r-face ${esc(size)}`
	const initials = src !== '' ? '' : initialsOf(name)
	const inner =
		src !== ''
			? `<img src="${esc(src)}" alt="" width="${dim}" height="${dim}" loading="lazy" decoding="async">`
			: initials !== ''
				? initialsSvg(initials)
				: SILHOUETTE
	return `<span class="${cls}">${inner}</span>`
}
