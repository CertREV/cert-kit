/**
 * `TtlCache`'s 1.2.0 options: the stale window (`staleMs`: stale-while-revalidate and stale-if-error) and the limit on
 * joining an unsettled load (`inflightMaxMs`). Without them the cache behaves exactly as before 1.2.0, which the first
 * block pins.
 */

import { describe, expect, it } from 'vitest'
import { TtlCache, type TtlCacheOptions } from '../cache.js'

type Value = { readonly ok: boolean; readonly n: number; readonly transient?: boolean }

const isNegative = (v: Value) => !v.ok
const isTransient = (v: Value) => v.transient === true

function setup(opts: Omit<TtlCacheOptions, 'now'> = {}) {
	let clock = 0
	const cache = new TtlCache<Value>({ ttlMs: 1_000, negativeTtlMs: 100, ...opts, now: () => clock })
	let calls = 0
	let next: () => Promise<Value> = async () => ({ ok: true, n: calls })
	const loader = () => {
		calls += 1
		return next()
	}
	return {
		cache,
		loader,
		calls: () => calls,
		answer(fn: () => Promise<Value>) {
			next = fn
		},
		advance(ms: number) {
			clock += ms
		},
		get: () => cache.getOrLoad('k', loader, isNegative, undefined, isTransient),
		read: () => cache.peekOrRefresh('k', loader, isNegative, undefined, isTransient),
	}
}

/** Let a background refresh settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('without a stale window: the cache before 1.2.0', () => {
	it('an expired entry is gone: the next call loads and waits for it', async () => {
		const t = setup()
		expect(await t.get()).toEqual({ ok: true, n: 1 })
		t.advance(1_000)
		expect(t.cache.peek('k')).toBeUndefined()
		expect(t.read()).toBeUndefined()
		expect(t.calls()).toBe(1)
		expect(await t.get()).toEqual({ ok: true, n: 2 })
	})

	it('a transient result with nothing to keep is cached as negative, for the negative TTL', async () => {
		const t = setup()
		t.answer(async () => ({ ok: false, n: 0, transient: true }))
		expect(await t.get()).toEqual({ ok: false, n: 0, transient: true })
		t.advance(99)
		await t.get()
		expect(t.calls()).toBe(1)
		t.advance(1)
		await t.get()
		expect(t.calls()).toBe(2)
	})

	it('a transient result past the TTL replaces the expired entry (there is no window to keep it in)', async () => {
		const t = setup()
		await t.get()
		t.advance(1_000)
		t.answer(async () => ({ ok: false, n: 0, transient: true }))
		expect(await t.get()).toEqual({ ok: false, n: 0, transient: true })
	})
})

describe('stale-while-revalidate (staleMs)', () => {
	it('inside the window an expired positive entry is served at once while ONE refresh replaces it', async () => {
		const t = setup({ staleMs: 5_000 })
		await t.get()
		t.advance(1_500)
		expect(t.cache.peek('k')).toBeUndefined() // peek never serves stale
		expect(t.read()).toEqual({ ok: true, n: 1 })
		expect(t.read()).toEqual({ ok: true, n: 1 })
		expect(await t.get()).toEqual({ ok: true, n: 1 })
		expect(t.calls()).toBe(2) // one refresh for the three stale reads
		await settle()
		expect(t.read()).toEqual({ ok: true, n: 2 })
		expect(t.cache.peek('k')).toEqual({ ok: true, n: 2 })
		expect(t.calls()).toBe(2)
	})

	it('a fresh entry starts no refresh', async () => {
		const t = setup({ staleMs: 5_000 })
		await t.get()
		t.advance(999)
		expect(t.read()).toEqual({ ok: true, n: 1 })
		await settle()
		expect(t.calls()).toBe(1)
	})

	it('a definitive negative refresh replaces the stale entry (a revocation lands with the refresh)', async () => {
		const t = setup({ staleMs: 5_000 })
		await t.get()
		t.advance(1_500)
		t.answer(async () => ({ ok: false, n: 9 }))
		expect(t.read()).toEqual({ ok: true, n: 1 })
		await settle()
		expect(t.read()).toEqual({ ok: false, n: 9 })
	})

	it('stale-if-error: a transient refresh keeps the stale entry, and the caller gets it', async () => {
		const t = setup({ staleMs: 5_000 })
		await t.get()
		t.advance(1_500)
		t.answer(async () => ({ ok: false, n: 0, transient: true }))
		expect(t.read()).toEqual({ ok: true, n: 1 })
		await settle()
		expect(t.read()).toEqual({ ok: true, n: 1 })
		// Every read past the TTL tries again, once at a time.
		expect(t.calls()).toBe(3)
	})

	it('a thrown refresh is swallowed and keeps the stale entry', async () => {
		const t = setup({ staleMs: 5_000 })
		await t.get()
		t.advance(1_500)
		t.answer(async () => {
			throw new Error('boom')
		})
		expect(t.read()).toEqual({ ok: true, n: 1 })
		await settle()
		expect(t.read()).toEqual({ ok: true, n: 1 })
	})

	it('past the window the entry is gone, and a transient result is all there is', async () => {
		const t = setup({ staleMs: 5_000 })
		await t.get()
		t.advance(6_000)
		expect(t.read()).toBeUndefined()
		t.answer(async () => ({ ok: false, n: 0, transient: true }))
		expect(await t.get()).toEqual({ ok: false, n: 0, transient: true })
	})

	it('a negative entry is never served stale', async () => {
		const t = setup({ staleMs: 5_000 })
		t.answer(async () => ({ ok: false, n: 0 }))
		await t.get()
		t.advance(100)
		expect(t.read()).toBeUndefined()
	})
})

describe('inflightMaxMs: an unsettled load is joined only so long', () => {
	it('past the limit, the next caller starts a fresh load instead of joining one that never settles', async () => {
		const t = setup({ staleMs: 5_000, inflightMaxMs: 200 })
		await t.get()
		t.advance(1_500)
		t.answer(() => new Promise<Value>(() => {}))
		t.read()
		t.advance(199)
		t.read()
		expect(t.calls()).toBe(2)
		t.advance(1)
		t.answer(async () => ({ ok: true, n: 7 }))
		t.read()
		expect(t.calls()).toBe(3)
		await settle()
		expect(t.read()).toEqual({ ok: true, n: 7 })
	})

	it('with no limit (the default) a load is joined however long it takes', async () => {
		const t = setup({ staleMs: 60_000 })
		await t.get()
		t.advance(1_500)
		t.answer(() => new Promise<Value>(() => {}))
		t.read()
		t.advance(30_000)
		t.read()
		expect(t.calls()).toBe(2)
	})
})
