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
import { CertRevAnchor, CertRevProvider, certRevAnchorComponent, type CurrentCredential } from '../index.js'

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

// ── POR-10721 W1/W3: the PUSH kit (CertReviewCard) + contract lock ──
import {
	BUILDER_CERT_CHROME_KEYS,
	BUILDER_REGISTRATION,
	type BuilderCertChromeData,
	CERT_COMPONENT_NAME,
	certRevCertComponent,
	CertReviewCard,
	WIRE_INPUTS,
} from '../index.js'

describe('POR-10721 W3 — Builder kit contract lock (inputs ⇄ wire-type parity)', () => {
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

describe('POR-10721 — certRevCertComponent (the drop-in gen2 registration)', () => {
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

describe('POR-10721 W1 — CertReviewCard render + the fused-credential R1 gate', () => {
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
		expect(renderToStaticMarkup(<CertReviewCard {...base} credentialVerification={null} />)).not.toContain(
			'FAAAAI',
		)
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
	it('passes `part` through to renderCertBlock (POR-10741 — header excludes the memo, memo excludes the header)', () => {
		const withMemo = { ...base, memo: 'Checked the claims against current guidance; accurate.' }
		const header = renderToStaticMarkup(<CertReviewCard {...withMemo} part="header" />)
		const memo = renderToStaticMarkup(<CertReviewCard {...withMemo} part="memo" />)
		expect(header).toContain('Expert reviewed')
		expect(header).not.toContain('Checked the claims against current guidance; accurate.')
		expect(memo).toContain('Checked the claims against current guidance; accurate.')
		expect(memo).not.toContain('Expert reviewed')
	})
})
