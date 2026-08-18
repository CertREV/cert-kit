// @vitest-environment jsdom
/**
 * Web Component + string-renderer tests.
 *
 * `renderBadgeHtml` is the framework-agnostic markup source shared by <CertBadge> (it
 * mirrors the JSX) and the <certrev-badge> custom element. We assert it produces the same
 * crawlable structure, hand-escapes every interpolated field, drops unsafe URLs, qualifies
 * every anchor it emits, and survives a payload whose shape nothing runtime-validates — then
 * verify the custom element registers, honors a server-rendered light-DOM child (SSR mode),
 * validates its author-typed `badge-style` attribute, and fails closed in client mode both
 * without a configured key resolver AND when the renderer itself throws.
 *
 * jsdom is opted into per-file (the rest of the suite runs in node) for `HTMLElement` +
 * `customElements`.
 */

import { describe, expect, it, vi } from 'vitest'
import { makeMockPayload } from '../contract/fixtures.js'
import type { CertPayload, CertVerdict } from '../contract/kernel.js'
import {
	CERTREV_BADGE_TAG,
	CertRevBadgeElement,
	defineCertRevBadge,
	setCertRevKidResolver,
} from '../webcomponent/certrev-badge.js'
import { renderBadgeHtml } from '../webcomponent/render-badge-html.js'

/**
 * Client-fetch mode is driven through TWO seams so the ELEMENT's contract can be tested
 * without standing up crypto + network: the verdict is supplied directly, and the shared
 * renderer can be told to throw (the element must survive an unanticipated throw from it —
 * that is exactly the fail-closed hole these tests pin). Both mocks delegate to the real
 * module by default, so every other test in this file exercises the genuine renderer.
 */
const seam = vi.hoisted(() => ({ verdict: null as CertVerdict | null, renderThrows: false }))

vi.mock('../verify/get-verified-envelope.js', () => ({
	getVerifiedEnvelope: async (): Promise<CertVerdict> =>
		seam.verdict ?? { decision: 'suppress', reason: 'unknown_key' },
}))

vi.mock('../webcomponent/render-badge-html.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../webcomponent/render-badge-html.js')>()
	return {
		...actual,
		renderBadgeHtml: (...args: Parameters<typeof actual.renderBadgeHtml>): string => {
			if (seam.renderThrows) throw new TypeError('renderer blew up on a malformed payload')
			return actual.renderBadgeHtml(...args)
		},
	}
})

const payload = makeMockPayload()

/**
 * The fixture with one field removed or corrupted — the payload shape a consumer can
 * ACTUALLY hand `renderBadgeHtml`. `getVerifiedEnvelope` casts raw JSON
 * (`JSON.parse(value) as CertDeliveryEnvelope`) and the kernel checks the signature,
 * subject, lifecycle and drift — never the shape of `content`. Driven off the real fixture
 * (not a hand-written object) so these track the payload shape as it evolves.
 */
