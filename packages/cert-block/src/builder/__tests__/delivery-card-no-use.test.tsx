/**
 * The delivery card on a React without `use` (React 18, which `peerDependencies` still allows):
 * it suspends by throwing the in-flight promise, the protocol React 18 supports. `react` is
 * mocked here with `use` removed, so this file runs the throw path against the installed React.
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('react', async (importOriginal) => {
	const actual = await importOriginal<typeof import('react')>()
	return { ...actual, use: undefined }
})

import * as React from 'react'
import { CertReviewCard } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import {
	chromeRoot,
	DELIVERY_URL,
	deliveryBody,
	ENTRY_ID,
	json,
	MARKER,
	makeIssuer,
	renderToHtml,
	scriptedDelivery,
	T0,
} from './delivery-harness.js'

let restore: () => void = () => {}
afterEach(() => restore())

let issuer: ReturnType<typeof makeIssuer>
let delivery: ReturnType<typeof scriptedDelivery>
beforeEach(() => {
	issuer = makeIssuer()
	delivery = scriptedDelivery(() => json(deliveryBody(issuer.envelope())))
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => delivery.fetch,
		now: () => T0,
	})
})

it('runs with `use` absent', () => {
	expect((React as unknown as { use?: unknown }).use).toBeUndefined()
})

it('paints the verified face by throwing the read to Suspense', async () => {
	const html = await renderToHtml(<CertReviewCard delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} />)
	expect(chromeRoot(html)).toContain('data-certrev-delivery=""')
	expect(html).toContain('Dr. Jane Doe')
	expect(delivery.calls).toEqual([DELIVERY_URL])
})

it('renders nothing for a tombstone on the same path', async () => {
	const tombstone = await issuer.tombstone()
	delivery.respond(() => json(tombstone))
	const html = await renderToHtml(
		<CertReviewCard reviewerName="Dr. Jane Doe" delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} />,
	)
	expect(chromeRoot(html)).toBeNull()
})
