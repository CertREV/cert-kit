// @vitest-environment jsdom
/**
 * Server-render the delivery card, then hydrate it in a browser (1.2.0). The browser paints from the envelope seed the
 * server HTML carries and makes NO read of its own, which is what keeps the card on a storefront whose CSP
 * `connect-src` does not name CertREV (e.l.f.'s live policy): every browser fetch here is a network error, as a CSP
 * refusal is, and is counted. The server HTML must hydrate with no mismatch and no client-side re-render; a card the
 * server did not paint stays unpainted; a seed that expired by the browser's clock comes down after hydration; a card
 * whose server HTML streams in after another card hydrated still finds its seed; a card mounted on the client reuses
 * the page's seed; and the phone memo toggle the server HTML carries works once hydrated.
 *
 * 1.2.0 (the re-cut): the browser reads NOTHING unless the block opts in with `clientRead`. Where the server could not
 * reach CertREV it painted the block's options face and an `'options'` record, which hydrates as it is; where it got a
 * definitive no it painted nothing and a `'none'` record. A client re-render after a hydration error elsewhere on the
 * page repaints from the record, with no read. A card mounted on the client with no record paints the block's options
 * face (nothing for a block without them); only with `clientRead` does it read once, failing closed silently. A
 * reviewer photo the browser cannot load (a CSP `img-src`, a 404) is repainted as the reviewer's initials.
 */

import { verifyArtifact } from '@certrev/cert-contract'
import { act, type ReactElement } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CertReviewCard, type CertReviewCardProps } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import { parseSeed, SEED_ATTRIBUTE } from '../ssr-seed.js'
import {
	BASE,
	builderPayload,
	builderSubject,
	deliveryBody,
	ELF_LIKE_DEF,
	ENTRY_ID,
	json,
	MARKER,
	makeIssuer,
	renderToHtml,
	scriptedDelivery,
	seedOf,
	T0,
} from './delivery-harness.js'
import { OPTIONS_ONLY_SHAPES } from './options-only-shapes.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let restore: () => void = () => {}
afterEach(() => {
	restore()
	document.body.innerHTML = ''
})

let issuer: ReturnType<typeof makeIssuer>
beforeEach(() => {
	issuer = makeIssuer()
})

const card = (id = ENTRY_ID) => <CertReviewCard delivery={MARKER} builderContext={{ content: { id } }} />

/** A block as the portal exports it: the delivery marker beside the 0.5.x options (the face painted without CertREV). */
const optionsCard = (extra: Partial<CertReviewCardProps> = {}) => (
	<CertReviewCard
		{...(OPTIONS_ONLY_SHAPES.todaysExport as CertReviewCardProps)}
		delivery={MARKER}
		builderContext={{ content: { id: ENTRY_ID } }}
		{...extra}
	/>
)

/** The memo `todaysExport` carries: on the page only when the options face painted. */
const OPTIONS_MEMO = 'The retinol guidance and usage cadence are accurate and safely framed.'

const fallbackRecord = (face: 'options' | 'none') => ({ v: 1, baseUrl: BASE, externalId: ENTRY_ID, face })

/** e.l.f.'s def on the 1.2.0 reader face. */
const READER_DEF = { ...ELF_LIKE_DEF, face: 'reader', layout: 'banner' }

/** The reader face with every photo shown (the fixture's reviewer has one; its writer has none). */
const READER_DEF_WITH_PHOTOS = { ...READER_DEF, hidden: [] }

/** The reader face's avatars in order, as `size:kind` (`img` a photo, else the initials); the logo's `<img>` is none. */
const avatars = (root: Element): string[] =>
	Array.from(root.querySelectorAll('.certrev-r-face')).map((face) => {
		const size = face.classList.contains('sm') ? 'sm' : face.classList.contains('lg') ? 'lg' : ''
		return `${size}:${face.querySelector('img') ? 'img' : (face.querySelector('text')?.textContent ?? 'svg')}`
	})

async function settle() {
	for (let i = 0; i < 20; i++) {
		await act(async () => {
			await new Promise((r) => setTimeout(r, 5))
		})
	}
}

