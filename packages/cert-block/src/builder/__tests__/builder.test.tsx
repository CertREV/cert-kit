/**
 * SSR-render tests for the Builder.io adapter (`@certrev/cert-block/builder`), the panel-validated
 * "ambient-URL anchor" model — exercised through `renderToStaticMarkup` (the edge SSR path).
 *
 * Contract proved here:
 *   • the anchor renders the CURRENT page's verified badge — and badge ONLY (JSON-LD is emitted
 *     server-side, decoupled from the visual slot);
 *   • EVERY non-render path (suppress verdict, no credential for the page) renders nothing in
 *     production (fail-closed);
 *   • in the Builder editor (`isEditing`) with no live credential, a truthful placeholder shows —
 *     never a fake badge, and never any JSON-LD;
 *   • the registration is ZERO-input: the editor cannot choose or forge which credential renders.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { makeMockPayload } from '../../contract/fixtures.js'
import type { CertVerdict } from '../../contract/kernel.js'
import { CertRevAnchor, CertRevProvider, type CurrentCredential, certRevAnchorComponent } from '../index.js'

const renderVerdict: CertVerdict = { decision: 'render', payload: makeMockPayload() }
const suppressVerdict: CertVerdict = { decision: 'suppress', reason: 'revoked' }

function render(current: CurrentCredential | null, isEditing = false): string {
	return renderToStaticMarkup(
		<CertRevProvider current={current} isEditing={isEditing}>
			<CertRevAnchor />
		</CertRevProvider>,
	)
}

describe('Builder adapter — registration (zero-input anchor)', () => {
	it('registers "CertREV Review" with NO inputs (editor places it; system resolves the credential)', () => {
		expect(certRevAnchorComponent.name).toBe('CertREV Review')
		expect(certRevAnchorComponent.component).toBe(CertRevAnchor)
		expect(certRevAnchorComponent.inputs).toEqual([])
	})
})

describe('Builder adapter — CertRevAnchor render', () => {
	it('renders the current page’s verified badge — and ONLY the badge (no JSON-LD; that is server-side)', () => {
		const html = render({ verdict: renderVerdict, pageUrl: 'https://brand.example.com/a' })
		expect(html).toContain('certrev-badge')
		expect(html).toContain('Dr. Jane Doe')
		expect(html).not.toContain('application/ld+json') // JSON-LD decoupled to the article template
	})

	it('FAIL-CLOSED: a suppress verdict renders nothing', () => {
		expect(render({ verdict: suppressVerdict })).toBe('')
	})

	it('FAIL-CLOSED: no credential for this page renders nothing in production', () => {
		expect(render(null, false)).toBe('')
	})

	it('EDITOR: no live credential + isEditing renders a truthful placeholder (no badge, no JSON-LD)', () => {
		const html = render(null, true)
		expect(html).toContain('data-certrev-editor-placeholder')
		expect(html).toContain('resolves at publish')
		expect(html).not.toContain('certrev-badge')
		expect(html).not.toContain('application/ld+json')
	})

	it('EDITOR: a live verified credential renders the REAL badge even in editing mode (true draft-verify)', () => {
		const html = render({ verdict: renderVerdict }, true)
		expect(html).toContain('certrev-badge')
		expect(html).not.toContain('data-certrev-editor-placeholder')
	})
})

// ── The PUSH kit (CertReviewCard) + contract lock ──
import {
	BUILDER_CERT_CHROME_KEYS,
	BUILDER_REGISTRATION,
	type BuilderCertChromeData,
	CERT_COMPONENT_NAME,
	CertReviewCard,
	certRevCertComponent,
	WIRE_INPUTS,
} from '../index.js'

describe('Builder kit contract lock (inputs ⇄ wire-type parity)', () => {
	it('WIRE_INPUTS names are EXACTLY the wire-type keys, in order (no silent drift)', () => {
		expect(WIRE_INPUTS.map((i) => i.name)).toEqual([...BUILDER_CERT_CHROME_KEYS])
	})
	it('BUILDER_REGISTRATION carries every wire input + the placement inputs, named canonically', () => {
		expect(BUILDER_REGISTRATION.name).toBe(CERT_COMPONENT_NAME)
		const inputNames = new Set(BUILDER_REGISTRATION.inputs.map((i) => i.name))
		for (const k of BUILDER_CERT_CHROME_KEYS) expect(inputNames.has(k)).toBe(true)
		expect(inputNames.has('mode')).toBe(true) // a placement input, NOT a wire-type key
	})
})

describe('certRevCertComponent (the drop-in gen2 registration)', () => {
	it('carries the identical W3-locked registration as BUILDER_REGISTRATION (name/component/inputs)', () => {
		expect(certRevCertComponent.name).toBe(CERT_COMPONENT_NAME)
		expect(certRevCertComponent.component).toBe(CertReviewCard)
		expect(certRevCertComponent.inputs).toEqual([...BUILDER_REGISTRATION.inputs])
	})
	it('inputs is a FRESH mutable array — never the canonical readonly instance', () => {
		expect(certRevCertComponent.inputs).not.toBe(BUILDER_REGISTRATION.inputs)
		expect(Object.isFrozen(certRevCertComponent.inputs)).toBe(false)
	})
	it('wire inputs sit under the editor "Advanced" reveal; placement inputs stay front-and-center', () => {
		const byName = new Map(certRevCertComponent.inputs.map((i) => [i.name, i]))
		for (const k of BUILDER_CERT_CHROME_KEYS) expect(byName.get(k)?.advanced).toBe(true)
		expect(byName.get('mode')?.advanced).toBeUndefined()
		expect(byName.get('part')?.advanced).toBeUndefined()
	})
})

describe('CertReviewCard render + the fused-credential R1 gate', () => {
	const base: Partial<BuilderCertChromeData> = {
		reviewerName: 'Dr. Jane Doe',
		verifyUrl: 'https://certrev.com/verify/abc',
		bylinePlain: 'Reviewed on 2026-03-08 by Dr. Jane Doe.',
		certifiedAt: '2026-03-08',
		scopeLine: 'Independent editorial review.',
		display: { showExpertPhoto: true, showCredentials: true },
		renderDef: null,
		stringsVersion: '2026-07',
	}
	it('renders a certified face (the reviewer name)', () => {
		expect(renderToStaticMarkup(<CertReviewCard {...base} />)).toContain('Dr. Jane Doe')
	})
	it('name-only when credentialVerification is null — a credential never leaks without its date', () => {
		expect(renderToStaticMarkup(<CertReviewCard {...base} credentialVerification={null} />)).not.toContain('FAAAAI')
	})
	it('renders the credential ONLY as the fused (credential + verifiedAt) pair', () => {
		const html = renderToStaticMarkup(
			<CertReviewCard {...base} credentialVerification={{ credential: 'FAAAAI', verifiedAt: '2026-03-01' }} />,
		)
		expect(html).toContain('FAAAAI')
	})
	it('showCredentials:false collapses to name-only even with the pair present', () => {
		const html = renderToStaticMarkup(
			<CertReviewCard
				{...base}
				display={{ showExpertPhoto: true, showCredentials: false }}
				credentialVerification={{ credential: 'FAAAAI', verifiedAt: '2026-03-01' }}
			/>,
		)
		expect(html).not.toContain('FAAAAI')
	})
	it('returns nothing pre-cert (no reviewerName / verifyUrl)', () => {
		expect(renderToStaticMarkup(<CertReviewCard />)).toBe('')
	})
	it('passes `part` through to renderCertBlock (header excludes the memo, memo excludes the header)', () => {
		const withMemo = { ...base, memo: 'Checked the claims against current guidance; accurate.' }
		const header = renderToStaticMarkup(<CertReviewCard {...withMemo} mode="banner" part="header" />)
		const memo = renderToStaticMarkup(<CertReviewCard {...withMemo} mode="banner" part="memo" />)
		expect(header).toContain('Expert reviewed')
		expect(header).not.toContain('Checked the claims against current guidance; accurate.')
		expect(memo).toContain('Checked the claims against current guidance; accurate.')
		expect(memo).not.toContain('Expert reviewed')
	})
})

// ── Hardening wave: one placement default, untyped-CMS input, locked compliance copy ──
import { type CertBlockFacts, renderCertBlock } from '../../components/render-cert-block.js'
import { COMPENSATED_EXPERT_CUE } from '../../components/render-def.js'
import { type CertReviewCardProps, PLACEMENT_INPUTS } from '../index.js'

/** The same delivery as `cardBase`, in the shape a DIRECT `renderCertBlock` caller passes. */
const directFacts: CertBlockFacts = {
	authorName: 'Editorial',
	authorTitle: null,
	reviewerName: 'Dr. Jane Doe',
	credential: '',
	credentialVerifiedAt: '',
	certifiedAt: '2026-03-08',
	memo: '',
	bio: '',
	profileUrl: '',
	certificateUrl: 'https://certrev.com/verify/abc',
	compensationCue: 'Compensated expert',
}

