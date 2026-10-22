/**
 * 2.0.0 on the real wire: one Builder Delivery 200 exactly as CertREV's portal answers it for a placement that signs the
 * card binding (`__fixtures__/contract-v1/wire-builder-delivery.json`: the route on its integration database, the envelope
 * minted by the real Builder placer for a brand holding the grant and signed by a test key whose public half is in the
 * fixture; see its `source`), and the portal's published key set as its own code signs it (`wire-keyset.json`). The
 * response's bytes are served unchanged; the block prints the card the response carries, byte for byte, also after a
 * key rotation, through the portal's set.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KEY_SET_PATH, verifyKeySet } from '../../verify/key-set.js'
import { type CardDocumentV1, cardPartsFor } from '../card-contract.js'
import { CertReviewCard } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import { CERT_ISSUER_KID, CERT_ISSUER_PUBLIC_KEY_PEM } from '../issuer-key.js'
import { parseSeed, SEED_ATTRIBUTE } from '../ssr-seed.js'
import { expectedCardHtml } from './contract-v1-shapes.js'
import { MARKER, renderToHtml, T0 } from './delivery-harness.js'

interface Wire {
	readonly externalId: string
	readonly kid: string
	readonly publicKeyPem: string
	readonly body: string
}

const fixture = (name: string) =>
	readFileSync(join(process.cwd(), 'src/builder/__tests__/__fixtures__/contract-v1', name), 'utf8')
const wire = JSON.parse(fixture('wire-builder-delivery.json')) as Wire

interface WireKeySet {
	readonly body: { keyset: { keys: { kid: string; x: string }[] }; signature: { kid: string } }
	readonly rootKid: string
	readonly rootPublicKeyPem: string
	readonly rotatedKid: string
	readonly rotatedDeliveryBody: string
	readonly trustedKeySet: { keys: { kid: string; crv: string; x: string }[] }
	readonly trustedRootPem: string
}
const keySet = JSON.parse(fixture('wire-keyset.json')) as WireKeySet
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

describe('the portal’s published key set, as its own code signs it', () => {
	const rootOnly = (kid: string) =>
		kid === keySet.rootKid ? { format: 'pem' as const, pem: keySet.rootPublicKeyPem } : null

	it('verifies under the baked root and publishes the rotated key', async () => {
		expect(keySet.body.signature.kid).toBe('cert-issuer-1')
		const accepted = await verifyKeySet(keySet.body, rootOnly)
		expect([...(accepted?.keys.keys() ?? [])]).toEqual(['cert-issuer-1', 'cert-issuer-2'])
	})

	it('after a rotation the portal’s envelope, signed by a kid only the set publishes, prints its card verbatim', async () => {
		const rotated = JSON.parse(keySet.rotatedDeliveryBody) as { signature: { kid: string }; card: CardDocumentV1 }
		expect(rotated.signature.kid).toBe(keySet.rotatedKid)
		const seen: string[] = []
		restore()
		restore = setCardDeliveryRuntimeForTests({
			resolveKid: rootOnly,
			fetchImpl: () =>
				(async (input: RequestInfo | URL) => {
					seen.push(String(input))
					const body = String(input).endsWith(KEY_SET_PATH) ? JSON.stringify(keySet.body) : keySet.rotatedDeliveryBody
					return new Response(body, { headers: { 'content-type': 'application/json' } })
				}) as typeof fetch,
			now: () => T0,
		})
		const html = await renderToHtml(
			<CertReviewCard delivery={MARKER} builderContext={{ content: { id: wire.externalId } }} />,
		)
		expect(seen).toEqual([
			`${MARKER.baseUrl}/api/cert/v1/delivery/builder/${wire.externalId}`,
			`${MARKER.baseUrl}${KEY_SET_PATH}`,
		])
		const start = html.indexOf('>', html.indexOf('<div data-certrev-cert-chrome')) + 1
		const end = html.lastIndexOf('</div><!--/$-->')
		expect(html.slice(start, end)).toBe(expectedCardHtml(rotated.card, cardPartsFor(rotated.card, undefined)))
		expect(warn).not.toHaveBeenCalled()
	})

	it('the package’s baked root is the portal’s trusted cert-issuer-1, the key that signs the production set', () => {
		const body = (pem: string) => pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '')
		expect(CERT_ISSUER_KID).toBe('cert-issuer-1')
		expect(body(CERT_ISSUER_PUBLIC_KEY_PEM)).toBe(body(keySet.trustedRootPem))
		const raw = Buffer.from(body(CERT_ISSUER_PUBLIC_KEY_PEM), 'base64').subarray(12).toString('base64url')
		expect(keySet.trustedKeySet.keys.find((key) => key.kid === CERT_ISSUER_KID)).toEqual({
			kid: CERT_ISSUER_KID,
			crv: 'Ed25519',
			x: raw,
		})
	})
})
