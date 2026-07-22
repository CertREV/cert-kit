/**
 * ─────────────────────────────────────────────────────────────────────────────
 * renderCertBlock — the LOCKED CertREV cert design, as an SSR-safe HTML string
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Paints the owner-approved cert render (decision 2026-07-17) in one of three
 * placement modes — `banner`, `sidebar`, `floating` — from RESOLVED theme tokens +
 * the cert facts. It returns a self-contained HTML string that renders with ZERO
 * JavaScript (the CertREV modal + the reviewer-bio accordion are progressive
 * enhancement, wired by the shared embed script via the `data-certrev-*` hooks).
 *
 * WHY A STRING (not a React component): the block is emitted into storefront HTML
 * across every render surface (Shopify Liquid, WordPress PHP, the JS engine, and
 * this headless twin). A pure string renderer — like `renderBadgeHtml` — runs on
 * every runtime the main entry targets (edge / Workers / server) with no React, no
 * DOM, no Node builtins.
 *
 * THEMING: the reference is variable-driven. This emits the guide's CSS-var theming
 * hooks on the ROOT element so the block is self-contained on a storefront that does
 * NOT define the guide's `:root` — the accent (`--ba`), its auto-contrast ink
 * (`--ba-fg`), the corner radius (`--br`), the body font (`--bf`) and surface
 * (`--surface`) come from the resolved theme; the fixed mono label font (`--font-mono`)
 * is a LOCKED literal (guide "the lock is legal, not aesthetic"). Names, the memo quote,
 * disclosures, links, and the "CertREV" wordmark ride the body font; the serif/grotesk
 * slots remain reachable only as a brand's themeable body-font choice.
 *
 * V2 BRAND-INK (Phase 1, parity with the portal Liquid/CSS engines): a brand may lift TWO
 * more chrome surfaces off their hardcoded navy literals — the header/seal bar (`barInk`,
 * with its auto-contrast `barInkFg`) and the FREE-content trust ink (`inkColor`: reviewer/
 * author names, title, credential, bio, initials + the derived muted scale). These reach
 * the root as the exact `--certrev-bar-bg` / `--certrev-bar-fg` / `--certrev-ink` wire vars
 * the Shopify/WordPress engines emit — but ONLY when the def sets them, so a no-def face is
 * byte-identical. The bar consumes `var(--certrev-bar-bg, #0a1b3f)` / `var(--certrev-bar-fg,
 * #fff)`; the free content consumes the `--cr-ink` family (`--cr-ink` = `var(--certrev-ink,
 * #0a1b3f)`, with `-sub`/`-soft` muted derivations). The LOCKED trust text — the compensation
 * cue, the FTC scope line, "Credential verified by CertREV", the WRITTEN/REVIEWED BY labels,
 * and the certified date — NEVER follows `inkColor`; it stays on the navy `--navy*` scale so a
 * brand ink can never drag legally load-bearing text below its floor.
 *
 * COMPLIANCE (LOCKED, non-negotiable): the three material disclosures always render
 * on a CLAIM face (banner + sidebar) — the compensation cue, the byte-exact FTC
 * scope line, and the dated credential verification, which stays GROUPED with the
 * credential (`<name>, <credential>` → "Credential verified by CertREV" → "on
 * <date>"). The `floating` pill makes no claim (it only labels + links to the
 * modal), so it carries no disclosures — matching the locked reference.
 *
 * SECURITY: this is storefront HTML built by hand (no JSX auto-escaping), so EVERY
 * interpolated value is escaped — `escapeHtml` for content, `escapeAttribute` for
 * attribute values, `safeHttpUrl` for hrefs. Theme tokens are re-validated
 * (`resolveBlockTheme`) and only ever emitted as strict hex / length / enum-stack.
 *
 * PLACED-FIELDS STRICTNESS (WS-B): Visibility is decided by the engine's
 * `placedFields` alone; `rung` is a stamp, never a branch; an absent face
 * grandfathers the 0.3.0 full-facts render byte-for-byte.
 */

import { escapeAttribute, escapeHtml, safeHttpUrl } from './escape.js'
import { formatDate } from './format.js'
import {
	CERT_SCOPE_LINE,
	CERT_STRINGS_VERSION,
	COMPENSATED_EXPERT_CUE,
	CREDENTIAL_VERIFIED_ATTRIBUTION,
	RENDER_BLOCK_FONT_STACKS,
	type ResolvedBlockTheme,
	resolveBlockTheme,
} from './render-def.js'

/** The three LOCKED placement faces. */
export type CertBlockMode = 'banner' | 'sidebar' | 'floating'

/** All layouts renderCertBlock can paint: the three locked modes + the engine's free-composition face. */
export type CertBlockLayout = CertBlockMode | 'custom'

/**
 * The portal engine's resolved face (assertCompliantRender output). `rung` is
 * INFORMATIONAL ONLY — stamped as data, NEVER branched on for visibility.
 * `placedFields` is the single source of what renders. Plain strings (not a closed
 * union) so a future engine field id degrades to "not painted here" instead of a
 * type break.
 */
