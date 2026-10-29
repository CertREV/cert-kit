/**
 * 2.0.2 (SC1, SC2): a CertREV outage costs a brand's server render at most one short wait per placement per failure
 * window, concurrent renders never wait behind a read in flight, a warm card never waits, and a revocation still lands.
 *
 * The real card, cache, kernel and fixture-signed envelopes; only the fetch is scripted and `setTimeout` is faked, so a
 * render's wait is measured in the fake milliseconds it needed (`timed`). Every render here is a server render
 * (`renderToPipeableStream`, no `document`).
 */

import { renderToReadableStream } from 'react-dom/server.browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CertReviewCard, type CertReviewCardProps } from '../cert-review-card.js'
import {
	CARD_DELIVERY_FAILURE_MS,
	CARD_DELIVERY_STALE_MS,
	CARD_DELIVERY_TIMEOUT_MS,
	CARD_DELIVERY_TTL_MS,
	CARD_SERVER_WAIT_MS,
	setCardDeliveryRuntimeForTests,
} from '../delivery-runtime.js'
import {
	chromeRoot,
	DELIVERY_URL,
	deliveryBody,
	ENTRY_ID,
	type FixtureIssuer,
	json,
	MARKER,
	makeIssuer,
	renderToHtml,
	type ScriptedDelivery,
	scriptedDelivery,
	seedOf,
	T0,
} from './delivery-harness.js'
import { OPTIONS_ONLY_SHAPES } from './options-only-shapes.js'

const PAINTED = 'I reviewed the retinol claims'
const hang = () => new Promise<Response>(() => {})

let issuer: FixtureIssuer
let delivery: ScriptedDelivery
let restore: () => void
let warn: ReturnType<typeof vi.spyOn>

const card = (overrides: Partial<CertReviewCardProps> = {}) => (
	<CertReviewCard
		{...(OPTIONS_ONLY_SHAPES.todaysExport as CertReviewCardProps)}
		delivery={MARKER}
		builderContext={{ content: { id: ENTRY_ID } }}
		{...overrides}
	/>
)

/**
 * Render on a server and report how many (fake) milliseconds it waited: the timers are advanced 1 ms at a time until
 * the render is done. `waited: 0` means it finished with no timer at all.
 */
async function timed(element = card(), limitMs = 20_000): Promise<{ html: string; waited: number }> {
	let html: string | undefined
	const pending = renderToHtml(element).then((h) => {
		html = h
	})
	let waited = 0
	await settleIo()
	while (html === undefined && waited < limitMs) {
		await vi.advanceTimersByTimeAsync(1)
		waited += 1
		await settleIo()
	}
	await pending
	return { html: html as string, waited }
}

/** Let real async work (WebCrypto, the render stream) run with no fake time passing. */
async function settleIo() {
	for (let i = 0; i < 50; i++) {
		await vi.advanceTimersByTimeAsync(0)
		await new Promise<void>((resolve) => setImmediate(resolve))
	}
}

/** Move the one fake clock (the cache's `now` is `Date.now`, faked with the timers), firing timers on the way. */
async function advance(ms: number) {
	await vi.advanceTimersByTimeAsync(ms)
}

const unreachableRecord = {
	v: 1,
	baseUrl: MARKER.baseUrl,
	externalId: ENTRY_ID,
	face: 'none',
	reason: 'delivery_unreachable',
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: T0 })
	warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	issuer = makeIssuer()
	delivery = scriptedDelivery(() => json(deliveryBody(issuer.envelope())))
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => delivery.fetch,
		now: () => Date.now(),
		timeoutMs: CARD_DELIVERY_TIMEOUT_MS,
		serverWaitMs: CARD_SERVER_WAIT_MS,
	})
})

afterEach(() => {
	restore()
	warn.mockRestore()
	vi.useRealTimers()
})

/** Let a read that already answered finish its (real, async) verification and land in the cache. */
const landed = (check: (html: string) => void) =>
	vi.waitFor(async () => check((await timed()).html), { timeout: 2_000, interval: 5 })

