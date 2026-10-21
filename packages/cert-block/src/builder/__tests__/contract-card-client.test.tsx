// @vitest-environment jsdom
/**
 * 2.0.0, in the browser: the contract-1 card the server printed hydrates as it stands (same node, no read, no
 * mismatch); a client mount with no record reads once (the 2.0 default) and prints the same card; React's re-render
 * after a hydration error prints it again from the seed with no read, but only after the browser has re-checked the
 * seed's card against the seed's signed binding; a seed card that does not check out is never printed, and the browser
 * reports why. jsdom has no declarative shadow DOM, so it stands for a browser without it: the card attaches each root
 * from its template. Chromium's own parser path is the replica harness's (`e2e/`).
 */

import { canonicalizeJson } from '@certrev/cert-contract'
import { act, type ReactElement } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CardDocumentV1, cardPartsFor } from '../card-contract.js'
import { CARD_FALLBACK_EVENT } from '../card-report.js'
import { CertReviewCard, type CertReviewCardProps } from '../cert-review-card.js'
import { attachCardRoots } from '../contract-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import { parseFallback, parseSeed, SEED_ATTRIBUTE } from '../ssr-seed.js'
import {
	type ContractCase,
	type ContractFixture,
	contractBody,
	contractFixture,
	expectedCardHtml,
} from './contract-v1-shapes.js'
import { sha256Hex } from './delivered-face-shapes.js'
import { ENTRY_ID, json, MARKER, makeIssuer, renderToHtml, scriptedDelivery, T0 } from './delivery-harness.js'
import { OPTIONS_ONLY_SHAPES } from './options-only-shapes.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const issuer = makeIssuer()
let restore: () => void = () => {}
const events: CustomEvent[] = []
const onEvent = (e: Event) => events.push(e as CustomEvent)
document.addEventListener(CARD_FALLBACK_EVENT, onEvent)

afterEach(() => {
	restore()
	document.body.innerHTML = ''
	for (const s of Array.from(document.head.querySelectorAll('script'))) s.remove()
	delete (document as unknown as Record<symbol, unknown>)[Symbol.for('certrev.card-runtime')]
	events.length = 0
})

const block = (extra: Partial<CertReviewCardProps> = {}) => (
	<CertReviewCard
		{...(OPTIONS_ONLY_SHAPES.todaysExport as CertReviewCardProps)}
		delivery={MARKER}
		builderContext={{ content: { id: ENTRY_ID } }}
		{...extra}
	/>
)

async function settle() {
	for (let i = 0; i < 20; i++) {
		await act(async () => {
			await new Promise((r) => setTimeout(r, 5))
		})
	}
}

