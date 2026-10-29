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
import { CERT_STRINGS_VERSION } from '../components/render-def.js'
import { type CertPayload, renderVerdict } from '../contract/kernel.js'
import {
	type DeliveredFace,
	type DesignPin,
	getVerifiedDelivery,
	parseDesignPin,
	readVerifiedDelivery,
	rememberDeliveryUnreachable,
	unreachableDelivery,
	type VerifiedDelivery,
} from '../verify/get-verified-delivery.js'
import {
	acceptedCardBinding,
	type CardBinding,
	type CardDocumentV1,
	type CardPartName,
	cardDigestFor,
	cardDigestMatches,
	cardMatchesPlacement,
	cardPartsFor,
	parseCardDocument,
} from './card-contract.js'
import { CARD_READER_CSS } from './card-reader-css.js'
import {
	CARD_FALLBACK_REASONS,
	type CardFallbackDetail,
	type CardFallbackReason,
	reportCardFallbackInBrowser,
	reportCardFallbackOnServer,
} from './card-report.js'
import type { BuilderCertChromeData, CertChromeRenderDef } from './cert-chrome-data.js'
import { BUILDER_CERT_CHROME_KEYS } from './cert-chrome-data.js'
import { ContractCardFace } from './contract-card.js'
import {
	type DeliveredFaceHashes,
	deliveredFaceDigest,
	deliveredFaceHtml,
	deliveredFaceMatches,
	faceHashesFor,
	showsWholeCard,
} from './delivered-face.js'
import { cardDeliveryRuntime, cardResolveKidFor } from './delivery-runtime.js'
import { envelopeCardHtml, envelopeCardInput, isReaderFaceDef } from './envelope-face.js'
import {
	type PageRecord,
	pageHoldsServerHtml,
	pageRecordFor,
	SEED_ATTRIBUTE,
	seedFor,
	serializeFallback,
	serializeSeed,
	streamedRecordFor,
	subscribeStreamedRecords,
	watchStreamedRecords,
	withoutPhotos,
} from './ssr-seed.js'

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
	 *
	 * 1.2.0-canary.5: `context` is Builder `<Content>`'s own `context` prop. Only `certrevDesignPin` is read: the design
	 * pin CertREV's canary replica passes (`designPinFromUrl(request.url)`). Production brands never set it.
	 */
	builderContext?: {
		readonly content?: { readonly id?: unknown } | null
		readonly context?: { readonly certrevDesignPin?: unknown } | null
	} | null
	/**
	 * A Delivery read FROM THE BROWSER for a card the server did not render (a client-side navigation, Builder's editor).
	 * 2.0.0: ON by default (absent or `true`): it is the only way CertREV's server-rendered card exists after an in-app
	 * navigation, and it needs the Delivery API's origin (`https://portal.certrev.com`) in the page's `connect-src`, one
	 * of the four CSP sources 2.0 asks for. A read the policy blocks is a read that did not reach CertREV: nothing, and a
	 * reported `delivery_unreachable` (2.0.1; 2.0.0 painted the block's options face). `false`: no request from the
	 * browser, and such a card prints nothing and reports `client_read_off`. Not a Builder input: a brand sets it in code,
	 * on a wrapper of this component.
	 */
	clientRead?: boolean
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
 * way the retry finds the settled read in the cache through `readVerifiedDelivery`, so it never
 * suspends on a second promise.
 *
 * 2.0.2, on a server (`suspendOnServer`): the render waits at most the runtime's `serverWaitMs` (300 ms). Past it, the
 * placement's failure is remembered in the cache (so every render in the failure window answers at once, even where the
 * runtime abandons the read when the response ends), the render prints nothing (`delivery_unreachable`), and the read
 * runs on: when it lands, the next render paints it. A render that finds the placement's read already in flight from an
 * earlier task (another request) never waits on it and prints nothing at once. Cards rendered in the task that started
 * the read (two cards of one placement in one page's render pass, which React's server renderer runs synchronously)
 * share it, and wait at most what is left of its deadline.
 */
interface InflightRead {
	readonly promise: Promise<VerifiedDelivery>
	readonly turn: number
}
const inflightReads = new Map<string, InflightRead>()

/** The current task's number: it changes once the task (and its microtasks) has run. */
let turn = 0
let turnOpen = false
function currentTurn(): number {
	if (!turnOpen) {
		turnOpen = true
		turn += 1
		queueMicrotask(() => {
			turnOpen = false
		})
	}
	return turn
}

function suspendOn(key: string, start: () => Promise<VerifiedDelivery>): VerifiedDelivery {
	let pending = inflightReads.get(key)
	if (!pending) {
		const promise = start().finally(() => inflightReads.delete(key))
		pending = { promise, turn: currentTurn() }
		inflightReads.set(key, pending)
	}
	return suspendUntil(pending.promise)
}

