/**
 * The reader face's logo is the demo's own files, not a redrawn mark.
 *
 * certrev.com's reader card prints `<img>` elements that point at `logo-white.svg` (the cap on a dark accent) and
 * `logo-mono.svg` (the verified footer, and the cap on a light accent). The portal's parity engine prints those two
 * files as base64 `data:image/svg+xml` URIs of their exact bytes, and the judge compares the `<img src>`. So the face
 * carries the same two URIs (`logo-assets.generated.ts`, written by `scripts/refresh-reader.mjs`), and these tests pin:
 *
 *  - the bytes: each URI decodes to a file whose sha256 is one of the two literals below (the portal's own
 *    `reader-logo-files.test.ts` pins the same two), and the manifest records the same;
 *  - the use: the white file is the cap on a dark accent, the mono file the cap on a light accent and the footer's
 *    mark, and no other image source and no inline-drawn mark is left in the face.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CertContent } from '../../contract/kernel.js'
import { readerLogo } from '../logo.js'
import { LOGO_MONO_DATA_URI, LOGO_WHITE_DATA_URI } from '../logo-assets.generated.js'
import { renderReaderFace } from '../render.js'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const PREFIX = 'data:image/svg+xml;base64,'

/** The two files of certrev.com's demo, as the portal pins them (`reader-logo-files.test.ts` there). */
const WHITE_SHA256 = '3c819f65aebfb0c22a5cc067ca592209212f00027f310db4c681075c2b3d2d07'
const MONO_SHA256 = 'da906f44a636fb97a6d9a875649c50048f8de7e453d51dc4caf60383828f3c3e'

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const decode = (uri: string): Buffer => Buffer.from(uri.slice(PREFIX.length), 'base64')

describe('the two logo files', () => {
	it('are the demo’s own bytes: white and mono, by sha256', () => {
		expect(LOGO_WHITE_DATA_URI.startsWith(PREFIX)).toBe(true)
		expect(LOGO_MONO_DATA_URI.startsWith(PREFIX)).toBe(true)
		expect(sha256(decode(LOGO_WHITE_DATA_URI))).toBe(WHITE_SHA256)
		expect(sha256(decode(LOGO_MONO_DATA_URI))).toBe(MONO_SHA256)
	})

	it('are printed as canonical base64 of those bytes (what the parity engine prints), with no padding drift', () => {
		for (const uri of [LOGO_WHITE_DATA_URI, LOGO_MONO_DATA_URI]) {
			const bytes = decode(uri)
			expect(uri).toBe(`${PREFIX}${bytes.toString('base64')}`)
			expect(bytes.toString('utf8').startsWith('<svg ')).toBe(true)
		}
	})

	it('are two different files: white ink and black ink', () => {
		expect(LOGO_WHITE_DATA_URI).not.toBe(LOGO_MONO_DATA_URI)
		const fills = (uri: string) =>
			new Set(
				[
					...decode(uri)
						.toString('utf8')
						.matchAll(/fill="(#[0-9a-f]{6})"/gi),
				].map((m) => m[1]),
			)
		expect([...fills(LOGO_WHITE_DATA_URI)]).toEqual(['#ffffff'])
		expect([...fills(LOGO_MONO_DATA_URI)]).toEqual(['#000000'])
	})

	it('match the manifest the refresh script wrote', () => {
		const manifest = JSON.parse(readFileSync(`${FIXTURES}SOURCES.json`, 'utf8')) as {
			logos: { files: Record<'white' | 'mono', { bytes: number; sha256: string }> }
		}
		expect(manifest.logos.files.white.sha256).toBe(WHITE_SHA256)
		expect(manifest.logos.files.mono.sha256).toBe(MONO_SHA256)
		expect(decode(LOGO_WHITE_DATA_URI).length).toBe(manifest.logos.files.white.bytes)
		expect(decode(LOGO_MONO_DATA_URI).length).toBe(manifest.logos.files.mono.bytes)
	})
})

describe('readerLogo', () => {
	it('prints the file as the img src and nothing else of the mark', () => {
		expect(readerLogo('white', 18, 'CertREV')).toBe(
			`<img src="${LOGO_WHITE_DATA_URI}" alt="CertREV" width="18" height="18" decoding="async">`,
		)
		expect(readerLogo('mono', 17, '')).toBe(
			`<img src="${LOGO_MONO_DATA_URI}" alt="" width="17" height="17" decoding="async">`,
		)
	})
})

describe('the logo on the golden pages’ inputs', () => {
	const { certId, cells } = JSON.parse(readFileSync(`${FIXTURES}golden-cells.json`, 'utf8')) as {
		certId: string
		cells: { id: string; def: { accentFg: string }; content: CertContent }[]
	}
	const layoutOf = (id: string) => id.split('.')[0] as 'banner' | 'sidebar' | 'floating'
	const marks = (html: string) => [
		...html.matchAll(/<img src="(data:image\/svg\+xml[^"]*)" alt="([^"]*)" width="(\d+)"/g),
	]

	it.each(
		cells.filter((c) => layoutOf(c.id) !== 'floating'),
	)('$id: white cap on a dark accent, mono cap on a light one, mono footer', ({ id, def, content }) => {
		const html = renderReaderFace({ content, def, layout: layoutOf(id), certId })
		const dark = def.accentFg === '#ffffff'
		const found = marks(html)
		// every <img> that is not an avatar is a logo, and each one is exactly one of the two files
		expect(found.length).toBeGreaterThanOrEqual(1)
		for (const m of found) expect([LOGO_WHITE_DATA_URI, LOGO_MONO_DATA_URI]).toContain(m[1])
		const caps = found.filter((m) => m[2] === 'CertREV')
		expect(caps.length).toBeGreaterThanOrEqual(1)
		for (const cap of caps) {
			expect(cap[1]).toBe(dark ? LOGO_WHITE_DATA_URI : LOGO_MONO_DATA_URI)
			expect(cap[3]).toBe('18')
		}
		const footers = found.filter((m) => m[2] === '')
		for (const footer of footers) {
			expect(footer[1]).toBe(LOGO_MONO_DATA_URI)
			expect(footer[3]).toBe('17')
		}
		// the old inline-drawn mark is gone
		expect(html).not.toContain('data:image/svg+xml,')
		expect(html).not.toContain('%3Cpath')
	})

	it('the banner with a memo carries a verified-footer mark, the sparse one does not', () => {
		const full = cells.find((c) => c.id === 'banner.navy-full')
		const sparse = cells.find((c) => c.id === 'banner.navy-sparse')
		if (!full || !sparse) throw new Error('missing golden cells')
		const render = (c: typeof full) => renderReaderFace({ content: c.content, def: c.def, layout: 'banner', certId })
		expect(marks(render(full)).map((m) => m[3])).toEqual(['18', '17'])
		expect(marks(render(sparse)).map((m) => m[3])).toEqual(['18'])
	})
})