/** A minimally-certified delivery — every test below varies exactly one field off this. */
const cardBase: Partial<BuilderCertChromeData> = {
	reviewerName: 'Dr. Jane Doe',
	verifyUrl: 'https://certrev.com/verify/abc',
	bylinePlain: 'Reviewed on 2026-03-08 by Dr. Jane Doe.',
	certifiedAt: '2026-03-08',
	scopeLine: 'Independent editorial review.',
	compensationCue: 'Compensated expert',
	display: { showExpertPhoto: true, showCredentials: true },
	renderDef: null,
	stringsVersion: '2026-07',
}

/**
 * THE COMPATIBILITY BRIDGE FOR PRE-EXISTING ENTRIES. Delete this block only together with the
 * `?? 'banner'` in `CertReviewCard`, once the exporter emits an explicit `mode` AND existing
 * entries have been backfilled. Until both are true, this is a live customer contract.
 *
 * WHAT IT PINS, AND WHY IT IS A DIFFERENT KIND OF TEST
 *   Not the presence of text on a rendered surface, and not a string in shipped source: a
 *   BEHAVIOUR UNDER A MISSING INPUT. `mode` is a PLACEMENT input, never one of the 19 wire keys,
 *   and the exporter emits only the wire projection (`options: { ...certData }`), so every entry
 *   exported to date has no `mode` key at all. What such an entry paints is therefore decided
 *   entirely by a fallback, and a fallback is invisible to any check that looks at what IS there.
 *
 * WHAT IT COST TO LEARN THIS
 *   1.0.0 removed the card's `?? 'banner'` so the renderer would own the single default. Every
 *   gate stayed green, because the sidebar face renders perfectly — it is simply not the face
 *   those entries had rendered since they were created. Consumers install unpinned, so the
 *   repaint reached live pages with no entry edit and no version bump on their side.
 *
 * The sidebar default is NOT reverted: it is still what a direct `renderCertBlock` caller gets
 * and still the registered `defaultValue`, asserted immediately below, so every block created in
 * the editor from now on carries an explicit `mode` and never reaches the fallback at all.
 */
