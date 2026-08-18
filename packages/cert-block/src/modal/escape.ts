/**
 * HTML escaping for the cert MODAL string builder — a BYTE-FAITHFUL relocation of
 * the portal's `escapeHtml` (the exact `.replace` chain the deployed `certrev-cert.js`
 * was bundled from).
 *
 * ⚠ Deliberately SEPARATE from `../components/escape.ts`: that SSR helper encodes the
 * apostrophe as `&#39;`, THIS one as `&#039;`. They render identically in a browser, but
 * this module is a byte-frozen relocation of the live Shopify asset, so it must reproduce
 * portal's exact `&#039;` bytes — the two escapes are NOT interchangeable here. (Unifying
 * them is a deliberate post-publish follow-up, tracked with the unification program.)
 *
 * The two files are separate about BYTES and identical about TYPES: `asText` below mirrors
 * `../components/escape.ts`'s guard of the same name, for the same reason. This escape runs
 * downstream of a `JSON.parse(...) as CertDeliveryEnvelope` cast, and `verifyEnvelope` checks
 * the SIGNATURE, never the SHAPE — so a number / object / array arrives where the contract
 * promised a string, and `text.replace` on one is a `TypeError`. In the browser that throw
 * takes down the dialog the reader clicked, so the family's contract is NEVER THROW.
 */

/**
 * Coerce an untyped value to renderable text — byte-for-byte the same rule the components
 * copy applies: a string passes through UNTOUCHED (the escape chain below is the only XSS
 * boundary the modal has, and any change to its string output is a security regression);
 * a finite number renders as its digits; everything else — null, undefined, booleans,
 * objects, arrays, NaN/Infinity — renders as empty.
 *
 * Deliberately not `String(input)`: blind coercion splices `[object Object]` (or a hostile
 * `toString`'s payload) into the dialog, and on a null-prototype object it throws the very
 * TypeError this exists to prevent. A value that is not text is not copy.
 *
 * Exported for `cert-modal-view.ts`, whose pre-escape `.trim()` reads need the same guard —
 * a coercion applied only inside `escapeHtml` would still leave the dereference above it
 * throwing. Modal-internal (the `/modal` entry does not re-export it).
 */
export function asText(input: unknown): string {
	if (typeof input === "string") return input;
	if (typeof input === "number") return Number.isFinite(input) ? String(input) : "";
	return "";
}

export function escapeHtml(text: string | null | undefined): string {
	return asText(text)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}
