/**
 * 2.0.0, the contract-1 card on a React with `use` (React 19): a cold server render hands `use` the read's promise and
 * nothing else, because the read computes the card's digest itself (`get-verified-delivery.ts`). A second suspension in
 * the same render (on the digest) is what React 19's `use` answers with the FIRST promise's result: the replica on React
 * 19 printed nothing (`card_verify_failed`) until this. `use` is mocked to record the promise it is given and suspend by
 * throwing it, as in `delivered-face-use.test.tsx`; the real React 19 runs in `vitest.react19.config.ts`.
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

import { cardPartsFor } from '../card-contract.js'
import { CertReviewCard } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import { contractBody, contractFixture, expectedCardHtml } from './contract-v1-shapes.js'
import { ENTRY_ID, json, MARKER, makeIssuer, renderToHtml, T0 } from './delivery-harness.js'

const issuer = makeIssuer()
const fixture = contractFixture('banner-elf-like')
let restore: () => void = () => {}
afterEach(() => restore())
beforeEach(() => {
	used.length = 0
	const fetchImpl = (async () => json(contractBody(issuer, fixture))) as typeof fetch
	restore = setCardDeliveryRuntimeForTests({ resolveKid: issuer.resolveKid, fetchImpl: () => fetchImpl, now: () => T0 })
})

it('suspends once, on the read, and prints the card', async () => {
	const html = await renderToHtml(<CertReviewCard delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} />)
	expect(html).toContain(expectedCardHtml(fixture.card, cardPartsFor(fixture.card, undefined)))
	expect(used).toHaveLength(1)
})
