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
	/** Injectable clock for deterministic tests. */
	readonly now?: () => number
}

interface Entry<V> {
	readonly value: V
	readonly expiresAt: number
	readonly negative: boolean
}

export class TtlCache<V> {
	private readonly store = new Map<string, Entry<V>>()
	private readonly inflight = new Map<string, Promise<V>>()
	private readonly ttlMs: number
	private readonly negativeTtlMs: number
	private readonly maxEntries: number
	private readonly now: () => number

	constructor(opts: TtlCacheOptions = {}) {
		this.ttlMs = opts.ttlMs ?? 60_000
		this.negativeTtlMs = opts.negativeTtlMs ?? 5_000
		this.maxEntries = opts.maxEntries ?? 1000
		this.now = opts.now ?? Date.now
	}

	/** Read a live (non-expired) entry, or undefined. Prunes the entry if expired. */
	peek(key: string): V | undefined {
		const e = this.store.get(key)
		if (!e) return undefined
		if (e.expiresAt <= this.now()) {
			this.store.delete(key)
			return undefined
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
	 */
	async getOrLoad(
		key: string,
		loader: () => Promise<V>,
		isNegative?: (v: V) => boolean,
		positiveTtlMs?: number,
	): Promise<V> {
		const cached = this.peek(key)
		if (cached !== undefined) return cached

		const existing = this.inflight.get(key)
		if (existing) return existing

		const promise = (async () => {
			const value = await loader()
			const negative = isNegative ? isNegative(value) : false
			this.set(key, value, negative, negative ? undefined : positiveTtlMs)
			return value
		})().finally(() => {
			this.inflight.delete(key)
		})

		this.inflight.set(key, promise)
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
