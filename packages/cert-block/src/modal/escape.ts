/**
 * HTML escaping for the cert MODAL string builder — a BYTE-FAITHFUL relocation of
 * portal `src/lib/utils/html.ts` `escapeHtml` (the exact `.replace` chain the deployed
 * `certrev-cert.js` was bundled from — POR-10721 W2).
 *
 * ⚠ Deliberately SEPARATE from `../components/escape.ts`: that SSR helper encodes the
 * apostrophe as `&#39;`, THIS one as `&#039;`. They render identically in a browser, but
 * this module is a byte-frozen relocation of the live Shopify asset, so it must reproduce
 * portal's exact `&#039;` bytes — the two escapes are NOT interchangeable here. (Unifying
 * them is a deliberate post-publish follow-up, tracked with the unification program.)
 */

export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}
