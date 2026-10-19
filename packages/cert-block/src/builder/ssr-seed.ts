/**
 * The server render's envelope seed (1.2.0): what lets a hydrated delivery card paint with NO browser read.
 *
 * Through 1.1.1 the browser re-read the Delivery API for every card it hydrated, because nothing handed the server's
 * read to it. A storefront whose Content-Security-Policy `connect-src` does not name the CertREV origin (e.l.f.'s
 * Hydrogen store is one) blocked that read, the read settled as a suppress, and the card the server had painted
 * vanished. So the painted face now carries the envelope it was painted from, as one attribute on its wrapper:
 * `data-certrev-envelope` = `{ v: 1, baseUrl, externalId, design?, payload, signature?, renderDef }`. `payload` is the
 * signed envelope's payload as the Delivery API served it, less the fields the def hides (below); `renderDef` is the
 * def the face was painted with; `design` is the design pin the read was made with (the canary replica's `?design=N`),
 * present only on a pinned read. React escapes the attribute like any other, so no `<script>` and no CSP `script-src`
 * are involved.
 *
 * HIDDEN FIELDS ARE ABSENT FROM THE PAGE, NOT JUST FROM THE FACE. A def's `hidden` set (`reviewerPhoto`, `memo`) is the
 * brand's statement that the page does not show those fields; a seed that carried them would put the reviewer's photo
 * URL or the memo text in the page source all the same. So `withoutHiddenContent` removes them from the payload
 * BEFORE the card paints and before it serializes, and both the server's face and the browser's are painted from the
 * stripped payload (so they are identical, and a hidden memo is not on the page in either place):
 *  - `reviewerPhoto` hides `content.expert.photoUrl` and the author's `content.author.photoUrl` (the reader face paints
 *    the author's photo under the same switch);
 *  - `memo` hides `content.memo`.
 * `display.showExpertPhoto: false` is the payload's own switch for the same photos and is stripped the same way (the
 * portal never writes the URL for it either): both photo URLs go, as for `reviewerPhoto`, whatever the def hides.
 * `content.expert.compensationCue` is NEVER touched: the cue is a locked disclosure no def can hide, and the face
 * paints "Compensated expert" from it in the banner, the memo and the sidebar (the floating pill's own markup has
 * no disclosure line, as in the portal's snippets; its modal paints the cue from the same field).
 *
 * THE SIGNATURE IS LEFT OUT WHENEVER ANYTHING WAS STRIPPED. The signature signs the full payload, so a payload with a
 * field removed no longer verifies against it, and a seed that carried both would hand a verifier a pair that fails.
 * Leaving it out costs nothing: the browser never re-checks a seed's signature (next paragraph), it re-runs only
 * `renderVerdict` (lifecycle and subject) at its own clock, and neither reads a field the strip removes. A seed whose
 * payload was not stripped keeps the signature, so a verifier can still check the page's HTML against the issuer key.
 *
 * The browser trusts a seed as far as it trusts the server HTML the seed sits in: whoever can write that HTML can
 * already write any card they like, so the signature is NOT re-verified here (which would make hydration async, and
 * Ed25519 in WebCrypto is not in every browser). The client still re-runs the lifecycle and subject policy
 * (`renderVerdict`) at its own clock once hydration is done; `cert-review-card.tsx` does that.
 *
 * A PINNED CARD TAKES ONLY A SEED WITH THE SAME PIN (and an unpinned card only an unpinned one): the pin is part of
 * the seed's key, as it is part of the read's, so the canary replica's `?design=7` card never paints the design the
 * page carried for another version.
 *
 * WHEN THE SERVER HAD NO ENVELOPE TO PAINT (1.2.0) the same attribute carries a fallback record instead of a seed:
 * `{ v: 1, baseUrl, externalId, design?, face }`, where `face` is `'options'` (CertREV could not be reached, so the
 * server painted the block's own options face) or `'none'` (the server painted nothing: revoked, expired, unverifiable,
 * for another entry). A browser that renders the card again (hydration, or React's client re-render after a hydration
 * error elsewhere on the page) paints what the record says, so it neither reads the Delivery API nor shows a card the
 * server withheld. A record holds no payload, so `parseSeed` never takes one for a seed. A `'none'` record sits on a
 * `hidden` element with nothing in it.
 *
 * A DELIVERED FACE RIDES THE SEED (1.3.0), and only when the server painted it: the seed then ends with
 * `face: { html, css }`, the server-rendered markup and stylesheet the Delivery API served beside the envelope, whose
 * hashes the signed `payload.content.faceDigest` binds. A browser repaints that face from the seed only after hashing
 * it against the seed payload's digest itself (`cert-review-card.tsx`); a seed with no `face`, a malformed one, or one
 * whose hashes fail paints what 1.2.1 paints for it. A seed with no face is byte for byte the 1.2.1 seed. The face is
 * on the page twice (painted, and in the seed), which is its page-weight cost.
 *
 * React-free and browser-only in effect: with no `document` (a server) `pageSeedFor` finds nothing, so a server never
 * reads or keeps a seed and a multi-tenant render process holds nothing per page.
 */