function suspendOnServer(
	key: string,
	read: Parameters<typeof getVerifiedDelivery>[0],
	waitMs: number | undefined,
): VerifiedDelivery {
	const pending = inflightReads.get(key)
	if (pending && pending.turn !== currentTurn()) return unreachableDelivery()
	return suspendOn(key, () => {
		const loaded = getVerifiedDelivery(read)
		if (waitMs === undefined || !Number.isFinite(waitMs) || waitMs <= 0) return loaded
		return new Promise<VerifiedDelivery>((resolve) => {
			const timer = setTimeout(() => {
				rememberDeliveryUnreachable(read)
				resolve(unreachableDelivery())
			}, waitMs)
			loaded.then(
				(settled) => {
					clearTimeout(timer)
					resolve(settled)
				},
				() => {
					clearTimeout(timer)
					resolve(unreachableDelivery())
				},
			)
		})
	})
}

/** `use` where React has it (19), else the thrown promise (18). */
function suspendUntil<T>(pending: Promise<T>): T {
	const use = (React as unknown as { use?: <U>(p: Promise<U>) => U }).use
	if (typeof use === 'function') return use(pending)
	throw pending
}

/**
 * 1.3.0: a delivered face's two digests, suspending once while WebCrypto computes them (`faceHashesFor` memoizes them
 * by the face's content, so every later render of the same face, server or browser, reads them at once).
 */
function suspendOnFaceHashes(face: DeliveredFace): DeliveredFaceHashes | null {
	const memo = faceHashesFor(face)
	return memo.settled ? memo.settled.hashes : suspendUntil(memo.pending)
}

/**
 * 1.2.0-canary.6: the reader sidebar card is a right float that the article's copy flows around, as it does on a
 * WordPress or Shopify page. On a Builder page the card sits in its own block, a flex item of the flex column that holds
 * the page's blocks, and a flex item is a formatting context of its own: it contains the float, so the block spans the
 * whole column at the aside's height and no copy can sit beside the aside. These rules let the float out of its block,
 * and only there: in a column that holds a reader SIDEBAR card, at the widths where the sidebar floats (above the reader
 * CSS's own 820px breakpoint, below which it stacks as a plain block), the column lays its blocks out as blocks and
 * still contains the float (`flow-root`), and the card's block and the face's wrapper become plain blocks, so they take
 * no height and the aside is the box the copy flows around. A column with no reader sidebar, the stacked widths, and a
 * browser with no `:has()` keep exactly what they had.
 */
export const BUILDER_SIDEBAR_FLOW_CSS =
	'@media not all and (max-width: 820px){' +
	'.builder-blocks:has(> .builder-block > [data-certrev-face="reader"] > .certrev-reader > .certrev-r-side){display:flow-root !important}' +
	'.builder-blocks > .builder-block:has(> [data-certrev-face="reader"] > .certrev-reader > .certrev-r-side){display:block !important}' +
	'.builder-blocks > .builder-block > [data-certrev-face="reader"]:has(> .certrev-reader > .certrev-r-side){display:block !important}' +
	'}'

/** A reader face, with the sidebar flow rules beside it (`BUILDER_SIDEBAR_FLOW_CSS`); any other face, as it is. */
function withSidebarFlow(reader: boolean | undefined, face: React.ReactElement): React.ReactElement {
	if (!reader) return face
	return (
		<>
			{face}
			{/* biome-ignore lint/security/noDangerouslySetInnerHtml: a package constant; React would escape the `>` and `"` of its selectors */}
			<style data-certrev-builder-flow="" dangerouslySetInnerHTML={{ __html: BUILDER_SIDEBAR_FLOW_CSS }} />
		</>
	)
}

/**
 * The painted envelope face, with the phone memo toggle bound. One native click listener on the
 * wrapper (delegated, so it survives a re-render of the HTML) flips the memo box the button sits
 * in; the button is native, so Enter and Space reach it as clicks. Bound after hydration only: the
 * server HTML is the collapsed face, which is also what a reader without JS keeps (the whole memo
 * is still in the text for a screen reader, and the desktop never clamps it).
 *
 * `reader` (1.2.0) is true ONLY for a def whose `face` is `'reader'`; it adds three things and nothing to any other
 * face: `data-certrev-face="reader"` and `display: flow-root` on the wrapper, and (1.2.0-canary.6) the sidebar flow
 * rules beside it (`BUILDER_SIDEBAR_FLOW_CSS`). The reader sidebar card is a right float. On a Shopify page the
 * placement script and its wrapper contain it. On a Builder page the wrapper contains it wherever the flow rules do not
 * apply (the reader CSS's stacked widths, a browser with no `:has()`); where they do, the float leaves its block and
 * the page's copy flows beside it.
 */
