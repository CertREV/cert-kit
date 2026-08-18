/**
 * Presentation helpers shared by the React components + Web Component. Pure, no DOM,
 * no React — so the same formatting drives JSX and the hand-built Web Component string.
 */

import type { CertContent, CertDisplayConfig } from '../contract/kernel.js'
import { asText } from './escape.js'
import { type CertRenderDef, isFieldHidden, resolveRenderTheme } from './render-def.js'

/** Default accent if the brand didn't pin one (CertREV teal). */
export const DEFAULT_ACCENT = '#0f766e'

export interface ResolvedDisplay {
	readonly accentColor: string
	readonly showExpertPhoto: boolean
	readonly showAuthor: boolean
	readonly showMemo: boolean
	readonly badgeStyle: 'full' | 'compact'
}

/**
 * Resolve the optional display config + optional brand render-def to concrete
 * presentation flags + accent.
 *
 * Accent PRECEDENCE mirrors the Shopify Liquid engine exactly: an explicit
 * `accentOverride` (a block/prop override) wins, then the render-def's validated
 * accent (a THEMED brand), then the signed display's accent, else the CertREV
 * default. Visibility is SUBTRACTIVE: the render-def's hide-set can only turn a
 * preset-placed field OFF (never on) — a hidden `reviewerPhoto` / `memo` wins over
 * a display flag that shows it. When no render-def is supplied the theme resolves
 * empty, so accent + visibility are byte-identical to the pre-theming behavior.
 */
export function resolveDisplay(
	display: CertDisplayConfig | undefined,
	accentOverride?: string,
	renderDef?: CertRenderDef,
): ResolvedDisplay {
	const theme = resolveRenderTheme(renderDef)
	return {
		accentColor: accentOverride ?? theme.accent ?? display?.accentColor ?? DEFAULT_ACCENT,
		showExpertPhoto: (display?.showExpertPhoto ?? true) && !isFieldHidden(renderDef, 'reviewerPhoto'),
		showAuthor: display?.showAuthor ?? true,
		showMemo: (display?.showMemo ?? true) && !isFieldHidden(renderDef, 'memo'),
		badgeStyle: display?.badgeStyle ?? 'full',
	}
}

/**
 * Format an ISO-8601 instant to a stable, locale-independent date label ("Jun 21, 2026").
 * We deliberately DON'T use `toLocaleDateString` — its output varies by runtime ICU data,
 * which would make SSR output non-deterministic + cause hydration mismatches. Fixed
 * English month abbreviations keep server + client byte-identical.
 *
 * ISO-8601 STRINGS ONLY — a non-string yields null. `Date.parse` coerces its argument, so an
 * unguarded number sailed straight through as a YEAR: `formatDate(42)` returned "Jan 1, 2042"
 * off a malformed envelope, while the number a caller would actually MEAN (epoch ms,
 * 1750000000000) returned null. A date helper that invents a confident wrong certification
 * date is worse than one that renders nothing, and the wire contract (`certifiedAt`,
 * `contentModifiedAt`) is ISO-8601 strings — there is no second input format to honour.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatDate(iso: string | null | undefined): string | null {
	if (typeof iso !== 'string' || iso === '') return null
	const ms = Date.parse(iso)
	if (Number.isNaN(ms)) return null
	const d = new Date(ms)
	return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

/**
 * "PhD, RD" — the expert's credential abbreviations, comma-joined.
 *
 * Shape-guarded because the envelope reaching here was only SIGNATURE-checked: a signed
 * payload whose `credentials` is absent or is not an array used to throw
 * `TypeError: ...map is not a function` and take the host route down with it. An entry with
 * no usable abbreviation is DROPPED rather than joined as empty — the old code rendered
 * "Dr. Jane Doe, , RD" off one missing field. A well-formed envelope is byte-identical.
 */
export function credentialSuffix(content: CertContent): string {
	const credentials = content?.expert?.credentials
	if (!Array.isArray(credentials)) return ''
	return credentials
		.map((c) => asText(c?.abbreviation))
		.filter((abbreviation) => abbreviation !== '')
		.join(', ')
}

/**
 * Split a comma-separated label into its trimmed, non-empty parts.
 * "Dr. Erik Schraga, MD" → `['Dr. Erik Schraga', 'MD']`.
 */
