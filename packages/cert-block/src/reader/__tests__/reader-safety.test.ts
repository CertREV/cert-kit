/**
 * The reader face makes no request of its own and never throws.
 *
 *  - Nothing in `src/reader` (or its stylesheet) fetches, beacons, opens a socket, loads a script or a stylesheet, or
 *    imports dynamically: the card paints from the envelope it already verified, and the modal is wired by the host's
 *    script from the `data-certrev-modal-open` hooks. The one network read on the Builder path is the Delivery API read
 *    the card already did in 1.1.0 (`reader-face-card.test.tsx` counts it). The stylesheet's only reference to another
 *    host is the reader `@font-face` rules' `.woff2` files on assets.certrev.com, which the browser (not the card) fetches.
 *  - `renderReaderFace` is a pure function of its input: a hostile or missing field (a number, an object, an array, a
 *    null) renders as nothing, never as an exception, so one bad envelope field cannot take a Builder page down.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { READER_CSS, type ReaderLayout, type ReaderPart, renderReaderFace } from '../index.js'

const SRC = new URL('../', import.meta.url)
const SOURCES = readdirSync(SRC)
	.filter((name) => name.endsWith('.ts') && name !== 'reader-css.generated.ts')
	.sort()

/** Block comments and whole-line `//` comments out, so a doc comment may name what the code must not do. */
const stripComments = (source: string) =>
	source
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split('\n')
		.filter((line) => !line.trim().startsWith('//'))
		.join('\n')

