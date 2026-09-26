/**
 * `getVerifiedDelivery`: the Delivery read that keeps the render-def sibling. The card tests
 * drive it through React; these pin its own contract (what is cached, what is re-judged per
 * call, how the def is shape-checked, and that every failure is a suppress, never a throw).
 */

import { describe, expect, it } from 'vitest'
import {
	builderSubject,
	DELIVERY_URL,
	deliveryBody,
	ELF_LIKE_DEF,
	ENTRY_ID,
	json,
	makeIssuer,
	scriptedDelivery,
	T0,
} from '../../builder/__tests__/delivery-harness.js'
import { TtlCache } from '../cache.js'
import {
	type CachedDelivery,
	deliveryCacheKey,
	deliveryUrl,
	getVerifiedDelivery,
	invalidateDelivery,
	parseRenderDef,
	peekVerifiedDelivery,
	settleDelivery,
} from '../get-verified-delivery.js'

const BASE = 'https://staging.portal.certrev.com'

function setup(first?: () => Response | Promise<Response>) {
	const issuer = makeIssuer()
	let clock = T0
	const delivery = scriptedDelivery(first ?? (() => json(deliveryBody(issuer.envelope()))))
	const cache = new TtlCache<CachedDelivery>({ ttlMs: 60_000, negativeTtlMs: 5_000, now: () => clock })
	const opts = () => ({
		baseUrl: BASE,
		platform: 'builder',
		externalId: ENTRY_ID,
		resolveKid: issuer.resolveKid,
		context: { platform: 'builder', externalId: ENTRY_ID, now: new Date(clock) },
		fetchImpl: delivery.fetch,
		cache,
		timeoutMs: 100,
	})
	return {
		issuer,
		delivery,
		cache,
		opts,
		advance(ms: number) {
			clock += ms
		},
	}
}

describe('deliveryUrl / deliveryCacheKey', () => {
	it('builds the Delivery route and encodes the id', () => {
		expect(deliveryUrl(`${BASE}/`, 'builder', ENTRY_ID)).toBe(DELIVERY_URL)
		expect(deliveryUrl(BASE, 'builder', 'a/b?c')).toBe(`${BASE}/api/cert/v1/delivery/builder/a%2Fb%3Fc`)
	})

	it('keys by origin and by the rendering placement', () => {
		const ctx = { platform: 'builder', externalId: ENTRY_ID }
		const a = deliveryCacheKey({ baseUrl: BASE, platform: 'builder', externalId: ENTRY_ID, context: ctx })
		const b = deliveryCacheKey({
			baseUrl: 'https://portal.certrev.com',
			platform: 'builder',
			externalId: ENTRY_ID,
			context: ctx,
		})
		const c = deliveryCacheKey({
			baseUrl: BASE,
			platform: 'builder',
			externalId: ENTRY_ID,
			context: { platform: 'builder', externalId: 'other' },
		})
		expect(new Set([a, b, c]).size).toBe(3)
	})
})

describe('parseRenderDef', () => {
	it('keeps the metafield shape, and only the six known string tokens', () => {
		expect(
			parseRenderDef({
				...ELF_LIKE_DEF,
				tokens: { accentColor: '#000000', surface: '#fff', bogus: 'x', inkColor: 7 },
				barInkFg: '#ffffff',
				layout: 'custom',
				customFace: { placedFields: ['memo', 'scopeLine'] },
				extra: 'ignored',
			}),
		).toEqual({
			v: 4,
			preset: 'memo',
			rung: 'standard',
			tokens: { accentColor: '#000000', surface: '#fff' },
			barInkFg: '#ffffff',
			hidden: ['reviewerPhoto'],
			layout: 'custom',
			customFace: { placedFields: ['memo', 'scopeLine'] },
		})
	})

	it('drops a barInkFg that is not one of the two inks', () => {
		expect(parseRenderDef({ ...ELF_LIKE_DEF, barInkFg: 'red' })).not.toHaveProperty('barInkFg')
	})

	it.each([
		['null', null],
		['an array', [ELF_LIKE_DEF]],
		['a string v', { ...ELF_LIKE_DEF, v: '4' }],
		['a non-finite v', { ...ELF_LIKE_DEF, v: Number.NaN }],
		['no preset', { ...ELF_LIKE_DEF, preset: undefined }],
		['no rung', { ...ELF_LIKE_DEF, rung: 1 }],
		['tokens not an object', { ...ELF_LIKE_DEF, tokens: '#000' }],
		['hidden a string', { ...ELF_LIKE_DEF, hidden: 'reviewerPhoto' }],
		['hidden with a non-string', { ...ELF_LIKE_DEF, hidden: ['reviewerPhoto', 1] }],
		['a non-string layout', { ...ELF_LIKE_DEF, layout: 3 }],
		['a malformed customFace', { ...ELF_LIKE_DEF, customFace: { placedFields: 'memo' } }],
	])('is null for %s', (_label, value) => {
		expect(parseRenderDef(value)).toBeNull()
	})
})

