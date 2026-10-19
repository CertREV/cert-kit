/**
 * 1.3.0: Delivery bodies that carry the unsigned `face` sibling, for the delivered-face tests and their goldens.
 *
 * `__golden__/delivered-face-1.2.1.json` (server renders) and `__golden__/delivered-face-client-1.2.1.json` (browser
 * renders) hold what the UNMODIFIED @certrev/cert-block 1.2.1 card painted for these deliveries and records (the
 * cert-kit main commit d4601e7, before the 1.3.0 change; 1.2.1 reads neither `face` nor `content.faceDigest`). The
 * 1.3.0 tests compare every case in which the delivered face must NOT paint against those bytes, so "1.2.1's output"
 * is what 1.2.1 really rendered, not a re-derivation of it.
 *
 * The issuer's key is FIXED (derived from a constant), so every signature, and so every seed that carries one, is the
 * same bytes on every run. The face digests are computed with Node's `createHash`, not with the WebCrypto path the card
 * uses, so the test's oracle and the code under test do not share an implementation.
 *
 * Data only: nothing here imports the card or a 1.3.0 module, so the 1.2.1 generators load this file unchanged.
 */

import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import type { CertPayload, ResolvePublicKeyByKid } from '@certrev/cert-contract'
import { localEd25519Signer, signPayloadEd25519, signTombstone } from '@certrev/cert-contract/signer'
import { builderPayload, builderSubject, ELF_LIKE_DEF, type FixtureIssuer } from './delivery-harness.js'
import { RAW_DEFS } from './legacy-face-cases.js'

/** An Ed25519 issuer whose key is derived from a constant: deterministic signatures, so deterministic seeds. */
export function fixedIssuer(kid = 'fixture-issuer-1'): FixtureIssuer {
	const seed = createHash('sha256').update('cert-block 1.3.0 delivered-face fixture issuer').digest()
	const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed])
	const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
	const base64 = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64')
	const resolveKid: ResolvePublicKeyByKid = (k) => (k === kid ? { format: 'spki-base64', base64 } : null)
	return {
		kid,
		resolveKid,
		privateKey,
		envelope(overrides = {}) {
			const payload = builderPayload(overrides)
			const sig = signPayloadEd25519(payload, privateKey)
			return { payload, signature: { alg: 'ed25519', kid, sig, signedAt: payload.lifecycle.issuedAt } }
		},
		tombstone(subject = builderSubject()) {
			return signTombstone(
				{ subject, revokedAt: '2026-09-26T11:00:00.000Z', revocationReason: 'cert_revoked' },
				{ kid, sign: localEd25519Signer(privateKey), signedAt: '2026-09-26T11:00:00.000Z' },
			)
		},
	}
}

/**
 * A server-rendered face as the Delivery API serves it. Non-ASCII on purpose (a Latin-1 or UTF-16 hash of these
 * strings differs from the UTF-8 one the digest is over).
 */
export const DELIVERED_FACE = {
	html: '<section class="crv-face" data-crv-face=""><p class="crv-face__by">Reviewed by Dr. Jane Doe · MD, FAAD ✓</p><p class="crv-face__memo">Präzise &amp; sicher formuliert.</p></section>',
	css: '.crv-face{font-family:"Söhne",system-ui,sans-serif;border:1px solid #000;border-radius:8px}.crv-face__by::before{content:"✓ "}',
} as const