import { HIDEABLE_FIELDS } from '../components/render-def.js'
import type { CertContent, CertPayload, CertSignature } from '../contract/kernel.js'
import {
	type DeliveredFace,
	type DesignPin,
	parseDeliveredFace,
	parseDesignPin,
	parseRenderDef,
} from '../verify/get-verified-delivery.js'
import type { CertChromeRenderDef } from './cert-chrome-data.js'

export const SEED_ATTRIBUTE = 'data-certrev-envelope'

export interface DeliverySeed {
	readonly baseUrl: string
	readonly externalId: string
	/** The design pin the read was made with; absent on an unpinned read (every production brand). */
	readonly design?: DesignPin
	/** The payload as painted: with every field the def hides removed (`withoutHiddenContent`). */
	readonly payload: CertPayload
	/**
	 * The envelope's signature as served; absent when the payload was stripped (it no longer verifies), and when a
	 * cache was filled by hand (a test, a custom cache).
	 */
	readonly signature?: CertSignature
	readonly renderDef: CertChromeRenderDef | null
	/**
	 * 1.3.0: the delivered face the server painted (the file header); absent whenever it painted anything else. On a
	 * seed read from the page it is UNVERIFIED until hashed against `payload.content.faceDigest`.
	 */
	readonly face?: DeliveredFace
}

/** A seed as read from the page: the parsed seed and the attribute's exact text (re-rendered verbatim on hydration). */
export interface PageSeed {
	readonly seed: DeliverySeed
	readonly raw: string
}

/** What the server painted with no verified envelope: the block's options face, or nothing. */
export type FallbackFace = 'options' | 'none'

/** The record a server writes where it had no envelope to paint (the file header). */
export interface DeliveryFallback {
	readonly baseUrl: string
	readonly externalId: string
	readonly design?: DesignPin
	readonly face: FallbackFace
}

/** A fallback record as read from the page, with the attribute's exact text. */
export interface PageFallback {
	readonly fallback: DeliveryFallback
	readonly raw: string
}

/** Whatever the server wrote for one placement: a seed or a fallback record. */
export type PageRecord = PageSeed | PageFallback

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A value worth hiding: anything but nothing (absent, null, the empty string). */
const hasValue = (v: unknown): boolean => v !== undefined && v !== null && v !== ''

/**
 * The payload with the named people's photo URLs removed (`null`); the same object when neither had one. The card uses
 * it for a photo the browser could not load (a brand's CSP `img-src`, a 404), so the face repaints with the initials.
 */
export function withoutPhotos(payload: CertPayload, people: readonly ('expert' | 'author')[]): CertPayload {
	let content: Record<string, unknown> = { ...payload.content }
	let stripped = false
	for (const person of people) {
		const fields = content[person]
		if (isRecord(fields) && hasValue(fields.photoUrl)) {
			content = { ...content, [person]: { ...fields, photoUrl: null } }
			stripped = true
		}
	}
	return stripped ? { ...payload, content: content as unknown as CertContent } : payload
}

