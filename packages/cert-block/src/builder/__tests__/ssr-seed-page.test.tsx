// @vitest-environment jsdom
/**
 * The seed on a page (1.2.0, with canary.5's design pin): what a browser finds in the document it was served, keyed
 * by origin, entry and design pin, so that a pinned card (CertREV's canary replica) takes only a seed written for the
 * same pin and an unpinned card (every production brand) takes only an unpinned one. A card that finds no seed for its
 * own placement makes no read (1.2.0): it paints the block's options face, pinned or not, or nothing (a block with no
 * options); only a block that opts in with `clientRead` reads, once.
 */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CertReviewCard } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import {
	type FallbackFace,
	forgetPageSeedsForTests,
	pageHoldsServerHtml,
	pageRecordFor,
	pageSeedFor,
	SEED_ATTRIBUTE,
	serializeFallback,
	serializeSeed,
} from '../ssr-seed.js'
import {
	BASE,
	builderPayload,
	DELIVERY_URL,
	deliveryBody,
	ENTRY_ID,
	json,
	MARKER,
	makeIssuer,
	renderToHtml,
	scriptedDelivery,
	seedOf,
	T0,
} from './delivery-harness.js'
import { RAW_DEFS } from './legacy-face-cases.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const READER_DEF = RAW_DEFS['face-reader'] as { v: number }
const BRAND = 'staging-shopify-canary'
const PIN = { version: READER_DEF.v, brand: BRAND }
const PINNED_URL = `${DELIVERY_URL}?design=${READER_DEF.v}&designBrand=${BRAND}`

const seedNode = (design?: { version: number; brand?: string }) => {
	const el = document.createElement('div')
	el.setAttribute(
		SEED_ATTRIBUTE,
		serializeSeed({
			baseUrl: BASE,
			externalId: ENTRY_ID,
			...(design ? { design } : {}),
			payload: builderPayload(),
			renderDef: null,
		}),
	)
	document.body.appendChild(el)
	return el
}

const fallbackNode = (face: FallbackFace, design?: { version: number; brand?: string }) => {
	const el = document.createElement('div')
	el.hidden = true
	el.setAttribute(
		SEED_ATTRIBUTE,
		serializeFallback({ baseUrl: BASE, externalId: ENTRY_ID, ...(design ? { design } : {}), face }),
	)
	document.body.appendChild(el)
	return el
}

let restore: () => void = () => {}
beforeEach(() => forgetPageSeedsForTests())
afterEach(() => {
	restore()
	forgetPageSeedsForTests()
	document.body.innerHTML = ''
})

describe('pageSeedFor: the seed is keyed by origin, entry and design pin', () => {
	it('an unpinned lookup finds an unpinned seed and no pinned one', () => {
		seedNode()
		expect(pageSeedFor(BASE, ENTRY_ID)?.seed.design).toBeUndefined()
		forgetPageSeedsForTests()
		document.body.innerHTML = ''
		seedNode(PIN)
		expect(pageSeedFor(BASE, ENTRY_ID)).toBeUndefined()
	})

	it('a pinned lookup finds only a seed written for exactly that pin', () => {
		seedNode(PIN)
		expect(pageSeedFor(BASE, ENTRY_ID, PIN)?.seed.design).toEqual(PIN)
		expect(pageSeedFor(BASE, ENTRY_ID, { version: PIN.version })).toBeUndefined()
		expect(pageSeedFor(BASE, ENTRY_ID, { version: PIN.version + 1, brand: BRAND })).toBeUndefined()
		expect(pageSeedFor(BASE, ENTRY_ID, { version: PIN.version, brand: 'another-brand' })).toBeUndefined()
		expect(pageSeedFor(BASE, ENTRY_ID)).toBeUndefined()
	})

	it('a pinned lookup never takes an unpinned seed', () => {
		seedNode()
		expect(pageSeedFor(BASE, ENTRY_ID, PIN)).toBeUndefined()
	})

	it('one page can carry the unpinned and the pinned seed of one entry, and each lookup gets its own', () => {
		seedNode()
		seedNode(PIN)
		expect(pageSeedFor(BASE, ENTRY_ID)?.seed.design).toBeUndefined()
		expect(pageSeedFor(BASE, ENTRY_ID, PIN)?.seed.design).toEqual(PIN)
	})

	it('another origin or another entry is another placement', () => {
		seedNode()
		expect(pageSeedFor('https://portal.certrev.com', ENTRY_ID)).toBeUndefined()
		expect(pageSeedFor(BASE, 'entry-fixture-2')).toBeUndefined()
	})

	it('refuses a seed whose pin does not pass the pin grammar: it is no seed', () => {
		const el = document.createElement('div')
		const good = JSON.parse(
			serializeSeed({ baseUrl: BASE, externalId: ENTRY_ID, design: PIN, payload: builderPayload(), renderDef: null }),
		)
		el.setAttribute(SEED_ATTRIBUTE, JSON.stringify({ ...good, design: { version: 'x' } }))
		document.body.appendChild(el)
		expect(pageSeedFor(BASE, ENTRY_ID, PIN)).toBeUndefined()
		expect(pageSeedFor(BASE, ENTRY_ID)).toBeUndefined()
	})

	it('with `live`, the document decides, not what an earlier page left in the map', () => {
		const first = seedNode()
		expect(pageSeedFor(BASE, ENTRY_ID)).toBeDefined()
		first.remove()
		expect(pageSeedFor(BASE, ENTRY_ID)).toBeDefined()
		expect(pageSeedFor(BASE, ENTRY_ID, undefined, { live: true })).toBeUndefined()
	})
})