/**
 * The server: this runtime reads the Delivery API with `answer` and renders with `react-dom/server` while a jsdom
 * `document` exists, as a server render under a DOM shim does. Nothing tells the card it is a server: it decides from
 * the page (`EnvelopeCertReviewCard`), and this page holds no server HTML yet.
 */
async function serverHtml(
	answer: () => Response | Promise<Response>,
	id = ENTRY_ID,
	element: ReactElement = card(id),
): Promise<string> {
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
	}
}

/** The browser: a fresh page (no seeds known yet, a cold cache) whose every read is refused, as e.l.f.'s CSP refuses it. */
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

function mountServerHtml(html: string): HTMLElement {
	const container = document.createElement('div')
	container.innerHTML = html
	document.body.appendChild(container)
	return container
}

async function hydrate(container: HTMLElement, element: ReactElement = card()) {
	const recoverable: unknown[] = []
	let root: ReturnType<typeof hydrateRoot> | undefined
	const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
	try {
		await act(async () => {
			root = hydrateRoot(container, element, { onRecoverableError: (e) => recoverable.push(e) })
		})
		await settle()
		return { recoverable, consoleErrors: consoleError.mock.calls.length, root }
	} finally {
		consoleError.mockRestore()
	}
}

it.each([
	['the legacy face', ELF_LIKE_DEF],
	['the reader face', READER_DEF],
])('%s hydrates from the server seed with no browser read and no mismatch', async (_name, def) => {
	const html = await serverHtml(() => json(deliveryBody(issuer.envelope(), def)))
	const browserCalls = refusingBrowser()
	const container = mountServerHtml(html)
	const serverDom = container.innerHTML
	const chromeNode = container.querySelector('[data-certrev-cert-chrome]')
	expect(chromeNode).not.toBeNull()
	expect(chromeNode?.getAttribute(SEED_ATTRIBUTE)).toBeTruthy()

	const { recoverable, consoleErrors } = await hydrate(container)
	expect(recoverable).toEqual([])
	expect(consoleErrors).toBe(0)
	expect(browserCalls).toEqual([])
	// Hydrated in place, and still in place after the post-hydration check at the browser's clock.
	expect(container.querySelector('[data-certrev-cert-chrome]')).toBe(chromeNode)
	expect(container.innerHTML).toBe(serverDom)
	expect(container.textContent).toContain('Dr. Jane Doe')
	expect(chromeNode?.getAttribute('data-certrev-face')).toBe(def === READER_DEF ? 'reader' : null)
})

it('a seed that stripped nothing is the envelope as served: its payload and signature verify against the issuer, and it names the placement and def', async () => {
	const envelope = issuer.envelope()
	// A def that hides nothing: the payload is the served one, so the signature rides along and still verifies.
	const def = { ...ELF_LIKE_DEF, hidden: [] }
	const html = await serverHtml(() => json(deliveryBody(envelope, def)))
	const container = mountServerHtml(html)
	const raw = container.querySelector(`[${SEED_ATTRIBUTE}]`)?.getAttribute(SEED_ATTRIBUTE)
	if (!raw) throw new Error('no seed in the server HTML')
	const seed = parseSeed(raw)
	expect(seed?.baseUrl).toBe(BASE)
	expect(seed?.externalId).toBe(ENTRY_ID)
	expect(seed?.payload).toEqual(envelope.payload)
	expect(seed?.signature).toEqual(envelope.signature)
	expect(seed?.renderDef).toMatchObject({ v: ELF_LIKE_DEF.v, hidden: [] })
	const verdict = await verifyArtifact(
		{ payload: seed?.payload, signature: seed?.signature } as never,
		issuer.resolveKid,
		{ platform: 'builder', externalId: ENTRY_ID, now: new Date(T0) },
	)
	expect(verdict.decision).toBe('render')
})

it('a card the server did not paint (revoked) hydrates to nothing, with no browser read', async () => {
	const tombstone = await issuer.tombstone()
	const html = await serverHtml(() => json(tombstone))
	expect(html).not.toContain('data-certrev-cert-chrome')
	const browserCalls = refusingBrowser()
	const container = mountServerHtml(html)
	const { recoverable, consoleErrors } = await hydrate(container)
	expect(recoverable).toEqual([])
	expect(consoleErrors).toBe(0)
	expect(browserCalls).toEqual([])
	expect(container.querySelector('[data-certrev-cert-chrome]')).toBeNull()
})

