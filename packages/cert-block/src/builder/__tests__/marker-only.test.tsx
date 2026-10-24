/**
 * 2.0.1 and the portal's marker-only export (the lead's amendment item 8, relay a594d58b7d59): a marked block's options
 * are exactly `{ delivery: { v: 1, baseUrl } }` (plus `mode`/`part` when an editor set them), with none of the 19 claim
 * keys beside it. The block reads only the marker, the Builder entry and `mode`/`part`: it paints from the SIGNED
 * envelope (the 1.3.x faces when the binding names no contract, CertREV's card under contract 1) and needs no
 * `reviewerName` or `verifyUrl`; where it cannot, it prints nothing and beacons the reason.
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setCardBeaconForTests } from '../card-beacon.js'
import { CertReviewCard } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import { contractBody, contractFixture } from './contract-v1-shapes.js'
import {
	deliveryBody,
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
let reasons: string[]

beforeEach(() => {
	delivery = scriptedDelivery(() => json({ error: 'unset' }, 500))
	restoreRuntime = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => delivery.fetch,
		now: () => T0,
		timeoutMs: 500,
	})
	reasons = []
	restoreBeacon = setCardBeaconForTests({
		transport: (_url, body) => reasons.push(...JSON.parse(body).events.map((e: { reason: string }) => e.reason)),
	})
	warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
	restoreBeacon()
	restoreRuntime()
	warn.mockRestore()
})

/** The block exactly as the portal now writes it: the marker and nothing else, plus what Builder passes. */
const markerOnly = (extra: { part?: 'header' | 'memo' } = {}) => (
	<CertReviewCard delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} {...extra} />
)

it('a binding with no contract key: the 1.3.x face painted from the signed envelope and the def', async () => {
	delivery.respond(() => json(deliveryBody(issuer.envelope())))
	const html = await renderToHtml(markerOnly())
	expect(html).toContain('data-certrev-cert-chrome')
	// The reviewer comes from the SIGNED payload (makeMockPayload's expert), not from any option.
	const signedName = issuer.envelope().payload.content.expert.displayName
	expect(html).toContain(signedName)
	expect(reasons).toEqual([])
})

it('a contract-1 binding: CertREV’s card, from the marker alone', async () => {
	delivery.respond(() => json(contractBody(issuer, contractFixture('banner-elf-like'))))
	const html = await renderToHtml(markerOnly({ part: 'header' }))
	expect(html).toContain('<certrev-card data-certrev-part="top"')
	expect(reasons).toEqual([])
})

it('CertREV not reached: nothing, and a delivery_unreachable beacon (no options to fall back on, and none wanted)', async () => {
	delivery.respond(() => json({ error: 'down' }, 503))
	const html = await renderToHtml(markerOnly())
	expect(html).not.toContain('data-certrev-cert-chrome=""')
	expect(html).not.toContain('<certrev-card')
	expect(reasons).toEqual(['delivery_unreachable'])
})