describe('pageRecordFor: a fallback record is found as a seed is (1.2.0)', () => {
	it.each([
		'options',
		'none',
	] as const)('finds the %s record the server wrote, and pageSeedFor does not take it', (face) => {
		fallbackNode(face)
		expect(pageRecordFor(BASE, ENTRY_ID)).toMatchObject({ fallback: { baseUrl: BASE, externalId: ENTRY_ID, face } })
		expect(pageSeedFor(BASE, ENTRY_ID)).toBeUndefined()
	})

	it('is keyed by the pin, as a seed is', () => {
		fallbackNode('none', PIN)
		expect(pageRecordFor(BASE, ENTRY_ID, PIN)).toMatchObject({ fallback: { face: 'none', design: PIN } })
		expect(pageRecordFor(BASE, ENTRY_ID)).toBeUndefined()
		expect(pageRecordFor(BASE, ENTRY_ID, { version: PIN.version })).toBeUndefined()
	})

	it("one page can carry one placement's seed and another placement's record", () => {
		seedNode()
		fallbackNode('options', PIN)
		expect(pageRecordFor(BASE, ENTRY_ID)).toHaveProperty('seed')
		expect(pageRecordFor(BASE, ENTRY_ID, PIN)).toHaveProperty('fallback')
	})

	it('without `live` a record outlives its node for the page; with `live` the document decides', () => {
		const node = fallbackNode('options')
		expect(pageRecordFor(BASE, ENTRY_ID)).toHaveProperty('fallback')
		node.remove()
		expect(pageRecordFor(BASE, ENTRY_ID)).toHaveProperty('fallback')
		expect(pageRecordFor(BASE, ENTRY_ID, undefined, { live: true })).toBeUndefined()
	})

	it('with `live`, the record in the document replaces what an earlier page left for the same placement', () => {
		const node = fallbackNode('options')
		expect(pageRecordFor(BASE, ENTRY_ID)).toMatchObject({ fallback: { face: 'options' } })
		node.remove()
		fallbackNode('none')
		expect(pageRecordFor(BASE, ENTRY_ID, undefined, { live: true })).toMatchObject({ fallback: { face: 'none' } })
		expect(pageRecordFor(BASE, ENTRY_ID)).toMatchObject({ fallback: { face: 'none' } })
	})

	it('ignores an attribute that is neither a seed nor a record', () => {
		const el = document.createElement('div')
		el.setAttribute(SEED_ATTRIBUTE, JSON.stringify({ v: 1, baseUrl: BASE, externalId: ENTRY_ID, face: 'envelope' }))
		document.body.appendChild(el)
		expect(pageRecordFor(BASE, ENTRY_ID)).toBeUndefined()
	})
})

describe('pageHoldsServerHtml: a document that holds server React HTML', () => {
	it('is false for an empty page and a page of plain elements and comments', () => {
		expect(pageHoldsServerHtml()).toBe(false)
		document.body.innerHTML = '<div>hello</div><!-- a comment -->'
		expect(pageHoldsServerHtml()).toBe(false)
	})

	it.each(['$', '$?', '$!', '$~'])('is true once a Suspense boundary marker %j is in it', (marker) => {
		document.body.innerHTML = `<div><!--${marker}--><p>x</p><!--/$--></div>`
		expect(pageHoldsServerHtml()).toBe(true)
	})
})