function commaTokens(value: string): string[] {
	return value
		.split(',')
		.map((token) => token.trim())
		.filter((token) => token !== '')
}

/**
 * Fold one token to the form two spellings of the SAME credential share: case-insensitive,
 * periods dropped, interior whitespace collapsed. "M.D." / "MD." / "md" → `md`.
 */
function credentialKey(token: string): string {
	return token.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Drop from `credential` any token the display NAME already prints, so a name that arrives
 * carrying its own post-nominal doesn't get it appended a second time — the defect that put
 * "Dr. Erik Schraga, MD, MD, EM" on a live customer page (P2-6).
 *
 * THE ROOT CAUSE IS UPSTREAM DATA, NOT THIS FUNCTION. Portal cleans an expert display name
 * with `cleanExpertDisplayName` and has DB CHECK constraints for exactly this shape
 * (migration 20260506151204), but `resolveStampReviewerName` skips the cleaner and
 * `package_drafts.expert_display_name` carries no constraint — so the duplicate is STORED,
 * and a consumer reading the Delivery API directly still receives it. This is the render
 * boundary refusing to print the same claim twice, nothing more.
 *
 * THE RULE, and why it is drawn this narrowly — a false positive here would delete a REAL
 * credential from a compliance-facing card, which is worse than the duplicate it fixes:
 *   • a credential token is dropped only when it equals a WHOLE comma-separated segment of
 *     the name. Never a substring: "MD" must survive against "Dr. MDonald", "Jane Amdahl"
 *     and "Md. Rahman", all of which a naive `name.includes(credential)` would gut;
 *   • comparison is `credentialKey`'d, so "M.D." in the name cancels "MD" in the credential;
 *   • the credential may be a LIST ("MD, FAAD"): each token is judged on its own, and the
 *     survivors keep their original spelling and order. A name carrying only "MD" therefore
 *     still renders ", FAAD" — no verified credential is ever lost to a partial overlap;
 *   • nothing duplicated ⇒ the credential string is returned VERBATIM (not re-joined), so
 *     the overwhelmingly common case is byte-identical to the pre-guard render.
 *
 * What it deliberately does NOT do: it never edits the NAME. "Dr. Erik Schraga, MD" keeps its
 * inline "MD" — un-embedding a post-nominal is `cleanExpertDisplayName`'s job on the write
 * path, and guessing at it here would be the same false-positive class in the other direction.
 * It also cannot catch a duplicate spelled differently in the two fields ("Doctor of Medicine"
 * in the name against "MD" in the credential) or one embedded mid-name rather than as its own
 * segment ("Erik Schraga MD" with no comma) — both stay for the upstream fix.
 */
export function dedupeCredential(name: unknown, credential: unknown): string {
	const suffix = asText(credential)
	const tokens = commaTokens(suffix)
	if (tokens.length === 0) return suffix
	// Every segment of the name, not just the trailing ones: for a well-formed name the first
	// segment is a human name and can never equal a credential token, and the one case where it
	// does — a stored name that is NOTHING but a credential ("MD") — is exactly the case where
	// dropping the suffix is right, since the token still renders once as the name.
	const carried = new Set(commaTokens(asText(name)).map(credentialKey))
	const kept = tokens.filter((token) => !carried.has(credentialKey(token)))
	if (kept.length === tokens.length) return suffix
	return kept.join(', ')
}

/**
 * "Dr. Jane Doe, PhD, RD" — display name with credential suffix appended.
 *
 * With no name there is nobody to attribute the review to, so the whole label is empty:
 * credentials alone would read as "Content reviewed by PhD, RD" in `CertBadge`'s aria-label.
 *
 * The suffix passes `dedupeCredential` because this composes name AND credential into one
 * string; `credentialSuffix` above stays the full verified list, so a caller rendering the
 * credentials AWAY from the name (a chip row, a standalone line) still gets every one of them.
 */
export function expertNameWithCredentials(content: CertContent): string {
	const name = asText(content?.expert?.displayName)
	if (name === '') return ''
	const suffix = dedupeCredential(name, credentialSuffix(content))
	return suffix ? `${name}, ${suffix}` : name
}
