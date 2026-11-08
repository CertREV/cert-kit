/**
 * 2.1.0: the review scope (`content.expert.reviewScope`, signed by the portal) picks which LOCKED scope line every face
 * prints (Owen, Console decision af5b0db5: the review line says what the expert actually reviewed).
 *
 * The three cases, on every render path this package prints the line on (`renderCertBlock` on each face, the Builder
 * envelope face, the reader face, both dialogs of the modal, `<CertBadge>`, the web component's HTML):
 *  - ABSENT: exactly what 2.0.2 printed. The existing goldens and snapshots, unchanged in 2.1.0, pin those bytes; here
 *    each path is also held to carry the full line and never the text-only one.
 *  - `'text_and_sources'`: byte-identical to absent.
 *  - `'text'`: byte-identical to absent with the full sentence replaced by `CERT_SCOPE_LINE_TEXT_ONLY`, once per place
 *    the full sentence was printed, and nothing else changed.
 * Any other value (a hostile type, a case variant, a scope this version has never heard of) prints the full line.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { envelopeCardHtml, envelopeCardInput } from '../builder/envelope-face.js'
import { CertBadge } from '../components/CertBadge.js'
import { type CertBlockFacts, type RenderCertBlockInput, renderCertBlock } from '../components/render-cert-block.js'
import { CERT_SCOPE_LINE, CERT_SCOPE_LINE_TEXT_ONLY, certScopeLineFor } from '../components/render-def.js'
import { makeMockPayload } from '../contract/fixtures.js'
import type { CertContent, CertPayload } from '../contract/kernel.js'
import { renderCertDialogInner, renderExpertDialogInner } from '../modal/cert-modal-view.js'
import { CERT_SCOPE_LINE_TEXT_ONLY as MODAL_TEXT_ONLY, scopeLineForReview } from '../modal/display-strings.js'
import { FTC_DISCLOSURE_LINE_TEXT_ONLY } from '../modal/ftc-disclosure.js'
import { renderReaderFace } from '../reader/render.js'
import { renderBadgeHtml } from '../webcomponent/render-badge-html.js'

/** The portal's `FTC_DISCLOSURE_LINE_TEXT_ONLY` (`src/lib/embed/ftc-disclosure.ts`), copied here byte for byte. */
const PORTAL_TEXT_ONLY =
	'Independent editorial review of this article’s text. Not a product endorsement, nor medical advice.'

const count = (html: string, needle: string): number => html.split(needle).length - 1

/** The payload with `expert.reviewScope` set (or left out for `undefined`), and an expert compensation cue. */
function payloadWith(reviewScope: unknown): CertPayload {
	const base = makeMockPayload()
	const expert = { ...base.content.expert, compensationCue: 'Compensated expert' } as Record<string, unknown>
	if (reviewScope !== undefined) expert.reviewScope = reviewScope
	return { ...base, content: { ...base.content, expert } as unknown as CertContent }
}

/** A memo-less payload, so the banner's byline card (not a memo card) carries the line. */
function memoLess(reviewScope: unknown): CertPayload {
	const p = payloadWith(reviewScope)
	return { ...p, content: { ...p.content, memo: '' } }
}

/**
 * Every path that prints the line, as a function of a payload: name -> html. Each must print the full line at least once
 * for an absent scope (or the path would prove nothing).
 */
const PATHS: Record<string, (p: CertPayload) => string> = {
	'renderCertBlock banner (envelope input)': (p) =>
		renderCertBlock(envelopeCardInput(p.content, null, { mode: 'banner' }) as RenderCertBlockInput),
	'renderCertBlock banner memo part': (p) =>
		renderCertBlock(envelopeCardInput(p.content, null, { mode: 'banner', part: 'memo' }) as RenderCertBlockInput),
	'renderCertBlock sidebar': (p) =>
		renderCertBlock(envelopeCardInput(p.content, null, { mode: 'sidebar' }) as RenderCertBlockInput),
	'renderCertBlock custom face': (p) => {
		const input = envelopeCardInput(p.content, null, { mode: 'banner' }) as RenderCertBlockInput
		return renderCertBlock({
			...input,
			mode: 'custom',
			face: { placedFields: ['bylineCredentialed', 'memo', 'scopeLine', 'compensationCue'] },
		})
	},
	'Builder envelope face (no def)': (p) => envelopeCardHtml(p.content, null, { mode: 'sidebar' }),
	'reader banner (byline card, no memo)': (p) =>
		renderReaderFace({ content: memoLess(p.content.expert.reviewScope as unknown).content, layout: 'banner' }),
	'reader banner memo card': (p) => renderReaderFace({ content: p.content, layout: 'banner', part: 'memo' }),
	'reader sidebar': (p) => renderReaderFace({ content: p.content, layout: 'sidebar' }),
	'Builder envelope face (reader def)': (p) =>
		envelopeCardHtml(p.content, { v: 1, face: 'reader', hidden: [] } as never, { mode: 'sidebar' }),
	'certificate dialog': (p) => renderCertDialogInner(p.content as never) ?? '',
	'expert dialog': (p) => renderExpertDialogInner(p.content as never) ?? '',
	'<CertBadge>': (p) => renderToStaticMarkup(<CertBadge payload={p} />),
	'web component HTML': (p) => renderBadgeHtml(p),
}

