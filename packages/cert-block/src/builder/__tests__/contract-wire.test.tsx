/**
 * 2.0.0 on the real wire: one Builder Delivery 200 exactly as CertREV's portal answers it for a placement that signs the
 * card binding (`__fixtures__/contract-v1/wire-builder-delivery.json`: the route on its integration database, the envelope
 * minted as the Builder placer mints it and signed by a test key whose public half is in the fixture; see its `source`).
 * The response's bytes are served unchanged; the block prints the card the response carries, byte for byte.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { type CardDocumentV1, cardPartsFor } from '../card-contract.js'
import { CertReviewCard } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import { parseSeed, SEED_ATTRIBUTE } from '../ssr-seed.js'
import { expectedCardHtml } from './contract-v1-shapes.js'
import { MARKER, renderToHtml, T0 } from './delivery-harness.js'

interface Wire {
	readonly externalId: string
	readonly kid: string
	readonly publicKeyPem: string
	readonly body: string
}

const wire = JSON.parse(
	readFileSync(
		join(process.cwd(), 'src/builder/__tests__/__fixtures__/contract-v1/wire-builder-delivery.json'),
		'utf8',
	),
) as Wire
const served = JSON.parse(wire.body) as {
	card: CardDocumentV1
	payload: { content: { faceDigest: Record<string, unknown> } }
}

let restore: () => void
let warn: ReturnType<typeof vi.spyOn>
const calls: string[] = []
beforeEach(() => {
	calls.length = 0
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: (kid) => (kid === wire.kid ? { format: 'pem', pem: wire.publicKeyPem } : null),
		fetchImpl: () =>
			(async (input: RequestInfo | URL) => {
				calls.push(String(input))
				return new Response(wire.body, { headers: { 'content-type': 'application/json' } })
			}) as typeof fetch,
		now: () => T0,
	})
	warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
	restore()
	warn.mockRestore()
})

it('the portal’s own response: a contract-1 binding, and the block prints its card verbatim', async () => {
	expect(Object.keys(JSON.parse(wire.body))).toEqual(['payload', 'signature', 'renderDef', 'face', 'card'])
	expect(served.payload.content.faceDigest).toMatchObject({ v: 1, contract: 1 })
	const html = await renderToHtml(
		<CertReviewCard delivery={MARKER} builderContext={{ content: { id: wire.externalId } }} />,
	)
	expect(calls).toEqual([`${MARKER.baseUrl}/api/cert/v1/delivery/builder/${wire.externalId}`])
	const names = cardPartsFor(served.card, undefined)
	expect(names).toEqual(['top', 'bottom'])
	const start = html.indexOf('>', html.indexOf('<div data-certrev-cert-chrome')) + 1
	const end = html.lastIndexOf('</div><!--/$-->')
	expect(html.slice(start, end)).toBe(expectedCardHtml(served.card, names))
	const raw = new RegExp(`${SEED_ATTRIBUTE}="([^"]*)"`).exec(html)?.[1] ?? ''
	const seed = parseSeed(
		raw
			.replace(/&quot;/g, '"')
			.replace(/&#x27;/g, "'")
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&amp;/g, '&'),
	)
	expect(seed?.card).toEqual(served.card)
	expect(warn).not.toHaveBeenCalled()
})

it('the same response for another Builder entry prints nothing (the card names its own entry)', async () => {
	const html = await renderToHtml(
		<CertReviewCard delivery={MARKER} builderContext={{ content: { id: 'entry-other' } }} />,
	)
	expect(html).not.toContain('<certrev-card')
})
