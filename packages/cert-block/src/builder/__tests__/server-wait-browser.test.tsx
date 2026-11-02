// @vitest-environment jsdom
/**
 * 2.0.2 break-it B1: the 60 s failure memory is a server's only. In a browser (a `document`), the card's runtime cache
 * keeps 2.0.1's behaviour for a browser read (`clientRead`, which holds no page): a failed read is a negative entry for
 * 5 s, then read again.
 */
import { afterEach, expect, it } from 'vitest'
import { getVerifiedDelivery } from '../../verify/get-verified-delivery.js'
import { cardDeliveryRuntime, setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import { BASE, deliveryBody, ENTRY_ID, json, makeIssuer, scriptedDelivery, T0 } from './delivery-harness.js'

let restore = () => {}
afterEach(() => restore())

it('B1: in a browser the card cache retries a failed read after 5 s, as in 2.0.1, not after 60 s', async () => {
	const issuer = makeIssuer()
	let clock = T0
	let ok = false
	const delivery = scriptedDelivery(() => (ok ? json(deliveryBody(issuer.envelope())) : json({}, 503)))
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => delivery.fetch,
		now: () => clock,
	})
	const rt = cardDeliveryRuntime()
	const read = () =>
		getVerifiedDelivery({
			baseUrl: BASE,
			platform: 'builder',
			externalId: ENTRY_ID,
			context: { platform: 'builder', externalId: ENTRY_ID, now: new Date(clock) },
			cache: rt.cache,
			resolveKid: rt.resolveKid,
			fetchImpl: rt.fetchImpl(),
		})
	expect((await read()).verdict.decision).toBe('suppress')
	ok = true
	clock += 4_999
	expect((await read()).verdict.decision).toBe('suppress')
	expect(delivery.calls).toHaveLength(1)
	clock += 1
	expect((await read()).verdict.decision).toBe('render')
	expect(delivery.calls).toHaveLength(2)
})
