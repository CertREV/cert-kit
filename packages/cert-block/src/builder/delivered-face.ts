/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The delivered face gate: when the Builder card may paint the server's markup (1.3.0)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The Delivery API may serve a server-rendered face (`face: { html, css }`) beside the signed artifact. That sibling
 * is UNSIGNED. What binds it is the signed `payload.content.faceDigest` (cert-contract 0.6.0): the lowercase hex sha256
 * of the markup's and the stylesheet's UTF-8 bytes, for one saved design version. The card paints the delivered face
 * only when ALL of these hold:
 *
 *  - the verdict is `render` (the caller has already checked that);
 *  - the card is not pinned (a design pin keeps 1.2.1's pinned face; the caller checks that);
 *  - the block shows the whole card: `part` is not `'header'` or `'memo'`, so a split banner never paints the face
 *    twice (`showsWholeCard`);
 *  - the verified content carries a digest it understands (`v: 1`, two 64-char lowercase hex digests, a numeric
 *    `defVersion`);
 *  - a well-formed face was served;
 *  - a def was served and its `v` IS the digest's `defVersion` (markup rendered for another design version is not
 *    this design);
 *  - sha256(html) and sha256(css) equal the signed values.
 *
 * In every other case the card paints exactly what 1.2.1 paints. Markup whose bytes do not hash to the signed digest
 * is never painted, and a WebCrypto failure counts as a mismatch, never as a pass.
 *
 * Hashing uses WebCrypto (`crypto.subtle.digest`), the global the kernel verifies with, so it runs wherever the card
 * already verifies (Node SSR, edge runtimes, a browser in a secure context). It is react-free; the card owns the
 * suspension around the async digest.
 */

import type { CertContent, CertFaceDigest } from '../contract/kernel.js'
import type { DeliveredFace } from '../verify/get-verified-delivery.js'
import type { CertChromeRenderDef } from './cert-chrome-data.js'

const SHA256_HEX = /^[0-9a-f]{64}$/

/**
 * Whether a block shows the whole card, by `renderCertBlock`'s own rule: only `'header'` and `'memo'` split the
 * banner; absent, `'full'`, null or anything unrecognised is the full card. A split block keeps its own part even
 * when a delivered face matches, because the delivered face is a whole design.
 */
export function showsWholeCard(part: unknown): boolean {
	return part !== 'header' && part !== 'memo'
}

/** The signed digest, accepted only in the shape cert-contract 0.6.0 defines; anything else is null. */
export function acceptedFaceDigest(content: CertContent | null | undefined): CertFaceDigest | null {
	const digest: unknown = (content as { faceDigest?: unknown } | null | undefined)?.faceDigest
	if (typeof digest !== 'object' || digest === null || Array.isArray(digest)) return null
	const { v, defVersion, html, css } = digest as Record<string, unknown>
	if (v !== 1 || typeof defVersion !== 'number' || !Number.isFinite(defVersion)) return null
	if (typeof html !== 'string' || !SHA256_HEX.test(html)) return null
	if (typeof css !== 'string' || !SHA256_HEX.test(css)) return null
	return { v: 1, defVersion, html, css }
}

/**
 * The synchronous half of the gate: the digest to hash the face against, or null when the delivered face cannot
 * paint whatever its bytes are (no digest, no face, no def, or a def of another version). The card hashes only when
 * this is non-null, so a delivery without a face never suspends a second time.
 */
export function deliveredFaceDigest(
	content: CertContent | null | undefined,
	renderDef: CertChromeRenderDef | null,
	face: DeliveredFace | null | undefined,
): CertFaceDigest | null {
	if (!face) return null
	const digest = acceptedFaceDigest(content)
	if (!digest || !renderDef || renderDef.v !== digest.defVersion) return null
	return digest
}

/** Lowercase hex sha256 of a string's UTF-8 bytes, via WebCrypto. */
export async function sha256HexUtf8(text: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
	let hex = ''
	for (const byte of digest) hex += byte.toString(16).padStart(2, '0')
	return hex
}

/** The two digests of a delivered face. */
export interface DeliveredFaceHashes {
	readonly html: string
	readonly css: string
}

/** Hash both halves. Never rejects: a WebCrypto failure (none in an insecure context) is null, which never matches. */
export async function hashDeliveredFace(face: DeliveredFace): Promise<DeliveredFaceHashes | null> {
	try {
		const [html, css] = await Promise.all([sha256HexUtf8(face.html), sha256HexUtf8(face.css)])
		return { html, css }
	} catch {
		return null
	}
}

/** The asynchronous half's verdict: both halves hash to the signed values. */
export function deliveredFaceMatches(hashes: DeliveredFaceHashes | null, digest: CertFaceDigest): boolean {
	return hashes !== null && hashes.html === digest.html && hashes.css === digest.css
}

/** The markup the card paints for a matching face: the stylesheet first, then the face. */
export function deliveredFaceHtml(face: DeliveredFace): string {
	return `<style>${face.css}</style>${face.html}`
}

/** One face's hashing: the pending digest, and its answer once settled. */
export interface FaceHashMemo {
	readonly pending: Promise<DeliveredFaceHashes | null>
	settled?: { readonly hashes: DeliveredFaceHashes | null }
}

/** How many faces' hashes are kept (insertion order; the oldest goes first). A page or a brand has one or a few. */
const FACE_HASH_MEMO_MAX = 64
const faceHashMemo = new Map<string, FaceHashMemo>()

/**
 * The memoized hashing of one face, keyed by its CONTENT (both strings), not by the object: the browser parses a seed
 * from the page afresh on each render, and a server's cached read and a seed of the same face share one entry. A
 * failure settles to null and stays settled (a context with no WebCrypto does not gain one).
 */
export function faceHashesFor(face: DeliveredFace): FaceHashMemo {
	const key = `${face.html.length}:${face.html}${face.css}`
	const known = faceHashMemo.get(key)
	if (known) return known
	const fresh: FaceHashMemo = {
		pending: hashDeliveredFace(face).then((hashes) => {
			fresh.settled = { hashes }
			return hashes
		}),
	}
	if (faceHashMemo.size >= FACE_HASH_MEMO_MAX) {
		const oldest = faceHashMemo.keys().next().value
		if (oldest !== undefined) faceHashMemo.delete(oldest)
	}
	faceHashMemo.set(key, fresh)
	return fresh
}

/** Test seam: forget every face's hashes (a new process). */
export function forgetFaceHashesForTests(): void {
	faceHashMemo.clear()
}
