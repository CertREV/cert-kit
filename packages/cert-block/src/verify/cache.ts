/**
 * In-process TTL cache with single-flight de-duplication.
 *
 * WHY: under SSR, a popular product/blog page can render N times concurrently across a
 * server's request workers. Without coordination, each render fires its own fetch to the
 * Shopify metafield / Delivery API → a thundering herd against the issuer on cold cache
 * or cache expiry. This cache:
 *   1. Serves a fresh value from memory within its TTL (no fetch).
 *   2. SINGLE-FLIGHTS concurrent misses for the same key — the first caller's in-flight
 *      promise is shared by every other caller for that key, so N concurrent renders do
 *      ONE fetch, not N.
 *   3. Negative-caches failures briefly so a hard-down origin doesn't get hammered, while
 *      still recovering quickly (short negative TTL).
 *   4. (1.2.0, opt-in through `staleMs`) STALE-WHILE-REVALIDATE and STALE-IF-ERROR: a positive
 *      entry past its TTL but inside the stale window is served at once while ONE background
 *      refresh replaces it; a refresh that only failed to reach the origin (`isTransient`)
 *      keeps the stale entry instead of overwriting it. So an origin that is slow or briefly
 *      down costs the page nothing it already had. A definitive answer (a revocation, say)
 *      replaces the entry the moment the refresh lands. With the default `staleMs` of 0 an
 *      expired entry is gone, exactly as before 1.2.0.
 *
 * It is deliberately tiny + dependency-free (a Map + timestamps) so it runs in any server
 * runtime (Node, edge, workerd). For multi-instance deployments this is per-instance L1 and
 * nothing more: each instance keeps its own copy, so an L2 (the CDN in front of the Delivery
 * API, which is cacheable on `lifecycle.revision`, or a shared KV) is the caller's to add.
 */

export interface TtlCacheOptions {
	/** Positive-result TTL in ms (default 60_000). */
	readonly ttlMs?: number
	/** Negative-result (miss/error) TTL in ms (default 5_000). */
	readonly negativeTtlMs?: number
	/** Max entries before LRU-ish eviction of the oldest insert (default 1000). */
	readonly maxEntries?: number
	/**
	 * 1.2.0: how long past its TTL a POSITIVE entry may still be served while a refresh runs (default 0: never). A
	 * negative entry is never served stale.
	 */
	readonly staleMs?: number
	/**
	 * 1.2.0: how long an unsettled load may be joined by later callers (default: no limit). Past it, the next caller
	 * starts a fresh load. WHY: a runtime may cancel the I/O of a request that has finished (Cloudflare workerd does),
	 * which can leave a background refresh's promise pending forever; without a limit every later caller would join
	 * it and none would ever refresh again.
	 */
	readonly inflightMaxMs?: number
	/** Injectable clock for deterministic tests. */
	readonly now?: () => number
}

interface Entry<V> {
	readonly value: V
	readonly expiresAt: number
	readonly negative: boolean
}

interface Inflight<V> {
	readonly promise: Promise<V>
	readonly startedAt: number
}

export class TtlCache<V> {
	private readonly store = new Map<string, Entry<V>>()
	private readonly inflight = new Map<string, Inflight<V>>()
	private readonly ttlMs: number
	private readonly negativeTtlMs: number
	private readonly maxEntries: number
	private readonly staleMs: number
	private readonly inflightMaxMs: number
	private readonly now: () => number

	constructor(opts: TtlCacheOptions = {}) {
		this.ttlMs = opts.ttlMs ?? 60_000
		this.negativeTtlMs = opts.negativeTtlMs ?? 5_000
		this.maxEntries = opts.maxEntries ?? 1000
		this.staleMs = opts.staleMs !== undefined && opts.staleMs > 0 ? opts.staleMs : 0
		this.inflightMaxMs = opts.inflightMaxMs ?? Number.POSITIVE_INFINITY
		this.now = opts.now ?? Date.now
	}

	/** The entry while it may still be served (fresh, or positive and inside the stale window); prunes it past that. */
	private servable(key: string): Entry<V> | undefined {
		const e = this.store.get(key)
		if (!e) return undefined
		const now = this.now()
		if (e.expiresAt > now) return e
		if (!e.negative && now < e.expiresAt + this.staleMs) return e
		this.store.delete(key)
		return undefined
	}

	/** Read a live (non-expired) entry, or undefined. Never serves a stale one; prunes an entry past its stale window. */
	peek(key: string): V | undefined {
		const e = this.servable(key)
		return e && e.expiresAt > this.now() ? e.value : undefined
	}