export interface CertBlockFace {
	readonly rung: string
	readonly placedFields: readonly string[]
}

/**
 * The cert facts + LOCKED display strings a face renders. Facts are escaped; the
 * three locked strings (`compensationCue`, `scopeLine`, `credentialLine`) are
 * byte-verbatim per the CertREV Display Guide and default to the mirrored constants
 * when a caller omits them — so the compliance baseline is exact even if unsupplied.
 */
export interface CertBlockFacts {
	/** The content author (the "Written by" column). */
	readonly authorName: string
	/** The author's subtitle (e.g. "Editorial"). Omitted when absent. */
	readonly authorTitle?: string
	/** The reviewing expert's display name, WITHOUT the credential (e.g. "Jane Doe"). */
	readonly reviewerName: string
	/** The reviewer's credential abbreviation (e.g. "MD"). Empty → name-only. */
	readonly credential: string
	/** ISO instant CertREV verified the CREDENTIAL (the dated verification date). */
	readonly credentialVerifiedAt: string
	/** ISO instant the article was certified (the "Certified <date>" footer). */
	readonly certifiedAt: string
	/** The expert's memo (rendered as the serif blockquote). */
	readonly memo: string
	/** The expert's bio (banner accordion / sidebar paragraph). Omitted when absent. */
	readonly bio?: string
	/** The expert profile URL (the "Profile" link + modal `expert` hook). */
	readonly profileUrl: string
	/** The certificate URL (the "Certificate" link + modal hook). */
	readonly certificateUrl: string
	/** LOCKED — the compensation cue. Default: `COMPENSATED_EXPERT_CUE`. */
	readonly compensationCue?: string
	/** LOCKED — the byte-exact FTC scope line. Default: `CERT_SCOPE_LINE`. */
	readonly scopeLine?: string
	/** LOCKED — the verification attribution. Default: `CREDENTIAL_VERIFIED_ATTRIBUTION`. */
	readonly credentialLine?: string
}

/** The full input to `renderCertBlock`. */
export interface RenderCertBlockInput {
	readonly mode: CertBlockLayout
	/** RESOLVED theme tokens (the portal bakes these). Absent/invalid tokens fall back to navy. */
	readonly theme?: Partial<ResolvedBlockTheme>
	readonly facts: CertBlockFacts
	/**
	 * OPTIONAL engine face. ABSENT ⇒ grandfathered full-facts render, byte-identical
	 * to 0.3.0 (published callers unaffected). PRESENT ⇒ strict placedFields render.
	 */
	readonly face?: CertBlockFace
	/**
	 * BANNER memo placement (POR-10741 — first-class split, retires the CertReviewCard
	 * string-hack). Default `'full'` = header card + memo card in ONE root, BYTE-IDENTICAL
	 * to prior behavior. `'header'` / `'memo'` render ONLY that card in its own themed root,
	 * so a headless exporter can place the memo as its OWN block under the article body
	 * (the "banner → body → memo" layout) WITHOUT string-splitting the rendered HTML — and
	 * without duplicating the options payload (each block carries only what its card needs).
	 * Ignored outside banner mode.
	 */
	readonly part?: 'full' | 'header' | 'memo'
}

// ─────────────────────────────────────────────────────────────────────────────
// The CertREV logo — the fixed 4-chevron mark (owner decision 2026-07-17: the logo
// IS permitted on the article face). Path data is byte-exact to the locked reference.
// ─────────────────────────────────────────────────────────────────────────────

const LOGO_PATHS = [
	'M67.59 221.77L138.77 292.95C145.8 299.98 145.8 311.44 138.77 318.47L123.02 334.22C116 341.25 104.54 341.25 97.5 334.22L26.32 263.04C19.29 256.01 19.29 244.55 26.32 237.52L42.07 221.77C49.1 214.74 60.56 214.74 67.59 221.77Z',
	'M96.79 335.08L81.12 319.42C73.8 312.1 73.8 300.23 81.12 292.92L315.88 58.16C323.2 50.85 335.06 50.85 342.38 58.16L358.04 73.83C365.36 81.14 365.36 93.01 358.04 100.33L123.29 335.08C115.97 342.4 104.1 342.4 96.79 335.08Z',
	'M203.5 335.14L187.83 319.48C180.52 312.16 180.52 300.29 187.83 292.98L315.88 164.93C323.2 157.62 335.06 157.62 342.38 164.93L358.04 180.6C365.36 187.92 365.36 199.78 358.04 207.1L230 335.14C222.68 342.46 210.82 342.46 203.5 335.14Z',
	'M310.21 335.2L294.54 319.54C287.23 312.22 287.23 300.36 294.54 293.04L315.88 271.71C323.2 264.39 335.06 264.39 342.38 271.71L358.04 287.37C365.36 294.69 365.36 306.55 358.04 313.87L336.71 335.2C329.39 342.52 317.53 342.52 310.21 335.2Z',
]