describe('SC2: a hanging Delivery API costs at most one short wait per placement per failure window', () => {
	it('the first render waits the 300 ms deadline, prints nothing and records the outage', async () => {
		delivery.respond(hang)
		const first = await timed()
		expect(first.waited).toBe(CARD_SERVER_WAIT_MS)
		expect(chromeRoot(first.html)).toBeNull()
		expect(seedOf(first.html)).toEqual(unreachableRecord)
		expect(delivery.calls).toEqual([DELIVERY_URL])
	})

	it('a render every second for a whole failure window: one wait of 300 ms, every other render at once, one read', async () => {
		delivery.respond(hang)
		const waits: number[] = []
		// 60 s of traffic, one render a second, CertREV hanging the whole time (its 8 s read deadline passes in between).
		for (let s = 0; s < CARD_DELIVERY_FAILURE_MS / 1_000; s++) {
			const { html, waited } = await timed()
			expect(chromeRoot(html)).toBeNull()
			waits.push(waited)
			await advance(1_000 - waited)
		}
		expect(waits.filter((w) => w > 0)).toEqual([CARD_SERVER_WAIT_MS])
		expect(delivery.calls).toHaveLength(1)
	})

	it('after the window, the next render waits once more (and only once), then the window starts again', async () => {
		delivery.respond(hang)
		expect((await timed()).waited).toBe(CARD_SERVER_WAIT_MS)
		// The read that hung fails at its own 8 s deadline, and the failure is remembered 60 s from then.
		await advance(CARD_DELIVERY_TIMEOUT_MS - CARD_SERVER_WAIT_MS + CARD_DELIVERY_FAILURE_MS - 1)
		expect((await timed()).waited).toBe(0)
		await advance(1)
		expect((await timed()).waited).toBe(CARD_SERVER_WAIT_MS)
		expect((await timed()).waited).toBe(0)
		expect(delivery.calls).toHaveLength(2)
	})

	it('a fast failure (a 503, a refused connection) prints nothing at once and is remembered the same 60 s', async () => {
		for (const answer of [() => json({ error: 'unavailable' }, 503), () => Promise.reject(new TypeError('refused'))]) {
			restore()
			restore = setCardDeliveryRuntimeForTests({
				resolveKid: issuer.resolveKid,
				fetchImpl: () => delivery.fetch,
				now: () => Date.now(),
				timeoutMs: CARD_DELIVERY_TIMEOUT_MS,
				serverWaitMs: CARD_SERVER_WAIT_MS,
			})
			delivery.calls.length = 0
			delivery.respond(answer)
			expect((await timed()).waited).toBe(0)
			await advance(CARD_DELIVERY_FAILURE_MS - 1)
			expect(chromeRoot((await timed()).html)).toBeNull()
			expect(delivery.calls).toHaveLength(1)
		}
	})

	it('CertREV back after the window: the next render paints the card', async () => {
		delivery.respond(hang)
		await timed()
		delivery.respond(() => json(deliveryBody(issuer.envelope())))
		await advance(CARD_DELIVERY_FAILURE_MS + CARD_DELIVERY_TIMEOUT_MS)
		const back = await timed()
		expect(back.html).toContain(PAINTED)
		expect(back.waited).toBe(0)
	})

	it('each placement has its own window: another entry still gets its own one wait', async () => {
		delivery.respond(hang)
		expect((await timed()).waited).toBe(CARD_SERVER_WAIT_MS)
		const other = card({ builderContext: { content: { id: 'entry-fixture-2' } } })
		expect((await timed(other)).waited).toBe(CARD_SERVER_WAIT_MS)
		expect((await timed(other)).waited).toBe(0)
		expect(delivery.calls).toHaveLength(2)
	})
})

