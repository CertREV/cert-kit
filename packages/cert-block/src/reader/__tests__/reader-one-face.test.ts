/**
 * The reader face as the portal's ONE FACE paints it (cert-block 1.3.1): what the Shopify snippets and the WordPress
 * plugin have painted since plugin 1.8.3, spelled out here so a reader of the port sees the rule and not only the cells.
 *
 *  - THE SIDEBAR'S PHONE FOLD (owner decision 3d0838a4). The card's bio and memo are printed twice: as the card's own
 *    pair, and again inside a closed `<details class="certrev-r-more">` whose toggle reads "Read the expert memo" (or
 *    "About the expert" when there is a bio and no memo; no fold at all with neither). The stylesheet shows one or
 *    the other: wider than 640px the pair, at 640px and under the fold. The scope line, the cue and both links never fold.
 *  - NO RUNG. The portal's frozen `preset` and `rung` keys, sent for renderers already in the field, are ignored: the
 *    card is always the memo card.
 *  - A TONED FACE. A def with an ink, or a surface that is not white, adds `certrev-r-toned` to every section root.
 *
 * Every case is held to the portal's own Liquid harness (`fixtures/oracle-extra.json`, `fixtures/golden/`) byte for
 * byte, as well as to the words here, so the port cannot drift from either.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CertContent } from '../../contract/kernel.js'
import { READER_CSS } from '../reader-css.generated.js'
import { type ReaderLayout, renderReaderFace } from '../render.js'
import { readerSections, withPackageRel } from './liquid-rel.js'

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

const cell = (id: string): ExtraCell => {
	const found = cells.find((c) => c.id === id)
	if (!found) throw new Error(`no oracle cell ${id}`)
	return found
}
const liquid = (id: string): string =>
	cell(id)
		.expected.map((html) => html.replaceAll('&#34;', '&quot;'))
		.map(withPackageRel)
		.join('\n')
/** What the port paints for the cell, after asserting it is what the Liquid painted. */
const port = (id: string): string => {
	const { layout, def, content, illustrative } = cell(id)
	const html = renderReaderFace({ content, def, layout, certId, illustrative })
	expect(html, `${id} is the Liquid's bytes`).toBe(liquid(id))
	return html
}
const sections = (html: string): string[] => readerSections(html)
const count = (html: string, needle: string): number => html.split(needle).length - 1
const DETAILS = /<details class="certrev-r-more"><summary>([^<]*)<\/summary>([\s\S]*?)<\/details>/

