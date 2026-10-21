// @vitest-environment jsdom
/**
 * Regression for the pre-review break-it pass on 2.0.0, finding B2: a split header and memo block pair for one entry,
 * on a design whose memo block has nothing to print (a sidebar, a floating pill, a banner with no memo), used to write a
 * `'none'` record under the same placement as the header block's seed; read last on hydration, it took the header
 * block's card down. Now the memo block prints nothing and writes no record: the server's card hydrates as it stands.
 */

import { canonicalizeJson } from '@certrev/cert-contract'
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { CertReviewCard, type CertReviewCardProps } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import { type ContractCase, type ContractFixture, contractBody, contractFixture } from './contract-v1-shapes.js'
import { sha256Hex } from './delivered-face-shapes.js'
import { ENTRY_ID, json, MARKER, makeIssuer, renderToHtml, scriptedDelivery, T0 } from './delivery-harness.js'
import { OPTIONS_ONLY_SHAPES } from './options-only-shapes.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const issuer = makeIssuer()
let restore: () => void = () => {}
afterEach(() => {
	restore()
	document.body.innerHTML = ''
})

const block = (extra: Partial<CertReviewCardProps>) => (
	<CertReviewCard
		{...(OPTIONS_ONLY_SHAPES.todaysExport as CertReviewCardProps)}
		delivery={MARKER}
		builderContext={{ content: { id: ENTRY_ID } }}
		{...extra}
	/>
)
const page = () => (
	<div>
		{block({ part: 'header' })}
		<p>The article.</p>
		{block({ part: 'memo' })}
	</div>
)

/** A banner document with no memo part (the memo-less rung), re-digested. */
function memoLessBanner(): ContractFixture {
	const fixture = contractFixture('banner-elf-like')
	const card = { ...fixture.card, parts: { top: fixture.card.parts.top } }
	return { ...fixture, card, doc: sha256Hex(canonicalizeJson(card)) }
}

it.each<[string, () => ContractFixture]>([
	['sidebar', () => contractFixture('sidebar-elf-like' as ContractCase)],
	['floating', () => contractFixture('floating-elf-like' as ContractCase)],
	['memo-less banner', memoLessBanner],
	['banner (both blocks print)', () => contractFixture('banner-elf-like')],
])('B2: %s: the split pair hydrates with the server card intact, no mismatch, no read', async (_label, make) => {
	const fixture = make()
	const server = scriptedDelivery(() => json(contractBody(issuer, fixture)))
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => server.fetch,
		now: () => T0,
	})
	const html = await renderToHtml(page())
	restore()
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
	const before = container.querySelectorAll('certrev-card').length
	expect(before).toBeGreaterThan(0)
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
	} finally {
		consoleError.mockRestore()
	}
	expect(recoverable).toEqual([])
	expect(container.querySelectorAll('certrev-card').length).toBe(before)
	expect(calls).toEqual([])
})