function EnvelopeFace(props: {
	readonly html: string
	readonly defVersion: number | undefined
	readonly reader?: boolean
	/** 1.3.0: the server-rendered face the signed digest binds (`DeliveredEnvelopeFace`); never with `reader`. */
	readonly delivered?: boolean
	/** The envelope seed (`ssr-seed.ts`): what a browser hydrating this face paints from, with no read of its own. */
	readonly seed: string
	/** 1.2.0, reader faces: told which person's photo the browser could not load (`ReaderEnvelopeFace`). */
	readonly onBrokenPhoto?: (person: PhotoPerson) => void
}) {
	const ref = React.useRef<HTMLDivElement>(null)
	const { onBrokenPhoto } = props
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
	React.useEffect(() => {
		const el = ref.current
		if (!el || !onBrokenPhoto) return
		// A photo that failed before this effect ran (during hydration) has no error event left to hear.
		for (const img of Array.from(el.querySelectorAll('.certrev-r-face > img'))) {
			if (img instanceof HTMLImageElement && img.complete && img.naturalWidth === 0) onBrokenPhoto(photoPerson(img))
		}
		// An image's `error` does not bubble, so it is heard in the capture phase.
		const onError = (e: Event) => {
			const img = e.target
			if (img instanceof HTMLImageElement && img.parentElement?.classList.contains('certrev-r-face')) {
				onBrokenPhoto(photoPerson(img))
			}
		}
		el.addEventListener('error', onError, true)
		return () => el.removeEventListener('error', onError, true)
	}, [onBrokenPhoto])
	return withSidebarFlow(
		props.reader,
		<div
			ref={ref}
			data-certrev-cert-chrome=""
			// Marks a face painted from the verified envelope (the migration dry-run and crawl monitor
			// tell the two faces apart by it). The strings are the package's locked constants here.
			data-certrev-delivery=""
			data-certrev-strings-version={CERT_STRINGS_VERSION}
			data-certrev-def-version={props.defVersion}
			{...{ [SEED_ATTRIBUTE]: props.seed }}
			{...(props.reader
				? { 'data-certrev-face': 'reader', style: { display: 'flow-root' } }
				: props.delivered
					? { 'data-certrev-face': 'delivered' }
					: {})}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: renderCertBlock is the escaping-safe SSR string renderer; a delivered face paints only when its bytes hash to the signed faceDigest
			dangerouslySetInnerHTML={{ __html: props.html }}
		/>,
	)
}

type PhotoPerson = 'expert' | 'author'

/**
 * Whose avatar a broken photo is. The banner's two bylines take the same face (1.3.1; the author's was the small
 * `.certrev-r-face.sm` before), so the person is read from the byline: the author's carries the plain "Written by"
 * role, the reviewer's "Reviewed by" (`.on`), and the sidebar's and the memo's reviewer has no role at all.
 */
function photoPerson(img: HTMLImageElement): PhotoPerson {
	return img.closest('.certrev-r-by')?.querySelector('.certrev-r-role:not(.on)') ? 'author' : 'expert'
}

interface EnvelopeCardProps {
	readonly baseUrl: string
	readonly externalId: string
	readonly mode: unknown
	readonly part: unknown
	readonly design?: DesignPin
	/** The block's own options: the face painted when CertREV could not be reached, or with no server render. */
	readonly block: CertReviewCardProps
	readonly clientRead: boolean
}

/**
 * 1.2.0-canary.5: a pinned read paints only the design it pinned, a reader def at exactly that version. A def served
 * for anything else (none, another face, another version) paints nothing, never the live design in its place.
 */
function pinnedDefHolds(design: DesignPin | undefined, renderDef: CertChromeRenderDef | null): boolean {
	return !design || (isReaderFaceDef(renderDef) && renderDef?.v === design.version)
}

/**
 * 1.2.0: the reader face, repainted with the reviewer's (or the author's) initials when the browser cannot load their
 * photo: a brand's CSP `img-src` that does not name the photo's host, a 404. The first paint is the server's, photo
 * included, so hydration matches; a photo that fails is dropped from the payload this face paints
 * (`withoutPhotos`), and the face's own avatar rule paints the initials in its place. The seed is not touched.
 */
function ReaderEnvelopeFace(props: {
	readonly payload: CertPayload
	readonly renderDef: CertChromeRenderDef
	readonly card: EnvelopeCardProps
	readonly seed: string
}) {
	const [broken, setBroken] = React.useState<readonly PhotoPerson[]>([])
	const onBrokenPhoto = React.useCallback(
		(person: PhotoPerson) => setBroken((was) => (was.includes(person) ? was : [...was, person])),
		[],
	)
	const payload = broken.length > 0 ? withoutPhotos(props.payload, broken) : props.payload
	const reader = envelopeCardHtml(payload.content, props.renderDef, {
		mode: props.card.mode,
		part: props.card.part,
		certId: payload.certId,
	})
	if (!reader) return null
	return (
		<EnvelopeFace
			reader
			// The stylesheet rides inside the face, once per card: the portal's reader CSS less its remote font
			// faces (card-reader-css.ts), so the card asks the page's CSP for nothing.
			html={`<style data-certrev-reader-css>${CARD_READER_CSS}</style>${reader}`}
			defVersion={props.renderDef.v}
			seed={props.seed}
			onBrokenPhoto={onBrokenPhoto}
		/>
	)
}

/**
 * 1.3.0: the delivered face this paint may use, or undefined (paint what 1.2.1 paints). Only for an unpinned card on a
 * block that shows the whole card, a digest the verified content signs for the def's version, and a face whose UTF-8
 * bytes hash to it (`delivered-face.ts`). Suspends once while WebCrypto hashes a face it has not seen.
 */
