// @vitest-environment jsdom
/**
 * 2.0.1: the card's beacon (`card-beacon.ts`) and the fallback report that sends it (`card-report.ts`): the agreed wire
 * shape and nothing more (no cookies, no page address or text, no user agent beyond a family), the page's budget and
 * the hundredth-page health draw in the browser, once an hour per placement and reason on a server, and a transport
 * that can never throw into a render.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	BEACON_MAX_PER_PAGE,
	BEACON_PATH,
	BEACON_SERVER_INTERVAL_MS,
	browserFamily,
	DEFAULT_BEACON_ORIGIN,
	maybeSendBrowserHealth,
	sendBrowserBeacon,
	sendServerBeacon,
	setCardBeaconForTests,
} from '../card-beacon.js'
import {
	CARD_FALLBACK_REASONS,
	forgetCardReportsForTests,
	reportCardFallbackInBrowser,
	reportCardFallbackOnServer,
} from '../card-report.js'
import { CERT_BLOCK_VERSION } from '../version.js'

interface Sent {
	readonly url: string
	readonly body: Record<string, unknown>
	readonly where: 'browser' | 'server'
}

let sent: Sent[]
let restore: () => void
let now = 0

beforeEach(() => {
	sent = []
	now = Date.parse('2026-10-24T12:00:00Z')
	restore = setCardBeaconForTests({
		transport: (url, body, where) => sent.push({ url, body: JSON.parse(body), where }),
		now: () => now,
	})
	forgetCardReportsForTests()
})
afterEach(() => {
	restore()
	vi.restoreAllMocks()
})

const STAGING = 'https://staging.portal.certrev.com'
const ALLOWED_KEYS = ['v', 'client', 'clientVersion', 'contract', 'platform', 'externalId', 'family', 'events']

describe('the wire: exactly the agreed shape, no reader data', () => {
	it('one fallback from the browser: the delivery origin, the version, the contract, the entry and a family', () => {
		sendBrowserBeacon(STAGING, 'entry-1', { kind: 'fallback', reason: 'delivery_unreachable', outcome: 'unreachable' })
		expect(sent).toHaveLength(1)
		expect(sent[0]?.url).toBe(`${STAGING}${BEACON_PATH}`)
		expect(sent[0]?.where).toBe('browser')
		expect(sent[0]?.body).toEqual({
			v: 1,
			client: 'cert-block',
			clientVersion: CERT_BLOCK_VERSION,
			contract: 1,
			platform: 'builder',
			externalId: 'entry-1',
			family: browserFamily(navigator.userAgent),
			events: [{ kind: 'fallback', reason: 'delivery_unreachable', outcome: 'unreachable' }],
		})
		const raw = JSON.stringify(sent[0]?.body)
		expect(Object.keys(sent[0]?.body ?? {}).every((key) => ALLOWED_KEYS.includes(key))).toBe(true)
		expect(raw).not.toContain(location.href)
		expect(raw).not.toContain(navigator.userAgent)
	})

	it('the version is the package’s own', () => {
		const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string }
		expect(CERT_BLOCK_VERSION).toBe(pkg.version)
	})

	it('an origin off certrev.com (or not https) goes to CertREV’s production origin instead', () => {
		for (const origin of ['https://evil.example', 'http://portal.certrev.com', 'not a url', undefined]) {
			sendBrowserBeacon(origin, 'entry-1', { kind: 'fallback', reason: 'no_marker', outcome: 'other' })
		}
		expect(sent.map((s) => s.url)).toEqual(Array(BEACON_MAX_PER_PAGE).fill(`${DEFAULT_BEACON_ORIGIN}${BEACON_PATH}`))
	})

	it('a block with no entry id sends no externalId key', () => {
		sendBrowserBeacon(STAGING, '', { kind: 'fallback', reason: 'no_marker', outcome: 'other' })
		expect('externalId' in (sent[0]?.body ?? {})).toBe(false)
	})

	it.each([
		['Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0 Safari/537.36', 'chromium'],
		[
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
			'webkit',
		],
		['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'gecko'],
		['curl/8.0', 'other'],
	])('the family of %s is %s, and nothing else of the user agent', (ua, family) => {
		expect(browserFamily(ua)).toBe(family)
	})
})

describe('how much: a page’s budget, the health draw, a server’s hour', () => {
	it('at most three beacons per page', () => {
		for (let i = 0; i < 10; i++)
			sendBrowserBeacon(STAGING, `entry-${i}`, { kind: 'fallback', reason: 'card_missing', outcome: 'other' })
		expect(sent).toHaveLength(BEACON_MAX_PER_PAGE)
	})

	it('health: one page in a hundred sends one event, once', () => {
		restore()
		restore = setCardBeaconForTests({
			transport: (url, body, where) => sent.push({ url, body: JSON.parse(body), where }),
			random: () => 0.005,
		})
		maybeSendBrowserHealth(STAGING, 'entry-1')
		maybeSendBrowserHealth(STAGING, 'entry-2')
		expect(sent.map((s) => s.body.events)).toEqual([[{ kind: 'health', reason: 'card_printed', outcome: 'ok' }]])
		restore()
		sent = []
		restore = setCardBeaconForTests({
			transport: (url, body, where) => sent.push({ url, body: JSON.parse(body), where }),
			random: () => 0.5,
		})
		maybeSendBrowserHealth(STAGING, 'entry-1')
		expect(sent).toEqual([])
	})

	it('a server sends each placement, reason and origin once an hour', () => {
		const event = { kind: 'fallback', reason: 'delivery_unreachable', outcome: 'unreachable' } as const
		sendServerBeacon(STAGING, 'entry-1', event)
		sendServerBeacon(STAGING, 'entry-1', event)
		sendServerBeacon(STAGING, 'entry-2', event)
		sendServerBeacon(STAGING, 'entry-1', { ...event, reason: 'card_missing', outcome: 'other' })
		now += BEACON_SERVER_INTERVAL_MS - 1
		sendServerBeacon(STAGING, 'entry-1', event)
		now += 1
		sendServerBeacon(STAGING, 'entry-1', event)
		expect(sent.map((s) => `${s.body.externalId}:${(s.body.events as { reason: string }[])[0]?.reason}`)).toEqual([
			'entry-1:delivery_unreachable',
			'entry-2:delivery_unreachable',
			'entry-1:card_missing',
			'entry-1:delivery_unreachable',
		])
		expect(sent.every((s) => s.where === 'server' && s.body.family === 'server')).toBe(true)
	})
})

describe('the fallback report sends the beacon', () => {
	it('every reason maps to an outcome; the browser sends each placement and reason once per page', () => {
		const outcomes = new Map<string, unknown>()
		for (const reason of CARD_FALLBACK_REASONS) {
			forgetCardReportsForTests()
			restore()
			sent = []
			restore = setCardBeaconForTests({
				transport: (url, body, where) => sent.push({ url, body: JSON.parse(body), where }),
			})
			reportCardFallbackInBrowser({ reason, platform: 'builder', externalId: 'entry-1' }, STAGING)
			reportCardFallbackInBrowser({ reason, platform: 'builder', externalId: 'entry-1' }, STAGING)
			expect(sent).toHaveLength(1)
			outcomes.set(reason, (sent[0]?.body.events as { outcome: string }[])[0]?.outcome)
		}
		expect(Object.fromEntries(outcomes)).toEqual({
			card_missing: 'other',
			card_verify_failed: 'verify_failed',
			card_unsupported_contract: 'unsupported',
			card_pin_mismatch: 'other',
			envelope_verify_failed: 'verify_failed',
			unknown_key: 'verify_failed',
			delivery_unreachable: 'unreachable',
			no_marker: 'other',
			marker_invalid: 'other',
			client_read_off: 'other',
		})
	})

	it('a server report: the console line and the beacon', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		reportCardFallbackOnServer({ reason: 'no_marker', platform: 'builder', externalId: 'entry-9' })
		expect(warn).toHaveBeenCalledWith(
			'[certrev] card_fallback {"reason":"no_marker","platform":"builder","externalId":"entry-9"}',
		)
		expect(sent).toHaveLength(1)
		expect(sent[0]?.url).toBe(`${DEFAULT_BEACON_ORIGIN}${BEACON_PATH}`)
		expect(sent[0]?.where).toBe('server')
	})
})

describe('the default transport', () => {
	it('POSTs text/plain with credentials omitted; kept alive and opaque in a browser; a throwing fetch is swallowed', async () => {
		restore()
		const calls: [string, RequestInit][] = []
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: string, init: RequestInit) => {
			calls.push([url, init])
			throw new TypeError('Failed to fetch')
		}) as unknown as typeof fetch)
		// The real transport, with a fresh page budget.
		restore = (() => {
			const undo = setCardBeaconForTests({})
			undo()
			return () => {}
		})()
		sendBrowserBeacon(STAGING, 'entry-1', { kind: 'fallback', reason: 'card_missing', outcome: 'other' })
		await new Promise((r) => setTimeout(r, 0))
		expect(fetchSpy).toHaveBeenCalledTimes(1)
		const [url, init] = calls[0] ?? []
		expect(url).toBe(`${STAGING}${BEACON_PATH}`)
		expect(init).toMatchObject({
			method: 'POST',
			credentials: 'omit',
			mode: 'no-cors',
			keepalive: true,
			headers: { 'content-type': 'text/plain;charset=UTF-8' },
		})
		expect(JSON.parse(String(init?.body))).toMatchObject({ client: 'cert-block', externalId: 'entry-1' })
	})
})