function mangled(mutate: (content: Record<string, unknown>) => void): CertPayload {
	const p = structuredClone(makeMockPayload())
	mutate(p.content as unknown as Record<string, unknown>)
	return p
}

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

	it.each([
		['full'],
		['compact'],
	] as const)('QUALIFIES every anchor it emits on the %s face (rel carries nofollow + sponsored)', (badgeStyle) => {
		// A SWEEP, not a spot-check: every link this package places on a customer's page is a
		// vendor-required placement, so a future anchor added without qualification fails here.
		const anchors = renderBadgeHtml(payload, { badgeStyle }).match(/<a\b[^>]*>/g) ?? []
		expect(anchors.length).toBeGreaterThan(0)
		for (const anchor of anchors) {
			expect(anchor).toMatch(/\brel="[^"]*\bnofollow\b[^"]*"/)
			expect(anchor).toMatch(/\brel="[^"]*\bsponsored\b[^"]*"/)
		}
	})

	describe('tolerates a malformed payload (nothing runtime-validates `content` — C4)', () => {
		const cases: ReadonlyArray<readonly [string, CertPayload]> = [
			['no expert at all', mangled((c) => delete c.expert)],
			['no expert.displayName', mangled((c) => delete (c.expert as Record<string, unknown>).displayName)],
			['no expert.credentials', mangled((c) => delete (c.expert as Record<string, unknown>).credentials)],
			['no author', mangled((c) => delete c.author)],
			['no display block', mangled((c) => delete c.display)],
			[
				'a NUMBER in displayName',
				mangled((c) => {
					;(c.expert as Record<string, unknown>).displayName = 42
				}),
			],
			[
				'a NUMBER in memo',
				mangled((c) => {
					c.memo = 42
				}),
			],
			[
				'a NUMBER in display.badgeStyle',
				mangled((c) => {
					;(c.display as Record<string, unknown>).badgeStyle = 42
				}),
			],
		]

		it.each(cases)('renders markup instead of throwing: %s', (_label, malformed) => {
			expect(() => renderBadgeHtml(malformed)).not.toThrow()
			expect(renderBadgeHtml(malformed)).toMatch(/^<section class="certrev-badge certrev-badge--(full|compact)"/)
		})
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

	/** Mount an element in client-fetch mode (the verdict comes from the mocked verify layer). */
	function mountClientBadge(attrs: Record<string, string>): HTMLElement {
		defineCertRevBadge()
		setCertRevKidResolver(() => null) // presence is all the element checks; the verdict is supplied
		const host = document.createElement(CERTREV_BADGE_TAG)
		host.setAttribute('delivery-api', 'https://portal.certrev.com')
		host.setAttribute('platform', 'shopify')
		host.setAttribute('external-id', 'gid://shopify/Article/1')
		for (const [name, value] of Object.entries(attrs)) host.setAttribute(name, value)
		document.body.appendChild(host)
		return host
	}

	it.each([
		['Full'],
		['nonsense'],
		[''],
	])('IGNORES an unrecognised badge-style attribute (%j) and defers to the signed display config', async (badgeStyle) => {
		// `badge-style` is author-typed markup, not signed data. The element used to CAST it
		// (`as 'full' | 'compact' | null`), so a typo travelled straight into the renderer.
		const compactPayload = makeMockPayload({
			content: { ...payload.content, display: { ...payload.content.display, badgeStyle: 'compact' } },
		})
		seam.verdict = { decision: 'render', payload: compactPayload }
		const host = mountClientBadge({ 'badge-style': badgeStyle })
		await vi.waitFor(() => expect(host.querySelector('.certrev-badge')).not.toBeNull())
		expect(host.innerHTML).toContain('certrev-badge--compact')
		expect(host.innerHTML).not.toContain('certrev-badge--full')
		host.remove()
		seam.verdict = null
	})

	it('honors a VALID badge-style attribute over the signed display config', async () => {
		seam.verdict = { decision: 'render', payload } // fixture display.badgeStyle is 'full'
		const host = mountClientBadge({ 'badge-style': 'compact' })
		await vi.waitFor(() => expect(host.querySelector('.certrev-badge')).not.toBeNull())
		expect(host.innerHTML).toContain('certrev-badge--compact')
		host.remove()
		seam.verdict = null
	})

	it('client mode FAIL-CLOSED: a THROWING renderer renders nothing, not an unhandled rejection', async () => {
		// The render call sat OUTSIDE the try/catch, so any throw from `renderBadgeHtml`
		// escaped the element's documented fail-closed behaviour as an unhandled rejection
		// (connectedCallback `void`s the promise — nothing downstream can catch it).
		const rejections: unknown[] = []
		const record = (reason: unknown): void => {
			rejections.push(reason)
		}
		process.on('unhandledRejection', record)
		seam.verdict = { decision: 'render', payload }
		seam.renderThrows = true
		const host = mountClientBadge({})
		await new Promise((resolve) => setTimeout(resolve, 20)) // let a rejection surface
		expect(rejections).toEqual([])
		expect(host.querySelector('.certrev-badge')).toBeNull()
		host.remove()
		process.off('unhandledRejection', record)
		seam.renderThrows = false
		seam.verdict = null
	})
})
