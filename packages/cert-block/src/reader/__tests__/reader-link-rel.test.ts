/**
 * The reader face's links: what they point at, how they are qualified, and what hooks they carry.
 *
 * Every reader anchor carries the package's own `CERTREV_LINK_REL` (`nofollow sponsored noopener`, see
 * `src/components/rel.ts`), the same as the legacy faces. A Builder page's CertREV links are a paid, vendor-required
 * placement and the legacy face already declares them sponsored/nofollow, so a new face must not quietly drop that
 * signal. The Shopify snippets (and so the portal's goldens and the Liquid harness) have always said
 * `rel="noopener noreferrer"` on every face; that is theirs, not the target.
 *
 * It follows that the reader is NOT byte-equal to the Liquid: the `rel` value on its anchors differs, and nothing else
 * may. `the reader's rel is the only byte that differs from the Liquid` below pins that over every golden page and every
 * harness cell: the Liquid's rel is rewritten to the package's (see `liquid-rel.ts`) and then every other byte is
 * compared. This is the file to read before changing either value.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CERTREV_LINK_REL } from '../../components/rel.js'
import type { CertContent } from '../../contract/kernel.js'
import { type ReaderLayout, renderReaderFace } from '../index.js'
import { anchorsOf, LIQUID_REL, readerSections, withoutAnchorRel, withPackageRel } from './liquid-rel.js'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

interface Cell {
	readonly id: string
	readonly layout?: ReaderLayout
	readonly def: unknown
	readonly content: CertContent
	readonly illustrative?: boolean
	readonly expected?: readonly string[]
}

const { certId, cells: goldenCells } = JSON.parse(readFileSync(`${FIXTURES}golden-cells.json`, 'utf8')) as {
	certId: string
	cells: Cell[]
}
const { cells: oracleCells } = JSON.parse(readFileSync(`${FIXTURES}oracle-extra.json`, 'utf8')) as { cells: Cell[] }

const goldenPage = (id: string): string => readFileSync(`${FIXTURES}golden/${id}.html`, 'utf8')
const layoutOf = (id: string): ReaderLayout => id.split('.')[0] as ReaderLayout
// liquidjs spells `"` as `&#34;` where Shopify and this package say `&quot;` (see reader-differential.test.ts)
const shopifyEscape = (html: string): string => html.replaceAll('&#34;', '&quot;')
const relOf = (tag: string): string | undefined => /\srel="([^"]*)"/.exec(tag)?.[1]

describe('the two link policies', () => {
	it("the package's is the sponsored/nofollow policy the Builder legacy face declares", () => {
		expect(CERTREV_LINK_REL).toBe('nofollow sponsored noopener')
		expect(CERTREV_LINK_REL.split(' ')).toEqual(expect.arrayContaining(['nofollow', 'sponsored', 'noopener']))
	})

	it("the Liquid's is noopener noreferrer, which is not the package's", () => {
		expect(LIQUID_REL).toBe('noopener noreferrer')
		expect(LIQUID_REL).not.toBe(CERTREV_LINK_REL)
	})
})

describe("the reader's rel is the only byte that differs from the Liquid", () => {
	const golden = goldenCells.map(({ id, def, content }) => ({
		id: `golden ${id}`,
		layout: layoutOf(id),
		liquid: readerSections(goldenPage(id)),
		html: renderReaderFace({ content, def, layout: layoutOf(id), certId }),
	}))
	const oracle = oracleCells.map(({ id, layout, def, content, illustrative, expected }) => ({
		id: `harness ${id}`,
		layout: layout as ReaderLayout,
		liquid: (expected ?? []).map(shopifyEscape),
		html: renderReaderFace({ content, def, layout: layout as ReaderLayout, certId, illustrative }),
	}))
	const all = [...golden, ...oracle]

	it('covers every golden page and every harness cell, and the anchors in them', () => {
		expect(golden.length).toBeGreaterThanOrEqual(11)
		expect(oracle.length).toBeGreaterThanOrEqual(130)
		const anchored = all.filter((cell) => anchorsOf(cell.html).length > 0)
		expect(anchored.length).toBeGreaterThan(100)
		for (const layout of ['banner', 'sidebar', 'floating'] as const) {
			expect(anchored.some((cell) => cell.layout === layout)).toBe(true)
		}
	})

	it.each(all)('$id: every reader anchor carries exactly CERTREV_LINK_REL', ({ html }) => {
		for (const tag of anchorsOf(html)) {
			expect(relOf(tag), tag).toBe(CERTREV_LINK_REL)
			expect(tag, tag).not.toContain('noreferrer')
		}
	})

	it.each(all)('$id: every Liquid anchor carries exactly the Liquid rel, one for one with the reader', ({
		liquid,
		html,
	}) => {
		const liquidAnchors = anchorsOf(liquid.join('\n'))
		for (const tag of liquidAnchors) expect(relOf(tag), tag).toBe(LIQUID_REL)
		expect(anchorsOf(html).length).toBe(liquidAnchors.length)
	})

	it.each(all)('$id: with the rel normalised on its anchors, the reader is the Liquid byte for byte', ({
		liquid,
		html,
	}) => {
		expect(html).toBe(liquid.map(withPackageRel).join('\n'))
	})

	it.each(all)('$id: with the rel removed from both, nothing else differs', ({ liquid, html }) => {
		expect(withoutAnchorRel(html)).toBe(withoutAnchorRel(liquid.join('\n')))
	})

	describe('the check has teeth', () => {
		const sample = all.find((cell) => anchorsOf(cell.html).length >= 2 && cell.html.includes('target="_blank"'))

		it('a render whose anchors keep the Liquid rel is not the reader', () => {
			expect(sample).toBeDefined()
			const liquid = sample?.liquid.join('\n') ?? ''
			expect(sample?.html).not.toBe(liquid)
			expect(sample?.html).toBe(sample?.liquid.map(withPackageRel).join('\n'))
		})

		it('any other byte, anywhere, fails the normalised compare', () => {
			const html = sample?.html ?? ''
			const mutations = [
				html.replace('target="_blank"', 'target="_self"'),
				html.replace('data-certrev-modal-open', 'data-certrev-modal-close'),
				html.replace(/(<a\s[^>]*>)([^<]*)/, '$1$2.'),
				html.replace('<section', '<section data-x="1"'),
				html.replace(/(\srel="[^"]*")/, '$1 hreflang="en"'),
			]
			const expected = sample?.liquid.map(withPackageRel).join('\n')
			for (const mutated of mutations) {
				expect(mutated).not.toBe(html)
				expect(mutated).not.toBe(expected)
			}
		})

		it('a Liquid anchor with any rel but its own is refused, never silently rewritten', () => {
			expect(() => withPackageRel('<a href="https://certrev.com/verify/x" rel="noopener">v</a>')).toThrow(/without rel/)
			expect(() => withPackageRel('<a href="https://certrev.com/verify/x">v</a>')).toThrow(/without rel/)
			expect(() => withPackageRel(`<a href="https://certrev.com/verify/x" rel="${CERTREV_LINK_REL}">v</a>`)).toThrow(
				/without rel/,
			)
		})

		it('only the rel value of an anchor is rewritten: the same words elsewhere are left alone', () => {
			const liquid = `<p rel="${LIQUID_REL}">${LIQUID_REL}</p><a href="https://certrev.com/a" rel="${LIQUID_REL}">${LIQUID_REL}</a>`
			expect(withPackageRel(liquid)).toBe(
				`<p rel="${LIQUID_REL}">${LIQUID_REL}</p><a href="https://certrev.com/a" rel="${CERTREV_LINK_REL}">${LIQUID_REL}</a>`,
			)
		})
	})
})

describe('the anchors on the portal goldens', () => {
	describe.each(
		readdirSync(`${FIXTURES}golden`)
			.filter((name) => name.endsWith('.html'))
			.sort(),
	)('%s', (name) => {
		const anchors = anchorsOf(readFileSync(`${FIXTURES}golden/${name}`, 'utf8'))

		it('are new-tab links with a modal hook and an https href', () => {
			expect(anchors.length).toBeGreaterThan(0)
			for (const a of anchors) {
				expect(a, a).toContain('target="_blank"')
				expect(a, a).toContain('data-certrev-modal-open')
				expect(a, a).toMatch(/href="https:\/\/[^"]+"/)
			}
		})

		it('the profile link opens the expert modal, the certificate link the certificate modal', () => {
			for (const a of anchors) {
				if (a.includes('/experts/')) expect(a, a).toContain('data-certrev-modal-open="expert"')
				else if (a.includes('/verify/')) expect(a, a).toMatch(/data-certrev-modal-open>$/)
			}
		})
	})
})

describe('what the face renders from the facts', () => {
	const content = {
		memo: 'A short memo.',
		verifyUrl: 'https://certrev.com/verify/cert_x',
		expert: { displayName: 'Dr. Jane Doe', profileUrl: 'https://certrev.com/experts/jane-doe', credentials: [] },
	} as never

	it.each([
		'banner',
		'sidebar',
		'floating',
	] as const)('%s: only the two CertREV links, qualified, with modal hooks', (layout) => {
		const anchors = anchorsOf(renderReaderFace({ content, layout }))
		expect(anchors.length).toBeGreaterThanOrEqual(1)
		for (const a of anchors) {
			expect(relOf(a), a).toBe(CERTREV_LINK_REL)
			expect(a).toContain('data-certrev-modal-open')
			expect(a).toMatch(/href="https:\/\/certrev\.com\/(verify|experts)\//)
		}
	})

	it('a link that is not http(s) is dropped, never emitted', () => {
		const html = renderReaderFace({
			content: {
				memo: 'm',
				verifyUrl: 'javascript:alert(1)',
				expert: { displayName: 'Dr. Jane Doe', profileUrl: 'data:text/html,<b>x</b>' },
			} as never,
			layout: 'banner',
		})
		expect(html).not.toMatch(/javascript:/i)
		expect(html).not.toMatch(/href="data:/i)
		expect(anchorsOf(html)).toEqual([])
	})

	it('a hostile URL is escaped inside the attribute', () => {
		const html = renderReaderFace({
			content: {
				memo: 'm',
				verifyUrl: 'https://certrev.com/verify/x?a="b"&c=<d>',
				expert: { displayName: 'Dr. Jane Doe' },
			} as never,
			layout: 'sidebar',
		})
		const [anchor] = anchorsOf(html)
		expect(anchor).toBeDefined()
		expect(anchor).not.toMatch(/href="[^"]*"[^>]*"b"/)
		expect(anchor).not.toContain('<d>')
	})
})
