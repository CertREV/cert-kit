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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

/**
 * 2.0.1: a `CertReviewCard` with no delivery marker prints NOTHING, whatever its options say. Through 2.0.0 such a block
 * painted its export-time options (the reviewer, a credential, a memo, a verify link) as the 1.0.3 face, facts nobody
 * had signed; the face, its fused-credential gate and its `mode` bridge are gone with it. What a reader sees comes from
 * the signed envelope only (`delivery-card.test.tsx`), and the block reports `no_marker` instead.
 */
describe('CertReviewCard without the delivery marker (2.0.1): nothing, whatever its options say', () => {
	let warn: ReturnType<typeof vi.spyOn>
	beforeEach(() => {
		warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	})
	afterEach(() => warn.mockRestore())

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
	it('a certified-looking block prints nothing: no reviewer, no credential, no memo, no verify link', () => {
		const withMemo = { ...base, memo: 'Checked the claims against current guidance; accurate.' }
		for (const element of [
			<CertReviewCard key="plain" {...base} />,
			<CertReviewCard
				key="pair"
				{...base}
				credentialVerification={{ credential: 'FAAAAI', verifiedAt: '2026-03-01' }}
			/>,
			<CertReviewCard key="header" {...withMemo} mode="banner" part="header" />,
			<CertReviewCard key="memo" {...withMemo} mode="banner" part="memo" />,
		]) {
			expect(renderToStaticMarkup(element)).toBe('')
		}
		expect(warn).toHaveBeenCalledTimes(4)
		for (const call of warn.mock.calls) expect(String(call[0])).toContain('"reason":"no_marker"')
	})
	it('returns nothing pre-cert (no reviewerName / verifyUrl)', () => {
		expect(renderToStaticMarkup(<CertReviewCard />)).toBe('')
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
 * The pre-exporter-`mode` bridge (an exported entry with no `mode` painted the BANNER options face, 1.0.1 to 2.0.0) went
 * with the options face in 2.0.1: such an entry prints nothing whatever its `mode`. The renderer's own default stands.
 */
describe('the pre-exporter-`mode` bridge is gone with the options face (2.0.1)', () => {
	let warn: ReturnType<typeof vi.spyOn>
	beforeEach(() => {
		warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	})
	afterEach(() => warn.mockRestore())

	it('an entry with no marker prints nothing, with `mode` absent, nullish or chosen', () => {
		for (const mode of [undefined, null, 'banner', 'sidebar', 'floating'] as const) {
			expect(renderToStaticMarkup(<CertReviewCard {...cardBase} mode={mode} />), `mode={${String(mode)}}`).toBe('')
		}
	})
	it('the renderer itself is untouched: a DIRECT caller omitting mode still gets sidebar', () => {
		// What proves the 1.0.0 decision stands: the one placement default is the renderer's.
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
	let warn: ReturnType<typeof vi.spyOn>
	beforeEach(() => {
		warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	})
	afterEach(() => warn.mockRestore())

	// Everything below is what a visual editor can actually put in the option — the props type
	// is ERASED at runtime, so each of these reaches the card as-is. 2.0.1: a block without the marker prints nothing
	// whatever it carries, and must still never throw.
	const malformed: ReadonlyArray<readonly [string, unknown]> = [
		['a credential with no verification date', { credential: 'FAAAAI' }],
		['a verification date with no credential', { verifiedAt: '2026-03-01' }],
		['an empty object', {}],
		['a bare string', 'FAAAAI'],
		['an array', ['FAAAAI']],
		['a number where verifiedAt belongs', { credential: 'FAAAAI', verifiedAt: 20260301 }],
		['an object where credential belongs', { credential: { abbr: 'FAAAAI' }, verifiedAt: '2026-03-01' }],
	]
	it('a malformed credentialVerification in any shape prints nothing and never throws', () => {
		for (const [label, value] of malformed) {
			const props = { ...cardBase, credentialVerification: value } as CertReviewCardProps
			let html = 'unset'
			expect(() => {
				html = renderToStaticMarkup(<CertReviewCard {...props} />)
			}, label).not.toThrow()
			expect(html, label).toBe('')
		}
	})

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

	it('a wrong-TYPE builderContext or entry id prints nothing and never throws', () => {
		for (const builderContext of [42, 'x', [], { content: 42 }, { content: { id: {} } }]) {
			const props = { ...cardBase, builderContext } as unknown as CertReviewCardProps
			expect(() => renderToStaticMarkup(<CertReviewCard {...props} />)).not.toThrow()
		}
	})
})

/**
 * D7: the compliance disclosures are constants of the renderer, not editor copy. 2.0.1: the card no longer paints from
 * the block's options at all, so the lock is held where it still applies, the renderer the signed envelope face uses.
 */
describe('D7 — the compliance disclosures are constants, not editor copy', () => {
	it('a pro-bono delivery (compensationCue: null) renders NO compensation claim', () => {
		const html = renderCertBlock({ facts: { ...directFacts, compensationCue: null } })
		expect(html).not.toContain(COMPENSATED_EXPERT_CUE)
	})
	it('a REWRITTEN cue is ignored — the locked constant is what renders', () => {
		const html = renderCertBlock({ facts: { ...directFacts, compensationCue: 'Independent expert' } })
		expect(html).toContain(COMPENSATED_EXPERT_CUE)
		expect(html).not.toContain('Independent expert')
	})
	it('the scope line is the locked constant: the renderer takes no scope line from anyone', () => {
		const html = renderCertBlock({ facts: directFacts })
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
