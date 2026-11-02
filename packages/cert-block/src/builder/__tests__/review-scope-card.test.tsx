// @vitest-environment jsdom
/**
 * 2.1.0: the registered Builder card prints the scope line the SIGNED `content.expert.reviewScope` picks, on the server
 * render, after hydration, and on a client mount that reads CertREV itself (`clientRead`), on both envelope faces (the
 * legacy face and the reader face). Absent and `'text_and_sources'` print the full line, as 2.0.2 did; `'text'` prints
 * the text-only line and never the full one. The envelope is signed by a fixture issuer and verified by the card's own
 * kernel, so the scope reaches the face only through a payload that verified.
 */

import { act, type ReactElement } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CERT_SCOPE_LINE, CERT_SCOPE_LINE_TEXT_ONLY } from '../../components/render-def.js'
import type { CertPayload } from '../../contract/kernel.js'
import { CertReviewCard } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import {
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

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let restore: () => void = () => {}
let issuer: ReturnType<typeof makeIssuer>
let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
	issuer = makeIssuer()
	warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
	restore()
	warn.mockRestore()
	document.body.innerHTML = ''
})

const card = (clientRead?: boolean): ReactElement => (
	<CertReviewCard delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} clientRead={clientRead} />
)

/** The Builder payload with `expert.reviewScope` (left out for `undefined`). */
function scoped(reviewScope: string | undefined): CertPayload {
	const base = builderPayload()
	const expert = { ...base.content.expert, ...(reviewScope === undefined ? {} : { reviewScope }) }
	return { ...base, content: { ...base.content, expert } as CertPayload['content'] }
}

async function settle() {
	for (let i = 0; i < 20; i++) {
		await act(async () => {
			await new Promise((r) => setTimeout(r, 5))
		})
	}
}

/** The runtime reads the Delivery API with `answer` (a server render, or a browser page that may read). */
function runtime(answer: () => Response) {
	const delivery = scriptedDelivery(answer)
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => delivery.fetch,
		now: () => T0,
	})
	return delivery
}

const DEFS = [
	['the legacy face', { ...ELF_LIKE_DEF, hidden: [] }],
	['the reader face', { ...ELF_LIKE_DEF, hidden: [], face: 'reader', layout: 'sidebar' }],
] as const

const CASES = [
	['absent', undefined, CERT_SCOPE_LINE, CERT_SCOPE_LINE_TEXT_ONLY],
	["'text_and_sources'", 'text_and_sources', CERT_SCOPE_LINE, CERT_SCOPE_LINE_TEXT_ONLY],
	["'text'", 'text', CERT_SCOPE_LINE_TEXT_ONLY, CERT_SCOPE_LINE],
] as const

describe.each(DEFS)('%s', (_face, def) => {
	it.each(
		CASES,
	)('%s: the server render prints the line, and hydration keeps it with no mismatch', async (_c, scope, line, other) => {
		const body = deliveryBody(issuer.signPayload(scoped(scope)), def)
		runtime(() => json(body))
		const html = await renderToHtml(card())
		restore()
		expect(html).toContain('data-certrev-cert-chrome')
		expect(html).toContain(line)
		expect(html).not.toContain(other)

		// The browser refuses every read (a storefront CSP): it paints from the seed the server HTML carries.
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
		const container = document.createElement('div')
		container.innerHTML = html
		document.body.appendChild(container)
		const serverDom = container.innerHTML
		const recoverable: unknown[] = []
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			await act(async () => {
				hydrateRoot(container, card(), { onRecoverableError: (e) => recoverable.push(e) })
			})
			await settle()
			expect(consoleError).not.toHaveBeenCalled()
		} finally {
			consoleError.mockRestore()
		}
		expect(recoverable).toEqual([])
		expect(calls).toEqual([])
		expect(container.innerHTML).toBe(serverDom)
		expect(container.textContent).toContain(line)
		expect(container.textContent).not.toContain(other)
	})

	it.each(
		CASES,
	)('%s: a client mount that reads CertREV itself prints the same line', async (_c, scope, line, other) => {
		const body = deliveryBody(issuer.signPayload(scoped(scope)), def)
		const delivery = runtime(() => json(body))
		const container = document.createElement('div')
		document.body.appendChild(container)
		await act(async () => {
			createRoot(container).render(card(true))
		})
		await settle()
		expect(delivery.calls.length).toBe(1)
		expect(container.querySelector('[data-certrev-cert-chrome]')).not.toBeNull()
		expect(container.innerHTML).toContain(line)
		expect(container.innerHTML).not.toContain(other)
	})
})
