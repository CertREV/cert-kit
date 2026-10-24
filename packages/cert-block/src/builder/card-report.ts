/**
 * The Builder card's fallback report (2.0.0; 2.0.1 adds the beacon): one structured event every time a placement does
 * not print a card, so no fallback is silent.
 *
 *  - In the browser: `CustomEvent('certrev:card-fallback', { detail })` on `document`, once per placement and reason per
 *    page, which a brand (or CertREV's own replica) can listen for; and (2.0.1) the same fallback to CertREV as a beacon
 *    (`card-beacon.ts`: no reader data, at most three per page).
 *  - On a server: one `console.warn` line, `[certrev] card_fallback {json}`, per render that takes the fallback; and
 *    (2.0.1) a beacon, each placement and reason at most once an hour per process.
 *
 * The same reason rides the placement's `'none'` record on the page (`ssr-seed.ts`), so a capture can read it too.
 *
 * Reasons (2.0.1: every one of them prints NOTHING; no fallback ever prints the block's own export-time options):
 *  - `card_missing`: a contract-1 placement (the signed binding says `contract: 1`) with no card in the response;
 *  - `card_verify_failed`: a card that is malformed, or does not hash to the signed digest, or names another design
 *    version, certificate or placement;
 *  - `card_unsupported_contract`: a signed binding with a `contract` this client does not print (a newer major);
 *  - `card_pin_mismatch`: CertREV's replica pinned a design version the signed card was not painted for;
 *  - `unknown_key`: the envelope's kid is neither baked nor in the origin's signed published key set;
 *  - `envelope_verify_failed` (2.0.1): the envelope itself did not verify (a bad signature, an algorithm this client does
 *    not accept, another platform, content that drifted from what was signed, a payload version it cannot read);
 *  - `delivery_unreachable`: CertREV could not be reached and no verified answer was cached inside the stale window
 *    (2.0.1: when CertREV answered with an HTTP error, the beacon says `http_5xx` or `http_4xx` and carries `status`);
 *  - `no_marker`: a block with no delivery marker (an entry exported before 1.1.0, or a block dropped in by hand);
 *  - `marker_invalid`: a delivery marker this client does not accept, or a block with no Builder entry to read for;
 *  - `client_read_off`: a block mounted in the browser with no server answer while the brand turned `clientRead` off.
 */

import { type BeaconOutcome, sendBrowserBeacon, sendServerBeacon } from './card-beacon.js'

export const CARD_FALLBACK_EVENT = 'certrev:card-fallback'

export type CardFallbackReason =
	| 'card_missing'
	| 'card_verify_failed'
	| 'card_unsupported_contract'
	| 'card_pin_mismatch'
	| 'unknown_key'
	| 'envelope_verify_failed'
	| 'delivery_unreachable'
	| 'no_marker'
	| 'marker_invalid'
	| 'client_read_off'

export const CARD_FALLBACK_REASONS: readonly CardFallbackReason[] = [
	'card_missing',
	'card_verify_failed',
	'card_unsupported_contract',
	'card_pin_mismatch',
	'unknown_key',
	'envelope_verify_failed',
	'delivery_unreachable',
	'no_marker',
	'marker_invalid',
	'client_read_off',
]

export interface CardFallbackDetail {
	readonly reason: CardFallbackReason
	readonly platform: 'builder'
	readonly externalId: string
	/** The certificate, when the envelope verified far enough to name it. */
	readonly certId?: string
	/** 2.0.1: with `delivery_unreachable`, the HTTP status CertREV answered with, when it answered. */
	readonly status?: number
}

/** The beacon's outcome for each reason. */
const OUTCOMES: Readonly<Record<CardFallbackReason, BeaconOutcome>> = {
	card_missing: 'other',
	card_verify_failed: 'verify_failed',
	card_unsupported_contract: 'unsupported',
	card_pin_mismatch: 'other',
	unknown_key: 'verify_failed',
	envelope_verify_failed: 'verify_failed',
	delivery_unreachable: 'unreachable',
	no_marker: 'other',
	marker_invalid: 'other',
	client_read_off: 'other',
}

/** Placement and reason pairs already reported on this page (browser only), and the document address they belong to. */
const reportedOnPage = new Set<string>()
let reportedPage: string | null = null

/** The beacon event for one fallback: an HTTP error says which, with its status. */
function fallbackEvent(detail: CardFallbackDetail) {
	const status = detail.status
	const outcome: BeaconOutcome =
		status !== undefined && status >= 500
			? 'http_5xx'
			: status !== undefined && status >= 400
				? 'http_4xx'
				: OUTCOMES[detail.reason]
	return { kind: 'fallback' as const, reason: detail.reason, outcome, ...(status === undefined ? {} : { status }) }
}

/**
 * Report one fallback in the browser: the event and the beacon, once per placement and reason per page. `origin` is the
 * delivery origin the block reads (absent for a block with no accepted marker: CertREV's production origin).
 */
export function reportCardFallbackInBrowser(detail: CardFallbackDetail, origin?: string): void {
	if (typeof document === 'undefined' || typeof CustomEvent !== 'function') return
	const page = typeof location !== 'undefined' ? `${location.pathname}${location.search}` : ''
	if (page !== reportedPage) {
		reportedPage = page
		reportedOnPage.clear()
	}
	const key = `${detail.externalId}|${detail.reason}`
	if (reportedOnPage.has(key)) return
	reportedOnPage.add(key)
	document.dispatchEvent(new CustomEvent(CARD_FALLBACK_EVENT, { detail }))
	sendBrowserBeacon(origin, detail.externalId, fallbackEvent(detail))
}

/** Report one fallback on a server: one structured console line, and the beacon (at most once an hour per process). */
export function reportCardFallbackOnServer(detail: CardFallbackDetail, origin?: string): void {
	console.warn(`[certrev] card_fallback ${JSON.stringify(detail)}`)
	sendServerBeacon(origin, detail.externalId, fallbackEvent(detail))
}

/** Test seam: forget what this page reported (a new page). */
export function forgetCardReportsForTests(): void {
	reportedOnPage.clear()
	reportedPage = null
}
