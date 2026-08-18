import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BUILDER_REGISTRATION } from '../builder/cert-review-card.js'
import { CertBadge } from '../components/CertBadge.js'
import { CertJsonLd } from '../components/CertJsonLd.js'
import { CertRevBacklink } from '../components/CertRevBacklink.js'
import { CertReview } from '../components/CertReview.js'
import { ExpertBio } from '../components/ExpertBio.js'
import { renderPreviewBlock } from '../components/preview-block.js'
import { type CertBlockFacts, renderCertBlock } from '../components/render-cert-block.js'
import { makeMockPayload } from '../contract/fixtures.js'
import { projectCertJsonLdString } from '../jsonld/project.js'
import { renderCertDialogInner, renderExpertDialogInner } from '../modal/cert-modal-view.js'
import { renderBadgeHtml } from '../webcomponent/render-badge-html.js'

/**
 * HOUSE VOICE, CHECKED AT THE LAYER THAT SHIPS.
 *
 * Section 9 of the design bundle bans the em dash in visible copy. Two guards already enforce that
 * on PROSE: `scripts/check-publish-hygiene.mjs` covers the READMEs and changelogs. Neither can see
 * the thing that actually reaches a reader, because rendered copy is assembled at runtime from
 * string literals scattered across five renderers, and a grep over source cannot tell a literal
 * that renders from a comment that does not.
 *
 * That gap shipped. `@certrev/cert-block@1.0.0` went to npm rendering `MD — Doctor of Medicine`
 * in the expert credential list, on the customer's own article, while every prose guard was green
 * and the release notes said the copy had been swept. Three more sat in the Builder editor's
 * helper text. They were found by rendering the package and grepping the OUTPUT, and this file is
 * that sweep turned into a gate so it does not depend on someone thinking to run it again.
 *
 * WHY NOT A SOURCE GREP
 *   A source grep is exactly what missed this. There are ~795 em dashes in this package's source
 *   comments, all legitimate and deliberately out of scope, so any source-level rule has to
 *   distinguish comment from literal and would drown in false positives or be tuned until it let
 *   the real ones through. Rendering has no such ambiguity: whatever comes out is what a reader
 *   sees. The cost is that a surface nobody renders here is a surface nobody checks, which is what
 *   the coverage floor below is for.
 *
 * ADDING A SURFACE
 *   Add it to `surfaces()`. If a new renderer is added and NOT listed here, the floor does not
 *   catch it — nothing can, short of reflection over the module graph. Adding the render is part
 *   of adding the renderer.
 */

const payload = makeMockPayload()

const facts: CertBlockFacts = {
	authorName: 'Sam Author',
	authorTitle: 'Editorial',
	reviewerName: 'Jane Doe',
	credential: 'MD',
	credentialVerifiedAt: '2025-12-01T00:00:00.000Z',
	certifiedAt: '2026-01-01T00:00:00.000Z',
	memo: 'A memo.',
	bio: 'A bio.',
	profileUrl: 'https://certrev.com/e/1',
	certificateUrl: 'https://certrev.com/v/1',
	compensationCue: 'Compensated expert',
}

const modalContent = {
	expert: {
		displayName: 'Dr. Jane Doe',
		credentials: [
			{ abbreviation: 'MD', fullName: 'Doctor of Medicine' },
			{ abbreviation: 'FAAD', fullName: 'Fellow of the American Academy of Dermatology' },
		],
		profileUrl: 'https://certrev.com/e/1',
		photoUrl: 'https://cdn.example.com/p.jpg',
		bio: 'A bio.',
		background: 'A background.',
		compensationCue: 'Compensated expert',
	},
	certifiedAt: '2026-01-01T00:00:00.000Z',
	verifyUrl: 'https://certrev.com/v/1',
	articleTitle: 'An Article',
	displayCertId: 'CR-2026-0001',
}

interface Surface {
	readonly name: string
	readonly html: string
}

/**
 * Every surface this package can put in front of a human: the three string renderers, the five
 * React components, the JSON-LD, the modal dialogs, and the Builder registration (whose
 * `friendlyName` / `helperText` / `description` fields are copy an editor reads).
 *
 * Deliberately includes the shapes where copy differs, not just the happy path: the pro-bono
 * reviewer (`compensationCue: null`), the empty memo and bio, and every `mode` × `part`.
 */
