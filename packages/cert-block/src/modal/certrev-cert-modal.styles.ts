/**
 * Scoped styles + inline SVGs for the `<certrev-cert-modal>` Shadow-DOM element
 * (POR-10102). The single source of truth for the certificate (3a) + reviewer (4b)
 * modal look, ported byte-faithfully from the Claude Design reference
 * (`docs/claude/design/certificate-modals/`, footer variant 3a + reviewer 4b).
 *
 * Because the element renders inside a shadow root, this CSS is fully scoped: the
 * brand storefront theme cannot bleed in, and these rules never leak out — so the
 * old `certrev-cert.css` "theme-bleed armor" and the literal-hex-only constraint
 * (which the `body_html` WordPress modal still needs) do NOT apply here. Tokens are
 * plain custom properties on `:host`; fonts resolve from document-level `@font-face`
 * that the element injects on first construct (font faces do not scope into a shadow
 * root, so they must live at document level — see `certrev-cert-modal.ts`).
 */

import { LOGO_PATHS } from './logo-paths.js'

/** The four-chevron CertREV mark (viewBox 0 0 375 375), tinted via the passed fill. Path data is
 * single-sourced from src/lib/design-guide/logo.ts (the SOT the codegen mirrors into every twin). */
export function chevronMark(size: number, fill: string): string {
	const paths = LOGO_PATHS.map((d) => `<path fill="${fill}" d="${d}"/>`).join('')
	return `<svg width="${size}" height="${size}" viewBox="0 0 375 375" aria-hidden="true" style="display:block;flex-shrink:0">${paths}</svg>`
}

