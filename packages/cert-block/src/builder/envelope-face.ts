/**
 * ─────────────────────────────────────────────────────────────────────────────
 * `envelopeCardInput` — the Builder card's face, from VERIFIED facts + the brand's def (1.1.0)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The one mapping from a verified payload's `content` and the Delivery API's `renderDef` sibling
 * to the `renderCertBlock` input the registered `CertReviewCard` paints. It is its own module,
 * react-free, and exported on the `./builder/face` subpath so the portal's server bundle (which
 * cannot load `./builder`: that entry creates a React context at import) renders its preview
 * through THIS function instead of a copy of it. A preview and the live card that share the
 * mapping cannot disagree about it.
 *
 * The facts are read exactly as the Shopify app embed reads the same envelope:
 *  - the credential is each verified credential's `cardLabel` (else `abbreviation`), joined, and
 *    only with the dated verification beside it; no date, no credential (the name-only face);
 *  - the compensation cue's PRESENCE is the only thing read; the words are the locked constant,
 *    and an absent or null cue is the pro-bono face with no cue;
 *  - the def's `hidden` set removes only what is hideable (`HIDEABLE_FIELDS`); a def cannot hide
 *    the scope line, the credential verification or the certificate link.
 *
 * The face is the PHONE-aware one (`responsive`): on a narrow viewport the banner header stacks and
 * a long memo collapses behind a toggle the card binds (`memo-toggle.ts`); a wider viewport paints
 * exactly what it would without it.
 *
 * The caller has already run the kernel. This function never decides WHETHER to render a cert;
 * it only returns null when the verified content cannot make a face (no reviewer, no verify URL).
 */

import type {
	CertBlockFace,
	CertBlockLayout,
	CertBlockMode,
	RenderCertBlockInput,
} from '../components/render-cert-block.js'
import { accentFg, HIDEABLE_FIELDS, isOpaqueHexColor, type ResolvedBlockTheme } from '../components/render-def.js'
import type { CertContent } from '../contract/kernel.js'
import type { CertChromeRenderDef } from './cert-chrome-data.js'

/**
 * Every field id `renderCertBlock` places, in its canonical order. A def-driven face places all of
 * them except what the def hides; `renderCertBlock` still gates each on its fact being present.
 */
export const CERT_FACE_FIELDS = [
	'label',
	'authorName',
	'authorTitle',
	'reviewerPhoto',
	'bylineCredentialed',
	'bylinePlain',
	'bio',
	'memo',
	'profileLink',
	'certificateLink',
	'scopeLine',
	'compensationCue',
] as const

const MODES: readonly CertBlockMode[] = ['banner', 'sidebar', 'floating']

function isMode(v: unknown): v is CertBlockMode {
	return typeof v === 'string' && (MODES as readonly string[]).includes(v)
}

function text(v: unknown): string {
	return typeof v === 'string' ? v : ''
}

function optionalText(v: unknown): string | undefined {
	return text(v).trim() !== '' ? (v as string) : undefined
}

export interface EnvelopeCardOptions {
	/** The placement the entry/editor chose. A recognised mode wins over the def's layout. */
	readonly mode?: unknown
	/** Banner memo placement, passed through as on the options path. */
	readonly part?: unknown
}

/** The def's theme tokens as `renderCertBlock` theme input, with the accent ink derived. */
export function themeFromDef(def: CertChromeRenderDef | null): Partial<ResolvedBlockTheme> | undefined {
	const tokens = def?.tokens
	if (!tokens) return undefined
	const accentColor = optionalText(tokens.accentColor)
	return {
		accentColor,
		surface: optionalText(tokens.surface),
		cornerRadius: optionalText(tokens.cornerRadius),
		fontSlot: optionalText(tokens.fontSlot) as ResolvedBlockTheme['fontSlot'] | undefined,
		// The ink painted over the accent fill, derived the way the portal derives it, so a black
		// accent carries white ink. Omitted for an accent `resolveBlockTheme` would reject anyway.
		...(accentColor && isOpaqueHexColor(accentColor) ? { accentFg: accentFg(accentColor) } : {}),
		barInk: optionalText(tokens.barInk),
		inkColor: optionalText(tokens.inkColor),
	}
}