/**
 * The 4-chevron CertREV mark at `size`px, always filled `currentColor` so it tracks
 * its container's ink — white on the hardcoded-navy header, and the muted navy-55 of
 * the memo footer's "Verified by CertREV" lockup (it sits on the white surface).
 */
function logo(size: number): string {
	return (
		`<svg viewBox="0 0 375 375" width="${size}" height="${size}" style="flex-shrink:0" aria-label="CertREV">` +
		LOGO_PATHS.map((d) => `<path fill="currentColor" d="${d}"></path>`).join('') +
		`</svg>`
	)
}

/** The bio-accordion caret (progressive-enhancement affordance). */
const CARET =
	`<span class="certrev-cert__caret" style="display:inline-flex;vertical-align:middle;margin-left:4px;color:var(--navy-35);transition:transform .18s ease-out;">` +
	`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></span>`

// ─────────────────────────────────────────────────────────────────────────────
// Small pure helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip a leading honorific ("Dr. Jane Smith" → "Jane Smith") so the initials + first-name token don't
 * capture it — matches the Liquid twin, which removes a matched honorific so "Dr. Marcus Ellison" yields
 * the "ME" avatar + "Marcus's profile", never "DM" / "Dr.'s profile".
 */
function stripHonorific(name: string): string {
	return (
		name
			.trim()
			.replace(/^(dr|prof|professor|mr|mrs|ms|mx|rev|sir|dame)\.?\s+/i, '')
			.trim() || name.trim()
	)
}

/** "Jane Doe" → "JD"; "Dr. Marcus Ellison" → "ME" (first letter of the first two words, honorific stripped). */
function initials(name: string): string {
	const parts = stripHonorific(name).split(/\s+/).filter(Boolean)
	const chars = parts
		.slice(0, 2)
		.map((p) => p[0] ?? '')
		.join('')
	return (chars || '?').toUpperCase()
}

/** The first name token (for "View Jane's profile") — honorific stripped. */
function firstNameOf(name: string): string {
	const clean = stripHonorific(name)
	return clean.split(/\s+/)[0] || clean
}

/**
 * A LOCKED display string: use the caller's value ONLY when it is a non-blank
 * string, else the byte-verbatim constant. The three compliance strings
 * (compensation cue, scope line, credential attribution) are undroppable — an
 * omitted OR empty/whitespace override must never blank the disclosure.
 */
function locked(supplied: string | undefined, constant: string): string {
	return supplied?.trim() ? supplied : constant
}

/** Field-placement predicate every renderer consults. */
type PlacedTest = (fieldId: string) => boolean

/**
 * Absent face ⇒ constant-true (the grandfather path: every conditional collapses to
 * today's markup, guaranteeing byte-identity with 0.3.0). Present ⇒ Set membership.
 */
function placedTester(face?: CertBlockFace): PlacedTest {
	if (!face) return () => true
	const set = new Set(face.placedFields)
	return (id) => set.has(id)
}

/**
 * The memo/custom action-link stamp style — the JetBrains-mono uppercase lockup that
 * matches the badge footer (Owen 2026-07-17); navy so it still reads as an action.
 */
const STAMP_LINK_STYLE =
	'font-family:var(--font-mono);font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--navy);text-decoration:none;cursor:pointer;'

/** A round avatar tile with the given initials. */
function avatar(text: string, size: number, fontSize: number): string {
	return (
		`<div style="width:${size}px;height:${size}px;border-radius:50%;background:var(--stone);color:var(--cr-ink-sub);` +
		`display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-weight:700;font-size:${fontSize}px;flex-shrink:0;">` +
		`${escapeHtml(text)}</div>`
	)
}

/** "Jane Doe, MD" (or just the name when there is no credential) — escaped. */
function nameWithCredential(name: string, credential: string): string {
	const n = escapeHtml(name)
	return credential ? `${n}, ${escapeHtml(credential)}` : n
}

/** The reviewer profile link (carries the modal `expert` hook + a real href fallback). */
function profileLink(url: string, inner: string, style: string): string {
	const href = safeHttpUrl(url) ?? '#'
	return `<a href="${escapeAttribute(href)}" data-certrev-modal-open="expert" rel="noopener" style="${style}">${inner}</a>`
}

/** The certificate link (carries the modal hook + a real href fallback). */
function certificateLink(url: string, inner: string, style: string): string {
	const href = safeHttpUrl(url) ?? '#'
	return `<a href="${escapeAttribute(href)}" data-certrev-modal-open rel="noopener" style="${style}">${inner}</a>`
}

/**
 * The GROUPED dated credential verification (LOCKED requirement): the credentialed
 * name, then the attribution line, then "on <date>" — one block, order preserved.
 * `withAccordion` adds the bio caret + hidden bio (banner) as progressive enhancement.
 */
