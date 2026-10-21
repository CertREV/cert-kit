/**
 * 2.0.0, server renders: a Builder block on a contract-1 placement prints CertREV's card document verbatim, and only
 * the document the verified envelope signs; every other contract-1 case prints nothing and reports why; a placement
 * whose signed binding has no `contract` key prints what 1.3.1 prints, byte for byte.
 *
 * The documents are the portal's own (`contract-v1-shapes.ts`); the envelopes are signed with a fixture key and the
 * real kernel verifies them; the card digest is recomputed with WebCrypto.
 */

import { canonicalizeJson } from '@certrev/cert-contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type CardDocumentV1, cardPartsFor } from '../card-contract.js'
import { CertReviewCard, type CertReviewCardProps } from '../cert-review-card.js'
import { BUILDER_CARD_FLOW_CSS } from '../contract-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import { parseFallback, parseSeed, SEED_ATTRIBUTE } from '../ssr-seed.js'
import {
	CONTRACT_CASES,
	type ContractFixture,
	contractBinding,
	contractBody,
	contractFixture,
	expectedCardHtml,
} from './contract-v1-shapes.js'
import { sha256Hex } from './delivered-face-shapes.js'
import {
	ENTRY_ID,
	json,
	MARKER,
	makeIssuer,
	renderToHtml,
	type ScriptedDelivery,
	scriptedDelivery,
	T0,
} from './delivery-harness.js'
import { OPTIONS_ONLY_SHAPES } from './options-only-shapes.js'

const issuer = makeIssuer()
let delivery: ScriptedDelivery
let restore: () => void
let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
	delivery = scriptedDelivery(() => json({ error: 'unset' }, 500))
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => delivery.fetch,
		now: () => T0,
		timeoutMs: 500,
	})
	warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
	restore()
	warn.mockRestore()
})

/** The block as the portal exports it: the 0.5.x options beside the delivery marker. */
const block = (extra: Partial<CertReviewCardProps> = {}) => (
	<CertReviewCard
		{...(OPTIONS_ONLY_SHAPES.todaysExport as CertReviewCardProps)}
		delivery={MARKER}
		builderContext={{ content: { id: ENTRY_ID } }}
		{...extra}
	/>
)

async function serve(body: unknown, element = block()): Promise<string> {
	delivery.respond(() => json(body))
	return renderToHtml(element)
}

/** React's attribute escaping. */
const attr = (raw: string) =>
	raw.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const unattr = (raw: string) =>
	raw
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')

const FLOW = `<style data-certrev-builder-flow="">${BUILDER_CARD_FLOW_CSS}</style>`

/** The card wrapper's opening tag, its inner HTML and what follows it (a rail's flow rule), cut from the stream. */
function cardWrapper(html: string): { open: string; inner: string; after: string } | null {
	const start = html.indexOf('<div data-certrev-cert-chrome')
	if (start === -1) return null
	const openEnd = html.indexOf('>', start) + 1
	const close = html.lastIndexOf('<!--/$-->')
	const tail = html.slice(0, close)
	const after = tail.endsWith(FLOW) ? FLOW : ''
	const end = tail.length - after.length - '</div>'.length
	expect(tail.slice(end, end + '</div>'.length)).toBe('</div>')
	return { open: html.slice(start, openEnd), inner: html.slice(openEnd, end), after }
}

const recordOf = (html: string) => {
	const raw = new RegExp(`${SEED_ATTRIBUTE}="([^"]*)"`).exec(html)?.[1]
	return raw === undefined ? null : unattr(raw)
}

/** What a contract-1 block printed nothing for: the hidden record, and the reason it names and reports. */
function expectNothing(html: string, reason: string | undefined) {
	expect(html).not.toContain('<certrev-card')
	expect(html).not.toContain('data-certrev-cert-chrome')
	expect(html).toMatch(new RegExp(`^<!--\\$--><div hidden="" ${SEED_ATTRIBUTE}="[^"]*"></div><!--/\\$-->$`))
	const record = parseFallback(recordOf(html) ?? '')
	expect(record).toMatchObject({ face: 'none', externalId: ENTRY_ID })
	expect(record?.reason).toBe(reason)
	const reports = warn.mock.calls.map((c) => String(c[0])).filter((line) => line.startsWith('[certrev] card_fallback '))
	if (reason === undefined) expect(reports).toEqual([])
	else {
		expect(reports).toHaveLength(1)
		expect(JSON.parse(reports[0].slice('[certrev] card_fallback '.length))).toEqual({
			reason,
			platform: 'builder',
			externalId: ENTRY_ID,
			certId: contractFixture('banner-elf-like').certId,
		})
	}
}