describe("the sidebar's phone fold", () => {
	it('the golden navy card: the own pair, then a closed details with "Read the expert memo" holding the same pair', () => {
		const golden = readFileSync(`${FIXTURES}golden/sidebar.navy-full.html`, 'utf8')
		const [section] = readerSections(golden)
		const { content, def } = JSON.parse(readFileSync(`${FIXTURES}golden-cells.json`, 'utf8')).cells.find(
			(c: { id: string }) => c.id === 'sidebar.navy-full',
		)
		const html = renderReaderFace({ content, def, layout: 'sidebar', certId })
		expect(html).toBe(withPackageRel(section as string))
		const pair = `<p>${content.expert.bio}</p><blockquote>${content.memo}</blockquote>`
		expect(html).toContain(
			`${pair}<details class="certrev-r-more"><summary>Read the expert memo</summary>${pair}</details><div class="certrev-r-scope"`,
		)
		expect(html).not.toMatch(/<details[^>]*\sopen/)
	})

	it('prints the bio and the memo twice, and the toggle says what is inside', () => {
		const html = port('x.sidebar.v9-no-hidden-photos')
		const fold = DETAILS.exec(html)
		expect(fold?.[1]).toBe('Read the expert memo')
		expect(count(html, '<p>')).toBe(2)
		expect(count(html, '<blockquote>')).toBe(2)
		expect(fold?.[2]).toContain('<p>')
		expect(fold?.[2]).toContain('<blockquote>')
	})

	it('keeps the scope line, the cue and both links outside the fold', () => {
		const html = port('x.sidebar.v9-no-hidden-photos')
		const outside = html.replace(DETAILS, '')
		expect(outside).toContain('data-ftc-disclosure data-ftc-line')
		expect(outside).toContain('<em>Compensated expert</em>')
		expect(outside).toContain('data-certrev-modal-open="expert">View Profile</a>')
		expect(outside).toContain('>View Certificate</a>')
		expect(DETAILS.exec(html)?.[2]).not.toContain('data-ftc-line')
		expect(DETAILS.exec(html)?.[2]).not.toContain('<a ')
	})

	it('a bio and no memo: the toggle says "About the expert", and holds the bio alone', () => {
		const html = port('x.sidebar.fold-bio-only')
		expect(DETAILS.exec(html)?.[1]).toBe('About the expert')
		expect(DETAILS.exec(html)?.[2]).toMatch(/^<p>[^<]*<\/p>$/)
		expect(html).not.toContain('<blockquote>')
	})

	it('a memo and no bio: "Read the expert memo", holding the memo alone', () => {
		for (const id of ['x.sidebar.fold-memo-only', 'x.sidebar.fold-memo-no-bio']) {
			const html = port(id)
			expect(DETAILS.exec(html)?.[1], id).toBe('Read the expert memo')
			expect(DETAILS.exec(html)?.[2], id).toMatch(/^<blockquote>[^<]*<\/blockquote>$/)
			expect(html, id).not.toContain('<p>')
		}
	})

	it('neither a bio nor a memo (absent, blank, hidden): no fold at all', () => {
		for (const id of [
			'x.sidebar.fold-neither',
			'x.sidebar.fold-blank-memo-and-bio',
			'x.sidebar.fold-bio-only-hidden-bio',
		]) {
			const html = port(id)
			expect(html, id).not.toContain('<details')
			expect(html, id).not.toContain('certrev-r-more')
		}
	})

	it('escapes the bio and the memo in both copies, and a "</details>" in the text cannot close the fold early', () => {
		const html = port('x.sidebar.fold-memo-markup')
		expect(count(html, '</details>')).toBe(1)
		expect(count(html, '&lt;/details&gt;')).toBe(4)
		expect(html).not.toContain('<b>"x"</b>')
	})

	it('only the sidebar folds: the banner card and the memo card print their memo once, unfolded', () => {
		const html = port('x.banner.v9-no-hidden-photos')
		expect(html).not.toContain('certrev-r-more')
		expect(count(html, '<blockquote>')).toBe(1)
	})

	it('the stylesheet shows the pair wider than 640px and the fold at 640px and under', () => {
		expect(READER_CSS).toMatch(/\.certrev-reader \.certrev-r-more \{\s*display: none !important;/)
		const phone =
			/@media \(max-width: 640px\) \{\s*\.certrev-reader \.certrev-r-side-body > p,\s*\.certrev-reader \.certrev-r-side-body > blockquote \{\s*display: none !important;/
		expect(READER_CSS).toMatch(phone)
		const afterPhone = READER_CSS.slice(READER_CSS.search(phone))
		expect(afterPhone).toMatch(/\.certrev-reader \.certrev-r-more \{\s*display: block !important;/)
	})
})

describe('the legacy preset and rung keys', () => {
	// The portal still sends `preset` and `rung` to renderers already in the field. This face never reads them: a def
	// that carries them, with any value, paints the card it paints without them.
	it.each([
		'memo',
		'standard',
		'empty',
		'upper',
		'padded',
		'number',
		'null',
		'array',
	])('a legacy rung of kind %s is ignored: the memo card, the bio and the fold all print', (name) => {
		const banner = port(`x.banner.legacy-key-${name}`)
		expect(sections(banner)).toHaveLength(2)
		expect(banner).toContain('Expert memo')
		expect(DETAILS.exec(port(`x.sidebar.legacy-key-${name}`))?.[1]).toBe('Read the expert memo')
	})

	it('a def with a legacy preset and no rung paints the memo card', () => {
		expect(sections(port('x.banner.legacy-key-absent'))).toHaveLength(2)
		expect(DETAILS.exec(port('x.sidebar.legacy-key-absent'))?.[1]).toBe('Read the expert memo')
	})

	it.each([
		'banner',
		'sidebar',
		'floating',
	] as const)('%s: a def carrying the legacy keys paints the same bytes as one without them, whatever the rung says', (layout) => {
		const base = { v: 1, tokens: { accentColor: '#0A1B3F', cornerRadius: '12px' }, hidden: [], layout, face: 'reader' }
		const { content } = cell('x.banner.legacy-key-memo')
		const input = (def: unknown) => ({ def, layout, certId, content })
		const clean = renderReaderFace(input(base))
		expect(clean).not.toBe('')
		for (const rung of ['memo', 'minimal', 'named', 'credentialed', 'standard', 7, null]) {
			expect(renderReaderFace(input({ ...base, preset: 'minimal', rung })), String(rung)).toBe(clean)
		}
	})
})

describe('a toned face', () => {
	it.each([
		'surface',
		'ink',
		'both',
	])('%s: every section root carries certrev-r-toned and the toned variables', (name) => {
		for (const layout of ['banner', 'sidebar', 'floating']) {
			const html = port(`x.${layout}.tone-${name}`)
			const roots = html.match(/<section class="[^"]*"/g) ?? []
			expect(roots.length, `${layout} ${name}`).toBeGreaterThan(0)
			for (const root of roots) expect(root, `${layout} ${name}`).toContain(' certrev-r-toned')
			expect(html).toMatch(name === 'ink' ? /;--cr-ink:#222222"/ : /;--cr-sf:#F4EFE6/)
		}
		// the banner's second root is the memo card, which is not a `.certrev-badge`
		expect(port(`x.banner.tone-${name}`)).toContain('<section class="certrev-reader certrev-r-toned"')
	})

	it('a white surface alone is not toned: no class, no variables', () => {
		for (const name of ['white-surface', 'white-short', 'white-upper']) {
			for (const layout of ['banner', 'sidebar', 'floating']) {
				const html = port(`x.${layout}.tone-${name}`)
				expect(html, `${layout} ${name}`).not.toContain('certrev-r-toned')
				expect(html, `${layout} ${name}`).not.toContain('--cr-sf')
				expect(html, `${layout} ${name}`).not.toContain('--cr-ink')
			}
		}
	})

	it('a white surface beside an ink is toned, and writes both variables', () => {
		const html = port('x.sidebar.tone-white-with-ink')
		expect(html).toContain('certrev-badge certrev-r-toned')
		expect(html).toContain(';--cr-sf:#fff;--cr-ink:#222"')
	})

	it('a surface or ink that is not a colour is no token', () => {
		expect(port('x.sidebar.tone-bad-surface')).toContain(';--cr-ink:#abc"')
		expect(port('x.sidebar.tone-bad-surface')).not.toContain('--cr-sf')
		for (const name of ['hostile', 'number-ink', 'surface-four-digits', 'surface-newline']) {
			const html = port(`x.sidebar.tone-${name}`)
			expect(html, name).not.toContain('--cr-sf')
			expect(html, name).not.toContain('certrev-r-toned')
		}
	})
})

describe('a face with no design paints the card defaults', () => {
	it('a null def: navy #0a1b3f, 12px, the sans stack, and no def version', () => {
		const html = port('x.banner.no-def-null')
		expect(html).toContain(
			`style="--cr-ba:#0a1b3f;--cr-ba-fg:#ffffff;--cr-br:12px;--cr-bf:'DM Sans', ui-sans-serif, system-ui, sans-serif"`,
		)
		expect(html).not.toContain('data-certrev-def-version')
		expect(sections(html)).toHaveLength(2)
	})

	it.each(['banner', 'sidebar', 'floating'])('%s: a def that sets nothing paints the same defaults', (layout) => {
		for (const name of ['def-version-only', 'def-layout-only', 'def-empty-tokens']) {
			expect(port(`x.${layout}.${name}`), `${layout} ${name}`).toContain(
				'--cr-ba:#0a1b3f;--cr-ba-fg:#ffffff;--cr-br:12px;',
			)
		}
	})
})
