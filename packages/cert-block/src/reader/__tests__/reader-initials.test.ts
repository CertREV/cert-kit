/**
 * The initials avatar (1.2.0): the byte spec the portal's Liquid snippets and the WordPress renderer repeat.
 *
 * A byline paints the person's photo when there is one to paint; otherwise their initials in an inline `<svg>`; and the
 * silhouette only for a person with no name to take initials from. The portal's twins print the same bytes, so this
 * file pins them against the spec, byte for byte, and at every avatar site the face has (the sidebar's reviewer, the
 * banner's reviewer and writer, the memo's reviewer). The golden pages and oracle cells in `fixtures/` are the portal's own
 * output with the initials (refreshed by `scripts/refresh-reader.mjs`), so `reader-golden`, `reader-differential`,
 * `reader-link-rel` and `reader-byline` compare whole pages against them, avatars included; this file pins the spec's
 * edge cases on their own, and the `names-*` oracle cells tie the same edges to the Liquid.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CertContent } from '../../contract/kernel.js'
import { initialsOf, readerFace } from '../face.js'
import { type ReaderLayout, type ReaderPart, renderReaderFace } from '../render.js'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const { certId, cells } = JSON.parse(readFileSync(`${FIXTURES}golden-cells.json`, 'utf8')) as {
	certId: string
	cells: { id: string; def: unknown; content: CertContent }[]
}
const FULL = cells.find((cell) => cell.id === 'banner.navy-full')
if (!FULL) throw new Error('no banner.navy-full golden cell')

const REVIEWER_PHOTO = 'https://cdn.example.test/masked/reviewer.jpg'
const WRITER_PHOTO = 'https://cdn.example.test/masked/author.jpg'

/** The exact bytes the spec says non-empty initials paint, for `JD` (or any already-escaped initials). */
const svg = (initials: string): string =>
	`<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><text x="20" y="20" text-anchor="middle" dominant-baseline="central" font-size="15" font-weight="700">${initials}</text></svg>`
const SILHOUETTE =
	'<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><circle cx="20" cy="14.8" r="7"/><path d="M20 23.4c-6.9 0-12.6 4.8-13.8 11.2a20 20 0 0 0 27.6 0C32.6 28.2 26.9 23.4 20 23.4Z"/></svg>'

/** The golden cell's content with the reviewer's name and photo and the display switches replaced. */
function contentWith(opts: {
	name?: unknown
	authorName?: unknown
	photo?: unknown
	authorPhoto?: unknown
	display?: Record<string, unknown>
}): CertContent {
	const base = FULL?.content as unknown as Record<string, Record<string, unknown>>
	const expert: Record<string, unknown> = { ...base.expert }
	const author: Record<string, unknown> = { ...base.author }
	if ('name' in opts) expert.displayName = opts.name
	if ('authorName' in opts) author.name = opts.authorName
	if ('photo' in opts) {
		if (opts.photo === undefined) delete expert.photoUrl
		else expert.photoUrl = opts.photo
	}
	if ('authorPhoto' in opts) {
		if (opts.authorPhoto === undefined) delete author.photoUrl
		else author.photoUrl = opts.authorPhoto
	}
	return { ...base, expert, author, display: { ...base.display, ...opts.display } } as unknown as CertContent
}

const paint = (
	content: CertContent,
	layout: ReaderLayout,
	opts: { hidden?: string[]; part?: ReaderPart } = {},
): string => {
	const def = { ...(FULL?.def as object), hidden: opts.hidden ?? [] }
	return renderReaderFace({ content, def, layout, part: opts.part, certId })
}

/** The span of each avatar on a page, in order, with its size class. */
const avatarSpans = (html: string): string[] => html.match(/<span class="certrev-r-face[^"]*">[\s\S]*?<\/span>/g) ?? []

describe('initialsOf: the byte spec', () => {
	it.each([
		['Jane Doe', 'JD'],
		['Dr. Marie Park', 'MP'],
		['  Jane Doe  ', 'JD'],
		['jane doe', 'JD'],
		['Marie', 'M'],
		['Mary Jane Watson', 'MJ'],
		['Dr. Mary Jane Watson', 'MJ'],
		// an honorific is dropped only as the FIRST part, once
		['Dr. Dr. Park', 'DP'],
		['Marie Dr. Park', 'MD'],
		['Ms Mr', 'M'],
		// no honorific, or no name left: nothing to take
		['Dr.', ''],
		['Mx', ''],
		['', ''],
		['   ', ''],
		// the first CODE POINT, not the first UTF-16 unit
		['\u{1F600} Smile', '\u{1F600}S'],
		['élodie östlund', 'ÉÖ'],
		// empty parts (a run of spaces) are skipped, as the Liquid and the PHP twin skip them: "Jane  Doe" is "JD"
		['Jane  Doe', 'JD'],
		['Jane     Doe', 'JD'],
		['Dr.  Marie   Park', 'MP'],
		['Dr.   Dr. Park', 'DP'],
		['Mary  Jane  Watson', 'MJ'],
		['Dr.  ', ''],
		['Dr.   Mx', 'M'],
	])('%j -> %j', (name, initials) => {
		expect(initialsOf(name)).toBe(initials)
	})

	it.each([
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
	])('drops the honorific %j, in any case, and takes the two parts after it', (honorific) => {
		expect(initialsOf(`${honorific} Marie Park`)).toBe('MP')
		expect(initialsOf(`${honorific.toUpperCase()} Marie Park`)).toBe('MP')
	})

	it('keeps a first part that merely starts like an honorific', () => {
		expect(initialsOf('Drew Park')).toBe('DP')
		expect(initialsOf('Professor Park')).toBe('PP')
		expect(initialsOf('Msgr Park')).toBe('MP')
	})

	it('reads a value that is not text as no name', () => {
		for (const name of [undefined, null, {}, [], true, Number.NaN]) expect(initialsOf(name)).toBe('')
	})
})