describe('the text-only scope line (2.1.0)', () => {
	it('is the portal’s FTC_DISCLOSURE_LINE_TEXT_ONLY byte for byte, in the SSR module and the modal bundle’s module', () => {
		expect(CERT_SCOPE_LINE_TEXT_ONLY).toBe(PORTAL_TEXT_ONLY)
		expect(FTC_DISCLOSURE_LINE_TEXT_ONLY).toBe(PORTAL_TEXT_ONLY)
		expect(MODAL_TEXT_ONLY).toBe(PORTAL_TEXT_ONLY)
		expect(CERT_SCOPE_LINE_TEXT_ONLY).toContain('’')
		expect(CERT_SCOPE_LINE_TEXT_ONLY).not.toContain("'")
		// The full line is untouched.
		expect(CERT_SCOPE_LINE).toBe(
			'Independent editorial review of this article’s text and sources. Not a product endorsement, nor medical advice.',
		)
	})

	it('only an exact "text" picks it, in both copies of the rule', () => {
		for (const rule of [certScopeLineFor, scopeLineForReview]) {
			expect(rule('text')).toBe(PORTAL_TEXT_ONLY)
			for (const other of [undefined, null, 'text_and_sources', 'TEXT', ' text', 'sources', 1, {}, ['text'], true]) {
				expect(rule(other)).toBe(CERT_SCOPE_LINE)
			}
		}
	})
})

describe.each(Object.entries(PATHS))('%s', (_name, render) => {
	const absent = render(payloadWith(undefined))

	it('absent: prints the full line (as 2.0.2), never the text-only one', () => {
		expect(count(absent, CERT_SCOPE_LINE)).toBeGreaterThan(0)
		expect(absent).not.toContain(PORTAL_TEXT_ONLY)
	})

	it("'text_and_sources': byte-identical to absent", () => {
		expect(render(payloadWith('text_and_sources'))).toBe(absent)
	})

	it("'text': the text-only line in place of each full line, and nothing else changes", () => {
		const text = render(payloadWith('text'))
		expect(text).not.toContain(CERT_SCOPE_LINE)
		expect(count(text, PORTAL_TEXT_ONLY)).toBe(count(absent, CERT_SCOPE_LINE))
		expect(text).toBe(absent.split(CERT_SCOPE_LINE).join(PORTAL_TEXT_ONLY))
	})

	it('an unknown or hostile value prints the full line, byte-identical to absent', () => {
		for (const other of ['TEXT', 'sources', 7, { scope: 'text' }, null]) {
			expect(render(payloadWith(other))).toBe(absent)
		}
	})
})

describe('envelopeCardInput carries the scope only when it is one this version knows', () => {
	const factsOf = (p: CertPayload): CertBlockFacts => (envelopeCardInput(p.content, null) as RenderCertBlockInput).facts

	it('absent stays absent: the input is the 2.0.2 input (no reviewScope key)', () => {
		expect('reviewScope' in factsOf(payloadWith(undefined))).toBe(false)
	})

	it("'text' and 'text_and_sources' are carried as signed", () => {
		expect(factsOf(payloadWith('text')).reviewScope).toBe('text')
		expect(factsOf(payloadWith('text_and_sources')).reviewScope).toBe('text_and_sources')
	})

	it('anything else is dropped', () => {
		for (const other of ['TEXT', 3, null, {}]) expect('reviewScope' in factsOf(payloadWith(other))).toBe(false)
	})

	it('a direct renderCertBlock caller passing the fact gets the same rule', () => {
		const input = envelopeCardInput(payloadWith(undefined).content, null, { mode: 'sidebar' }) as RenderCertBlockInput
		const full = renderCertBlock(input)
		expect(renderCertBlock({ ...input, facts: { ...input.facts, reviewScope: 'text' } })).toBe(
			full.split(CERT_SCOPE_LINE).join(PORTAL_TEXT_ONLY),
		)
		expect(renderCertBlock({ ...input, facts: { ...input.facts, reviewScope: 'text_and_sources' } })).toBe(full)
	})
})
