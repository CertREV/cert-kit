/**
 * Key-set test shapes (2.0.0): Ed25519 keys made with Node's crypto (standing in for CertREV's issuer), a published
 * key set signed the way the portal signs it (Ed25519 over cert-contract's RFC 8785 bytes of the `certrev.keyset`
 * object), and the response body the delivery origin answers with.
 */

import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto'
import { base64urlEncode, canonicalBytes, type ResolvePublicKeyByKid } from '@certrev/cert-contract'

export interface TestKey {
	readonly kid: string
	readonly privateKey: KeyObject
	/** base64url of the raw 32-byte public key, as the published set carries it. */
	readonly x: string
	/** The baked-resolver form of the key (SPKI, base64). */
	readonly spki: string
}

export function testKey(kid: string): TestKey {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519')
	const jwk = publicKey.export({ format: 'jwk' }) as { x: string }
	return {
		kid,
		privateKey,
		x: jwk.x,
		spki: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
	}
}

/** A baked resolver over these keys (the package's own trust root, in a test). */
export function bakedResolver(...keys: TestKey[]): ResolvePublicKeyByKid {
	return (kid) => {
		const key = keys.find((k) => k.kid === kid)
		return key ? { format: 'spki-base64', base64: key.spki } : null
	}
}

export function keySetObject(keys: readonly TestKey[], issuedAt = '2026-10-21T00:00:00.000Z') {
	return {
		kind: 'certrev.keyset',
		v: 1,
		issuedAt,
		keys: keys.map((k) => ({ kid: k.kid, crv: 'Ed25519', x: k.x })),
	}
}

/** Sign any object's RFC 8785 bytes with `signer`, base64url. */
export function signObject(value: unknown, signer: TestKey): string {
	return base64urlEncode(new Uint8Array(sign(null, canonicalBytes(value), signer.privateKey)))
}

/** The route's 200 body: the set and its signature by `signer`. */
export function keySetBody(keyset: unknown, signer: TestKey, kid = signer.kid): Record<string, unknown> {
	return {
		keyset,
		signature: { alg: 'ed25519', kid, sig: signObject(keyset, signer), signedAt: '2026-10-21T00:00:00.000Z' },
	}
}
