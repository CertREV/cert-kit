/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Design-guide RENDER-DEF support (the themeable-token + subtractive-visibility
 * layer) + the two always-on COMPLIANCE strings.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WS6 of the unified cert-render / design-guide build
 * (~/.claude-account-m/plans/smooth-meandering-graham.md). This is the Builder /
 * headless projection twin's half of the "law-as-code" contract: cert-block is one
 * of the four render surfaces (Shopify Liquid, WordPress PHP, JS engine, and this)
 * that must paint the SAME compliant, optionally-themed badge from the SAME facts.
 *
 * cert-block is a self-contained npm package — it does NOT import the portal's
 * `@/lib/design-guide` enforcement core. Instead it mirrors, at the RENDER edge,
 * the small subset that shape the projection carries:
 *
 *   1. The four allowlisted THEMEABLE tokens `{accentColor, surface, cornerRadius,
 *      fontSlot}`, emitted as the exact `--certrev-*` CSS custom properties the
 *      Shopify/WordPress engines emit and the WS11 crawl monitor asserts
 *      (`--certrev-accent` / `--certrev-surface` / `--certrev-radius` /
 *      `--certrev-font`). Each is RE-VALIDATED here at render time (defense in
 *      depth over the write-path fail-closed gate) against the SAME strict
 *      validators the portal's `tokens.ts` uses, and an invalid value is DROPPED
 *      (falls back to the preset default) — never emitted. `fontSlot` resolves to
 *      a FIXED font STACK (never a free-form family — the CSS-injection surface).
 *   2. SUBTRACTIVE field-visibility: a brand may only HIDE preset-placed,
 *      brand-toggleable fields (`reviewerPhoto`, `memo`) — never add a field the
 *      preset doesn't place. Locked fields (cue, scope, links) can never be hidden.
 *   3. The two always-on COMPLIANCE strings a claim-bearing face carries on EVERY
 *      rung (design guide §3): the compensation cue and the FTC scope line, both
 *      byte-verbatim (the scope line's curly apostrophe U+2019 is load-bearing).
 *
 * FAIL-SAFE: when NO render-def is supplied the THEMING layer contributes nothing
 * — no extra CSS vars, no `data-certrev-def-version`, no visibility subtraction —
 * so the badge's theme output is byte-identical to the un-themed default (the
 * program's no-op / merge-safety device). The compensation cue + scope line + the
 * `data-certrev-strings-version` stamp are the compliance BASELINE and land on
 * every claim face regardless of a def (matching the Shopify/WP engine fix).
 *
 * PURITY: no DOM, no Node builtins, no React — safe on every runtime the main
 * entry targets (edge / Workers / server / client).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Themeable token vocabulary (mirrors portal src/lib/design-guide/tokens.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** The font ENUM. Resolves to a FIXED slot stack — never a free-form family. */
export const FONT_SLOTS = ['sans', 'serif', 'system'] as const
export type FontSlot = (typeof FONT_SLOTS)[number]

/**
 * The `fontSlot` → fixed font-stack literal. BYTE-IDENTICAL to the Shopify Liquid
 * engine's stacks (`shopify/extensions/certrev-schema/snippets/certrev-badge.liquid`
 * — the only font families the twins use), so a themed brand's Builder projection
 * paints the same typography as its Shopify face. A raw family string in a
 * `font-family` CSS var is a CSS-injection surface AND breaks the "CertREV hosts no
 * fonts" invariant, so the enum → stack indirection is the security boundary.
 */
export const FONT_STACKS: Readonly<Record<FontSlot, string>> = {
	sans: "'DM Sans', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
	serif: "'Playfair Display', Georgia, 'Times New Roman', serif",
	system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
}

/** A fully-resolved themeable token set (a brand overrides a subset of these). */
export interface CertThemeTokens {
	readonly accentColor: string
	readonly surface: string
	readonly cornerRadius: string
	readonly fontSlot: FontSlot
}

/** The badge fields a render-def may SUBTRACTIVELY hide (brand-toggleable, free). */
export const HIDEABLE_FIELDS = ['reviewerPhoto', 'memo'] as const
export type BadgeVisibilityFieldId = (typeof HIDEABLE_FIELDS)[number]

/**
 * A brand render-def as it reaches the render edge — the RESOLVED projection the
 * portal's `getActiveRenderDef` → cert-chrome/builder-export path carries (mirrors
 * the Shopify `certrev.render_def` metafield `{v, preset, rung, tokens, hidden}`;
 * cert-block needs only the theming inputs). Every field is OPTIONAL: an absent
 * `renderDef`, an absent token, or an invalid token all fall back to the preset
 * default (fail-safe).
 */
export interface CertRenderDef {
	/** Partial themeable-token overrides. Absent/invalid keys use the preset default. */
	readonly tokens?: Partial<CertThemeTokens>
	/** SUBTRACTIVE hide-set — the ONLY visibility a brand can express. */
	readonly hidden?: readonly BadgeVisibilityFieldId[]
	/** Monotonic per-brand def version, stamped as `data-certrev-def-version`. */
	readonly version?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-token validators (strict, CSS-injection-safe — no trim, exact match)
// ─────────────────────────────────────────────────────────────────────────────

/** 3- or 6-digit hex with a leading `#` — opaque by construction (no alpha). */
const HEX_OPAQUE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** A single CSS length: a non-negative number with a `px|rem|em|%` unit, or bare `0`. */
const RADIUS = /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%))$/

/** `accentColor` / `surface` — an opaque hex (surface opacity is FORCED for contrast soundness). */
export function isOpaqueHexColor(value: string): boolean {
	return HEX_OPAQUE.test(value)
}

/** `cornerRadius` — a single unit-bearing CSS length (or bare `0`). */
export function isCornerRadius(value: string): boolean {
	return RADIUS.test(value)
}

/** Is `value` a known font slot? */
export function isFontSlot(value: string): value is FontSlot {
	return (FONT_SLOTS as readonly string[]).includes(value)
}

// ─────────────────────────────────────────────────────────────────────────────
// The two always-on compliance strings (byte-verbatim — never re-word here)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The compensation cue (design guide "line A"). Rendered beside the reviewer on
 * EVERY claim-bearing face. Byte-exact; the tag-stripped visible text of the cue
 * markup must equal this constant. Mirrors portal `COMPENSATED_EXPERT_CUE`.
 */
export const COMPENSATED_EXPERT_CUE = 'Compensated expert'

/**
 * The FTC scope disclaimer (design guide "line B"). Byte-verbatim; the curly
 * apostrophe (U+2019) in "article’s" is LOAD-BEARING (the MSA §3 references this
 * copy in the present tense). Mirrors portal `FTC_DISCLOSURE_LINE` / `CERT_SCOPE_LINE`.
 */
export const CERT_SCOPE_LINE =
	'Independent editorial review of this article’s text and sources. Not a product endorsement, nor medical advice.'

/**
 * The delivered display-string EDITION, stamped as `data-certrev-strings-version`
 * so the crawl monitor can assert which verbatim strings a live face should carry.
 * MUST equal the portal's `CERT_DISPLAY_STRINGS_VERSION` (display-strings.ts).
 * Bump in lockstep whenever the cue or scope line changes.
 */
export const CERT_STRINGS_VERSION = '2026-07'

// ─────────────────────────────────────────────────────────────────────────────
// Resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The validated theme a render-def resolves to. Every field is present ONLY when
 * the def supplied a VALID value for it (an absent/invalid token is dropped so the
 * preset default shows through). `accent` is surfaced for the accent-precedence
 * chain in `resolveDisplay`; `surface`/`cornerRadius`/`fontStack` have no legacy
 * display equivalent and are emitted ONLY on a themed face.
 */
export interface ResolvedRenderTheme {
	readonly accent?: string
	readonly surface?: string
	readonly cornerRadius?: string
	readonly fontStack?: string
	readonly version?: number
}

/** Resolve + re-validate a render-def's tokens. Invalid values are DROPPED (fail-safe). */
export function resolveRenderTheme(def?: CertRenderDef): ResolvedRenderTheme {
	if (!def) return {}
	const t = def.tokens ?? {}
	const accent = t.accentColor && isOpaqueHexColor(t.accentColor) ? t.accentColor : undefined
	const surface = t.surface && isOpaqueHexColor(t.surface) ? t.surface : undefined
	const cornerRadius = t.cornerRadius && isCornerRadius(t.cornerRadius) ? t.cornerRadius : undefined
	const fontStack = t.fontSlot && isFontSlot(t.fontSlot) ? FONT_STACKS[t.fontSlot] : undefined
	const version = typeof def.version === 'number' && Number.isFinite(def.version) ? def.version : undefined
	return { accent, surface, cornerRadius, fontStack, version }
}

/** Is a brand-toggleable field hidden by this render-def's subtractive hide-set? */
export function isFieldHidden(def: CertRenderDef | undefined, id: BadgeVisibilityFieldId): boolean {
	return !!def?.hidden?.includes(id)
}

// ─────────────────────────────────────────────────────────────────────────────
// Cert-render BLOCK theme — the resolved-token mirror of portal ResolvedRenderDef
// ─────────────────────────────────────────────────────────────────────────────
//
// `renderCertBlock` (render-cert-block.ts) paints the LOCKED CertREV cert design
// (banner / sidebar / floating) from an ALREADY-RESOLVED token set — the portal
// bakes `ResolvedRenderDef` (render-def.ts + tokens.ts) and the projection carries
// its theme half here. This is a WIDER slot vocabulary than the `CertThemeTokens`
// above (which the legacy `<CertBadge>` uses): it mirrors the portal's FULL
// five-member `FontSlot` enum + the pre-computed `accentFg` ink, so the block can
// reproduce the guide's four-font design (DM Sans body, Playfair memo, JetBrains
// mono labels, Plus Jakarta wordmark). It is kept DISTINCT from `FONT_SLOTS` /
// `FONT_STACKS` above so the legacy badge's three-slot contract stays byte-frozen.

/**
 * The full portal font-slot enum (mirrors portal `src/lib/design-guide/tokens.ts`
 * `FONT_SLOTS`). `grotesk` ⇐ the guide's wordmark slot; `mono` ⇐ the label slot.
 */
export const RENDER_BLOCK_FONT_SLOTS = ['sans', 'serif', 'system', 'grotesk', 'mono'] as const
export type RenderBlockFontSlot = (typeof RENDER_BLOCK_FONT_SLOTS)[number]

/**
 * The `RenderBlockFontSlot` → fixed family stack. BYTE-IDENTICAL to the portal's
 * `FONT_SLOT_STACKS` (the guide's stacks — the cert-render parity anchor across the
 * twins). Resolved family strings, never `var(...)` indirections. A raw family in a
 * `font-family` CSS var is a CSS-injection surface, so the enum → stack indirection
 * stays the security boundary (a caller can only pass an enum member).
 */
export const RENDER_BLOCK_FONT_STACKS: Readonly<Record<RenderBlockFontSlot, string>> = {
	sans: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
	serif: "'Playfair Display', Georgia, 'Times New Roman', serif",
	grotesk: "'Plus Jakarta Sans', system-ui, Helvetica, Arial, sans-serif",
	mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
	system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
}

/** Is `value` a known render-block font slot? */
export function isRenderBlockFontSlot(value: string): value is RenderBlockFontSlot {
	return (RENDER_BLOCK_FONT_SLOTS as readonly string[]).includes(value)
}

/**
 * Parse a 3- or 6-digit opaque hex into 8-bit RGB channels (null on a malformed value). The
 * 3-digit form expands each nibble (`#abc` → `#aabbcc`), matching CSS.
 */
function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
	const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex)
	if (!m) return null
	let h = m[1]
	if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
	const n = Number.parseInt(h, 16)
	return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

