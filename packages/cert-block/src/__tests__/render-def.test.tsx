/**
 * WS6 — design-guide render-def support (themeable tokens + subtractive visibility)
 * + the two always-on compliance strings.
 *
 * Two planes, both exercised through the SSR paths (React `renderToStaticMarkup` +
 * the framework-agnostic `renderBadgeHtml` string renderer — the crawlable output):
 *   1. the PURE resolution helpers (validators, `resolveRenderTheme`, visibility,
 *      the fixed font stacks, the byte-verbatim strings);
 *   2. the RENDERED faces — a themed def emits the four `--certrev-*` vars + the
 *      def-version stamp + subtractive visibility; NO def is theme-byte-identical
 *      to the un-themed default; an invalid token is DROPPED (fail-safe); and the
 *      compensation cue + FTC scope line + strings-version stamp land on EVERY
 *      claim face (the compliance baseline, with or without a def).
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CertBadge } from '../components/CertBadge.js'
import { CertReview } from '../components/CertReview.js'
import {
	CERT_SCOPE_LINE,
	CERT_STRINGS_VERSION,
	type CertRenderDef,
	COMPENSATED_EXPERT_CUE,
	type FontSlot,
	FONT_STACKS,
	isCornerRadius,
	isFieldHidden,
	isFontSlot,
	isOpaqueHexColor,
	resolveRenderTheme,
	themeCssVarDeclarations,
} from '../components/render-def.js'
import { makeMockPayload } from '../contract/fixtures.js'
import { renderBadgeHtml } from '../webcomponent/render-badge-html.js'

const payload = makeMockPayload()

/** A fully-themed, valid render-def (every token overridden, both fields hidden). */
const THEMED: CertRenderDef = {
	tokens: { accentColor: '#123456', surface: '#eeeeee', cornerRadius: '8px', fontSlot: 'serif' },
	hidden: ['reviewerPhoto', 'memo'],
	version: 4,
}