/**
 * The payload with every content field the def's `hidden` set controls removed, and whether anything was; the two
 * photo URLs go as well when the payload's own `display.showExpertPhoto` is `false` (exactly `false`, as the reader
 * face reads it: absent or `null` shows the photo).
 *
 * Only the ids in `HIDEABLE_FIELDS` count (a def may list others; the faces ignore them, so they hide nothing). A
 * removed text field becomes `null`, so the content keeps the shape the contract types give it and every face reads it
 * as absent. Nothing but those fields changes: the subject and lifecycle (what `renderVerdict` reads), the cue, the
 * dates, the links and the names are the payload's own. Never throws on a hostile shape: a payload whose `expert` or
 * `author` is not an object has no photo to strip.
 */
export function withoutHiddenContent(
	payload: CertPayload,
	renderDef: CertChromeRenderDef | null,
): { readonly payload: CertPayload; readonly stripped: boolean } {
	const hidden = (renderDef?.hidden ?? []).filter((id) => (HIDEABLE_FIELDS as readonly string[]).includes(id))
	const display: unknown = (payload.content as unknown as Record<string, unknown> | undefined)?.display
	const photoOff = isRecord(display) && display.showExpertPhoto === false
	if (hidden.length === 0 && !photoOff) return { payload, stripped: false }
	let next = photoOff || hidden.includes('reviewerPhoto') ? withoutPhotos(payload, ['expert', 'author']) : payload
	if (hidden.includes('memo') && hasValue(next.content.memo)) {
		next = { ...next, content: { ...next.content, memo: null } as unknown as CertContent }
	}
	return { payload: next, stripped: next !== payload }
}

/**
 * The seed for a verified read: the payload stripped of what the def hides, and the signature only when nothing was
 * stripped. The card paints from this seed's payload, on the server and in the browser alike.
 */
export function seedFor(read: {
	readonly baseUrl: string
	readonly externalId: string
	readonly design?: DesignPin
	readonly payload: CertPayload
	readonly signature?: CertSignature
	readonly renderDef: CertChromeRenderDef | null
}): DeliverySeed {
	const { payload, stripped } = withoutHiddenContent(read.payload, read.renderDef)
	return {
		baseUrl: read.baseUrl,
		externalId: read.externalId,
		...(read.design ? { design: read.design } : {}),
		payload,
		...(read.signature && !stripped ? { signature: read.signature } : {}),
		renderDef: read.renderDef,
	}
}

const serializedPin = (design: DesignPin | undefined) =>
	design ? { design: { version: design.version, ...(design.brand === undefined ? {} : { brand: design.brand }) } } : {}

export function serializeSeed(seed: DeliverySeed): string {
	return JSON.stringify({
		v: 1,
		baseUrl: seed.baseUrl,
		externalId: seed.externalId,
		...serializedPin(seed.design),
		payload: seed.payload,
		...(seed.signature ? { signature: seed.signature } : {}),
		renderDef: seed.renderDef,
		// 1.3.0: last, and only with a delivered face, so a seed without one is the 1.2.1 bytes.
		...(seed.face ? { face: { html: seed.face.html, css: seed.face.css } } : {}),
	})
}

export function serializeFallback(fallback: DeliveryFallback): string {
	return JSON.stringify({
		v: 1,
		baseUrl: fallback.baseUrl,
		externalId: fallback.externalId,
		...serializedPin(fallback.design),
		face: fallback.face,
	})
}

/** A pin a record names, judged by the same grammar the card's own pin is: undefined when absent, null when bad. */
function parsedPin(design: unknown): DesignPin | undefined | null {
	if (design === undefined) return undefined
	const judged = isRecord(design)
		? parseDesignPin({ design: design.version, ...(design.brand === undefined ? {} : { designBrand: design.brand }) })
		: 'invalid'
	return judged === 'invalid' || judged === undefined ? null : judged
}

