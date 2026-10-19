// @vitest-environment jsdom
/**
 * 1.3.0, browser renders: the browser paints the delivered face it was served only after hashing it against the seed
 * payload's own signed digest, with no read. A seed with no face, or a face the browser cannot confirm (no WebCrypto,
 * bytes that do not hash), paints what 1.2.1 paints for it: the goldens were rendered by the unmodified 1.2.1 tree for
 * the same records and reads (`delivered-face-shapes.ts`). Hydration, a client mount over the page's record, a record
 * streamed in while the page loads, and a `clientRead` read.
 *
 * Every browser fetch is refused and counted (a storefront CSP that names no CertREV origin), except under `clientRead`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, type ReactElement } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CERT_STRINGS_VERSION } from '../../components/render-def.js'
import { CertReviewCard, type CertReviewCardProps } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import { forgetPageSeedsForTests, SEED_ATTRIBUTE } from '../ssr-seed.js'
import {
	DEFS,
	DELIVERED_FACE,
	type DefName,
	fixedIssuer,
	matchingBody,
	ownFaceBodies,
	PIN_CONTEXT,
	serverCases,
} from './delivered-face-shapes.js'
import { ENTRY_ID, json, MARKER, renderToHtml, scriptedDelivery, T0, withoutSeed } from './delivery-harness.js'
import { OPTIONS_ONLY_SHAPES } from './options-only-shapes.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const goldenFile = (name: string) =>
	JSON.parse(readFileSync(join(process.cwd(), 'src/builder/__tests__/__golden__', name), 'utf8')) as {
		readonly readerCssPlaceholder: string
		readonly readerCss: string
		readonly seedsWithFace: Record<DefName, string>
		readonly cases: Record<string, number>
		readonly outputs: string[]
	}
const SERVER = goldenFile('delivered-face-1.2.1.json')
const CLIENT = goldenFile('delivered-face-client-1.2.1.json')

const expand = (g: typeof SERVER, name: string) => {
	const at = g.cases[name]
	if (at === undefined) throw new Error(`no golden for ${name}`)
	return g.outputs[at].split(g.readerCssPlaceholder).join(SERVER.readerCss)
}
/** What 1.2.1 rendered in a browser (jsdom's `innerHTML`) for one client case. */
const golden121 = (name: string) => expand(CLIENT, name)

/** The server HTML without React's Suspense boundary comments, as a container a client render filled holds it. */
const markersOff = (html: string) => html.replace(/<!--\/?\$[?!~]?-->/g, '')

const DEF_NAMES = Object.keys(DEFS) as DefName[]
const issuer = fixedIssuer()
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
	vi.restoreAllMocks()
	document.body.innerHTML = ''
})

/** The block as the portal exports it (options beside the marker), with any extra props (a part, `clientRead`). */
const card = (extra: { readonly pinned?: true } & Partial<CertReviewCardProps> = {}) => {
	const { pinned, ...rest } = extra
	return (
		<CertReviewCard
			{...(OPTIONS_ONLY_SHAPES.todaysExport as CertReviewCardProps)}
			delivery={MARKER}
			builderContext={{ content: { id: ENTRY_ID }, ...(pinned ? { context: PIN_CONTEXT } : {}) }}
			{...rest}
		/>
	)
}

async function settle() {
	for (let i = 0; i < 20; i++) {
		await act(async () => {
			await new Promise((r) => setTimeout(r, 5))
		})
	}
}

/** The server's render (beside this jsdom, which holds no server HTML yet), with real WebCrypto. */
async function serverHtml(body: Record<string, unknown>, element: ReactElement = card()): Promise<string> {
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
		restore = () => {}
	}
}

/** The browser: a fresh page and process (no seeds, no face hashes, a cold cache) whose every read is refused. */
function refusingBrowser() {
	const calls: string[] = []
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () =>
			(async (input: RequestInfo | URL) => {
				calls.push(String(input))
				throw new TypeError('Failed to fetch')
			}) as typeof fetch,
		now: () => T0,
	})
	return calls
}

/** A browser with no working WebCrypto digest (an insecure context has no `crypto.subtle` at all). */
const brokenDigest = () => vi.spyOn(globalThis.crypto.subtle, 'digest').mockRejectedValue(new Error('no WebCrypto'))

function mountServerHtml(html: string): HTMLElement {
	const container = document.createElement('div')
	container.innerHTML = html
	document.body.appendChild(container)
	return container
}

