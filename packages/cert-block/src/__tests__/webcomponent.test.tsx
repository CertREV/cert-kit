// @vitest-environment jsdom
/**
 * Web Component + string-renderer tests.
 *
 * `renderBadgeHtml` is the framework-agnostic markup source shared by <CertBadge> (it
 * mirrors the JSX) and the <certrev-badge> custom element. We assert it produces the same
 * crawlable structure, hand-escapes every interpolated field, and drops unsafe URLs — then
 * verify the custom element registers, honors a server-rendered light-DOM child (SSR mode),
 * and fails closed in client mode without a configured key resolver.
 *
 * jsdom is opted into per-file (the rest of the suite runs in node) for `HTMLElement` +
 * `customElements`.
 */

import { describe, expect, it } from 'vitest'
import { makeMockPayload } from '../contract/fixtures.js'
import {
	CERTREV_BADGE_TAG,
	CertRevBadgeElement,
	defineCertRevBadge,
	setCertRevKidResolver,
} from '../webcomponent/certrev-badge.js'
import { renderBadgeHtml } from '../webcomponent/render-badge-html.js'

const payload = makeMockPayload()

describe('renderBadgeHtml (the shared, framework-agnostic markup)', () => {
	it('renders the same crawlable structure as <CertBadge>: section, expert, credentials, verify link', () => {
		const html = renderBadgeHtml(payload)
		expect(html).toMatch(/^<section class="certrev-badge certrev-badge--full"/)
		expect(html).toContain('Dr. Jane Doe')
		expect(html).toContain('MD, FAAD')
		expect(html).toContain('Verify on CertREV')
		expect(html).toContain('data-certrev-cert-id="cert_fixture_001"')
		expect(html).toContain('aria-label="Content reviewed by Dr. Jane Doe, MD, FAAD"')
	})

	it('HAND-ESCAPES a hostile display name (no React here — the string path must escape itself)', () => {
		const p = makeMockPayload({
			content: {
				...payload.content,
				expert: { ...payload.content.expert, displayName: '<img src=x onerror=alert(1)>' },
				memo: null,
			},
		})
		const html = renderBadgeHtml(p)
		expect(html).not.toContain('<img src=x')
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
	})

	it('DROPS a javascript: verify URL (safeHttpUrl) — no verify anchor emitted', () => {
		const p = makeMockPayload({ content: { ...payload.content, verifyUrl: 'javascript:alert(1)' } })
		const html = renderBadgeHtml(p)
		expect(html).not.toContain('javascript:')
		expect(html).not.toContain('__verify')
	})

	it('rejects an unsafe accentColor and falls back to the default token', () => {
		const p = makeMockPayload({
			content: { ...payload.content, display: { ...payload.content.display, accentColor: 'url(evil)' } },
		})
		const html = renderBadgeHtml(p)
		expect(html).not.toContain('url(evil)')
		expect(html).toContain('--certrev-accent:#0f766e')
	})

	it('compact style omits the photo, memo, and dates', () => {
		const html = renderBadgeHtml(payload, { badgeStyle: 'compact' })
		expect(html).toContain('certrev-badge--compact')
		expect(html).not.toContain('__photo')
		expect(html).not.toContain('__memo')
		expect(html).not.toContain('__dates')
	})

	it('carries the always-on compliance baseline (cue + verbatim scope line + strings-version) on every face', () => {
		const html = renderBadgeHtml(payload)
		expect(html).toContain('data-certrev-strings-version="2026-07"')
		expect(html).toContain(
			'Independent editorial review of this article’s text and sources. Not a product endorsement, nor medical advice.',
		)
		expect(html).toContain('data-ftc-line')
		expect(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).toContain('Compensated expert')
	})
})

describe('<certrev-badge> custom element', () => {
	it('registers idempotently under its tag', () => {
		defineCertRevBadge()
		defineCertRevBadge() // second call is a no-op, must not throw
		expect(customElements.get(CERTREV_BADGE_TAG)).toBe(CertRevBadgeElement)
	})

	it('SSR mode: leaves a server-rendered light-DOM badge child untouched on connect', () => {
		defineCertRevBadge()
		const host = document.createElement(CERTREV_BADGE_TAG)
		host.innerHTML = renderBadgeHtml(payload) // server already rendered the badge inside
		document.body.appendChild(host)
		// connectedCallback saw an existing .certrev-badge child → must not wipe/replace it.
		expect(host.querySelector('.certrev-badge')).not.toBeNull()
		expect(host.innerHTML).toContain('Dr. Jane Doe')
		host.remove()
	})

	it('client mode FAIL-CLOSED: with no key resolver configured it renders nothing', () => {
		setCertRevKidResolver(null as never) // explicitly unconfigured
		defineCertRevBadge()
		const host = document.createElement(CERTREV_BADGE_TAG)
		host.setAttribute('delivery-api', 'https://portal.certrev.com')
		host.setAttribute('platform', 'shopify')
		host.setAttribute('external-id', 'gid://shopify/Article/1')
		document.body.appendChild(host)
		// No resolver → cannot verify → renders nothing (fail-closed). No badge child appears.
		expect(host.querySelector('.certrev-badge')).toBeNull()
		host.remove()
	})
})
