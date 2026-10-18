/**
 * 1.2.0-canary.5: the design pin on the Builder card (CertREV's own canary replica only).
 *
 * The replica passes `context={{ certrevDesignPin: designPinFromUrl(request.url) }}` to Builder's `<Content>`, and the
 * card reads it from `builderContext.context`. Everything runs through the real delivery path, as
 * `delivery-card.test.tsx` does. What is pinned:
 *  - a pinned card reads the pinned Delivery URL and paints ONLY a reader def at exactly the pinned version;
 *  - every other answer (another version, no def, another face, a 404) paints nothing, never the live design;
 *  - a 503 (CertREV not reached) paints the block's own options face, as an unpinned card does since 1.2.0, with a
 *    record that names the pin and says `options`, never the live design;
 *  - a pin that cannot be read paints nothing and never fetches, and so does a pin on a block without the marker;
 *  - no pin (no context, an empty context, a null pin) is the unpinned card, byte for byte.
 */

import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CertReviewCard, type CertReviewCardProps } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import {
	chromeRoot,
	DELIVERY_URL,
	deliveryBody,
	ELF_LIKE_DEF,
	ENTRY_ID,
	type FixtureIssuer,
	json,
	MARKER,
	makeIssuer,
	renderToHtml,
	type ScriptedDelivery,
	scriptedDelivery,
	seedOf,
	T0,
	withoutSeed,
} from './delivery-harness.js'
import { RAW_DEFS } from './legacy-face-cases.js'
import { OPTIONS_ONLY_SHAPES } from './options-only-shapes.js'

const GOLDEN = JSON.parse(readFileSync(new URL('./__golden__/options-only-1.0.3.json', import.meta.url), 'utf8')) as {
	golden: Record<string, string>
}

/** The reader def the harness serves: `face: 'reader'` at v 2. */
const READER_DEF = RAW_DEFS['face-reader'] as { v: number }
const BRAND = 'staging-shopify-canary'
const PINNED_URL = `${DELIVERY_URL}?design=2&designBrand=${BRAND}`

