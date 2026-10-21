/**
 * The Builder card's Delivery runtime (1.1.0): the trust root, fetch, cache and clock the
 * envelope-backed `CertReviewCard` reads with.
 *
 * INTERNAL. This module is deliberately NOT on the package `exports` map, so a consumer cannot
 * swap the trust root through the published API: the card verifies against the baked
 * `cert-issuer-1` key, the same key the storefront badge bundle ships. The package's own tests
 * reach the setter by relative import to run the real kernel against fixture-signed envelopes.
 *
 * 1.2.0: the card's server read waits up to `CARD_DELIVERY_TIMEOUT_MS` (8s, against the
 * verifier's 3s default), and its cache serves a certificate up to `CARD_DELIVERY_STALE_MS` past
 * its TTL while one background refresh runs, or while CertREV cannot be reached. A cold or slow
 * read on a brand's server then misses at most once per placement, and a warm one never waits.
 * A revocation still lands on the first render after its refresh does. The tests' runtime gets
 * the same cache shape, so they exercise what production runs.
 *
 * 2.0.0: the trust root is a key SET (`verify/key-set.ts`). `resolveKid` is still the baked set (today
 * `cert-issuer-1`), and the card verifies with `resolveKidFor(baseUrl)`: a baked kid resolves as before, any other kid
 * makes one read of the delivery origin's published key set, accepted only when a baked kid signs it. A rotation then
 * needs no reinstall. The card's (2.0) contract-1 document digests are memoized with the delivered faces' hashes.
 */

import type { ResolvePublicKeyByKid } from '../contract/kernel.js'
import { TtlCache } from '../verify/cache.js'
import type { CachedDelivery } from '../verify/get-verified-delivery.js'
import { forgetKeySetsForTests, keySetResolver } from '../verify/key-set.js'
import { forgetCardDigestsForTests } from './card-contract.js'
import { forgetCardReportsForTests } from './card-report.js'
import { forgetFaceHashesForTests } from './delivered-face.js'
import { CERT_ISSUER_KID, CERT_ISSUER_PUBLIC_KEY_PEM } from './issuer-key.js'
import { forgetPageSeedsForTests } from './ssr-seed.js'

/** The card's server read deadline. A brand's server waits this long once per cold placement. */
export const CARD_DELIVERY_TIMEOUT_MS = 8_000
/** How long past its 60s TTL a certificate may still paint while it is refreshed or CertREV is down. */
export const CARD_DELIVERY_STALE_MS = 300_000

export interface CardDeliveryRuntime {
	/** The baked kids: the package's own trust root (and the only keys that may sign a published key set). */
	readonly resolveKid: ResolvePublicKeyByKid
	/**
	 * 2.0.0: what the card verifies a read from `baseUrl` with: the baked kids, then that origin's signed published set.
	 * Absent: derived from `resolveKid`, `fetchImpl` and `timeoutMs` (`keySetResolver`).
	 */
	readonly resolveKidFor?: (baseUrl: string) => ResolvePublicKeyByKid
	readonly fetchImpl: () => typeof fetch
	readonly cache: TtlCache<CachedDelivery>
	readonly now: () => number
	readonly timeoutMs?: number
}

const bakedResolveKid: ResolvePublicKeyByKid = (kid) =>
	kid === CERT_ISSUER_KID ? { format: 'pem', pem: CERT_ISSUER_PUBLIC_KEY_PEM } : null

function newCardCache(now?: () => number): TtlCache<CachedDelivery> {
	return new TtlCache<CachedDelivery>({
		ttlMs: 60_000,
		negativeTtlMs: 5_000,
		staleMs: CARD_DELIVERY_STALE_MS,
		// A refresh the host runtime abandoned (workerd cancels a finished request's I/O) never
		// settles; after the deadline plus a margin, the next render starts a new one.
		inflightMaxMs: CARD_DELIVERY_TIMEOUT_MS + 2_000,
		...(now ? { now } : {}),
	})
}

function defaultRuntime(): CardDeliveryRuntime {
	return {
		resolveKid: bakedResolveKid,
		fetchImpl: () => globalThis.fetch,
		cache: newCardCache(),
		now: Date.now,
		timeoutMs: CARD_DELIVERY_TIMEOUT_MS,
	}
}

let runtime: CardDeliveryRuntime = defaultRuntime()

export function cardDeliveryRuntime(): CardDeliveryRuntime {
	return runtime
}

/** 2.0.0: the resolver for a read from `baseUrl`: the runtime's own, else the baked kids plus the origin's key set. */
export function cardResolveKidFor(rt: CardDeliveryRuntime, baseUrl: string): ResolvePublicKeyByKid {
	if (rt.resolveKidFor) return rt.resolveKidFor(baseUrl)
	return keySetResolver({
		baseUrl,
		bakedResolveKid: rt.resolveKid,
		fetchImpl: rt.fetchImpl(),
		...(rt.timeoutMs !== undefined ? { timeoutMs: rt.timeoutMs } : {}),
	})
}

/**
 * Test seam: replace parts of the runtime (a fresh cache unless one is given) and forget the page's envelope seeds
 * (a fresh runtime is a fresh page), (1.3.0) every delivered face's memoized hashes and (2.0.0) every card
 * document's digest and every published key set. Returns a restore.
 */
export function setCardDeliveryRuntimeForTests(overrides: Partial<CardDeliveryRuntime>): () => void {
	forgetPageSeedsForTests()
	forgetFaceHashesForTests()
	forgetCardDigestsForTests()
	forgetKeySetsForTests()
	forgetCardReportsForTests()
	const previous = runtime
	const now = overrides.now ?? previous.now
	runtime = {
		...previous,
		cache: newCardCache(now),
		...overrides,
	}
	return () => {
		runtime = previous
	}
}