describe('the pre-exporter-`mode` bridge — an entry with no `mode` still paints BANNER', () => {
	it('renders the banner face when `mode` is absent entirely (the exported-entry shape)', () => {
		const html = renderToStaticMarkup(<CertReviewCard {...cardBase} />)
		expect(html).toContain('data-certrev-mode="banner"')
		expect(html).toContain('certrev-cert--banner')
		expect(html).not.toContain('certrev-cert--sidebar')
	})
	it('renders the banner face when `mode` is present-but-nullish, which is the same absence', () => {
		// A CMS round-trip can turn a missing key into an explicit null; both are "the editor
		// chose nothing", so both must land on the same face.
		for (const mode of [undefined, null] as const) {
			const html = renderToStaticMarkup(<CertReviewCard {...cardBase} mode={mode} />)
			expect(html, `mode={${String(mode)}} must be treated as absent`).toContain('data-certrev-mode="banner"')
		}
	})
	it('the bridge is a fallback, never an override — an explicit mode still wins', () => {
		for (const mode of ['sidebar', 'floating'] as const) {
			const html = renderToStaticMarkup(<CertReviewCard {...cardBase} mode={mode} />)
			expect(html).toContain(`data-certrev-mode="${mode}"`)
		}
	})
	it('the renderer itself is untouched: a DIRECT caller omitting mode still gets sidebar', () => {
		// The bridge lives in the Builder card only. This is what proves the 1.0.0 decision stands
		// and that the fix was scoped to the path that actually regressed.
		expect(renderCertBlock({ facts: directFacts })).toContain('data-certrev-mode="sidebar"')
	})
})