/** The 8px lime-chip check glyph (viewBox 0 0 24 24). */
export function checkIcon(size = 8): string {
	return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`
}

/**
 * The rotated 74×74 verified stamp: two concentric navy rings + a circular
 * `textPath` reading "CERTREV VERIFIED · CERTIFIED ·" + the chevron mark centered.
 * `idSuffix` uniquifies the internal `<path>` id so multiple stamps on one page
 * (or a story grid) don't collide on the shared `href`.
 */
export function verifiedStamp(idSuffix = 'crm'): string {
	const arcId = `crm-stamp-arc-${idSuffix}`
	const mark = LOGO_PATHS.map((d) => `<path fill="#0a1b3f" d="${d}"/>`).join('')
	return `<span class="crm-stamp"><svg viewBox="0 0 128 128" width="74" height="74" role="img" aria-label="CertREV verified stamp" style="display:block"><defs><path id="${arcId}" d="M64 18 A46 46 0 1 1 64 110 A46 46 0 1 1 64 18"/></defs><circle cx="64" cy="64" r="58" fill="none" stroke="#0a1b3f" stroke-width="1.3"/><circle cx="64" cy="64" r="51.5" fill="none" stroke="#0a1b3f" stroke-width="0.7" stroke-opacity="0.4"/><text font-family="'JetBrains Mono',ui-monospace,monospace" font-size="7.8" font-weight="600" letter-spacing="1.3" fill="#0a1b3f"><textPath href="#${arcId}" startOffset="1%">CERTREV VERIFIED · CERTIFIED · </textPath></text><svg x="49" y="50" width="30" height="28" viewBox="0 0 375 375" preserveAspectRatio="xMidYMid meet">${mark}</svg></svg></span>`
}

/**
 * The five families the modal uses, self-hosted-or-Google (the element injects
 * ONE document-level `<link>`/`@font-face` for these; font-display:swap). Kept as
 * a constant so the loader + any story reference the identical set.
 */
export const CERT_MODAL_FONT_FAMILIES = [
	'DM Sans',
	'Playfair Display',
	'JetBrains Mono',
	'Plus Jakarta Sans',
	'Allura',
] as const

// The modal's fonts are self-hosted (POR-10657): the standalone loader (certrev-cert-modal.ts)
// injects the shared CERT_FONT_FACE_CSS @font-face block (R2 URLs) instead of a render-blocking
// Google Fonts stylesheet. In the theme-app-extension the host page already declares these via
// certrev-cert.css, so `data-fonts="host"` suppresses the injection entirely.

/** The full scoped stylesheet, adopted via a constructable `CSSStyleSheet`. */
export const CERT_MODAL_CSS = `
:host {
	--cr-navy: #0a1b3f;
	--cr-lime: #d4e157;
	--cr-white: #ffffff;
	--cr-navy-06: rgba(10, 27, 63, 0.06);
	--cr-navy-10: rgba(10, 27, 63, 0.1);
	--cr-navy-25: rgba(10, 27, 63, 0.25);
	--cr-navy-40: rgba(10, 27, 63, 0.4);
	--cr-navy-45: rgba(10, 27, 63, 0.45);
	--cr-navy-50: rgba(10, 27, 63, 0.5);
	--cr-navy-55: rgba(10, 27, 63, 0.55);
	--cr-navy-60: rgba(10, 27, 63, 0.6);
	--cr-navy-85: rgba(10, 27, 63, 0.85);
	--cr-white-60: rgba(255, 255, 255, 0.6);
	--cr-white-85: rgba(255, 255, 255, 0.85);
	--cr-cta-hover: #0c2149;
	--cr-ghost-hover: rgba(10, 27, 63, 0.12);
	--cr-shadow: 0 30px 60px -18px rgba(10, 27, 63, 0.5);
	--cr-backdrop: rgba(10, 27, 63, 0.45);
	--cr-sans: 'DM Sans', system-ui, -apple-system, sans-serif;
	--cr-serif: 'Playfair Display', Georgia, serif;
	--cr-mono: 'JetBrains Mono', ui-monospace, Menlo, monospace;
	--cr-wordmark: 'Plus Jakarta Sans', system-ui, sans-serif;
	--cr-script: 'Allura', cursive;
}

.crm-dialog {
	border: none;
	border-radius: 14px;
	padding: 0;
	width: 92%;
	max-height: 92vh;
	overflow: auto;
	box-shadow: var(--cr-shadow);
	background: var(--cr-white);
	color: var(--cr-navy);
	font-family: var(--cr-sans);
	/* fixed, NOT relative (POR-10473): a :modal dialog (showModal) renders in the TOP LAYER; a
	 * relative dialog anchors to its scrolled document position, so once the page is scrolled the
	 * panel renders off-screen while the ::backdrop still covers the viewport (measured top -1972 at
	 * scrollY 2537). fixed is viewport-anchored (the UA inset:0 + margin:auto centers it) and still
	 * provides the containing block for the absolutely-positioned .crm-close (x stays in-corner). */
	position: fixed;
	/* defensive resets against a hostile brand theme reaching the top-layer dialog */
	box-sizing: border-box;
	text-align: left;
	line-height: 1.4;
}
.crm-dialog *,
.crm-dialog *::before,
.crm-dialog *::after {
	box-sizing: border-box;
}
.crm-dialog::backdrop {
	background: var(--cr-backdrop);
}
.crm-dialog--cert {
	max-width: 484px;
}
.crm-dialog--expert {
	max-width: 436px;
}

/* Close (×) */
.crm-close {
	position: absolute;
	top: 12px;
	right: 15px;
	z-index: 2;
	background: none;
	border: none;
	cursor: pointer;
	padding: 2px;
	color: var(--cr-white-60);
	font-size: 1.35rem;
	line-height: 1;
	font-family: var(--cr-sans);
	transition: color 0.15s;
}
.crm-close:hover {
	color: var(--cr-white);
}

/* Header bar */
.crm-head {
	display: flex;
	align-items: center;
	gap: 9px;
	padding: 13px 22px;
	background: var(--cr-navy);
	color: var(--cr-white);
}
.crm-head__eyebrow {
	font-family: var(--cr-mono);
	font-size: 8.5px;
	font-weight: 600;
	letter-spacing: 0.16em;
	text-transform: uppercase;
	color: var(--cr-white-85);
}
.crm-head__wordmark {
	margin-left: auto;
	margin-right: 22px;
	font-family: var(--cr-wordmark);
	font-weight: 800;
	font-size: 13px;
	letter-spacing: 0.03em;
	color: var(--cr-white);
}

/* Body */
.crm-body--cert {
	padding: 24px 28px 26px;
}
.crm-body--expert {
	padding: 22px 26px 24px;
}

/* Avatar (shared, lime ring) */
.crm-avatar {
	position: relative;
	flex-shrink: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 50%;
	background: var(--cr-navy);
	color: var(--cr-white);
	font-weight: 700;
	object-fit: cover;
	box-shadow: 0 0 0 2px var(--cr-white), 0 0 0 3.5px var(--cr-lime);
}
.crm-avatar--56 {
	width: 56px;
	height: 56px;
	font-size: 17px;
}
.crm-avatar--64 {
	width: 64px;
	height: 64px;
	font-size: 1.35rem;
	letter-spacing: 0.02em;
}

/* Certificate — reviewing-expert row */
.crm-expert-row {
	display: flex;
	align-items: center;
	gap: 14px;
}
.crm-expert-row__info {
	flex: 1;
	min-width: 0;
}
.crm-expert-row__eyebrow {
	font-family: var(--cr-mono);
	font-size: 8.5px;
	font-weight: 600;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--cr-navy-45);
}
.crm-expert-row__name {
	font-size: 15px;
	font-weight: 700;
	color: var(--cr-navy);
	margin-top: 2px;
}
.crm-expert-row__creds {
	font-size: 12px;
	color: var(--cr-navy-60);
	margin-top: 1px;
}

/* Certificate — "Certifies the article" */
.crm-certifies {
	margin: 18px 0 0;
	padding-top: 16px;
	border-top: 1px solid var(--cr-navy-10);
}
.crm-certifies__eyebrow {
	font-family: var(--cr-mono);
	font-size: 9px;
	font-weight: 600;
	letter-spacing: 0.16em;
	text-transform: uppercase;
	color: var(--cr-navy-40);
}
.crm-certifies__title {
	font-family: var(--cr-serif);
	font-weight: 700;
	font-size: 18px;
	line-height: 1.25;
	color: var(--cr-navy);
	margin-top: 5px;
	text-wrap: balance;
}