describe('no network, no script, no dynamic code', () => {
	it('lists the reader sources it checks', () => {
		expect(SOURCES).toEqual([
			'face.ts',
			'helpers.ts',
			'index.ts',
			'logo-assets.generated.ts',
			'logo.ts',
			'render.ts',
			'tokens.ts',
		])
	})

	const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
		['fetch', /\bfetch\s*\(/],
		['XMLHttpRequest', /XMLHttpRequest/],
		['sendBeacon', /sendBeacon/],
		['WebSocket', /WebSocket/],
		['EventSource', /EventSource/],
		['dynamic import', /\bimport\s*\(/],
		['eval', /\beval\s*\(/],
		['Function constructor', /\bnew\s+Function\s*\(/],
		['document', /\bdocument\b/],
		['window', /\bwindow\b/],
		['globalThis', /\bglobalThis\b/],
		['process.env', /process\.env/],
	]

	describe.each(SOURCES)('%s', (name) => {
		const code = stripComments(readFileSync(new URL(name, SRC), 'utf8'))
		it.each(FORBIDDEN)('does not use %s', (_label, pattern) => {
			expect(code).not.toMatch(pattern)
		})
	})

	it('imports only from inside the package (no dependency, no node: builtin)', () => {
		for (const name of SOURCES) {
			const specifiers = [...readFileSync(new URL(name, SRC), 'utf8').matchAll(/from\s+'([^']+)'/g)].map(
				(m) => m[1] as string,
			)
			for (const specifier of specifiers) expect(specifier, `${name}: ${specifier}`).toMatch(/^\.\.?\//)
		}
	})

	it('the stylesheet loads nothing but CertREV font files: no @import, no other url(), no expression', () => {
		expect(READER_CSS).not.toMatch(/@import/i)
		expect(READER_CSS).not.toMatch(/expression\s*\(|javascript:/i)
		// The one thing it fetches is the reader's own `@font-face` files, from the CertREV font host the modal bundle's
		// `CERT_FONT_FACE_CSS` already names: a `.woff2` under /fonts/, nothing else, and never a relative or other-host url.
		// (The file names carry digits, as in `cert-reader-jakarta-800-latin.woff2`; twelve files serve the forty faces.)
		const urls = [...READER_CSS.matchAll(/url\(([^)]*)\)/gi)].map((m) => (m[1] as string).trim())
		expect(urls.length).toBeGreaterThan(0)
		for (const url of urls)
			expect(url, url).toMatch(/^"https:\/\/assets\.certrev\.com\/fonts\/cert-reader-[a-z0-9-]+\.woff2"$/)
		// Every url() sits in the src of a `@font-face` under certrev.com's own family names (the reader's `font-stretch:
		// 101%` keeps them apart from the legacy faces of the same names), never under an invented alias. The four metric
		// "* Fallback" faces fetch nothing: they read a local font.
		const SITE_FAMILIES = ['DM Sans', 'Playfair Display', 'Plus Jakarta Sans', 'JetBrains Mono']
		const faces = [...READER_CSS.matchAll(/@font-face\s*\{[^}]*\}/gi)].map((m) => m[0])
		expect(faces).toHaveLength(44)
		let fetched = 0
		for (const face of faces) {
			const family = /font-family:\s*"([^"]+)"/.exec(face)?.[1] ?? ''
			expect(face).toMatch(/font-stretch:\s*101%/)
			if (family.endsWith(' Fallback')) {
				expect(SITE_FAMILIES, face).toContain(family.slice(0, -' Fallback'.length))
				expect(face).toMatch(/src:\s*local\(/)
				expect(face).not.toMatch(/url\(/)
			} else {
				expect(SITE_FAMILIES, face).toContain(family)
				expect(face).toMatch(/src:\s*url\("https:\/\/assets\.certrev\.com\/fonts\/cert-reader-[a-z0-9-]+\.woff2"\)/)
				fetched++
			}
		}
		expect(fetched).toBe(40)
		expect(urls).toHaveLength(fetched)
		expect(READER_CSS).not.toMatch(/CertREV Reader (Serif|Grotesk)/)
	})

	it('the markup it paints carries no script, no handler, no stylesheet link and no frame', () => {
		for (const layout of ['banner', 'sidebar', 'floating'] as const) {
			const html = renderReaderFace({
				content: {
					memo: 'A memo',
					verifyUrl: 'https://certrev.com/verify/x',
					expert: {
						displayName: 'Dr. Jane Doe',
						profileUrl: 'https://certrev.com/experts/x',
						photoUrl: 'https://cdn.certrev.com/a.jpg',
					},
				} as never,
				layout,
			})
			expect(html).not.toMatch(/<script|<link\b|<iframe|<object|<embed|\son[a-z]+\s*=/i)
		}
	})
})

describe('never throws on a hostile envelope', () => {
	const HOSTILE: readonly unknown[] = [
		undefined,
		null,
		0,
		7,
		true,
		'',
		'text',
		[],
		['x'],
		{},
		{ toString: () => 'boom' },
		{
			toString: () => {
				throw new Error('boom')
			},
		},
		{
			valueOf: () => {
				throw new Error('boom')
			},
		},
		Object.create(null),
	]

	const LAYOUTS: readonly ReaderLayout[] = ['banner', 'sidebar', 'floating']
	const PARTS: readonly ReaderPart[] = ['full', 'header', 'memo']

	it.each(HOSTILE.map((value, index) => [index, value] as const))('a field of hostile type #%i', (_index, hostile) => {
		const content = {
			memo: hostile,
			verifyUrl: hostile,
			display: { showExpertPhoto: hostile, showAuthor: hostile, showBio: hostile },
			author: { name: hostile, title: hostile, photoUrl: hostile },
			expert: {
				displayName: hostile,
				profileUrl: hostile,
				photoUrl: hostile,
				bio: hostile,
				compensationCue: hostile,
				credentialVerifiedAt: hostile,
				credentials: [{ abbreviation: hostile, cardLabel: hostile }, hostile],
			},
		}
		const def = {
			v: hostile,
			hidden: hostile,
			tokens: { accentColor: hostile, surface: hostile, fontSlot: hostile, cornerRadius: hostile },
			accentFg: hostile,
		}
		for (const layout of LAYOUTS) {
			for (const part of PARTS) {
				expect(() =>
					renderReaderFace({ content: content as never, def, layout, part, certId: hostile as never }),
				).not.toThrow()
				expect(typeof renderReaderFace({ content: content as never, def, layout, part })).toBe('string')
			}
		}
	})

	it.each(
		HOSTILE.map((value, index) => [index, value] as const),
	)('a whole hostile content / def #%i', (_index, hostile) => {
		for (const layout of LAYOUTS) {
			expect(() => renderReaderFace({ content: hostile as never, def: hostile, layout })).not.toThrow()
		}
		expect(renderReaderFace({ content: hostile as never, layout: 'banner' })).toBe('')
	})

	it('a hostile layout or part falls back, it does not throw', () => {
		const content = {
			memo: 'm',
			verifyUrl: 'https://certrev.com/verify/x',
			expert: { displayName: 'Dr. Jane Doe' },
		} as never
		for (const layout of ['', 'custom', 'Banner', null, 3] as unknown[]) {
			expect(() => renderReaderFace({ content, layout: layout as never, part: layout as never })).not.toThrow()
		}
	})
})