/** Lowercase hex sha256 of the UTF-8 bytes. */
export function sha256Hex(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** The signed `content.faceDigest` for a face rendered for def version `defVersion`. */
export function faceDigestFor(face: { readonly html: string; readonly css: string }, defVersion: number) {
	return { v: 1 as const, defVersion, html: sha256Hex(face.html), css: sha256Hex(face.css) }
}

/** Payload overrides that put `digest` on the signed content (beside the harness content). */
export function withFaceDigest(digest: unknown, overrides: Partial<CertPayload> = {}): Partial<CertPayload> {
	return { ...overrides, content: { ...builderPayload().content, faceDigest: digest } as CertPayload['content'] }
}

/**
 * The three defs the matrix runs under, all version 4: the legacy face hiding the reviewer photo (its seed carries no
 * signature), the legacy face hiding nothing (its seed keeps the signature), and the reader face.
 */
export const DEFS = {
	legacy: ELF_LIKE_DEF,
	legacyAll: { ...ELF_LIKE_DEF, hidden: [] as string[] },
	reader: { ...ELF_LIKE_DEF, face: 'reader', layout: 'banner' },
} as const
export type DefName = keyof typeof DEFS

/** The canary replica's pinned design (a reader def at version 2) and its pin, as the card receives it. */
export const PINNED_DEF = RAW_DEFS['face-reader'] as { readonly v: number }
export const PIN_CONTEXT = { certrevDesignPin: { design: String(PINNED_DEF.v), designBrand: 'staging-shopify-canary' } }

/** The split-banner blocks: the matching delivery on a block that shows only the banner's header or its memo. */
export const SPLIT_PARTS = { partHeader: 'header', partMemo: 'memo' } as const

/** The delivery whose face hashes to the signed digest for the def served beside it. */
export function matchingBody(issuer: FixtureIssuer, def: object = DEFS.legacy): Record<string, unknown> {
	const v = (def as { v: number }).v
	return { ...issuer.envelope(withFaceDigest(faceDigestFor(DELIVERED_FACE, v))), renderDef: def, face: DELIVERED_FACE }
}

/**
 * Every delivery for which the card must paint what 1.2.1 paints, by name, for one def. Each breaks exactly one of the
 * conditions for painting the delivered face; everything else is the matching delivery.
 */
export function ownFaceBodies(
	issuer: FixtureIssuer,
	def: object = DEFS.legacy,
): Record<string, Record<string, unknown>> {
	const v = (def as { v: number }).v
	const digest = faceDigestFor(DELIVERED_FACE, v)
	const signed = issuer.envelope(withFaceDigest(digest))
	const withDigest = (d: unknown) => issuer.envelope(withFaceDigest(d))
	const body = (extra: Record<string, unknown>) => ({ ...signed, renderDef: def, face: DELIVERED_FACE, ...extra })
	return {
		/** An envelope minted without a digest (every envelope before cert-contract 0.6.0). */
		noDigest: { ...issuer.envelope(), renderDef: def, face: DELIVERED_FACE },
		/** A digest, but no face served beside it. */
		noFace: { ...signed, renderDef: def },
		htmlMismatch: body({ face: { ...DELIVERED_FACE, html: DELIVERED_FACE.html.replace('Jane', 'Jana') } }),
		cssMismatch: body({ face: { ...DELIVERED_FACE, css: `${DELIVERED_FACE.css} ` } }),
		halvesSwapped: body({ face: { html: DELIVERED_FACE.css, css: DELIVERED_FACE.html } }),
		/** The face was rendered for this def's version; the def served beside it is the next one. */
		defVersionMismatch: body({ renderDef: { ...def, v: v + 1 } }),
		renderDefAbsent: { ...signed, face: DELIVERED_FACE },
		/** A def that does not parse (painted as no def). */
		renderDefMalformed: body({ renderDef: { v: 'x', hidden: 'reviewerPhoto' } }),
		malformedFaceString: body({ face: DELIVERED_FACE.html }),
		malformedFaceArray: body({ face: [DELIVERED_FACE.html, DELIVERED_FACE.css] }),
		malformedFaceNull: body({ face: null }),
		malformedFaceHtmlNotString: body({ face: { html: 42, css: DELIVERED_FACE.css } }),
		malformedFaceNoCss: body({ face: { html: DELIVERED_FACE.html } }),
		digestV2: { ...withDigest({ ...digest, v: 2 }), renderDef: def, face: DELIVERED_FACE },
		digestUppercase: {
			...withDigest({ ...digest, html: digest.html.toUpperCase(), css: digest.css.toUpperCase() }),
			renderDef: def,
			face: DELIVERED_FACE,
		},
		digestDefVersionString: {
			...withDigest({ ...digest, defVersion: String(v) }),
			renderDef: def,
			face: DELIVERED_FACE,
		},
		/** A digest over the UTF-16 bytes of the same strings, not UTF-8. */
		digestUtf16: {
			...withDigest({
				...digest,
				html: createHash('sha256').update(DELIVERED_FACE.html, 'utf16le').digest('hex'),
				css: createHash('sha256').update(DELIVERED_FACE.css, 'utf16le').digest('hex'),
			}),
			renderDef: def,
			face: DELIVERED_FACE,
		},
	}
}

/** The card's options props for one server case (a split-banner part, a pin), or none. */
export type CaseProps = { readonly part?: 'header' | 'memo' } | { readonly pinned: true } | Record<string, never>

/** One server case: the Delivery body (or a promise of one) and the card's extra props. */
export interface ServerCase {
	readonly body: Record<string, unknown>
	readonly props: CaseProps
}

/**
 * The server matrix, by `<def>.<case>`: per def, the matching delivery (`matching`; 1.2.1 paints its own face for it)
 * and every own-face body; the two split-banner parts; and, def-independent, a tombstone with a face spliced beside it
 * (which no longer verifies as a tombstone; either way it paints nothing) and the canary replica's pinned card with a
 * matching face for its pinned design.
 */
export async function serverCases(issuer: FixtureIssuer): Promise<Record<string, ServerCase>> {
	const out: Record<string, ServerCase> = {}
	for (const [defName, def] of Object.entries(DEFS)) {
		out[`${defName}.matching`] = { body: matchingBody(issuer, def), props: {} }
		for (const [name, body] of Object.entries(ownFaceBodies(issuer, def)))
			out[`${defName}.${name}`] = { body, props: {} }
		for (const [name, part] of Object.entries(SPLIT_PARTS)) {
			out[`${defName}.${name}`] = { body: matchingBody(issuer, def), props: { part } }
		}
	}
	const tombstone = await issuer.tombstone()
	out.tombstoneWithFace = { body: { ...tombstone, renderDef: DEFS.legacy, face: DELIVERED_FACE }, props: {} }
	out.pinnedMatching = { body: matchingBody(issuer, PINNED_DEF), props: { pinned: true } }
	return out
}
