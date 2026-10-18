/**
 * Compensated disclosure on the reader face (1.2.0).
 *
 * The FTC cue "Compensated expert" is a locked field: it comes from `content.expert.compensationCue`, nothing a def can
 * hide (`HIDEABLE_FIELDS` is `reviewerPhoto` and `memo` only), and nothing the seed strip touches (`ssr-seed.test.tsx`
 * and `delivery-card-hidden-fields.test.tsx` pin the seed side). This file pins the face side: the cue is painted in
 * every layout that has a place for it, with every hideable field hidden, and is absent when the payload carries none.
 *
 * The floating pill is the one layout whose own markup carries no cue ("Expert reviewed: Profile · Certificate"; the
 * portal's `floating.*.html` goldens are the same bytes). A pill's reader gets the cue from the modal it opens, which
 * paints it from the same `compensationCue` (`modal/cert-modal-view.ts`, pinned in `modal/cert-modal-view.test.ts`).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COMPENSATED_EXPERT_CUE, HIDEABLE_FIELDS } from '../../components/render-def.js'
import type { CertContent } from '../../contract/kernel.js'
import { type ReaderLayout, type ReaderPart, renderReaderFace } from '../render.js'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const { certId, cells } = JSON.parse(readFileSync(`${FIXTURES}golden-cells.json`, 'utf8')) as {
	certId: string
	cells: { id: string; def: unknown; content: CertContent }[]
}
const FULL = cells.find((cell) => cell.id === 'banner.navy-full')
if (!FULL) throw new Error('no banner.navy-full golden cell')

function contentWithCue(cue: unknown): CertContent {
	const base = FULL?.content as unknown as { expert: Record<string, unknown> }
	const expert = { ...base.expert }
	if (cue === undefined) delete expert.compensationCue
	else expert.compensationCue = cue
	return { ...base, expert } as unknown as CertContent
}

const paint = (content: CertContent, layout: ReaderLayout, hidden: readonly string[], part?: ReaderPart): string =>
	renderReaderFace({ content, def: { ...(FULL?.def as object), hidden }, layout, part, certId })

const EVERY_HIDEABLE_FIELD: readonly string[] = [...HIDEABLE_FIELDS]

describe('"Compensated expert" on the reader face', () => {
	it('the locked cue text is the one the card paints', () => {
		expect(COMPENSATED_EXPERT_CUE).toBe('Compensated expert')
	})

	it.each([
		['the banner (header and memo)', 'banner', undefined],
		['the banner header: the byline card foot', 'banner', 'header'],
		['the banner memo: the scope line', 'banner', 'memo'],
		['the sidebar: the scope line', 'sidebar', undefined],
	] as const)('paints the cue on %s', (_name, layout, part) => {
		expect(paint(contentWithCue(COMPENSATED_EXPERT_CUE), layout, [], part)).toContain(COMPENSATED_EXPERT_CUE)
	})

	it.each([
		['the banner', 'banner'],
		['the sidebar', 'sidebar'],
	] as const)('%s keeps the cue with every hideable field hidden: no def can hide it', (_name, layout) => {
		expect(EVERY_HIDEABLE_FIELD).toEqual(['reviewerPhoto', 'memo'])
		const html = paint(contentWithCue(COMPENSATED_EXPERT_CUE), layout, EVERY_HIDEABLE_FIELD)
		expect(html).toContain(COMPENSATED_EXPERT_CUE)
		// the line is the FTC line: a `data-ftc-line` element or the byline foot, never behind a hidden field
		expect(html).toMatch(/data-ftc-line|certrev-r-foot/)
	})

	it('a def naming a field that is not hideable (the cue itself) still cannot hide it', () => {
		for (const layout of ['banner', 'sidebar'] as const) {
			const html = paint(contentWithCue(COMPENSATED_EXPERT_CUE), layout, ['compensationCue', 'reviewerPhoto', 'memo'])
			expect(html).toContain(COMPENSATED_EXPERT_CUE)
		}
	})

	it('paints no cue when the payload carries none', () => {
		for (const layout of ['banner', 'sidebar'] as const) {
			expect(paint(contentWithCue(undefined), layout, [])).not.toContain(COMPENSATED_EXPERT_CUE)
			expect(paint(contentWithCue(''), layout, [])).not.toContain(COMPENSATED_EXPERT_CUE)
		}
	})

	it('the floating pill carries no cue in its own markup: it reaches the reader in the modal it opens', () => {
		const html = paint(contentWithCue(COMPENSATED_EXPERT_CUE), 'floating', [])
		expect(html).toContain('certrev-r-pill')
		expect(html).not.toContain(COMPENSATED_EXPERT_CUE)
	})
})
