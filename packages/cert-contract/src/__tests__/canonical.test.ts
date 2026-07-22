import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalBytes, canonicalizeJson, canonicalTombstoneBytes } from '../canonical.js'
// SHA-256 helpers moved to the Node-only signer subpath (they use `node:crypto`); the
// canonicalization they hash is still imported from `../canonical` above.
import { sha256Hex, sha256OfCanonical } from '../signer.js'
import type { CertTombstoneSignable } from '../types.js'
import vectorsFile from './vectors.json'

/**
 * The golden vectors ARE the cross-language contract. We re-derive the canonical bytes
 * + sha256 from the runtime and assert byte-equality with the recorded golden values,
 * so an implementation change that perturbs canonicalization is caught here, and a
 * foreign (PHP/Go/…) port has an exact hex/sha256 target for every input.
 */
describe('RFC-8785 golden vectors', () => {
	const { vectors } = vectorsFile as {
		vectors: Array<{ name: string; value: unknown; canonical: string; canonicalHex: string; sha256: string }>
	}

	it('has the expected vector set (representative + adversarial)', () => {
		const names = vectors.map((v) => v.name)
		expect(names).toEqual([
			'empty_object',
			'null_value',
			'key_order_simple',
			'key_order_unicode_codepoint',
			'unicode_string_values',
			'string_escapes',
			'nested_objects_and_arrays',
			'integers',
			'floats',
			'exponent_numbers',
			'booleans_and_empty',
			'array_of_mixed',
			'cert_payload_shape',
			'key_order_surrogate_pairs',
			'curly_apostrophe_production_strings',
			'cert_payload_shape_v0_2',
			'cert_tombstone_signable_shape',
		])
	})

	for (const v of vectors) {
		describe(v.name, () => {
			it('canonicalizes to the recorded JCS string', () => {
				expect(canonicalizeJson(v.value)).toBe(v.canonical)
			})

			it('produces the recorded canonical UTF-8 bytes (hex)', () => {
				const hex = Buffer.from(canonicalBytes(v.value)).toString('hex')
				expect(hex).toBe(v.canonicalHex)
			})

			it('the recorded hex decodes back to the canonical string (UTF-8 round-trip)', () => {
				expect(Buffer.from(v.canonicalHex, 'hex').toString('utf8')).toBe(v.canonical)
			})

			it('produces the recorded SHA-256', () => {
				expect(sha256OfCanonical(v.value)).toBe(v.sha256)
				expect(sha256Hex(canonicalBytes(v.value))).toBe(v.sha256)
			})

			it('SHA-256 matches an independent hash of the recorded canonical bytes', () => {
				// Independent of canonicalize(): hash the recorded hex bytes directly.
				const independent = createHash('sha256').update(Buffer.from(v.canonicalHex, 'hex')).digest('hex')
				expect(independent).toBe(v.sha256)
			})
		})
	}
})

describe('canonicalization invariants', () => {
	it('is key-order invariant (different insertion order → identical bytes)', () => {
		const a = canonicalBytes({ b: 1, a: 2, c: { z: 9, y: 8 } })
		const b = canonicalBytes({ c: { y: 8, z: 9 }, a: 2, b: 1 })
		expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'))
	})

	it('normalizes -0 to 0', () => {
		expect(canonicalizeJson({ n: -0 })).toBe('{"n":0}')
	})

	it('throws on a non-JSON-serializable value', () => {
		// biome-ignore lint/suspicious/noExplicitAny: deliberately passing a BigInt to hit the throw path
		expect(() => canonicalizeJson({ n: 10n } as any)).toThrow()
	})
})

describe('canonicalTombstoneBytes (POR-10481)', () => {
	const { vectors } = vectorsFile as {
		vectors: Array<{ name: string; value: unknown; canonicalHex: string }>
	}
	const vec = vectors.find((v) => v.name === 'cert_tombstone_signable_shape')

	it('the typed signing helper reproduces the golden tombstone bytes (signer/kernel ↔ cross-language target)', () => {
		expect(vec, 'the tombstone golden vector must exist').toBeTruthy()
		const bytes = canonicalTombstoneBytes(vec?.value as CertTombstoneSignable)
		expect(Buffer.from(bytes).toString('hex')).toBe(vec?.canonicalHex)
	})
})
