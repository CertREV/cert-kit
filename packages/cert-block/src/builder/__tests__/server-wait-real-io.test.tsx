/**
 * 2.0.2 (SC2) over real I/O: a Delivery API that accepts the connection and never answers (CertREV hanging), reached
 * through the real `fetch` over a real socket, with real timers, timed by the wall clock. The card's origin must be a
 * certrev.com https origin, so the runtime's fetch sends the same request to a local server instead; nothing else is
 * stubbed. The cache's clock stays at the fixtures' T0 so the signed envelope is valid; only the cache's TTLs read it.
 *
 * Bounds carry slack for a loaded CI host: a wait of the 300 ms deadline is checked within [280, 300 + SLACK_MS], and
 * "at once" as under ONCE_MS, which a single 300 ms wait would fail.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { performance } from 'node:perf_hooks'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CertReviewCard, type CertReviewCardProps } from '../cert-review-card.js'
import { CARD_SERVER_WAIT_MS, setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import {
	BASE,
	builderSubject,
	chromeRoot,
	deliveryBody,
	type FixtureIssuer,
	MARKER,
	makeIssuer,
	renderToHtml,
	T0,
} from './delivery-harness.js'
import { OPTIONS_ONLY_SHAPES } from './options-only-shapes.js'

const SLACK_MS = 150
const ONCE_MS = 100
const PAINTED = 'I reviewed the retinol claims'

let issuer: FixtureIssuer
let server: Server
let origin = ''
/** Entry ids the server answers; every other path is accepted and never answered. */
let answering = new Set<string>()
let requests = 0
let restore: () => void
let warn: ReturnType<typeof vi.spyOn>

const card = (entry: string, overrides: Partial<CertReviewCardProps> = {}) => (
	<CertReviewCard
		{...(OPTIONS_ONLY_SHAPES.todaysExport as CertReviewCardProps)}
		delivery={MARKER}
		builderContext={{ content: { id: entry } }}
		{...overrides}
	/>
)

async function timedRender(entry: string): Promise<{ html: string; ms: number }> {
	const start = performance.now()
	const html = await renderToHtml(card(entry))
	return { html, ms: performance.now() - start }
}

const nextTask = () => new Promise<void>((resolve) => setImmediate(resolve))

beforeAll(async () => {
	issuer = makeIssuer()
	server = createServer((req, res) => {
		requests += 1
		const entry = decodeURIComponent((req.url ?? '').split('/').pop() ?? '')
		if (!answering.has(entry)) return // accepted, never answered: CertREV hanging
		res.writeHead(200, { 'content-type': 'application/json' })
		res.end(JSON.stringify(deliveryBody(issuer.envelope({ subject: builderSubject(entry) }))))
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
	server.closeAllConnections()
	await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
	warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	answering = new Set()
	requests = 0
	const realFetch = globalThis.fetch
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () =>
			((input: RequestInfo | URL, init?: RequestInit) =>
				realFetch(String(input).replace(BASE, origin), init)) as typeof fetch,
		now: () => T0,
	})
})

afterEach(() => {
	restore()
	warn.mockRestore()
})

describe('SC2 over a real socket: CertREV accepts and never answers', () => {
	it('the first render waits the 300 ms deadline once; later renders of the placement return at once with no request', async () => {
		const first = await timedRender('hang-a')
		expect(chromeRoot(first.html)).toBeNull()
		expect(first.ms).toBeGreaterThanOrEqual(CARD_SERVER_WAIT_MS - 20)
		expect(first.ms).toBeLessThanOrEqual(CARD_SERVER_WAIT_MS + SLACK_MS)
		for (let i = 0; i < 10; i++) {
			const later = await timedRender('hang-a')
			expect(chromeRoot(later.html)).toBeNull()
			expect(later.ms).toBeLessThan(ONCE_MS)
		}
		expect(requests).toBe(1)
	})

	it('20 renders that arrive while the first read hangs each return at once, and send no request', async () => {
		const first = timedRender('hang-b')
		await new Promise((resolve) => setTimeout(resolve, 20))
		const concurrent: Promise<{ html: string; ms: number }>[] = []
		for (let i = 0; i < 20; i++) {
			await nextTask()
			concurrent.push(timedRender('hang-b'))
		}
		for (const { html, ms } of await Promise.all(concurrent)) {
			expect(chromeRoot(html)).toBeNull()
			expect(ms).toBeLessThan(ONCE_MS)
		}
		expect((await first).ms).toBeLessThanOrEqual(CARD_SERVER_WAIT_MS + SLACK_MS)
		expect(requests).toBe(1)
	})

	it('a warm card never waits: CertREV starts hanging after the card is cached, and every render paints at once', async () => {
		answering.add('warm-c')
		expect((await timedRender('warm-c')).html).toContain(PAINTED)
		answering.delete('warm-c')
		for (let i = 0; i < 20; i++) {
			const warm = await timedRender('warm-c')
			expect(warm.html).toContain(PAINTED)
			expect(warm.ms).toBeLessThan(ONCE_MS)
		}
		expect(requests).toBe(1)
	})
})
