// @vitest-environment jsdom
/**
 * A record that streams in after the card renders (1.2.1). A streaming server sends a card whose read is still running
 * after the page's shell, in a hidden `<div id="S:0">` past `</html>`; when React renders the card on the client before
 * that part arrives (an update to the waiting boundary, #421; a mismatch above it that re-renders the whole document,
 * #423), the card has no record in front of it. Through 1.2.0 it painted the options face at once (nothing, for a
 * block with no options, the canary replica's case) and threw the streamed record away. Now a card the client renders
 * while the document is still loading waits: it paints the record when the stream adds it, to the document or to the
 * server's `<html>` React removed, and what a client mount paints when the page loads without one. It reads nothing.
 *
 * The page's loading state is `document.readyState` (mocked here) and its `DOMContentLoaded` event; the streamed part
 * is the server's own render of the card, appended where the parser appends it.
 */

import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CertReviewCard, type CertReviewCardProps } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import {
	forgetPageSeedsForTests,
	SEED_ATTRIBUTE,
	serializeSeed,
	streamedRecordFor,
	watchStreamedRecords,
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
import { RAW_DEFS } from './legacy-face-cases.js'
import { OPTIONS_ONLY_SHAPES } from './options-only-shapes.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** e.l.f.'s def on the 1.2.0 reader face. */
const READER_DEF = { ...ELF_LIKE_DEF, face: 'reader', layout: 'banner' }
/** The canary replica's pinned design. */
const PINNED_DEF = RAW_DEFS['face-reader'] as { v: number }
const PIN = { version: PINNED_DEF.v, brand: 'staging-shopify-canary' }
/** The memo `todaysExport` carries: on the page only when the options face painted. */
const OPTIONS_MEMO = 'The retinol guidance and usage cadence are accurate and safely framed.'

const card = (extra: Partial<CertReviewCardProps> = {}) => (
	<CertReviewCard delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} {...extra} />
)
const optionsCard = (extra: Partial<CertReviewCardProps> = {}) => (
	<CertReviewCard
		{...(OPTIONS_ONLY_SHAPES.todaysExport as CertReviewCardProps)}
		delivery={MARKER}
		builderContext={{ content: { id: ENTRY_ID } }}
		{...extra}
	/>
)
/** The canary replica's card: pinned, and no options (its entry carries none). */
const pinnedCard = (pin: { version: number; brand: string } = PIN) => (
	<CertReviewCard
		delivery={MARKER}
		builderContext={{
			content: { id: ENTRY_ID },
			context: { certrevDesignPin: { design: String(pin.version), designBrand: pin.brand } },
		}}
	/>
)

const issuer = makeIssuer()
let restore: () => void = () => {}
let readyState: DocumentReadyState = 'complete'

beforeEach(() => {
	forgetPageSeedsForTests()
	readyState = 'complete'
	Object.defineProperty(document, 'readyState', { configurable: true, get: () => readyState })
})
afterEach(() => {
	restore()
	restore = () => {}
	forgetPageSeedsForTests()
	Reflect.deleteProperty(document, 'readyState')
	vi.unstubAllGlobals()
	document.body.innerHTML = ''
})

async function settle() {
	for (let i = 0; i < 20; i++) {
		await act(async () => {
			await new Promise((r) => setTimeout(r, 5))
		})
	}
}

/** The server's render of `element` (a server render beside this jsdom, as in the other card tests). */
async function serverHtml(answer: () => Response | Promise<Response>, element: ReactElement): Promise<string> {
	const server = scriptedDelivery(answer)
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => server.fetch,
		now: () => T0,
	})
	try {
		return await renderToHtml(element)
	} finally {
		restore()
		restore = () => {}
	}
}

const envelopeAnswer = (def: unknown) => () => json(deliveryBody(issuer.envelope(), def))