describe('a contract-1 placement prints the server’s document, byte for byte', () => {
	it.each(
		CONTRACT_CASES,
	)('%s: head, the parts in page order and both dialogs, verbatim; the seed carries the card', async (name) => {
		const fixture = contractFixture(name)
		const html = await serve(contractBody(issuer, fixture))
		const wrapper = cardWrapper(html)
		expect(wrapper).not.toBeNull()
		const names = cardPartsFor(fixture.card, undefined)
		expect(names.length).toBeGreaterThan(0)
		// SC2 at the emission boundary: the inner HTML is the document's own bytes.
		expect(wrapper?.inner).toBe(expectedCardHtml(fixture.card, names))
		for (const part of names) expect(wrapper?.inner).toContain(fixture.card.parts[part] as string)
		// The one byte outside the document: a printed rail's Builder flow rule, after the wrapper (`contract-card.tsx`).
		expect(wrapper?.after).toBe(names.includes('rail') ? FLOW : '')
		expect(wrapper?.open).toContain('data-certrev-face="card"')
		expect(wrapper?.open).toContain('data-certrev-contract="1"')
		expect(wrapper?.open).toContain(`data-certrev-def-version="${fixture.card.defVersion}"`)
		// The seed: the 1.3.1 seed fields with the card last; the card hashes to the signed digest.
		const seed = parseSeed(recordOf(html) ?? '')
		expect(seed?.card).toEqual(fixture.card)
		expect(sha256Hex(canonicalizeJson(seed?.card))).toBe(fixture.doc)
		expect((seed?.payload.content as unknown as { faceDigest: unknown }).faceDigest).toEqual(contractBinding(fixture))
		expect(Object.keys(JSON.parse(recordOf(html) ?? '{}')).at(-1)).toBe('card')
		expect(warn).not.toHaveBeenCalled()
		expect(delivery.calls).toHaveLength(1)
	})

	it('a split banner: the header block prints the card, the memo block the memo, each with the head and both dialogs', async () => {
		const fixture = contractFixture('banner-elf-like')
		const header = cardWrapper(await serve(contractBody(issuer, fixture), block({ part: 'header' })))
		const memo = cardWrapper(await serve(contractBody(issuer, fixture), block({ part: 'memo' })))
		expect(header?.inner).toBe(expectedCardHtml(fixture.card, ['top']))
		expect(memo?.inner).toBe(expectedCardHtml(fixture.card, ['bottom']))
	})

	it('the block’s mode is not read: the saved design’s layout prints', async () => {
		const fixture = contractFixture('sidebar-elf-like')
		const html = await serve(contractBody(issuer, fixture), block({ mode: 'banner' }))
		expect(cardWrapper(html)?.inner).toBe(expectedCardHtml(fixture.card, ['rail']))
	})

	it('a memo block on a sidebar design prints nothing, by design: no card twice, no record, no fallback reported', async () => {
		const fixture = contractFixture('sidebar-elf-like')
		// No record either: one here would share the placement with the header block's seed and, read last on hydration,
		// take that block's card down (break-it B2, `break-it-regressions-client.test.tsx`).
		expect(await serve(contractBody(issuer, fixture), block({ part: 'memo' }))).toBe('<!--$--><!--/$-->')
		expect(warn).not.toHaveBeenCalled()
	})

	it('the runtime, once the portal serves it, is in the block’s HTML after the dialogs', async () => {
		const fixture = contractFixture('floating-elf-like')
		const runtime = {
			src: 'https://portal.certrev.com/api/cert/v1/runtime/card-runtime.0123456789abcdef.js',
			integrity: 'sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC',
		}
		const card = { ...fixture.card, assets: { ...fixture.card.assets, runtime } }
		const doc = sha256Hex(canonicalizeJson(card))
		const html = await serve(contractBody(issuer, { ...fixture, card, doc } as ContractFixture))
		expect(cardWrapper(html)?.inner).toBe(
			`${expectedCardHtml(card, ['pill'])}<script src="${runtime.src}" integrity="${runtime.integrity}" crossorigin="anonymous" defer></script>`,
		)
	})
})

