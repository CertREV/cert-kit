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
 * brand copied from the demo.
 *
 * Improvements over the canary demo's hand-rolled version:
 *  - consumes the CANONICAL `BuilderCertChromeData` (the fused `credentialVerification`
 *    pair — a credential is UNCONSTRUCTIBLE without its dated verification), not the
 *    demo's stale separate `credential`/`credentialVerifiedAt` fields;
 *  - maps v2 `barInk`/`inkColor` into the theme (the demo predated brand-ink theming);
 *  - honors `display.showCredentials`.
 */

import * as React from 'react'
import { Suspense } from 'react'
import { memoToggleFor, toggleMemo } from '../components/memo-toggle.js'
import { type CertBlockMode, renderCertBlock } from '../components/render-cert-block.js'
import { CERT_STRINGS_VERSION, type ResolvedBlockTheme } from '../components/render-def.js'
import { getVerifiedDelivery, peekVerifiedDelivery, type VerifiedDelivery } from '../verify/get-verified-delivery.js'
import type { BuilderCertChromeData } from './cert-chrome-data.js'
import { BUILDER_CERT_CHROME_KEYS } from './cert-chrome-data.js'
import { cardDeliveryRuntime } from './delivery-runtime.js'
import { envelopeCardInput } from './envelope-face.js'

/**
 * The canonical Builder block name. A brand's registration + the portal
 * `certComponent` connection field default to THIS; config exists only for
 * deviation (portal `client-for-brand.ts` gains the default in a follow-up).
 */
export const CERT_COMPONENT_NAME = 'CertREV Cert'

export interface CertReviewCardProps extends Partial<BuilderCertChromeData> {
	/**
	 * Placement face — the ENTRY/editor chooses this, NOT the exporter (not a wire-type field).
	 *
	 * Absent ⇒ `banner`, via the compatibility bridge in the render body below. That is NOT the
	 * package default: a direct `renderCertBlock` caller omitting `mode` gets `sidebar`, and
	 * `sidebar` is the registered input's `defaultValue`, so blocks created in the editor carry
	 * an explicit `mode`. The bridge covers only entries exported before the exporter emitted
	 * `mode` at all, and is deleted once those are backfilled. See the render body for why.
	 */
	mode?: CertBlockMode | null
	/**
	 * Banner memo placement (not a wire-type field — the ENTRY/editor chooses it). Passed
	 * straight through to `renderCertBlock`'s first-class `part`: `'full'`
	 * (default) renders header + memo in one block; `'header'`/`'memo'` render only that
	 * card so the memo can be placed as its own block under the article body. The old
	 * string-splitting shim is gone — `renderCertBlock` composes each part directly.
	 */
	part?: 'full' | 'header' | 'memo' | null
	/**
	 * 1.1.0: what `@builder.io/sdk-react` passes because the registration sets
	 * `shouldReceiveBuilderProps: { builderContext: true }`. Only `content.id` is read: it is the
	 * Builder entry this block renders inside, which IS the Delivery placement's `externalId`, so a
	 * block copied onto another entry asks for that entry's cert and never shows this one's.
	 */
	builderContext?: { readonly content?: { readonly id?: unknown } | null } | null
}

/**
 * Coerce ONE untyped option to renderable text.
 *
 * `CertReviewCardProps` is erased at runtime and these options are authored in a VISUAL
 * EDITOR — a number, an object or an array can sit in any field, and `??` does nothing about
 * it (`props.memo ?? ''` forwards the number 42 happily). `renderCertBlock` reads its facts as
 * strings (`.trim()`, `.split()`), so a mistyped option threw INSIDE the SSR render; under
 * `renderToReadableStream` that aborts the whole article route with zero HTML. A value that is
 * not text is not copy, so it renders as nothing.
 */
function text(value: unknown): string {
	return typeof value === 'string' ? value : ''
}

/** The same rule where ABSENT and EMPTY are different renders (`authorTitle`, `bio`). */
function optionalText(value: unknown): string | undefined {
	return text(value) || undefined
}

