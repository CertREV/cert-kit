// @vitest-environment jsdom
/**
 * 2.0.2, final review R1-2: a second card of one placement that a streamed server render reaches only after another
 * card started the placement's read (behind a Suspense boundary that resolves while the read runs) is skipped: it prints
 * a marker naming its instance and no record. Hydration keeps the first card's verified seed for the placement, hydrates
 * the skipped card as its marker (no mismatch, no recoverable error), and right after paints it from that seed, with no
 * browser read.
 */

import { act, Suspense } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CertReviewCard, type CertReviewCardProps, SKIPPED_ATTRIBUTE } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import {
	deliveryBody,
	ENTRY_ID,
	json,
	MARKER,
	makeIssuer,
	renderToHtml,
	scriptedDelivery,
	T0,
} from './delivery-harness.js'
import { OPTIONS_ONLY_SHAPES } from './options-only-shapes.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let restore: () => void = () => {}
let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
	warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
	restore()
	warn.mockRestore()
	document.body.innerHTML = ''
})

const card = (extra: Partial<CertReviewCardProps> = {}) => (
	<CertReviewCard
		{...(OPTIONS_ONLY_SHAPES.todaysExport as CertReviewCardProps)}
		delivery={MARKER}
		builderContext={{ content: { id: ENTRY_ID } }}
		{...extra}
	/>
)

/** Suspends once for `ms` (on the server), then renders its children; already resolved in the browser. */
let delayed: { done: boolean; pending?: Promise<void> } = { done: false }
function Delayed({ ms, children }: { readonly ms: number; readonly children: React.ReactNode }) {
	if (!delayed.done) {
		delayed.pending ??= new Promise<void>((resolve) =>
			setTimeout(() => {
				delayed.done = true
				resolve()
			}, ms),
		)
		throw delayed.pending
	}
	return <>{children}</>
}

const page = () => (
	<div>
		{card()}
		<p>The article.</p>
		<Suspense fallback={null}>
			<Delayed ms={50}>{card({ mode: 'sidebar' })}</Delayed>
		</Suspense>
	</div>
)

it('R1-2: a delayed sibling is skipped on the server, hydrates as its marker, and then paints from the first card’s seed', async () => {
	delayed = { done: false }
	const issuer = makeIssuer()
	// The read takes 200 ms; the sibling's boundary resolves at 50 ms, while it runs.
	const server = scriptedDelivery(
		() => new Promise<Response>((resolve) => setTimeout(() => resolve(json(deliveryBody(issuer.envelope()))), 200)),
	)
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => server.fetch,
		now: () => T0,
	})
	const html = await renderToHtml(page())
	restore()
	expect(server.calls).toHaveLength(1)
	expect(html.split('<div data-certrev-cert-chrome').length - 1).toBe(1)
	expect(html).toContain(`${SKIPPED_ATTRIBUTE}=`)
	// The skipped sibling is not a failure: nothing reported.
	expect(warn).not.toHaveBeenCalled()

	// The browser: every read refused (as e.l.f.'s CSP refuses it), counted.
	const calls: string[] = []
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () =>
			(async (url: RequestInfo | URL) => {
				calls.push(String(url))
				throw new TypeError('Failed to fetch')
			}) as typeof fetch,
		now: () => T0,
	})
	const container = document.createElement('div')
	container.innerHTML = html
	document.body.appendChild(container)
	const firstCard = container.querySelector('[data-certrev-cert-chrome]')
	const recoverable: unknown[] = []
	const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
	try {
		await act(async () => {
			hydrateRoot(container, page(), { onRecoverableError: (e) => recoverable.push(e) })
		})
		for (let i = 0; i < 20; i++) {
			await act(async () => {
				await new Promise((r) => setTimeout(r, 5))
			})
		}
		expect(consoleError).not.toHaveBeenCalled()
	} finally {
		consoleError.mockRestore()
	}
	expect(recoverable).toEqual([])
	// The first card hydrated in place; the sibling now paints the same verified card; nothing was read.
	expect(container.querySelector('[data-certrev-cert-chrome]')).toBe(firstCard)
	expect(container.querySelectorAll('[data-certrev-cert-chrome]')).toHaveLength(2)
	expect(container.querySelector(`[${SKIPPED_ATTRIBUTE}]`)).toBeNull()
	expect(calls).toEqual([])
})