/** The seed in one attribute value, or null for anything that is not one (never throws). */
export function parseSeed(raw: string): DeliverySeed | null {
	let value: unknown
	try {
		value = JSON.parse(raw)
	} catch {
		return null
	}
	if (!isRecord(value) || value.v !== 1) return null
	const { baseUrl, externalId, design, payload, signature, renderDef, face } = value
	if (typeof baseUrl !== 'string' || typeof externalId !== 'string') return null
	if (!isRecord(payload) || !isRecord(payload.subject) || !isRecord(payload.lifecycle) || !isRecord(payload.content)) {
		return null
	}
	// A pin the seed names is judged by the same grammar the card's own pin is; one that fails it is not a seed.
	const pin = parsedPin(design)
	if (pin === null) return null
	// 1.3.0: a face that is not two strings is no face; the seed is still a seed (and paints as 1.2.1 paints it).
	const delivered = parseDeliveredFace(face)
	return {
		baseUrl,
		externalId,
		...(pin ? { design: pin } : {}),
		payload: payload as unknown as CertPayload,
		...(isRecord(signature) ? { signature: signature as unknown as CertSignature } : {}),
		renderDef: parseRenderDef(renderDef),
		...(delivered ? { face: delivered } : {}),
	}
}

/** A fallback record in one attribute value, or null for anything that is not one (a seed included; never throws). */
export function parseFallback(raw: string): DeliveryFallback | null {
	let value: unknown
	try {
		value = JSON.parse(raw)
	} catch {
		return null
	}
	if (!isRecord(value) || value.v !== 1 || 'payload' in value) return null
	const { baseUrl, externalId, design, face } = value
	if (typeof baseUrl !== 'string' || typeof externalId !== 'string') return null
	if (face !== 'options' && face !== 'none') return null
	const pin = parsedPin(design)
	if (pin === null) return null
	return { baseUrl, externalId, ...(pin ? { design: pin } : {}), face }
}

/** One placement's key: the origin, the entry and the pin (the read's own key, so a pin never shares a seed). */
function seedKey(baseUrl: string, externalId: string, design: DesignPin | undefined): string {
	return design ? `${baseUrl}|${externalId}|design=${design.version}|${design.brand ?? ''}` : `${baseUrl}|${externalId}`
}

/**
 * The seeds (and fallback records) this page's server HTML carried, by placement, for the page's lifetime: a card
 * mounted later by a client-side render (an in-app navigation back to a server-rendered article, or React's client
 * re-render after a hydration error) paints what the server painted, as the hydrated card it replaces would have.
 */
const pageSeeds = new Map<string, PageRecord>()

const recordKey = (record: PageRecord): string => {
	const r = 'seed' in record ? record.seed : record.fallback
	return seedKey(r.baseUrl, r.externalId, r.design)
}

/** The record one element's attribute carries: a seed, a fallback record, or null for anything else. */
function recordOf(el: Element): PageRecord | null {
	const raw = el.getAttribute(SEED_ATTRIBUTE)
	if (!raw) return null
	const seed = parseSeed(raw)
	if (seed) return { seed, raw }
	const fallback = parseFallback(raw)
	return fallback ? { fallback, raw } : null
}

/** Every seed and fallback record under `root` (the root element itself included), in document order. */
function scanRecords(root: Document | Element): PageRecord[] {
	const found: PageRecord[] = []
	const elements = Array.from(root.querySelectorAll(`[${SEED_ATTRIBUTE}]`))
	if (root.nodeType === 1 && (root as Element).hasAttribute(SEED_ATTRIBUTE)) elements.unshift(root as Element)
	for (const el of elements) {
		const record = recordOf(el)
		if (record) found.push(record)
	}
	return found
}

/** Every seed and fallback record the live document carries, in document order. */
function scanDocument(): PageRecord[] {
	return scanRecords(document)
}

/**
 * The record the server wrote for this placement and pin: its seed, or its fallback record. By default: from the map,
 * else from one scan of the document (which also records every other one on the page). With `live`, the map is not
 * consulted: the document is scanned and decides, so what a hydrating card learns is what the server HTML in front of
 * it carries, not what an earlier page in this process left behind. `undefined` when the page carries none, and always
 * on a server.
 */
