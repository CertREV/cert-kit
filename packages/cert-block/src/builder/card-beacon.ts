/**
 * The Builder card's beacon (2.0.1): what the card tells CertREV about itself, so a card that does not print on a brand's
 * page is seen by CertREV and not only by the brand's console.
 *
 * One `POST <delivery origin>/api/cert/v1/beacon` per event, a `text/plain` JSON body (a CORS simple request, so no
 * preflight; the origin is the delivery origin the page's `connect-src` already allows, so no new CSP source):
 *
 *     { v: 1, client: 'cert-block', clientVersion, contract, platform: 'builder', externalId, family,
 *       events: [{ kind: 'fallback' | 'health', reason, outcome }] }
 *
 * What it never carries: cookies (`credentials: 'omit'`), the page's address or text, the reader's user agent (only a
 * coarse family: chromium, webkit, gecko, other, or server), or anything the reader typed. `externalId` is the Builder
 * entry the block renders in, which the brand's page already sends to CertREV when it reads the card.
 *
 * How much: in a browser, every fallback (each placement and reason once per page, `card-report.ts`) and one health
 * event per page in a hundred, at most three beacons per page; on a server, each placement, reason and origin at most
 * once an hour per process, with a short deadline, never awaited. A beacon that fails is dropped: it never retries,
 * never stores anything and never changes what the card prints.
 */

import { CARD_CONTRACT_VERSION } from './card-contract.js'
import { CERT_BLOCK_VERSION } from './version.js'

export const BEACON_PATH = '/api/cert/v1/beacon'
/** Where a block with no accepted delivery marker reports: CertREV's production delivery origin. */
export const DEFAULT_BEACON_ORIGIN = 'https://portal.certrev.com'
/** The most beacons one page sends. */
export const BEACON_MAX_PER_PAGE = 3
/** The share of page views that send one health event. */
export const BEACON_HEALTH_SAMPLE = 0.01
/** A server sends one beacon per placement, reason and origin at most this often. */
export const BEACON_SERVER_INTERVAL_MS = 3_600_000
const SERVER_MAX_KEYS = 500
const SERVER_TIMEOUT_MS = 1_500

export type BeaconOutcome = 'ok' | 'unreachable' | 'http_4xx' | 'http_5xx' | 'verify_failed' | 'unsupported' | 'other'
export type BeaconFamily = 'chromium' | 'webkit' | 'gecko' | 'server' | 'other'

export interface BeaconEvent {
	readonly kind: 'fallback' | 'health'
	readonly reason: string
	readonly outcome: BeaconOutcome
}

export interface CardBeacon {
	readonly v: 1
	readonly client: 'cert-block'
	readonly clientVersion: string
	readonly contract: number
	readonly platform: 'builder'
	readonly externalId?: string
	readonly family: BeaconFamily
	readonly events: readonly BeaconEvent[]
}

/** How a beacon leaves: `url`, the JSON body, and where it is sent from. */
export type BeaconTransport = (url: string, body: string, where: 'browser' | 'server') => void

/** The transport the card ships with: `fetch`, never awaited, never throwing (exported for CertREV's replica harness). */
export const fetchBeaconTransport: BeaconTransport = (url, body, where) => {
	try {
		const send = globalThis.fetch
		if (typeof send !== 'function') return
		const init: RequestInit = {
			method: 'POST',
			body,
			headers: { 'content-type': 'text/plain;charset=UTF-8' },
			credentials: 'omit',
			...(where === 'browser'
				? // Opaque and kept alive: no CORS read of the answer, and it outlives a navigation away.
					{ mode: 'no-cors' as const, keepalive: true }
				: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
					? { signal: AbortSignal.timeout(SERVER_TIMEOUT_MS) }
					: {}),
		}
		void send(url, init).catch(() => {})
	} catch {
		// A beacon never throws into a render.
	}
}

let transport: BeaconTransport = fetchBeaconTransport
let sentOnPage = 0
let healthDrawn: boolean | null = null
const sentOnServer = new Map<string, number>()
let random: () => number = Math.random
let clock: () => number = Date.now

