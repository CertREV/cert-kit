/**
 * 2.0.0, the key SET a card trusts (`key-set.ts`): a baked kid first; any other kid from the delivery origin's
 * published set, accepted only when a BAKED kid signs it, under every refusal rule; one read per origin; and a key
 * rotation that renders a Builder card with no reinstall. Real Ed25519 throughout (Node signs, WebCrypto verifies).
 */

import { signPayloadEd25519 } from '@certrev/cert-contract/signer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { builderPayload, json, makeIssuer, scriptedDelivery, T0 } from '../../builder/__tests__/delivery-harness.js'
import { TtlCache } from '../cache.js'
import { type CachedDelivery, getVerifiedDelivery } from '../get-verified-delivery.js'
import { forgetKeySetsForTests, KEY_SET_PATH, keySetResolver, verifyKeySet } from '../key-set.js'
import { bakedResolver, keySetBody, keySetObject, signObject, testKey } from './key-set-shapes.js'

const BASE = 'https://staging.portal.certrev.com'
const baked = testKey('cert-issuer-1')
const rotated = testKey('cert-issuer-2')
const stranger = testKey('stranger-1')
const resolveBaked = bakedResolver(baked)

beforeEach(() => forgetKeySetsForTests())
afterEach(() => forgetKeySetsForTests())

describe('verifyKeySet: only a set a baked kid signs, over exactly the certrev.keyset bytes', () => {
	it('accepts a set signed by a baked kid that keeps it, and publishes every key in it', async () => {
		const accepted = await verifyKeySet(keySetBody(keySetObject([baked, rotated]), baked), resolveBaked)
		expect(accepted?.issuedAt).toBe(Date.parse('2026-10-21T00:00:00.000Z'))
		expect([...(accepted?.keys.keys() ?? [])]).toEqual(['cert-issuer-1', 'cert-issuer-2'])
	})

	const refusals: [string, () => unknown][] = [
		['another kind', () => keySetBody({ ...keySetObject([baked, rotated]), kind: 'certrev.release' }, baked)],
		['another version', () => keySetBody({ ...keySetObject([baked, rotated]), v: 2 }, baked)],
		['a signer that is not baked', () => keySetBody(keySetObject([stranger, rotated]), stranger)],
		['a set without its signer’s kid', () => keySetBody(keySetObject([rotated]), baked)],
		[
			'a set that publishes another key under the signer’s kid',
			() => {
				const swapped = { ...keySetObject([rotated]), keys: [{ kid: baked.kid, crv: 'Ed25519', x: rotated.x }] }
				return keySetBody(swapped, baked)
			},
		],
		[
			'a key added after signing',
			() => {
				const body = keySetBody(keySetObject([baked]), baked) as { keyset: { keys: unknown[] } }
				body.keyset.keys.push({ kid: stranger.kid, crv: 'Ed25519', x: stranger.x })
				return body
			},
		],
		[
			'a key that is not 32 bytes',
			() =>
				keySetBody(
					{
						...keySetObject([baked]),
						keys: [
							{ kid: baked.kid, crv: 'Ed25519', x: 'AAAA' },
							{ kid: 'k', crv: 'Ed25519', x: 'AAAA' },
						],
					},
					baked,
				),
		],
		[
			'a key on another curve',
			() => keySetBody({ ...keySetObject([baked]), keys: [{ kid: baked.kid, crv: 'X25519', x: baked.x }] }, baked),
		],
		[
			'a kid twice',
			() =>
				keySetBody(
					{
						...keySetObject([baked]),
						keys: [
							{ kid: baked.kid, crv: 'Ed25519', x: baked.x },
							{ kid: baked.kid, crv: 'Ed25519', x: baked.x },
						],
					},
					baked,
				),
		],
		['no keys', () => keySetBody({ ...keySetObject([]) }, baked)],
		['an issuedAt that is not a date', () => keySetBody({ ...keySetObject([baked]), issuedAt: 'soon' }, baked)],
		[
			'another signature alg',
			() => ({ ...keySetBody(keySetObject([baked]), baked), signature: { alg: 'rs256', kid: baked.kid, sig: 'x' } }),
		],
		['no signature', () => ({ keyset: keySetObject([baked]) })],
		['not an object', () => 'keys'],
	]
	it.each(refusals)('refuses %s', async (_label, make) => {
		expect(await verifyKeySet(make(), resolveBaked)).toBeNull()
	})

	it('an envelope’s signature by the same baked key can never verify as a key set (domain separation)', async () => {
		const payload = builderPayload()
		const sig = signPayloadEd25519(payload, baked.privateKey)
		const body = { keyset: keySetObject([baked, rotated]), signature: { alg: 'ed25519', kid: baked.kid, sig } }
		expect(await verifyKeySet(body, resolveBaked)).toBeNull()
		// ... and a key set's signature is not an envelope signature either: it signs other bytes.
		expect(signObject(keySetObject([baked]), baked)).not.toBe(sig)
	})

	it('refuses a set older than the one already accepted (no rollback), accepts the same or newer', async () => {
		const first = await verifyKeySet(
			keySetBody(keySetObject([baked, rotated], '2026-10-21T00:00:00.000Z'), baked),
			resolveBaked,
		)
		expect(first).not.toBeNull()
		const older = keySetBody(keySetObject([baked], '2026-10-20T00:00:00.000Z'), baked)
		expect(await verifyKeySet(older, resolveBaked, first ?? undefined)).toBeNull()
		const newer = keySetBody(keySetObject([baked], '2026-10-22T00:00:00.000Z'), baked)
		expect(await verifyKeySet(newer, resolveBaked, first ?? undefined)).not.toBeNull()
	})
})