function surfaces(): readonly Surface[] {
	const out: Surface[] = []
	const add = (name: string, html: string | null | undefined) => out.push({ name, html: String(html ?? '') })

	for (const mode of ['banner', 'sidebar', 'inline', 'card', undefined] as const)
		for (const part of ['full', 'header', 'memo', undefined] as const)
			add(`renderCertBlock ${mode ?? 'undefined'}/${part ?? 'undefined'}`, renderCertBlock({ facts, mode, part }))

	add('renderCertBlock pro-bono', renderCertBlock({ facts: { ...facts, compensationCue: null } }))
	add('renderCertBlock no memo/bio', renderCertBlock({ facts: { ...facts, memo: '', bio: '' } }))

	for (const badgeStyle of ['full', 'compact', undefined] as const)
		add(`renderBadgeHtml ${badgeStyle ?? 'undefined'}`, renderBadgeHtml(payload, { badgeStyle }))

	add('renderPreviewBlock default', renderPreviewBlock({ facts }, { expiresAt: '2027-01-01T00:00:00.000Z' }))
	add(
		'renderPreviewBlock sidebar',
		renderPreviewBlock({ facts, mode: 'sidebar' }, { expiresAt: '2027-01-01T00:00:00.000Z' }),
	)

	add('projectCertJsonLdString', projectCertJsonLdString(payload, { pageUrl: 'https://brand.example.com/a' }))

	add('renderCertDialogInner', renderCertDialogInner(modalContent))
	add('renderExpertDialogInner', renderExpertDialogInner(modalContent))

	add('<CertBadge>', renderToStaticMarkup(h(CertBadge, { payload })))
	add('<CertBadge compact>', renderToStaticMarkup(h(CertBadge, { payload, badgeStyle: 'compact' })))
	add('<ExpertBio>', renderToStaticMarkup(h(ExpertBio, { payload })))
	add('<CertRevBacklink>', renderToStaticMarkup(h(CertRevBacklink, { payload })))
	add('<CertJsonLd>', renderToStaticMarkup(h(CertJsonLd, { payload, pageUrl: 'https://brand.example.com/a' })))
	add(
		'<CertReview>',
		renderToStaticMarkup(h(CertReview, { verdict: { decision: 'render', payload }, pageUrl: 'https://b.example/a' })),
	)

	// Editor-facing copy: friendlyName, helperText and description all render in Builder's UI.
	add('BUILDER_REGISTRATION', JSON.stringify(BUILDER_REGISTRATION))

	return out
}

const RENDERED = surfaces()

/** `…30 chars… — …30 chars…`, so a failure names the sentence and not just the file. */
function context(html: string, mark: string): string[] {
	const hits: string[] = []
	for (let i = html.indexOf(mark); i !== -1; i = html.indexOf(mark, i + 1)) {
		hits.push(`…${html.slice(Math.max(0, i - 30), i + 31)}…`)
	}
	return hits
}

describe('rendered output carries no em dash', () => {
	it('actually rendered something on every surface', () => {
		// The premise. An empty render is indistinguishable from a clean one, and a probe that
		// silently produced nothing is how the first version of this sweep reported a vacuous zero.
		expect(RENDERED.length).toBeGreaterThanOrEqual(30)
		const empty = RENDERED.filter((s) => s.html.trim().length < 20).map((s) => s.name)
		expect(empty, 'these surfaces rendered (almost) nothing, so checking them proves nothing').toEqual([])
		const total = RENDERED.reduce((n, s) => n + s.html.length, 0)
		expect(
			total,
			'total rendered bytes collapsed; the fixtures probably stopped matching the renderers',
		).toBeGreaterThan(50_000)
	})

	it.each(RENDERED.map((s) => s.name))('%s', (name) => {
		const surface = RENDERED.find((s) => s.name === name)
		if (!surface) throw new Error(`surface ${name} vanished`)
		expect(
			context(surface.html, '—'),
			`${name} renders an em dash. House style bans it in visible copy: use the mark the sentence ` +
				'wants — a colon for an appositive, a semicolon between independent clauses, a full stop, ' +
				'or a middle dot for labelled data. Fix the string literal in the renderer, not this test.',
		).toEqual([])
	})

	it('uses the en dash only between digits', () => {
		for (const { name, html } of RENDERED) {
			const misused = context(html, '–').filter((c) => !/\d–\d/.test(c))
			expect(misused, `${name} renders an en dash outside a numeric range, which is an em dash in disguise`).toEqual([])
		}
	})
})
