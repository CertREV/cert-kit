/**
 * The Builder card's Delivery runtime (1.1.0): the trust root, fetch, cache and clock the
 * envelope-backed `CertReviewCard` reads with.
 *
 * INTERNAL. This module is deliberately NOT on the package `exports` map, so a consumer cannot
 * swap the trust root through the published API: the card verifies against the baked
 * `cert-issuer-1` key, the same key the storefront badge bundle ships. The package's own tests
 * reach the setter by relative import to run the real kernel against fixture-signed envelopes.
 */

import type { ResolvePublicKeyByKid } from '../contract/kernel.js'
import { TtlCache } from '../verify/cache.js'
import type { CachedDelivery } from '../verify/get-verified-delivery.js'
import { CERT_ISSUER_KID, CERT_ISSUER_PUBLIC_KEY_PEM } from './issuer-key.js'

export interface CardDeliveryRuntime {
	readonly resolveKid: ResolvePublicKeyByKid
	readonly fetchImpl: () => typeof fetch
	readonly cache: TtlCache<CachedDelivery>
	readonly now: () => number
	readonly timeoutMs?: number
}

const bakedResolveKid: ResolvePublicKeyByKid = (kid) =>
	kid === CERT_ISSUER_KID ? { format: 'pem', pem: CERT_ISSUER_PUBLIC_KEY_PEM } : null

function defaultRuntime(): CardDeliveryRuntime {
	return {
		resolveKid: bakedResolveKid,
		fetchImpl: () => globalThis.fetch,
		cache: new TtlCache<CachedDelivery>({ ttlMs: 60_000, negativeTtlMs: 5_000 }),
		now: Date.now,
	}
}

let runtime: CardDeliveryRuntime = defaultRuntime()

export function cardDeliveryRuntime(): CardDeliveryRuntime {
	return runtime
}

/** Test seam: replace parts of the runtime (a fresh cache unless one is given). Returns a restore. */
export function setCardDeliveryRuntimeForTests(overrides: Partial<CardDeliveryRuntime>): () => void {
	const previous = runtime
	const now = overrides.now ?? previous.now
	runtime = {
		...previous,
		cache: new TtlCache<CachedDelivery>({ ttlMs: 60_000, negativeTtlMs: 5_000, now }),
		...overrides,
	}
	return () => {
		runtime = previous
	}
}