/** Tag-strip a fragment of HTML to its visible text (collapse whitespace). */
function visibleText(html: string): string {
	return html
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('token validators (mirror portal src/lib/design-guide/tokens.ts)', () => {
	it('isOpaqueHexColor accepts 3/6-digit hex, rejects alpha / functions / keywords', () => {
		for (const ok of ['#fff', '#FFFFFF', '#0a1b3f', '#123']) expect(isOpaqueHexColor(ok)).toBe(true)
		for (const bad of ['#ffff', '#ffffffaa', '#12', '#1234567', 'transparent', 'rgb(0,0,0)', 'red', '', ' #fff'])
			expect(isOpaqueHexColor(bad)).toBe(false)
	})

	it('isCornerRadius accepts a bare 0 or a single unit length, rejects unitless / calc / spaces', () => {
		for (const ok of ['0', '12px', '0.5rem', '.5em', '100%', '4px']) expect(isCornerRadius(ok)).toBe(true)
		for (const bad of ['12', '12 px', 'calc(1px)', '1px 2px', '', 'px', '-4px']) expect(isCornerRadius(bad)).toBe(false)
	})

	it('isFontSlot admits the five enum members', () => {
		for (const ok of ['sans', 'serif', 'system', 'grotesk', 'mono']) expect(isFontSlot(ok)).toBe(true)
		for (const bad of ['Arial', '', 'SANS', 'wingdings']) expect(isFontSlot(bad)).toBe(false)
	})
})

describe('FONT_STACKS — byte-identical to the Shopify Liquid engine literals', () => {
	it('matches the exact stacks (the parity anchor across the twins)', () => {
		expect(FONT_STACKS.sans).toBe("'DM Sans', system-ui, -apple-system, BlinkMacSystemFont, sans-serif")
		expect(FONT_STACKS.serif).toBe("'Playfair Display', Georgia, 'Times New Roman', serif")
		expect(FONT_STACKS.system).toBe("system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif")
		// grotesk/mono added at the shared guide values — byte-identical to RENDER_BLOCK_FONT_STACKS
		// and the portal FONT_SLOT_STACKS, so the modal + Liquid card paint the same typography.
		expect(FONT_STACKS.grotesk).toBe("'Plus Jakarta Sans', system-ui, Helvetica, Arial, sans-serif")
		expect(FONT_STACKS.mono).toBe("'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace")
	})
})

describe('resolveRenderTheme — validates + drops (fail-safe)', () => {
	it('returns {} for an absent def', () => {
		expect(resolveRenderTheme(undefined)).toEqual({})
	})

	it('resolves every valid token + the fontSlot → fixed stack + the version', () => {
		expect(resolveRenderTheme(THEMED)).toEqual({
			accent: '#123456',
			surface: '#eeeeee',
			cornerRadius: '8px',
			fontStack: FONT_STACKS.serif,
			version: 4,
		})
	})

	it('resolves the ADDED grotesk/mono slots to their FONT_STACKS families (the modal themes all five)', () => {
		expect(resolveRenderTheme({ tokens: { fontSlot: 'grotesk' } }).fontStack).toBe(FONT_STACKS.grotesk)
		expect(resolveRenderTheme({ tokens: { fontSlot: 'mono' } }).fontStack).toBe(FONT_STACKS.mono)
	})

	it('DROPS every invalid token (alpha surface, function accent, calc radius, unknown slot)', () => {
		const resolved = resolveRenderTheme({
			tokens: {
				accentColor: 'rgb(0,0,0)',
				surface: '#ffffffaa',
				cornerRadius: 'calc(1px)',
				fontSlot: 'wingdings' as FontSlot,
			},
			version: 2,
		})
		expect(resolved).toEqual({
			accent: undefined,
			surface: undefined,
			cornerRadius: undefined,
			fontStack: undefined,
			version: 2,
		})
	})

	it('drops a non-finite version', () => {
		expect(resolveRenderTheme({ version: Number.NaN }).version).toBeUndefined()
	})
})

describe('subtractive visibility + var declarations', () => {
	it('isFieldHidden is true only for a listed field', () => {
		expect(isFieldHidden({ hidden: ['memo'] }, 'memo')).toBe(true)
		expect(isFieldHidden({ hidden: ['memo'] }, 'reviewerPhoto')).toBe(false)
		expect(isFieldHidden(undefined, 'memo')).toBe(false)
	})

	it('themeCssVarDeclarations is empty for an un-themed face and ordered surface→radius→font', () => {
		expect(themeCssVarDeclarations({})).toEqual([])
		expect(themeCssVarDeclarations(resolveRenderTheme(THEMED))).toEqual([
			['--certrev-surface', '#eeeeee'],
			['--certrev-radius', '8px'],
			['--certrev-font', FONT_STACKS.serif],
		])
	})
})

describe('the two always-on compliance strings are byte-verbatim', () => {
	it('cue + strings-version', () => {
		expect(COMPENSATED_EXPERT_CUE).toBe('Compensated expert')
		expect(CERT_STRINGS_VERSION).toBe('2026-07')
	})

	it('the scope line carries the load-bearing curly apostrophe U+2019', () => {
		expect(CERT_SCOPE_LINE).toBe(
			'Independent editorial review of this article’s text and sources. Not a product endorsement, nor medical advice.',
		)
		expect(CERT_SCOPE_LINE).toContain('’')
		expect(CERT_SCOPE_LINE).not.toContain("'") // straight apostrophe would be a contract divergence
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Rendered — React <CertBadge>
// ─────────────────────────────────────────────────────────────────────────────

describe('<CertBadge> themed', () => {
	it('emits the four --certrev-* vars, the def-version stamp, and hides subtracted fields', () => {
		const html = renderToStaticMarkup(<CertBadge payload={payload} renderDef={THEMED} />)
		expect(html).toContain('--certrev-accent:#123456')
		expect(html).toContain('--certrev-surface:#eeeeee')
		expect(html).toContain('--certrev-radius:8px')
		// React entity-encodes the font stack's single quotes; the family content is intact.
		expect(html).toContain('--certrev-font:')
		expect(html).toContain('Playfair Display')
		expect(html).toContain('data-certrev-def-version="4"')
		// subtractive visibility: reviewerPhoto + memo hidden
		expect(html).not.toContain('__photo')
		expect(html).not.toContain('retinol claims')
	})

	it('an unthemed badge emits NO theme vars + NO def-version stamp (theme byte-neutral)', () => {
		const html = renderToStaticMarkup(<CertBadge payload={payload} />)
		expect(html).not.toContain('--certrev-surface')
		expect(html).not.toContain('--certrev-radius')
		expect(html).not.toContain('--certrev-font')
		expect(html).not.toContain('data-certrev-def-version')
	})
})

describe('compliance baseline — cue + scope + strings-version on EVERY claim face', () => {
	it('full + unthemed: cue, verbatim scope line, and the strings-version stamp all present', () => {
		const html = renderToStaticMarkup(<CertBadge payload={payload} />)
		expect(html).toContain('data-certrev-strings-version="2026-07"')
		expect(html).toContain(CERT_SCOPE_LINE)
		expect(html).toContain('data-ftc-line')
		expect(visibleText(html)).toContain(COMPENSATED_EXPERT_CUE)
	})

	it('compact ALSO carries the cue + scope (a compact claim badge is still a claim face)', () => {
		const html = renderToStaticMarkup(<CertBadge payload={payload} badgeStyle="compact" />)
		expect(html).toContain('certrev-badge--compact')
		expect(html).toContain(CERT_SCOPE_LINE)
		expect(visibleText(html)).toContain(COMPENSATED_EXPERT_CUE)
	})

	it('the cue links "expert" to the reviewer profile; falls back to plain text when unsafe', () => {
		const linked = renderToStaticMarkup(<CertBadge payload={payload} />)
		expect(linked).toContain('>expert</a>')
		const p = makeMockPayload({
			content: { ...payload.content, expert: { ...payload.content.expert, profileUrl: 'javascript:alert(1)' } },
		})
		const unlinked = renderToStaticMarkup(<CertBadge payload={p} />)
		expect(unlinked).not.toContain('javascript:')
		expect(visibleText(unlinked)).toContain(COMPENSATED_EXPERT_CUE)
	})
})

describe('<CertReview> forwards the render-def to the badge', () => {
	it('a themed def reaches the badge; the JSON-LD stays presentation-blind', () => {
		const html = renderToStaticMarkup(<CertReview verdict={{ decision: 'render', payload }} renderDef={THEMED} />)
		expect(html).toContain('--certrev-surface:#eeeeee')
		expect(html).toContain('data-certrev-def-version="4"')
		// the projector never sees the def — the graph is byte-unchanged
		expect(html).toContain('application/ld+json')
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Rendered — the framework-agnostic string path (renderBadgeHtml)
// ─────────────────────────────────────────────────────────────────────────────

describe('renderBadgeHtml themed (the crawlable string path)', () => {
	it('emits each --certrev-* var exactly once; the font stack is the RAW fixed literal (byte-exact)', () => {
		const html = renderBadgeHtml(payload, { renderDef: THEMED })
		expect(html).toContain('--certrev-accent:#123456')
		expect(html).toContain('--certrev-surface:#eeeeee')
		expect(html).toContain('--certrev-radius:8px')
		expect(html).toContain(`--certrev-font:${FONT_STACKS.serif}`) // byte-exact, single quotes raw
		for (const v of ['--certrev-accent:', '--certrev-surface:', '--certrev-radius:', '--certrev-font:'])
			expect((html.match(new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length).toBe(1)
		expect(html).toContain('data-certrev-def-version="4"')
		expect(html).toContain('data-certrev-strings-version="2026-07"')
		expect(html).not.toContain('__photo') // reviewerPhoto hidden
		expect(html).not.toContain('__memo') // memo hidden
	})

	it('the compliance baseline is present: verbatim scope line + the cue', () => {
		const html = renderBadgeHtml(payload, { renderDef: THEMED })
		expect(html).toContain(CERT_SCOPE_LINE)
		expect(html).toContain('data-ftc-line')
		expect(visibleText(html)).toContain(COMPENSATED_EXPERT_CUE)
	})

	it('DROPS every invalid token (fail-safe to preset default); no injection reaches the style', () => {
		const html = renderBadgeHtml(payload, {
			renderDef: {
				tokens: {
					accentColor: 'rgb(0,0,0)',
					surface: '#ffffffaa',
					cornerRadius: 'calc(1px)',
					fontSlot: 'wingdings' as FontSlot,
				},
			},
		})
		expect(html).not.toContain('rgb(0,0,0)')
		expect(html).not.toContain('#ffffffaa')
		expect(html).not.toContain('calc(')
		expect(html).not.toContain('--certrev-surface')
		expect(html).not.toContain('--certrev-radius')
		expect(html).not.toContain('--certrev-font')
		// the invalid accent fell back to the signed display accent (never the rgb)
		expect(html).toContain('--certrev-accent:#7c3aed')
	})

	it('un-themed: theme output is BYTE-IDENTICAL to the pre-WS6 single-accent form', () => {
		const html = renderBadgeHtml(payload)
		expect(html).toContain('style="--certrev-accent:#7c3aed;border-inline-start-color:#7c3aed"')
		expect(html).not.toContain('--certrev-surface')
		expect(html).not.toContain('data-certrev-def-version')
		// baseline compliance strings still land on the un-themed face
		expect(html).toContain('data-certrev-strings-version="2026-07"')
		expect(html).toContain(CERT_SCOPE_LINE)
	})

	it('renders the cue as plain text when the profile URL is unsafe/absent', () => {
		const p = makeMockPayload({
			content: { ...payload.content, expert: { ...payload.content.expert, profileUrl: 'javascript:alert(1)' } },
		})
		const html = renderBadgeHtml(p)
		expect(html).not.toContain('javascript:')
		expect(html).toContain('Compensated expert')
	})
})