export function pageRecordFor(
	baseUrl: string,
	externalId: string,
	design?: DesignPin,
	options: { readonly live?: boolean } = {},
): PageRecord | undefined {
	const key = seedKey(baseUrl, externalId, design)
	if (typeof document === 'undefined') return undefined
	const known = options.live ? undefined : pageSeeds.get(key)
	if (known) return known
	let inDocument = false
	for (const found of scanDocument()) {
		const k = recordKey(found)
		if (k === key) inDocument = true
		if (options.live || !pageSeeds.has(k)) pageSeeds.set(k, found)
	}
	// A live read answers for the document alone: a record an earlier page left in the map is not one this page carries.
	return options.live && !inDocument ? undefined : pageSeeds.get(key)
}

/** `pageRecordFor`, seeds only: the seed the server painted for this placement and pin. */
export function pageSeedFor(
	baseUrl: string,
	externalId: string,
	design?: DesignPin,
	options: { readonly live?: boolean } = {},
): PageSeed | undefined {
	const record = pageRecordFor(baseUrl, externalId, design, options)
	return record && 'seed' in record ? record : undefined
}

/** A Suspense boundary's comment marker as React's server render writes it: `$` (done), `$?` (pending), `$!`, `$~`. */
const BOUNDARY_MARKER = /^\$[?!~]?$/

/**
 * Whether the live document holds server-rendered React HTML: any Suspense boundary marker. The delivery card sits in
 * a `<Suspense>` of its own, so a server render of one always leaves a marker, a card the server painted nothing for
 * (revoked, expired, unreachable) included, and a client render never does. This is how a card that is hydrating tells
 * a browser hydrating server HTML (the document holds it) from a server render that merely runs where a `document`
 * exists (a test's jsdom, a shim): there the document does not hold the HTML being produced.
 */
export function pageHoldsServerHtml(): boolean {
	if (typeof document === 'undefined' || !document.documentElement) return false
	const walker = document.createTreeWalker(document.documentElement, 128 /* NodeFilter.SHOW_COMMENT */)
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (BOUNDARY_MARKER.test((node as Comment).data)) return true
	}
	return false
}

/**
 * RECORDS THAT STREAM IN AFTER THE CARD RENDERS (1.2.1). A streaming server (Hydrogen and React Router 7 stream every
 * visitor that is not a crawler) sends the page's shell first, and a card whose read is still running after it, in a
 * hidden `<div id="S:n">` past `</html>` that React's inline `$RC` script moves into the card's place. The browser
 * starts hydrating as soon as its module script loads, which can be before that part arrives. React then waits for
 * the card's boundary, but two things on a real page make it give up the server HTML and render the card on the
 * client before the record is in the document:
 *  - an update to the waiting boundary (a parent that sets state as it mounts): React renders the boundary on the
 *    client (React error #421) and deletes its markers, so `$RC` finds no place and drops the streamed part;
 *  - a mismatch above it (a page `<style>` whose text the server escaped, #418/#425): React renders the whole document
 *    on the client (#423). It removes the server's `<html>` element and appends its own, and the parser writes the
 *    rest of the stream into the removed element, where no script runs and no query of the document looks.
 * Either way the card rendered on the client with no record in front of it, and through 1.2.0 painted the options face
 * at once (nothing, for a block with no options) and never looked again: the record the server wrote arrived a moment
 * later and was thrown away. Now a card the client renders while the document is still loading, with no record for its
 * placement, waits (`StreamedRecordCard` in `cert-review-card.tsx`): `watchStreamedRecords` watches the document, and
 * the server's `<html>` element should React remove it, for records added while the page loads, keeps each new one
 * as the scan does (a placement already known keeps its record), and tells the waiting cards. When the page has
 * loaded it scans both once more, lets the removed element go and stops. A card whose record never came paints what a
 * client mount paints. A page that never renders a card this way never starts a watch.
 */

/**
 * The document element the page was still parsing when this module loaded: the server's `<html>`, which a card first
 * rendered after React replaced it could not otherwise find. Held weakly, so a page that never watches keeps nothing.
 */
