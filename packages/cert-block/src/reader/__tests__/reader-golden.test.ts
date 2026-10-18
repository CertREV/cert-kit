/**
 * The reader face against the portal's golden embed pages.
 *
 * `fixtures/golden/*.html` are the portal's own goldens (src/lib/cert-render/reader/__golden__/reader), copied byte for
 * byte by `scripts/refresh-reader.mjs`; `reader-sources.test.ts` re-hashes them. Each page is the Shopify Liquid
 * snippets' output for one cell of inputs (`golden-cells.json`, the portal's own test-kit cells). The `<section
 * class="certrev-reader…">` blocks on those pages ARE the canonical render of the face, so `renderReaderFace` must
 * emit them byte for byte: this is the "a Builder page renders the same bytes as the reader snippets" guarantee.
 *
 * One exception, and only one: the `rel` value on the anchors. The Liquid says `noopener noreferrer`; the reader face
 * keeps the package's `CERTREV_LINK_REL` (sponsored/nofollow). `withPackageRel` rewrites that one value in the golden
 * sections before the compare, so any other byte difference still fails. `reader-link-rel.test.ts` pins the exception.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CertContent } from '../../contract/kernel.js'
import { type ReaderLayout, renderReaderFace } from '../render.js'
import { readerSections, withPackageRel } from './liquid-rel.js'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

interface Cell {
	readonly id: string
	readonly variant: string
	readonly def: unknown
	readonly content: CertContent
}

const { certId, cells } = JSON.parse(readFileSync(`${FIXTURES}golden-cells.json`, 'utf8')) as {
	certId: string
	cells: Cell[]
}

const layoutOf = (id: string): ReaderLayout => id.split('.')[0] as ReaderLayout

describe('the golden pages are all covered', () => {
	it('every golden page has a cell and every cell has a page', () => {
		const pages = readdirSync(`${FIXTURES}golden`)
			.filter((name) => name.endsWith('.html'))
			.map((name) => name.replace(/\.html$/, ''))
			.sort()
		expect(cells.map((cell) => cell.id).sort()).toEqual(pages)
		expect(pages.length).toBeGreaterThanOrEqual(11)
	})
})

describe.each(cells)('golden $id', ({ id, def, content }) => {
	const page = readFileSync(`${FIXTURES}golden/${id}.html`, 'utf8')
	const sections = readerSections(page).map(withPackageRel)
	const layout = layoutOf(id)
	const render = (part?: 'full' | 'header' | 'memo') => renderReaderFace({ content, def, layout, part, certId })

	it('the page carries the expected reader sections', () => {
		// banner: the byline card and the memo card (a sparse cell has no memo, so the card alone); sidebar and pill: one.
		expect(sections.length).toBe(layout === 'banner' && content.memo ? 2 : 1)
	})

	if (layout === 'banner') {
		it('the byline card is the golden card, byte for byte', () => {
			expect(render('header')).toBe(sections[0])
		})

		it('the memo card is the golden memo, byte for byte', () => {
			expect(render('memo')).toBe(sections[1] ?? '')
		})

		it('the default render is the card and the memo, one newline apart', () => {
			expect(render()).toBe(sections.join('\n'))
			expect(render('full')).toBe(sections.join('\n'))
		})
	} else {
		it(`the ${layout} section is the golden section, byte for byte`, () => {
			expect(render()).toBe(sections[0])
		})

		it('a banner part is ignored: the sidebar and the pill are one section each', () => {
			expect(render('header')).toBe(sections[0])
			expect(render('memo')).toBe(sections[0])
		})
	}
})
