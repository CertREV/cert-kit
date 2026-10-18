/**
 * The envelope seed (1.2.0) on its own: what the server writes, what the browser accepts, and that a server keeps
 * nothing per page. This file runs with no `document`, as a server render does.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { READER_CSS } from '../../reader/reader-css.generated.js'
import { CARD_READER_CSS } from '../card-reader-css.js'
import { CertReviewCard } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import {
	forgetPageSeedsForTests,
	pageRecordFor,
	pageSeedFor,
	parseFallback,
	parseSeed,
	seedFor,
	serializeFallback,
	serializeSeed,
	withoutHiddenContent,
	withoutPhotos,
} from '../ssr-seed.js'
import {
	BASE,
	builderPayload,
	deliveryBody,
	ELF_LIKE_DEF,
	ENTRY_ID,
	json,
	MARKER,
	makeIssuer,
	renderToHtml,
	scriptedDelivery,
	T0,
} from './delivery-harness.js'

afterEach(() => forgetPageSeedsForTests())

describe('serializeSeed / parseSeed', () => {
	const seed = {
		baseUrl: BASE,
		externalId: ENTRY_ID,
		payload: builderPayload(),
		signature: { alg: 'ed25519', kid: 'k', sig: 's', signedAt: '2026-09-26T00:00:00.000Z' },
		renderDef: {
			v: 4,
			preset: 'memo',
			rung: 'standard',
			tokens: { accentColor: '#000000' },
			hidden: ['reviewerPhoto'],
		},
	} as const

	it('round-trips', () => {
		expect(parseSeed(serializeSeed(seed))).toEqual(seed)
	})

	it('omits an absent signature and keeps a null def', () => {
		const raw = serializeSeed({ ...seed, signature: undefined, renderDef: null })
		expect(JSON.parse(raw)).not.toHaveProperty('signature')
		expect(parseSeed(raw)).toEqual({ baseUrl: BASE, externalId: ENTRY_ID, payload: seed.payload, renderDef: null })
	})

	it.each([
		['not JSON', '{'],
		['not an object', '[]'],
		['another version', JSON.stringify({ ...JSON.parse(serializeSeed(seed)), v: 2 })],
		['no baseUrl', JSON.stringify({ ...JSON.parse(serializeSeed(seed)), baseUrl: 1 })],
		['no externalId', JSON.stringify({ ...JSON.parse(serializeSeed(seed)), externalId: null })],
		['no payload', JSON.stringify({ ...JSON.parse(serializeSeed(seed)), payload: 'x' })],
		[
			'a payload with no content',
			JSON.stringify({ ...JSON.parse(serializeSeed(seed)), payload: { subject: {}, lifecycle: {} } }),
		],
	])('refuses %s (never throws)', (_name, raw) => {
		expect(parseSeed(raw)).toBeNull()
	})

	it('a malformed def becomes the preset default, as the Delivery path treats it', () => {
		const raw = JSON.stringify({ ...JSON.parse(serializeSeed(seed)), renderDef: { v: 'x' } })
		expect(parseSeed(raw)?.renderDef).toBeNull()
	})
})

describe('the design pin in the seed', () => {
	const base = { baseUrl: BASE, externalId: ENTRY_ID, payload: builderPayload(), renderDef: null } as const

	it('round-trips a pin with a brand and a pin without one, and writes none for an unpinned read', () => {
		const withBrand = { ...base, design: { version: 2, brand: 'staging-shopify-canary' } }
		expect(parseSeed(serializeSeed(withBrand))).toEqual(withBrand)
		const noBrand = { ...base, design: { version: 3 } }
		expect(parseSeed(serializeSeed(noBrand))).toEqual(noBrand)
		expect(JSON.parse(serializeSeed(base))).not.toHaveProperty('design')
		expect(parseSeed(serializeSeed(base))).not.toHaveProperty('design')
	})

	it.each([
		['a non-object pin', 'x'],
		['a pin with no version', {}],
		['a version that is not a number', { version: 'abc' }],
		['a brand that is not a brand key', { version: 2, brand: 'Not A Brand!' }],
	])('refuses %s: a seed whose pin fails the pin grammar is no seed', (_name, design) => {
		const raw = JSON.stringify({ ...JSON.parse(serializeSeed(base)), design })
		expect(parseSeed(raw)).toBeNull()
	})
})

describe('serializeFallback / parseFallback: the record a server writes where it had no envelope (1.2.0)', () => {
	const options = { baseUrl: BASE, externalId: ENTRY_ID, face: 'options' } as const

	it('round-trips an options record and a none record, pinned and unpinned', () => {
		expect(parseFallback(serializeFallback(options))).toEqual(options)
		const none = { ...options, face: 'none' } as const
		expect(parseFallback(serializeFallback(none))).toEqual(none)
		const pinned = { ...none, design: { version: 2, brand: 'staging-shopify-canary' } }
		expect(parseFallback(serializeFallback(pinned))).toEqual(pinned)
		expect(JSON.parse(serializeFallback(options))).toEqual({
			v: 1,
			baseUrl: BASE,
			externalId: ENTRY_ID,
			face: 'options',
		})
	})

	it('carries no payload, signature or def: nothing of a certificate', () => {
		const written = JSON.parse(serializeFallback(options))
		expect(Object.keys(written).sort()).toEqual(['baseUrl', 'externalId', 'face', 'v'])
	})

	it.each([
		['not JSON', '{'],
		['not an object', '[]'],
		['another version', JSON.stringify({ v: 2, baseUrl: BASE, externalId: ENTRY_ID, face: 'options' })],
		['no baseUrl', JSON.stringify({ v: 1, externalId: ENTRY_ID, face: 'options' })],
		['no externalId', JSON.stringify({ v: 1, baseUrl: BASE, face: 'none' })],
		['another face', JSON.stringify({ v: 1, baseUrl: BASE, externalId: ENTRY_ID, face: 'envelope' })],
		['no face', JSON.stringify({ v: 1, baseUrl: BASE, externalId: ENTRY_ID })],
		[
			'a pin that fails the pin grammar',
			JSON.stringify({ v: 1, baseUrl: BASE, externalId: ENTRY_ID, face: 'none', design: { version: 'x' } }),
		],
	])('refuses %s (never throws)', (_name, raw) => {
		expect(parseFallback(raw)).toBeNull()
	})

	it('a seed is not a fallback record, and a fallback record is not a seed', () => {
		const seedRaw = serializeSeed({ baseUrl: BASE, externalId: ENTRY_ID, payload: builderPayload(), renderDef: null })
		expect(parseFallback(seedRaw)).toBeNull()
		// Even with a face beside its payload: a record that carries a certificate is a seed or nothing.
		expect(parseFallback(JSON.stringify({ ...JSON.parse(seedRaw), face: 'options' }))).toBeNull()
		expect(parseSeed(serializeFallback(options))).toBeNull()
	})

	it('a server finds no record of either kind on its own page', () => {
		expect(typeof document).toBe('undefined')
		expect(pageRecordFor(BASE, ENTRY_ID)).toBeUndefined()
	})
})

describe('withoutPhotos: a photo the browser could not load (1.2.0)', () => {
	const payload = builderPayload()
	const content = payload.content as unknown as Record<string, Record<string, unknown>>

	it("nulls the named person's photo URL and nothing else", () => {
		expect(content.expert?.photoUrl).toBeTruthy()
		const out = withoutPhotos(payload, ['expert'])
		const outContent = out.content as unknown as Record<string, Record<string, unknown>>
		expect(outContent.expert?.photoUrl).toBeNull()
		expect({ ...outContent.expert, photoUrl: content.expert?.photoUrl }).toEqual(content.expert)
		expect(outContent.author).toEqual(content.author)
		expect(out.subject).toBe(payload.subject)
		expect(out.lifecycle).toBe(payload.lifecycle)
	})

	it('nulls both when both are named', () => {
		const withAuthorPhoto = {
			...payload,
			content: { ...payload.content, author: { ...content.author, photoUrl: 'https://cdn.example/author.jpg' } },
		} as typeof payload
		const out = withoutPhotos(withAuthorPhoto, ['expert', 'author'])
		const outContent = out.content as unknown as Record<string, Record<string, unknown>>
		expect(outContent.expert?.photoUrl).toBeNull()
		expect(outContent.author?.photoUrl).toBeNull()
	})

	it('returns the payload itself when the named person has no photo to remove', () => {
		const noPhoto = withoutPhotos(payload, ['expert'])
		expect(withoutPhotos(noPhoto, ['expert'])).toBe(noPhoto)
		expect(withoutPhotos(payload, [])).toBe(payload)
	})

	it('never throws on a payload whose expert or author is not an object', () => {
		const hostile = {
			...payload,
			content: { ...payload.content, expert: 'x', author: null },
		} as unknown as typeof payload
		expect(withoutPhotos(hostile, ['expert', 'author'])).toBe(hostile)
	})
})

describe('withoutHiddenContent / seedFor: hidden is absent from the seed', () => {
	const payload = builderPayload()
	const withPhotoAndMemo = (overrides: object = {}) =>
		({
			...payload,
			content: {
				...payload.content,
				author: { ...(payload.content.author as object), photoUrl: 'https://cdn.certrev.com/authors/sam.jpg' },
				memo: 'A memo.',
				...overrides,
			},
		}) as typeof payload
	const def = (hidden: string[]) => ({ ...ELF_LIKE_DEF, hidden }) as never

	it('reviewerPhoto removes the expert and the author photo, and nothing else', () => {
		const src = withPhotoAndMemo()
		const { payload: out, stripped } = withoutHiddenContent(src, def(['reviewerPhoto']))
		expect(stripped).toBe(true)
		expect((out.content.expert as { photoUrl?: unknown }).photoUrl).toBeNull()
		expect((out.content.author as { photoUrl?: unknown }).photoUrl).toBeNull()
		expect(out.content.memo).toBe('A memo.')
		expect({ ...out.content.expert, photoUrl: src.content.expert.photoUrl }).toEqual(src.content.expert)
		expect(out.subject).toEqual(src.subject)
		expect(out.lifecycle).toEqual(src.lifecycle)
		// the input is never mutated
		expect(src.content.expert.photoUrl).toBe('https://cdn.certrev.com/experts/jane-doe.jpg')
	})

	it('display.showExpertPhoto: false removes both photos whatever the def hides, and nothing else', () => {
		const src = withPhotoAndMemo({ display: { showExpertPhoto: false, showBio: true } })
		for (const d of [null, def([]), def(['memo']), def(['reviewerPhoto'])]) {
			const { payload: out, stripped } = withoutHiddenContent(src, d)
			expect(stripped).toBe(true)
			expect((out.content.expert as { photoUrl?: unknown }).photoUrl).toBeNull()
			expect((out.content.author as { photoUrl?: unknown }).photoUrl).toBeNull()
			expect(out.content.display).toEqual(src.content.display)
			// the memo goes only where the def hides it
			expect(out.content.memo).toBe(d?.hidden?.includes('memo') ? null : 'A memo.')
			expect(out.content.expert.compensationCue).toBe('Compensated expert')
		}
		// the input is never mutated
		expect(src.content.expert.photoUrl).toBe('https://cdn.certrev.com/experts/jane-doe.jpg')
	})

	it('display.showExpertPhoto is read as the reader face reads it: only a literal false strips', () => {
		for (const display of [{ showExpertPhoto: true }, { showExpertPhoto: null }, {}, undefined, null, 'off', 0]) {
			const src = withPhotoAndMemo({ display })
			const out = withoutHiddenContent(src, null)
			expect(out.stripped).toBe(false)
			expect(out.payload).toBe(src)
		}
	})

	it('display.showExpertPhoto: false with no photo to remove strips nothing (the signature still holds)', () => {
		const src = withPhotoAndMemo({
			display: { showExpertPhoto: false },
			expert: { ...payload.content.expert, photoUrl: null },
			author: { name: 'Sam' },
		})
		const out = withoutHiddenContent(src, null)
		expect(out.stripped).toBe(false)
		expect(out.payload).toBe(src)
	})

	it('memo removes the memo text, and nothing else', () => {
		const src = withPhotoAndMemo()
		const { payload: out, stripped } = withoutHiddenContent(src, def(['memo']))
		expect(stripped).toBe(true)
		expect(out.content.memo).toBeNull()
		expect(out.content.expert).toEqual(src.content.expert)
		expect(out.content.author).toEqual(src.content.author)
	})

	it('never touches the compensation cue, whatever the def hides', () => {
		const { payload: out } = withoutHiddenContent(withPhotoAndMemo(), def(['reviewerPhoto', 'memo', 'compensationCue']))
		expect(out.content.expert.compensationCue).toBe('Compensated expert')
	})

	it('strips nothing, and returns the payload itself, for an absent def, no hidden ids, or ids the faces ignore', () => {
		const src = withPhotoAndMemo()
		for (const d of [null, def([]), def(['bio', 'whatever'])]) {
			const out = withoutHiddenContent(src, d)
			expect(out.stripped).toBe(false)
			expect(out.payload).toBe(src)
		}
	})

	it('strips nothing when the def hides a field the payload has no value for (the signature still holds)', () => {
		const src = withPhotoAndMemo({
			memo: null,
			expert: { ...payload.content.expert, photoUrl: '' },
			author: { name: 'Sam' },
		})
		const out = withoutHiddenContent(src, def(['reviewerPhoto', 'memo']))
		expect(out.stripped).toBe(false)
		expect(out.payload).toBe(src)
	})

	it('never throws on a payload whose expert or author is not an object', () => {
		const src = withPhotoAndMemo({ expert: 'x', author: null })
		expect(() => withoutHiddenContent(src, def(['reviewerPhoto', 'memo']))).not.toThrow()
	})

	it('seedFor drops the signature exactly when something was stripped', () => {
		const signature = { alg: 'ed25519', kid: 'k', sig: 's', signedAt: '2026-09-26T00:00:00.000Z' } as never
		const read = { baseUrl: BASE, externalId: ENTRY_ID, payload: withPhotoAndMemo(), signature }
		const stripped = seedFor({ ...read, renderDef: def(['reviewerPhoto']) })
		expect(stripped).not.toHaveProperty('signature')
		expect(serializeSeed(stripped)).not.toContain('jane-doe.jpg')
		const photoOff = seedFor({
			...read,
			payload: withPhotoAndMemo({ display: { showExpertPhoto: false } }),
			renderDef: def([]),
		})
		expect(photoOff).not.toHaveProperty('signature')
		expect(serializeSeed(photoOff)).not.toContain('jane-doe.jpg')
		expect(serializeSeed(photoOff)).not.toContain('sam.jpg')
		const kept = seedFor({ ...read, renderDef: def([]) })
		expect(kept.signature).toBe(signature)
		expect(kept.payload).toBe(read.payload)
		expect(seedFor({ ...read, renderDef: null }).signature).toBe(signature)
	})

	it('seedFor carries the design pin and the def', () => {
		const out = seedFor({
			baseUrl: BASE,
			externalId: ENTRY_ID,
			design: { version: 2, brand: 'b' },
			payload,
			renderDef: def(['reviewerPhoto']),
		})
		expect(out.design).toEqual({ version: 2, brand: 'b' })
		expect(out.renderDef?.hidden).toEqual(['reviewerPhoto'])
		expect(seedFor({ baseUrl: BASE, externalId: ENTRY_ID, payload, renderDef: null })).not.toHaveProperty('design')
	})
})

describe('on a server', () => {
	let restore: () => void = () => {}
	afterEach(() => restore())

	it('finds no page seed and keeps none, yet writes one on the face it paints', async () => {
		expect(typeof document).toBe('undefined')
		const issuer = makeIssuer()
		const delivery = scriptedDelivery(() => json(deliveryBody(issuer.envelope())))
		restore = setCardDeliveryRuntimeForTests({
			resolveKid: issuer.resolveKid,
			fetchImpl: () => delivery.fetch,
			now: () => T0,
		})
		const html = await renderToHtml(<CertReviewCard delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} />)
		expect(html).toContain('data-certrev-envelope="')
		expect(delivery.calls).toHaveLength(1)
		expect(pageSeedFor(BASE, ENTRY_ID)).toBeUndefined()
	})
})

describe('the card reader CSS', () => {
	it('has no remote font face, so it asks a CSP font-src for nothing', () => {
		expect(READER_CSS).toContain('https://assets.certrev.com/fonts/')
		expect(CARD_READER_CSS).not.toMatch(/url\(/)
		expect(CARD_READER_CSS).not.toContain('https://assets.certrev.com')
	})

	it('keeps the four local fallback faces and every rule that is not a remote face', () => {
		for (const family of [
			'DM Sans Fallback',
			'Playfair Display Fallback',
			'JetBrains Mono Fallback',
			'Plus Jakarta Sans Fallback',
		]) {
			expect(CARD_READER_CSS).toContain(`font-family: "${family}"`)
		}
		const faces = (css: string) => css.match(/@font-face/g)?.length ?? 0
		const remote = READER_CSS.match(/@font-face\s*\{[^{}]*\burl\([^{}]*\}/g) ?? []
		expect(remote.length).toBeGreaterThan(0)
		expect(faces(CARD_READER_CSS)).toBe(faces(READER_CSS) - remote.length)
		expect(faces(CARD_READER_CSS)).toBe(4)
		// Removing whole rules only: what is left is READER_CSS with exactly those rules cut out.
		let rebuilt = READER_CSS
		for (const rule of remote) rebuilt = rebuilt.replace(rule, '')
		expect(CARD_READER_CSS.replace(/\s+/g, '')).toBe(rebuilt.replace(/\s+/g, ''))
	})

	it('is what the reader face on the card inlines', async () => {
		const issuer = makeIssuer()
		const delivery = scriptedDelivery(() =>
			json(deliveryBody(issuer.envelope(), { ...ELF_LIKE_DEF, face: 'reader', layout: 'banner' })),
		)
		const restore = setCardDeliveryRuntimeForTests({
			resolveKid: issuer.resolveKid,
			fetchImpl: () => delivery.fetch,
			now: () => T0,
		})
		try {
			const html = await renderToHtml(
				<CertReviewCard delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} />,
			)
			expect(html).toContain('data-certrev-face="reader"')
			expect(html).toContain('<style data-certrev-reader-css>')
			expect(html).not.toContain('https://assets.certrev.com')
			expect(html).not.toMatch(/url\(/)
		} finally {
			restore()
		}
	})

	it('an options-only card renders the same static markup as before (no seed, no change)', () => {
		const html = renderToStaticMarkup(<CertReviewCard />)
		expect(html).not.toContain('data-certrev-envelope')
	})
})