/**
 * The fused credential pair — accepted ONLY when both halves are present AND both are strings.
 *
 * The R1 gate ("a credential never displays without its dated verification") is THIS FUNCTION,
 * not the type: the pair arrives as untyped CMS JSON, and the old truthiness check keyed the
 * whole pair off the OBJECT, so `{credential:'MD'}` forwarded `verifiedAt: undefined` into the
 * renderer and crashed. Anything malformed — a half pair, a bare string, an array, a number
 * where a date belongs — degrades to the name-only face, which is the honest render of a
 * delivery whose verification cannot be read.
 */
function fusedCredential(pair: BuilderCertChromeData['credentialVerification'] | undefined) {
	if (!pair || typeof pair !== 'object') return null
	const credential = text(pair.credential)
	const verifiedAt = text(pair.verifiedAt)
	return credential && verifiedAt ? { credential, verifiedAt } : null
}

/**
 * The delivery marker, accepted only as `{ v: 1, baseUrl }` with `baseUrl` an `https:` ORIGIN on
 * `certrev.com` or one of its subdomains (no path, query, credentials or port). Anything else is
 * null, and a block carrying a marker that is not accepted renders NOTHING: falling back to the
 * options would let an edit to the marker switch revocation off.
 */
export function acceptedDeliveryMarker(value: unknown): { readonly baseUrl: string } | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
	const { v, baseUrl } = value as { v?: unknown; baseUrl?: unknown }
	if (v !== 1 || typeof baseUrl !== 'string') return null
	let url: URL
	try {
		url = new URL(baseUrl)
	} catch {
		return null
	}
	if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
	if (url.pathname !== '/' || url.search || url.hash) return null
	const host = url.hostname.toLowerCase()
	if (host !== 'certrev.com' && !host.endsWith('.certrev.com')) return null
	return { baseUrl: url.origin }
}

/**
 * Suspend on a Delivery read. React 19 gets `use` with ONE promise per placement while it is in
 * flight; React 18 (no `use`) gets the promise thrown, the Suspense protocol it supports. Either
 * way the retry finds the settled read in the cache through `peekVerifiedDelivery`, so it never
 * suspends on a second promise.
 */
const inflightReads = new Map<string, Promise<VerifiedDelivery>>()
function suspendOn(key: string, start: () => Promise<VerifiedDelivery>): VerifiedDelivery {
	let pending = inflightReads.get(key)
	if (!pending) {
		pending = start().finally(() => inflightReads.delete(key))
		inflightReads.set(key, pending)
	}
	const use = (React as unknown as { use?: <T>(p: Promise<T>) => T }).use
	if (typeof use === 'function') return use(pending)
	throw pending
}

/**
 * The painted envelope face, with the phone memo toggle bound. One native click listener on the
 * wrapper (delegated, so it survives a re-render of the HTML) flips the memo box the button sits
 * in; the button is native, so Enter and Space reach it as clicks. Bound after hydration only: the
 * server HTML is the collapsed face, which is also what a reader without JS keeps (the whole memo
 * is still in the text for a screen reader, and the desktop never clamps it).
 */
function EnvelopeFace(props: { readonly html: string; readonly defVersion: number | undefined }) {
	const ref = React.useRef<HTMLDivElement>(null)
	React.useEffect(() => {
		const el = ref.current
		if (!el) return
		const onClick = (e: MouseEvent) => {
			const button = memoToggleFor(e.target)
			if (button && el.contains(button)) toggleMemo(button)
		}
		el.addEventListener('click', onClick)
		return () => el.removeEventListener('click', onClick)
	}, [])
	return (
		<div
			ref={ref}
			data-certrev-cert-chrome=""
			// Marks a face painted from the verified envelope (the migration dry-run and crawl monitor
			// tell the two faces apart by it). The strings are the package's locked constants here.
			data-certrev-delivery=""
			data-certrev-strings-version={CERT_STRINGS_VERSION}
			data-certrev-def-version={props.defVersion}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: renderCertBlock is the escaping-safe SSR string renderer
			dangerouslySetInnerHTML={{ __html: props.html }}
		/>
	)
}

