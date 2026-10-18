// @vitest-environment jsdom
/**
 * The reader face on the delivery card, server-rendered and then hydrated with a COLD cache: the server HTML (wrapper
 * with its envelope seed, the one inline <style>, the reader markup, and after the wrapper the Builder sidebar flow
 * rules' <style>) must hydrate in place with no mismatch and no client re-render, exactly as the legacy face does
 * (`delivery-card-hydrate.test.tsx`). Since 1.2.0 the browser paints
 * from the seed and makes NO read of its own (so `browser.calls` is empty where canary.5 counted one), and what blanks a
 * hydrated reader card is the seed's own lifecycle at the browser's clock, stylesheet and all.
 */

import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CARD_READER_CSS } from '../card-reader-css.js'
import { BUILDER_SIDEBAR_FLOW_CSS, CertReviewCard } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import {
	builderPayload,
	deliveryBody,
	ENTRY_ID,
	json,
	MARKER,
	makeIssuer,
	renderToHtml,
	scriptedDelivery,
	T0,
} from './delivery-harness.js'
import { RAW_DEFS } from './legacy-face-cases.js'

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

const card = (mode?: 'banner' | 'sidebar' | 'floating') => (
	<CertReviewCard delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} mode={mode} />
)

async function settle() {
	for (let i = 0; i < 20; i++) {
		await act(async () => {
			await new Promise((r) => setTimeout(r, 5))
		})
	}
}

async function serverHtml(
	def: unknown,
	mode?: 'banner' | 'sidebar' | 'floating',
	answer: () => Response | Promise<Response> = () => json(deliveryBody(issuer.envelope(), def)),
) {
	const server = scriptedDelivery(answer)
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => server.fetch,
		now: () => T0,
	})
	const html = await renderToHtml(card(mode))
	restore()
	return html
}

it.each([
	['banner (the def layout)', undefined],
	['banner (the editor)', 'banner'],
	['sidebar', 'sidebar'],
	['floating', 'floating'],
] as const)('hydrates the server reader face, %s, with no mismatch', async (_label, mode) => {
	const html = await serverHtml(RAW_DEFS['face-reader'], mode)
	expect(html).toContain('data-certrev-reader-css')

	const browser = scriptedDelivery(() => json(deliveryBody(issuer.envelope(), RAW_DEFS['face-reader'])))
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => browser.fetch,
		now: () => T0,
	})
	const container = document.createElement('div')
	container.innerHTML = html
	document.body.appendChild(container)
	const serverDom = container.innerHTML
	const chromeNode = container.querySelector('[data-certrev-cert-chrome]')
	expect(chromeNode).not.toBeNull()
	expect(container.querySelectorAll('style')).toHaveLength(2)
	expect(chromeNode?.querySelector(':scope > style[data-certrev-reader-css]')?.textContent).toBe(CARD_READER_CSS)
	const flowNode = chromeNode?.nextElementSibling
	expect(flowNode?.matches('style[data-certrev-builder-flow]')).toBe(true)
	expect(flowNode?.textContent).toBe(BUILDER_SIDEBAR_FLOW_CSS)

	const recoverable: unknown[] = []
	// React reports a dev-mode hydration mismatch (including a differing dangerouslySetInnerHTML) through console.error.
	// Collect the calls ourselves: a restored spy forgets them.
	const consoleErrors: unknown[][] = []
	const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
		consoleErrors.push(args)
	})
	try {
		await act(async () => {
			hydrateRoot(container, card(mode), { onRecoverableError: (e) => recoverable.push(e) })
		})
		await settle()
	} finally {
		consoleError.mockRestore()
	}
	expect(recoverable).toEqual([])
	expect(consoleErrors).toEqual([])
	// 1.2.0: the browser paints from the seed in the server HTML and reads nothing (canary.5 read once here).
	expect(browser.calls).toHaveLength(0)
	// Hydrated in place: the same nodes, the same markup, still one reader stylesheet and one set of flow rules.
	expect(container.querySelector('[data-certrev-cert-chrome]')).toBe(chromeNode)
	expect(container.querySelector('style[data-certrev-builder-flow]')).toBe(flowNode)
	expect(container.querySelectorAll('style')).toHaveLength(2)
	expect(container.innerHTML).toBe(serverDom)
})

it('a seed that has expired by the browser clock blanks a server-rendered reader card, stylesheet and all', async () => {
	const html = await serverHtml(RAW_DEFS['face-reader'])
	expect(html).toContain('data-certrev-reader-css')

	// The browser's clock is past the envelope's expiry; it re-runs the lifecycle policy on the seed, it reads nothing.
	const expiresAt = Date.parse(builderPayload().lifecycle.expiresAt as string)
	expect(Number.isFinite(expiresAt)).toBe(true)
	const browser = scriptedDelivery(() => json(deliveryBody(issuer.envelope(), RAW_DEFS['face-reader'])))
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => browser.fetch,
		now: () => expiresAt + 60_000,
	})
	const container = document.createElement('div')
	container.innerHTML = html
	document.body.appendChild(container)
	expect(container.querySelector('.certrev-reader')).not.toBeNull()
	expect(container.querySelectorAll('style')).toHaveLength(2)
	const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
	try {
		await act(async () => {
			hydrateRoot(container, card(), { onRecoverableError: () => {} })
		})
		await settle()
	} finally {
		consoleError.mockRestore()
	}
	expect(browser.calls).toHaveLength(0)
	expect(container.querySelector('[data-certrev-cert-chrome]')).toBeNull()
	expect(container.textContent).not.toContain('Dr. Jane Doe')
	expect(container.querySelector('.certrev-reader')).toBeNull()
	expect(container.querySelector('style')).toBeNull()
})

it('a revoked envelope is never painted by the server, so there is no reader card to hydrate and no read from the browser', async () => {
	const tombstone = await issuer.tombstone()
	const html = await serverHtml(RAW_DEFS['face-reader'], undefined, () => json(tombstone))
	expect(html).not.toContain('data-certrev-cert-chrome')
	const browser = scriptedDelivery(() => json(tombstone))
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => browser.fetch,
		now: () => T0,
	})
	const container = document.createElement('div')
	container.innerHTML = html
	document.body.appendChild(container)
	const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
	try {
		await act(async () => {
			hydrateRoot(container, card(), { onRecoverableError: () => {} })
		})
		await settle()
	} finally {
		consoleError.mockRestore()
	}
	expect(browser.calls).toHaveLength(0)
	expect(container.querySelector('[data-certrev-cert-chrome]')).toBeNull()
	expect(container.querySelector('.certrev-reader')).toBeNull()
})