const rootWhileLoading: WeakRef<Element> | null =
	typeof document !== 'undefined' &&
	document.readyState === 'loading' &&
	document.documentElement &&
	typeof WeakRef === 'function'
		? new WeakRef(document.documentElement)
		: null

interface StreamWatch {
	readonly observer: MutationObserver | null
	/** The server's `<html>` element(s), watched in their own right so a removed one is still read. */
	readonly roots: Element[]
	readonly listeners: Set<() => void>
	readonly onLoaded: () => void
	loaded: boolean
}

let streamWatch: StreamWatch | null = null

/** Keep every record under `node` whose placement the map does not hold yet; true when one was new. */
function keepNewRecords(node: Node): boolean {
	if (node.nodeType !== 1) return false
	let kept = false
	for (const record of scanRecords(node as Element)) {
		const key = recordKey(record)
		if (pageSeeds.has(key)) continue
		pageSeeds.set(key, record)
		kept = true
	}
	return kept
}

/**
 * Start watching for streamed records, once per page and only while the document is loading; a no-op otherwise. The
 * card calls it as it renders, not from an effect: React's client render of the whole document removes the server's
 * `<html>` in the commit that follows that render, so the watch must hold the element before then.
 */
export function watchStreamedRecords(): void {
	if (streamWatch || typeof document === 'undefined' || document.readyState !== 'loading') return
	const roots: Element[] = []
	for (const root of [rootWhileLoading?.deref(), document.documentElement]) {
		if (root && !roots.includes(root)) roots.push(root)
	}
	const listeners = new Set<() => void>()
	const notify = () => {
		for (const listener of Array.from(listeners)) listener()
	}
	const keepAdded = (mutations: readonly MutationRecord[]) => {
		let kept = false
		for (const mutation of mutations) {
			for (const node of Array.from(mutation.addedNodes)) if (keepNewRecords(node)) kept = true
		}
		return kept
	}
	const observer =
		typeof MutationObserver === 'function'
			? new MutationObserver((mutations) => {
					if (keepAdded(mutations)) notify()
				})
			: null
	observer?.observe(document, { childList: true, subtree: true })
	for (const root of roots) observer?.observe(root, { childList: true, subtree: true })
	const watch: StreamWatch = {
		observer,
		roots,
		listeners,
		loaded: false,
		onLoaded: () => {
			document.removeEventListener('DOMContentLoaded', watch.onLoaded)
			if (observer) {
				keepAdded(observer.takeRecords())
				observer.disconnect()
			}
			if (document.documentElement) keepNewRecords(document.documentElement)
			for (const root of roots) keepNewRecords(root)
			roots.length = 0
			watch.loaded = true
			notify()
		},
	}
	document.addEventListener('DOMContentLoaded', watch.onLoaded)
	streamWatch = watch
}

/** `useSyncExternalStore`'s subscribe for a waiting card: told when a streamed record is kept, and when the page has loaded. */
export function subscribeStreamedRecords(listener: () => void): () => void {
	watchStreamedRecords()
	const watch = streamWatch
	if (!watch || watch.loaded) return () => {}
	watch.listeners.add(listener)
	return () => {
		watch.listeners.delete(listener)
	}
}

/**
 * A waiting card's answer: the record for its placement and pin once the page holds one (`pageRecordFor`), else
 * `'pending'` while a watch runs and the document is still loading, else `'done'`: the page loaded with no record.
 */
export function streamedRecordFor(
	baseUrl: string,
	externalId: string,
	design?: DesignPin,
): PageRecord | 'pending' | 'done' {
	const record = pageRecordFor(baseUrl, externalId, design)
	if (record) return record
	return streamWatch && !streamWatch.loaded ? 'pending' : 'done'
}

/** Test seam: forget every seed (a new page), and stop any watch for streamed records. */
export function forgetPageSeedsForTests(): void {
	pageSeeds.clear()
	if (streamWatch) {
		document.removeEventListener('DOMContentLoaded', streamWatch.onLoaded)
		streamWatch.observer?.disconnect()
		streamWatch = null
	}
}
