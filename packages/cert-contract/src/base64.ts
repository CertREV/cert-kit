/**
 * Runtime-agnostic base64 / base64url — NO `Buffer`, NO `node:*`.
 *
 * The VERIFY path runs on edge/Workers runtimes (Shopify Oxygen, Cloudflare Workers,
 * Vercel Edge) where `Buffer` does not exist. These helpers use a manual RFC-4648
 * alphabet table so they behave identically in Node, Workers, Deno, and browsers —
 * deliberately NOT relying on `atob`/`btoa` (which round-trip through a latin1 binary
 * string and are easy to misuse on raw bytes). Pure + synchronous.
 *
 * base64url (RFC 4648 §5): '+' → '-', '/' → '_', no '=' padding.
 */

const STD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Reverse lookup: char code → 6-bit value. -1 for non-alphabet chars (skipped on decode,
// so '-'/'_'/'+'/'/' and padding all decode uniformly without a separate url table).
const DECODE_TABLE: Int8Array = (() => {
	const t = new Int8Array(128).fill(-1)
	for (let i = 0; i < STD_ALPHABET.length; i++) {
		t[STD_ALPHABET.charCodeAt(i)] = i
	}
	// base64url variants map onto the same 6-bit values.
	t['-'.charCodeAt(0)] = 62 // '+'
	t['_'.charCodeAt(0)] = 63 // '/'
	return t
})()

/** Encode bytes → standard base64 (with '=' padding). */
export function bytesToBase64(bytes: Uint8Array): string {
	let out = ''
	const len = bytes.length
	for (let i = 0; i < len; i += 3) {
		const b0 = bytes[i]
		const b1 = i + 1 < len ? bytes[i + 1] : 0
		const b2 = i + 2 < len ? bytes[i + 2] : 0
		out += STD_ALPHABET[b0 >> 2]
		out += STD_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]
		out += i + 1 < len ? STD_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '='
		out += i + 2 < len ? STD_ALPHABET[b2 & 0x3f] : '='
	}
	return out
}

/** Decode standard OR url base64 (padding optional) → bytes. Ignores non-alphabet chars
 *  (whitespace, '=' padding), so it accepts both base64 and base64url input uniformly. */
export function base64ToBytes(s: string): Uint8Array {
	// Collect 6-bit values, skipping anything not in the alphabet ('=', whitespace, etc).
	const sextets: number[] = []
	for (let i = 0; i < s.length; i++) {
		const code = s.charCodeAt(i)
		const v = code < 128 ? DECODE_TABLE[code] : -1
		if (v >= 0) sextets.push(v)
	}
	const byteLen = Math.floor((sextets.length * 6) / 8)
	const out = new Uint8Array(byteLen)
	let bitBuffer = 0
	let bitCount = 0
	let o = 0
	for (let i = 0; i < sextets.length; i++) {
		bitBuffer = (bitBuffer << 6) | sextets[i]
		bitCount += 6
		if (bitCount >= 8) {
			bitCount -= 8
			out[o++] = (bitBuffer >> bitCount) & 0xff
		}
	}
	return out
}

/** Encode bytes → base64url (no padding, RFC 4648 §5). */
export function base64urlEncode(bytes: Uint8Array): string {
	return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Decode base64url (or base64) → bytes. */
export function base64urlDecode(s: string): Uint8Array {
	return base64ToBytes(s)
}
