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
 * 2.0.2: a server render waits at most `CARD_SERVER_WAIT_MS` (300 ms) for a cold read, never joins another request's read
 * in flight, and a failure is remembered `CARD_DELIVERY_FAILURE_MS` (60 s) per placement, so a hanging CertREV costs a
 * brand's page at most one short wait per placement per minute (2.0.1: 8 s, every 5 s).
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
import { setCardBeaconForTests } from './card-beacon.js'
import { forgetCardDigestsForTests } from './card-contract.js'
import { forgetCardReportsForTests } from './card-report.js'
import { forgetFaceHashesForTests } from './delivered-face.js'
import { CERT_ISSUER_KID, CERT_ISSUER_PUBLIC_KEY_PEM } from './issuer-key.js'
import { forgetPageSeedsForTests } from './ssr-seed.js'

/**
 * The card's fetch deadline: how long a read of the Delivery API may run (2.0.2: in the background, past the render; a
 * browser read under `clientRead`). Not how long a server render waits: that is `CARD_SERVER_WAIT_MS`.
 */
export const CARD_DELIVERY_TIMEOUT_MS = 8_000
/**
 * 2.0.2: the longest a SERVER render waits for a placement's read (2.0.1 waited the whole `CARD_DELIVERY_TIMEOUT_MS`,
 * 8 s). Past it the render prints nothing (`delivery_unreachable`), the placement's failure is remembered
 * (`CARD_DELIVERY_FAILURE_MS`), and the read runs on: when it lands it is cached for the next render. 300 ms covers the
 * Delivery API's p90 function time (221 ms over 30 days of production, n = 21,368 CDN misses; 93% <= 300 ms) and a
 * cached edge answer (~50 ms) plus a round trip; see the CHANGELOG.
 */
export const CARD_SERVER_WAIT_MS = 300
/**
 * 2.0.2: how long a placement's failure (a timeout, a network error, a 5xx, a render that stopped waiting) is
 * remembered per process. Inside it, no read of the placement starts: a render with no cached card prints nothing at
 * once, and a stale card paints without a refresh. So an ongoing outage costs at most one short wait per placement per
 * minute. (2.0.1: a failure was remembered 5 s.)
 */
export const CARD_DELIVERY_FAILURE_MS = 60_000
/**
 * 2.0.1: how long a verified answer is fresh. With the stale window below, a card adds at most one minute to the Delivery
 * API's own cache (`max-age=60, stale-while-revalidate=240`), so a revoked card is gone within ADR 0001 §7's five to
 * six minutes (2.0.0's 60 s + 300 s here stacked to about twelve).
 */
export const CARD_DELIVERY_TTL_MS = 30_000
/**
 * How long past its TTL a certificate may still paint while it is refreshed or CertREV is down (2.0.1: 30 s; 2.0.0:
 * 300 s). Never longer: past it, a read that cannot reach CertREV prints nothing.
 */
export const CARD_DELIVERY_STALE_MS = 30_000

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
	/** 2.0.2: the longest a server render waits for a read (`CARD_SERVER_WAIT_MS`). */
	readonly serverWaitMs?: number
}

const bakedResolveKid: ResolvePublicKeyByKid = (kid) =>
	kid === CERT_ISSUER_KID ? { format: 'pem', pem: CERT_ISSUER_PUBLIC_KEY_PEM } : null

function newCardCache(now?: () => number): TtlCache<CachedDelivery> {
	return new TtlCache<CachedDelivery>({
		ttlMs: CARD_DELIVERY_TTL_MS,
		negativeTtlMs: 5_000,
		staleMs: CARD_DELIVERY_STALE_MS,
		// 2.0.2: on a server only. A browser read (`clientRead`) holds no page, and keeps 2.0.1's 5 s (break-it B1).
		...(typeof document === 'undefined' ? { failureTtlMs: CARD_DELIVERY_FAILURE_MS } : {}),
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
		serverWaitMs: CARD_SERVER_WAIT_MS,
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
 * document's digest and every published key set. 2.0.1: beacons go nowhere (a test that wants them sets its own
 * transport with `setCardBeaconForTests` after this). Returns a restore.
 */
export function setCardDeliveryRuntimeForTests(overrides: Partial<CardDeliveryRuntime>): () => void {
	forgetPageSeedsForTests()
	forgetFaceHashesForTests()
	forgetCardDigestsForTests()
	forgetKeySetsForTests()
	forgetCardReportsForTests()
	const restoreBeacon = setCardBeaconForTests()
	const previous = runtime
	const now = overrides.now ?? previous.now
	runtime = {
		...previous,
		cache: newCardCache(now),
		...overrides,
	}
	return () => {
		runtime = previous
		restoreBeacon()
	}
}
