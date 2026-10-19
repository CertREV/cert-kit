/**
 * 1.3.0, the delivered face on a React with `use` (React 19): the card hands `use` the read's promise, then ONE promise
 * per face for its hashes (memoized by the face's content), so a replayed render sees the promise it first saw and a
 * second card with the same face suspends on nothing new.
 *
 * `use` is mocked here to record the promise it is given and suspend by throwing it (the protocol the installed React
 * renders), as in `design-pin-card-use.test.tsx`.
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const used = vi.hoisted(() => [] as Promise<unknown>[])
vi.mock('react', async (importOriginal) => {
	const actual = await importOriginal<typeof import('react')>()
	return {
		...actual,
		use: (promise: Promise<unknown>) => {
			used.push(promise)
			throw promise
		},
	}
})

import { CertReviewCard } from '../cert-review-card.js'
import { faceHashesFor } from '../delivered-face.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import { DELIVERED_FACE, fixedIssuer, matchingBody } from './delivered-face-shapes.js'
import { ENTRY_ID, json, MARKER, renderToHtml, T0 } from './delivery-harness.js'

let restore: () => void = () => {}
let calls: string[] = []
afterEach(() => restore())
beforeEach(() => {
	used.length = 0
	calls = []
	const issuer = fixedIssuer()
	const fetchImpl = (async (input: RequestInfo | URL) => {
		calls.push(String(input))
		return json(matchingBody(issuer))
	}) as typeof fetch
	restore = setCardDeliveryRuntimeForTests({ resolveKid: issuer.resolveKid, fetchImpl: () => fetchImpl, now: () => T0 })
})

const card = () => <CertReviewCard delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} />

it('suspends on the read, then on one promise for the face hashes, and paints the delivered face', async () => {
	const html = await renderToHtml(card())
	expect(html).toContain('data-certrev-face="delivered"')
	expect(calls).toHaveLength(1)
	expect(used).toHaveLength(2)
	expect(used[1]).toBe(faceHashesFor(DELIVERED_FACE).pending)
})

it('a second card with the same face suspends on nothing new', async () => {
	await renderToHtml(card())
	used.length = 0
	const page = await renderToHtml(
		<>
			{card()}
			{card()}
		</>,
	)
	expect(page.split('data-certrev-face="delivered"').length - 1).toBe(2)
	expect(used).toEqual([])
	expect(calls).toHaveLength(1)
})
