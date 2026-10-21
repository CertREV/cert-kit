/**
 * Regressions for the pre-review break-it pass on 2.0.0 (findings B1, B3, B5; B2 is in
 * `break-it-regressions-client.test.tsx`, B7 in `card-contract.test.ts`). Each fails on the code before its fix.
 */

import { canonicalizeJson } from '@certrev/cert-contract'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CertReviewCard, type CertReviewCardProps } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import { contractBody, contractFixture } from './contract-v1-shapes.js'
import { DEFS, DELIVERED_FACE, faceDigestFor, sha256Hex, withFaceDigest } from './delivered-face-shapes.js'
import { builderSubject, json, MARKER, makeIssuer, renderToHtml, T0 } from './delivery-harness.js'
import { OPTIONS_ONLY_SHAPES } from './options-only-shapes.js'

const issuer = makeIssuer()
let restore: () => void = () => {}
afterEach(() => restore())

/** Render a page with one block per entry, each read from `bodyFor`; resolves to the HTML, or 'timeout'. */
async function page(ids: readonly string[], bodyFor: (id: string) => unknown, ms = 20_000): Promise<string> {
	const fetchImpl = (async (url: RequestInfo | URL) =>
		json(bodyFor(String(url).split('/').pop() ?? ''))) as typeof fetch
	restore = setCardDeliveryRuntimeForTests({ resolveKid: issuer.resolveKid, fetchImpl: () => fetchImpl, now: () => T0 })
	const blocks = ids.map((id) =>
		createElement(CertReviewCard, {
			...(OPTIONS_ONLY_SHAPES.todaysExport as CertReviewCardProps),
			key: id,
			delivery: MARKER,
			builderContext: { content: { id } },
		}),
	)
	return Promise.race([
		renderToHtml(createElement('div', null, ...blocks)),
		new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), ms)),
	])
}

describe('B1: a page with more cards than the digest memos hold still finishes', () => {
	it('40 distinct contract-1 cards (the card memo holds 32): every card printed', async () => {
		const fixture = contractFixture('banner-elf-like')
		const bodyFor = (id: string) => {
			const card = { ...fixture.card, subject: { platform: 'builder', externalId: id } }
			const doc = sha256Hex(canonicalizeJson(card))
			return contractBody(issuer, { ...fixture, card, doc }, { payload: { subject: builderSubject(id) } })
		}
		const ids = Array.from({ length: 40 }, (_, i) => `entry-b1-${i}`)
		const html = await page(ids, bodyFor)
		expect(html).not.toBe('timeout')
		// Each banner block prints its card and memo and both dialogs: four hosts.
		expect(html.match(/<certrev-card /g)?.length).toBe(40 * 4)
	}, 30_000)

	it('70 distinct 1.3.0 delivered faces (the face memo holds 64): every face painted', async () => {
		const faceFor = (id: string) => ({ html: `${DELIVERED_FACE.html}<!--${id}-->`, css: DELIVERED_FACE.css })
		const bodyFor = (id: string) => ({
			...issuer.envelope(withFaceDigest(faceDigestFor(faceFor(id), 4), { subject: builderSubject(id) })),
			renderDef: DEFS.legacy,
			face: faceFor(id),
		})
		const ids = Array.from({ length: 70 }, (_, i) => `entry-b1f-${i}`)
		const html = await page(ids, bodyFor)
		expect(html).not.toBe('timeout')
		expect(html.match(/data-certrev-face="delivered"/g)?.length).toBe(70)
	}, 30_000)
})

describe('B3: a browser without Object.hasOwn (Safari before 15.4) still paints every card', () => {
	it('a placement whose signed digest has no contract key paints its 1.3.0 delivered face, as 1.3.1 does', async () => {
		const saved = Object.hasOwn
		delete (Object as { hasOwn?: unknown }).hasOwn
		try {
			const html = await page(['entry-b3'], (id) => ({
				...issuer.envelope(withFaceDigest(faceDigestFor(DELIVERED_FACE, 4), { subject: builderSubject(id) })),
				renderDef: DEFS.legacy,
				face: DELIVERED_FACE,
			}))
			expect(html).toContain('data-certrev-face="delivered"')
		} finally {
			Object.hasOwn = saved
		}
	})
})

describe('B5: CertREV not reached for a block with no options to paint is reported, not silent', () => {
	it('nothing painted, and one delivery_unreachable line', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		try {
			const fetchImpl = (async () => json({ error: 'unavailable' }, 503)) as typeof fetch
			restore = setCardDeliveryRuntimeForTests({
				resolveKid: issuer.resolveKid,
				fetchImpl: () => fetchImpl,
				now: () => T0,
			})
			const html = await renderToHtml(
				<CertReviewCard delivery={MARKER} builderContext={{ content: { id: 'entry-b5' } }} />,
			)
			expect(html).not.toContain('data-certrev-cert-chrome')
			expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
				`[certrev] card_fallback ${JSON.stringify({ reason: 'delivery_unreachable', platform: 'builder', externalId: 'entry-b5' })}`,
			])
		} finally {
			warn.mockRestore()
		}
	})
})