/** The face a def asks for: its custom composition, or every field minus the hideable ones it hides. */
export function faceFromDef(def: CertChromeRenderDef | null, layout: CertBlockLayout): CertBlockFace | undefined {
	if (!def) return undefined
	if (layout === 'custom') return { rung: def.rung, placedFields: [...(def.customFace?.placedFields ?? [])] }
	const hidden = new Set(def.hidden.filter((id) => (HIDEABLE_FIELDS as readonly string[]).includes(id)))
	return { rung: def.rung, placedFields: CERT_FACE_FIELDS.filter((id) => !hidden.has(id)) }
}

/**
 * The layout: an editor-chosen mode, else the def's own layout (a custom face only when the def
 * carries one), else banner, which is what the Shopify embed paints for a def with no layout and
 * what every exported Builder entry has painted since 0.5.
 */
export function layoutFor(def: CertChromeRenderDef | null, mode: unknown): CertBlockLayout {
	if (isMode(mode)) return mode
	if (def?.layout === 'custom' && def.customFace) return 'custom'
	if (isMode(def?.layout)) return def.layout
	return 'banner'
}

/** The fused credential label the envelope's verified credentials stand for, or '' (name-only). */
export function credentialLabel(expert: Record<string, unknown>): { credential: string; verifiedAt: string } | null {
	const verifiedAt = optionalText(expert.credentialVerifiedAt)
	if (!verifiedAt) return null
	const creds = Array.isArray(expert.credentials) ? expert.credentials : []
	const credential = creds
		.map((c) => {
			const rec = (typeof c === 'object' && c !== null ? c : {}) as Record<string, unknown>
			return optionalText(rec.cardLabel) ?? optionalText(rec.abbreviation)
		})
		.filter((l): l is string => l !== undefined)
		.join(', ')
	return credential ? { credential, verifiedAt } : null
}

/**
 * The exact `renderCertBlock` input for a verified envelope's content and the brand's def, or
 * null when the content cannot make a face.
 */
export function envelopeCardInput(
	content: CertContent,
	renderDef: CertChromeRenderDef | null,
	options: EnvelopeCardOptions = {},
): RenderCertBlockInput | null {
	const expert = (content?.expert ?? {}) as unknown as Record<string, unknown>
	const author = (content?.author ?? {}) as unknown as Record<string, unknown>
	const reviewerName = text(expert.displayName)
	const verifyUrl = text(content?.verifyUrl)
	if (!reviewerName || !verifyUrl) return null
	const cred = credentialLabel(expert)
	const layout = layoutFor(renderDef, options.mode)
	const face = faceFromDef(renderDef, layout)
	const theme = themeFromDef(renderDef)
	const part =
		options.part === 'full' || options.part === 'header' || options.part === 'memo' ? options.part : undefined
	return {
		mode: layout,
		...(theme ? { theme } : {}),
		...(face ? { face } : {}),
		...(part ? { part } : {}),
		responsive: true,
		facts: {
			authorName: optionalText(author.name) ?? 'Editorial',
			authorTitle: optionalText(author.title),
			reviewerName,
			credential: cred?.credential ?? '',
			credentialVerifiedAt: cred?.verifiedAt ?? '',
			certifiedAt: text(content.certifiedAt),
			memo: text(content.memo),
			bio: optionalText(expert.bio),
			profileUrl: text(expert.profileUrl),
			certificateUrl: verifyUrl,
			// Presence only: a cue string renders the locked constant; absent or null is pro-bono.
			compensationCue: optionalText(expert.compensationCue) ? undefined : null,
		},
	}
}