function deliveredFaceFor(
	payload: CertPayload,
	renderDef: CertChromeRenderDef | null,
	face: DeliveredFace | undefined,
	props: EnvelopeCardProps,
	/** 2.0.0: the hashes the read computed (`VerifiedDelivery.faceHashes`): then nothing suspends here. */
	hashed?: DeliveredFaceHashes | null,
): DeliveredFace | undefined {
	if (!face || props.design || !showsWholeCard(props.part)) return undefined
	const digest = deliveredFaceDigest(payload.content, renderDef, face)
	if (!digest) return undefined
	const hashes = hashed !== undefined ? hashed : suspendOnFaceHashes(face)
	return deliveredFaceMatches(hashes, digest) ? face : undefined
}

/**
 * 1.3.0: the delivered face, in the card's own wrapper (the same attributes as any envelope face, and
 * `data-certrev-face="delivered"`): the server's stylesheet, then its markup. `seed` is the record that names it.
 */
function DeliveredEnvelopeFace(props: {
	readonly face: DeliveredFace
	readonly defVersion: number
	readonly seed: string
}) {
	return <EnvelopeFace delivered html={deliveredFaceHtml(props.face)} defVersion={props.defVersion} seed={props.seed} />
}

/**
 * 1.3.0: what a card hydrating a seed that names a delivered face renders when the browser's own check of that face
 * fails (no WebCrypto: an insecure context; or bytes that do not hash to the seed's digest). The server painted the
 * delivered face there, and the browser must not render that markup, so this adopts the server's element as it stands
 * (no attribute or innerHTML compared: `suppressHydrationWarning`; no children hydrated: `dangerouslySetInnerHTML`)
 * and paints nothing of its own. The render right after hydration (at the browser's clock) is another component, so
 * React replaces this element with the face 1.2.1 paints for the seed.
 */
function ServerFaceUntilHydrated() {
	// biome-ignore lint/security/noDangerouslySetInnerHtml: an empty string; it only stops React hydrating the server's children
	return <div suppressHydrationWarning dangerouslySetInnerHTML={{ __html: '' }} />
}

/** Paint a verified payload with its def; null when the def and content give no face. */
function paintEnvelope(
	payload: CertPayload,
	renderDef: CertChromeRenderDef | null,
	props: EnvelopeCardProps,
	seed: string,
): React.ReactElement | null {
	if (!pinnedDefHolds(props.design, renderDef)) return null
	const defVersion = renderDef ? renderDef.v : undefined
	// The reader face is opt-in by the def's own `face` and is chosen HERE and nowhere else on this path; every other
	// def (no face, an unknown face) falls through to the legacy lines below, untouched since 1.1.1.
	if (isReaderFaceDef(renderDef) && renderDef) {
		// Without a face there is nothing to repaint; checked here so the null stays this function's answer.
		if (!envelopeCardHtml(payload.content, renderDef, { mode: props.mode, part: props.part, certId: payload.certId }))
			return null
		return <ReaderEnvelopeFace payload={payload} renderDef={renderDef} card={props} seed={seed} />
	}
	const input = envelopeCardInput(payload.content, renderDef, { mode: props.mode, part: props.part })
	if (!input) return null
	return <EnvelopeFace html={renderCertBlock(input)} defVersion={defVersion} seed={seed} />
}

/** Where the server painted no face, an empty hidden element carries the record that says so. */
function NoFace(props: { readonly record: string }) {
	return <div hidden {...{ [SEED_ATTRIBUTE]: props.record }} />
}

/**
 * 2.0.0: reports one fallback (`card-report.ts`) and renders nothing (no element, no marker: it changes no byte of the
 * page). On a server it reports as it renders; in a browser, once it has mounted. 2.0.1: the report is also a beacon to
 * `origin`, the delivery origin the block reads (none: CertREV's production origin).
 */
function FallbackReport(props: {
	readonly detail: CardFallbackDetail
	readonly server: boolean
	readonly origin?: string
}) {
	const { detail, server, origin } = props
	if (server) reportCardFallbackOnServer(detail, origin)
	React.useEffect(() => {
		reportCardFallbackInBrowser(detail, origin)
	}, [detail, origin])
	return null
}

/** A face with its fallback report beside it. */
function withReport(
	face: React.ReactElement | null,
	reason: CardFallbackReason,
	props: EnvelopeCardProps,
	server: boolean,
	certId?: string,
	status?: number,
): React.ReactElement {
	const detail: CardFallbackDetail = {
		reason,
		platform: 'builder',
		externalId: props.externalId,
		...(certId === undefined ? {} : { certId }),
		...(status === undefined ? {} : { status }),
	}
	return (
		<>
			{face}
			<FallbackReport detail={detail} server={server} origin={props.baseUrl} />
		</>
	)
}

/**
 * 2.0.0: what a contract-1 (or unsupported-contract) placement prints, decided by the SIGNED binding (`card-contract.ts`):
 * the card when the served document hashes to the signed digest and names this design version, certificate and
 * placement; else nothing, and the reason. Suspends once while WebCrypto hashes a document it has not seen.
 */
