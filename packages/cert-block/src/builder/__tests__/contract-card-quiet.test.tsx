// @vitest-environment jsdom
/**
 * 2.0.1: the contract-1 card adds nothing to the page's console (`contract-card.tsx`, "NO CONSOLE NOISE"). In a
 * browser that parses declarative shadow roots, React's development build reported a hydration mismatch for every
 * card (the parser had attached the roots React expected as templates), and every card React wrote itself (an in-app
 * navigation, a re-render after the page's own hydration error) drew Chrome's "declarative Shadow DOM is not being
 * parsed" warning per template. jsdom parses no declarative roots: these tests stand it in for a browser that does.
 *
 * Its own file, and hydration first: React's development build reports one hydration mismatch per module lifetime,
 * so a mismatch elsewhere in a shared file would hide this one.
 */

import { act, type ReactElement } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CardDocumentV1, cardPartsFor } from '../card-contract.js'
import { CertReviewCard } from '../cert-review-card.js'
import { attachCardRoots, clientCardHtml, INERT_MODE_ATTRIBUTE } from '../contract-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import { type ContractCase, contractBody, contractFixture, expectedCardHtml } from './contract-v1-shapes.js'
import { ENTRY_ID, json, MARKER, makeIssuer, renderToHtml, scriptedDelivery, T0 } from './delivery-harness.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const issuer = makeIssuer()
const CASES: ContractCase[] = ['banner-elf-like', 'sidebar-elf-like', 'floating-elf-like']
let restore: () => void = () => {}

afterEach(() => {
	restore()
	document.body.innerHTML = ''
	for (const s of Array.from(document.head.querySelectorAll('script'))) s.remove()
	delete (document as unknown as Record<symbol, unknown>)[Symbol.for('certrev.card-runtime')]
})

const block = () => <CertReviewCard delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} />

async function settle() {
	for (let i = 0; i < 20; i++) {
		await act(async () => {
			await new Promise((r) => setTimeout(r, 5))
		})
	}
}

/** The page the server prints for a block whose read is answered with `body`. */
async function serverHtml(body: unknown): Promise<string> {
	const server = scriptedDelivery(() => json(body))
	const undo = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => server.fetch,
		now: () => T0,
	})
	try {
		return await renderToHtml(block())
	} finally {
		undo()
	}
}

/** The browser's reads, answered with `body` (or refused when it is undefined), counted. */
function browser(body?: unknown): string[] {
	const calls: string[] = []
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () =>
			(async (input: RequestInfo | URL) => {
				calls.push(String(input))
				if (body === undefined) throw new TypeError('Failed to fetch')
				return json(body)
			}) as typeof fetch,
		now: () => T0,
	})
	return calls
}

/** jsdom parses no declarative roots: this stands it in for a browser that does (Chrome, Safari, Firefox). */
function parsingDeclarativeRoots(): () => void {
	const proto = HTMLTemplateElement.prototype as unknown as Record<string, unknown>
	Object.defineProperty(proto, 'shadowRootMode', { configurable: true, get: () => '' })
	return () => {
		delete proto.shadowRootMode
	}
}

/** Every string written through `innerHTML` while `run` runs. */
async function innerHtmlWrites(run: () => Promise<void>): Promise<string[]> {
	const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML') as PropertyDescriptor
	const writes: string[] = []
	Object.defineProperty(Element.prototype, 'innerHTML', {
		...descriptor,
		set(this: Element, value: string) {
			writes.push(String(value))
			descriptor.set?.call(this, value)
		},
	})
	try {
		await run()
	} finally {
		Object.defineProperty(Element.prototype, 'innerHTML', descriptor)
	}
	return writes
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

describe('hydrating the server’s card, its roots attached by the parser', () => {
	it.each(CASES)('%s: no mismatch in React’s development build, the same roots kept, no read', async (name) => {
		const fixture = contractFixture(name)
		const html = await serverHtml(contractBody(issuer, fixture))
		// The server prints the real templates, so the card is complete with JavaScript off.
		expect(html).toContain('<template shadowrootmode="open">')
		expect(html).not.toContain(INERT_MODE_ATTRIBUTE)
		const calls = browser()
		const container = document.createElement('div')
		container.innerHTML = html
		document.body.appendChild(container)
		// What the browser's parser does with the server's page: each root attached, no template left.
		attachCardRoots(container.querySelector('[data-certrev-face="card"]') as Element, '')
		const roots = Array.from(container.querySelectorAll('certrev-card')).map((h) => (h as HTMLElement).shadowRoot)
		expect(roots.length).toBeGreaterThanOrEqual(2)
		expect(roots.every((r) => r !== null)).toBe(true)
		const undo = parsingDeclarativeRoots()
		const recoverable: unknown[] = []
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			await act(async () => {
				hydrateRoot(container, block(), { onRecoverableError: (e) => recoverable.push(e) })
			})
			await settle()
			expect(recoverable).toEqual([])
			expect(consoleError.mock.calls.map((c) => String(c[0]).slice(0, 80))).toEqual([])
		} finally {
			consoleError.mockRestore()
			undo()
		}
		expect(calls).toEqual([])
		const after = Array.from(container.querySelectorAll('certrev-card')).map((h) => (h as HTMLElement).shadowRoot)
		expect(after.length).toBe(roots.length)
		expect(after.every((r, i) => r === roots[i])).toBe(true)
		expect(container.querySelector('template')).toBeNull()
	})
})