describe('a pinned card and an unpinned card on one page', () => {
	const unpinnedCard = (clientRead = false) => (
		<CertReviewCard delivery={MARKER} clientRead={clientRead} builderContext={{ content: { id: ENTRY_ID } }} />
	)
	const pinnedCard = (clientRead = false) => (
		<CertReviewCard
			delivery={MARKER}
			clientRead={clientRead}
			builderContext={{
				content: { id: ENTRY_ID },
				context: { certrevDesignPin: { design: String(PIN.version), designBrand: BRAND } },
			}}
		/>
	)

	async function settle() {
		for (let i = 0; i < 20; i++) {
			await act(async () => {
				await new Promise((r) => setTimeout(r, 5))
			})
		}
	}

	/** Server-render `element` (a server render beside this jsdom, no switch) and return its HTML. */
	async function serverHtml(element: ReturnType<typeof pinnedCard>, issuer: ReturnType<typeof makeIssuer>) {
		const server = scriptedDelivery(() => json(deliveryBody(issuer.envelope(), READER_DEF)))
		restore = setCardDeliveryRuntimeForTests({
			resolveKid: issuer.resolveKid,
			fetchImpl: () => server.fetch,
			now: () => T0,
		})
		try {
			return await renderToHtml(element)
		} finally {
			restore()
		}
	}

	it('the server writes the pin into the seed of a pinned card, and none into an unpinned card', async () => {
		const issuer = makeIssuer()
		expect(seedOf(await serverHtml(pinnedCard(), issuer))?.design).toEqual({ version: PIN.version, brand: BRAND })
		expect(seedOf(await serverHtml(unpinnedCard(), issuer))).not.toHaveProperty('design')
	})

	/** Mount `element` on the client, in a container of its own. */
	async function clientMount(element: ReturnType<typeof pinnedCard>) {
		const container = document.createElement('div')
		document.body.appendChild(container)
		await act(async () => {
			createRoot(container).render(element)
		})
		await settle()
		return container
	}

	it('a pinned card mounted on a page whose seed is unpinned does not paint that seed: nothing (no options), or with `clientRead` it reads its own pin, once', async () => {
		const issuer = makeIssuer()
		const unpinnedHtml = await serverHtml(unpinnedCard(), issuer)
		const holder = document.createElement('div')
		holder.innerHTML = unpinnedHtml
		document.body.appendChild(holder)
		expect(pageSeedFor(BASE, ENTRY_ID)).toBeDefined()

		const delivery = scriptedDelivery(() => json(deliveryBody(issuer.envelope(), READER_DEF)))
		restore = setCardDeliveryRuntimeForTests({
			resolveKid: issuer.resolveKid,
			fetchImpl: () => delivery.fetch,
			now: () => T0,
		})
		// A block with no options of its own: no options face to paint either.
		const withoutRead = await clientMount(pinnedCard())
		expect(delivery.calls).toEqual([])
		expect(withoutRead.querySelector('[data-certrev-cert-chrome]')).toBeNull()
		const container = await clientMount(pinnedCard(true))
		expect(delivery.calls).toEqual([PINNED_URL])
		const painted = container.querySelector('[data-certrev-cert-chrome]')
		expect(painted).not.toBeNull()
		expect(painted?.getAttribute('data-certrev-def-version')).toBe(String(READER_DEF.v))
	})

	it('an unpinned card mounted on a page whose seed is pinned does not paint that seed: nothing (no options), or with `clientRead` it reads the live design, once', async () => {
		const issuer = makeIssuer()
		const pinnedHtml = await serverHtml(pinnedCard(), issuer)
		const holder = document.createElement('div')
		holder.innerHTML = pinnedHtml
		document.body.appendChild(holder)
		expect(pageSeedFor(BASE, ENTRY_ID, PIN)).toBeDefined()

		const delivery = scriptedDelivery(() => json(deliveryBody(issuer.envelope(), READER_DEF)))
		restore = setCardDeliveryRuntimeForTests({
			resolveKid: issuer.resolveKid,
			fetchImpl: () => delivery.fetch,
			now: () => T0,
		})
		// A block with no options of its own: no options face to paint either.
		const withoutRead = await clientMount(unpinnedCard())
		expect(delivery.calls).toEqual([])
		expect(withoutRead.querySelector('[data-certrev-cert-chrome]')).toBeNull()
		const container = await clientMount(unpinnedCard(true))
		expect(delivery.calls).toEqual([DELIVERY_URL])
		expect(container.querySelector('[data-certrev-cert-chrome]')).not.toBeNull()
	})

	it('a pinned card mounted on a page that holds its own pinned seed paints it with no read', async () => {
		const issuer = makeIssuer()
		const pinnedHtml = await serverHtml(pinnedCard(), issuer)
		const holder = document.createElement('div')
		holder.innerHTML = pinnedHtml
		document.body.appendChild(holder)

		const delivery = scriptedDelivery(() => {
			throw new TypeError('Failed to fetch')
		})
		restore = setCardDeliveryRuntimeForTests({
			resolveKid: issuer.resolveKid,
			fetchImpl: () => delivery.fetch,
			now: () => T0,
		})
		const container = document.createElement('div')
		document.body.appendChild(container)
		await act(async () => {
			createRoot(container).render(pinnedCard())
		})
		await settle()
		expect(delivery.calls).toEqual([])
		expect(container.querySelector('[data-certrev-cert-chrome]')).not.toBeNull()
		expect(container.textContent).toContain('Dr. Jane Doe')
	})
})
