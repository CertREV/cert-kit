/**
 * 2.0.1: forward compatibility, so the one install e.l.f. makes keeps working while CertREV's server moves on.
 *
 * The lead's rule (relay 86172b679cee, ADR 0001 §4): documents stay `contract: 1`; a minor change is additive keys
 * under contract 1 (a new part, a new field, a new key in a known object, a new key in the signed binding), which
 * clients ignore; a change a 2.x client would misread is contract 2, which the server only sends to clients that
 * advertise it while it keeps writing the older versions. So: every additive change prints the card exactly as before
 * (the digest still covers the whole document as served); a newer major prints nothing, reports
 * `card_unsupported_contract` and beacons `unsupported`; the rest of the page renders either way.
 */

import { canonicalizeJson } from '@certrev/cert-contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCardBeaconForTests } from '../card-beacon.js'
import type { CardDocumentV1 } from '../card-contract.js'
import { CertReviewCard } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import {
	type ContractFixture,
	contractBinding,
	contractBody,
	contractFixture,
	expectedCardHtml,
} from './contract-v1-shapes.js'
import { sha256Hex } from './delivered-face-shapes.js'
import {
	ENTRY_ID,
	json,
	MARKER,
	makeIssuer,
	renderToHtml,
	type ScriptedDelivery,
	scriptedDelivery,
	T0,
} from './delivery-harness.js'

const issuer = makeIssuer()
let delivery: ScriptedDelivery
let restoreRuntime: () => void
let restoreBeacon: () => void
let warn: ReturnType<typeof vi.spyOn>
let beacons: { url: string; body: { events: { reason: string; outcome: string }[] } }[]

beforeEach(() => {
	delivery = scriptedDelivery(() => json({ error: 'unset' }, 500))
	restoreRuntime = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => delivery.fetch,
		now: () => T0,
		timeoutMs: 500,
	})
	beacons = []
	restoreBeacon = setCardBeaconForTests({ transport: (url, body) => beacons.push({ url, body: JSON.parse(body) }) })
	warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
	restoreBeacon()
	restoreRuntime()
	warn.mockRestore()
})

/** An article page: copy, the block, more copy. */
const page = () => (
	<article>
		<p>Before the card.</p>
		<CertReviewCard delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} />
		<p>After the card.</p>
	</article>
)

/** A fixture whose card is `card`, re-digested (the server signs what it serves). */
function served(fixture: ContractFixture, card: unknown): Record<string, unknown> {
	const doc = sha256Hex(canonicalizeJson(card))
	return contractBody(
		issuer,
		{ ...fixture, card: card as CardDocumentV1, doc },
		{ card, faceDigest: contractBinding(fixture, { doc }) },
	)
}

async function serve(body: unknown): Promise<string> {
	delivery.respond(() => json(body))
	return renderToHtml(page())
}

describe('additive changes under contract 1 print the card exactly as before', () => {
	const fixture = contractFixture('banner-elf-like')

	it.each<[string, (card: Record<string, unknown>) => Record<string, unknown>]>([
		[
			'an unknown part',
			(card) => ({
				...card,
				parts: { ...(card.parts as object), sidenote: '<certrev-card data-certrev-part="sidenote"></certrev-card>' },
			}),
		],
		['an unknown top-level field', (card) => ({ ...card, experiments: { foldVariant: 'b' }, analytics: [1, 2, 3] })],
		[
			'a new key in a known object (placement, assets, dialogs, lifecycle)',
			(card) => ({
				...card,
				placement: { ...(card.placement as object), top: { anchor: 'after-byline', offset: 1 } },
				assets: {
					...(card.assets as object),
					fonts: { href: 'https://assets.certrev.com/f.css', integrity: 'sha384-x' },
				},
				dialogs: {
					...(card.dialogs as object),
					share: '<certrev-card data-certrev-part="dialog-share"></certrev-card>',
				},
				lifecycle: { ...(card.lifecycle as object), reviewDue: '2027-01-01' },
			}),
		],
	])('%s', async (_label, change) => {
		const card = change(structuredClone(fixture.card) as unknown as Record<string, unknown>)
		const html = await serve(served(fixture, card))
		// The known parts, head and dialogs print verbatim; nothing unknown is printed; the page around it renders.
		const known = { ...fixture.card, ...(card as object) } as CardDocumentV1
		expect(html).toContain(expectedCardHtml(known, ['top', 'bottom']))
		expect(html).not.toContain('data-certrev-part="sidenote"')
		expect(html).not.toContain('data-certrev-part="dialog-share"')
		expect(html).toContain('Before the card.')
		expect(html).toContain('After the card.')
		expect(warn).not.toHaveBeenCalled()
		expect(beacons).toEqual([])
	})

	it('a new key in the signed binding (a feature flag the server adds under contract 1)', async () => {
		const body = contractBody(issuer, fixture, {
			faceDigest: contractBinding(fixture, { features: ['fold-v2'], minor: 3 }),
		})
		const html = await serve(body)
		expect(html).toContain(expectedCardHtml(fixture.card, ['top', 'bottom']))
		expect(warn).not.toHaveBeenCalled()
	})
})

describe('a newer major prints nothing, reports it and beacons it; the page renders', () => {
	const fixture = contractFixture('sidebar-elf-like')

	it.each([
		2,
		3,
		'2',
	])('the signed binding names contract %s: card_unsupported_contract, outcome unsupported', async (contract) => {
		const html = await serve(contractBody(issuer, fixture, { faceDigest: contractBinding(fixture, { contract }) }))
		expect(html).not.toContain('<certrev-card')
		expect(html).toContain('Before the card.')
		expect(html).toContain('After the card.')
		expect(String(warn.mock.calls[0]?.[0])).toContain('"reason":"card_unsupported_contract"')
		expect(beacons.map((b) => b.body.events[0])).toEqual([
			{ kind: 'fallback', reason: 'card_unsupported_contract', outcome: 'unsupported' },
		])
		expect(beacons[0]?.url).toBe(`${MARKER.baseUrl}/api/cert/v1/beacon`)
	})

	it('a document that says contract 2 under a contract-1 binding: nothing, card_verify_failed', async () => {
		const html = await serve(served(fixture, { ...fixture.card, contract: 2 }))
		expect(html).not.toContain('<certrev-card')
		expect(html).toContain('After the card.')
		expect(beacons.map((b) => b.body.events[0]?.reason)).toEqual(['card_verify_failed'])
	})
})
