/**
 * 2.0.0, the contract-1 card module (`card-contract.ts`): the signed binding, the document's shape check, its digest
 * (recomputed with WebCrypto and held equal to the portal's own on every fixture document), the parts a block prints
 * and the exact bytes it prints them as.
 */

import { canonicalizeJson } from '@certrev/cert-contract'
import { describe, expect, it } from 'vitest'
import {
	acceptedCardBinding,
	type CardDocumentV1,
	cardBinds,
	cardDigestFor,
	cardDocumentDigest,
	cardHtml,
	cardMatchesPlacement,
	cardPartsFor,
	cardRuntimeTag,
	parseCardDocument,
} from '../card-contract.js'
import {
	CONTRACT_CASES,
	contractBinding,
	contractFixture,
	contractPayload,
	expectedCardHtml,
	HEX_A,
} from './contract-v1-shapes.js'
import { sha256Hex } from './delivered-face-shapes.js'
import { ENTRY_ID } from './delivery-harness.js'

const banner = contractFixture('banner-elf-like')
const contentWith = (faceDigest: unknown) => ({ ...banner.content, faceDigest }) as never

describe('acceptedCardBinding: the signed binding decides the path', () => {
	it('no digest, or a digest with no `contract` key (every brand before contract 1): null, the 1.3.1 path', () => {
		expect(acceptedCardBinding(banner.content)).toBeNull()
		expect(acceptedCardBinding(null)).toBeNull()
		expect(acceptedCardBinding(contentWith({ v: 1, defVersion: 7, html: HEX_A, css: HEX_A }))).toBeNull()
		expect(acceptedCardBinding(contentWith('nope'))).toBeNull()
	})

	it('the portal’s Builder binding, and one without html/css: the binding', () => {
		expect(acceptedCardBinding(contentWith(contractBinding(banner)))).toEqual({
			contract: 1,
			defVersion: banner.card.defVersion,
			doc: banner.doc,
		})
		const { html: _h, css: _c, ...noFace } = contractBinding(banner)
		expect(acceptedCardBinding(contentWith(noFace))).toEqual({ contract: 1, defVersion: 7, doc: banner.doc })
	})

	it.each([
		['a later contract', { contract: 2 }],
		['contract as a string', { contract: '1' }],
		['contract null', { contract: null }],
		['another digest version', { v: 2 }],
		['a missing doc', { doc: undefined }],
		['an uppercase doc', { doc: banner.doc.toUpperCase() }],
		['a short doc', { doc: banner.doc.slice(2) }],
		['a negative design version', { defVersion: -1 }],
		['a fractional design version', { defVersion: 1.5 }],
		['a design version as a string', { defVersion: '7' }],
	])('%s: unsupported (fails closed, never the 1.3.1 face)', (_label, over) => {
		expect(acceptedCardBinding(contentWith(contractBinding(banner, over)))).toBe('unsupported')
	})
})

describe('parseCardDocument', () => {
	it.each(CONTRACT_CASES)('%s: the portal’s document parses to the same object', (name) => {
		const fixture = contractFixture(name)
		expect(parseCardDocument(fixture.card)).toBe(fixture.card)
	})

	const mutate = (fn: (doc: Record<string, unknown>) => void) => {
		const doc = structuredClone(banner.card) as unknown as Record<string, unknown>
		fn(doc)
		return doc
	}

	it.each([
		['not an object', () => 'card' as unknown],
		['contract 2', () => mutate((d) => (d.contract = 2))],
		['another kind', () => mutate((d) => (d.kind = 'certrev.badge'))],
		['no certId', () => mutate((d) => delete d.certId)],
		['a subject without externalId', () => mutate((d) => (d.subject = { platform: 'builder' }))],
		['a negative defVersion', () => mutate((d) => (d.defVersion = -1))],
		['an unknown layout', () => mutate((d) => (d.layout = 'popup'))],
		['a part that is not a string', () => mutate((d) => ((d.parts as Record<string, unknown>).top = 42))],
		['no dialogs', () => mutate((d) => delete d.dialogs)],
		['a dialog that is not a string', () => mutate((d) => ((d.dialogs as Record<string, unknown>).expert = {}))],
		['no head', () => mutate((d) => (d.assets = {}))],
		[
			'a runtime on http',
			() => mutate((d) => (d.assets = { head: '', runtime: { src: 'http://x.test/r.js', integrity: 'sha384-abc' } })),
		],
		[
			'a runtime with no SRI',
			() => mutate((d) => (d.assets = { head: '', runtime: { src: 'https://x.test/r.js', integrity: 'md5-abc' } })),
		],
	])('%s: not a document', (_label, make) => {
		expect(parseCardDocument(make())).toBeNull()
	})

	it('a runtime the portal serves (https, SRI) is accepted, and its tag escapes both attributes', () => {
		const doc = mutate((d) => {
			d.assets = {
				head: '<style data-certrev-card-head></style>',
				runtime: {
					src: 'https://portal.certrev.com/api/cert/v1/runtime/card-runtime.0123456789abcdef.js?a=1&b="2"',
					integrity: 'sha384-AbC+/1=',
				},
			}
		})
		const parsed = parseCardDocument(doc)
		expect(parsed).toBe(doc)
		expect(cardRuntimeTag(parsed as CardDocumentV1)).toBe(
			'<script src="https://portal.certrev.com/api/cert/v1/runtime/card-runtime.0123456789abcdef.js?a=1&amp;b=&quot;2&quot;" integrity="sha384-AbC+/1=" crossorigin="anonymous" defer></script>',
		)
	})
})

