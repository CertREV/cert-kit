/**
 * The reader face against the portal's Liquid harness, on the edge cases the goldens do not reach.
 *
 * `fixtures/oracle-extra.json` holds 236 cells (hostile text, missing and blank facts, unsafe and lookalike URLs,
 * honorifics, every token guard, hidden fields, the illustrative label, a cue-less pro-bono expert …) with the sections
 * the portal's own Liquid harness (the engine that writes the portal goldens) produced for each. They are written by
 * `scripts/refresh-reader.mjs --oracle` from the portal checkout; nothing in them was typed by hand. A cell passing here
 * means the TypeScript port and the Liquid snippets agree on that input.
 *
 * Two normalisations, applied to the harness's side only. liquidjs's `escape` spells `"` as `&#34;`, Shopify's (and this
 * package's `escapeHtml`) as `&quot;`. And the `rel` value on the anchors: the Liquid says `noopener noreferrer`, the
 * reader face keeps the package's `CERTREV_LINK_REL` (sponsored/nofollow), so `withPackageRel` rewrites that one value
 * before the compare. Everything else is compared as it came, so any other byte difference fails;
 * `reader-link-rel.test.ts` pins the rel exception.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CertContent } from '../../contract/kernel.js'
import { type ReaderLayout, renderReaderFace } from '../render.js'
import { withPackageRel } from './liquid-rel.js'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

interface ExtraCell {
	readonly id: string
	readonly layout: ReaderLayout
	readonly def: unknown
	readonly content: CertContent
	readonly illustrative?: boolean
	readonly expected: readonly string[]
}

const { certId } = JSON.parse(readFileSync(`${FIXTURES}golden-cells.json`, 'utf8')) as { certId: string }
const { cells } = JSON.parse(readFileSync(`${FIXTURES}oracle-extra.json`, 'utf8')) as { cells: ExtraCell[] }

const shopifyEscape = (html: string): string => html.replaceAll('&#34;', '&quot;')

describe('the harness cells are present', () => {
	it('keeps the breadth the differential was written with', () => {
		expect(cells.length).toBeGreaterThanOrEqual(230)
		for (const layout of ['banner', 'sidebar', 'floating'] as const) {
			expect(cells.filter((cell) => cell.layout === layout).length).toBeGreaterThan(10)
		}
		// a render that paints nothing is part of the contract too (no reviewer name; a pill with no safe URL)
		expect(cells.some((cell) => cell.expected.length === 0)).toBe(true)
		expect(cells.some((cell) => cell.expected.length > 0)).toBe(true)
	})
})

describe('renderReaderFace equals the Liquid harness', () => {
	it.each(cells)('$id', ({ layout, def, content, illustrative, expected }) => {
		const html = renderReaderFace({ content, def, layout, certId, illustrative })
		expect(html).toBe(expected.map(shopifyEscape).map(withPackageRel).join('\n'))
	})
})
