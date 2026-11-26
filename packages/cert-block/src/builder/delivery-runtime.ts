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
 * 2.1.2: no failure is remembered as a miss. A server render with no card waits up to `CARD_SERVER_WAIT_MS` (1,500 ms)
 * for a read that is retried once (`CARD_DELIVERY_RETRY_MS`); a placement that painted before keeps its last verified card
 * (`CARD_DELIVERY_LAST_GOOD_MS`) while a refresh is slow or fails, so a cache expiry never blanks a card.
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
 * The longest a SERVER render waits for a placement's read when it has no card to paint (2.0.2: 300 ms; 2.1.2: 1,500 ms).
 * Past it the render prints nothing (`delivery_unreachable`) and the read runs on: when it lands it is cached for the next
 * render. Nothing about the failure is remembered as a miss. 2.1.2: 300 ms was under the Delivery API's real answer
 * times seen from a storefront (staging, 2026-11-18: about 550 ms; a CDN miss is p50 415 ms, p95 548 ms from one client,
 * and a cold function takes seconds), so a cold read printed no card, and 2.0.2 then remembered that for 60 s: the card
 * was on a minute, off a minute. 1,500 ms holds a CDN miss's p95 about three times over, and the retry
 * (`CARD_DELIVERY_RETRY_MS`) a cold function. A render with a card to paint never waits this long (see `lastGoodMs`).
 */
export const CARD_SERVER_WAIT_MS = 1_500
/**
 * 2.1.2: a read that has not answered after this long gets a second request beside it (a read that fails at once is
 * retried at once); the first definitive answer wins. Above a CDN miss's p95 (548 ms), so a normal read never doubles.
 */
export const CARD_DELIVERY_RETRY_MS = 700
/**
 * 2.1.2: how long past its stale window a placement's last verified card is kept to paint when a refresh cannot reach
 * CertREV in time (a timeout, a network error, a 5xx). An expiry never blanks a card that painted before: only a
 * definitive answer (revoked, expired, not found, unverifiable) or this long without one good read takes it down.
 * A refresh that reaches CertREV replaces it, so when CertREV answers, a revocation lands exactly as in 2.0.1 (the fresh
 * and stale windows below). The browser runtime's own revalidation hides a revoked card on any page view with JavaScript.
 */
export const CARD_DELIVERY_LAST_GOOD_MS = 3_600_000
/**
 * 2.1.2: after a refresh fails to reach CertREV, how long a placement that has a card to paint starts no new read. The
 * card paints at once meanwhile; a placement with no card is never held back.
 */
export const CARD_DELIVERY_REFRESH_BACKOFF_MS = 30_000
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
	/** 2.1.2: when a read gets its second request (`CARD_DELIVERY_RETRY_MS`); absent, one request. */
	readonly retryAfterMs?: number
}

const bakedResolveKid: ResolvePublicKeyByKid = (kid) =>
	kid === CERT_ISSUER_KID ? { format: 'pem', pem: CERT_ISSUER_PUBLIC_KEY_PEM } : null

function newCardCache(now?: () => number): TtlCache<CachedDelivery> {
	return new TtlCache<CachedDelivery>({
		ttlMs: CARD_DELIVERY_TTL_MS,
		negativeTtlMs: 5_000,
		staleMs: CARD_DELIVERY_STALE_MS,
		// 2.1.2, on a server: no failure is remembered (2.0.2 remembered one 60 s), the last good card paints instead. A
		// browser read (`clientRead`) holds no page and keeps 2.0.1's cache (a failure is a 5 s negative entry, break-it B1).
		...(typeof document === 'undefined'
			? { lastGoodMs: CARD_DELIVERY_LAST_GOOD_MS, refreshBackoffMs: CARD_DELIVERY_REFRESH_BACKOFF_MS }
			: {}),
		// A refresh the host runtime abandoned (workerd cancels a finished request's I/O) never
		// settles; after the deadline plus a margin, the next render starts a new one.
		inflightMaxMs: CARD_DELIVERY_RETRY_MS + CARD_DELIVERY_TIMEOUT_MS + 2_000,
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
		retryAfterMs: CARD_DELIVERY_RETRY_MS,
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