it('a seed that has expired by the browser clock comes down once hydrated, with no browser read', async () => {
	const html = await serverHtml(() => json(deliveryBody(issuer.envelope())))
	const expiresAt = Date.parse(builderPayload().lifecycle.expiresAt as string)
	expect(Number.isFinite(expiresAt)).toBe(true)
	const browserCalls = refusingBrowser(expiresAt + 60_000)
	const container = mountServerHtml(html)
	const { recoverable } = await hydrate(container)
	expect(recoverable).toEqual([])
	expect(browserCalls).toEqual([])
	expect(container.querySelector('[data-certrev-cert-chrome]')).toBeNull()
})

it('a card mounted on the client after hydration reuses the page seed, even once the server node is gone', async () => {
	const html = await serverHtml(() => json(deliveryBody(issuer.envelope())))
	const browserCalls = refusingBrowser()
	const container = mountServerHtml(html)
	const { root } = await hydrate(container)
	expect(container.querySelector('[data-certrev-cert-chrome]')).not.toBeNull()
	// An in-app navigation away and back: the hydrated card unmounts, a new one mounts on the client.
	await act(async () => {
		root?.unmount()
	})
	expect(document.querySelector(`[${SEED_ATTRIBUTE}]`)).toBeNull()
	const next = document.createElement('div')
	document.body.appendChild(next)
	await act(async () => {
		createRoot(next).render(card())
	})
	await settle()
	expect(browserCalls).toEqual([])
	expect(next.querySelector('[data-certrev-cert-chrome]')).not.toBeNull()
	expect(next.textContent).toContain('Dr. Jane Doe')
})

it('a card whose server HTML streams in after another card hydrated still finds its seed, with no browser read', async () => {
	// Two placements on one page, as two Suspense boundaries whose Delivery reads settle at different times: the first
	// card hydrates (and the page is scanned for seeds) before the second card's HTML exists in the document.
	const SECOND = 'entry-fixture-2'
	const firstHtml = await serverHtml(() => json(deliveryBody(issuer.envelope())))
	const secondHtml = await serverHtml(
		() => json(deliveryBody(issuer.envelope({ subject: builderSubject(SECOND) }))),
		SECOND,
	)
	const browserCalls = refusingBrowser()
	const first = mountServerHtml(firstHtml)
	const firstNode = first.querySelector('[data-certrev-cert-chrome]')
	const a = await hydrate(first, card())
	const second = mountServerHtml(secondHtml)
	const secondNode = second.querySelector('[data-certrev-cert-chrome]')
	expect(secondNode).not.toBeNull()
	const b = await hydrate(second, card(SECOND))
	expect([...a.recoverable, ...b.recoverable]).toEqual([])
	expect(a.consoleErrors + b.consoleErrors).toBe(0)
	expect(browserCalls).toEqual([])
	expect(first.querySelector('[data-certrev-cert-chrome]')).toBe(firstNode)
	expect(second.querySelector('[data-certrev-cert-chrome]')).toBe(secondNode)
	expect(parseSeed(secondNode?.getAttribute(SEED_ATTRIBUTE) ?? '')?.externalId).toBe(SECOND)
})

it("a card mounted on the client with no record on the page makes no read: the block's options face, or nothing", async () => {
	const browserCalls = refusingBrowser()
	const withOptions = document.createElement('div')
	const bare = document.createElement('div')
	document.body.append(withOptions, bare)
	await act(async () => {
		createRoot(withOptions).render(optionsCard())
		createRoot(bare).render(card())
	})
	await settle()
	expect(browserCalls).toEqual([])
	// The block's own options face, as 0.5.x painted it, with no record (the server wrote none for this mount).
	const painted = withOptions.querySelector('[data-certrev-cert-chrome]')
	expect(painted).not.toBeNull()
	expect(withOptions.textContent).toContain(OPTIONS_MEMO)
	expect(painted?.hasAttribute(SEED_ATTRIBUTE)).toBe(false)
	// A block with the marker and no options (nothing to paint from) paints nothing.
	expect(bare.innerHTML).toBe('')
})