/** The browser: a fresh page whose every read is refused (e.l.f.'s CSP), at `now`. */
function refusingBrowser(now = T0) {
	const calls: string[] = []
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () =>
			(async (input: RequestInfo | URL) => {
				calls.push(String(input))
				throw new TypeError('Failed to fetch')
			}) as typeof fetch,
		now: () => now,
	})
	return calls
}

/** A client render of `element` into a new container under `into`. */
async function clientMount(element: ReactElement, into: Element = document.body): Promise<HTMLElement> {
	const container = document.createElement('div')
	into.appendChild(container)
	await act(async () => {
		createRoot(container).render(element)
	})
	await settle()
	return container
}

/** The part a streaming server sends after `</html>`: the card's HTML in a hidden `S:0`, appended where the parser puts it. */
function streamLatePart(html: string, into: Element = document.body): HTMLElement {
	const part = document.createElement('div')
	part.hidden = true
	part.id = 'S:0'
	part.innerHTML = html
	into.appendChild(part)
	return part
}

async function pageLoaded() {
	readyState = 'interactive'
	await act(async () => {
		document.dispatchEvent(new Event('DOMContentLoaded'))
	})
	await settle()
}

const chrome = (root: ParentNode) => root.querySelector('[data-certrev-cert-chrome]')
const recordIn = (root: ParentNode) => root.querySelector(`[${SEED_ATTRIBUTE}]`)?.getAttribute(SEED_ATTRIBUTE) ?? null