/**
 * AUTO-CONTRAST PICKER — the ink painted over an opaque fill. BYTE-FAITHFUL to the portal's
 * `accentFg` (src/lib/design-guide/tokens.ts): Rec.601 perceptual luma with a strict `> 0.62`
 * cutoff, returning EXACTLY `#141414` (near-black) or `#ffffff`; an unparseable value falls back
 * to the dark ink (safe default). Used at the render edge to DERIVE `barInkFg` from a themed
 * `barInk` (v2 Phase 1), so the bar foreground always clears its own fill with no separate stored
 * token — the exact model the portal uses for the accent fill.
 */
export function accentFg(hex: string): '#141414' | '#ffffff' {
	const rgb = parseHexColor(hex)
	if (!rgb) return '#141414'
	const luma = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255
	return luma > 0.62 ? '#141414' : '#ffffff'
}

/**
 * The resolved themeable-token set `renderCertBlock` paints — the render-edge mirror
 * of the portal `ResolvedRenderDef` theme half (`tokens` ⊕ the precomputed
 * `accentFg`). `accentFg` is the ink painted over the accent fill — the portal's
 * guide-faithful Rec.601 auto-contrast pick (`#141414` or `#ffffff`), carried
 * pre-computed so this dumb twin never recomputes it.
 */
