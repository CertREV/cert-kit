/**
 * SSR-render tests for the React components, exercised through `react-dom/server`'s
 * `renderToStaticMarkup` — the SAME path Hydrogen / Next use to produce the crawlable
 * HTML. Rendering server-side here proves three contract properties at once:
 *   • SSR-safe: a component that touched `useState`/`useEffect`/`window` would throw under
 *     `renderToStaticMarkup`; passing means the components are render-pure.
 *   • Escaping: React escapes text + attributes, and our `safeHttpUrl` strips dangerous
 *     schemes — both asserted against hostile mock facts.
 *   • Fail-closed: a suppressed verdict / unsafe URL renders nothing.
 *
 * Facts are mocked via `makeMockPayload` (no crypto, no network — pure render under test).
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CertBadge } from '../components/CertBadge.js'
import { CertJsonLd } from '../components/CertJsonLd.js'
import { CertRevBacklink } from '../components/CertRevBacklink.js'
import { CertReview } from '../components/CertReview.js'
import { ExpertBio } from '../components/ExpertBio.js'
import { makeMockPayload } from '../contract/fixtures.js'

const payload = makeMockPayload()

describe('<CertBadge>', () => {
	it('renders the expert name, credentials, certified date, memo, and verify link (full style)', () => {
		const html = renderToStaticMarkup(<CertBadge payload={payload} />)
		expect(html).toContain('Dr. Jane Doe')
		expect(html).toContain('MD, FAAD')
		expect(html).toContain('Jun 21, 2026') // certifiedAt, deterministic UTC formatting
		expect(html).toContain('retinol claims') // memo
		expect(html).toContain('Verify on CertREV')
		expect(html).toContain('href="https://certrev.com/verify/cert_fixture_001"')
	})

	it('carries an accessible name + the cert id data attribute', () => {
		const html = renderToStaticMarkup(<CertBadge payload={payload} />)
		expect(html).toContain('aria-label="Content reviewed by Dr. Jane Doe, MD, FAAD"')
		expect(html).toContain('data-certrev-cert-id="cert_fixture_001"')
		expect(html).toMatch(/^<section/)
	})

	it('applies the signed accent color as a CSS custom property + accent border', () => {
		const html = renderToStaticMarkup(<CertBadge payload={payload} />)
		expect(html).toContain('--certrev-accent:#7c3aed')
		expect(html).toContain('border-inline-start-color:#7c3aed')
	})

	it('compact style collapses the reviewer block — no memo, no dates, no photo', () => {
		const html = renderToStaticMarkup(<CertBadge payload={payload} badgeStyle="compact" />)
		expect(html).toContain('certrev-badge--compact')
		expect(html).not.toContain('retinol claims')
		expect(html).not.toContain('Certified')
		expect(html).not.toContain('__photo')
		// …but the compliance disclosures persist: a compact claim badge is still a claim face.
		expect(html).toContain(
			'Independent editorial review of this article’s text and sources. Not a product endorsement, nor medical advice.',
		)
	})

	it('carries the always-on compliance baseline: cue + verbatim FTC scope line + strings-version stamp', () => {
		const html = renderToStaticMarkup(<CertBadge payload={payload} />)
		expect(html).toContain('data-certrev-strings-version="2026-07"')
		expect(html).toContain(
			'Independent editorial review of this article’s text and sources. Not a product endorsement, nor medical advice.',
		)
		expect(html).toContain('data-ftc-line')
		// "Compensated expert" (tag-stripped — the cue links "expert" to the reviewer profile).
		expect(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).toContain('Compensated expert')
	})

	it('honors display flags: showMemo=false hides the memo; showExpertPhoto=false hides the photo', () => {
		const p = makeMockPayload({
			content: { ...payload.content, display: { ...payload.content.display, showMemo: false, showExpertPhoto: false } },
		})
		const html = renderToStaticMarkup(<CertBadge payload={p} />)
		expect(html).not.toContain('retinol claims')
		expect(html).not.toContain('__photo')
	})

	it('ESCAPES a hostile display name (React text-escaping; no raw HTML injected)', () => {
		const p = makeMockPayload({
			content: {
				...payload.content,
				expert: { ...payload.content.expert, displayName: '<img src=x onerror=alert(1)>' },
				memo: null,
			},
		})
		const html = renderToStaticMarkup(<CertBadge payload={p} />)
		expect(html).not.toContain('<img src=x onerror=alert(1)>')
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
	})

	it('DROPS a javascript: profile URL (safeHttpUrl) — the name renders unlinked, no href', () => {
		const p = makeMockPayload({
			content: {
				...payload.content,
				// biome-ignore lint/suspicious/noTemplateCurlyInString: literal javascript: scheme string for the XSS-drop assertion
				expert: { ...payload.content.expert, profileUrl: 'javascript:alert(document.cookie)' },
			},
		})
		const html = renderToStaticMarkup(<CertBadge payload={p} />)
		expect(html).not.toContain('javascript:')
		expect(html).not.toContain('__expert-link') // no anchor when the URL is unsafe
		expect(html).toContain('Dr. Jane Doe') // name still rendered
	})

	it('renders the author byline only when the author is present + distinct from the expert', () => {
		const distinct = renderToStaticMarkup(<CertBadge payload={payload} />)
		expect(distinct).toContain('Written by Sam Writer, Senior Content Editor')

		const same = makeMockPayload({
			content: { ...payload.content, author: { name: 'Dr. Jane Doe', title: null } },
		})
		expect(renderToStaticMarkup(<CertBadge payload={same} />)).not.toContain('Written by')
	})
})

describe('<ExpertBio>', () => {
	it('renders the expert identity block with credentials expanded (abbr + full name)', () => {
		const html = renderToStaticMarkup(<ExpertBio payload={payload} />)
		expect(html).toMatch(/^<aside/)
		expect(html).toContain('Dr. Jane Doe')
		expect(html).toContain('<abbr title="Doctor of Medicine">MD</abbr>')
		expect(html).toContain('Fellow of the American Academy of Dermatology')
		expect(html).toContain('Verified expert reviewer')
	})

	it('respects the heading level prop for page-outline slotting', () => {
		expect(renderToStaticMarkup(<ExpertBio payload={payload} headingLevel="h2" />)).toContain('<h2')
		expect(renderToStaticMarkup(<ExpertBio payload={payload} />)).toContain('<h3') // default
	})

	it('omits the photo when showExpertPhoto is false', () => {
		const p = makeMockPayload({
			content: { ...payload.content, display: { ...payload.content.display, showExpertPhoto: false } },
		})
		expect(renderToStaticMarkup(<ExpertBio payload={p} />)).not.toContain('__photo')
	})
})

describe('<CertRevBacklink>', () => {
	it('renders the live verify link with an accessible label', () => {
		const html = renderToStaticMarkup(<CertRevBacklink payload={payload} />)
		expect(html).toMatch(/^<a/)
		expect(html).toContain('href="https://certrev.com/verify/cert_fixture_001"')
		expect(html).toContain('aria-label="Verify this certification on CertREV"')
		expect(html).toContain('Verify on CertREV')
	})

	it('accepts a custom label', () => {
		expect(renderToStaticMarkup(<CertRevBacklink payload={payload} label="Check the certificate" />)).toContain(
			'Check the certificate',
		)
	})

	it('FAIL-CLOSED: renders nothing when the verify URL is unsafe/absent', () => {
		const p = makeMockPayload({ content: { ...payload.content, verifyUrl: 'javascript:alert(1)' } })
		expect(renderToStaticMarkup(<CertRevBacklink payload={p} />)).toBe('')
	})
})

describe('<CertJsonLd>', () => {
	it('emits an application/ld+json <script> with the projected graph', () => {
		const html = renderToStaticMarkup(<CertJsonLd payload={payload} />)
		expect(html).toContain('<script type="application/ld+json">')
		expect(html).toContain('"@type":"Article"')
		expect(html).toContain('"@type":"Review"')
		expect(html).toContain('"reviewedBy"')
		expect(html).toContain('Dr. Jane Doe')
	})

	it('neutralizes < in the serialized body so a hostile memo cannot break out of the tag', () => {
		const p = makeMockPayload({
			content: { ...payload.content, memo: 'safe </script><script>alert(1)</script>' },
		})
		const html = renderToStaticMarkup(<CertJsonLd payload={p} />)
		// The only literal </script> in the output is the script CLOSE tag, not from the memo.
		expect(html.match(/<\/script>/g)?.length).toBe(1)
		expect(html).toContain('\\u003c/script')
	})

	it('threads pageUrl into the Article @id for host-graph merge', () => {
		const html = renderToStaticMarkup(<CertJsonLd payload={payload} pageUrl="https://shop.example.com/a/b" />)
		expect(html).toContain('"@id":"https://shop.example.com/a/b#article"')
	})
})

describe('<CertReview> (composite, fail-closed at the component boundary)', () => {
	it('renders badge + JSON-LD on a render verdict', () => {
		const html = renderToStaticMarkup(<CertReview verdict={{ decision: 'render', payload }} />)
		expect(html).toContain('certrev-badge')
		expect(html).toContain('application/ld+json')
	})

	it('renders NOTHING on a suppress verdict', () => {
		const html = renderToStaticMarkup(<CertReview verdict={{ decision: 'suppress', reason: 'revoked' }} />)
		expect(html).toBe('')
	})

	it('omitJsonLd drops the structured-data script but keeps the badge', () => {
		const html = renderToStaticMarkup(<CertReview verdict={{ decision: 'render', payload }} omitJsonLd />)
		expect(html).toContain('certrev-badge')
		expect(html).not.toContain('application/ld+json')
	})
})