	/**
	 * The synchronous stale-while-revalidate read: a fresh value; or a positive entry past its TTL but inside the stale
	 * window, returned at once while this starts (or joins) ONE background refresh through `loader`; else undefined,
	 * and the caller loads (`getOrLoad`). The refresh caches as `getOrLoad` does, with the same arguments; its failure
	 * is swallowed (the stale value was already served, and a thrown loader is never cached).
	 */
	peekOrRefresh(
		key: string,
		loader: () => Promise<V>,
		isNegative?: (v: V) => boolean,
		positiveTtlMs?: number,
		isTransient?: (v: V) => boolean,
	): V | undefined {
		const e = this.servable(key)
		if (!e) return undefined
		if (e.expiresAt <= this.now()) {
			this.load(key, loader, isNegative, positiveTtlMs, isTransient).catch(() => undefined)
		}
		return e.value
	}

	/**
	 * Get-or-load with single-flight. If a fresh value is cached, returns it. Otherwise
	 * de-duplicates concurrent loads for `key`: the first caller runs `loader`, every
	 * concurrent caller awaits the same promise. The result is cached with the positive
	 * TTL; if `isNegative(value)` returns true (e.g. a 'suppress' verdict) it's cached
	 * with the shorter negative TTL so a transient failure recovers fast. A thrown loader
	 * is NOT cached (it rejects all current waiters and the next call retries).
	 *
	 * `positiveTtlMs` overrides the cache's positive TTL FOR THIS WRITE only, so one caller
	 * can hold a verdict longer/shorter than the cache's default without owning the cache.
	 * It deliberately does NOT apply to a negative result: a caller asking for a 10-minute
	 * positive TTL is asking for fewer origin reads, not for a transient failure to be
	 * remembered for ten minutes (see the negative-TTL rationale in the module header).
	 *
	 * 1.2.0: inside the stale window (`staleMs`) an expired positive entry is returned at once and refreshed in the
	 * background (`peekOrRefresh`). `isTransient(value)` marks a result that says only "the origin was not reached"
	 * (a timeout, a 5xx): when a servable positive entry exists, such a result is NOT cached over it and the caller
	 * gets that entry's value instead (stale-if-error). With no entry to keep, it is cached as `isNegative` says.
	 */
	async getOrLoad(
		key: string,
		loader: () => Promise<V>,
		isNegative?: (v: V) => boolean,
		positiveTtlMs?: number,
		isTransient?: (v: V) => boolean,
	): Promise<V> {
		const served = this.peekOrRefresh(key, loader, isNegative, positiveTtlMs, isTransient)
		if (served !== undefined) return served
		return this.load(key, loader, isNegative, positiveTtlMs, isTransient)
	}

	/** Single-flight load and cache (joins an unsettled load younger than `inflightMaxMs`). */
	private load(
		key: string,
		loader: () => Promise<V>,
		isNegative: ((v: V) => boolean) | undefined,
		positiveTtlMs: number | undefined,
		isTransient: ((v: V) => boolean) | undefined,
	): Promise<V> {
		const existing = this.inflight.get(key)
		if (existing && this.now() - existing.startedAt < this.inflightMaxMs) return existing.promise

		const promise: Promise<V> = (async () => {
			const value = await loader()
			if (isTransient?.(value)) {
				const kept = this.servable(key)
				if (kept && !kept.negative) return kept.value
			}
			const negative = isNegative ? isNegative(value) : false
			this.set(key, value, negative, negative ? undefined : positiveTtlMs)
			return value
		})().finally(() => {
			// Only this load's own slot: a newer load that replaced an abandoned one keeps its place.
			if (this.inflight.get(key)?.promise === promise) this.inflight.delete(key)
		})

		this.inflight.set(key, { promise, startedAt: this.now() })
		return promise
	}

	/** Insert/overwrite an entry. `ttlMsOverride` replaces the TTL this write would otherwise
	 *  get (positive or negative); omit it for the cache's configured TTLs. */
	set(key: string, value: V, negative = false, ttlMsOverride?: number): void {
		if (this.store.size >= this.maxEntries && !this.store.has(key)) {
			// Evict the oldest inserted key (Map preserves insertion order).
			const oldest = this.store.keys().next().value
			if (oldest !== undefined) this.store.delete(oldest)
		}
		const configured = negative ? this.negativeTtlMs : this.ttlMs
		const ttl = ttlMsOverride !== undefined && Number.isFinite(ttlMsOverride) ? ttlMsOverride : configured
		this.store.set(key, { value, expiresAt: this.now() + ttl, negative })
	}

	/** Drop a key (e.g. on a known revocation push). */
	delete(key: string): void {
		this.store.delete(key)
	}

	/**
	 * Drop every key under a prefix. WHY it exists: a cache key identifies everything the
	 * cached value depends on, which for a verdict includes the live content hash the render
	 * observed — a fact a revocation webhook does not know. Invalidating by prefix lets the
	 * webhook drop a placement without having to reconstruct every render context that ever
	 * cached it.
	 */
	deletePrefix(prefix: string): void {
		for (const key of this.store.keys()) {
			if (key.startsWith(prefix)) this.store.delete(key)
		}
	}

	clear(): void {
		this.store.clear()
		this.inflight.clear()
	}

	get size(): number {
		return this.store.size
	}
}