describe('the design pin on the delivery card', () => {
	let issuer: FixtureIssuer
	let delivery: ScriptedDelivery
	let restore: () => void

	const card = (pin?: unknown, overrides: Partial<CertReviewCardProps> = {}) => (
		<CertReviewCard
			{...(OPTIONS_ONLY_SHAPES.todaysExport as CertReviewCardProps)}
			mode={undefined}
			delivery={MARKER}
			builderContext={{ content: { id: ENTRY_ID }, context: { certrevDesignPin: pin } }}
			{...overrides}
		/>
	)
	const serve = (def: unknown) => {
		delivery.respond(() => json(deliveryBody(issuer.envelope(), def)))
		setCardDeliveryRuntimeForTests({ resolveKid: issuer.resolveKid, fetchImpl: () => delivery.fetch, now: () => T0 })
	}
	const expectNothing = async (element: ReturnType<typeof card>) => {
		const html = await renderToHtml(element)
		expect(chromeRoot(html)).toBeNull()
		expect(html).not.toContain('Dr. Jane Doe')
		return html
	}

	beforeEach(() => {
		issuer = makeIssuer()
		delivery = scriptedDelivery(() => json(deliveryBody(issuer.envelope(), READER_DEF)))
		restore = setCardDeliveryRuntimeForTests({
			resolveKid: issuer.resolveKid,
			fetchImpl: () => delivery.fetch,
			now: () => T0,
			timeoutMs: 200,
		})
	})
	afterEach(() => restore())

	it('a pinned card reads the pinned URL and paints the reader def at that version', async () => {
		const html = await renderToHtml(card({ design: '2', designBrand: BRAND }))
		expect(delivery.calls).toEqual([PINNED_URL])
		const root = chromeRoot(html)
		expect(root).not.toBeNull()
		expect(root).toContain('data-certrev-def-version="2"')
		expect(root).toContain('data-certrev-face="reader"')
		expect(html).toContain('Dr. Jane Doe')
	})

	it('a pin with no brand, or a numeric version, reads ?design alone', async () => {
		expect(chromeRoot(await renderToHtml(card({ design: '2' })))).not.toBeNull()
		serve(READER_DEF)
		expect(chromeRoot(await renderToHtml(card({ design: 2 })))).not.toBeNull()
		expect(delivery.calls).toEqual([`${DELIVERY_URL}?design=2`, `${DELIVERY_URL}?design=2`])
	})

	it('paints exactly what the unpinned card paints for the same reader def', async () => {
		const pinned = await renderToHtml(card({ design: '2', designBrand: BRAND }))
		serve(READER_DEF)
		const unpinned = await renderToHtml(card(undefined))
		// The one difference since 1.2.0 is the seed: it records the pin the read was made with.
		expect(withoutSeed(pinned)).toBe(withoutSeed(unpinned))
		expect(seedOf(pinned)?.design).toEqual({ version: 2, brand: BRAND })
		expect(seedOf(unpinned)).not.toHaveProperty('design')
	})

	describe('fails closed: renders nothing', () => {
		it('a def at another version', async () => {
			await expectNothing(card({ design: '3', designBrand: BRAND }))
			expect(delivery.calls).toEqual([`${DELIVERY_URL}?design=3&designBrand=${BRAND}`])
		})

		it('no def beside the envelope', async () => {
			delivery.respond(() => json(issuer.envelope()))
			await expectNothing(card({ design: '2' }))
		})

		it('a malformed def (parses to null)', async () => {
			serve({ ...READER_DEF, v: '2' })
			await expectNothing(card({ design: '2' }))
		})

		it.each([
			['a legacy def at the pinned version', ELF_LIKE_DEF, '4'],
			['an unknown face', RAW_DEFS['face-unknown'], '2'],
			['a capitalised reader face', RAW_DEFS['face-capitalised'], '4'],
		])('%s', async (_label, def, version) => {
			serve(def)
			await expectNothing(card({ design: version }))
			expect(delivery.calls).toEqual([`${DELIVERY_URL}?design=${version}`])
		})

		it('404 no_design', async () => {
			delivery.respond(() => json({ code: 'no_design' }, 404))
			expect(seedOf(await expectNothing(card({ design: '2', designBrand: BRAND })))?.face).toBe('none')
			expect(delivery.calls).toEqual([PINNED_URL])
		})

		it('a revoked cert, pinned', async () => {
			delivery.respond(async () => json(await issuer.tombstone()))
			await expectNothing(card({ design: '2' }))
		})

		it.each([
			['a brand without a version', { designBrand: BRAND }],
			['an empty version (?designBrand= alone)', { design: '', designBrand: BRAND }],
			['version 0', { design: '0' }],
			['a word', { design: 'latest' }],
			['an empty brand', { design: '2', designBrand: '' }],
			['an upper-case brand', { design: '2', designBrand: 'Staging' }],
			['a bare string', '2'],
			['an array', [{ design: '2' }]],
		])('a pin that cannot be read (%s): never fetches', async (_label, pin) => {
			await expectNothing(card(pin))
			expect(delivery.calls).toEqual([])
		})

		it('a pin on a block without the delivery marker: not the options face, no fetch', async () => {
			const props = OPTIONS_ONLY_SHAPES.todaysExport as CertReviewCardProps
			const pinned = (pin: unknown) => (
				<CertReviewCard {...props} builderContext={{ content: { id: ENTRY_ID }, context: { certrevDesignPin: pin } }} />
			)
			expect(renderToStaticMarkup(pinned({ design: '2' }))).toBe('')
			expect(renderToStaticMarkup(pinned({ designBrand: BRAND }))).toBe('')
			expect(renderToStaticMarkup(<CertReviewCard {...props} />)).toBe(GOLDEN.golden.todaysExport)
			expect(delivery.calls).toEqual([])
		})

		it('a pin beside a marker that is not accepted: no fetch', async () => {
			await expectNothing(card({ design: '2' }, { delivery: { v: 1, baseUrl: 'https://evil.example.com' } as never }))
			expect(delivery.calls).toEqual([])
		})
	})

	it('a 503 (CertREV not reached) paints the options face, as the unpinned card does, with a record naming the pin', async () => {
		delivery.respond(() => json({ error: 'unavailable' }, 503))
		const pinned = await renderToHtml(card({ design: '2', designBrand: BRAND }))
		expect(chromeRoot(pinned)).not.toBeNull()
		expect(pinned).toContain('Dr. Jane Doe')
		expect(pinned).not.toContain('data-certrev-face="reader"')
		expect(seedOf(pinned)).toMatchObject({ face: 'options', design: { version: 2, brand: BRAND } })
		serve(READER_DEF)
		delivery.respond(() => json({ error: 'unavailable' }, 503))
		const unpinned = await renderToHtml(card(undefined))
		expect(withoutSeed(pinned)).toBe(withoutSeed(unpinned))
		expect(delivery.calls).toEqual([PINNED_URL, DELIVERY_URL])
	})

	describe('no pin: the unpinned card, byte for byte', () => {
		it.each([
			['no context', { content: { id: ENTRY_ID } }],
			['a null context', { content: { id: ENTRY_ID }, context: null }],
			['an empty context', { content: { id: ENTRY_ID }, context: {} }],
			['an undefined pin', { content: { id: ENTRY_ID }, context: { certrevDesignPin: undefined } }],
			['a null pin', { content: { id: ENTRY_ID }, context: { certrevDesignPin: null } }],
		])('%s', async (_label, builderContext) => {
			const reference = await renderToHtml(card(undefined, { builderContext: { content: { id: ENTRY_ID } } }))
			expect(chromeRoot(reference)).not.toBeNull()
			serve(READER_DEF)
			expect(await renderToHtml(card(undefined, { builderContext }))).toBe(reference)
			expect(delivery.calls).toEqual([DELIVERY_URL, DELIVERY_URL])
		})

		it('a live def at any version still paints unpinned (only a pin judges the version)', async () => {
			serve({ ...READER_DEF, v: 9 })
			expect(await renderToHtml(card(undefined))).toContain('data-certrev-def-version="9"')
		})

		it('an options-only block with an empty context paints the 1.0.3 face', () => {
			const props = { ...OPTIONS_ONLY_SHAPES.todaysExport, builderContext: { content: { id: ENTRY_ID }, context: {} } }
			expect(renderToStaticMarkup(<CertReviewCard {...(props as CertReviewCardProps)} />)).toBe(
				GOLDEN.golden.todaysExport,
			)
		})
	})

	it('a pinned and an unpinned card on one page are two reads, never one', async () => {
		const html = await renderToHtml(
			<>
				{card({ design: '2', designBrand: BRAND })}
				{card(undefined)}
			</>,
		)
		expect(html.split('<div data-certrev-cert-chrome').length - 1).toBe(2)
		expect([...delivery.calls].sort()).toEqual([DELIVERY_URL, PINNED_URL])
	})

	it('each card paints the def its own URL answered with', async () => {
		// The live design is the legacy def at v 4; the pinned design is the reader def at v 2.
		const byUrl = (async (input: RequestInfo | URL) => {
			delivery.calls.push(String(input))
			return json(deliveryBody(issuer.envelope(), String(input).includes('?design=') ? READER_DEF : ELF_LIKE_DEF))
		}) as typeof fetch
		setCardDeliveryRuntimeForTests({ resolveKid: issuer.resolveKid, fetchImpl: () => byUrl, now: () => T0 })
		const pinned = chromeRoot(await renderToHtml(card({ design: '2', designBrand: BRAND })))
		const live = chromeRoot(await renderToHtml(card(undefined)))
		expect(withoutSeed(pinned ?? '')).toContain('data-certrev-def-version="2" data-certrev-face="reader"')
		expect(withoutSeed(live ?? '')).toContain('data-certrev-def-version="4">')
		expect(live).not.toContain('data-certrev-face')
		expect([...delivery.calls].sort()).toEqual([DELIVERY_URL, PINNED_URL])
	})

	it('a pinned read is cached apart from the unpinned one: a mismatch on one does not reach the other', async () => {
		// The live def is v 2; the pin asks for v 3 and gets v 2 back: the pinned card paints nothing, the live one paints.
		const html = await renderToHtml(
			<>
				{card({ design: '3' })}
				{card(undefined)}
			</>,
		)
		expect(html.split('<div data-certrev-cert-chrome').length - 1).toBe(1)
		expect([...delivery.calls].sort()).toEqual([DELIVERY_URL, `${DELIVERY_URL}?design=3`])
	})
})