function EnvelopeCertReviewCard(props: {
	readonly baseUrl: string
	readonly externalId: string
	readonly mode: unknown
	readonly part: unknown
}) {
	const rt = cardDeliveryRuntime()
	// The clock is read per render, so the lifecycle is judged NOW, not when the envelope was fetched.
	const context = { platform: 'builder', externalId: props.externalId, now: new Date(rt.now()) }
	const read = { baseUrl: props.baseUrl, platform: 'builder', externalId: props.externalId, context, cache: rt.cache }
	const settled =
		peekVerifiedDelivery(read) ??
		suspendOn(`${props.baseUrl}|${props.externalId}`, () =>
			getVerifiedDelivery({ ...read, resolveKid: rt.resolveKid, fetchImpl: rt.fetchImpl(), timeoutMs: rt.timeoutMs }),
		)
	// Revoked, expired, unverifiable, for another entry, or unreachable: nothing at all.
	if (settled.verdict.decision !== 'render') return null
	const input = envelopeCardInput(settled.verdict.payload.content, settled.renderDef, {
		mode: props.mode,
		part: props.part,
	})
	if (!input) return null
	return <EnvelopeFace html={renderCertBlock(input)} defVersion={settled.renderDef ? settled.renderDef.v : undefined} />
}

export function CertReviewCard(props: CertReviewCardProps) {
	// 1.1.0: a block that carries the delivery marker paints from the signed envelope and the
	// brand's def, never from the options beside it. No marker (every entry exported before 1.1.0)
	// takes the options path below, unchanged from 1.0.3.
	if (props.delivery != null) {
		const marker = acceptedDeliveryMarker(props.delivery)
		const entryId = text(props.builderContext?.content?.id)
		if (!marker || !entryId) return null
		return (
			<Suspense fallback={null}>
				<EnvelopeCertReviewCard baseUrl={marker.baseUrl} externalId={entryId} mode={props.mode} part={props.part} />
			</Suspense>
		)
	}

	const reviewerName = text(props.reviewerName)
	const verifyUrl = text(props.verifyUrl)
	if (!reviewerName || !verifyUrl) return null // no chrome pre-cert (or an unreadable delivery)

	// Name-only face when the pair is unreadable, or when the brand set showCredentials:false.
	const showCred = props.display?.showCredentials !== false
	const withCred = showCred ? fusedCredential(props.credentialVerification) : null

	const tokens = props.renderDef?.tokens
	const theme: Partial<ResolvedBlockTheme> | undefined = tokens
		? {
				accentColor: optionalText(tokens.accentColor),
				surface: optionalText(tokens.surface),
				cornerRadius: optionalText(tokens.cornerRadius),
				fontSlot: optionalText(tokens.fontSlot) as ResolvedBlockTheme['fontSlot'] | undefined,
				// v2 brand-ink (post-demo): the bar + free-content ink follow the def.
				barInk: optionalText(tokens.barInk),
				inkColor: optionalText(tokens.inkColor),
			}
		: undefined

	const html = renderCertBlock({
		// COMPATIBILITY BRIDGE, NOT THE DESIGN. Delete this fallback once the exporter emits an
		// explicit `mode` and existing entries have been backfilled; until then it must stay.
		//
		// `renderCertBlock` owns the ONE placement default (absent or unrecognised ⇒ sidebar) and
		// that decision STANDS: it is what a direct caller gets, and `sidebar` is the registered
		// input's `defaultValue`, so every block created in the editor from now on carries an
		// explicit `mode` and never reaches this line.
		//
		// The problem is the entries that already exist. `mode` is a PLACEMENT input, not one of
		// the 20 wire keys (`BUILDER_CERT_CHROME_KEYS`), and the exporter emits only the wire
		// projection (`options: { ...certData }`), so every entry exported to date has NO `mode`
		// key at all. Through 0.5.5 this line read `?? 'banner'` and those entries rendered the
		// banner face. Removing it in 1.0.0 did not give them the renderer's default in the
		// abstract; it silently repainted live pages from banner to sidebar, with no entry edit
		// and no version pin to protect them, because their install line is unpinned.
		//
		// So this is a bridge for pre-existing entries, NOT a reversal of the sidebar default.
		// The three-copies-of-a-default problem that motivated removing it is still real and is
		// still fixed: the helper text and the wire type's doc comment no longer name a default,
		// and this line names one only for input the renderer can no longer distinguish from a
		// deliberate choice. The exporter writing `mode` is what retires it.
		mode: props.mode ?? 'banner',
		theme,
		// First-class banner memo split — renderCertBlock composes the requested
		// part directly; no string-splitting. Ignored outside banner mode, and an unrecognised
		// value is normalised to 'full' there, same as `mode` — not here.
		...(props.part ? { part: props.part } : {}),
		facts: {
			authorName: optionalText(props.authorName) ?? 'Editorial',
			authorTitle: optionalText(props.authorTitle),
			reviewerName,
			credential: withCred?.credential ?? '',
			credentialVerifiedAt: withCred?.verifiedAt ?? '',
			certifiedAt: text(props.certifiedAt),
			memo: text(props.memo),
			bio: optionalText(props.bio),
			profileUrl: text(props.reviewerProfileUrl),
			certificateUrl: verifyUrl,
			// The compliance disclosures are CONSTANTS the renderer owns — a delivered cue is
			// IGNORED (an editor cannot retype the FTC copy into something friendlier), and the
			// scope line is not forwarded at all. The ONE thing honored is an explicit `null`:
			// the pro-bono reviewer has no compensation to disclose, so the cue is omitted
			// rather than replaced by the compensated constant (the modal already gets this
			// right — a card claiming "Compensated expert" over a volunteer is an FTC-facing
			// falsehood, not a cosmetic default).
			compensationCue: props.compensationCue === null ? null : undefined,
		},
	})

	return (
		<div
			data-certrev-cert-chrome=""
			// The two provenance stamps the crawl monitor reads — emitted ONLY when the delivery
			// carried the right type, so a mistyped option leaves the attribute off instead of
			// stamping "[object Object]" as a version.
			data-certrev-strings-version={optionalText(props.stringsVersion)}
			data-certrev-def-version={typeof props.renderDef?.v === 'number' ? props.renderDef.v : undefined}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: renderCertBlock is the escaping-safe SSR string renderer
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder.io registration — inputs SINGLE-SOURCED from the wire-type keys (W1/W3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The subset of the Builder.io input schema this kit emits. Every field below is verified
 * against `@builder.io/sdk-react`'s own `Input` declaration (`types/types/input.d.ts`, 5.2.7) —
 * a field the SDK ignores would be worse than none, because it READS as configured.
 */
export interface BuilderInput {
	readonly name: string
	readonly type: 'string' | 'longText' | 'object' | 'boolean' | 'number'
	readonly friendlyName?: string
	readonly helperText?: string
	/** The value Builder pre-fills a freshly-dropped block with (`Input.defaultValue`). */
	readonly defaultValue?: string
	/**
	 * Turns a `string` input into a DROPDOWN of exactly these choices (`Input.enum`). The SDK
	 * accepts bare strings or `{label, value}` pairs; the kit uses pairs so the editor reads a
	 * capitalised label while the component still receives its lowercase mode/part literal.
	 * The ARRAY is deliberately mutable (the entries are not): the SDK types `Input.enum` as a
	 * mutable array, and a `readonly` one here makes the whole registration un-assignable to
	 * `RegisteredComponent` — the same reason `inputs` itself is mutable below (verified by
	 * compiling this shape against the installed SDK's `RegisteredComponent`).
	 */
	readonly enum?: { readonly label: string; readonly value: string }[]
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
	delivery: 'object',
}

/**
 * The COMPLIANCE-COPY inputs, called what they are.
 *
 * `advanced: true` is only a UI fold, so an editor who opens "Advanced" sees these two beside
 * the rest and reads them as theirs to type in. They are NOT: the renderer paints the locked
 * `COMPENSATED_EXPERT_CUE` / `CERT_SCOPE_LINE` constants and ignores whatever is here. They
 * stay REGISTERED because they are wire-type keys — dropping them would change the contract
 * the portal exporter writes, and would strand the `null` that signals a pro-bono reviewer.
 * So the fix is truthful labelling, not removal.
 */
const WIRE_INPUT_HELPER_TEXT: Partial<Record<(typeof BUILDER_CERT_CHROME_KEYS)[number], string>> = {
	compensationCue:
		'System-populated by CertREV. Only its PRESENCE is read (absent = a pro-bono reviewer, so no cue renders); the cue itself is a locked constant, so editing this text changes nothing on the page, and clearing it does not remove the disclosure.',
	scopeLine:
		'System-populated by CertREV. The FTC scope line renders byte-verbatim from a locked constant: editing this text changes nothing on the page.',
	delivery:
		'System-populated by CertREV. When set, the card shows the certificate CertREV serves for this entry, verified, and ignores the other fields; if CertREV revokes it or it expires, the card shows nothing. Do not edit.',
}

/**
 * The wire-type inputs — DERIVED from `BUILDER_CERT_CHROME_KEYS`, so the 20-field
 * option set can never drift from the type (the W3 lock asserts name-parity). This
 * kills the demo's hand-maintained 17-entry array.
 */
export const WIRE_INPUTS: readonly BuilderInput[] = BUILDER_CERT_CHROME_KEYS.map((name) => ({
	name,
	type: WIRE_INPUT_TYPE[name],
	...(WIRE_INPUT_HELPER_TEXT[name] ? { helperText: WIRE_INPUT_HELPER_TEXT[name] } : {}),
	// Exporter-populated wire fields: collapsed under the editor's "Advanced" reveal so the
	// Options tab leads with the two placement choices an editor actually makes (mode/part).
	advanced: true,
}))

/**
 * Placement inputs — chosen by the entry/editor, NOT emitted by the exporter (not wire-type keys).
 *
 * `defaultValue` + `enum` are what make these two REAL choices in the editor: a dropdown of the
 * faces that exist, pre-filled with the same default the renderer applies. They were free-text
 * with no default before, so the only description of the default was the helper text — which had
 * drifted from the code (it advertised `banner`; the renderer's default is `sidebar`).
 */
export const PLACEMENT_INPUTS: readonly BuilderInput[] = [
	{
		name: 'mode',
		type: 'string',
		friendlyName: 'Placement',
		helperText: 'sidebar (default) · banner · floating',
		defaultValue: 'sidebar',
		enum: [
			{ label: 'Sidebar', value: 'sidebar' },
			{ label: 'Banner', value: 'banner' },
			{ label: 'Floating', value: 'floating' },
		],
	},
	{
		name: 'part',
		type: 'string',
		friendlyName: 'Banner part',
		// A full stop, not a middle dot: the dots already separate the three values, so a fourth
		// would read as a fourth option rather than as a qualifier on the list.
		helperText: 'full (default) · header · memo. Banner placement only.',
		defaultValue: 'full',
		enum: [
			{ label: 'Full (header + memo)', value: 'full' },
			{ label: 'Header only', value: 'header' },
			{ label: 'Memo only', value: 'memo' },
		],
	},
]

/** A Builder.io custom-component registration (the general shape; the anchor uses the same). */
export interface CertBlockBuilderRegistration {
	readonly name: string
	readonly component: typeof CertReviewCard
	readonly inputs: readonly BuilderInput[]
	/** 1.1.0: asks the SDK for `builderContext`, whose `content.id` the delivery path reads. */
	readonly shouldReceiveBuilderProps: { readonly builderContext: true }
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
	shouldReceiveBuilderProps: { builderContext: true },
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
	/**
	 * 1.1.0: `@builder.io/sdk-react`'s `RegisteredComponent.shouldReceiveBuilderProps`. The SDK then
	 * passes the `builderContext` prop, and the delivery path takes its placement from
	 * `builderContext.content.id`.
	 */
	shouldReceiveBuilderProps: { builderContext: boolean }
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
		'CertREV expert-review cert card. Options are populated by the CertREV exporter; editors choose placement (mode/part) only.',
	inputs: [...PLACEMENT_INPUTS, ...WIRE_INPUTS],
	shouldReceiveBuilderProps: { builderContext: true },
}