it('with `clientRead`, a card mounted on the client with no seed on the page reads once and paints', async () => {
	const delivery = scriptedDelivery(() => json(deliveryBody(issuer.envelope())))
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => delivery.fetch,
		now: () => T0,
	})
	const container = document.createElement('div')
	document.body.appendChild(container)
	await act(async () => {
		createRoot(container).render(
			<CertReviewCard delivery={MARKER} clientRead builderContext={{ content: { id: ENTRY_ID } }} />,
		)
	})
	await settle()
	expect(delivery.calls).toHaveLength(1)
	const painted = container.querySelector('[data-certrev-cert-chrome]')
	expect(painted).not.toBeNull()
	// It seeds its own face, so a later client mount on this page needs no read either.
	expect(painted?.getAttribute(SEED_ATTRIBUTE)).toBeTruthy()
})

it.each([
	['refused (a CSP block or a network error)', 'refused'],
	['revoked', 'tombstone'],
])('with `clientRead`, a card mounted on the client with no seed fails closed silently when its read is %s', async (_name, kind) => {
	const tombstone = await issuer.tombstone()
	const calls: string[] = []
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () =>
			(async (input: RequestInfo | URL) => {
				calls.push(String(input))
				if (kind === 'refused') throw new TypeError('Failed to fetch')
				return json(tombstone)
			}) as typeof fetch,
		now: () => T0,
	})
	const container = document.createElement('div')
	document.body.appendChild(container)
	const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
	try {
		await act(async () => {
			createRoot(container).render(
				<div data-host>
					<CertReviewCard delivery={MARKER} clientRead builderContext={{ content: { id: ENTRY_ID } }} />
				</div>,
			)
		})
		await settle()
		expect(consoleError).not.toHaveBeenCalled()
	} finally {
		consoleError.mockRestore()
	}
	expect(calls).toHaveLength(1)
	// Nothing painted, nothing thrown: the host's own tree is still mounted.
	expect(container.querySelector('[data-host]')).not.toBeNull()
	expect(container.querySelector('[data-certrev-cert-chrome]')).toBeNull()
})

it('a card whose server could not reach CertREV hydrates the options face it painted, with no browser read and no mismatch', async () => {
	const html = await serverHtml(() => json({ error: 'unavailable' }, 503), ENTRY_ID, optionsCard())
	expect(seedOf(html)).toEqual(fallbackRecord('options'))
	const browserCalls = refusingBrowser()
	const container = mountServerHtml(html)
	const serverDom = container.innerHTML
	const chromeNode = container.querySelector('[data-certrev-cert-chrome]')
	expect(chromeNode).not.toBeNull()
	const { recoverable, consoleErrors } = await hydrate(container, optionsCard())
	expect(recoverable).toEqual([])
	expect(consoleErrors).toBe(0)
	expect(browserCalls).toEqual([])
	expect(container.querySelector('[data-certrev-cert-chrome]')).toBe(chromeNode)
	expect(container.innerHTML).toBe(serverDom)
	expect(container.textContent).toContain(OPTIONS_MEMO)
})

it("the canary replica's pinned card (the host's proof) gets the same options face on a 503, through hydration and on a client mount, with no browser read", async () => {
	const pin = { certrevDesignPin: { design: '1170', designBrand: 'staging-shopify-canary' } }
	const pinned = () => optionsCard({ builderContext: { content: { id: ENTRY_ID }, context: pin } })
	const html = await serverHtml(() => json({ error: 'unavailable' }, 503), ENTRY_ID, pinned())
	expect(seedOf(html)).toEqual({
		...fallbackRecord('options'),
		design: { version: 1170, brand: 'staging-shopify-canary' },
	})
	const browserCalls = refusingBrowser()
	const container = mountServerHtml(html)
	const serverDom = container.innerHTML
	const { recoverable, consoleErrors } = await hydrate(container, pinned())
	expect(recoverable).toEqual([])
	expect(consoleErrors).toBe(0)
	expect(container.innerHTML).toBe(serverDom)
	expect(container.textContent).toContain(OPTIONS_MEMO)
	// A pinned card the browser mounts with no record (Builder's editor on the replica): the options face, no read.
	const later = document.createElement('div')
	document.body.appendChild(later)
	await act(async () => {
		createRoot(later).render(optionsCard({ builderContext: { content: { id: 'another-entry' }, context: pin } }))
	})
	await settle()
	expect(later.textContent).toContain(OPTIONS_MEMO)
	expect(browserCalls).toEqual([])
})

