// @vitest-environment jsdom
/**
 * Server-render the delivery card, then hydrate it in a browser with a COLD cache (the browser
 * reads the Delivery API itself). The server HTML must hydrate with no mismatch and no
 * client-side re-render, a revocation the browser learns about must blank the card, and the phone
 * memo toggle the server HTML carries must work once hydrated.
 */

import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CertReviewCard } from '../cert-review-card.js'
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

const card = () => <CertReviewCard delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} />

async function settle() {
	for (let i = 0; i < 20; i++) {
		await act(async () => {
			await new Promise((r) => setTimeout(r, 5))
		})
	}
}

it('hydrates the server face with no mismatch', async () => {
	const server = scriptedDelivery(() => json(deliveryBody(issuer.envelope())))
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => server.fetch,
		now: () => T0,
	})
	const html = await renderToHtml(card())
	restore()

	// The browser: a fresh runtime, so a cold cache and its own read.
	const browser = scriptedDelivery(() => json(deliveryBody(issuer.envelope())))
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

	const recoverable: unknown[] = []
	const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
	try {
		await act(async () => {
			hydrateRoot(container, card(), { onRecoverableError: (e) => recoverable.push(e) })
		})
		await settle()
	} finally {
		consoleError.mockRestore()
	}
	expect(recoverable).toEqual([])
	expect(consoleError).not.toHaveBeenCalled()
	expect(browser.calls).toHaveLength(1)
	// Hydrated in place: the same node, the same markup.
	expect(container.querySelector('[data-certrev-cert-chrome]')).toBe(chromeNode)
	expect(container.innerHTML).toBe(serverDom)
})

it('a revocation the browser reads blanks a server-rendered card', async () => {
	const server = scriptedDelivery(() => json(deliveryBody(issuer.envelope())))
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => server.fetch,
		now: () => T0,
	})
	const html = await renderToHtml(card())
	restore()

	const tombstone = await issuer.tombstone()
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
	expect(container.querySelector('[data-certrev-cert-chrome]')).toBeNull()
	expect(container.textContent).not.toContain('Dr. Jane Doe')
})

it('the phone memo toggle works on the hydrated card, is a native button (so Enter and Space reach it), and unbinds on unmount', async () => {
	// A memo long enough to collapse on a phone (over 160 characters).
	const memo =
		'I reviewed the retinol claims against current dermatology guidance; the concentrations, the usage cadence and the sun-protection advice are accurate and safely framed.'
	const envelope = () => issuer.envelope({ content: { ...builderPayload().content, memo } })
	const server = scriptedDelivery(() => json(deliveryBody(envelope())))
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => server.fetch,
		now: () => T0,
	})
	const html = await renderToHtml(card())
	restore()
	// The server face is the collapsed one: the toggle ships in the HTML, before any script runs.
	expect(html).toContain('data-certrev-memo="collapsed"')
	expect(html).toContain('aria-expanded="false"')

	const browser = scriptedDelivery(() => json(deliveryBody(envelope())))
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => browser.fetch,
		now: () => T0,
	})
	const container = document.createElement('div')
	container.innerHTML = html
	document.body.appendChild(container)
	const recoverable: unknown[] = []
	let root: ReturnType<typeof hydrateRoot> | undefined
	const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
	try {
		await act(async () => {
			root = hydrateRoot(container, card(), { onRecoverableError: (e) => recoverable.push(e) })
		})
		await settle()
	} finally {
		consoleError.mockRestore()
	}
	expect(recoverable).toEqual([])
	expect(consoleError).not.toHaveBeenCalled()

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
