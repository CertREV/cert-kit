/**
 * Final review R1-1 (2026-10-24): an envelope that does not verify printed nothing and reported nothing. 2.0.1 reports it
 * as `envelope_verify_failed` (beacon outcome `verify_failed`) on the server and in the record the browser reports from.
 * Also R1-7: a read CertREV answered with an HTTP error says which (`http_5xx` / `http_4xx`, with `status`).
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fetchBeaconTransport, setCardBeaconForTests } from '../card-beacon.js'
import { CertReviewCard } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import {
	builderSubject,
	deliveryBody,
	ENTRY_ID,
	json,
	MARKER,
	makeIssuer,
	renderToHtml,
	type ScriptedDelivery,
	scriptedDelivery,
	seedOf,
	T0,
} from './delivery-harness.js'

const issuer = makeIssuer()
let delivery: ScriptedDelivery
let restoreRuntime: () => void
let restoreBeacon: () => void
let warn: ReturnType<typeof vi.spyOn>
let events: { reason: string; outcome: string; status?: number }[]

beforeEach(() => {
	delivery = scriptedDelivery(() => json({ error: 'unset' }, 500))
	restoreRuntime = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => delivery.fetch,
		now: () => T0,
		timeoutMs: 500,
	})
	events = []
	restoreBeacon = setCardBeaconForTests({
		transport: (_url, body) => events.push(...JSON.parse(body).events),
	})
	warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
	restoreBeacon()
	restoreRuntime()
	warn.mockRestore()
})

const block = () => <CertReviewCard delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} />

/** One envelope that does not verify, by the way it fails. */
const BROKEN: [string, () => object][] = [
	[
		'a signature over other bytes (invalid_signature)',
		() => {
			const env = issuer.envelope()
			return {
				...env,
				payload: { ...env.payload, content: { ...env.payload.content, title: 'Edited after signing' } },
			}
		},
	],
	[
		'an algorithm this client does not accept (unsupported_alg)',
		() => {
			const env = issuer.envelope()
			return { ...env, signature: { ...env.signature, alg: 'rs256' } }
		},
	],
	[
		'an envelope signed for another platform (platform_mismatch)',
		() => issuer.envelope({ subject: { ...builderSubject(), platform: 'wordpress' } as never }),
	],
]

it.each(
	BROKEN,
)('%s: nothing printed, the record and one report and beacon say envelope_verify_failed', async (_l, make) => {
	delivery.respond(() => json(deliveryBody(make())))
	const html = await renderToHtml(block())
	expect(html).not.toContain('data-certrev-cert-chrome=""')
	expect(html).not.toContain('<certrev-card')
	expect(seedOf(html)).toMatchObject({ face: 'none', reason: 'envelope_verify_failed' })
	expect(events).toEqual([{ kind: 'fallback', reason: 'envelope_verify_failed', outcome: 'verify_failed' }])
	expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
		expect.stringContaining('"reason":"envelope_verify_failed"'),
	])
})

it('a revoked certificate (a definitive no) still prints nothing and reports nothing, as before', async () => {
	delivery.respond(async () => json(await issuer.tombstone()))
	const html = await renderToHtml(block())
	expect(html).not.toContain('<certrev-card')
	expect(events).toEqual([])
})

it.each<[number, string]>([
	[503, 'http_5xx'],
	[429, 'http_4xx'],
])('CertREV answering %i: delivery_unreachable with outcome %s and the status', async (status, outcome) => {
	delivery.respond(() => json({ error: 'busy' }, status))
	const html = await renderToHtml(block())
	expect(html).not.toContain('<certrev-card')
	expect(events).toEqual([{ kind: 'fallback', reason: 'delivery_unreachable', outcome, status }])
})

it('a read that never reached CertREV: outcome unreachable and no status', async () => {
	delivery.respond(() => {
		throw new TypeError('Failed to fetch')
	})
	await renderToHtml(block())
	expect(events).toEqual([{ kind: 'fallback', reason: 'delivery_unreachable', outcome: 'unreachable' }])
})

it('R1-6: the shipped transport never sends the page address (referrerPolicy no-referrer), from a browser or a server', () => {
	const calls: RequestInit[] = []
	const real = globalThis.fetch
	globalThis.fetch = ((_url: string, init: RequestInit) => {
		calls.push(init)
		return Promise.resolve(new Response(null, { status: 204 }))
	}) as typeof fetch
	try {
		fetchBeaconTransport('https://portal.certrev.com/api/cert/v1/beacon', '{}', 'browser')
		fetchBeaconTransport('https://portal.certrev.com/api/cert/v1/beacon', '{}', 'server')
	} finally {
		globalThis.fetch = real
	}
	expect(calls.map((c) => [c.referrerPolicy, c.credentials])).toEqual([
		['no-referrer', 'omit'],
		['no-referrer', 'omit'],
	])
})
