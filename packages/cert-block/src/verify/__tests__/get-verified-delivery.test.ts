/**
 * `getVerifiedDelivery`: the Delivery read that keeps the render-def sibling. The card tests
 * drive it through React; these pin its own contract (what is cached, what is re-judged per
 * call, how the def is shape-checked, and that every failure is a suppress, never a throw).
 */

import { describe, expect, it, vi } from 'vitest'
import { DELIVERED_FACE, matchingBody } from '../../builder/__tests__/delivered-face-shapes.js'
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
	designPinFromUrl,
	getVerifiedDelivery,
	invalidateDelivery,
	parseDeliveredFace,
	parseDesignPin,
	parseRenderDef,
	peekVerifiedDelivery,
	readVerifiedDelivery,
	settleDelivery,
} from '../get-verified-delivery.js'

const BASE = 'https://staging.portal.certrev.com'

function setup(first?: () => Response | Promise<Response>, staleMs?: number) {
	const issuer = makeIssuer()
	let clock = T0
	const delivery = scriptedDelivery(first ?? (() => json(deliveryBody(issuer.envelope()))))
	const cache = new TtlCache<CachedDelivery>({
		ttlMs: 60_000,
		negativeTtlMs: 5_000,
		...(staleMs === undefined ? {} : { staleMs }),
		now: () => clock,
	})
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
		['404', 'subject_mismatch', false, () => json({}, 404)],
		['410', 'subject_mismatch', false, () => json({}, 410)],
		['500', 'unsupported_contract_version', true, () => json({}, 500)],
		['non-JSON', 'unsupported_contract_version', true, () => new Response('nope')],
		['a JSON array', 'unsupported_contract_version', true, () => json([])],
		['a network error', 'unsupported_contract_version', true, () => Promise.reject(new TypeError('fetch failed'))],
		['the deadline', 'unsupported_contract_version', true, () => new Promise<Response>(() => {})],
	])('%s suppresses (%s; CertREV not reached: %s) without throwing', async (_label, reason, notReached, answer) => {
		const t = setup(answer as () => Response | Promise<Response>)
		expect(await getVerifiedDelivery(t.opts())).toEqual({
			verdict: { decision: 'suppress', reason },
			renderDef: null,
			...(notReached ? { unreachable: true } : {}),
		})
	})

	it('a definitive no is never marked unreachable: a tombstone, a key nobody knows, an expired artifact', async () => {
		const t = setup()
		const tombstone = await t.issuer.tombstone()
		t.delivery.respond(() => json(tombstone))
		expect((await getVerifiedDelivery(t.opts())).unreachable).toBeUndefined()
		const u = setup(() => json(deliveryBody(makeIssuer('stranger').envelope())))
		expect((await getVerifiedDelivery(u.opts())).unreachable).toBeUndefined()
		const v = setup()
		const payload = v.issuer.envelope().payload
		const expiresAt = new Date(T0 + 10_000).toISOString()
		v.delivery.respond(() => json(deliveryBody(v.issuer.envelope({ lifecycle: { ...payload.lifecycle, expiresAt } }))))
		await getVerifiedDelivery(v.opts())
		v.advance(10_000)
		const expired = await getVerifiedDelivery(v.opts())
		expect(expired.verdict).toEqual({ decision: 'suppress', reason: 'expired' })
		expect(expired.unreachable).toBeUndefined()
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

describe('readVerifiedDelivery (1.2.0): the synchronous read a render makes', () => {
	const REFRESH_WAIT = { timeout: 4_000, interval: 5 }

	it('is undefined on an empty cache and starts no fetch', () => {
		const t = setup(undefined, 300_000)
		expect(readVerifiedDelivery(t.opts())).toBeUndefined()
		expect(t.delivery.calls).toHaveLength(0)
	})

	it('a fresh read is settled at the render clock, as getVerifiedDelivery settles it', async () => {
		const t = setup(undefined, 300_000)
		const got = await getVerifiedDelivery(t.opts())
		expect(readVerifiedDelivery(t.opts())).toEqual(got)
		expect(t.delivery.calls).toHaveLength(1)
	})

	it('past the TTL, inside the stale window: the stale answer now, and ONE refresh replaces it', async () => {
		const t = setup(undefined, 300_000)
		await getVerifiedDelivery(t.opts())
		t.advance(61_000)
		expect(peekVerifiedDelivery(t.opts())).toBeUndefined()
		const tombstone = await t.issuer.tombstone()
		t.delivery.respond(() => json(tombstone))
		expect(readVerifiedDelivery(t.opts())?.verdict.decision).toBe('render')
		expect(readVerifiedDelivery(t.opts())?.verdict.decision).toBe('render')
		expect(t.delivery.calls).toHaveLength(2)
		// The refresh (the fetch, then the signature check) lands in the background, after however many ticks a loaded
		// machine takes: wait for it, never for a fixed number of ticks. Every read meanwhile joins it.
		await vi.waitFor(
			() => expect(readVerifiedDelivery(t.opts())?.verdict).toEqual({ decision: 'suppress', reason: 'revoked' }),
			REFRESH_WAIT,
		)
		expect(t.delivery.calls).toHaveLength(2)
	})

	it('stale-if-error: a refresh that does not reach CertREV keeps the verified read, and getVerifiedDelivery gets it too', async () => {
		const t = setup(undefined, 300_000)
		await getVerifiedDelivery(t.opts())
		t.advance(61_000)
		t.delivery.respond(() => json({}, 503))
		expect(readVerifiedDelivery(t.opts())?.verdict.decision).toBe('render')
		expect(t.delivery.calls).toHaveLength(2)
		// Wait for the failed refresh to land: only then does a read start the next one (a third call), and the read
		// that starts it still gets the verified answer, so the failure was not cached over it.
		await vi.waitFor(() => {
			expect(readVerifiedDelivery(t.opts())?.verdict.decision).toBe('render')
			expect(t.delivery.calls).toHaveLength(3)
		}, REFRESH_WAIT)
		expect((await getVerifiedDelivery(t.opts())).verdict.decision).toBe('render')
	})

	it('past the stale window the read is gone, and a read that does not reach CertREV is what the card gets', async () => {
		const t = setup(undefined, 300_000)
		await getVerifiedDelivery(t.opts())
		t.advance(361_000)
		expect(readVerifiedDelivery(t.opts())).toBeUndefined()
		t.delivery.respond(() => json({}, 503))
		expect((await getVerifiedDelivery(t.opts())).unreachable).toBe(true)
	})

	it('a stale payload is still judged at the render clock: one that has expired in its own fields suppresses', async () => {
		const t = setup(undefined, 300_000)
		const payload = t.issuer.envelope().payload
		const expiresAt = new Date(T0 + 90_000).toISOString()
		t.delivery.respond(() => json(deliveryBody(t.issuer.envelope({ lifecycle: { ...payload.lifecycle, expiresAt } }))))
		await getVerifiedDelivery(t.opts())
		t.advance(90_000)
		t.delivery.respond(() => new Promise<Response>(() => {}))
		expect(readVerifiedDelivery(t.opts())?.verdict).toEqual({ decision: 'suppress', reason: 'expired' })
	})
})

describe('the design pin (1.2.0-canary.5)', () => {
	const ctx = { platform: 'builder', externalId: ENTRY_ID }
	const placement = { baseUrl: BASE, platform: 'builder', externalId: ENTRY_ID, context: ctx }

	it('deliveryUrl appends ?design and &designBrand; without a pin the URL is the 1.1.0 one', () => {
		expect(deliveryUrl(BASE, 'builder', ENTRY_ID)).toBe(DELIVERY_URL)
		expect(deliveryUrl(BASE, 'builder', ENTRY_ID, undefined)).toBe(DELIVERY_URL)
		expect(deliveryUrl(`${BASE}/`, 'builder', ENTRY_ID, { version: 7 })).toBe(`${DELIVERY_URL}?design=7`)
		expect(deliveryUrl(BASE, 'builder', ENTRY_ID, { version: 7, brand: 'staging-shopify-canary' })).toBe(
			`${DELIVERY_URL}?design=7&designBrand=staging-shopify-canary`,
		)
		// The brand is encoded, so a brand that is not a brand key cannot add a parameter of its own.
		expect(deliveryUrl(BASE, 'builder', ENTRY_ID, { version: 7, brand: 'a&design=9 #' })).toBe(
			`${DELIVERY_URL}?design=7&designBrand=a%26design%3D9%20%23`,
		)
	})

	it('deliveryCacheKey: the unpinned key is unchanged, and every pin keys its own read', () => {
		const unpinned = deliveryCacheKey(placement)
		expect(unpinned).toBe(`delivery:${DELIVERY_URL}|builder:${ENTRY_ID}`)
		expect(deliveryCacheKey({ ...placement, design: undefined })).toBe(unpinned)
		expect(deliveryCacheKey({ ...placement, design: { version: 7, brand: 'acme' } })).toBe(
			`delivery:${DELIVERY_URL}?design=7&designBrand=acme|builder:${ENTRY_ID}`,
		)
		const keys = [
			unpinned,
			deliveryCacheKey({ ...placement, design: { version: 7 } }),
			deliveryCacheKey({ ...placement, design: { version: 8 } }),
			deliveryCacheKey({ ...placement, design: { version: 7, brand: 'acme' } }),
			deliveryCacheKey({ ...placement, design: { version: 7, brand: 'other' } }),
		]
		expect(new Set(keys).size).toBe(5)
	})

	it('getVerifiedDelivery fetches the pinned URL and caches it apart from the unpinned read', async () => {
		const t = setup()
		const design = { version: 2, brand: 'staging-shopify-canary' }
		const pinnedUrl = `${DELIVERY_URL}?design=2&designBrand=staging-shopify-canary`
		expect((await getVerifiedDelivery({ ...t.opts(), design })).verdict.decision).toBe('render')
		expect(t.delivery.calls).toEqual([pinnedUrl])
		expect(peekVerifiedDelivery({ ...t.opts(), design })?.verdict.decision).toBe('render')
		expect(peekVerifiedDelivery(t.opts())).toBeUndefined()
		await getVerifiedDelivery(t.opts())
		expect(t.delivery.calls).toEqual([pinnedUrl, DELIVERY_URL])
		invalidateDelivery({ ...t.opts(), design }, t.cache)
		expect(peekVerifiedDelivery({ ...t.opts(), design })).toBeUndefined()
		expect(peekVerifiedDelivery(t.opts())?.verdict.decision).toBe('render')
	})

	it.each([
		['404 no_design', 'subject_mismatch', () => json({ code: 'no_design' }, 404)],
		['503', 'unsupported_contract_version', () => json({ error: 'unavailable' }, 503)],
	])('a pin the API cannot honour (%s) suppresses (%s)', async (label, reason, answer) => {
		const t = setup(answer)
		expect(await getVerifiedDelivery({ ...t.opts(), design: { version: 3 } })).toEqual({
			verdict: { decision: 'suppress', reason },
			renderDef: null,
			...(label === '503' ? { unreachable: true } : {}),
		})
		expect(t.delivery.calls).toEqual([`${DELIVERY_URL}?design=3`])
	})
})

describe('parseDesignPin', () => {
	it.each([
		['undefined', undefined],
		['null', null],
	])('is undefined (no pin) only for %s', (_label, raw) => {
		expect(parseDesignPin(raw)).toBeUndefined()
	})

	it.each([
		['a version', { design: '1' }, { version: 1 }],
		[
			'a version and a brand',
			{ design: '7', designBrand: 'staging-shopify-canary' },
			{ version: 7, brand: 'staging-shopify-canary' },
		],
		['a numeric version', { design: 42 }, { version: 42 }],
		['the largest version', { design: '999999999' }, { version: 999_999_999 }],
		['a one-character brand', { design: '3', designBrand: 'a' }, { version: 3, brand: 'a' }],
		[
			'a 100-character brand',
			{ design: '3', designBrand: `a${'b-'.repeat(49)}c` },
			{ version: 3, brand: `a${'b-'.repeat(49)}c` },
		],
		['an undefined brand', { design: '3', designBrand: undefined }, { version: 3 }],
		['an unknown key beside the pin', { design: '3', other: 'ignored' }, { version: 3 }],
	])('reads %s', (_label, raw, pin) => {
		expect(parseDesignPin(raw)).toStrictEqual(pin)
	})

	it.each([
		['a bare string', '3'],
		['a bare number', 3],
		['true', true],
		['an array', [{ design: '3' }]],
		['an empty object', {}],
		['an empty version', { design: '' }],
		['version 0', { design: '0' }],
		['a leading zero', { design: '07' }],
		['ten digits', { design: '1000000000' }],
		['a negative version', { design: '-1' }],
		['a fractional version', { design: '1.5' }],
		['a padded version', { design: ' 3' }],
		['a version with a trailing newline', { design: '3\n' }],
		['a word', { design: 'latest' }],
		['numeric 0', { design: 0 }],
		['a numeric fraction', { design: 1.5 }],
		['a negative number', { design: -3 }],
		['NaN', { design: Number.NaN }],
		['Infinity', { design: Number.POSITIVE_INFINITY }],
		['a number past nine digits', { design: 1e21 }],
		['a boolean version', { design: true }],
		['a null version', { design: null }],
		['a brand without a version', { designBrand: 'acme' }],
		['a brand with an empty version', { design: '', designBrand: 'acme' }],
		['an empty brand', { design: '3', designBrand: '' }],
		['an upper-case brand', { design: '3', designBrand: 'Acme' }],
		['a brand with a leading hyphen', { design: '3', designBrand: '-acme' }],
		['a brand with a trailing hyphen', { design: '3', designBrand: 'acme-' }],
		['a brand with an underscore', { design: '3', designBrand: 'a_b' }],
		['a brand with a space', { design: '3', designBrand: 'a b' }],
		['a brand with a trailing newline', { design: '3', designBrand: 'acme\n' }],
		['a 101-character brand', { design: '3', designBrand: 'a'.repeat(101) }],
		['a null brand', { design: '3', designBrand: null }],
		['a numeric brand', { design: '3', designBrand: 7 }],
	])('is invalid for %s', (_label, raw) => {
		expect(parseDesignPin(raw)).toBe('invalid')
	})
})

describe('designPinFromUrl', () => {
	it.each([
		['no pin', 'https://replica.example/blog/retinol-guide', undefined],
		['other parameters only', 'https://replica.example/blog/retinol-guide?utm_source=x', undefined],
		['a pin in the fragment', 'https://replica.example/blog/retinol-guide#?design=7', undefined],
		['a version', 'https://replica.example/blog/retinol-guide?design=7', { design: '7' }],
		[
			'a version and a brand',
			'https://replica.example/blog/x?design=7&designBrand=staging-shopify-canary',
			{ design: '7', designBrand: 'staging-shopify-canary' },
		],
		[
			'a brand alone (design is empty)',
			'https://replica.example/blog/x?designBrand=acme',
			{ design: '', designBrand: 'acme' },
		],
		['an empty version', 'https://replica.example/blog/x?design=', { design: '' }],
		['a raw, unjudged version', 'https://replica.example/blog/x?design=latest', { design: 'latest' }],
		[
			'a decoded brand',
			'https://replica.example/blog/x?design=7&designBrand=a%26b',
			{ design: '7', designBrand: 'a&b' },
		],
		['a relative URL', '/blog/x?design=7', { design: '7' }],
		['a bare query', '?design=12&designBrand=acme', { design: '12', designBrand: 'acme' }],
		['a URL object', new URL('https://replica.example/?design=12'), { design: '12' }],
		['a URL that does not parse', 'http://[::1', undefined],
	])('%s', (_label, url, expected) => {
		expect(designPinFromUrl(url)).toStrictEqual(expected)
	})

	it('hands parseDesignPin a pin it reads, and a brand-only pin it refuses', () => {
		expect(parseDesignPin(designPinFromUrl('/x?design=7&designBrand=acme'))).toEqual({ version: 7, brand: 'acme' })
		expect(parseDesignPin(designPinFromUrl('/x?designBrand=acme'))).toBe('invalid')
		expect(parseDesignPin(designPinFromUrl('/x'))).toBeUndefined()
	})
})

describe('parseDeliveredFace (1.3.0)', () => {
	it('keeps exactly the two strings', () => {
		expect(parseDeliveredFace({ html: '<p>x</p>', css: 'p{color:red}', defVersion: 4, extra: 'ignored' })).toEqual({
			html: '<p>x</p>',
			css: 'p{color:red}',
		})
		expect(parseDeliveredFace({ html: '', css: '' })).toEqual({ html: '', css: '' })
	})

	it.each([
		['undefined', undefined],
		['null', null],
		['a string', '<p>x</p>'],
		['an array', ['<p>x</p>', 'p{}']],
		['html not a string', { html: 42, css: 'p{}' }],
		['css not a string', { html: '<p>x</p>', css: { rules: [] } }],
		['no html', { css: 'p{}' }],
		['no css', { html: '<p>x</p>' }],
	])('is null for %s', (_label, value) => {
		expect(parseDeliveredFace(value)).toBeNull()
	})
})

describe('getVerifiedDelivery: the face sibling (1.3.0)', () => {
	it('parses the face beside the def and caches it with the verified payload', async () => {
		const t = setup()
		t.delivery.respond(() => json(matchingBody(t.issuer)))
		const first = await getVerifiedDelivery(t.opts())
		expect(first.verdict.decision).toBe('render')
		expect(first.renderDef).toEqual(ELF_LIKE_DEF)
		expect(first.face).toEqual(DELIVERED_FACE)
		expect(t.cache.peek(deliveryCacheKey(t.opts()))).toMatchObject({ kind: 'verified', face: DELIVERED_FACE })
		t.advance(30_000)
		expect((await getVerifiedDelivery(t.opts())).face).toEqual(DELIVERED_FACE)
		expect(readVerifiedDelivery(t.opts())?.face).toEqual(DELIVERED_FACE)
		expect(peekVerifiedDelivery(t.opts())?.face).toEqual(DELIVERED_FACE)
		expect(t.delivery.calls).toHaveLength(1)
	})

	it('carries the face unjudged: it is read even when the envelope signs no digest', async () => {
		const t = setup(() => json({ ...deliveryBody(t.issuer.envelope()), face: DELIVERED_FACE }))
		expect((await getVerifiedDelivery(t.opts())).face).toEqual(DELIVERED_FACE)
	})

	it('no face, or a malformed one, leaves the read exactly as 1.2.1 settled it (no face key)', async () => {
		const t = setup()
		const plain = await getVerifiedDelivery(t.opts())
		expect(plain).not.toHaveProperty('face')
		expect(t.cache.peek(deliveryCacheKey(t.opts()))).not.toHaveProperty('face')
		const u = setup(() => json({ ...deliveryBody(u.issuer.envelope()), face: { html: DELIVERED_FACE.html } }))
		const malformed = await getVerifiedDelivery(u.opts())
		expect(malformed.verdict.decision).toBe('render')
		expect(malformed).not.toHaveProperty('face')
	})

	it('a suppress verdict carries no face: a tombstone, and an expiry over a cached read', async () => {
		const t = setup()
		const tombstone = await t.issuer.tombstone()
		// A tombstone carrying an extra sibling does not verify as a tombstone (the contract's rule), so the reason is
		// `invalid_signature`; either way it suppresses, and a suppress never carries a face.
		t.delivery.respond(() => json({ ...tombstone, face: DELIVERED_FACE }))
		const revoked = await getVerifiedDelivery(t.opts())
		expect(revoked.verdict.decision).toBe('suppress')
		expect(revoked).toEqual({ verdict: revoked.verdict, renderDef: null })

		const u = setup()
		const payload = u.issuer.envelope().payload
		const expiresAt = new Date(T0 + 10_000).toISOString()
		u.delivery.respond(() =>
			json({
				...deliveryBody(u.issuer.envelope({ lifecycle: { ...payload.lifecycle, expiresAt } })),
				face: DELIVERED_FACE,
			}),
		)
		expect((await getVerifiedDelivery(u.opts())).face).toEqual(DELIVERED_FACE)
		u.advance(10_000)
		const later = await getVerifiedDelivery(u.opts())
		expect(later.verdict).toEqual({ decision: 'suppress', reason: 'expired' })
		expect(later).not.toHaveProperty('face')
	})

	it('settleDelivery reads a cached read with no face key (a hand-filled or 1.2.1-shaped cache) as no face', () => {
		const payload = makeIssuer().envelope().payload
		const cached: CachedDelivery = { kind: 'verified', payload, renderDef: null }
		const settled = settleDelivery(cached, { platform: 'builder', externalId: ENTRY_ID, now: new Date(T0) })
		expect(settled.verdict.decision).toBe('render')
		expect(settled).not.toHaveProperty('face')
	})
})