describe('readerFace', () => {
	const face = (input: Partial<Parameters<typeof readerFace>[0]> = {}) =>
		readerFace({ photo: undefined, show: true, name: 'Jane Doe', size: 'lg', width: 112, ...input })

	it('paints the initials in exactly the bytes of the spec', () => {
		expect(face()).toBe(`<span class="certrev-r-face lg">${svg('JD')}</span>`)
		expect(face({ size: '' })).toBe(`<span class="certrev-r-face">${svg('JD')}</span>`)
		expect(face({ size: 'sm' })).toBe(`<span class="certrev-r-face sm">${svg('JD')}</span>`)
	})

	it('paints the initials of a name with a run of spaces in it, as the portal does', () => {
		expect(face({ name: 'Jane  Doe' })).toBe(`<span class="certrev-r-face lg">${svg('JD')}</span>`)
	})

	it('paints the silhouette, as before, for an empty name or a name that is only an honorific', () => {
		for (const name of ['', '   ', 'Dr.', 'Dr.  ', ' Mx ', undefined, null]) {
			expect(face({ name })).toBe(`<span class="certrev-r-face lg">${SILHOUETTE}</span>`)
		}
	})

	it('paints a photo as the unchanged <img>, never the initials', () => {
		expect(face({ photo: REVIEWER_PHOTO })).toBe(
			`<span class="certrev-r-face lg"><img src="${REVIEWER_PHOTO}" alt="" width="46" height="46" loading="lazy" decoding="async"></span>`,
		)
	})

	it('paints the initials when the photo is not to be shown, and never reads the URL', () => {
		const hostile = { toString: () => assertNever() }
		const assertNever = (): never => {
			throw new Error('the photo URL was read')
		}
		expect(face({ photo: REVIEWER_PHOTO, show: false })).toBe(`<span class="certrev-r-face lg">${svg('JD')}</span>`)
		expect(face({ photo: hostile, show: false })).toBe(`<span class="certrev-r-face lg">${svg('JD')}</span>`)
	})

	it('paints the initials for a missing, blank or unsafe photo', () => {
		for (const photo of [
			undefined,
			null,
			'',
			'   ',
			'javascript:alert(1)',
			'data:image/png;base64,AAAA',
			'ftp://x.test/a.jpg',
			7,
		]) {
			expect(face({ photo }), String(photo)).toBe(`<span class="certrev-r-face lg">${svg('JD')}</span>`)
		}
	})

	it('escapes the initials: < and & (and the other HTML specials) never reach the page raw', () => {
		expect(face({ name: '<b> Doe' })).toBe(`<span class="certrev-r-face lg">${svg('&lt;D')}</span>`)
		expect(face({ name: '& Doe' })).toBe(`<span class="certrev-r-face lg">${svg('&amp;D')}</span>`)
		expect(face({ name: '"Q" \'R\'' })).toBe(`<span class="certrev-r-face lg">${svg('&quot;&#39;')}</span>`)
		expect(face({ name: '> <' })).toBe(`<span class="certrev-r-face lg">${svg('&gt;&lt;')}</span>`)
	})

	it('uppercases the initials', () => {
		expect(face({ name: 'jane doe' })).toContain('>JD</text>')
	})
})