async function serverHtml(body: unknown, element: ReactElement = block()): Promise<string> {
	const server = scriptedDelivery(() => json(body))
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

/** A fresh page whose reads are answered with `body` (or refused when it is undefined), counted. */
function browser(body?: unknown, now = T0) {
	const calls: string[] = []
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () =>
			(async (input: RequestInfo | URL) => {
				calls.push(String(input))
				if (body === undefined) throw new TypeError('Failed to fetch')
				return json(body)
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

async function hydrate(container: HTMLElement, element: ReactElement = block()) {
	const recoverable: unknown[] = []
	const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
	try {
		await act(async () => {
			hydrateRoot(container, element, { onRecoverableError: (e) => recoverable.push(e) })
		})
		await settle()
		return { recoverable, consoleErrors: consoleError.mock.calls.length }
	} finally {
		consoleError.mockRestore()
	}
}

async function clientMount(element: ReactElement): Promise<HTMLElement> {
	const container = document.createElement('div')
	document.body.appendChild(container)
	await act(async () => {
		createRoot(container).render(element)
	})
	await settle()
	return container
}

/** What the parser would put in each host's root: the part's template content, serialized. */
function expectedRoots(card: CardDocumentV1, names: readonly string[]): string[] {
	const scratch = document.createElement('div')
	scratch.innerHTML = expectedCardHtml(card, names)
	return Array.from(scratch.querySelectorAll('certrev-card')).map(
		(host) => (host.querySelector(':scope > template') as HTMLTemplateElement).innerHTML,
	)
}

const hostRoots = (root: ParentNode) =>
	Array.from(root.querySelectorAll('certrev-card')).map((host) => (host as HTMLElement).shadowRoot?.innerHTML ?? null)

const CASES: ContractCase[] = ['banner-elf-like', 'sidebar-elf-like', 'floating-elf-like']

describe('hydration of the server’s card', () => {
	it.each(
		CASES,
	)('%s: the same wrapper node, no read, no mismatch; each root attached with the part’s own content', async (name) => {
		const fixture = contractFixture(name)
		const html = await serverHtml(contractBody(issuer, fixture))
		const calls = browser()
		const container = mountServerHtml(html)
		const wrapper = container.querySelector('[data-certrev-face="card"]')
		expect(wrapper).not.toBeNull()
		const { recoverable, consoleErrors } = await hydrate(container)
		expect(recoverable).toEqual([])
		expect(consoleErrors).toBe(0)
		expect(calls).toEqual([])
		expect(container.querySelector('[data-certrev-face="card"]')).toBe(wrapper)
		const names = cardPartsFor(fixture.card, undefined)
		expect(hostRoots(container)).toEqual(expectedRoots(fixture.card, names))
		expect(container.querySelector('template')).toBeNull()
		expect(events).toEqual([])
	})

	it('a seed card that expired by the browser’s clock comes down after hydration', async () => {
		const fixture = contractFixture('banner-elf-like')
		const expiresAt = '2026-09-27T00:00:00.000Z'
		const html = await serverHtml(
			contractBody(issuer, fixture, { payload: { lifecycle: { ...fixture.lifecycle, expiresAt } } }),
		)
		browser(undefined, Date.parse(expiresAt) + 60_000)
		const container = mountServerHtml(html)
		await hydrate(container)
		expect(container.querySelector('certrev-card')).toBeNull()
	})
})

describe('a client mount with no record on the page (an in-app navigation)', () => {
	it.each(CASES)('%s: the 2.0 default reads once and prints the same card, roots attached', async (name) => {
		const fixture = contractFixture(name)
		const calls = browser(contractBody(issuer, fixture))
		const container = await clientMount(block())
		expect(calls).toEqual([`${MARKER.baseUrl}/api/cert/v1/delivery/builder/${ENTRY_ID}`])
		const names = cardPartsFor(fixture.card, undefined)
		expect(hostRoots(container)).toEqual(expectedRoots(fixture.card, names))
		expect(
			parseSeed(container.querySelector('[data-certrev-face="card"]')?.getAttribute(SEED_ATTRIBUTE) ?? '')?.card,
		).toEqual(fixture.card)
	})

	it('where the browser has setHTMLUnsafe, the wrapper is re-parsed from exactly the card’s bytes', async () => {
		const fixture = contractFixture('sidebar-elf-like')
		const proto = HTMLElement.prototype as HTMLElement & { setHTMLUnsafe?: (html: string) => void }
		const seen: string[] = []
		proto.setHTMLUnsafe = function (this: HTMLElement, html: string) {
			seen.push(html)
			// jsdom parses no declarative roots, so the templates stay: the card attaches them itself.
			this.innerHTML = html
		}
		try {
			browser(contractBody(issuer, fixture))
			const container = await clientMount(block())
			expect(seen).toEqual([expectedCardHtml(fixture.card, ['rail'])])
			expect(hostRoots(container)).toEqual(expectedRoots(fixture.card, ['rail']))
		} finally {
			delete proto.setHTMLUnsafe
		}
	})

	it('a read the page’s policy blocks: the options face, as 1.3.1 paints it, and delivery_unreachable reported once', async () => {
		browser()
		const container = await clientMount(block())
		expect(container.querySelector('certrev-card')).toBeNull()
		expect(container.querySelector('[data-certrev-cert-chrome]')).not.toBeNull()
		expect(events.map((e) => e.detail)).toEqual([
			{ reason: 'delivery_unreachable', platform: 'builder', externalId: ENTRY_ID },
		])
	})

	it('a contract-1 read with no card: nothing, a reasoned none record, and card_missing reported once', async () => {
		const fixture = contractFixture('banner-elf-like')
		browser(contractBody(issuer, fixture, { card: undefined }))
		const container = await clientMount(block())
		expect(container.querySelector('certrev-card')).toBeNull()
		expect(container.querySelector('[data-certrev-cert-chrome]')).toBeNull()
		const record = parseFallback(container.querySelector(`[${SEED_ATTRIBUTE}]`)?.getAttribute(SEED_ATTRIBUTE) ?? '')
		expect(record).toMatchObject({ face: 'none', reason: 'card_missing' })
		expect(events.map((e) => e.detail)).toEqual([
			{ reason: 'card_missing', platform: 'builder', externalId: ENTRY_ID, certId: fixture.certId },
		])
	})

	it('`clientRead={false}` keeps 1.3.1’s behaviour: no read, the options face', async () => {
		const calls = browser(contractBody(issuer, contractFixture('banner-elf-like')))
		const container = await clientMount(block({ clientRead: false }))
		expect(calls).toEqual([])
		expect(container.querySelector('certrev-card')).toBeNull()
		expect(container.querySelector('[data-certrev-cert-chrome]')).not.toBeNull()
	})
})

describe("React's client re-render after a hydration error elsewhere on the page", () => {
	const page = (text: string) => (
		<div>
			<p>{text}</p>
			{block()}
		</div>
	)

	it('prints the card again from the seed, with no read, once the browser has re-checked it', async () => {
		const fixture = contractFixture('banner-elf-like')
		const html = await serverHtml(contractBody(issuer, fixture), page('rendered on the server'))
		const calls = browser()
		const container = mountServerHtml(html)
		const { recoverable } = await hydrate(container, page('rendered in the browser'))
		expect(recoverable.length).toBeGreaterThan(0)
		expect(container.textContent).toContain('rendered in the browser')
		expect(calls).toEqual([])
		expect(hostRoots(container)).toEqual(expectedRoots(fixture.card, ['top', 'bottom']))
	})

	it('a seed whose card no longer hashes to the seed’s signed binding is never printed, and card_verify_failed is reported', async () => {
		const fixture = contractFixture('banner-elf-like')
		const html = await serverHtml(contractBody(issuer, fixture), page('rendered on the server'))
		browser()
		const container = mountServerHtml(html)
		// Someone rewrites the card in the page's record (a CMS field, a cache): the printed hosts stay the server's.
		const holder = container.querySelector(`[${SEED_ATTRIBUTE}]`) as Element
		const seed = JSON.parse(holder.getAttribute(SEED_ATTRIBUTE) ?? '{}') as { card: { parts: { top: string } } }
		seed.card.parts.top = seed.card.parts.top.replace('Reviewed by', 'Endorsed by')
		holder.setAttribute(SEED_ATTRIBUTE, JSON.stringify(seed))
		await hydrate(container, page('rendered in the browser'))
		expect(container.querySelector('certrev-card')).toBeNull()
		expect(container.textContent).not.toContain('Endorsed by')
		expect(events.map((e) => e.detail.reason)).toEqual(['card_verify_failed'])
	})
})

describe('the hydrating browser cannot confirm the seed card: it adopts the server’s card, then prints nothing', () => {
	it('a tampered seed under hydration: no mismatch while hydrating; the card is down after, and reported', async () => {
		const fixture = contractFixture('sidebar-elf-like')
		const html = await serverHtml(contractBody(issuer, fixture))
		browser()
		const container = mountServerHtml(html)
		const holder = container.querySelector(`[${SEED_ATTRIBUTE}]`) as Element
		const seed = JSON.parse(holder.getAttribute(SEED_ATTRIBUTE) ?? '{}') as { card: { defVersion: number } }
		seed.card.defVersion = 99
		holder.setAttribute(SEED_ATTRIBUTE, JSON.stringify(seed))
		const { consoleErrors } = await hydrate(container)
		expect(consoleErrors).toBe(0)
		expect(container.querySelector('certrev-card')).toBeNull()
		expect(events.map((e) => e.detail.reason)).toEqual(['card_verify_failed'])
	})
})

describe('the hosted runtime', () => {
	const withRuntime = (fixture: ContractFixture): ContractFixture => {
		const runtime = {
			src: 'https://portal.certrev.com/api/cert/v1/runtime/card-runtime.0123456789abcdef.js',
			integrity: 'sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC',
		}
		const card = { ...fixture.card, assets: { ...fixture.card.assets, runtime } }
		return { ...fixture, card, doc: sha256Hex(canonicalizeJson(card)) }
	}

	it('a client mount injects it once into the head, with its integrity and no credentials; a second card does not', async () => {
		const fixture = withRuntime(contractFixture('floating-elf-like'))
		browser(contractBody(issuer, fixture))
		await clientMount(block())
		await clientMount(block())
		const scripts = Array.from(
			document.head.querySelectorAll('script[data-certrev-card-runtime]'),
		) as HTMLScriptElement[]
		expect(scripts).toHaveLength(1)
		expect(scripts[0].getAttribute('src')).toBe(fixture.card.assets.runtime?.src)
		expect(scripts[0].getAttribute('integrity')).toBe(fixture.card.assets.runtime?.integrity)
		expect(scripts[0].getAttribute('crossorigin')).toBe('anonymous')
		expect(scripts[0].defer).toBe(true)
	})

	it('a runtime already running (its global guard) is not injected again', async () => {
		;(document as unknown as Record<symbol, unknown>)[Symbol.for('certrev.card-runtime')] = true
		browser(contractBody(issuer, withRuntime(contractFixture('floating-elf-like'))))
		await clientMount(block())
		expect(document.head.querySelectorAll('script')).toHaveLength(0)
	})
})

describe('attachCardRoots', () => {
	it('attaches each pending root from its template (mode and options honoured), and leaves an attached one alone', () => {
		const wrapper = document.createElement('div')
		wrapper.innerHTML =
			'<certrev-card><template shadowrootmode="open" shadowrootdelegatesfocus><b>one</b></template></certrev-card>' +
			'<certrev-card><template shadowrootmode="closed"><i>two</i></template></certrev-card>'
		document.body.appendChild(wrapper)
		const attach = vi.spyOn(HTMLElement.prototype, 'attachShadow')
		try {
			expect(attachCardRoots(wrapper, wrapper.innerHTML)).toBe(2)
			expect(attach.mock.calls.map((c) => c[0])).toEqual([
				{ mode: 'open', delegatesFocus: true },
				{ mode: 'closed', delegatesFocus: false },
			])
		} finally {
			attach.mockRestore()
		}
		const [first, second] = Array.from(wrapper.querySelectorAll('certrev-card')) as HTMLElement[]
		expect(first.shadowRoot?.innerHTML).toBe('<b>one</b>')
		expect(second.shadowRoot).toBeNull() // closed: attached, and not reachable from outside
		expect(wrapper.querySelector('template')).toBeNull()
		expect(attachCardRoots(wrapper, '')).toBe(0)
	})
})