describe('keySetResolver on a server: baked first, one read of the origin per hour', () => {
	it('a baked kid resolves with no read', async () => {
		const delivery = scriptedDelivery(() => json(keySetBody(keySetObject([baked, rotated]), baked)))
		const resolve = keySetResolver({ baseUrl: BASE, bakedResolveKid: resolveBaked, fetchImpl: delivery.fetch })
		expect(await resolve(baked.kid)).toEqual({ format: 'spki-base64', base64: baked.spki })
		expect(delivery.calls).toEqual([])
	})

	it('an unknown kid reads the origin’s set once, with credentials omitted; a second kid and a second resolver reuse it', async () => {
		const inits: RequestInit[] = []
		const delivery = scriptedDelivery(() => json(keySetBody(keySetObject([baked, rotated]), baked)))
		const fetchImpl = ((url: RequestInfo | URL, init?: RequestInit) => {
			inits.push(init ?? {})
			return delivery.fetch(url, init)
		}) as typeof fetch
		const resolve = keySetResolver({ baseUrl: `${BASE}/`, bakedResolveKid: resolveBaked, fetchImpl })
		expect(await resolve(rotated.kid)).toMatchObject({ format: 'raw' })
		expect(await resolve('cert-issuer-9')).toBeNull()
		const again = keySetResolver({ baseUrl: BASE, bakedResolveKid: resolveBaked, fetchImpl })
		expect(await again(rotated.kid)).toMatchObject({ format: 'raw' })
		expect(delivery.calls).toEqual([`${BASE}${KEY_SET_PATH}`])
		expect(inits[0].credentials).toBe('omit')
	})

	it.each([
		['a 404', () => json({ error: 'not_found' }, 404)],
		['a set signed by a stranger', () => json(keySetBody(keySetObject([stranger, rotated]), stranger))],
		['a body that is not JSON', () => new Response('<html>', { status: 200 })],
	])('%s: the kid stays unknown (null), and the failure is remembered (no second read)', async (_label, answer) => {
		const delivery = scriptedDelivery(answer)
		const resolve = keySetResolver({ baseUrl: BASE, bakedResolveKid: resolveBaked, fetchImpl: delivery.fetch })
		expect(await resolve(rotated.kid)).toBeNull()
		expect(await resolve(rotated.kid)).toBeNull()
		expect(delivery.calls).toHaveLength(1)
	})

	it('a network failure: unknown, never a throw', async () => {
		const fetchImpl = (async () => {
			throw new TypeError('blocked')
		}) as typeof fetch
		const resolve = keySetResolver({ baseUrl: BASE, bakedResolveKid: resolveBaked, fetchImpl })
		await expect(resolve(rotated.kid)).resolves.toBeNull()
	})
})

describe('a key rotation needs no reinstall', () => {
	it('an envelope signed by a kid the origin publishes (signed by the baked kid) verifies and renders', async () => {
		const issuer = makeIssuer(rotated.kid)
		// The issuer's own key is the rotated one: publish it under the baked signer.
		const jwk = issuer.privateKey.export({ format: 'jwk' }) as { x: string }
		const set = { ...keySetObject([baked], '2026-10-21T00:00:00.000Z') }
		set.keys.push({ kid: rotated.kid, crv: 'Ed25519', x: jwk.x })
		const calls: string[] = []
		const fetchImpl = (async (url: RequestInfo | URL) => {
			calls.push(String(url))
			if (String(url).endsWith(KEY_SET_PATH)) return json(keySetBody(set, baked))
			return json({ ...issuer.envelope(), renderDef: null })
		}) as typeof fetch
		const read = await getVerifiedDelivery({
			baseUrl: BASE,
			platform: 'builder',
			externalId: 'entry-fixture-1',
			context: { platform: 'builder', externalId: 'entry-fixture-1', now: new Date(T0) },
			resolveKid: keySetResolver({ baseUrl: BASE, bakedResolveKid: resolveBaked, fetchImpl }),
			fetchImpl,
			cache: new TtlCache<CachedDelivery>(),
		})
		expect(read.verdict.decision).toBe('render')
		expect(calls).toEqual([`${BASE}/api/cert/v1/delivery/builder/entry-fixture-1`, `${BASE}${KEY_SET_PATH}`])
	})

	it('the same envelope with no published set is unknown_key: suppressed, as 1.3.x suppresses an unknown kid', async () => {
		const issuer = makeIssuer(rotated.kid)
		const fetchImpl = (async (url: RequestInfo | URL) =>
			String(url).endsWith(KEY_SET_PATH)
				? json({ error: 'not_found' }, 404)
				: json({ ...issuer.envelope(), renderDef: null })) as typeof fetch
		const read = await getVerifiedDelivery({
			baseUrl: BASE,
			platform: 'builder',
			externalId: 'entry-fixture-1',
			context: { platform: 'builder', externalId: 'entry-fixture-1', now: new Date(T0) },
			resolveKid: keySetResolver({ baseUrl: BASE, bakedResolveKid: resolveBaked, fetchImpl }),
			fetchImpl,
			cache: new TtlCache<CachedDelivery>(),
		})
		expect(read.verdict).toEqual({ decision: 'suppress', reason: 'unknown_key' })
	})
})
