/**
 * ─────────────────────────────────────────────────────────────────────────────
 * `CertReviewCard` — the ready-to-register Builder.io PUSH cert component (W1)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A headless brand registers `certRevCertComponent` in its Builder
 * `customComponents` and CertREV's exporter emits a block whose options are the
 * `BuilderCertChromeData` projection — so the visible cert chrome renders itself,
 * design-identical to the Shopify Liquid + WordPress PHP faces (same `renderCertBlock`
 * string renderer). This REPLACES the ~200-line hand-rolled component every headless
 * brand copied from the demo (POR-10721 W1).
 *
 * Improvements over the canary demo's hand-rolled version:
 *  - consumes the CANONICAL `BuilderCertChromeData` (the fused `credentialVerification`
 *    pair — a credential is UNCONSTRUCTIBLE without its dated verification), not the
 *    demo's stale separate `credential`/`credentialVerifiedAt` fields;
 *  - maps v2 `barInk`/`inkColor` into the theme (the demo predated brand-ink theming);
 *  - honors `display.showCredentials`.
 */

import { type CertBlockMode, renderCertBlock } from '../components/render-cert-block.js'
import type { ResolvedBlockTheme } from '../components/render-def.js'
import type { BuilderCertChromeData } from './cert-chrome-data.js'
import { BUILDER_CERT_CHROME_KEYS } from './cert-chrome-data.js'

/**
 * The canonical Builder block name. A brand's registration + the portal
 * `certComponent` connection field default to THIS; config exists only for
 * deviation (portal `client-for-brand.ts` gains the default in a follow-up).
 */
export const CERT_COMPONENT_NAME = 'CertREV Cert'

export interface CertReviewCardProps extends Partial<BuilderCertChromeData> {
	/** Placement face — the ENTRY/editor chooses this, NOT the exporter (not a wire-type field). */
	mode?: CertBlockMode | null
	/**
	 * Banner memo placement (not a wire-type field — the ENTRY/editor chooses it). Passed
	 * straight through to `renderCertBlock`'s first-class `part` (POR-10741): `'full'`
	 * (default) renders header + memo in one block; `'header'`/`'memo'` render only that
	 * card so the memo can be placed as its own block under the article body. The old
	 * string-splitting shim is gone — `renderCertBlock` composes each part directly.
	 */
	part?: 'full' | 'header' | 'memo' | null
}

