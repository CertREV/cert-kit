/**
 * 2.0.2 (SC1, SC2), as 2.1.2 changed them: a cold server render waits at most `CARD_SERVER_WAIT_MS` (1,500 ms) with one
 * retry, no failure is ever remembered as a miss, a card that painted is never blanked by a slow or failed read (its last
 * good card paints), concurrent renders never wait behind a read in flight, and a revocation still lands.
 *
 * The real card, cache, kernel and fixture-signed envelopes; only the fetch is scripted and `setTimeout` is faked, so a
 * render's wait is measured in the fake milliseconds it needed (`timed`). Every render here is a server render
 * (`renderToPipeableStream`, no `document`).
 */

import { renderToReadableStream } from 'react-dom/server.browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CertReviewCard, type CertReviewCardProps } from '../cert-review-card.js'
import {
	CARD_DELIVERY_LAST_GOOD_MS,
	CARD_DELIVERY_REFRESH_BACKOFF_MS,
	CARD_DELIVERY_RETRY_MS,
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

/** A Delivery answer after `ms` fake milliseconds. */
const answerAfter =
	(ms: number, body: () => unknown = () => deliveryBody(issuer.envelope()), status = 200) =>
	() =>
		new Promise<Response>((resolve) => setTimeout(() => resolve(json(body(), status)), ms))

/** Answers in turn, the last one for every later request. */
const inTurn = (...answers: (() => Response | Promise<Response>)[]) => {
	let i = 0
	return () => {
		const answer = answers[Math.min(i, answers.length - 1)] as () => Response | Promise<Response>
		i += 1
		return answer()
	}
}

const RECOLORED = { v: 9, preset: 'p', rung: 'r', tokens: { accentColor: '#e6007e' }, hidden: [] }

describe('2.1.2: a cold render waits long enough for a real Delivery API, with one retry', () => {
	it('a 550 ms answer (staging, the 2026-11-18 real-card proof) paints on the first render, with one request', async () => {
		delivery.respond(answerAfter(550))
		const first = await timed()
		expect(first.html).toContain(PAINTED)
		expect(first.waited).toBe(550)
		expect(delivery.calls).toEqual([DELIVERY_URL])
	})

	it('a first request with no answer by 700 ms gets a second beside it, and the first answer paints', async () => {
		delivery.respond(inTurn(hang, answerAfter(300)))
		const first = await timed()
		expect(first.html).toContain(PAINTED)
		expect(first.waited).toBe(CARD_DELIVERY_RETRY_MS + 300)
		expect(delivery.calls).toHaveLength(2)
	})

	it('a first request that fails at once (a 503, a refused connection) is retried at once, and the retry paints', async () => {
		for (const failure of [() => json({ error: 'unavailable' }, 503), () => Promise.reject(new TypeError('refused'))]) {
			restore()
			restore = setCardDeliveryRuntimeForTests({
				resolveKid: issuer.resolveKid,
				fetchImpl: () => delivery.fetch,
				now: () => Date.now(),
				timeoutMs: CARD_DELIVERY_TIMEOUT_MS,
				serverWaitMs: CARD_SERVER_WAIT_MS,
			})
			delivery.calls.length = 0
			delivery.respond(inTurn(failure, () => json(deliveryBody(issuer.envelope()))))
			const first = await timed()
			expect(first.html).toContain(PAINTED)
			expect(first.waited).toBe(0)
			expect(delivery.calls).toHaveLength(2)
		}
	})

	it('a hanging CertREV: the first render waits 1,500 ms (its retry went out at 700 ms) and prints nothing', async () => {
		delivery.respond(hang)
		const first = await timed()
		expect(first.waited).toBe(CARD_SERVER_WAIT_MS)
		expect(chromeRoot(first.html)).toBeNull()
		expect(seedOf(first.html)).toEqual(unreachableRecord)
		expect(delivery.calls).toEqual([DELIVERY_URL, DELIVERY_URL])
	})

	it('two failures (a 503 twice): nothing at once, with the status, and no wait', async () => {
		delivery.respond(() => json({ error: 'unavailable' }, 503))
		const first = await timed()
		expect(first.waited).toBe(0)
		expect(chromeRoot(first.html)).toBeNull()
		expect(seedOf(first.html)).toEqual(unreachableRecord)
		expect(delivery.calls).toHaveLength(2)
	})
})

describe('2.1.2: a timeout or an error is never cached as a miss', () => {
	it('after a render that timed out, the first render once the reads end reads again, and paints when CertREV answers', async () => {
		delivery.respond(hang)
		expect(chromeRoot((await timed()).html)).toBeNull()
		// While the two reads still run (their own 8 s deadline), a render does not wait on them and sends nothing.
		const meanwhile = await timed()
		expect(meanwhile.waited).toBe(0)
		expect(delivery.calls).toHaveLength(2)
		// 2.0.2 remembered the failure 60 s from here. 2.1.2 remembers nothing: the next render reads.
		await advance(CARD_DELIVERY_TIMEOUT_MS)
		delivery.respond(() => json(deliveryBody(issuer.envelope())))
		const back = await timed()
		expect(back.html).toContain(PAINTED)
		expect(back.waited).toBe(0)
		expect(delivery.calls).toHaveLength(3)
	})

	it('after two 503s, the very next render reads again (2.0.2: nothing for 60 s)', async () => {
		delivery.respond(() => json({ error: 'unavailable' }, 503))
		expect(chromeRoot((await timed()).html)).toBeNull()
		await advance(1)
		delivery.respond(() => json(deliveryBody(issuer.envelope())))
		expect((await timed()).html).toContain(PAINTED)
		expect(delivery.calls).toHaveLength(3)
	})

	it('a read slower than the wait lands in the cache, and the next render paints it with no new request', async () => {
		delivery.respond(answerAfter(5_000))
		const first = await timed()
		expect(first.waited).toBe(CARD_SERVER_WAIT_MS)
		expect(chromeRoot(first.html)).toBeNull()
		await advance(5_000 - CARD_SERVER_WAIT_MS)
		await landed((html) => expect(html).toContain(PAINTED))
		expect(delivery.calls).toHaveLength(2)
	})

	it('each placement reads for itself: another entry still gets its own read', async () => {
		delivery.respond(() => json({ error: 'unavailable' }, 503))
		await timed()
		const other = card({ builderContext: { content: { id: 'entry-fixture-2' } } })
		await timed(other)
		expect(delivery.calls).toHaveLength(4)
	})
})

describe('SC2: concurrent renders never wait behind a read in flight', () => {
	it('50 renders that start while the first read hangs (other requests) all finish at once, with nothing and no read', async () => {
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
		// The first render's request and its one retry; none from the 50.
		expect(delivery.calls).toHaveLength(2)
	})

	it('even when the read in flight then answers: a concurrent render never waited for it, the next one paints', async () => {
		delivery.respond(answerAfter(200))
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
		expect(delivery.calls).toHaveLength(2)
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
	])('%s: two roots started back to back, no await between: the second finishes at once, the first waits', async (_api, render) => {
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
		expect(delivery.calls).toHaveLength(2)
	})
})

describe('2.1.2: a card that painted is never blanked by a slow or failed read', () => {
	it('fresh, stale, then past the stale window under a hanging CertREV: the card paints at every render', async () => {
		expect((await timed()).html).toContain(PAINTED)
		delivery.respond(hang)
		// Fresh: no read at all.
		await advance(CARD_DELIVERY_TTL_MS - 1)
		expect(await timed()).toMatchObject({ waited: 0, html: expect.stringContaining(PAINTED) })
		expect(delivery.calls).toHaveLength(1)
		// Stale: painted at once while ONE background refresh hangs.
		await advance(2)
		for (let i = 0; i < 5; i++) {
			expect(await timed()).toMatchObject({ waited: 0, html: expect.stringContaining(PAINTED) })
		}
		expect(delivery.calls).toHaveLength(2)
		// The refresh fails at its 8 s deadline (its retry, sent at 700 ms, too): the refresh backoff starts now.
		await advance(CARD_DELIVERY_RETRY_MS + CARD_DELIVERY_TIMEOUT_MS)
		expect(await timed()).toMatchObject({ waited: 0, html: expect.stringContaining(PAINTED) })
		expect(delivery.calls).toHaveLength(3)
		// 2.0.2 printed nothing past the stale window. 2.1.2 paints the last good card, at once, with no read in the backoff.
		await advance(CARD_DELIVERY_STALE_MS - CARD_DELIVERY_RETRY_MS - CARD_DELIVERY_TIMEOUT_MS)
		const past = await timed()
		expect(past).toMatchObject({ waited: 0, html: expect.stringContaining(PAINTED) })
		expect(seedOf(past.html)).not.toEqual(unreachableRecord)
		// (The backoff runs 30 s from the failure, which landed a millisecond into the stale window.)
		await advance(
			CARD_DELIVERY_REFRESH_BACKOFF_MS -
				CARD_DELIVERY_STALE_MS +
				CARD_DELIVERY_RETRY_MS +
				CARD_DELIVERY_TIMEOUT_MS -
				10,
		)
		expect(await timed()).toMatchObject({ waited: 0, html: expect.stringContaining(PAINTED) })
		expect(delivery.calls).toHaveLength(3)
		// Past the backoff a render reads again, waits for it at most the 1,500 ms, and still paints the last good card.
		await advance(20)
		const retried = await timed()
		expect(retried.waited).toBe(CARD_SERVER_WAIT_MS)
		expect(retried.html).toContain(PAINTED)
		expect(delivery.calls).toHaveLength(5)
		// And while those reads run, every render paints at once.
		expect(await timed()).toMatchObject({ waited: 0, html: expect.stringContaining(PAINTED) })
		expect(delivery.calls).toHaveLength(5)
	})

	it('a slow refresh past the stale window (550 ms): the render waits for it and paints the new answer', async () => {
		expect((await timed()).html).toContain(PAINTED)
		// No refresh in the stale window (no traffic then): the first render after it reads, and waits.
		delivery.respond(answerAfter(550, () => deliveryBody(issuer.envelope(), RECOLORED)))
		await advance(CARD_DELIVERY_TTL_MS + CARD_DELIVERY_STALE_MS + 1)
		const refreshed = await timed()
		expect(refreshed.waited).toBe(550)
		expect(refreshed.html).toContain('#e6007e')
		expect(delivery.calls).toHaveLength(2)
	})

	it('a refresh past the stale window that fails at once (503 twice): the last good card paints at once', async () => {
		expect((await timed()).html).toContain(PAINTED)
		delivery.respond(() => json({ error: 'unavailable' }, 503))
		await advance(CARD_DELIVERY_TTL_MS + CARD_DELIVERY_STALE_MS + 1)
		const kept = await timed()
		expect(kept.waited).toBe(0)
		expect(kept.html).toContain(PAINTED)
		expect(delivery.calls).toHaveLength(3)
		// And it comes back when CertREV does, after the backoff.
		delivery.respond(() => json(deliveryBody(issuer.envelope(), RECOLORED)))
		await advance(CARD_DELIVERY_REFRESH_BACKOFF_MS)
		expect((await timed()).html).toContain('#e6007e')
	})

	it('a refresh that times out past the stale window paints the last good card at the 1,500 ms wait', async () => {
		expect((await timed()).html).toContain(PAINTED)
		delivery.respond(hang)
		await advance(CARD_DELIVERY_TTL_MS + CARD_DELIVERY_STALE_MS + 1)
		const kept = await timed()
		expect(kept.waited).toBe(CARD_SERVER_WAIT_MS)
		expect(kept.html).toContain(PAINTED)
		expect(seedOf(kept.html)).not.toEqual(unreachableRecord)
	})

	it('never stale forever: an hour past the stale window with no good read, nothing', async () => {
		expect((await timed()).html).toContain(PAINTED)
		delivery.respond(() => json({ error: 'unavailable' }, 503))
		await advance(CARD_DELIVERY_TTL_MS + CARD_DELIVERY_STALE_MS + CARD_DELIVERY_LAST_GOOD_MS - 1)
		expect((await timed()).html).toContain(PAINTED)
		await advance(1)
		const gone = await timed()
		expect(chromeRoot(gone.html)).toBeNull()
		expect(seedOf(gone.html)).toEqual(unreachableRecord)
	})

	it('a stale card whose refresh answers in time is replaced in the background; the render that started it did not wait', async () => {
		expect((await timed()).html).toContain(PAINTED)
		delivery.respond(answerAfter(2_000, () => deliveryBody(issuer.envelope(), RECOLORED)))
		await advance(CARD_DELIVERY_TTL_MS + 1)
		const stale = await timed()
		expect(stale.waited).toBe(0)
		expect(stale.html).not.toContain('#e6007e')
		await vi.advanceTimersByTimeAsync(2_000)
		await landed((html) => expect(html).toContain('#e6007e'))
	})

	it('2.0.2 plan advice A2: a background refresh still running when the stale window ends: the next render paints the last good card at once, then the refreshed one', async () => {
		expect((await timed()).html).toContain(PAINTED)
		delivery.respond(answerAfter(2_000, () => deliveryBody(issuer.envelope(), RECOLORED)))
		await advance(CARD_DELIVERY_TTL_MS + CARD_DELIVERY_STALE_MS - 1)
		expect((await timed()).html).toContain(PAINTED)
		expect(delivery.calls).toHaveLength(2)
		await advance(1)
		const next = await timed()
		expect(next.waited).toBe(0)
		expect(next.html).toContain(PAINTED)
		expect(next.html).not.toContain('#e6007e')
		expect(delivery.calls).toHaveLength(2)
		await advance(2_000)
		await landed((html) => expect(html).toContain('#e6007e'))
		// The refresh, and its retry (sent at 700 ms, before the first answered at 2 s).
		expect(delivery.calls).toHaveLength(3)
	})
})

describe('SC2: revocation still lands (ADR 0001 §7), and a failure never paints over it', () => {
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

	it('past the stale window, a tombstone that takes 550 ms: the render waits for it and prints nothing', async () => {
		expect((await timed()).html).toContain(PAINTED)
		const tombstone = await issuer.tombstone()
		delivery.respond(answerAfter(550, () => tombstone))
		await advance(CARD_DELIVERY_TTL_MS + CARD_DELIVERY_STALE_MS + 1)
		const revoked = await timed()
		expect(revoked.waited).toBe(550)
		expect(chromeRoot(revoked.html)).toBeNull()
		expect(seedOf(revoked.html)).not.toMatchObject({ reason: 'delivery_unreachable' })
		// And nothing brings the old card back: the last good card is gone with the definitive answer.
		delivery.respond(() => json({ error: 'unavailable' }, 503))
		await advance(CARD_DELIVERY_TTL_MS + CARD_DELIVERY_STALE_MS + 1)
		expect(chromeRoot((await timed()).html)).toBeNull()
	})

	it('a revocation after an outage: the last good card paints through it, and the first read after it reads the tombstone', async () => {
		expect((await timed()).html).toContain(PAINTED)
		delivery.respond(hang)
		await advance(CARD_DELIVERY_TTL_MS + 1)
		await timed()
		await advance(CARD_DELIVERY_RETRY_MS + CARD_DELIVERY_TIMEOUT_MS + CARD_DELIVERY_STALE_MS)
		expect((await timed()).html).toContain(PAINTED)
		const tombstone = await issuer.tombstone()
		delivery.respond(() => json(tombstone))
		// The reads of the outage fail at their deadline; one backoff later the next render reads the tombstone.
		await advance(CARD_DELIVERY_RETRY_MS + CARD_DELIVERY_TIMEOUT_MS + CARD_DELIVERY_REFRESH_BACKOFF_MS)
		const revoked = await timed()
		expect(chromeRoot(revoked.html)).toBeNull()
		expect(seedOf(revoked.html)).not.toMatchObject({ reason: 'delivery_unreachable' })
		expect(revoked.waited).toBe(0)
	})
})

describe('2.1.2: the 2026-11-18 real-card proof, replayed', () => {
	it('a page polled every 20 s for 5 minutes against a 550 ms Delivery API paints the card every time (2.0.2: a minute on, a minute off)', async () => {
		delivery.respond(answerAfter(550))
		const painted: boolean[] = []
		for (let poll = 0; poll < 15; poll++) {
			const { html, waited } = await timed()
			painted.push(html.includes(PAINTED))
			expect(waited).toBeLessThanOrEqual(550)
			await advance(20_000 - waited)
		}
		expect(painted).toEqual(Array(15).fill(true))
	})

	it("the same under a runtime that cancels a request's reads when its response ends (workerd, so Oxygen): every poll paints", async () => {
		// A read answers only if the render that sent it is still running 550 ms later; else it never settles.
		let rendering = 0
		let renders = 0
		delivery.respond(() => {
			const sentBy = renders
			return new Promise<Response>((resolve) => {
				setTimeout(() => {
					if (rendering > 0 && renders === sentBy) resolve(json(deliveryBody(issuer.envelope())))
				}, 550)
			})
		})
		const painted: boolean[] = []
		for (let poll = 0; poll < 15; poll++) {
			renders += 1
			rendering += 1
			const { html, waited } = await timed()
			rendering -= 1
			painted.push(html.includes(PAINTED))
			expect(waited).toBeLessThanOrEqual(550)
			await advance(20_000 - waited)
		}
		expect(painted).toEqual(Array(15).fill(true))
	})
})