it("a server 'none' record keeps the card down through hydration, with no browser read", async () => {
	const tombstone = await issuer.tombstone()
	const html = await serverHtml(() => json(tombstone), ENTRY_ID, optionsCard())
	expect(seedOf(html)).toEqual(fallbackRecord('none'))
	const browserCalls = refusingBrowser()
	const container = mountServerHtml(html)
	const { recoverable, consoleErrors } = await hydrate(container, optionsCard())
	expect(recoverable).toEqual([])
	expect(consoleErrors).toBe(0)
	expect(browserCalls).toEqual([])
	// The options are on the block, and still nothing paints: a revoked card stays down.
	expect(container.querySelector('[data-certrev-cert-chrome]')).toBeNull()
	expect(container.textContent).not.toContain(OPTIONS_MEMO)
})

describe("React's client re-render after a hydration error elsewhere on the page (the host's #418/#423 load)", () => {
	// The page around the card does not match its server HTML (a timestamp, say), so React gives up hydrating the root
	// and renders it again on the client. The card is then a client mount, not a hydration, but the server HTML (and its
	// record) is still in the document while it renders.
	const page = (text: string) => (
		<div>
			<p>{text}</p>
			{optionsCard()}
		</div>
	)

	it.each([
		['the envelope (a seed)', 'seed'],
		['the options face (CertREV not reached)', 'options'],
		['nothing (revoked)', 'none'],
	] as const)('repaints %s from the server record, with no browser read', async (_name, kind) => {
		const tombstone = await issuer.tombstone()
		const answer =
			kind === 'seed'
				? () => json(deliveryBody(issuer.envelope()))
				: kind === 'options'
					? () => json({ error: 'unavailable' }, 503)
					: () => json(tombstone)
		const html = await serverHtml(answer, ENTRY_ID, page('rendered on the server'))
		const browserCalls = refusingBrowser()
		const container = mountServerHtml(html)
		const { recoverable } = await hydrate(container, page('rendered in the browser'))
		// React did give up on the server HTML and render the root on the client.
		expect(recoverable.length).toBeGreaterThan(0)
		expect(container.textContent).toContain('rendered in the browser')
		expect(browserCalls).toEqual([])
		const chrome = container.querySelector('[data-certrev-cert-chrome]')
		if (kind === 'seed') {
			expect(chrome?.hasAttribute('data-certrev-delivery')).toBe(true)
			expect(container.textContent).toContain('Dr. Jane Doe')
		} else if (kind === 'options') {
			expect(chrome).not.toBeNull()
			expect(chrome?.hasAttribute('data-certrev-delivery')).toBe(false)
			expect(container.textContent).toContain(OPTIONS_MEMO)
			expect(seedOf(container.innerHTML)).toEqual(fallbackRecord('options'))
		} else {
			expect(chrome).toBeNull()
			expect(seedOf(container.innerHTML)).toEqual(fallbackRecord('none'))
		}
	})
})