describe('S2 — one placement default, owned by renderCertBlock alone', () => {
	it('the registered `mode` input declares the sidebar default + the three faces as a dropdown', () => {
		const mode = PLACEMENT_INPUTS.find((i) => i.name === 'mode')
		expect(mode?.defaultValue).toBe('sidebar')
		expect(mode?.enum).toEqual([
			{ label: 'Sidebar', value: 'sidebar' },
			{ label: 'Banner', value: 'banner' },
			{ label: 'Floating', value: 'floating' },
		])
		expect(mode?.helperText).toBe('sidebar (default) · banner · floating')
	})
	it('the registered `part` input declares the full default + the three cards as a dropdown', () => {
		const part = PLACEMENT_INPUTS.find((i) => i.name === 'part')
		expect(part?.defaultValue).toBe('full')
		expect(part?.enum).toEqual([
			{ label: 'Full (header + memo)', value: 'full' },
			{ label: 'Header only', value: 'header' },
			{ label: 'Memo only', value: 'memo' },
		])
	})
})

describe('C4 — untyped CMS JSON can never take SSR down (the editor is not type-checked)', () => {
	// Everything below is what a visual editor can actually put in the option — the props type
	// is ERASED at runtime, so each of these reaches the renderer as-is.
	const malformed: ReadonlyArray<readonly [string, unknown]> = [
		['a credential with no verification date', { credential: 'FAAAAI' }],
		['a verification date with no credential', { verifiedAt: '2026-03-01' }],
		['an empty object', {}],
		['a bare string', 'FAAAAI'],
		['an array', ['FAAAAI']],
		['a number where verifiedAt belongs', { credential: 'FAAAAI', verifiedAt: 20260301 }],
		['an object where credential belongs', { credential: { abbr: 'FAAAAI' }, verifiedAt: '2026-03-01' }],
	]
	for (const [label, value] of malformed) {
		it(`credentialVerification as ${label} degrades to the name-only face instead of throwing`, () => {
			const props = { ...cardBase, credentialVerification: value } as CertReviewCardProps
			let html = ''
			expect(() => {
				html = renderToStaticMarkup(<CertReviewCard {...props} />)
			}).not.toThrow()
			expect(html).toContain('Dr. Jane Doe')
			expect(html).not.toContain('FAAAAI')
		})
	}

	it('a wrong-TYPE value in every other forwarded option renders instead of throwing', () => {
		const junk = {
			...cardBase,
			authorName: 42,
			authorTitle: {},
			memo: 42,
			bio: ['a bio'],
			certifiedAt: {},
			reviewerProfileUrl: 5,
			stringsVersion: { v: 1 },
			display: 'yes',
			renderDef: 'nope',
		} as unknown as CertReviewCardProps
		expect(() => renderToStaticMarkup(<CertReviewCard {...junk} />)).not.toThrow()
	})

	it('a wrong-TYPE reviewerName / verifyUrl fails CLOSED (no chrome) rather than throwing', () => {
		const junk = { ...cardBase, reviewerName: 42, verifyUrl: {} } as unknown as CertReviewCardProps
		expect(renderToStaticMarkup(<CertReviewCard {...junk} />)).toBe('')
	})
})

describe('D7 — the compliance disclosures are constants, not editor copy', () => {
	it('a pro-bono delivery (compensationCue: null) renders NO compensation claim', () => {
		const html = renderToStaticMarkup(<CertReviewCard {...cardBase} compensationCue={null} />)
		expect(html).not.toContain(COMPENSATED_EXPERT_CUE)
	})
	it('a REWRITTEN cue is ignored — the locked constant is what renders', () => {
		const html = renderToStaticMarkup(<CertReviewCard {...cardBase} compensationCue="Independent expert" />)
		expect(html).toContain(COMPENSATED_EXPERT_CUE)
		expect(html).not.toContain('Independent expert')
	})
	it('a REWRITTEN scope line never reaches the face — the card forwards no scopeLine at all', () => {
		const html = renderToStaticMarkup(
			<CertReviewCard {...cardBase} scopeLine="We checked every claim and guarantee it." />,
		)
		expect(html).not.toContain('We checked every claim and guarantee it.')
		expect(html).toContain('Not a product endorsement')
	})
	it('both stay REGISTERED inputs — the wire type and its parity lock are unchanged — but say so', () => {
		const byName = new Map(certRevCertComponent.inputs.map((i) => [i.name, i]))
		for (const k of ['compensationCue', 'scopeLine'] as const) {
			expect(byName.has(k)).toBe(true)
			expect(byName.get(k)?.helperText).toMatch(/system-populated/i)
		}
	})
})