type ContractOutcome =
	| { readonly kind: 'card'; readonly card: CardDocumentV1; readonly names: CardPartName[] }
	| { readonly kind: 'none'; readonly reason?: CardFallbackReason }

function contractOutcome(
	binding: CardBinding | 'unsupported',
	rawCard: unknown,
	payload: CertPayload,
	props: EnvelopeCardProps,
	/** The digest the read computed (`VerifiedDelivery.cardDigest`): then nothing suspends here. */
	digested?: string | null,
): ContractOutcome {
	if (binding === 'unsupported') return { kind: 'none', reason: 'card_unsupported_contract' }
	// CertREV's replica pin: the signed card was painted for one design version; another pin gets nothing.
	if (props.design && props.design.version !== binding.defVersion) return { kind: 'none', reason: 'card_pin_mismatch' }
	if (rawCard === undefined || rawCard === null) return { kind: 'none', reason: 'card_missing' }
	const card = parseCardDocument(rawCard)
	if (!card || !cardMatchesPlacement(card, binding, payload, props.externalId)) {
		return { kind: 'none', reason: 'card_verify_failed' }
	}
	let digest: string | null
	if (digested !== undefined) {
		digest = digested
	} else {
		// A page's seed: the one suspension of this render (a render that read waits on nothing but its read).
		const memo = cardDigestFor(card)
		digest = memo.settled ? memo.settled.digest : suspendUntil(memo.pending)
	}
	if (!cardDigestMatches(digest, binding)) return { kind: 'none', reason: 'card_verify_failed' }
	// A block with nothing of this design to print (a memo block of a memo-less card, or of a sidebar design) prints
	// nothing, by design: not a fallback.
	const names = cardPartsFor(card, props.part)
	return names.length === 0 ? { kind: 'none' } : { kind: 'card', card, names }
}

/** The `'none'` record of a contract-1 placement, with its reason when it is a fallback. */
function contractNone(
	props: EnvelopeCardProps,
	reason: CardFallbackReason | undefined,
	server: boolean,
	certId: string,
): React.ReactElement {
	const record = serializeFallback({
		baseUrl: props.baseUrl,
		externalId: props.externalId,
		...(props.design ? { design: props.design } : {}),
		face: 'none',
		...(reason ? { reason } : {}),
	})
	const face = <NoFace record={record} />
	return reason ? withReport(face, reason, props, server, certId) : face
}

/**
 * What a card with no verified envelope paints: nothing, and a `'none'` record. 2.0.1: CertREV not reached prints
 * nothing too (it painted the block's export-time options through 2.0.0), and the record names `delivery_unreachable`
 * so the browser reports it as well (with CertREV's HTTP status when it answered with one); an unknown kid is reported as
 * `unknown_key`, and (2.0.1) an envelope that does not verify as `envelope_verify_failed`. A definitive no (revoked,
 * expired, for another entry, not found) prints nothing, by design, unreported.
 */
function settleWithoutEnvelope(
	props: EnvelopeCardProps,
	verdict: { readonly unreachable: boolean; readonly reason?: string; readonly status?: number },
	server: boolean,
): React.ReactElement {
	const reason: CardFallbackReason | undefined = verdict.unreachable
		? 'delivery_unreachable'
		: verdict.reason === 'unknown_key'
			? 'unknown_key'
			: verdict.reason !== undefined && ENVELOPE_VERIFY_FAILURES.has(verdict.reason)
				? 'envelope_verify_failed'
				: undefined
	const record = serializeFallback({
		baseUrl: props.baseUrl,
		externalId: props.externalId,
		...(props.design ? { design: props.design } : {}),
		face: 'none',
		...(reason ? { reason } : {}),
	})
	const none = <NoFace record={record} />
	return reason
		? withReport(none, reason, props, server, undefined, verdict.unreachable ? verdict.status : undefined)
		: none
}

/** 2.0.1: the kernel's suppress reasons that mean the envelope itself did not verify (reported, never silent). */
const ENVELOPE_VERIFY_FAILURES: ReadonlySet<string> = new Set([
	'invalid_signature',
	'unsupported_alg',
	'platform_mismatch',
	'content_drift',
	'unsupported_contract_version',
])

/**
 * Paint what the page's record for this placement says: a seed its envelope (judged at the browser's clock first when
 * `judge`), a `'none'` record nothing, and (2.0.1) a 2.0.0 server's `'options'` record nothing too.
 */
