/**
 * The scope line's text nodes, as the demo's React server render makes them.
 *
 * The demo prints `<em>{cue}</em> · <!-- -->{sentence}`: an empty comment between its two adjacent text children, so
 * the `data-ftc-line` element's DOM holds the cue's `<em>`, the text " · ", a comment, and the sentence as a text node
 * of its own. The judge compares leaf text nodes, so a single " · Independent editorial review…" node read as a
 * different text. The comment is not text: the element still reads `{cue} · {sentence}` and the FTC sentence stays
 * byte-exact (curly U+2019). With no cue there is no separator and no comment. The goldens and the Liquid harness
 * hold the same bytes; this pins the shape by name.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CERT_SCOPE_LINE } from '../../components/render-def.js'
import type { CertContent } from '../../contract/kernel.js'
import { type ReaderLayout, renderReaderFace } from '../render.js'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const { certId } = JSON.parse(readFileSync(`${FIXTURES}golden-cells.json`, 'utf8')) as { certId: string }
const { cells } = JSON.parse(readFileSync(`${FIXTURES}oracle-extra.json`, 'utf8')) as {
	cells: { id: string; layout: ReaderLayout; def: unknown; content: CertContent; illustrative?: boolean }[]
}

const SENTENCE =
	'Independent editorial review of this article’s text and sources. Not a product endorsement, nor medical advice.'

function render(id: string): string {
	const found = cells.find((c) => c.id === id)
	if (!found) throw new Error(`no oracle cell ${id}`)
	return renderReaderFace({
		content: found.content,
		def: found.def,
		layout: found.layout,
		certId,
		illustrative: found.illustrative,
	})
}

/** The inner HTML of the one `data-ftc-line` element, which is the scope line. */
function scopeLine(html: string): string {
	const lines = [
		...html.matchAll(/<(div|span) class="certrev-r-scope" data-ftc-disclosure data-ftc-line>([\s\S]*?)<\/\1>/g),
	]
	expect(lines).toHaveLength(1)
	return lines[0]?.[2] as string
}

describe('the scope line after the cue separator', () => {
	it('keeps the sentence the portal’s exact string', () => {
		expect(CERT_SCOPE_LINE).toBe(SENTENCE)
	})

	it.each([
		['the compensated-expert cue, memo footer', 'x.banner.illustrative-cue-wins', '<em>Compensated expert</em>'],
		['the compensated-expert cue, sidebar', 'x.sidebar.illustrative-cue-wins', '<em>Compensated expert</em>'],
		['the illustrative label, memo footer', 'x.banner.illustrative-no-cue', '<em>Illustrative example</em>'],
		['the illustrative label, sidebar', 'x.sidebar.illustrative-no-cue', '<em>Illustrative example</em>'],
	])('%s: the cue, " · ", an empty comment, then the sentence as its own text', (_label, id, cue) => {
		const inner = scopeLine(render(id))
		expect(inner).toBe(`${cue} · <!-- -->${SENTENCE}`)
		// the DOM the judge reads: the em, the " · " text, the comment, the sentence text
		const afterEm = inner.slice(inner.indexOf('</em>') + '</em>'.length)
		expect(afterEm.split('<!-- -->')).toEqual([' · ', SENTENCE])
		// the comment is not text: with it removed the line still reads `{cue} · {sentence}`
		expect(inner.replaceAll('<!-- -->', '').replace(/<[^>]+>/g, '')).toBe(
			`${cue.replace(/<[^>]+>/g, '')} · ${SENTENCE}`,
		)
	})

	it.each([
		['memo footer', 'x.banner.pro-bono'],
		['sidebar', 'x.sidebar.pro-bono'],
	])('%s with no cue: one text node, no separator and no comment', (_label, id) => {
		expect(scopeLine(render(id))).toBe(SENTENCE)
	})

	it('puts the comment nowhere else in the scope element, and the marker on one element only', () => {
		const html = render('x.banner.illustrative-no-cue')
		expect(html.match(/data-ftc-line/g)).toHaveLength(1)
		expect(scopeLine(html).match(/<!--/g)).toHaveLength(1)
	})
})