describe('getVerifiedDelivery', () => {
	it('verifies the envelope and returns the def beside it', async () => {
		const t = setup()
		const got = await getVerifiedDelivery(t.opts())
		expect(got.verdict.decision).toBe('render')
		expect(got.renderDef).toEqual(ELF_LIKE_DEF)
		expect(t.delivery.calls).toEqual([DELIVERY_URL])
	})

	it('caches the verified PAYLOAD and re-judges expiry on every call', async () => {
		const t = setup()
		const payload = t.issuer.envelope().payload
		const expiresAt = new Date(T0 + 10_000).toISOString()
		t.delivery.respond(() => json(deliveryBody(t.issuer.envelope({ lifecycle: { ...payload.lifecycle, expiresAt } }))))
		expect((await getVerifiedDelivery(t.opts())).verdict.decision).toBe('render')
		t.advance(10_000)
		const later = await getVerifiedDelivery(t.opts())
		expect(later.verdict).toEqual({ decision: 'suppress', reason: 'expired' })
		expect(later.renderDef).toBeNull()
		expect(t.delivery.calls).toHaveLength(1)
	})

	it('a tombstone suppresses as revoked and carries no def', async () => {
		const t = setup()
		const tombstone = await t.issuer.tombstone()
		t.delivery.respond(() => json({ ...tombstone }))
		expect(await getVerifiedDelivery(t.opts())).toEqual({
			verdict: { decision: 'suppress', reason: 'revoked' },
			renderDef: null,
		})
	})

	it('a tombstone for another entry does not verify as this one', async () => {
		const t = setup()
		const tombstone = await t.issuer.tombstone(builderSubject('another-entry'))
		t.delivery.respond(() => json(tombstone))
		const got = await getVerifiedDelivery(t.opts())
		expect(got.verdict.decision).toBe('suppress')
	})

	it.each([
		['404', 'subject_mismatch', () => json({}, 404)],
		['410', 'subject_mismatch', () => json({}, 410)],
		['500', 'unsupported_contract_version', () => json({}, 500)],
		['non-JSON', 'unsupported_contract_version', () => new Response('nope')],
		['a JSON array', 'unsupported_contract_version', () => json([])],
		['a network error', 'unsupported_contract_version', () => Promise.reject(new TypeError('fetch failed'))],
		['the deadline', 'unsupported_contract_version', () => new Promise<Response>(() => {})],
	])('%s suppresses (%s) without throwing', async (_label, reason, answer) => {
		const t = setup(answer as () => Response | Promise<Response>)
		expect(await getVerifiedDelivery(t.opts())).toEqual({ verdict: { decision: 'suppress', reason }, renderDef: null })
	})

	it('a key the resolver does not know suppresses', async () => {
		const t = setup()
		t.delivery.respond(() => json(deliveryBody(makeIssuer('stranger').envelope())))
		expect((await getVerifiedDelivery(t.opts())).verdict.decision).toBe('suppress')
	})

	it('a suppressed read is cached only for the negative TTL', async () => {
		const t = setup(() => json({}, 500))
		await getVerifiedDelivery(t.opts())
		t.delivery.respond(() => json(deliveryBody(t.issuer.envelope())))
		t.advance(4_000)
		expect((await getVerifiedDelivery(t.opts())).verdict.decision).toBe('suppress')
		t.advance(1_001)
		expect((await getVerifiedDelivery(t.opts())).verdict.decision).toBe('render')
		expect(t.delivery.calls).toHaveLength(2)
	})

	it('peek never fetches; invalidate forces the next read', async () => {
		const t = setup()
		expect(peekVerifiedDelivery(t.opts())).toBeUndefined()
		expect(t.delivery.calls).toHaveLength(0)
		await getVerifiedDelivery(t.opts())
		expect(peekVerifiedDelivery(t.opts())?.verdict.decision).toBe('render')
		invalidateDelivery(t.opts(), t.cache)
		expect(peekVerifiedDelivery(t.opts())).toBeUndefined()
		await getVerifiedDelivery(t.opts())
		expect(t.delivery.calls).toHaveLength(2)
	})

	it('settleDelivery nulls the def whenever the verdict is not render', () => {
		const issuer = makeIssuer()
		const payload = issuer.envelope().payload
		const cached: CachedDelivery = { kind: 'verified', payload, renderDef: parseRenderDef(ELF_LIKE_DEF) }
		const ctx = { platform: 'builder', externalId: ENTRY_ID }
		expect(settleDelivery(cached, { ...ctx, now: new Date(T0) }).renderDef).toEqual(ELF_LIKE_DEF)
		expect(settleDelivery(cached, { ...ctx, externalId: 'other', now: new Date(T0) })).toEqual({
			verdict: { decision: 'suppress', reason: 'subject_mismatch' },
			renderDef: null,
		})
	})
})