function paintRecord(
	record: PageRecord,
	props: EnvelopeCardProps,
	context: Parameters<typeof renderVerdict>[1],
	judge: boolean,
): React.ReactElement | null {
	if ('seed' in record) {
		if (judge) {
			try {
				if (renderVerdict(record.seed.payload, context).decision !== 'render') return null
			} catch {
				return null
			}
		}
		const { seed } = record
		// 2.0.0: a seed whose signed binding names a contract prints the card it carries, only after the browser has
		// checked it against that binding itself; otherwise nothing. Never a 1.3.1 face for such a placement.
		const binding = acceptedCardBinding(seed.payload.content)
		if (binding !== null) {
			const outcome = contractOutcome(binding, seed.card, seed.payload, props)
			if (outcome.kind === 'card')
				return <ContractCardFace card={outcome.card} names={outcome.names} seed={record.raw} origin={props.baseUrl} />
			// Hydrating over the card the server printed, which the browser could not confirm (no WebCrypto): adopt the
			// server's element; the render right after hydration prints nothing in its place.
			if (!judge && outcome.reason === 'card_verify_failed' && seed.card !== undefined)
				return <ServerFaceUntilHydrated />
			// Nothing of this design for this block (a memo block of a sidebar card): nothing, and no record of its own.
			if (outcome.reason === undefined) return null
			return contractNone(props, outcome.reason, false, seed.payload.certId)
		}
		// 1.3.0: a seed that names a delivered face repaints it only after the browser hashes it against the seed
		// payload's own digest; otherwise the seed paints what 1.2.1 paints for it.
		const delivered = deliveredFaceFor(seed.payload, seed.renderDef, seed.face, props)
		if (delivered && seed.renderDef) {
			return <DeliveredEnvelopeFace face={delivered} defVersion={seed.renderDef.v} seed={record.raw} />
		}
		// Hydrating (not `judge`) over the delivered face the server painted, which the browser could not confirm.
		if (seed.face && !judge) return <ServerFaceUntilHydrated />
		return paintEnvelope(seed.payload, seed.renderDef, props, record.raw)
	}
	const none = <NoFace record={record.raw} />
	// 2.0.1: an `'options'` record (a page a 2.0.0 server rendered while CertREV was not reached) prints nothing too.
	if (record.fallback.face === 'options') return withReport(none, 'delivery_unreachable', props, false)
	// 2.0.0: a contract-1 placement's record names why it printed nothing; the browser reports it too.
	const reason = record.fallback.reason
	return isFallbackReason(reason) ? withReport(none, reason, props, false) : none
}

function isFallbackReason(value: unknown): value is CardFallbackReason {
	return typeof value === 'string' && (CARD_FALLBACK_REASONS as readonly string[]).includes(value)
}

/** 2.0.1: a card the client mounts with no record and `clientRead` off prints nothing (2.0.0: the options face). */
function clientMountFace(props: EnvelopeCardProps): React.ReactElement {
	return withReport(null, 'client_read_off', props, false)
}

const pendingRecord = () => 'pending' as const

/**
 * 1.2.1: a card the client mounted while the page was still loading, with no record for its placement and no
 * `clientRead`: the server may still be streaming the record (`ssr-seed.ts`, "Records that stream in after the card
 * renders"). Nothing until the record arrives, then what it says, a seed judged at the browser's clock as for any card
 * past hydration; once the page has loaded with no record, what a client mount paints. It reads nothing.
 */
function StreamedRecordCard(props: EnvelopeCardProps) {
	const rt = cardDeliveryRuntime()
	// In render, not in an effect: the watch must hold the server's `<html>` before the commit that may remove it.
	watchStreamedRecords()
	const record = React.useSyncExternalStore(
		subscribeStreamedRecords,
		() => streamedRecordFor(props.baseUrl, props.externalId, props.design),
		pendingRecord,
	)
	if (record === 'pending') return null
	const context = { platform: 'builder', externalId: props.externalId, now: new Date(rt.now()) }
	// 2.0.0: the page loaded with no record for this placement: with `clientRead` (the default), the one read.
	if (record === 'done') return props.clientRead ? readAndPaint(props, context, true) : clientMountFace(props)
	return paintRecord(record, props, context, true)
}

const subscribeNever = () => () => {}

/**
 * True on a server and while a browser hydrates server HTML; false once the client has committed, and from the first
 * render of a card mounted on the client. React re-renders a hydrated card when this flips, so the card can paint
 * the server's tree first (no mismatch) and judge it at the browser's clock right after.
 *
 * It is true in BOTH of the first two cases and React gives a component no public way to tell them apart, so the card
 * does not ask React: see `EnvelopeCertReviewCard`.
 */
function useHydrating(): boolean {
	return React.useSyncExternalStore(
		subscribeNever,
		() => false,
		() => true,
	)
}

