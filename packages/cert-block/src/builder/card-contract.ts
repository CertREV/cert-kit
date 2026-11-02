/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The contract-1 card a Builder block prints (2.0.0): the server's card document, bound by the signed digest
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * CertREV's contract v1 (portal ADR 0001) moves the card to the server: one renderer paints every part of a placement
 * into a CARD DOCUMENT, and every CMS client prints those parts verbatim. Nothing visual, no string a reader sees and
 * no layout is computed here. The Builder Delivery response carries the document as an UNSIGNED top-level sibling,
 * `card`, beside `payload`, `signature`, `renderDef` and `face`. What binds it is the signed
 * `payload.content.faceDigest`, which for a contract-1 Builder placement is
 *
 *   { v: 1, defVersion, html, css, contract: 1, doc }
 *
 * where `doc` is the lowercase hex sha256 of the document's RFC 8785 bytes (cert-contract's `canonicalizeJson`) and
 * `html`/`css` bind 1.3.x's delivered face, which this client no longer reads for such a placement.
 *
 * THE SCHEMA IS THE PORTAL'S (`src/lib/cert-delivery/card-document.ts`, `CardDocumentV1`; source read at portal
 * v1-core d5e459b685). This module mirrors only the fields a client reads, read-only, and never redefines them: the
 * digest covers the document's exact bytes, so `parseCardDocument` returns the object it was given, never a copy.
 *
 * Which path a verified delivery takes is decided by the SIGNED binding alone (`acceptedCardBinding`):
 *  - no `contract` key in the digest (every brand without CertREV's contract-1 entitlement): the 1.3.1 path, unchanged;
 *  - a well-formed contract-1 binding: the card, only when the served document hashes to `doc` and names the same
 *    design version, certificate and placement (`cardBinds`); anything else prints nothing and is reported;
 *  - a `contract` key that is not a well-formed contract-1 binding (a later contract, a malformed digest): nothing, and
 *    reported. A client refuses a contract it does not support (ADR 0001, section 2).
 *
 * React-free. Hashing uses WebCrypto (`crypto.subtle.digest`), as the kernel and the 1.3.0 face gate do, so it runs
 * wherever the card verifies (Node SSR, edge runtimes, a browser in a secure context); the card owns the suspension.
 */

import { type CertContent, type CertPayload, canonicalizeJson } from '../contract/kernel.js'
import { evictOldestSettled, sha256HexUtf8 } from './delivered-face.js'

/** The contract this client prints. */
export const CARD_CONTRACT_VERSION = 1

/** The part names a document can hold, by where they go: banner card and memo, the sidebar rail, the floating pill. */
export const CARD_PART_NAMES = ['top', 'bottom', 'rail', 'pill'] as const
export type CardPartName = (typeof CARD_PART_NAMES)[number]

/** The layouts a document paints. */
export type CardLayout = 'banner' | 'sidebar' | 'floating'
const CARD_LAYOUTS: readonly string[] = ['banner', 'sidebar', 'floating']

/**
 * The fields of the portal's `CardDocumentV1` this client reads. The document carries more (`renderer`, `placement`,
 * `jsonld`, `lifecycle`, `cache`, `illustrative`); they are part of the digest and printed nowhere by Builder.
 */
export interface CardDocumentV1 {
	readonly contract: 1
	readonly kind: 'certrev.card'
	readonly certId: string
	readonly subject: { readonly platform: string; readonly externalId: string }
	readonly defVersion: number
	readonly layout: CardLayout
	/** Each part is one complete `<certrev-card>` host holding a declarative shadow root. */
	readonly parts: Partial<Record<CardPartName, string>>
	/** CertREV's own certificate and expert-profile dialogs: complete hosts, identical on every brand and CMS. */
	readonly dialogs: { readonly expert?: string; readonly certificate?: string }
	readonly assets: {
		/** A complete `<style data-certrev-card-head>` fragment: the pill's fixed box and the fonts. */
		readonly head: string
		/** The hosted runtime (dialogs, revalidate, polyfill), present once CertREV serves it. */
		readonly runtime?: { readonly src: string; readonly integrity: string }
	}
}

/** The signed binding of a contract-1 card, as the verified `content.faceDigest` carries it. */
export interface CardBinding {
	readonly contract: 1
	readonly defVersion: number
	readonly doc: string
}

const SHA256_HEX = /^[0-9a-f]{64}$/
const SRI = /^(?:sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2}(?:\s+(?:sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2})*$/

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'

/**
 * The signed binding, judged:
 *  - `null`: the verified content's digest has no `contract` key (or there is no digest): not a contract-1 placement,
 *    so the card paints what 1.3.1 paints;
 *  - a `CardBinding`: `{ v: 1, contract: 1 }` with a non-negative integer `defVersion` and a 64-char lowercase hex `doc`
 *    (`html` and `css` may be there or not; this client does not read them);
 *  - `'unsupported'`: a `contract` key with anything else (another contract, a malformed binding). Fails closed.
 */
export function acceptedCardBinding(content: CertContent | null | undefined): CardBinding | 'unsupported' | null {
	const digest: unknown = (content as { faceDigest?: unknown } | null | undefined)?.faceDigest
	// Own keys via `Object.keys`, not `Object.hasOwn`: this runs for every verified placement, in browsers 1.3.1 painted in
	// (Safari before 15.4 has no `Object.hasOwn`; break-it B3).
	if (!isRecord(digest) || !Object.keys(digest).includes('contract')) return null
	const { v, contract, defVersion, doc } = digest
	if (v !== 1 || contract !== CARD_CONTRACT_VERSION) return 'unsupported'
	if (typeof defVersion !== 'number' || !Number.isSafeInteger(defVersion) || defVersion < 0) return 'unsupported'
	if (!isString(doc) || !SHA256_HEX.test(doc)) return 'unsupported'
	return { contract: CARD_CONTRACT_VERSION, defVersion, doc }
}

/**
 * The runtime's `src` must be CertREV's: an `https:` URL on `certrev.com` or one of its subdomains, with no credentials
 * and no port (the rule the delivery marker's origin follows). Anything else is not a runtime, so no document, even one
 * planted in a page's record, can make the card load a script from elsewhere (break-it B7).
 */
function isCertrevRuntimeUrl(value: unknown): boolean {
	if (!isString(value)) return false
	try {
		const url = new URL(value)
		const host = url.hostname.toLowerCase()
		return (
			url.protocol === 'https:' &&
			!url.username &&
			!url.password &&
			!url.port &&
			(host === 'certrev.com' || host.endsWith('.certrev.com'))
		)
	} catch {
		return false
	}
}

/**
 * The served document, shape-checked for what this client reads: the object itself when it is a contract-1 card
 * document, else null. Nothing is copied or normalised (the digest covers the object as served). Parts it does not
 * know are left in place (they are part of the digest) and never printed.
 */
export function parseCardDocument(value: unknown): CardDocumentV1 | null {
	if (!isRecord(value)) return null
	const { contract, kind, certId, subject, defVersion, layout, parts, dialogs, assets } = value
	if (contract !== CARD_CONTRACT_VERSION || kind !== 'certrev.card' || !isString(certId)) return null
	if (!isRecord(subject) || !isString(subject.platform) || !isString(subject.externalId)) return null
	if (typeof defVersion !== 'number' || !Number.isSafeInteger(defVersion) || defVersion < 0) return null
	if (!isString(layout) || !CARD_LAYOUTS.includes(layout)) return null
	if (!isRecord(parts)) return null
	for (const name of CARD_PART_NAMES) if (parts[name] !== undefined && !isString(parts[name])) return null
	if (!isRecord(dialogs)) return null
	if (dialogs.expert !== undefined && !isString(dialogs.expert)) return null
	if (dialogs.certificate !== undefined && !isString(dialogs.certificate)) return null
	if (!isRecord(assets) || !isString(assets.head)) return null
	if (assets.runtime !== undefined) {
		const runtime = assets.runtime
		if (
			!isRecord(runtime) ||
			!isCertrevRuntimeUrl(runtime.src) ||
			!isString(runtime.integrity) ||
			!SRI.test(runtime.integrity)
		) {
			return null
		}
	}
	return value as unknown as CardDocumentV1
}

/** Lowercase hex sha256 of a document's RFC 8785 bytes; null when it cannot be canonicalized or hashed. */
export async function cardDocumentDigest(card: unknown): Promise<string | null> {
	let canonical: string
	try {
		canonical = canonicalizeJson(card)
	} catch {
		return null
	}
	try {
		return await sha256HexUtf8(canonical)
	} catch {
		return null
	}
}

/** One document's digest: the pending hash, and its answer once settled (null never matches). */
export interface CardDigestMemo {
	readonly pending: Promise<string | null>
	settled?: { readonly digest: string | null }
}

/** How many documents' digests are kept (insertion order; the oldest goes first). A page holds one or a few. */
const CARD_DIGEST_MEMO_MAX = 32
const cardDigestMemo = new Map<string, CardDigestMemo>()

/**
 * The memoized digest of one document, keyed by its canonical bytes (a seed parsed afresh from the page and the
 * server's cached read of the same document share one entry). A document that cannot be canonicalized settles to null
 * at once, without a key.
 */
export function cardDigestFor(card: unknown): CardDigestMemo {
	let key: string
	try {
		key = canonicalizeJson(card)
	} catch {
		const failed: CardDigestMemo = { pending: Promise.resolve(null), settled: { digest: null } }
		return failed
	}
	const known = cardDigestMemo.get(key)
	if (known) return known
	const fresh: CardDigestMemo = {
		pending: sha256HexUtf8(key).then(
			(digest) => {
				fresh.settled = { digest }
				return digest
			},
			() => {
				fresh.settled = { digest: null }
				return null
			},
		),
	}
	evictOldestSettled(cardDigestMemo, CARD_DIGEST_MEMO_MAX)
	cardDigestMemo.set(key, fresh)
	return fresh
}

/** Test seam: forget every document's digest (a new process). */
export function forgetCardDigestsForTests(): void {
	cardDigestMemo.clear()
}

/**
 * The synchronous half of the check: the document binds this binding, payload and placement in everything but its
 * bytes (contract, design version, certificate, and the Builder placement it was painted for).
 */
export function cardMatchesPlacement(
	card: CardDocumentV1,
	binding: CardBinding,
	payload: CertPayload,
	externalId: string,
): boolean {
	return (
		card.contract === binding.contract &&
		card.defVersion === binding.defVersion &&
		card.certId === payload.certId &&
		card.subject.platform === 'builder' &&
		card.subject.externalId === externalId
	)
}

/** The asynchronous half's verdict: the document's own digest is the signed one. */
export function cardDigestMatches(digest: string | null, binding: CardBinding): boolean {
	return digest !== null && digest === binding.doc
}

/** Both halves at once (for callers outside React): the served document is the one the verified envelope signs. */
export async function cardBinds(
	card: CardDocumentV1,
	binding: CardBinding,
	payload: CertPayload,
	externalId: string,
): Promise<boolean> {
	if (!cardMatchesPlacement(card, binding, payload, externalId)) return false
	return cardDigestMatches(await cardDigestFor(card).pending, binding)
}

/**
 * The parts one Builder block prints, in page order. The saved design decides the layout (the block's `mode` is not
 * read). A banner block prints its card (`top`) and its memo (`bottom`); a block whose `part` is `'header'` prints the
 * card only, and one whose `part` is `'memo'` the memo only, so a split banner prints each part once. Outside the
 * banner a `'memo'` block prints nothing and any other block the design's one part (the rail, the pill): a page that
 * kept its split header and memo blocks after the brand chose a sidebar design shows one sidebar card, not two.
 */
export function cardPartsFor(card: CardDocumentV1, part: unknown): CardPartName[] {
	let names: CardPartName[]
	if (card.layout === 'banner') {
		names = part === 'header' ? ['top'] : part === 'memo' ? ['bottom'] : ['top', 'bottom']
	} else if (part === 'memo') {
		names = []
	} else {
		names = card.layout === 'sidebar' ? ['rail'] : ['pill']
	}
	return names.filter((name) => typeof card.parts[name] === 'string')
}

function escapeAttribute(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * The runtime's tag, or '' when the document names none. 2.1.1: the Builder card no longer prints it (`cardHtml`); the
 * card loads the runtime from the browser (`injectCardRuntime`). Kept, unchanged, for any other caller.
 */
export function cardRuntimeTag(card: CardDocumentV1): string {
	const runtime = card.assets.runtime
	if (!runtime) return ''
	return `<script src="${escapeAttribute(runtime.src)}" integrity="${escapeAttribute(runtime.integrity)}" crossorigin="anonymous" defer></script>`
}

/** Which of the document's parts is its first, in this order: the block holding it prints the page's assets. */
const CARD_FIRST_PART_ORDER: readonly CardPartName[] = ['top', 'rail', 'pill', 'bottom']

/**
 * The document's first part: `top`, else `rail`, else `pill`, from the document's own parts (the lead's ruling on ADR
 * 0001's head-once-per-page, relay 074dbd2c8ef3); `bottom` only for a document with none of those, so its head and
 * dialogs always have a block to print them. Null for a document with no part.
 */
export function cardFirstPart(card: CardDocumentV1): CardPartName | null {
	return CARD_FIRST_PART_ORDER.find((name) => typeof card.parts[name] === 'string') ?? null
}

/** Whether the block printing `names` prints the page's head fragment, dialogs and runtime: it holds the first part. */
export function cardCarriesAssets(card: CardDocumentV1, names: readonly CardPartName[]): boolean {
	const first = cardFirstPart(card)
	return first !== null && names.includes(first)
}

/**
 * 2.0.1: the page's CertREV graph, when the document carries one CertREV's server resolved for this placement
 * (`card.jsonld.graph`: a complete JSON-LD object, every link and page fact filled in, an additive key under contract
 * 1). Printed verbatim as `<script type="application/ld+json" data-certrev-graph ...>`, with every `<` written as
 * `\u003c` so no value can close the element; '' when the document has no graph. The block never builds or edits the
 * graph: what it says, and when it changes, is the server's.
 */
export function cardGraphTag(card: CardDocumentV1): string {
	const jsonld = (card as unknown as { jsonld?: unknown }).jsonld
	if (typeof jsonld !== 'object' || jsonld === null) return ''
	const graph = (jsonld as { graph?: unknown }).graph
	if (typeof graph !== 'object' || graph === null || Array.isArray(graph)) return ''
	let json: string
	try {
		json = JSON.stringify(graph)
	} catch {
		return ''
	}
	const id = escapeAttribute(card.subject.externalId)
	return `<script type="application/ld+json" data-certrev-graph="" data-certrev-platform="builder" data-certrev-external-id="${id}">${json.replace(/</g, '\\u003c')}</script>`
}

/**
 * Exactly what a block prints inside its wrapper: its parts in page order and, only in the block holding the document's
 * first part (`cardCarriesAssets`), the head fragment before them and both dialogs (expert, then certificate) and
 * (2.0.1) the page's graph after. So a split banner (a header block and a memo block) prints the head and the dialogs
 * once, in the header block, with no coordination between the blocks and with JavaScript off; the runtime finds a
 * control's dialog anywhere on the page by its placement. Every byte is the document's own, but the graph's tag.
 *
 * 2.1.1: no runtime tag. A `<script src>` the HTML parser meets is blocked by a policy whose `script-src` is a nonce with
 * `'strict-dynamic'` (it carries no nonce, and `'strict-dynamic'` ignores host sources), which logged one violation and
 * one CSP report on every page view. The block holding the assets loads the runtime from the browser instead
 * (`injectCardRuntime`, in `ContractCardFace`'s layout effect, as 2.0.x did beside the tag), which such a policy allows.
 */
export function cardHtml(card: CardDocumentV1, names: readonly CardPartName[]): string {
	let parts = ''
	for (const name of names) parts += card.parts[name] ?? ''
	if (!cardCarriesAssets(card, names)) return parts
	const dialogs = (card.dialogs.expert ?? '') + (card.dialogs.certificate ?? '')
	return card.assets.head + parts + dialogs + cardGraphTag(card)
}