describe('SC2: concurrent renders never wait behind a read in flight', () => {
	it('20 renders that start while the first read hangs (other requests) all finish at once, with nothing and no read', async () => {
		delivery.respond(hang)
		let firstDone = false
		const first = renderToHtml(card()).then((html) => {
			firstDone = true
			return html
		})
		await vi.advanceTimersByTimeAsync(10)
		const others: string[] = []
		for (let i = 0; i < 50; i++) {
			// Each in its own task, as another request's render is.
			await new Promise<void>((resolve) => setImmediate(resolve))
			const { html, waited } = await timed()
			expect(waited).toBe(0)
			others.push(html)
		}
		expect(firstDone).toBe(false)
		for (const html of others) {
			expect(chromeRoot(html)).toBeNull()
			// 2.0.2 (final review R1-2): a skipped render writes no record (it knows nothing of the placement), only its marker.
			expect(seedOf(html)).toBeNull()
			expect(html).toContain('data-certrev-skipped=')
		}
		// Not failures: nothing reported for the skipped renders.
		expect(warn).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(CARD_SERVER_WAIT_MS)
		await first
		expect(delivery.calls).toHaveLength(1)
	})

	it('even when the read in flight then answers: a concurrent render never waited for it, the next one paints', async () => {
		delivery.respond(
			() => new Promise<Response>((resolve) => setTimeout(() => resolve(json(deliveryBody(issuer.envelope()))), 200)),
		)
		const first = timed()
		await new Promise<void>((resolve) => setImmediate(resolve))
		const concurrent = await timed()
		expect(concurrent.waited).toBe(0)
		expect(chromeRoot(concurrent.html)).toBeNull()
		const settledFirst = await first
		expect(settledFirst.html).toContain(PAINTED)
		expect(settledFirst.waited).toBeLessThanOrEqual(CARD_SERVER_WAIT_MS)
		expect((await timed()).html).toContain(PAINTED)
		expect(delivery.calls).toHaveLength(1)
	})

	it('two cards of one placement in one page render: one read, one wait (the second card does not add one)', async () => {
		delivery.respond(hang)
		const page = await timed(
			<>
				{card()}
				{card({ mode: 'sidebar' })}
			</>,
		)
		expect(page.waited).toBe(CARD_SERVER_WAIT_MS)
		expect(page.html).toContain('data-certrev-skipped=')
		expect(delivery.calls).toHaveLength(1)
	})
})

describe('final review R1-1: independent renders started in the same task never wait on each other', () => {
	/** `renderToReadableStream` from React's web build: it renders synchronously inside the call (no task boundary). */
	async function readableHtml(element: ReturnType<typeof card>): Promise<string> {
		const stream = await renderToReadableStream(element)
		await stream.allReady
		return new Response(stream).text()
	}

	it.each<[string, (element: ReturnType<typeof card>) => Promise<string>]>([
		['renderToPipeableStream', renderToHtml],
		['renderToReadableStream (web build)', readableHtml],
	])('%s: two roots started back to back, no await between: the second finishes at once, the first waits 300 ms', async (_api, render) => {
		delivery.respond(hang)
		let firstDone = false
		let secondDone = false
		const first = render(card()).then((html) => {
			firstDone = true
			return html
		})
		const second = render(card()).then((html) => {
			secondDone = true
			return html
		})
		await settleIo()
		expect(secondDone).toBe(true)
		expect(firstDone).toBe(false)
		expect(await second).toContain('data-certrev-skipped=')
		await vi.advanceTimersByTimeAsync(CARD_SERVER_WAIT_MS)
		await settleIo()
		expect(firstDone).toBe(true)
		expect(seedOf(await first)).toEqual(unreachableRecord)
		expect(delivery.calls).toHaveLength(1)
	})
})