export interface ResolvedBlockTheme {
	readonly accentColor: string
	readonly surface: string
	readonly cornerRadius: string
	readonly fontSlot: RenderBlockFontSlot
	readonly accentFg: '#141414' | '#ffffff'
	/**
	 * V2 chrome-ink (Phase 1) — the header/seal bar (and floating-pill) FILL. OPTIONAL:
	 * present ONLY when the def themes it, so an un-barInk'd face emits nothing extra and the bar
	 * keeps its locked navy/white base (byte-identical). Mirrors the portal's `ThemeTokens.barInk`.
	 */
	readonly barInk?: string
	/**
	 * V2 chrome-ink — the bar's auto-contrast FOREGROUND, DERIVED at the edge via `accentFg(barInk)`
	 * (the bar-background twin of the accent's `accentFg`). A SIBLING of the tokens, present ONLY when
	 * `barInk` is (absent ⇒ the locked white bar fg). Mirrors the portal's `ResolvedRenderDef.barInkFg`.
	 */
	readonly barInkFg?: '#141414' | '#ffffff'
	/**
	 * V2 chrome-ink — the primary FREE-content trust ink (reviewer/author names, title, credential,
	 * bio, initials + the derived muted scale). OPTIONAL: absent ⇒ the ink stays navy (byte-identical).
	 * The LOCKED legal disclosures NEVER follow it. Mirrors the portal's `ThemeTokens.inkColor`.
	 */
	readonly inkColor?: string
}