describe('a card the client renders while the page is still loading (1.2.1)', () => {
	it('#421: nothing, then the seed the stream adds to the document, the same face the server painted; the late part dropped by $RC leaves it painted; no read', async () => {
		const html = await serverHtml(envelopeAnswer(READER_DEF), card())
		const calls = refusingBrowser()
		readyState = 'loading'
		const container = await clientMount(card())
		expect(container.innerHTML).toBe('')

		const part = streamLatePart(html)
		await settle()
		const served = chrome(part)
		const painted = chrome(container)
		expect(served).not.toBeNull()
		expect(painted?.getAttribute(SEED_ATTRIBUTE)).toBe(served?.getAttribute(SEED_ATTRIBUTE))
		expect(painted?.getAttribute('data-certrev-def-version')).toBe(String(ELF_LIKE_DEF.v))
		expect(painted?.textContent).toBe(served?.textContent)

		// $RC finds no boundary to fill (React deleted it) and removes the part: the card keeps what it painted.
		part.remove()
		await settle()
		expect(chrome(container)?.getAttribute(SEED_ATTRIBUTE)).toBe(served?.getAttribute(SEED_ATTRIBUTE))
		await pageLoaded()
		expect(chrome(container)?.getAttribute(SEED_ATTRIBUTE)).toBe(served?.getAttribute(SEED_ATTRIBUTE))
		expect(calls).toEqual([])
	})

	it("#423: the stream goes on into the server's <html> after React replaced it with its own, and the card paints the record from there", async () => {
		const html = await serverHtml(envelopeAnswer(READER_DEF), card())
		const calls = refusingBrowser()
		readyState = 'loading'
		const serverRoot = document.documentElement
		const serverBody = document.body
		// The card renders while the server's <html> is still the document's; React's commit then swaps it out.
		const container = await clientMount(card())
		const clientRoot = document.createElement('html')
		const clientBody = document.createElement('body')
		clientRoot.appendChild(clientBody)
		try {
			document.replaceChild(clientRoot, serverRoot)
			clientBody.appendChild(container)
			expect(container.innerHTML).toBe('')

			const part = streamLatePart(html, serverBody)
			expect(part.isConnected).toBe(false)
			await settle()
			expect(chrome(container)?.getAttribute(SEED_ATTRIBUTE)).toBe(chrome(part)?.getAttribute(SEED_ATTRIBUTE))
			await pageLoaded()
			expect(chrome(container)?.getAttribute(SEED_ATTRIBUTE)).toBe(chrome(part)?.getAttribute(SEED_ATTRIBUTE))
			expect(calls).toEqual([])
		} finally {
			document.replaceChild(serverRoot, clientRoot)
		}
	})

	it('#423 with no MutationObserver: the scan when the page has loaded finds the record in the removed <html>', async () => {
		const html = await serverHtml(envelopeAnswer(READER_DEF), card())
		refusingBrowser()
		vi.stubGlobal('MutationObserver', undefined)
		readyState = 'loading'
		const serverRoot = document.documentElement
		const serverBody = document.body
		const container = await clientMount(card())
		const clientRoot = document.createElement('html')
		clientRoot.appendChild(document.createElement('body'))
		try {
			document.replaceChild(clientRoot, serverRoot)
			document.body.appendChild(container)
			const part = streamLatePart(html, serverBody)
			await settle()
			expect(container.innerHTML).toBe('')
			await pageLoaded()
			expect(chrome(container)?.getAttribute(SEED_ATTRIBUTE)).toBe(chrome(part)?.getAttribute(SEED_ATTRIBUTE))
		} finally {
			document.replaceChild(serverRoot, clientRoot)
		}
	})

	it("the canary replica's pinned card with no options paints the reader face at its pinned version when the record streams in", async () => {
		const html = await serverHtml(envelopeAnswer(PINNED_DEF), pinnedCard())
		const calls = refusingBrowser()
		readyState = 'loading'
		const container = await clientMount(pinnedCard())
		expect(container.innerHTML).toBe('')
		streamLatePart(html)
		await settle()
		expect(chrome(container)?.getAttribute('data-certrev-def-version')).toBe(String(PIN.version))
		expect(container.querySelector('section.certrev-reader')).not.toBeNull()
		expect(calls).toEqual([])
	})

	it('a pinned card takes no streamed record for another pin, and with none for its own the page loads to nothing', async () => {
		const html = await serverHtml(envelopeAnswer(READER_DEF), card())
		refusingBrowser()
		readyState = 'loading'
		const container = await clientMount(pinnedCard())
		streamLatePart(html)
		await settle()
		expect(container.innerHTML).toBe('')
		await pageLoaded()
		expect(container.innerHTML).toBe('')
	})

	it('the page loads with no record: the options face a client mount paints (the same bytes), or nothing for a block with no options; no read', async () => {
		const calls = refusingBrowser()
		readyState = 'loading'
		const withOptions = await clientMount(optionsCard())
		const withNone = await clientMount(card())
		expect(withOptions.innerHTML).toBe('')
		expect(withNone.innerHTML).toBe('')
		await pageLoaded()
		expect(withOptions.textContent).toContain(OPTIONS_MEMO)
		expect(withNone.innerHTML).toBe('')
		// A client mount after the page loaded paints the same face at once.
		const later = await clientMount(optionsCard())
		expect(withOptions.innerHTML).toBe(later.innerHTML)
		expect(calls).toEqual([])
	})

	it.each([
		['options', () => json({ error: 'unavailable' }, 503)],
		['none', () => json({ error: 'not_found' }, 404)],
	] as const)("a streamed '%s' record paints what it says, never the options face over a 'none'", async (face, answer) => {
		const html = await serverHtml(answer, optionsCard())
		const calls = refusingBrowser()
		readyState = 'loading'
		const container = await clientMount(optionsCard())
		expect(container.innerHTML).toBe('')
		const part = streamLatePart(html)
		await settle()
		expect(JSON.parse(recordIn(container) ?? 'null')).toMatchObject({ face })
		expect(recordIn(container)).toBe(recordIn(part))
		part.remove()
		await pageLoaded()
		if (face === 'options') expect(container.textContent).toContain(OPTIONS_MEMO)
		else {
			expect(container.textContent).not.toContain(OPTIONS_MEMO)
			expect(chrome(container)).toBeNull()
			expect(container.querySelector(`[hidden][${SEED_ATTRIBUTE}]`)).not.toBeNull()
		}
		expect(calls).toEqual([])
	})

	it('a streamed seed that has expired by the browser clock paints nothing, not the options face, before and after the page loads', async () => {
		const html = await serverHtml(envelopeAnswer(READER_DEF), optionsCard())
		const expiresAt = Date.parse(builderPayload().lifecycle.expiresAt as string)
		expect(Number.isFinite(expiresAt)).toBe(true)
		const calls = refusingBrowser(expiresAt + 60_000)
		readyState = 'loading'
		const container = await clientMount(optionsCard())
		streamLatePart(html)
		await settle()
		expect(container.innerHTML).toBe('')
		await pageLoaded()
		expect(container.innerHTML).toBe('')
		expect(calls).toEqual([])
	})

	it('`clientRead` reads once, as before, and does not wait for the page', async () => {
		const browser = scriptedDelivery(envelopeAnswer(READER_DEF))
		restore = setCardDeliveryRuntimeForTests({
			resolveKid: issuer.resolveKid,
			fetchImpl: () => browser.fetch,
			now: () => T0,
		})
		readyState = 'loading'
		const container = await clientMount(card({ clientRead: true }))
		expect(chrome(container)?.getAttribute('data-certrev-def-version')).toBe(String(ELF_LIKE_DEF.v))
		expect(browser.calls).toHaveLength(1)
	})
})