describe('SC1/SC2: a warm card never waits, and refreshes off the render path', () => {
	it('fresh, then stale under a hanging CertREV, then past the stale window: no render ever waits', async () => {
		expect((await timed()).html).toContain(PAINTED)
		delivery.respond(hang)
		// Fresh: no read at all.
		await advance(CARD_DELIVERY_TTL_MS - 1)
		const fresh = await timed()
		expect(fresh).toMatchObject({ waited: 0 })
		expect(fresh.html).toContain(PAINTED)
		expect(delivery.calls).toHaveLength(1)
		// Stale: painted at once while ONE background refresh hangs.
		await advance(2)
		for (let i = 0; i < 5; i++) {
			const stale = await timed()
			expect(stale.waited).toBe(0)
			expect(stale.html).toContain(PAINTED)
		}
		expect(delivery.calls).toHaveLength(2)
		// The refresh fails at its 8 s deadline: the failure is remembered, the stale card keeps painting, no new refresh.
		await advance(CARD_DELIVERY_TIMEOUT_MS)
		const stillStale = await timed()
		expect(stillStale.waited).toBe(0)
		expect(stillStale.html).toContain(PAINTED)
		expect(delivery.calls).toHaveLength(2)
		// Past the stale window, inside the failure window: nothing, at once, no read.
		await advance(CARD_DELIVERY_STALE_MS)
		const gone = await timed()
		expect(gone.waited).toBe(0)
		expect(chromeRoot(gone.html)).toBeNull()
		expect(seedOf(gone.html)).toEqual(unreachableRecord)
		expect(delivery.calls).toHaveLength(2)
	})

	it('a stale card whose refresh answers in time is replaced in the background; the render that started it did not wait', async () => {
		expect((await timed()).html).toContain(PAINTED)
		delivery.respond(
			() =>
				new Promise<Response>((resolve) =>
					setTimeout(
						() =>
							resolve(
								json(
									deliveryBody(issuer.envelope(), {
										v: 9,
										preset: 'p',
										rung: 'r',
										tokens: { accentColor: '#e6007e' },
										hidden: [],
									}),
								),
							),
						2_000,
					),
				),
		)
		await advance(CARD_DELIVERY_TTL_MS + 1)
		const stale = await timed()
		expect(stale.waited).toBe(0)
		expect(stale.html).not.toContain('#e6007e')
		await vi.advanceTimersByTimeAsync(2_000)
		await landed((html) => expect(html).toContain('#e6007e'))
	})
})

describe('2.0.2 plan advice A2: a background refresh still running when the stale window ends', () => {
	it('the next render does not wait behind it, and paints once it lands', async () => {
		expect((await timed()).html).toContain(PAINTED)
		delivery.respond(
			() => new Promise<Response>((resolve) => setTimeout(() => resolve(json(deliveryBody(issuer.envelope()))), 2_000)),
		)
		// One render inside the last millisecond of the stale window starts the refresh (and paints the stale card).
		await advance(CARD_DELIVERY_TTL_MS + CARD_DELIVERY_STALE_MS - 1)
		const last = await timed()
		expect(last.html).toContain(PAINTED)
		expect(delivery.calls).toHaveLength(2)
		await advance(1)
		const after = await timed()
		expect(after.waited).toBe(0)
		expect(chromeRoot(after.html)).toBeNull()
		expect(delivery.calls).toHaveLength(2)
		await advance(2_000)
		await landed((html) => expect(html).toContain(PAINTED))
		expect(delivery.calls).toHaveLength(2)
	})
})

describe('SC2: revocation still lands (ADR 0001 §7), and a remembered failure never paints', () => {
	it('a stale card whose background refresh reads a tombstone stops painting', async () => {
		expect((await timed()).html).toContain(PAINTED)
		const tombstone = await issuer.tombstone()
		delivery.respond(() => json(tombstone))
		await advance(CARD_DELIVERY_TTL_MS + 1)
		expect((await timed()).html).toContain(PAINTED)
		await landed((html) => expect(chromeRoot(html)).toBeNull())
		const after = await timed()
		expect(seedOf(after.html)).not.toMatchObject({ reason: 'delivery_unreachable' })
	})

	it('a 404 for a stale card stops painting at once (a definitive no is never painted over)', async () => {
		expect((await timed()).html).toContain(PAINTED)
		delivery.respond(() => json({ error: 'not found' }, 404))
		await advance(CARD_DELIVERY_TTL_MS + 1)
		await timed()
		await landed((html) => expect(chromeRoot(html)).toBeNull())
	})

	it('a revocation after an outage: the remembered failure prints nothing, and the first read after it reads the tombstone', async () => {
		expect((await timed()).html).toContain(PAINTED)
		delivery.respond(hang)
		await advance(CARD_DELIVERY_TTL_MS + 1)
		await timed()
		await advance(CARD_DELIVERY_TIMEOUT_MS + CARD_DELIVERY_STALE_MS)
		expect(chromeRoot((await timed()).html)).toBeNull()
		const tombstone = await issuer.tombstone()
		delivery.respond(() => json(tombstone))
		await advance(CARD_DELIVERY_FAILURE_MS)
		const revoked = await timed()
		expect(chromeRoot(revoked.html)).toBeNull()
		expect(seedOf(revoked.html)).not.toMatchObject({ reason: 'delivery_unreachable' })
		expect(revoked.waited).toBe(0)
	})
})
