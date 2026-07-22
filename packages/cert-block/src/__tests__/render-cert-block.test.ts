/**
 * renderCertBlock — the LOCKED 3-mode CertREV cert design (banner / sidebar /
 * floating) as an SSR-safe HTML string.
 *
 * Coverage:
 *   1. SNAPSHOTS — each mode for a representative envelope + a themed (non-navy)
 *      variant, so any drift from the owner-approved locked design is caught.
 *   2. LOCKED disclosures — the compensation cue, the byte-exact FTC scope line,
 *      and the GROUPED dated credential verification appear on every CLAIM face
 *      (banner + sidebar). Floating is a modal pointer, not a claim face.
 *   3. THEMING — the resolved tokens reach the root as the guide's CSS vars; an
 *      invalid token fails safe to navy; the fixed logo chrome is present.
 *   4. ESCAPING — a value carrying `< & "` is escaped (this is storefront HTML).
 */

import { describe, expect, it } from 'vitest'
import {
	CERT_SCOPE_LINE,
	type CertBlockFace,
	type CertBlockFacts,
	type CertBlockLayout,
	type CertBlockMode,
	COMPENSATED_EXPERT_CUE,
	CREDENTIAL_VERIFIED_ATTRIBUTION,
	RENDER_BLOCK_FONT_STACKS,
	type ResolvedBlockTheme,
	renderCertBlock,
} from '../index.js'

/** A representative, well-formed cert (mirrors the locked-reference sample facts). */
const FACTS: CertBlockFacts = {
	authorName: 'The Editorial Team',
	authorTitle: 'Editorial',
	reviewerName: 'Jane Doe',
	credential: 'MD',
	credentialVerifiedAt: '2026-04-14T00:00:00.000Z',
	certifiedAt: '2026-04-14T00:00:00.000Z',
	memo: 'Patients ask me almost every week whether the SPF in their foundation is enough on its own. Treat makeup with SPF as a helpful last layer, not the base of your routine.',
	bio: 'Board-certified dermatologist in San Francisco specializing in photoprotection, skin-cancer prevention, and evidence-based skincare, with fifteen years of clinical practice.',
	profileUrl: 'https://certrev.com/expert/sample',
	certificateUrl: 'https://certrev.com/verify/sample',
}

/** A themed brand (non-navy accent + dark ink + custom corners/surface/font). */
const THEMED: ResolvedBlockTheme = {
	accentColor: '#E8603C',
	surface: '#faf8f4',
	cornerRadius: '22px',
	fontSlot: 'grotesk',
	accentFg: '#141414',
}

/**
 * A v2 brand-ink themed brand: a black seal bar + near-black free-content ink on
 * top of the accent/surface/corner/font theming. `barInkFg` is DERIVED at the edge from `barInk`
 * (accentFg('#000000') = '#ffffff'), so it need not be supplied here.
 */
const THEMED_INK: ResolvedBlockTheme = {
	...THEMED,
	barInk: '#000000',
	inkColor: '#1a1a1a',
}

const MODES: CertBlockMode[] = ['banner', 'sidebar', 'floating']
const CLAIM_FACES: CertBlockMode[] = ['banner', 'sidebar']

