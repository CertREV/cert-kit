/**
 * The design pin on a React with `use` (React 19): the card hands `use` ONE promise per placement AND pin, so a pinned
 * and an unpinned card on one page never settle from each other's read. React 19's `use` replays a suspended
 * component with the promise it first saw, so a shared promise would paint one card with the other's def.
 *
 * `use` is mocked here to record the promise it is given and suspend by throwing it (the protocol the installed React
 * renders), so this file pins what the card passes to `use`, not React's own bookkeeping.
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
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import {
	chromeRoot,
	DELIVERY_URL,
	deliveryBody,
	ELF_LIKE_DEF,
	ENTRY_ID,
	json,
	MARKER,
	makeIssuer,
	renderToHtml,
	T0,
	withoutSeed,
} from './delivery-harness.js'
import { RAW_DEFS } from './legacy-face-cases.js'

let restore: () => void = () => {}
let calls: string[] = []
afterEach(() => restore())
beforeEach(() => {
	used.length = 0
	calls = []
	const issuer = makeIssuer()
	// The live design is the legacy def at v 4; the pinned design is the reader def at v 2.
	const byUrl = (async (input: RequestInfo | URL) => {
		calls.push(String(input))
		return json(
			deliveryBody(issuer.envelope(), String(input).includes('?design=') ? RAW_DEFS['face-reader'] : ELF_LIKE_DEF),
		)
	}) as typeof fetch
	restore = setCardDeliveryRuntimeForTests({ resolveKid: issuer.resolveKid, fetchImpl: () => byUrl, now: () => T0 })
})

const card = (pin?: unknown) => (
	<CertReviewCard
		delivery={MARKER}
		builderContext={{ content: { id: ENTRY_ID }, context: pin === undefined ? undefined : { certrevDesignPin: pin } }}
	/>
)

it('a pinned and an unpinned card suspend on two promises, and each paints its own def', async () => {
	const html = await renderToHtml(
		<>
			{card({ design: '2', designBrand: 'staging-shopify-canary' })}
			{card()}
		</>,
	)
	// One suspend per card, each on its own read: a card handed the other's promise would suspend a second time.
	expect(used).toHaveLength(2)
	expect(new Set(used).size).toBe(2)
	expect([...calls].sort()).toEqual([DELIVERY_URL, `${DELIVERY_URL}?design=2&designBrand=staging-shopify-canary`])
	const roots = html.split('<div data-certrev-cert-chrome').slice(1)
	expect(roots).toHaveLength(2)
	expect(withoutSeed(chromeRoot(html) ?? '')).toContain('data-certrev-def-version="2" data-certrev-face="reader"')
	expect(withoutSeed(roots[1] ?? '')).toContain('data-certrev-def-version="4">')
})

it('two pins that differ only by brand are two promises too', async () => {
	await renderToHtml(
		<>
			{card({ design: '2', designBrand: 'brand-a' })}
			{card({ design: '2', designBrand: 'brand-b' })}
			{card({ design: '2' })}
		</>,
	)
	expect(used).toHaveLength(3)
	expect(new Set(used).size).toBe(3)
	expect(calls).toHaveLength(3)
})