describe('a reviewer photo the browser cannot load is repainted as their initials (1.2.0)', () => {
	async function hydratedReaderCard(prepare: (container: HTMLElement) => void = () => {}) {
		const html = await serverHtml(() => json(deliveryBody(issuer.envelope(), READER_DEF_WITH_PHOTOS)))
		const browserCalls = refusingBrowser()
		const container = mountServerHtml(html)
		const seed = container.querySelector(`[${SEED_ATTRIBUTE}]`)?.getAttribute(SEED_ATTRIBUTE)
		// The server painted the reviewer's photo (twice: the byline and the memo) and the writer's initials.
		expect(avatars(container)).toEqual(['sm:SW', ':img', 'lg:img'])
		prepare(container)
		const { recoverable, consoleErrors } = await hydrate(container)
		expect(recoverable).toEqual([])
		expect(consoleErrors).toBe(0)
		expect(browserCalls).toEqual([])
		return { container, seed }
	}

	it("on the photo's error event (a CSP img-src refusal, a 404)", async () => {
		const { container, seed } = await hydratedReaderCard()
		expect(avatars(container)).toEqual(['sm:SW', ':img', 'lg:img'])
		const photo = container.querySelector('.certrev-r-face:not(.sm) > img')
		if (!photo) throw new Error('no reviewer photo on the hydrated card')
		await act(async () => {
			photo.dispatchEvent(new Event('error'))
		})
		expect(avatars(container)).toEqual(['sm:SW', ':JD', 'lg:JD'])
		expect(container.querySelector('.certrev-r-face > img')).toBeNull()
		// The seed is the server's, untouched; only the face painted from it changed.
		expect(container.querySelector(`[${SEED_ATTRIBUTE}]`)?.getAttribute(SEED_ATTRIBUTE)).toBe(seed)
	})

	it('when the photo had already failed before the card hydrated (no error event left to hear)', async () => {
		const { container } = await hydratedReaderCard((c) => {
			for (const img of Array.from(c.querySelectorAll('.certrev-r-face > img'))) {
				Object.defineProperty(img, 'complete', { configurable: true, get: () => true })
				Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => 0 })
			}
		})
		expect(avatars(container)).toEqual(['sm:SW', ':JD', 'lg:JD'])
	})

	it('a photo that loaded, or is still loading, stays', async () => {
		const { container } = await hydratedReaderCard((c) => {
			const [loaded] = Array.from(c.querySelectorAll('.certrev-r-face > img'))
			if (!loaded) throw new Error('no photo')
			Object.defineProperty(loaded, 'complete', { configurable: true, get: () => true })
			Object.defineProperty(loaded, 'naturalWidth', { configurable: true, get: () => 640 })
		})
		expect(avatars(container)).toEqual(['sm:SW', ':img', 'lg:img'])
	})
})

it('the phone memo toggle works on the hydrated card, is a native button (so Enter and Space reach it), and unbinds on unmount', async () => {
	// A memo long enough to collapse on a phone (over 160 characters).
	const memo =
		'I reviewed the retinol claims against current dermatology guidance; the concentrations, the usage cadence and the sun-protection advice are accurate and safely framed.'
	const html = await serverHtml(() =>
		json(deliveryBody(issuer.envelope({ content: { ...builderPayload().content, memo } }))),
	)
	// The server face is the collapsed one: the toggle ships in the HTML, before any script runs.
	expect(html).toContain('data-certrev-memo="collapsed"')
	expect(html).toContain('aria-expanded="false"')

	const browserCalls = refusingBrowser()
	const container = mountServerHtml(html)
	const { recoverable, consoleErrors, root } = await hydrate(container)
	expect(recoverable).toEqual([])
	expect(consoleErrors).toBe(0)
	expect(browserCalls).toEqual([])

	const button = container.querySelector<HTMLButtonElement>('[data-certrev-memo-toggle]')
	const box = container.querySelector('[data-certrev-memo]')
	if (!button || !box) throw new Error('no memo toggle on the hydrated card')
	// A native button: Enter and Space reach it as a click, so one listener covers the keyboard.
	expect(button.tagName).toBe('BUTTON')
	expect(button.type).toBe('button')

	await act(async () => {
		button.click()
	})
	expect(box.getAttribute('data-certrev-memo')).toBe('open')
	expect(button.getAttribute('aria-expanded')).toBe('true')
	expect(button.textContent).toBe('Show less')

	// A click on the memo text itself does nothing.
	await act(async () => {
		;(container.querySelector('[data-certrev-memo-text]') as HTMLElement).click()
	})
	expect(box.getAttribute('data-certrev-memo')).toBe('open')

	await act(async () => {
		button.click()
	})
	expect(box.getAttribute('data-certrev-memo')).toBe('collapsed')
	expect(button.getAttribute('aria-expanded')).toBe('false')
	expect(button.textContent).toBe('Read the full memo')

	// Unmounted: the listener is gone with the card (a detached button flips nothing).
	const chrome = container.querySelector('[data-certrev-cert-chrome]') as HTMLElement
	await act(async () => {
		root?.unmount()
	})
	chrome.appendChild(box)
	button.click()
	expect(box.getAttribute('data-certrev-memo')).toBe('collapsed')
})