async function hydrate(container: HTMLElement, element: ReactElement = card()) {
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

/** An element carrying one record, as the server HTML (or a late streamed part) does. */
function recordElement(raw: string): HTMLElement {
	const holder = document.createElement('div')
	holder.hidden = true
	holder.setAttribute(SEED_ATTRIBUTE, raw)
	return holder
}

const chrome = (root: ParentNode) => root.querySelector('[data-certrev-cert-chrome]')

/** The painted delivered face: the wrapper's attributes, its seed, and exactly the stylesheet and the markup. */
function expectDeliveredFace(root: ParentNode, seed: string) {
	const face = chrome(root)
	expect(face?.getAttribute('data-certrev-face')).toBe('delivered')
	expect(face?.getAttribute('data-certrev-delivery')).toBe('')
	expect(face?.getAttribute('data-certrev-strings-version')).toBe(CERT_STRINGS_VERSION)
	expect(face?.getAttribute('data-certrev-def-version')).toBe('4')
	expect(face?.getAttribute(SEED_ATTRIBUTE)).toBe(seed)
	expect(face?.innerHTML).toBe(`<style>${DELIVERED_FACE.css}</style>${DELIVERED_FACE.html}`)
	expect(root.querySelector('[data-certrev-builder-flow]')).toBeNull()
}

describe('hydration', () => {
	it.each(
		DEF_NAMES,
	)('%s def: the delivered face hydrates from its seed, re-hashed in the browser: no read, no mismatch, the same node', async (defName) => {
		const html = await serverHtml(matchingBody(issuer, DEFS[defName]))
		const calls = refusingBrowser()
		const digest = vi.spyOn(globalThis.crypto.subtle, 'digest')
		const container = mountServerHtml(html)
		const served = container.innerHTML
		const node = chrome(container)
		expectDeliveredFace(container, CLIENT.seedsWithFace[defName])

		const { recoverable, consoleErrors } = await hydrate(container)
		expect(recoverable).toEqual([])
		expect(consoleErrors).toBe(0)
		expect(calls).toEqual([])
		expect(digest).toHaveBeenCalledTimes(2)
		expect(chrome(container)).toBe(node)
		expect(container.innerHTML).toBe(served)
	})

	it.each(
		DEF_NAMES,
	)('%s def: a browser that cannot hash hydrates the seed as 1.2.1 paints it, with no read and no error', async (defName) => {
		const html = await serverHtml(matchingBody(issuer, DEFS[defName]))
		const calls = refusingBrowser()
		const digest = brokenDigest()
		const container = mountServerHtml(html)
		expect(container.querySelector('.crv-face')).not.toBeNull()

		const { recoverable, consoleErrors } = await hydrate(container)
		expect(digest).toHaveBeenCalled()
		expect(recoverable).toEqual([])
		expect(consoleErrors).toBe(0)
		expect(calls).toEqual([])
		expect(markersOff(container.innerHTML)).toBe(golden121(`seedWithFace.${defName}`))
		expect(container.querySelector('.crv-face')).toBeNull()
	})

	const ownCases = [
		'legacy.noDigest',
		'legacy.htmlMismatch',
		'legacy.defVersionMismatch',
		'legacy.renderDefAbsent',
		'legacy.digestUtf16',
		'legacy.partHeader',
		'legacy.partMemo',
		'legacyAll.htmlMismatch',
		'reader.noFace',
		'reader.cssMismatch',
		'reader.partHeader',
		'reader.partMemo',
		'pinnedMatching',
		'tombstoneWithFace',
	]
	it.each(
		ownCases,
	)("%s: 1.2.1's server HTML (which 1.3.0 serves byte for byte) hydrates as served, with no read, no hash and no mismatch", async (name) => {
		const c = (await serverCases(issuer))[name]
		const calls = refusingBrowser()
		const digest = vi.spyOn(globalThis.crypto.subtle, 'digest')
		const container = mountServerHtml(expand(SERVER, name))
		const served = container.innerHTML
		const { recoverable, consoleErrors } = await hydrate(container, card(c.props))
		expect(recoverable).toEqual([])
		expect(consoleErrors).toBe(0)
		expect(calls).toEqual([])
		expect(digest).not.toHaveBeenCalled()
		expect(container.innerHTML).toBe(served)
	})
})

describe("a client mount over the page's record", () => {
	it.each(
		DEF_NAMES,
	)('%s def: a seed whose face hashes to its digest paints the delivered face, with no read', async (defName) => {
		const calls = refusingBrowser()
		document.body.appendChild(recordElement(CLIENT.seedsWithFace[defName]))
		const container = await clientMount(card())
		expectDeliveredFace(container, CLIENT.seedsWithFace[defName])
		expect(calls).toEqual([])
	})

	it.each(DEF_NAMES)('%s def: the same seed in a browser that cannot hash paints 1.2.1 output', async (defName) => {
		refusingBrowser()
		brokenDigest()
		document.body.appendChild(recordElement(CLIENT.seedsWithFace[defName]))
		expect((await clientMount(card())).innerHTML).toBe(golden121(`seedWithFace.${defName}`))
	})

	it.each(
		DEF_NAMES,
	)('%s def: a seed whose face bytes do not hash to its digest paints the 1.2.1 face', async (defName) => {
		refusingBrowser()
		const raw = JSON.parse(CLIENT.seedsWithFace[defName]) as Record<string, unknown>
		const altered = JSON.stringify({
			...raw,
			face: { ...DELIVERED_FACE, html: DELIVERED_FACE.html.replace('Jane', 'Jana') },
		})
		document.body.appendChild(recordElement(altered))
		const container = await clientMount(card())
		expect(container.querySelector('.crv-face')).toBeNull()
		expect(chrome(container)?.getAttribute(SEED_ATTRIBUTE)).toBe(altered)
		expect(withoutSeed(container.innerHTML)).toBe(withoutSeed(golden121(`seedWithFace.${defName}`)))
	})

	it('a split banner block over a seed with a face paints its own part, as 1.2.1 does', async () => {
		refusingBrowser()
		document.body.appendChild(recordElement(CLIENT.seedsWithFace.legacy))
		const container = await clientMount(card({ part: 'header' }))
		expect(container.querySelector('.crv-face')).toBeNull()
		expect(chrome(container)?.getAttribute('data-certrev-face')).toBeNull()
		expect(container.textContent).toContain('Dr. Jane Doe')
	})
})

describe('a record streamed in while the page loads', () => {
	it.each(
		DEF_NAMES,
	)('%s def: the card waits, then paints the delivered face the streamed seed names, with no read', async (defName) => {
		const html = await serverHtml(matchingBody(issuer, DEFS[defName]))
		const calls = refusingBrowser()
		readyState = 'loading'
		const container = await clientMount(card())
		expect(container.innerHTML).toBe('')
		const part = document.createElement('div')
		part.hidden = true
		part.id = 'S:0'
		part.innerHTML = html
		document.body.appendChild(part)
		await settle()
		expectDeliveredFace(container, CLIENT.seedsWithFace[defName])
		expect(calls).toEqual([])
	})

	it.each(
		DEF_NAMES,
	)('%s def: in a browser that cannot hash, it paints 1.2.1 output for that record', async (defName) => {
		refusingBrowser()
		brokenDigest()
		readyState = 'loading'
		const container = await clientMount(card())
		expect(container.innerHTML).toBe('')
		document.body.appendChild(recordElement(CLIENT.seedsWithFace[defName]))
		await settle()
		expect(container.innerHTML).toBe(golden121(`streamedSeedWithFace.${defName}`))
	})
})

describe('clientRead: the browser reads, and paints as the server does', () => {
	it.each(DEF_NAMES)('%s def: a matching delivery paints the delivered face, its seed naming it', async (defName) => {
		const delivery = scriptedDelivery(() => json(matchingBody(issuer, DEFS[defName])))
		restore = setCardDeliveryRuntimeForTests({
			resolveKid: issuer.resolveKid,
			fetchImpl: () => delivery.fetch,
			now: () => T0,
		})
		const container = await clientMount(card({ clientRead: true }))
		expectDeliveredFace(container, CLIENT.seedsWithFace[defName])
		expect(delivery.calls).toHaveLength(1)
	})

	for (const defName of DEF_NAMES) {
		const bodies = ownFaceBodies(issuer, DEFS[defName])
		const cases: [string, Record<string, unknown>, Partial<CertReviewCardProps>][] = [
			['htmlMismatch', bodies.htmlMismatch, {}],
			['noFace', bodies.noFace, {}],
			['partHeader', matchingBody(issuer, DEFS[defName]), { part: 'header' }],
		]
		it.each(cases)(`${defName} def, %s: paints 1.2.1 output`, async (name, body, extra) => {
			const delivery = scriptedDelivery(() => json(body))
			restore = setCardDeliveryRuntimeForTests({
				resolveKid: issuer.resolveKid,
				fetchImpl: () => delivery.fetch,
				now: () => T0,
			})
			const container = await clientMount(card({ clientRead: true, ...extra }))
			expect(container.innerHTML).toBe(golden121(`clientRead.${defName}.${name}`))
			expect(delivery.calls).toHaveLength(1)
		})
	}
})