/** Tag-strip a fragment of HTML to its visible text (collapse whitespace). */
function visibleText(html: string): string {
	return html
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCKED disclosures are undroppable — omitted OR empty/whitespace defaults
// ─────────────────────────────────────────────────────────────────────────────

describe('renderCertBlock — LOCKED disclosure strings are undroppable', () => {
	for (const mode of CLAIM_FACES) {
		it(`${mode}: an empty/whitespace override of the locked strings falls back to the byte-exact constants`, () => {
			const html = renderCertBlock({
				mode,
				facts: { ...FACTS, compensationCue: '', scopeLine: '', credentialLine: '   ' },
			})
			expect(html).toContain(COMPENSATED_EXPERT_CUE)
			expect(html).toContain(CERT_SCOPE_LINE)
			expect(html).toContain(CREDENTIAL_VERIFIED_ATTRIBUTION)
		})
	}
})

// ─────────────────────────────────────────────────────────────────────────────
// Snapshots — the locked-design byte target
// ─────────────────────────────────────────────────────────────────────────────

describe('renderCertBlock — locked-design snapshots', () => {
	for (const mode of MODES) {
		it(`${mode} (navy default) matches the locked snapshot`, () => {
			expect(renderCertBlock({ mode, facts: FACTS })).toMatchSnapshot()
		})
		it(`${mode} (themed, non-navy accent) matches the locked snapshot`, () => {
			expect(renderCertBlock({ mode, theme: THEMED, facts: FACTS })).toMatchSnapshot()
		})
	}
	for (const mode of CLAIM_FACES) {
		it(`${mode} (v2 brand-ink: barInk + inkColor) matches the locked snapshot`, () => {
			expect(renderCertBlock({ mode, theme: THEMED_INK, facts: FACTS })).toMatchSnapshot()
		})
	}
})

// ─────────────────────────────────────────────────────────────────────────────
// First-class banner memo split (POR-10741) — retires the CertReviewCard string-hack
// ─────────────────────────────────────────────────────────────────────────────

describe('renderCertBlock — banner memo split (part)', () => {
	it("default (no part) is byte-identical to part:'full'", () => {
		expect(renderCertBlock({ mode: 'banner', facts: FACTS })).toBe(
			renderCertBlock({ mode: 'banner', part: 'full', facts: FACTS }),
		)
	})

	it("part:'full' === header + memo (the two split parts recompose the whole card set)", () => {
		const header = renderCertBlock({ mode: 'banner', part: 'header', facts: FACTS })
		const memo = renderCertBlock({ mode: 'banner', part: 'memo', facts: FACTS })
		// Each part is a self-contained themed root; concatenating the header's inner + the memo's
		// inner reproduces the full render's inner (same root shell, split content).
		const inner = (html: string) => html.slice(html.indexOf('>') + 1, html.lastIndexOf('</div>'))
		const full = renderCertBlock({ mode: 'banner', part: 'full', facts: FACTS })
		expect(inner(header) + inner(memo)).toBe(inner(full))
	})

	it("part:'header' renders the header card WITHOUT the memo quote", () => {
		const header = renderCertBlock({ mode: 'banner', part: 'header', facts: FACTS })
		expect(header.startsWith('<div class="certrev-cert certrev-cert--banner')).toBe(true)
		expect(header).toContain('Expert reviewed')
		expect(header).not.toContain(FACTS.memo)
	})

	it("part:'memo' renders the memo card WITHOUT the header eyebrow", () => {
		const memo = renderCertBlock({ mode: 'banner', part: 'memo', facts: FACTS })
		expect(memo.startsWith('<div class="certrev-cert certrev-cert--banner')).toBe(true)
		expect(memo).toContain(FACTS.memo)
		expect(memo).not.toContain('Expert reviewed')
	})

	it('part is ignored outside banner mode (sidebar renders identically with or without it)', () => {
		expect(renderCertBlock({ mode: 'sidebar', part: 'header', facts: FACTS })).toBe(
			renderCertBlock({ mode: 'sidebar', facts: FACTS }),
		)
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// LOCKED disclosures — on every claim face
// ─────────────────────────────────────────────────────────────────────────────

describe('the three LOCKED disclosures render on every CLAIM face', () => {
	for (const mode of CLAIM_FACES) {
		it(`${mode}: compensation cue + byte-exact FTC scope line + dated credential verification`, () => {
			const html = renderCertBlock({ mode, facts: FACTS })
			// (1) compensation cue
			expect(visibleText(html)).toContain(COMPENSATED_EXPERT_CUE)
			// (2) FTC scope line — byte-exact, including the load-bearing curly apostrophe U+2019
			expect(html).toContain(CERT_SCOPE_LINE)
			expect(CERT_SCOPE_LINE).toContain('’')
			// (3) dated credential verification
			expect(html).toContain(CREDENTIAL_VERIFIED_ATTRIBUTION)
			expect(html).toContain('on Apr 14, 2026')
		})

		it(`${mode}: the credential + its dated verification stay GROUPED, in order`, () => {
			const html = renderCertBlock({ mode, facts: FACTS })
			const iName = html.indexOf('Jane Doe, MD')
			const iAttribution = html.indexOf(CREDENTIAL_VERIFIED_ATTRIBUTION)
			const iDate = html.indexOf('on Apr 14, 2026')
			expect(iName).toBeGreaterThanOrEqual(0)
			expect(iAttribution).toBeGreaterThan(iName)
			expect(iDate).toBeGreaterThan(iAttribution)
		})

		it(`${mode}: the disclosures survive even when the caller omits the locked strings`, () => {
			// Omit compensationCue / scopeLine / credentialLine — they default to the
			// byte-verbatim mirrored constants (the compliance baseline is never dropped).
			const html = renderCertBlock({ mode, facts: FACTS })
			expect(html).toContain(CERT_SCOPE_LINE)
			expect(visibleText(html)).toContain(COMPENSATED_EXPERT_CUE)
			expect(html).toContain(CREDENTIAL_VERIFIED_ATTRIBUTION)
		})
	}

	it('the caller-supplied locked strings are rendered verbatim when provided', () => {
		const html = renderCertBlock({
			mode: 'banner',
			facts: {
				...FACTS,
				compensationCue: COMPENSATED_EXPERT_CUE,
				scopeLine: CERT_SCOPE_LINE,
				credentialLine: CREDENTIAL_VERIFIED_ATTRIBUTION,
			},
		})
		expect(html).toContain(CERT_SCOPE_LINE)
		expect(html).toContain(CREDENTIAL_VERIFIED_ATTRIBUTION)
	})

	it('the floating pill is a modal pointer — it makes no claim (no disclosures)', () => {
		const html = renderCertBlock({ mode: 'floating', facts: FACTS })
		expect(html).toContain('Expert reviewed:')
		expect(html).not.toContain(CERT_SCOPE_LINE)
		expect(html).not.toContain(CREDENTIAL_VERIFIED_ATTRIBUTION)
		expect(visibleText(html)).not.toContain(COMPENSATED_EXPERT_CUE)
		// but it still links to the two modal surfaces
		expect(html).toContain('data-certrev-modal-open="expert"')
		expect(html).toContain('data-certrev-modal-open ')
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Theming — CSS vars, fail-safe, fixed chrome
// ─────────────────────────────────────────────────────────────────────────────

describe('theming', () => {
	it('un-themed: the root carries the navy default vars + the strings-version stamp', () => {
		const html = renderCertBlock({ mode: 'banner', facts: FACTS })
		expect(html).toContain('--ba:#0a1b3f')
		expect(html).toContain('--ba-fg:#ffffff')
		expect(html).toContain('--br:14px')
		// The body font is a host-overridable HOOK (POR-10742): the resolved stack is the FALLBACK
		// inside `--cr-bf:var(--bf,<stack>)`, and the root must NOT hard-declare a bare `--bf:` (which
		// would shadow a host page's `--bf` and force `!important`).
		expect(html).toContain(`--cr-bf:var(--bf,${RENDER_BLOCK_FONT_STACKS.sans})`)
		expect(html).not.toContain(';--bf:')
		expect(html).toContain('--surface:#ffffff')
		expect(html).toContain('data-certrev-strings-version="2026-07"')
	})

	it('themed: the resolved tokens reach the root as CSS vars', () => {
		const html = renderCertBlock({ mode: 'sidebar', theme: THEMED, facts: FACTS })
		expect(html).toContain('--ba:#E8603C')
		expect(html).toContain('--ba-fg:#141414')
		expect(html).toContain('--br:22px')
		expect(html).toContain(`--cr-bf:var(--bf,${RENDER_BLOCK_FONT_STACKS.grotesk})`)
		expect(html).toContain('--surface:#faf8f4')
	})

	it('an invalid token fails SAFE to the navy default (never emitted into CSS)', () => {
		const html = renderCertBlock({
			mode: 'banner',
			// injection attempts + malformed values across every token
			theme: {
				accentColor: 'red;}</style>',
				surface: '#ffffffaa',
				cornerRadius: 'calc(1px)',
				fontSlot: 'comic-sans' as ResolvedBlockTheme['fontSlot'],
				accentFg: 'blue' as ResolvedBlockTheme['accentFg'],
			},
			facts: FACTS,
		})
		expect(html).not.toContain('red;}')
		expect(html).not.toContain('#ffffffaa')
		// the injected radius is dropped (the card's own `calc(var(--br,14px) * 0.7)` is a fixed literal)
		expect(html).not.toContain('calc(1px)')
		expect(html).not.toContain('comic-sans')
		expect(html).toContain('--ba:#0a1b3f')
		expect(html).toContain('--ba-fg:#ffffff')
		expect(html).toContain('--br:14px')
		expect(html).toContain(`--cr-bf:var(--bf,${RENDER_BLOCK_FONT_STACKS.sans})`)
	})

	it('the fixed CertREV logo chrome renders on the banner + sidebar headers and the memo credit', () => {
		const banner = renderCertBlock({ mode: 'banner', facts: FACTS })
		const sidebar = renderCertBlock({ mode: 'sidebar', facts: FACTS })
		// every mark tracks its container ink via currentColor (navy header + memo verified lockup)
		expect(banner).toContain('aria-label="CertREV"')
		expect(banner).toContain('<path fill="currentColor"')
		// the memo footer carries the "Verified by CertREV" trust mark; the wordmark rides the body
		// font now (the grotesk --font-wordmark slot is gone from the locked chrome)
		expect(banner).toContain('Verified by')
		expect(banner).not.toContain('font-family:var(--font-wordmark)')
		expect(sidebar).toContain('aria-label="CertREV"')
		expect(sidebar).toContain('<path fill="currentColor"')
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// V2 brand-ink theming (barInk + inkColor) — parity with the portal Liquid/CSS
// engines. The bar/ink wire vars are emitted ONLY when the def sets the token;
// unset ⇒ neither (byte-identical navy default). The FREE-content ink follows the
// brand ink; the LOCKED legal disclosures stay on the navy trust ink.
// ─────────────────────────────────────────────────────────────────────────────

describe('v2 brand-ink theming — barInk + inkColor (portal parity)', () => {
	it('unset ⇒ NEITHER the bar wire vars NOR --certrev-ink is emitted (byte-clean default)', () => {
		const html = renderCertBlock({ mode: 'banner', facts: FACTS })
		expect(html).not.toContain('--certrev-bar-bg:#')
		expect(html).not.toContain('--certrev-bar-fg:#')
		expect(html).not.toContain('--certrev-ink:#')
		// the --cr-ink family is ALWAYS defined; unthemed it is the EXACT navy literals (no color-mix)
		expect(html).toContain('--cr-ink:var(--certrev-ink,#0a1b3f)')
		expect(html).toContain('--cr-ink-sub:rgba(10,27,63,.55)') // === --navy-55
		expect(html).toContain('--cr-ink-soft:rgba(10,27,63,.75)') // === --navy-75
		// the header bar consumes the navy/white fallbacks (byte-identical)
		expect(html).toContain('background:var(--certrev-bar-bg,#0a1b3f);color:var(--certrev-bar-fg,#fff)')
	})

	it('barInk set ⇒ emits --certrev-bar-bg + the DERIVED --certrev-bar-fg (accentFg)', () => {
		const html = renderCertBlock({ mode: 'banner', theme: { ...THEMED, barInk: '#000000' }, facts: FACTS })
		expect(html).toContain('--certrev-bar-bg:#000000')
		// accentFg('#000000') = '#ffffff' (a dark bar takes a white foreground)
		expect(html).toContain('--certrev-bar-fg:#ffffff')
	})

	it('barInkFg is DERIVED at the edge — a LIGHT bar → #141414, and a bogus input barInkFg is ignored', () => {
		const html = renderCertBlock({
			mode: 'floating',
			// pass a WRONG barInkFg — resolveBlockTheme recomputes it from barInk via accentFg
			theme: { ...THEMED, barInk: '#f5f5f5', barInkFg: '#ffffff' },
			facts: FACTS,
		})
		expect(html).toContain('--certrev-bar-bg:#f5f5f5')
		expect(html).toContain('--certrev-bar-fg:#141414') // light bar → dark ink, recomputed
		expect(html).not.toContain('--certrev-bar-fg:#ffffff')
	})

	it('inkColor set ⇒ emits --certrev-ink + derives the muted scale off --cr-ink via color-mix', () => {
		const html = renderCertBlock({ mode: 'banner', theme: { ...THEMED, inkColor: '#1a1a1a' }, facts: FACTS })
		expect(html).toContain('--certrev-ink:#1a1a1a')
		expect(html).toContain('--cr-ink:var(--certrev-ink,#0a1b3f)')
		expect(html).toContain('--cr-ink-sub:color-mix(in srgb,var(--cr-ink) 55%,transparent)')
		expect(html).toContain('--cr-ink-soft:color-mix(in srgb,var(--cr-ink) 75%,transparent)')
	})

	it('FREE content follows the brand ink; LOCKED legal disclosures stay on the navy trust ink', () => {
		const html = renderCertBlock({ mode: 'banner', theme: THEMED_INK, facts: FACTS })
		// FREE — names ride --cr-ink; the memo/bio ride --cr-ink-soft; title/credential/initials --cr-ink-sub
		expect(html).toContain('font-weight:700;color:var(--cr-ink);">Jane Doe, MD') // reviewer name
		expect(html).toContain('color:var(--cr-ink);">The Editorial Team') // author name
		expect(html).toContain('color:var(--cr-ink-soft);white-space:pre-line;">Patients ask me') // memo body
		// LOCKED — the legal/trust text is NEVER repointed to --cr-ink (proves the free/locked boundary)
		expect(html).toContain('color:var(--navy-55);line-height:1.45;margin-top:3px;">Credential verified by CertREV')
		expect(html).toContain(`color:var(--navy-55);margin-top:8px;line-height:1.5;">${CERT_SCOPE_LINE}</div>`) // FTC scope
		expect(html).toContain('color:var(--navy);margin-bottom:11px;">Reviewed by') // section label
		expect(html).toContain('text-transform:uppercase;color:var(--navy-55);"><span>Certified') // certified date + cue row
		// and the legal text never carries a --cr-ink token
		expect(html).not.toMatch(/--cr-ink[^;]*;[^"]*">Credential verified by CertREV/)
		expect(html).not.toMatch(/--cr-ink[^;]*;[^"]*">Independent editorial review/)
	})

	it('barInk themes the pill (floating) — portal parity: the pill follows the BAR, not the accent', () => {
		const html = renderCertBlock({ mode: 'floating', theme: THEMED_INK, facts: FACTS })
		expect(html).toContain('--certrev-bar-bg:#000000')
		expect(html).toContain('background:var(--certrev-bar-bg,#0a1b3f);color:var(--certrev-bar-fg,#fff)')
	})

	it('an invalid barInk / inkColor fails SAFE — dropped, never emitted (bar + ink stay navy)', () => {
		const html = renderCertBlock({
			mode: 'banner',
			theme: {
				...THEMED,
				barInk: 'black;}</style>' as ResolvedBlockTheme['barInk'],
				inkColor: '#12' as ResolvedBlockTheme['inkColor'],
			},
			facts: FACTS,
		})
		expect(html).not.toContain('--certrev-bar-bg:#')
		expect(html).not.toContain('--certrev-ink:#')
		expect(html).not.toContain('black;}')
		// the free-content ink falls back to the navy literals
		expect(html).toContain('--cr-ink-sub:rgba(10,27,63,.55)')
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Escaping — storefront HTML built by hand
// ─────────────────────────────────────────────────────────────────────────────

describe('escaping (this is storefront HTML)', () => {
	const HOSTILE = 'Ev<script>il & "quoted" \'x\''
	const hostileFacts: CertBlockFacts = {
		...FACTS,
		authorName: HOSTILE,
		authorTitle: HOSTILE,
		reviewerName: HOSTILE,
		credential: HOSTILE,
		memo: HOSTILE,
		bio: HOSTILE,
		profileUrl: 'javascript:alert(1)',
		certificateUrl: 'javascript:alert(2)',
	}

	for (const mode of CLAIM_FACES) {
		it(`${mode}: every interpolated fact value is escaped; no raw injection survives`, () => {
			const html = renderCertBlock({ mode, facts: hostileFacts })
			// the injected markup never lands as live HTML
			expect(html).not.toContain('<script>il')
			expect(html).toContain('&lt;script&gt;')
			expect(html).toContain('&amp;')
			expect(html).toContain('&quot;')
			expect(html).toContain('&#39;')
		})
	}

	for (const mode of MODES) {
		it(`${mode}: an unsafe URL scheme is dropped from every href`, () => {
			const html = renderCertBlock({ mode, facts: hostileFacts })
			expect(html).not.toContain('javascript:')
			// the modal hook + a safe fallback href remain
			expect(html).toContain('data-certrev-modal-open')
			expect(html).toContain('href="#"')
		})
	}
})

// ─────────────────────────────────────────────────────────────────────────────
// Reviewer name — honorific stripping (parity with the Liquid twin)
// ─────────────────────────────────────────────────────────────────────────────

describe('reviewer name — honorific stripping (Liquid parity)', () => {
	it('strips a leading honorific for the avatar initials + the first-name link', () => {
		const html = renderCertBlock({ mode: 'banner', facts: { ...FACTS, reviewerName: 'Dr. Marcus Ellison' } })
		// "Dr. Marcus Ellison" → "ME" avatar, never "DM"
		expect(html).toContain('flex-shrink:0;">ME<')
		expect(html).not.toContain('flex-shrink:0;">DM<')
		// "Marcus's Profile", never "Dr.'s Profile" (apostrophe-agnostic)
		expect(html).toMatch(/Marcus.s Profile/)
		expect(html).not.toMatch(/View Dr\..s profile/)
	})

	it('leaves an un-prefixed name untouched', () => {
		const html = renderCertBlock({ mode: 'banner', facts: { ...FACTS, reviewerName: 'Jane Doe' } })
		expect(html).toContain('flex-shrink:0;">JD<')
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// WS-B — placedFields-strict rendering: visibility is the engine's face alone,
// `rung` is a stamp (never a branch), and an ABSENT face grandfathers 0.3.0.
// ─────────────────────────────────────────────────────────────────────────────

/** Every engine field id renderCertBlock knows how to paint. */
const ALL_FIELDS = [
	'label',
	'authorName',
	'authorTitle',
	'bylinePlain',
	'bylineCredentialed',
	'reviewerPhoto',
	'bio',
	'memo',
	'compensationCue',
	'scopeLine',
	'profileLink',
	'certificateLink',
] as const

/** A full claim face (everything placed) — the strict analogue of the grandfathered full-facts render. */
const FULL_FACE: CertBlockFace = { rung: 'credentialed', placedFields: [...ALL_FIELDS] }

/** Drop the observability-only rung attribute so a strict render can be compared to its grandfathered twin. */
function stripRung(html: string): string {
	return html.replace(/ data-certrev-rung="[^"]*"/g, '')
}

/** A face placing everything EXCEPT the given ids. */
function faceExcept(...omit: string[]): CertBlockFace {
	return { rung: 'credentialed', placedFields: ALL_FIELDS.filter((f) => !omit.includes(f)) }
}

describe('WS-B: face-absent grandfathers the 0.3.0 full-facts render byte-for-byte', () => {
	for (const mode of MODES) {
		it(`${mode}: a full-face strict render === the grandfathered render (modulo the rung stamp)`, () => {
			const grandfathered = renderCertBlock({ mode, facts: FACTS })
			const strictFull = renderCertBlock({ mode, facts: FACTS, face: FULL_FACE })
			// the ONLY difference a full face introduces is the observability stamp
			expect(strictFull).toContain('data-certrev-rung="credentialed"')
			expect(stripRung(strictFull)).toBe(grandfathered)
		})
	}

	it('an absent face emits NO rung attribute (grandfather stays byte-clean)', () => {
		expect(renderCertBlock({ mode: 'banner', facts: FACTS })).not.toContain('data-certrev-rung')
	})
})

describe('WS-B: strict placedFields — a minimal face renders only what it placed', () => {
	const MINIMAL: CertBlockFace = { rung: 'minimal', placedFields: ['label', 'profileLink', 'certificateLink'] }

	it('custom: [label, profileLink, certificateLink] paints exactly those, nothing else', () => {
		const html = renderCertBlock({ mode: 'custom', facts: FACTS, face: MINIMAL })
		// the placed fields
		expect(html).toContain('Expert reviewed')
		expect(html).toMatch(/Jane's Profile/)
		expect(html).toContain('>Certificate</a>')
		// everything NOT placed is absent
		expect(html).not.toContain('Written by')
		expect(html).not.toContain('Jane Doe') // no byline / reviewer name
		expect(html).not.toContain('Expert memo')
		expect(html).not.toContain(FACTS.memo)
		expect(html).not.toContain(FACTS.bio)
		expect(html).not.toContain(CERT_SCOPE_LINE)
		expect(html).not.toContain(CREDENTIAL_VERIFIED_ATTRIBUTION)
		expect(visibleText(html)).not.toContain(COMPENSATED_EXPERT_CUE)
		// the custom face still carries the strict + observability markers
		expect(html).toContain('data-certrev-strings-version="2026-07"')
		expect(html).toContain('data-certrev-rung="minimal"')
		expect(html).toContain('data-certrev-mode="custom"')
	})

	it('banner: a minimal face drops the author + reviewer body + compensation cue', () => {
		const html = renderCertBlock({ mode: 'banner', facts: FACTS, face: MINIMAL })
		expect(html).toContain('Expert reviewed') // label header
		expect(html).not.toContain('Written by')
		expect(html).not.toContain('Jane Doe') // no byline placed → no reviewer name anywhere
		expect(html).not.toContain(CREDENTIAL_VERIFIED_ATTRIBUTION)
		expect(visibleText(html)).not.toContain(COMPENSATED_EXPERT_CUE)
		// the memo card still renders because profile/certificate are placed
		expect(html).toMatch(/Jane's Profile/)
		expect(html).toContain('>Certificate</a>')
	})
})

describe('WS-B: a claim face paints all disclosures byte-verbatim', () => {
	const CLAIM: CertBlockFace = {
		rung: 'memo',
		placedFields: [
			'label',
			'bylineCredentialed',
			'reviewerPhoto',
			'memo',
			'compensationCue',
			'scopeLine',
			'profileLink',
			'certificateLink',
		],
	}

	for (const mode of ['banner', 'sidebar', 'custom'] as CertBlockLayout[]) {
		it(`${mode}: the compensation cue + FTC scope line + dated credential verification all render`, () => {
			const html = renderCertBlock({ mode, facts: FACTS, face: CLAIM })
			expect(visibleText(html)).toContain(COMPENSATED_EXPERT_CUE)
			expect(html).toContain(CERT_SCOPE_LINE) // byte-exact incl. the U+2019 apostrophe
			expect(html).toContain(CREDENTIAL_VERIFIED_ATTRIBUTION)
			expect(html).toContain('on Apr 14, 2026')
			// the credentialed byline + its dated verification stay GROUPED, in order
			const iName = html.indexOf('Jane Doe, MD')
			const iAttr = html.indexOf(CREDENTIAL_VERIFIED_ATTRIBUTION)
			const iDate = html.indexOf('on Apr 14, 2026')
			expect(iName).toBeGreaterThanOrEqual(0)
			expect(iAttr).toBeGreaterThan(iName)
			expect(iDate).toBeGreaterThan(iAttr)
		})
	}
})

describe('WS-B: the credentialed byline group is all-or-nothing on `bylineCredentialed`', () => {
	it('sidebar: a PLAIN byline shows the name only — no credential suffix, no attribution/date', () => {
		const face: CertBlockFace = { rung: 'named', placedFields: ['label', 'bylinePlain', 'reviewerPhoto'] }
		const html = renderCertBlock({ mode: 'sidebar', facts: FACTS, face })
		expect(html).toContain('Jane Doe')
		expect(html).not.toContain('Jane Doe, MD')
		expect(html).not.toContain(CREDENTIAL_VERIFIED_ATTRIBUTION)
		expect(html).not.toContain('on Apr 14, 2026')
	})

	it('sidebar: a CREDENTIALED byline fuses the credential + the grouped attribution/date', () => {
		const face: CertBlockFace = { rung: 'credentialed', placedFields: ['label', 'bylineCredentialed'] }
		const html = renderCertBlock({ mode: 'sidebar', facts: FACTS, face })
		expect(html).toContain('Jane Doe, MD')
		expect(html).toContain(CREDENTIAL_VERIFIED_ATTRIBUTION)
		expect(html).toContain('on Apr 14, 2026')
	})
})

describe('WS-B: per-field subtraction drops exactly that markup', () => {
	it('banner: omitting reviewerPhoto removes the reviewer avatar', () => {
		expect(renderCertBlock({ mode: 'banner', facts: FACTS, face: FULL_FACE })).toContain('flex-shrink:0;">JD<')
		expect(renderCertBlock({ mode: 'banner', facts: FACTS, face: faceExcept('reviewerPhoto') })).not.toContain(
			'flex-shrink:0;">JD<',
		)
	})

	it('banner: omitting authorName removes the "Written by" column (and collapses the grid to 1fr)', () => {
		const html = renderCertBlock({ mode: 'banner', facts: FACTS, face: faceExcept('authorName') })
		expect(html).not.toContain('Written by')
		expect(html).toContain('grid-template-columns:1fr;')
	})

	it('banner: omitting memo removes the memo body', () => {
		const html = renderCertBlock({ mode: 'banner', facts: FACTS, face: faceExcept('memo') })
		expect(html).not.toContain('Expert memo')
		expect(html).not.toContain(FACTS.memo)
		// but the trust footer + links survive (profile/certificate still placed)
		expect(html).toContain('Verified by')
	})

	it('banner: omitting bio removes the hidden bio accordion', () => {
		const html = renderCertBlock({ mode: 'banner', facts: FACTS, face: faceExcept('bio') })
		expect(html).not.toContain(FACTS.bio)
		expect(html).not.toContain('certrev-cert__bio')
	})

	it('sidebar: omitting BOTH links removes the entire footer grid', () => {
		const html = renderCertBlock({
			mode: 'sidebar',
			facts: FACTS,
			face: faceExcept('profileLink', 'certificateLink'),
		})
		expect(html).not.toContain('View Profile')
		expect(html).not.toContain('>Certificate</a>')
		expect(html).not.toContain('border-top:1px solid var(--navy-10);')
	})

	it('sidebar: a lone profile link drops its border-right and collapses the grid to 1fr', () => {
		const html = renderCertBlock({ mode: 'sidebar', facts: FACTS, face: faceExcept('certificateLink') })
		expect(html).toContain('View Profile')
		expect(html).not.toContain('>Certificate</a>')
		expect(html).toContain('grid-template-columns:1fr;border-top')
		expect(html).not.toContain('border-right:1px solid var(--navy-10);')
	})
})

describe('WS-B: custom face — a compliant vertical stack in canonical order', () => {
	it('renders placed fields top-to-bottom: label → reviewer → memo → disclosures → actions', () => {
		const html = renderCertBlock({ mode: 'custom', facts: FACTS, face: FULL_FACE })
		const order = [
			html.indexOf('Expert reviewed'), // 1. label
			html.indexOf('Written by'), // 2. author
			html.indexOf('Jane Doe, MD'), // 3. reviewer byline
			html.indexOf(FACTS.bio), // 4. bio
			html.indexOf(FACTS.memo), // 5. memo
			html.indexOf(CERT_SCOPE_LINE), // 6. disclosures
			html.indexOf("Jane's Profile"), // 7. actions
		]
		for (const i of order) expect(i).toBeGreaterThanOrEqual(0)
		const sorted = [...order].sort((a, b) => a - b)
		expect(order).toEqual(sorted)
		// the modal + strings + rung markers ride the same building blocks as the locked layouts
		expect(html).toContain('data-certrev-modal-open')
		expect(html).toContain('data-certrev-strings-version="2026-07"')
		expect(html).toContain('data-certrev-rung="credentialed"')
		// it is a single flex-column stack
		expect(html).toContain('flex-direction:column;gap:14px;')
	})
})

describe('WS-B: `rung` is a stamp, never a branch — it never changes visibility', () => {
	for (const mode of ['banner', 'sidebar', 'floating', 'custom'] as CertBlockLayout[]) {
		it(`${mode}: two faces with the same placedFields but different rung render identical HTML (modulo the rung attr)`, () => {
			const placedFields = [...ALL_FIELDS]
			const a = renderCertBlock({ mode, facts: FACTS, face: { rung: 'minimal', placedFields } })
			const b = renderCertBlock({ mode, facts: FACTS, face: { rung: 'credentialed', placedFields } })
			expect(a).not.toBe(b) // the rung attr differs
			expect(stripRung(a)).toBe(stripRung(b)) // …but nothing else does
		})
	}
})