describe('anything else on a contract-1 placement prints nothing and reports why (never a 1.3.1 face)', () => {
	const fixture = contractFixture('banner-elf-like')
	const resigned = (card: unknown) => sha256Hex(canonicalizeJson(card))

	it('no card in the response: card_missing', async () => {
		expectNothing(await serve(contractBody(issuer, fixture, { card: undefined })), 'card_missing')
	})

	it('a null card: card_missing', async () => {
		expectNothing(await serve(contractBody(issuer, fixture, { card: null })), 'card_missing')
	})

	it('a card changed in transit (one byte of a part): card_verify_failed', async () => {
		const card = structuredClone(fixture.card) as CardDocumentV1 & { parts: { top: string } }
		card.parts.top = card.parts.top.replace('Reviewed by', 'Approved by')
		expect(card.parts.top).not.toBe(fixture.card.parts.top)
		expectNothing(await serve(contractBody(issuer, fixture, { card })), 'card_verify_failed')
	})

	it('a card signed for another design version: card_verify_failed', async () => {
		const body = contractBody(issuer, fixture, { faceDigest: contractBinding(fixture, { defVersion: 6 }) })
		expectNothing(await serve(body), 'card_verify_failed')
	})

	it('the signed digest of a card painted for another Builder entry: card_verify_failed (the digest alone is not enough)', async () => {
		const card = { ...fixture.card, subject: { platform: 'builder', externalId: 'entry-other' } }
		const body = contractBody(issuer, fixture, { card, faceDigest: contractBinding(fixture, { doc: resigned(card) }) })
		expectNothing(await serve(body), 'card_verify_failed')
	})

	it('the signed digest of a card for another certificate: card_verify_failed', async () => {
		const card = { ...fixture.card, certId: 'cert-other' }
		const body = contractBody(issuer, fixture, { card, faceDigest: contractBinding(fixture, { doc: resigned(card) }) })
		expectNothing(await serve(body), 'card_verify_failed')
	})

	it('the signed digest of a document that is not a contract-1 card: card_verify_failed', async () => {
		const card = { ...fixture.card, contract: 2 }
		const body = contractBody(issuer, fixture, { card, faceDigest: contractBinding(fixture, { doc: resigned(card) }) })
		expectNothing(await serve(body), 'card_verify_failed')
	})

	it.each([
		['a later contract', { contract: 2 }],
		['a malformed doc', { doc: 'not-a-digest' }],
	])('%s in the signed binding: card_unsupported_contract', async (_label, over) => {
		expectNothing(
			await serve(contractBody(issuer, fixture, { faceDigest: contractBinding(fixture, over) })),
			'card_unsupported_contract',
		)
	})

	it('CertREV’s replica pins another design version: card_pin_mismatch; pinned to the signed version: the card', async () => {
		const pinned = (design: string) =>
			block({
				builderContext: {
					content: { id: ENTRY_ID },
					context: { certrevDesignPin: { design, designBrand: 'staging-builder-canary' } },
				},
			})
		expectNothing(await serve(contractBody(issuer, fixture), pinned('6')), 'card_pin_mismatch')
		warn.mockClear()
		const html = await serve(contractBody(issuer, fixture), pinned(String(fixture.card.defVersion)))
		expect(cardWrapper(html)?.inner).toBe(expectedCardHtml(fixture.card, ['top', 'bottom']))
	})

	it('a binding rewritten in transit fails the signature: nothing, as in 1.3.1 (no card report)', async () => {
		const body = contractBody(issuer, fixture) as { payload: { content: { faceDigest: { doc: string } } } }
		body.payload.content.faceDigest.doc = 'f'.repeat(64)
		const html = await serve(body)
		expect(html).not.toContain('<certrev-card')
		expect(parseFallback(recordOf(html) ?? '')).toMatchObject({ face: 'none' })
		expect(parseFallback(recordOf(html) ?? '')?.reason).toBeUndefined()
	})
})

describe('a placement whose signed binding has no `contract` key prints what 1.3.1 prints', () => {
	it.each(CONTRACT_CASES)('%s: a card sibling beside a pre-contract envelope changes no byte', async (name) => {
		const fixture = contractFixture(name)
		const legacy = { v: 1, defVersion: fixture.card.defVersion, html: 'a'.repeat(64), css: 'b'.repeat(64) }
		const withCard = await serve(contractBody(issuer, fixture, { faceDigest: legacy }))
		const withoutCard = await serve(contractBody(issuer, fixture, { faceDigest: legacy, card: undefined }))
		expect(withCard).toBe(withoutCard)
		expect(withCard).not.toContain('<certrev-card')
		expect(withCard).toContain('data-certrev-cert-chrome')
		expect(warn).not.toHaveBeenCalled()
	})
})

describe('the two 1.2.0 fallbacks, now reported', () => {
	it('CertREV not reached: the options face (unchanged) and one delivery_unreachable line', async () => {
		delivery.respond(() => json({ error: 'unavailable' }, 503))
		const html = await renderToHtml(block())
		expect(html).toContain('data-certrev-cert-chrome')
		expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
			`[certrev] card_fallback ${JSON.stringify({ reason: 'delivery_unreachable', platform: 'builder', externalId: ENTRY_ID })}`,
		])
	})

	it('an envelope signed by a kid neither baked nor published: nothing (unchanged) and one unknown_key line', async () => {
		const other = makeIssuer('rotated-kid-2')
		const html = await serve(contractBody(other, contractFixture('banner-elf-like')))
		expect(html).not.toContain('<certrev-card')
		expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
			`[certrev] card_fallback ${JSON.stringify({ reason: 'unknown_key', platform: 'builder', externalId: ENTRY_ID })}`,
		])
		// The kid is not baked, so the card asked the delivery origin for its published key set, once.
		expect(delivery.calls).toEqual([
			`${MARKER.baseUrl}/api/cert/v1/delivery/builder/${ENTRY_ID}`,
			`${MARKER.baseUrl}/api/cert/v1/keys`,
		])
	})
})

it('attr helper sanity', () => {
	expect(unattr(attr('<a href="x">&\'</a>'))).toBe('<a href="x">&\'</a>')
})