/**
 * 1.2.0: the card never reads the Delivery API from the browser unless the brand opts in (`clientRead`), so a
 * storefront whose CSP `connect-src` does not name CertREV (e.l.f.'s live policy) never sees a request or a violation
 * from it, and a page never loses its card for want of one.
 *
 *  - Server: read (2.0.2: waiting at most `CARD_SERVER_WAIT_MS`, never behind another request's read; a fresh or stale-while-revalidating cache, or a remembered failure, first), verify and paint
 *    as through 1.1.1, and write a record of what it painted (`ssr-seed.ts`):
 *     - a verified envelope: its face and the envelope seed (less the fields the def hides, and with no signature if
 *       it hid any);
 *     - CertREV not reached (a timeout, a network error, a 5xx, a body that is not JSON) with no verified answer inside
 *       the stale window: nothing, and a `'none'` record naming `delivery_unreachable` (2.0.1; through 2.0.0 the
 *       block's own options face and an `'options'` record);
 *     - a definitive no (revoked, expired, unverifiable, for another entry, not found): nothing, and a `'none'` record
 *       on an empty hidden element.
 *  - Browser, the page carries this placement's record: paint what it says. A seed paints its envelope; while
 *    hydrating the server's verdict stands (the tree is the server's, byte for byte), and once hydrated the lifecycle
 *    and subject are judged at the browser's clock, so a card that expired since the server render is taken down. A
 *    `'none'` record, and (2.0.1) a 2.0.0 server's `'options'` record, print nothing. This holds when React renders the card
 *    again on the client after a hydration error elsewhere on the page: the record is still in the document (or in
 *    the page's memory of it), so the browser repaints the server's answer and reads nothing.
 *  - Browser, hydrating with no record: server HTML from before 1.2.0 painted nothing here, so nothing.
 *  - Browser, a card mounted on the client with no record (a client-side navigation to an article this page never
 *    server-rendered, Builder's editor): with `clientRead` (the default), the one read, settled exactly as on the
 *    server; with `clientRead={false}`, nothing (`client_read_off`; 2.0.0: the block's options face).
 *  - Browser, the same while the document is still loading (1.2.1; React rendered the card on the client before the
 *    server's streamed record arrived, `ssr-seed.ts`): nothing until the record arrives, then what it says; if the page
 *    loads without one, what a client mount does (`StreamedRecordCard`). `clientRead` reads as above.
 *
 * WHICH OF THE TWO FIRST CASES THIS RENDER IS (server or browser) is decided from what the render can observe, with
 * no switch a test could set. A server render and a hydration are both "hydrating" to React and both see a `document`
 * under jsdom, so `typeof document` alone calls a jsdom server render a browser, which is what 1.2.0-canary.5 got
 * wrong (its SSR painted `<!--$--><!--/$-->`). What differs between them is the one thing a hydration has and a server
 * render cannot: server-rendered HTML IN the document, in front of it. So:
 *  1. no `document`: a server (every real server render: Node, Workers, Oxygen, Bun);
 *  2. not hydrating: a browser (a client mount, or a card past its hydration);
 *  3. hydrating with a `document`: a browser only when the live document holds this placement's record, or any React
 *     Suspense boundary marker (`pageHoldsServerHtml`; the card's own Suspense leaves one). Otherwise it is a server
 *     render running beside a `document` (jsdom, a DOM shim): it reads and records as a server does, and never consults
 *     a record or the page's memory, so a long-lived shim process cannot paint one page's record into another's render.
 * The one case this cannot see is a server render that runs while the document still holds server-rendered React HTML
 * (a test or shim that hydrates a page and then renders another into the same document without clearing it): that
 * render is taken for a hydration. Clear the document between pages in such a harness.
 */
function EnvelopeCertReviewCard(props: EnvelopeCardProps) {
	const rt = cardDeliveryRuntime()
	const hydrating = useHydrating()
	// Latched at mount: this instance hydrated server HTML (as opposed to a client mount).
	const [hydratedMount] = React.useState(hydrating)
	// The clock is read per render, so the lifecycle is judged NOW, not when the envelope was fetched.
	const context = { platform: 'builder', externalId: props.externalId, now: new Date(rt.now()) }
	// Hydrating: the live document decides (the memory of an earlier page must not). Past hydration: the memory is the
	// record the hydration used, which the document still carries as well.
	const fromPage =
		typeof document === 'undefined'
			? undefined
			: pageRecordFor(props.baseUrl, props.externalId, props.design, { live: hydrating })
	const inBrowser = typeof document !== 'undefined' && (!hydrating || fromPage !== undefined || pageHoldsServerHtml())
	// 1.2.1, latched at mount: a client mount with no record and no `clientRead` while the page is still loading waits
	// for a record the server may still be streaming, for the card's whole life (so it never swaps components when the
	// record lands).
	// 2.0.0: whatever `clientRead` says: a card that read instead of waiting would miss the record the server streams.
	const [awaitsStream] = React.useState(
		() => inBrowser && !hydrating && fromPage === undefined && document.readyState === 'loading',
	)
	if (awaitsStream) return <StreamedRecordCard {...props} />
	if (inBrowser) {
		if (fromPage) return paintRecord(fromPage, props, context, !hydrating)
		if (hydratedMount) return null
		if (!props.clientRead) return clientMountFace(props)
	}
	return readAndPaint(props, context, inBrowser)
}

/**
 * The Delivery read and its paint: a server render's, or a browser's (`clientRead`). Suspends on the read, and (1.3.0)
 * on a delivered face's hashes or (2.0.0) on a card document's digest.
 */