function verificationBlock(facts: CertBlockFacts, withAccordion: boolean, placed: PlacedTest): string {
	const showCredentialed = placed('bylineCredentialed')
	const showName = placed('bylinePlain') || showCredentialed
	// Nothing placed ⇒ empty (the caller drops the wrapping toggle div).
	if (!showName) return ''
	const credentialLine = locked(facts.credentialLine, CREDENTIAL_VERIFIED_ATTRIBUTION)
	const verified = formatDate(facts.credentialVerifiedAt) ?? escapeHtml(facts.credentialVerifiedAt)
	const showBio = withAccordion && placed('bio') && !!facts.bio
	const caret = showBio ? CARET : ''
	const nameSize = withAccordion ? '15px' : '16px'
	const muteSize = withAccordion ? '13px' : '12.5px'
	const bio = showBio
		? `<div class="certrev-cert__bio" hidden style="display:none;margin-top:8px;font-size:12.5px;line-height:1.5;color:var(--cr-ink-soft);">${escapeHtml(facts.bio ?? '')}</div>`
		: ''
	// The credential suffix + the GROUPED attribution/date lines are all-or-nothing on
	// `bylineCredentialed`; a plain byline shows the name only.
	const nameInner = showCredentialed
		? nameWithCredential(facts.reviewerName, facts.credential)
		: escapeHtml(facts.reviewerName)
	const attribution = showCredentialed
		? `<div style="font-size:${muteSize};color:var(--navy-55);line-height:1.45;margin-top:3px;">${escapeHtml(credentialLine)}</div>` +
			`<div style="font-size:${muteSize};color:var(--navy-55);line-height:1.35;">on ${verified}</div>`
		: ''
	return (
		`<div>` +
		`<div style="font-size:${nameSize};font-weight:700;color:var(--cr-ink);">${nameInner}${caret}</div>` +
		attribution +
		bio +
		`</div>`
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// The root wrapper — sets the guide's CSS vars so the block is self-contained
// ─────────────────────────────────────────────────────────────────────────────

function rootStyle(theme: ResolvedBlockTheme): string {
	// Data-bearing theme tokens are already strict-validated (hex / length / literal
	// ink); the font is a controlled enum → stack literal. The navy tints + fixed
	// label/serif/wordmark fonts are LOCKED literals.
	const ink = theme.inkColor
	return [
		`--ba:${theme.accentColor}`,
		`--ba-fg:${theme.accentFg}`,
		`--br:${theme.cornerRadius}`,
		// The body font is a host-overridable HOOK (POR-10742): `--cr-bf` resolves a host-page
		// `--bf` (set on any ancestor) with the fontSlot stack as the FALLBACK — so a storefront
		// can theme the card font via plain CSS, no `!important` (the old inline `--bf:<stack>`
		// declaration shadowed a host `--bf`). Unset ⇒ resolves to the stack ⇒ byte-identical render.
		`--cr-bf:var(--bf,${RENDER_BLOCK_FONT_STACKS[theme.fontSlot]})`,
		`--surface:${theme.surface}`,
		// v2 chrome-ink (Phase 1): the header/seal bar FILL + its auto-contrast FOREGROUND — the exact
		// `--certrev-bar-*` wire vars the Shopify/WP engines emit, present ONLY on a themed bar. ABSENT ⇒
		// the consumers' `var(--certrev-bar-bg, #0a1b3f)` / `var(--certrev-bar-fg, #fff)` navy/white
		// fallbacks resolve — byte-identical to the un-themed bar.
		...(theme.barInk && theme.barInkFg
			? [`--certrev-bar-bg:${theme.barInk}`, `--certrev-bar-fg:${theme.barInkFg}`]
			: []),
		`--navy:#0a1b3f`,
		`--navy-06:rgba(10,27,63,.06)`,
		`--navy-10:rgba(10,27,63,.10)`,
		`--navy-35:rgba(10,27,63,.35)`,
		`--navy-55:rgba(10,27,63,.55)`,
		`--navy-75:rgba(10,27,63,.75)`,
		`--stone:#ece9e1`,
		// v2 chrome-ink (Phase 1): the FREE-content trust-ink family (names/title/credential/bio/
		// initials). `--certrev-ink` is the wire var, emitted ONLY when the def sets `inkColor`; `--cr-ink`
		// consumes it with a navy fallback, so an un-inkColor'd face resolves to navy. The `-sub`/`-soft`
		// muted scale is the EXACT navy literal when unthemed (byte-identical, zero color-mix dependency)
		// and a color-mix derivation off the brand ink when themed. The LOCKED trust text keeps `--navy*`
		// and never this family, so a brand ink can never touch a legal disclosure.
		...(ink ? [`--certrev-ink:${ink}`] : []),
		`--cr-ink:var(--certrev-ink,#0a1b3f)`,
		`--cr-ink-sub:${ink ? 'color-mix(in srgb,var(--cr-ink) 55%,transparent)' : 'rgba(10,27,63,.55)'}`,
		`--cr-ink-soft:${ink ? 'color-mix(in srgb,var(--cr-ink) 75%,transparent)' : 'rgba(10,27,63,.75)'}`,
		`--font-mono:${RENDER_BLOCK_FONT_STACKS.mono}`,
		`font-family:var(--cr-bf)`,
		`color:var(--navy)`,
	].join(';')
}

function root(mode: CertBlockLayout, theme: ResolvedBlockTheme, inner: string, face?: CertBlockFace): string {
	// The rung is an OBSERVABILITY stamp for the crawl monitor — only emitted when a
	// face is present, so the grandfathered (face-absent) output stays byte-identical.
	const rungAttr = face ? ` data-certrev-rung="${escapeAttribute(face.rung)}"` : ''
	return (
		`<div class="certrev-cert certrev-cert--${mode}" data-certrev-mode="${mode}" ` +
		`data-certrev-strings-version="${CERT_STRINGS_VERSION}"${rungAttr} style="${rootStyle(theme)}">${inner}</div>`
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode 1 — BANNER: a certification header card + a separate expert-memo card
// ─────────────────────────────────────────────────────────────────────────────

function bannerHeaderCard(facts: CertBlockFacts, placed: PlacedTest): string {
	const compensationCue = locked(facts.compensationCue, COMPENSATED_EXPERT_CUE)
	const certified = formatDate(facts.certifiedAt) ?? escapeHtml(facts.certifiedAt)
	const subtitle =
		placed('authorTitle') && facts.authorTitle
			? `<div style="font-size:13px;color:var(--cr-ink-sub);">${escapeHtml(facts.authorTitle)}</div>`
			: ''
	// A subtle right-aligned arrow opens the certificate: the whole navy bar is the mouse
	// target (data-certrev-modal-open); this focusable <a> is the keyboard / SR / no-JS control.
	const certHref = safeHttpUrl(facts.certificateUrl) ?? '#'
	const headerArrow =
		`<a href="${escapeAttribute(certHref)}" data-certrev-modal-open rel="noopener" aria-label="View certificate" ` +
		`style="display:inline-flex;align-items:center;flex-shrink:0;color:inherit;opacity:.72;text-decoration:none;">` +
		`<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></a>`
	// navy header — the trust bar stays fixed navy (accent theming is Phase B); mark + eyebrow + cert arrow
	const header = placed('label')
		? `<div data-certrev-modal-open style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:15px 22px;background:var(--certrev-bar-bg,#0a1b3f);color:var(--certrev-bar-fg,#fff);cursor:pointer;">` +
			`<span style="display:inline-flex;align-items:center;gap:11px;font-family:var(--font-mono);font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;">${logo(20)} Expert reviewed</span>` +
			headerArrow +
			`</div>`
		: ''
	// written by — muted label (navy-35); the whole author column is gated on `authorName`
	const showAuthor = placed('authorName')
	const authorColumn = showAuthor
		? `<div>` +
			`<div style="font-family:var(--font-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--navy-35);margin-bottom:11px;">Written by</div>` +
			`<div style="display:flex;align-items:center;gap:12px;">${avatar(initials(facts.authorName), 42, 12)}` +
			`<div><div style="font-size:15px;font-weight:700;color:var(--cr-ink);">${escapeHtml(facts.authorName)}</div>${subtitle}</div></div>` +
			`</div>`
		: ''
	// grid collapses to a single reviewer column when the author is absent
	const gridCols = showAuthor ? '1fr 1fr' : '1fr'
	// reviewed by — emphasized label (navy, 700): the certification's authority voice
	const reviewerAvatar = placed('reviewerPhoto') ? avatar(initials(facts.reviewerName), 42, 12) : ''
	const reviewerBlock = verificationBlock(facts, true, placed)
	const revToggle = reviewerBlock
		? `<div class="certrev-cert__rev" role="button" tabindex="0" aria-expanded="false" data-certrev-bio-toggle aria-label="Read more about ${escapeAttribute(facts.reviewerName)}" style="display:flex;align-items:flex-start;gap:12px;cursor:pointer;border-radius:8px;transition:opacity .15s;">` +
			`${reviewerAvatar}${reviewerBlock}` +
			`</div>`
		: ''
	// "Certified <date>" is card chrome (renders with the card); the cue is engine-placed
	const cueSpan = placed('compensationCue') ? `<span>${escapeHtml(compensationCue)}</span>` : ''
	return (
		`<div style="border:1px solid var(--navy-10);border-radius:calc(var(--br,14px) * 0.7);overflow:hidden;font-family:var(--cr-bf);">` +
		header +
		`<div style="padding:22px 24px 18px;">` +
		`<div style="display:grid;grid-template-columns:${gridCols};gap:22px;">` +
		authorColumn +
		`<div>` +
		`<div style="font-family:var(--font-mono);font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--navy);margin-bottom:11px;">Reviewed by</div>` +
		revToggle +
		`</div>` +
		`</div>` +
		// hairline + mono footer — "Certified <date>" + "Compensated expert", UNIFORM navy-55
		`<div style="height:1px;background:var(--navy-10);margin:16px 0 14px;"></div>` +
		`<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-family:var(--font-mono);font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--navy-55);">` +
		`<span>Certified <span style="margin-left:8px;">${certified}</span></span>` +
		cueSpan +
		`</div>` +
		`</div>` +
		`</div>`
	)
}

function bannerMemoCard(facts: CertBlockFacts, placed: PlacedTest): string {
	const scopeLine = locked(facts.scopeLine, CERT_SCOPE_LINE)
	const credTail =
		placed('bylineCredentialed') && facts.credential
			? `<span style="color:var(--cr-ink-sub);">, ${escapeHtml(facts.credential)}</span>`
			: ''
	const first = firstNameOf(facts.reviewerName)
	// The eyebrow + reviewer name row + memo quote are grouped under `memo`; the avatar
	// inside it is gated on `reviewerPhoto`.
	const memoAvatar = placed('reviewerPhoto') ? avatar(initials(facts.reviewerName), 46, 13) : ''
	const memoSection = placed('memo')
		? `<div style="font-family:var(--font-mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--navy-55);margin-bottom:14px;">Expert memo</div>` +
			`<div style="display:flex;gap:15px;">${memoAvatar}` +
			`<div style="flex:1;min-width:0;">` +
			`<div style="font-size:16px;line-height:1.2;color:var(--cr-ink);"><span style="font-weight:700;">${escapeHtml(facts.reviewerName)}</span>${credTail}</div>` +
			// Readable, UPRIGHT DM Sans quote (Owen 2026-07-17: the display-serif italic hurt legibility);
			// pre-line preserves the reviewer's paragraph breaks. No left accent bar (matches the guide).
			`<p style="margin:11px 0 14px;font-size:15.5px;line-height:1.6;color:var(--cr-ink-soft);white-space:pre-line;">${escapeHtml(facts.memo)}</p>` +
			`</div>` +
			`</div>`
		: ''
	// The memo footer's profile/certificate actions read as the JetBrains-mono uppercase stamp
	// that matches the badge footer lockup (Owen 2026-07-17) — navy, so they still read as actions.
	const profile = placed('profileLink')
		? profileLink(facts.profileUrl, `${escapeHtml(first)}'s Profile`, STAMP_LINK_STYLE)
		: ''
	const certificate = placed('certificateLink')
		? certificateLink(facts.certificateUrl, 'Certificate', STAMP_LINK_STYLE)
		: ''
	const scope = placed('scopeLine')
		? `<div style="font-size:13px;color:var(--navy-55);margin-top:8px;line-height:1.5;">${escapeHtml(scopeLine)}</div>`
		: ''
	return (
		`<div style="border:1px solid var(--navy-10);border-radius:calc(var(--br,14px) * 0.7);padding:24px;font-family:var(--cr-bf);">` +
		memoSection +
		// footer hairline + one trust row: "Verified by CertREV" left, the two actions right
		`<div style="height:1px;background:var(--navy-10);margin:18px 0 14px;"></div>` +
		`<div style="display:flex;align-items:center;justify-content:space-between;gap:16px 22px;flex-wrap:wrap;">` +
		`<div style="display:inline-flex;align-items:center;gap:9px;font-family:var(--font-mono);font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--navy-55);">${logo(15)}<span>Verified by <span style="font-weight:700;color:var(--navy);">CertREV</span></span></div>` +
		`<div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;">` +
		profile +
		(profile && certificate
			? '<span aria-hidden="true" style="font-family:var(--font-mono);font-size:10.5px;color:var(--navy-35);">|</span>'
			: '') +
		certificate +
		`</div>` +
		`</div>` +
		scope +
		`</div>`
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode 2 — SIDEBAR: a reviewer card pinned beside the article body
// ─────────────────────────────────────────────────────────────────────────────

function sidebarCard(facts: CertBlockFacts, placed: PlacedTest): string {
	const compensationCue = locked(facts.compensationCue, COMPENSATED_EXPERT_CUE)
	const scopeLine = locked(facts.scopeLine, CERT_SCOPE_LINE)
	const header = placed('label')
		? `<div style="display:flex;align-items:center;justify-content:center;gap:10px;padding:12px;background:var(--certrev-bar-bg,#0a1b3f);color:var(--certrev-bar-fg,#fff);font-family:var(--font-mono);font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;">${logo(18)} Expert reviewed</div>`
		: ''
	const sidebarAvatar = placed('reviewerPhoto') ? avatar(initials(facts.reviewerName), 46, 13) : ''
	const bioPara =
		placed('bio') && facts.bio
			? `<p style="font-size:14px;line-height:1.55;color:var(--cr-ink-soft);margin:16px 0 0;">${escapeHtml(facts.bio)}</p>`
			: ''
	const blockquote = placed('memo')
		? `<blockquote style="margin:16px 0 0;padding-left:16px;border-left:3px solid var(--ba,#0a1b3f);font-size:15px;line-height:1.5;color:var(--cr-ink-soft);white-space:pre-line;">${escapeHtml(facts.memo)}</blockquote>`
		: ''
	// Disclosure row: cue + ` · ` + scope; the separator only when BOTH land, the row only when either does.
	const cueEl = placed('compensationCue')
		? `<span style="font-family:var(--font-mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;">${escapeHtml(compensationCue)}</span>`
		: ''
	const scopeEl = placed('scopeLine') ? escapeHtml(scopeLine) : ''
	const disclosure =
		cueEl || scopeEl
			? `<div style="font-size:12.5px;line-height:1.5;color:var(--navy-55);margin-top:16px;">${cueEl}${cueEl && scopeEl ? ' · ' : ''}${scopeEl}</div>`
			: ''
	// Footer grid: each cell gated on its link; `1fr` (and no border-right on a lone profile) when only one.
	const hasProfile = placed('profileLink')
	const hasCert = placed('certificateLink')
	const profileBorder = hasProfile && hasCert ? 'border-right:1px solid var(--navy-10);' : ''
	const profileCell = hasProfile
		? profileLink(
				facts.profileUrl,
				'View Profile',
				`text-align:center;padding:14px;font-size:14px;font-weight:700;color:var(--navy);text-decoration:none;${profileBorder}cursor:pointer;`,
			)
		: ''
	const certCell = hasCert
		? certificateLink(
				facts.certificateUrl,
				'View Certificate',
				'text-align:center;padding:14px;font-size:14px;font-weight:700;color:var(--navy);text-decoration:none;cursor:pointer;',
			)
		: ''
	const footer =
		hasProfile || hasCert
			? `<div style="display:grid;grid-template-columns:${hasProfile && hasCert ? '1fr 1fr' : '1fr'};border-top:1px solid var(--navy-10);">` +
				profileCell +
				certCell +
				`</div>`
			: ''
	return (
		`<div style="background:var(--surface);border:1px solid var(--navy-10);border-radius:var(--br,14px);overflow:hidden;box-shadow:0 4px 18px var(--navy-06);font-family:var(--cr-bf);">` +
		header +
		`<div style="padding:20px;">` +
		`<div style="display:flex;align-items:flex-start;gap:13px;">${sidebarAvatar}${verificationBlock(facts, false, placed)}</div>` +
		bioPara +
		blockquote +
		disclosure +
		`</div>` +
		footer +
		`</div>`
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode 3 — FLOATING: a compact pinned pill (a modal pointer, NOT a claim face)
// ─────────────────────────────────────────────────────────────────────────────

function floatingPill(facts: CertBlockFacts, placed: PlacedTest): string {
	const label = placed('label')
		? `<span style="font-family:var(--font-mono);font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;opacity:.75;">Expert reviewed:</span>`
		: ''
	const profile = placed('profileLink')
		? profileLink(
				facts.profileUrl,
				'Profile',
				'font-size:14px;font-weight:700;text-decoration:underline;text-underline-offset:3px;color:inherit;cursor:pointer;',
			)
		: ''
	const cert = placed('certificateLink')
		? certificateLink(
				facts.certificateUrl,
				'Certificate',
				'font-size:14px;font-weight:700;text-decoration:underline;text-underline-offset:3px;color:inherit;cursor:pointer;',
			)
		: ''
	// The `·` separator only when BOTH links land.
	const sep = placed('profileLink') && placed('certificateLink') ? `<span style="opacity:.5;">·</span>` : ''
	return (
		// v2 chrome-ink (Phase 1): the minimal-tier pill is the SAME trust surface as the header bar — it
		// follows barInk/barInkFg so a themed brand's compact format matches its card (portal parity; the
		// portal `.certrev-pill` reads the same `--certrev-bar-*` vars). Navy/white fallbacks ⇒ byte-identical
		// when unthemed. NOTE: this moves the pill OFF the accent (`--ba`) it used pre-v2 — see the port report.
		`<div class="certrev-cert__pill" style="display:inline-flex;align-items:center;gap:14px;padding:12px 22px;border-radius:999px;background:var(--certrev-bar-bg,#0a1b3f);color:var(--certrev-bar-fg,#fff);box-shadow:0 10px 26px var(--navy-10);">` +
		label +
		profile +
		sep +
		cert +
		`</div>`
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode 4 — CUSTOM: the engine's free-composition face — ONE vertical stack of
// EXACTLY the placed fields, in canonical order, from the SAME escaped / locked() /
// data-certrev-* building blocks the locked layouts use (so the ftc-guard + crawl
// monitor see identical markers). Never consults `rung`.
// ─────────────────────────────────────────────────────────────────────────────

function renderCustomFace(facts: CertBlockFacts, placed: PlacedTest): string {
	const parts: string[] = []

	// 1. label — the navy "Expert reviewed" header bar (sidebar's header markup)
	if (placed('label')) {
		parts.push(
			`<div style="display:flex;align-items:center;justify-content:center;gap:10px;padding:12px;background:var(--certrev-bar-bg,#0a1b3f);color:var(--certrev-bar-fg,#fff);font-family:var(--font-mono);font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;">${logo(18)} Expert reviewed</div>`,
		)
	}

	// 2. authorName — the "Written by" row (subtitle nested iff authorTitle placed + present)
	if (placed('authorName')) {
		const subtitle =
			placed('authorTitle') && facts.authorTitle
				? `<div style="font-size:13px;color:var(--cr-ink-sub);">${escapeHtml(facts.authorTitle)}</div>`
				: ''
		parts.push(
			`<div>` +
				`<div style="font-family:var(--font-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--navy-35);margin-bottom:11px;">Written by</div>` +
				`<div style="display:flex;align-items:center;gap:12px;">${avatar(initials(facts.authorName), 42, 12)}` +
				`<div><div style="font-size:15px;font-weight:700;color:var(--cr-ink);">${escapeHtml(facts.authorName)}</div>${subtitle}</div></div>` +
				`</div>`,
		)
	}

	// 3. reviewer row — optional photo + the self-gating verification block
	const reviewerAvatar = placed('reviewerPhoto') ? avatar(initials(facts.reviewerName), 46, 13) : ''
	const reviewerBlock = verificationBlock(facts, false, placed)
	if (reviewerAvatar || reviewerBlock) {
		parts.push(`<div style="display:flex;align-items:flex-start;gap:13px;">${reviewerAvatar}${reviewerBlock}</div>`)
	}

	// 4. bio (sidebar's bio paragraph)
	if (placed('bio') && facts.bio) {
		parts.push(
			`<p style="font-size:14px;line-height:1.55;color:var(--cr-ink-soft);margin:16px 0 0;">${escapeHtml(facts.bio)}</p>`,
		)
	}

	// 5. memo (sidebar's blockquote)
	if (placed('memo')) {
		parts.push(
			`<blockquote style="margin:16px 0 0;padding-left:16px;border-left:3px solid var(--ba,#0a1b3f);font-size:15px;line-height:1.5;color:var(--cr-ink-soft);white-space:pre-line;">${escapeHtml(facts.memo)}</blockquote>`,
		)
	}

	// 6. disclosures (sidebar's cue · scope row; separator only when BOTH land)
	const cueEl = placed('compensationCue')
		? `<span style="font-family:var(--font-mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;">${escapeHtml(locked(facts.compensationCue, COMPENSATED_EXPERT_CUE))}</span>`
		: ''
	const scopeEl = placed('scopeLine') ? escapeHtml(locked(facts.scopeLine, CERT_SCOPE_LINE)) : ''
	if (cueEl || scopeEl) {
		parts.push(
			`<div style="font-size:12.5px;line-height:1.5;color:var(--navy-55);margin-top:16px;">${cueEl}${cueEl && scopeEl ? ' · ' : ''}${scopeEl}</div>`,
		)
	}

	// 7. action row — the memo-card stamp links (same data-certrev-modal-open hooks)
	const first = firstNameOf(facts.reviewerName)
	const profile = placed('profileLink')
		? profileLink(facts.profileUrl, `${escapeHtml(first)}'s Profile`, STAMP_LINK_STYLE)
		: ''
	const certificate = placed('certificateLink')
		? certificateLink(facts.certificateUrl, 'Certificate', STAMP_LINK_STYLE)
		: ''
	if (profile || certificate) {
		parts.push(`<div style="display:flex;flex-wrap:wrap;gap:22px;">${profile}${certificate}</div>`)
	}

	return (
		`<div style="border:1px solid var(--navy-10);border-radius:var(--br,14px);background:var(--surface);padding:20px;font-family:var(--cr-bf);display:flex;flex-direction:column;gap:14px;">` +
		parts.join('') +
		`</div>`
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render the LOCKED CertREV cert design as an SSR-safe HTML string for one of the
 * three placement modes. Returns a self-contained `<div class="certrev-cert …">`
 * that needs no JS to render (the modal + bio accordion progressively enhance).
 */
export function renderCertBlock(input: RenderCertBlockInput): string {
	const theme = resolveBlockTheme(input.theme)
	const { facts, mode, face } = input
	const placed = placedTester(face)
	switch (mode) {
		case 'banner': {
			// Suppress the memo card entirely when the engine placed none of its fields
			// (avoids an empty bordered shell). Grandfather: all placed ⇒ card renders.
			const memoCard =
				placed('memo') || placed('profileLink') || placed('certificateLink') || placed('scopeLine')
					? bannerMemoCard(facts, placed)
					: ''
			// First-class memo split (POR-10741): default 'full' is byte-identical to the prior
			// header+memo render; 'header'/'memo' emit only that card so the exporter can place
			// the memo as its own block (retires the CertReviewCard string-split shim).
			const part = input.part ?? 'full'
			const inner =
				part === 'header'
					? bannerHeaderCard(facts, placed)
					: part === 'memo'
						? memoCard
						: bannerHeaderCard(facts, placed) + memoCard
			return root(mode, theme, inner, face)
		}
		case 'sidebar':
			return root(mode, theme, sidebarCard(facts, placed), face)
		case 'floating':
			return root(mode, theme, floatingPill(facts, placed), face)
		case 'custom':
			return root(mode, theme, renderCustomFace(facts, placed), face)
	}
}