describe('the document digest (RFC 8785 bytes, sha256), held to the portal’s own', () => {
	it.each(CONTRACT_CASES)('%s: WebCrypto over canonicalizeJson equals the portal’s digest', async (name) => {
		const fixture = contractFixture(name)
		expect(await cardDocumentDigest(fixture.card)).toBe(fixture.doc)
		expect(sha256Hex(canonicalizeJson(fixture.card))).toBe(fixture.doc)
		expect(await cardDigestFor(fixture.card).pending).toBe(fixture.doc)
	})

	it('a key order the server did not write hashes the same (RFC 8785 sorts keys); a changed byte does not', async () => {
		const reordered = Object.fromEntries(Object.entries(banner.card).reverse())
		expect(await cardDocumentDigest(reordered)).toBe(banner.doc)
		const tampered = structuredClone(banner.card) as unknown as { parts: { top: string } }
		tampered.parts.top = tampered.parts.top.replace('Reviewed by', 'Reviewed by!')
		expect(await cardDocumentDigest(tampered)).not.toBe(banner.doc)
	})

	it('a document RFC 8785 cannot canonicalize settles to null at once', async () => {
		const memo = cardDigestFor({ n: Number.NaN })
		expect(memo.settled).toEqual({ digest: null })
		expect(await cardDocumentDigest({ n: Number.NaN })).toBeNull()
	})
})

describe('cardBinds: the document is the one the verified envelope signs, for this placement', () => {
	const binding = { contract: 1 as const, defVersion: banner.card.defVersion, doc: banner.doc }
	const payload = contractPayload(banner)

	it('binds for the fixture and its own placement', async () => {
		expect(await cardBinds(banner.card, binding, payload, ENTRY_ID)).toBe(true)
	})

	it.each([
		['another design version', { ...binding, defVersion: 6 }, payload, ENTRY_ID],
		['another digest', { ...binding, doc: HEX_A }, payload, ENTRY_ID],
		['another certificate', binding, { ...payload, certId: 'cert-other' }, ENTRY_ID],
		['another Builder entry', binding, payload, 'entry-other'],
	])('%s: does not bind', async (_label, b, p, entry) => {
		expect(await cardBinds(banner.card, b, p, entry)).toBe(false)
	})

	it('a document painted for another platform does not bind on Builder', () => {
		const wordpress = { ...banner.card, subject: { platform: 'wordpress', externalId: ENTRY_ID } }
		expect(cardMatchesPlacement(wordpress, binding, payload, ENTRY_ID)).toBe(false)
	})
})

describe('cardPartsFor: the saved design decides the layout; `part` splits a banner only', () => {
	const sidebar = contractFixture('sidebar-elf-like').card
	const floating = contractFixture('floating-elf-like').card

	it.each([
		[undefined, ['top', 'bottom']],
		['full', ['top', 'bottom']],
		[null, ['top', 'bottom']],
		['bogus', ['top', 'bottom']],
		['header', ['top']],
		['memo', ['bottom']],
	])('banner, part %s: %s', (part, names) => {
		expect(cardPartsFor(banner.card, part)).toEqual(names)
	})

	it('sidebar and floating print their one part on any block but a memo block, which prints nothing', () => {
		for (const part of [undefined, 'full', 'header']) {
			expect(cardPartsFor(sidebar, part)).toEqual(['rail'])
			expect(cardPartsFor(floating, part)).toEqual(['pill'])
		}
		expect(cardPartsFor(sidebar, 'memo')).toEqual([])
		expect(cardPartsFor(floating, 'memo')).toEqual([])
	})

	it('a banner with no memo part prints the card only, and a memo block prints nothing', () => {
		const noMemo = { ...banner.card, parts: { top: banner.card.parts.top } }
		expect(cardPartsFor(noMemo, undefined)).toEqual(['top'])
		expect(cardPartsFor(noMemo, 'memo')).toEqual([])
	})
})

describe('cardHtml: exactly the document’s bytes, head and both dialogs on every block', () => {
	it.each(CONTRACT_CASES)('%s', (name) => {
		const { card } = contractFixture(name)
		const names = cardPartsFor(card, undefined)
		expect(cardHtml(card, names)).toBe(expectedCardHtml(card, names))
		// Nothing is added: every byte is the document's (no runtime yet).
		expect(cardHtml(card, names).length).toBe(
			card.assets.head.length +
				names.reduce((n, part) => n + (card.parts[part]?.length ?? 0), 0) +
				(card.dialogs.expert?.length ?? 0) +
				(card.dialogs.certificate?.length ?? 0),
		)
	})

	it('a split banner prints its part with the head and both dialogs on each block', () => {
		expect(cardHtml(banner.card, ['bottom'])).toBe(
			banner.card.assets.head + banner.card.parts.bottom + banner.card.dialogs.expert + banner.card.dialogs.certificate,
		)
	})
})