describe('the initials at every avatar site', () => {
	// FULL: the reviewer "Dr. Avery Quinlan" (AQ) and the writer "Morgan Placeholder" (MP).
	it('the sidebar: the reviewer, lg', () => {
		const html = paint(contentWith({ photo: undefined }), 'sidebar')
		expect(avatarSpans(html)).toEqual([`<span class="certrev-r-face lg">${svg('AQ')}</span>`])
	})

	it('the banner: the writer sm with the writer name, the reviewer with no size class, and the memo reviewer lg', () => {
		const html = paint(contentWith({ photo: undefined, authorPhoto: undefined }), 'banner')
		expect(avatarSpans(html)).toEqual([
			`<span class="certrev-r-face sm">${svg('MP')}</span>`,
			`<span class="certrev-r-face">${svg('AQ')}</span>`,
			`<span class="certrev-r-face lg">${svg('AQ')}</span>`,
		])
		expect(avatarSpans(paint(contentWith({ photo: undefined }), 'banner', { part: 'header' }))).toHaveLength(2)
		expect(avatarSpans(paint(contentWith({ photo: undefined }), 'banner', { part: 'memo' }))).toEqual([
			`<span class="certrev-r-face lg">${svg('AQ')}</span>`,
		])
	})

	it('the writer has their own name: an honorific on the writer is dropped by the same rule', () => {
		const html = paint(
			contentWith({ photo: undefined, authorPhoto: undefined, authorName: 'Prof. Sam Writer' }),
			'banner',
		)
		expect(avatarSpans(html)[0]).toBe(`<span class="certrev-r-face sm">${svg('SW')}</span>`)
	})

	it('a name with < or & is escaped at the site, and nowhere raw', () => {
		const html = paint(contentWith({ name: '<Tom> & Jerry', photo: undefined }), 'sidebar')
		expect(avatarSpans(html)).toEqual([`<span class="certrev-r-face lg">${svg('&lt;&amp;')}</span>`])
		expect(html).not.toContain(
			'<text x="20" y="20" text-anchor="middle" dominant-baseline="central" font-size="15" font-weight="700"><',
		)
	})

	it('a reviewer with an empty name paints no face at all (the byline has nothing to name), never a bare silhouette', () => {
		expect(paint(contentWith({ name: '' }), 'sidebar')).toBe('')
		expect(paint(contentWith({ name: '' }), 'banner', { part: 'header' })).toBe('')
	})

	it('a writer with a name that is only an honorific paints the silhouette', () => {
		const html = paint(contentWith({ photo: undefined, authorPhoto: undefined, authorName: 'Dr.' }), 'banner', {
			part: 'header',
		})
		// the writer byline needs a name to show; "Dr." is one, with no initials to take
		expect(avatarSpans(html)).toContain(`<span class="certrev-r-face sm">${SILHOUETTE}</span>`)
	})
})

describe('the photo and the initials, by def and display', () => {
	const photos = { photo: REVIEWER_PHOTO, authorPhoto: WRITER_PHOTO }

	it('a photo that exists, is safe and may be shown is painted as the <img>, at every site', () => {
		const banner = paint(contentWith(photos), 'banner')
		expect(avatarSpans(banner).map((span) => (span.includes('<img') ? 'img' : 'other'))).toEqual(['img', 'img', 'img'])
		expect(banner).toContain('masked/reviewer.jpg')
		expect(banner).toContain('masked/author.jpg')
		expect(avatarSpans(paint(contentWith(photos), 'sidebar'))[0]).toContain('<img ')
	})

	it('a missing photo gives the initials', () => {
		for (const layout of ['sidebar', 'banner'] as const) {
			const html = paint(contentWith({ photo: undefined, authorPhoto: undefined }), layout)
			expect(html).not.toContain('<img src="https://cdn.example.test')
			expect(avatarSpans(html).every((span) => span.includes('<text '))).toBe(true)
		}
	})

	it('a def that hides reviewerPhoto gives the initials and never writes either photo URL', () => {
		for (const layout of ['sidebar', 'banner'] as const) {
			const html = paint(contentWith(photos), layout, { hidden: ['reviewerPhoto'] })
			expect(html).not.toContain('masked/reviewer.jpg')
			expect(html).not.toContain('masked/author.jpg')
			expect(html).not.toMatch(/<span class="certrev-r-face[^"]*"><img/)
			const spans = avatarSpans(html)
			expect(spans.length).toBeGreaterThan(0)
			expect(spans.every((span) => span.includes('<text '))).toBe(true)
		}
		expect(avatarSpans(paint(contentWith(photos), 'banner', { hidden: ['reviewerPhoto'] }))).toEqual([
			`<span class="certrev-r-face sm">${svg('MP')}</span>`,
			`<span class="certrev-r-face">${svg('AQ')}</span>`,
			`<span class="certrev-r-face lg">${svg('AQ')}</span>`,
		])
	})

	it('display.showExpertPhoto false gives the initials and never writes a photo URL', () => {
		for (const layout of ['sidebar', 'banner'] as const) {
			const html = paint(contentWith({ ...photos, display: { showExpertPhoto: false } }), layout)
			expect(html).not.toContain('masked/reviewer.jpg')
			expect(html).not.toContain('masked/author.jpg')
			expect(avatarSpans(html).every((span) => span.includes('<text '))).toBe(true)
		}
	})

	it('hiding another field (or showExpertPhoto true) leaves the photos', () => {
		expect(paint(contentWith(photos), 'sidebar', { hidden: ['memo'] })).toContain('masked/reviewer.jpg')
		expect(paint(contentWith({ ...photos, display: { showExpertPhoto: true } }), 'sidebar')).toContain(
			'masked/reviewer.jpg',
		)
	})
})