/** The coarse browser family, from the user agent; nothing else of it is kept. */
export function browserFamily(userAgent: string): BeaconFamily {
	if (/Firefox\//.test(userAgent)) return 'gecko'
	if (/(Chrome|Chromium|CriOS|Edg)\//.test(userAgent)) return 'chromium'
	if (/AppleWebKit\//.test(userAgent)) return 'webkit'
	return 'other'
}

/** The delivery origin a beacon goes to: an `https:` origin on certrev.com, else CertREV's production origin. */
function beaconOrigin(baseUrl: string | undefined): string {
	if (!baseUrl) return DEFAULT_BEACON_ORIGIN
	try {
		const url = new URL(baseUrl)
		const host = url.hostname
		if (url.protocol === 'https:' && (host === 'certrev.com' || host.endsWith('.certrev.com'))) return url.origin
	} catch {
		// Fall through.
	}
	return DEFAULT_BEACON_ORIGIN
}

export function beaconBody(externalId: string, events: readonly BeaconEvent[], family: BeaconFamily): CardBeacon {
	return {
		v: 1,
		client: 'cert-block',
		clientVersion: CERT_BLOCK_VERSION,
		contract: CARD_CONTRACT_VERSION,
		platform: 'builder',
		...(externalId ? { externalId } : {}),
		family,
		events,
	}
}

/** Send one event from the browser, within the page's budget. */
export function sendBrowserBeacon(baseUrl: string | undefined, externalId: string, event: BeaconEvent): void {
	if (typeof document === 'undefined' || sentOnPage >= BEACON_MAX_PER_PAGE) return
	sentOnPage++
	const userAgent = typeof navigator !== 'undefined' ? String(navigator.userAgent ?? '') : ''
	const body = beaconBody(externalId, [event], browserFamily(userAgent))
	transport(`${beaconOrigin(baseUrl)}${BEACON_PATH}`, JSON.stringify(body), 'browser')
}

/** Send one health event from the browser on one page view in a hundred (drawn once per page). */
export function maybeSendBrowserHealth(baseUrl: string | undefined, externalId: string): void {
	if (typeof document === 'undefined') return
	if (healthDrawn === null) healthDrawn = random() < BEACON_HEALTH_SAMPLE
	if (!healthDrawn) return
	healthDrawn = false
	sendBrowserBeacon(baseUrl, externalId, { kind: 'health', reason: 'card_printed', outcome: 'ok' })
}

/** Send one event from a server: each placement, reason and origin at most once an hour per process. */
export function sendServerBeacon(baseUrl: string | undefined, externalId: string, event: BeaconEvent): void {
	const origin = beaconOrigin(baseUrl)
	const key = `${origin}|${externalId}|${event.kind}|${event.reason}`
	const now = clock()
	const last = sentOnServer.get(key)
	if (last !== undefined && now - last < BEACON_SERVER_INTERVAL_MS) return
	sentOnServer.delete(key)
	if (sentOnServer.size >= SERVER_MAX_KEYS) {
		const oldest = sentOnServer.keys().next().value
		if (oldest !== undefined) sentOnServer.delete(oldest)
	}
	sentOnServer.set(key, now)
	transport(`${origin}${BEACON_PATH}`, JSON.stringify(beaconBody(externalId, [event], 'server')), 'server')
}

/**
 * Test seam: replace the transport (and the sampling draw and clock) and forget the page's and the process's budget.
 * Returns a restore.
 */
export function setCardBeaconForTests(
	overrides: { transport?: BeaconTransport; random?: () => number; now?: () => number } = {},
): () => void {
	const previous = { transport, random, clock }
	transport = overrides.transport ?? (() => {})
	random = overrides.random ?? (() => 1)
	clock = overrides.now ?? Date.now
	forgetCardBeaconsForTests()
	return () => {
		transport = previous.transport
		random = previous.random
		clock = previous.clock
	}
}

/** Test seam: a new page and a new process. */
export function forgetCardBeaconsForTests(): void {
	sentOnPage = 0
	healthDrawn = null
	sentOnServer.clear()
}
