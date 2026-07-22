/**
 * Presentation helpers shared by the React components + Web Component. Pure, no DOM,
 * no React — so the same formatting drives JSX and the hand-built Web Component string.
 */

import type { CertContent, CertDisplayConfig } from '../contract/kernel.js'
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
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatDate(iso: string | null | undefined): string | null {
	if (!iso) return null
	const ms = Date.parse(iso)
	if (Number.isNaN(ms)) return null
	const d = new Date(ms)
	return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

/** "PhD, RD" — the expert's credential abbreviations, comma-joined. */
export function credentialSuffix(content: CertContent): string {
	return content.expert.credentials.map((c) => c.abbreviation).join(', ')
}

/** "Dr. Jane Doe, PhD, RD" — display name with credential suffix appended. */
export function expertNameWithCredentials(content: CertContent): string {
	const suffix = credentialSuffix(content)
	return suffix ? `${content.expert.displayName}, ${suffix}` : content.expert.displayName
}