export function CertReviewCard(props: CertReviewCardProps) {
	const { reviewerName, verifyUrl } = props
	if (!reviewerName || !verifyUrl) return null // no chrome pre-cert

	// The credential + its verification date arrive ONLY as the fused pair, so we can
	// never obtain one without the other (name-only face when the pair is null, or when
	// the brand set showCredentials:false). This IS the R1 gate, enforced by the type.
	const cv = props.credentialVerification ?? null
	const showCred = props.display?.showCredentials !== false
	const withCred = cv && showCred ? cv : null

	const tokens = props.renderDef?.tokens
	const theme: Partial<ResolvedBlockTheme> | undefined = tokens
		? {
				accentColor: tokens.accentColor,
				surface: tokens.surface,
				cornerRadius: tokens.cornerRadius,
				fontSlot: tokens.fontSlot as ResolvedBlockTheme['fontSlot'] | undefined,
				// v2 brand-ink (post-demo): the bar + free-content ink follow the def.
				barInk: tokens.barInk,
				inkColor: tokens.inkColor,
			}
		: undefined

	const html = renderCertBlock({
		mode: (props.mode as CertBlockMode) ?? 'banner',
		theme,
		// First-class banner memo split (POR-10741) — renderCertBlock composes the requested
		// part directly; no string-splitting. Ignored outside banner mode.
		...(props.part ? { part: props.part } : {}),
		facts: {
			authorName: props.authorName ?? 'Editorial',
			authorTitle: props.authorTitle ?? undefined,
			reviewerName,
			credential: withCred ? withCred.credential : '',
			credentialVerifiedAt: withCred ? withCred.verifiedAt : '',
			certifiedAt: props.certifiedAt ?? '',
			memo: props.memo ?? '',
			bio: props.bio ?? undefined,
			profileUrl: props.reviewerProfileUrl ?? '',
			certificateUrl: verifyUrl,
			// Locked strings default byte-verbatim inside renderCertBlock; pass the
			// delivered cue/scope through so a pro-bono (null-cue) delivery is honored.
			...(props.compensationCue ? { compensationCue: props.compensationCue } : {}),
			...(props.scopeLine ? { scopeLine: props.scopeLine } : {}),
		},
	})

	return (
		<div
			data-certrev-cert-chrome=""
			data-certrev-strings-version={props.stringsVersion ?? undefined}
			data-certrev-def-version={props.renderDef?.v ?? undefined}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: renderCertBlock is the escaping-safe SSR string renderer
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder.io registration — inputs SINGLE-SOURCED from the wire-type keys (W1/W3)
// ─────────────────────────────────────────────────────────────────────────────

/** The subset of the Builder.io input schema this kit emits. */
export interface BuilderInput {
	readonly name: string
	readonly type: 'string' | 'longText' | 'object' | 'boolean' | 'number'
	readonly friendlyName?: string
	readonly helperText?: string
	/** Tucks the input under the editor's "Advanced" reveal (Builder's `Input.advanced`). */
	readonly advanced?: boolean
}

/** Builder input TYPE per wire-type key — the exporter serializes these option values. */
const WIRE_INPUT_TYPE: Record<(typeof BUILDER_CERT_CHROME_KEYS)[number], BuilderInput['type']> = {
	bylineCredentialed: 'string',
	credentialVerification: 'object',
	bylinePlain: 'string',
	reviewerName: 'string',
	bio: 'longText',
	background: 'longText',
	memo: 'longText',
	compensationCue: 'string',
	scopeLine: 'string',
	reviewerPhoto: 'string',
	reviewerProfileUrl: 'string',
	verifyUrl: 'string',
	certifiedAt: 'string',
	contentModifiedAt: 'string',
	authorName: 'string',
	authorTitle: 'string',
	display: 'object',
	renderDef: 'object',
	stringsVersion: 'string',
}

/**
 * The wire-type inputs — DERIVED from `BUILDER_CERT_CHROME_KEYS`, so the 19-field
 * option set can never drift from the type (the W3 lock asserts name-parity). This
 * kills the demo's hand-maintained 17-entry array.
 */
export const WIRE_INPUTS: readonly BuilderInput[] = BUILDER_CERT_CHROME_KEYS.map((name) => ({
	name,
	type: WIRE_INPUT_TYPE[name],
	// Exporter-populated wire fields: collapsed under the editor's "Advanced" reveal so the
	// Options tab leads with the two placement choices an editor actually makes (mode/part).
	advanced: true,
}))

/** Placement inputs — chosen by the entry/editor, NOT emitted by the exporter (not wire-type keys). */
export const PLACEMENT_INPUTS: readonly BuilderInput[] = [
	{
		name: 'mode',
		type: 'string',
		friendlyName: 'Placement',
		helperText: 'banner (default) · sidebar · floating',
	},
	{ name: 'part', type: 'string', friendlyName: 'Banner part', helperText: 'full (default) · header · memo' },
]

/** A Builder.io custom-component registration (the general shape; the anchor uses the same). */
export interface CertBlockBuilderRegistration {
	readonly name: string
	readonly component: typeof CertReviewCard
	readonly inputs: readonly BuilderInput[]
}

/**
 * The canonical registration data (readonly view). Most consumers want
 * `certRevCertComponent` below — drop-in ready for the gen2 SDK's `customComponents`
 * array. This readonly view remains for consumers that build their own entry
 * (`inputs` must be spread — `[...BUILDER_REGISTRATION.inputs]` — because the gen2
 * SDK's `RegisteredComponent.inputs` type is mutable).
 * The exporter-emitted option keys === these `inputs` === the wire type — locked by W3.
 */
export const BUILDER_REGISTRATION: CertBlockBuilderRegistration = {
	name: CERT_COMPONENT_NAME,
	component: CertReviewCard,
	inputs: [...PLACEMENT_INPUTS, ...WIRE_INPUTS],
}

/**
 * Structural shape of the gen2 SDK's `RegisteredComponent` — the subset the PUSH kit
 * populates, with the MUTABLE `inputs` array the SDK's type requires. Declared locally
 * (same pattern as `CertRevBuilderRegistration` on the anchor path) so cert-block needs
 * no Builder dependency; directly assignable at `<Content customComponents={[...]}>`.
 */
export interface CertReviewCardRegisteredComponent {
	component: typeof CertReviewCard
	name: string
	description?: string
	inputs: BuilderInput[]
}

/**
 * Ready-to-register: `customComponents={[...yourComponents, certRevCertComponent]}` —
 * one import, no re-wrapping, no spread. Carries the identical W3-locked input set as
 * `BUILDER_REGISTRATION` in a FRESH mutable array (the two never share an instance, so
 * an SDK-side mutation can never corrupt the canonical readonly view).
 */
export const certRevCertComponent: CertReviewCardRegisteredComponent = {
	name: CERT_COMPONENT_NAME,
	component: CertReviewCard,
	description:
		'CertREV expert-review cert card. Options are populated by the CertREV exporter — editors choose placement (mode/part) only.',
	inputs: [...PLACEMENT_INPUTS, ...WIRE_INPUTS],
}