function readAndPaint(
	props: EnvelopeCardProps,
	context: Parameters<typeof renderVerdict>[1],
	inBrowser: boolean,
): React.ReactElement | null {
	const rt = cardDeliveryRuntime()
	const { design } = props
	const read = {
		baseUrl: props.baseUrl,
		platform: 'builder',
		externalId: props.externalId,
		context,
		cache: rt.cache,
		design,
		resolveKid: cardResolveKidFor(rt, props.baseUrl),
		fetchImpl: rt.fetchImpl(),
		timeoutMs: rt.timeoutMs,
	}
	const key = design
		? `${props.baseUrl}|${props.externalId}|design=${design.version}|${design.brand ?? ''}`
		: `${props.baseUrl}|${props.externalId}`
	const settled =
		readVerifiedDelivery(read) ??
		(inBrowser ? suspendOn(key, () => getVerifiedDelivery(read)) : suspendOnServer(key, read, rt.serverWaitMs))
	if (settled.verdict.decision !== 'render') {
		return settleWithoutEnvelope(
			props,
			{
				unreachable: settled.unreachable === true,
				reason: settled.verdict.reason,
				...(settled.status === undefined ? {} : { status: settled.status }),
			},
			!inBrowser,
		)
	}
	// The face is painted from the seed's payload (what the def hides is already out of it), so the server's HTML and
	// the browser's, which paints from the seed, are the same bytes and neither holds a hidden field.
	const seed = seedFor({
		baseUrl: props.baseUrl,
		externalId: props.externalId,
		design,
		payload: settled.verdict.payload,
		signature: settled.signature,
		renderDef: settled.renderDef,
	})
	// 2.0.0: a placement whose signed binding names a contract prints CertREV's card, or nothing; never a face of its own.
	const binding = acceptedCardBinding(seed.payload.content)
	if (binding !== null) {
		const outcome = contractOutcome(binding, settled.card, seed.payload, props, settled.cardDigest)
		if (outcome.kind === 'card') {
			return (
				<ContractCardFace
					card={outcome.card}
					names={outcome.names}
					seed={serializeSeed({ ...seed, card: outcome.card as unknown as Readonly<Record<string, unknown>> })}
					origin={props.baseUrl}
				/>
			)
		}
		// Nothing of this design for this block, by design: nothing at all, and NO record. A record here would sit under the
		// same placement as the block that printed the card (a split header and memo pair) and, read last on hydration,
		// would take that block's card down (break-it B2).
		if (outcome.reason === undefined) return null
		return contractNone(props, outcome.reason, !inBrowser, seed.payload.certId)
	}
	// 1.3.0: the server-rendered face the Delivery API served beside the envelope, when its bytes hash to the digest the
	// verified payload signs; the seed then carries it, so the browser can repaint (and re-check) the same face.
	const delivered = deliveredFaceFor(seed.payload, seed.renderDef, settled.face, props, settled.faceHashes)
	if (delivered && seed.renderDef) {
		return (
			<DeliveredEnvelopeFace
				face={delivered}
				defVersion={seed.renderDef.v}
				seed={serializeSeed({ ...seed, face: delivered })}
			/>
		)
	}
	return paintEnvelope(seed.payload, seed.renderDef, props, serializeSeed(seed))
}

export function CertReviewCard(props: CertReviewCardProps) {
	// 1.1.0: a block that carries the delivery marker paints from the signed envelope and the brand's def, never from
	// the options beside it. 2.0.1: a block WITHOUT the marker (an entry exported before 1.1.0, a block dropped in by
	// hand) prints nothing at all and reports `no_marker`; through 2.0.0 it painted its export-time options (a reviewer
	// name, a credential, a memo, a verify link nobody had signed). A marker this client does not accept, or a block
	// with no Builder entry to read for, prints nothing and reports `marker_invalid`.
	// 1.2.0-canary.5: a design pin (CertREV's canary replica only) that cannot be read renders nothing.
	const design = parseDesignPin(props.builderContext?.context?.certrevDesignPin)
	if (design === 'invalid') return null
	const entryId = text(props.builderContext?.content?.id)
	if (props.delivery == null) return <BlockReport reason="no_marker" externalId={entryId} />
	const marker = acceptedDeliveryMarker(props.delivery)
	if (!marker || !entryId) return <BlockReport reason="marker_invalid" externalId={entryId} />
	return (
		<Suspense fallback={null}>
			<EnvelopeCertReviewCard
				baseUrl={marker.baseUrl}
				externalId={entryId}
				mode={props.mode}
				part={props.part}
				design={design}
				block={props}
				clientRead={props.clientRead !== false}
			/>
		</Suspense>
	)
}

/** 2.0.1: a block with nothing to read reports why, to CertREV's production origin (it has no delivery origin). */
function BlockReport(props: { readonly reason: CardFallbackReason; readonly externalId: string }) {
	const detail = React.useMemo<CardFallbackDetail>(
		() => ({ reason: props.reason, platform: 'builder', externalId: props.externalId }),
		[props.reason, props.externalId],
	)
	return <FallbackReport detail={detail} server={typeof document === 'undefined'} />
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
		'System-populated by CertREV. When set, the card shows the certificate CertREV serves for this entry, verified, in place of the other fields; if CertREV revokes it or it expires, the card shows nothing. If CertREV cannot be reached, or the page was not rendered on the server, the card shows the other fields. Do not edit.',
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