/* Certificate — meta row */
.crm-meta {
	display: flex;
	gap: 10px;
	margin-top: 16px;
}
.crm-meta__col {
	flex: 1;
}
.crm-meta__label {
	font-family: var(--cr-mono);
	font-size: 8px;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--cr-navy-40);
}
.crm-meta__value {
	font-size: 12.5px;
	font-weight: 600;
	color: var(--cr-navy);
	margin-top: 3px;
}
.crm-meta__value--mono {
	font-family: var(--cr-mono);
	font-size: 12px;
}
.crm-meta__status {
	margin-top: 3px;
}

/* Certified chip (meta status) */
.crm-chip {
	display: inline-flex;
	align-items: center;
	gap: 3px;
	padding: 2px 7px;
	border-radius: 4px;
	background: var(--cr-lime);
	color: var(--cr-navy);
	font-family: var(--cr-mono);
	font-size: 8.5px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
}

/* Certificate — signature + stamp footer */
.crm-sig {
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
	margin-top: 20px;
	padding-top: 16px;
	border-top: 1px solid var(--cr-navy-10);
	gap: 12px;
}
.crm-sig__name {
	font-family: var(--cr-script);
	font-size: 30px;
	line-height: 0.9;
	color: var(--cr-navy);
}
.crm-sig__rule {
	width: 146px;
	max-width: 100%;
	height: 1px;
	background: var(--cr-navy-25);
	margin: 4px 0 6px;
}
.crm-sig__url {
	font-family: var(--cr-mono);
	font-size: 8px;
	font-weight: 500;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--cr-navy-50);
}
.crm-stamp {
	transform: rotate(-8deg);
	flex-shrink: 0;
}
.crm-stamp svg {
	display: block;
}

/* Actions (shared) */
.crm-actions {
	display: flex;
	gap: 10px;
	margin-top: 20px;
}
.crm-cta {
	flex: 1;
	display: inline-block;
	text-align: center;
	padding: 11px 16px;
	background: var(--cr-navy);
	color: var(--cr-white);
	text-decoration: none;
	border-radius: 8px;
	font-size: 13px;
	font-weight: 600;
	font-family: var(--cr-sans);
	border: none;
	cursor: pointer;
	transition: background 0.15s;
}
.crm-cta:hover {
	background: var(--cr-cta-hover);
}
.crm-ghost {
	padding: 11px 18px;
	background: var(--cr-navy-06);
	color: var(--cr-navy);
	border: none;
	border-radius: 8px;
	font-size: 13px;
	font-weight: 600;
	font-family: var(--cr-sans);
	cursor: pointer;
	transition: background 0.15s;
}
.crm-ghost:hover {
	background: var(--cr-ghost-hover);
}

/* Reviewer — identity row */
.crm-id {
	display: flex;
	align-items: center;
	gap: 14px;
}
.crm-id__info {
	min-width: 0;
}
.crm-id__name {
	font-size: 16px;
	font-weight: 700;
	line-height: 1.25;
	color: var(--cr-navy);
}
.crm-id__subtitle {
	font-size: 12.5px;
	line-height: 1.4;
	color: var(--cr-navy-60);
	margin-top: 2px;
}

/* Reviewer — credential chips */
.crm-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 7px;
	margin-top: 16px;
}
.crm-chips__chip {
	display: inline-flex;
	align-items: center;
	padding: 4px 10px;
	border-radius: 999px;
	background: var(--cr-navy-06);
	color: var(--cr-navy);
	font-size: 11px;
	font-weight: 600;
}

/* Reviewer — bio */
.crm-bio {
	margin: 16px 0 0;
	font-size: 0.9rem;
	line-height: 1.55;
	color: var(--cr-navy-85);
}

/* Reviewer — trust line (the disclosure footer below now owns the spacing to the actions) */
.crm-trust {
	display: flex;
	align-items: center;
	gap: 9px;
	flex-wrap: wrap;
	margin: 16px 0 0;
	padding-top: 16px;
	border-top: 1px solid var(--cr-navy-10);
}
.crm-trust__chip {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 3px 8px;
	border-radius: 4px;
	background: var(--cr-lime);
	color: var(--cr-navy);
	font-family: var(--cr-mono);
	font-size: 8.5px;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
}
.crm-trust__text {
	font-family: var(--cr-mono);
	font-size: 9px;
	letter-spacing: 0.05em;
	color: var(--cr-navy-50);
}

/* FTC disclosure footer (POR-10496) — material-connection cue (compensated only) + scope line
 * (always). Rendered on both the certificate + reviewer dialogs, immediately above the actions. */
.crm-disclosure {
	margin-top: 14px;
	padding-top: 14px;
	border-top: 1px solid var(--cr-navy-10);
	font-family: var(--cr-sans);
	font-size: 11.5px;
	line-height: 1.5;
	color: var(--cr-navy-50);
}
.crm-disclosure__cue {
	font-family: var(--cr-mono);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--cr-navy);
}

/* Narrow storefronts / phones */
@media (max-width: 440px) {
	.crm-body--cert {
		padding: 20px 18px 22px;
	}
	.crm-body--expert {
		padding: 18px 18px 20px;
	}
}
`