/** The CertREV navy default theme (the un-themed face — matches the locked reference `:root`). */
export const DEFAULT_BLOCK_THEME: ResolvedBlockTheme = {
	accentColor: '#0a1b3f',
	surface: '#ffffff',
	cornerRadius: '14px',
	fontSlot: 'sans',
	accentFg: '#ffffff',
}

/**
 * Re-validate a (possibly partial / untrusted) block theme at the render edge —
 * defense in depth over the portal's fail-closed bake. Any invalid token is DROPPED
 * to the navy default (never emitted into storefront CSS). Mirrors the
 * `resolveRenderTheme` fail-safe posture.
 */
export function resolveBlockTheme(theme?: Partial<ResolvedBlockTheme>): ResolvedBlockTheme {
	const t = theme ?? {}
	// v2 chrome-ink (Phase 1): re-validate the two brand-ink tokens at the edge (defense in depth over
	// the portal's fail-closed bake). Each is DROPPED unless it is an opaque hex; `barInkFg` is always
	// DERIVED here via `accentFg(barInk)` — never trusted from the input — so the bar foreground can
	// never diverge from the fill it sits on. ABSENT ⇒ omitted, so the renderer emits nothing extra and
	// the face is byte-identical to the un-themed default.
	const barInk = t.barInk && isOpaqueHexColor(t.barInk) ? t.barInk : undefined
	const inkColor = t.inkColor && isOpaqueHexColor(t.inkColor) ? t.inkColor : undefined
	return {
		accentColor: t.accentColor && isOpaqueHexColor(t.accentColor) ? t.accentColor : DEFAULT_BLOCK_THEME.accentColor,
		surface: t.surface && isOpaqueHexColor(t.surface) ? t.surface : DEFAULT_BLOCK_THEME.surface,
		cornerRadius: t.cornerRadius && isCornerRadius(t.cornerRadius) ? t.cornerRadius : DEFAULT_BLOCK_THEME.cornerRadius,
		fontSlot: t.fontSlot && isRenderBlockFontSlot(t.fontSlot) ? t.fontSlot : DEFAULT_BLOCK_THEME.fontSlot,
		accentFg: t.accentFg === '#141414' || t.accentFg === '#ffffff' ? t.accentFg : DEFAULT_BLOCK_THEME.accentFg,
		...(barInk ? { barInk, barInkFg: accentFg(barInk) } : {}),
		...(inkColor ? { inkColor } : {}),
	}
}

/**
 * The locked verification ATTRIBUTION phrase, rendered grouped with the dated
 * verification (`<name>, <credential>` → this → `on <date>`). Byte-exact; mirrors the
 * fixed clause inside portal `buildBylineCredentialed` ("Credential verified by
 * CertREV on …"). Never re-word without contract + legal re-review.
 */
export const CREDENTIAL_VERIFIED_ATTRIBUTION = 'Credential verified by CertREV'

/**
 * The extra `--certrev-*` custom-property declarations a THEMED face emits, in the
 * engine's order (surface → radius → font; accent is emitted separately so the
 * no-def output stays byte-identical). Returns `[]` when no theme is present, so
 * the un-themed badge emits ZERO extra vars. The data-bearing values are already
 * strict-validated; the font is a controlled literal stack.
 */
export function themeCssVarDeclarations(theme: ResolvedRenderTheme): ReadonlyArray<readonly [string, string]> {
	const out: Array<readonly [string, string]> = []
	if (theme.surface) out.push(['--certrev-surface', theme.surface])
	if (theme.cornerRadius) out.push(['--certrev-radius', theme.cornerRadius])
	if (theme.fontStack) out.push(['--certrev-font', theme.fontStack])
	return out
}