describe('unchanged by 1.2.1', () => {
	it('a client mount once the page has loaded paints the options face at once and starts no watch: a record added later is not taken', async () => {
		const html = await serverHtml(envelopeAnswer(READER_DEF), card())
		refusingBrowser()
		const container = await clientMount(optionsCard())
		expect(container.textContent).toContain(OPTIONS_MEMO)
		streamLatePart(html)
		await settle()
		expect(container.textContent).toContain(OPTIONS_MEMO)
		expect(chrome(container)?.getAttribute(SEED_ATTRIBUTE)).toBeNull()
	})

	it('a card hydrating its server HTML while the page loads hydrates from its own record, the same nodes, with no wait', async () => {
		const html = await serverHtml(envelopeAnswer(READER_DEF), card())
		const calls = refusingBrowser()
		readyState = 'loading'
		const container = document.createElement('div')
		container.innerHTML = html
		document.body.appendChild(container)
		const serverNode = chrome(container)
		const recoverable: unknown[] = []
		await act(async () => {
			hydrateRoot(container, card(), { onRecoverableError: (e) => recoverable.push(e) })
		})
		await settle()
		expect(recoverable).toEqual([])
		expect(chrome(container)).toBe(serverNode)
		expect(calls).toEqual([])
	})
})

describe('streamedRecordFor: the answer a waiting card reads', () => {
	const seedHolder = () => {
		const el = document.createElement('div')
		el.setAttribute(
			SEED_ATTRIBUTE,
			serializeSeed({ baseUrl: BASE, externalId: ENTRY_ID, payload: builderPayload(), renderDef: null }),
		)
		return el
	}

	it("is 'done' when no watch runs: the page had loaded", () => {
		watchStreamedRecords()
		expect(streamedRecordFor(BASE, ENTRY_ID)).toBe('done')
	})

	it("is 'pending' while the page loads, the record once the stream adds it, and 'done' for a placement the page never carried", async () => {
		readyState = 'loading'
		watchStreamedRecords()
		expect(streamedRecordFor(BASE, ENTRY_ID)).toBe('pending')
		const holder = seedHolder()
		document.body.appendChild(holder)
		await new Promise((r) => setTimeout(r, 0))
		holder.remove()
		expect(streamedRecordFor(BASE, ENTRY_ID)).toHaveProperty('seed')
		expect(streamedRecordFor(BASE, 'entry-fixture-2')).toBe('pending')
		await pageLoaded()
		expect(streamedRecordFor(BASE, ENTRY_ID)).toHaveProperty('seed')
		expect(streamedRecordFor(BASE, 'entry-fixture-2')).toBe('done')
	})
})