describe('a card React writes itself (an in-app navigation)', () => {
	it.each(CASES)('%s: no shadowrootmode written through innerHTML, and every root attached', async (name) => {
		const fixture = contractFixture(name)
		browser(contractBody(issuer, fixture))
		const undo = parsingDeclarativeRoots()
		let container = document.body
		try {
			const writes = await innerHtmlWrites(async () => {
				container = await clientMount(block())
			})
			const cardWrites = writes.filter((w) => w.includes('<certrev-card'))
			expect(cardWrites.length).toBeGreaterThan(0)
			for (const w of cardWrites) expect(w).not.toMatch(/\sshadowrootmode=/i)
		} finally {
			undo()
		}
		expect(hostRoots(container)).toEqual(expectedRoots(fixture.card, cardPartsFor(fixture.card, undefined)))
		expect(container.querySelector('template')).toBeNull()
	})

	it('with setHTMLUnsafe, the wrapper is still re-parsed from exactly the card’s bytes', async () => {
		const fixture = contractFixture('sidebar-elf-like')
		const proto = HTMLElement.prototype as HTMLElement & { setHTMLUnsafe?: (html: string) => void }
		const seen: string[] = []
		proto.setHTMLUnsafe = function (this: HTMLElement, html: string) {
			seen.push(html)
			this.innerHTML = html
		}
		const undo = parsingDeclarativeRoots()
		try {
			browser(contractBody(issuer, fixture))
			const container = await clientMount(block())
			expect(seen).toEqual([expectedCardHtml(fixture.card, ['rail'])])
			expect(hostRoots(container)).toEqual(expectedRoots(fixture.card, ['rail']))
		} finally {
			undo()
			delete proto.setHTMLUnsafe
		}
	})
})

describe('clientCardHtml', () => {
	it.each(CASES)('%s: each template’s mode renamed, no other byte changed', (name) => {
		const fixture = contractFixture(name)
		const html = expectedCardHtml(fixture.card, cardPartsFor(fixture.card, undefined))
		const client = clientCardHtml(html)
		expect(html.split(' shadowrootmode=').length - 1).toBeGreaterThanOrEqual(3)
		expect(client).not.toMatch(/\sshadowrootmode=/i)
		expect(client.replaceAll(` ${INERT_MODE_ATTRIBUTE}=`, ' shadowrootmode=')).toBe(html)
	})

	it('the mode wherever it sits in the tag, in any case; nothing outside a template tag', () => {
		const css = '<style>p::after{content:" shadowrootmode=open"}</style>'
		expect(
			clientCardHtml(
				`${css}<certrev-card><template shadowrootdelegatesfocus ShadowRootMode="closed"><i>x</i></template></certrev-card>`,
			),
		).toBe(
			`${css}<certrev-card><template shadowrootdelegatesfocus ${INERT_MODE_ATTRIBUTE}="closed"><i>x</i></template></certrev-card>`,
		)
	})

	it('a closed root under the inert name is attached closed, with its options', () => {
		const wrapper = document.createElement('div')
		wrapper.innerHTML = clientCardHtml(
			'<certrev-card><template shadowrootmode="open" shadowrootdelegatesfocus><b>one</b></template></certrev-card>' +
				'<certrev-card><template shadowrootmode="closed"><i>two</i></template></certrev-card>',
		)
		document.body.appendChild(wrapper)
		const attach = vi.spyOn(HTMLElement.prototype, 'attachShadow')
		try {
			expect(attachCardRoots(wrapper, '')).toBe(2)
			expect(attach.mock.calls.map((c) => c[0])).toEqual([
				{ mode: 'open', delegatesFocus: true },
				{ mode: 'closed', delegatesFocus: false },
			])
		} finally {
			attach.mockRestore()
		}
		expect(wrapper.querySelector('template')).toBeNull()
	})
})
