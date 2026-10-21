/**
 * The Builder card's fallback report (2.0.0): one structured event every time a placement does not print the card
 * CertREV served, so no fallback is silent.
 *
 *  - In the browser: `CustomEvent('certrev:card-fallback', { detail })` on `document`, once per placement and reason per
 *    page. A brand (or CertREV's own replica) listens for it; the card itself sends nothing anywhere: no beacon, no
 *    request, no storage.
 *  - On a server: one `console.warn` line, `[certrev] card_fallback {json}`, per render that takes the fallback.
 *
 * The same reason rides the placement's `'none'` record on the page (`ssr-seed.ts`), so a capture can read it too.
 *
 * Reasons:
 *  - `card_missing`: a contract-1 placement (the signed binding says `contract: 1`) with no card in the response;
 *  - `card_verify_failed`: a card that is malformed, or does not hash to the signed digest, or names another design
 *    version, certificate or placement;
 *  - `card_unsupported_contract`: a signed binding with a `contract` this client does not print;
 *  - `card_pin_mismatch`: CertREV's replica pinned a design version the signed card was not painted for;
 *  - `unknown_key`: the envelope's kid is neither baked nor in the origin's signed published key set;
 *  - `delivery_unreachable`: CertREV could not be reached, so the block's own options face was painted (1.2.0's
 *    deliberate fallback, unchanged, now reported).
 */

export const CARD_FALLBACK_EVENT = 'certrev:card-fallback'

export type CardFallbackReason =
	| 'card_missing'
	| 'card_verify_failed'
	| 'card_unsupported_contract'
	| 'card_pin_mismatch'
	| 'unknown_key'
	| 'delivery_unreachable'

export interface CardFallbackDetail {
	readonly reason: CardFallbackReason
	readonly platform: 'builder'
	readonly externalId: string
	/** The certificate, when the envelope verified far enough to name it. */
	readonly certId?: string
}

/** Placement and reason pairs already reported on this page (browser only). */
const reportedOnPage = new Set<string>()

/** Report one fallback in the browser: the event, once per placement and reason per page. */
export function reportCardFallbackInBrowser(detail: CardFallbackDetail): void {
	if (typeof document === 'undefined' || typeof CustomEvent !== 'function') return
	const key = `${detail.externalId}|${detail.reason}`
	if (reportedOnPage.has(key)) return
	reportedOnPage.add(key)
	document.dispatchEvent(new CustomEvent(CARD_FALLBACK_EVENT, { detail }))
}

/** Report one fallback on a server: one structured console line. */
export function reportCardFallbackOnServer(detail: CardFallbackDetail): void {
	console.warn(`[certrev] card_fallback ${JSON.stringify(detail)}`)
}

/** Test seam: forget what this page reported (a new page). */
export function forgetCardReportsForTests(): void {
	reportedOnPage.clear()
}
