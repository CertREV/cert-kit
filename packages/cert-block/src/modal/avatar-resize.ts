// ⚠ VENDORED, BYTE-FAITHFUL relocation of portal `src/lib/cert-delivery/avatar-resize.ts`
// (POR-10721 W2). The body is byte-identical to the source the deployed `certrev-cert.js`
// was bundled from — keep it that way. Configurable asset origins for other headless
// brands are a deliberate post-relocation follow-up (byte-parity takes precedence now).
/**
 * Avatar right-sizing (POR-10470) — the SINGLE source of truth for how a cert contributor/expert
 * headshot URL is rewritten to a display-sized derivative. Referenced by the cert MODAL (TS,
 * cert-modal-view.ts), mirrored by the Liquid snippet (certrev-avatar-url.liquid), and by the
 * Cloudflare size-allowlist WAF rule (infra/terraform/cloudflare). Keep the three in lockstep — the
 * `avatar-resize.test.ts` `SIZES`/param assertions are the tripwire.
 *
 * Architecture (Fable-reviewed): the signed cert envelope carries ONE canonical full-res photoUrl
 * (also the JSON-LD Person.image — never shrunk). Display sizing is a PRESENTATION concern, applied
 * here via Cloudflare Image Resizing on the same zone as assets.certrev.com:
 *   https://assets.certrev.com/cdn-cgi/image/width=W,height=W,fit=cover,format=auto/<path>
 * Same-zone (assets.certrev.com is a custom domain on certrev.com), so no cross-origin origin
 * allowlist is needed; format=auto serves webp/avif; the transform is cached + billed per-unique.
 *
 * ENABLEMENT GATE (`AVATAR_RESIZE_ENABLED`): OFF until Cloudflare Image Resizing is enabled on the
 * certrev.com zone AND a real photo is verified to resize (POR-10470 gate). While OFF, avatars use
 * the raw canonical URL — byte-identical to today's behavior — so the extension can deploy for the
 * font de-block with ZERO avatar regression (a cdn-cgi/image URL 404s → initials fallback if the
 * feature isn't live). Going live is a one-line flip here + in certrev-avatar-url.liquid, then the
 * raw branch is removed (flag-debt: tracked as the POR-10470 avatar go-live follow-up).
 */

/**
 * Enablement gate — LIVE as of 2026-07-20 (POR-10656). Cloudflare Image Resizing (Transformations)
 * is enabled on the certrev.com zone (`image_resizing = on`), and the size-allowlist WAF rule
 * (ruleset 7c9df62e88cb4713b18f12853651af08) is verified enforcing on `/cdn-cgi/image/` paths — a real
 * photo resizes (`width=84` → 200 image/jpeg) while a disallowed size (`width=999`) is 403-blocked.
 * Kept as a one-line kill-switch: flip back to `false` + redeploy to instantly revert to raw URLs if
 * resizing ever misbehaves (removing the raw branch entirely is the flag-debt follow-up, POR-10680).
 */
export const AVATAR_RESIZE_ENABLED = true;

/**
 * The closed size menu (display px @2x for retina). Must equal the widths the Cloudflare WAF rule
 * allowlists — an open resizer lets anyone mint unbounded transforms (per-unique billing = a cost
 * DoS). 42→84 (card), 56→112 (memo + modal cert), 64→128 (modal reviewer), 144 = headroom.
 */
export const AVATAR_SIZES = [84, 112, 128, 144] as const;
export type AvatarSize = (typeof AVATAR_SIZES)[number];

/** The R2 asset hosts we own + resize. Anything else is returned untouched (host-guard). */
export const AVATAR_RESIZE_HOSTS = [
	"assets.certrev.com",
	"staging-assets.certrev.com",
] as const;

/**
 * The canonical transform options (order is load-bearing — the WAF allowlist matches this EXACT
 * string). `onerror=redirect` (same-zone) degrades a fatal transform to the original image rather
 * than a broken avatar. If this string changes, the Cloudflare allowlist + certrev-avatar-url.liquid
 * + the tripwire test must change in lockstep.
 */
export function avatarTransformOptions(size: AvatarSize): string {
	return `width=${size},height=${size},fit=cover,format=auto,onerror=redirect`;
}

/**
 * Pure wrap (ignores the enablement gate) — rewrite a full-res avatar URL to a display-sized
 * cdn-cgi/image derivative when the host is one we own. Everything else (foreign host, non-https,
 * malformed, already-a-cdn-cgi URL) returns the input unchanged, so this can never break a URL or
 * double-wrap. Kept separate from the gate so the wrapping logic is unit-testable before go-live.
 */
export function buildResizedAvatarUrl(
	url: string | null | undefined,
	size: AvatarSize,
): string {
	const raw = (url ?? "").trim();
	if (!/^https:\/\//i.test(raw)) return raw;
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return raw;
	}
	if (!(AVATAR_RESIZE_HOSTS as readonly string[]).includes(parsed.hostname))
		return raw;
	if (parsed.pathname.startsWith("/cdn-cgi/image/")) return raw; // never double-wrap
	// Drop any query string: the transform request must carry an EMPTY query so the WAF allowlist's
	// `query eq ""` pin holds (a photoUrl query would otherwise both bust the cache and trip the rule).
	const path = parsed.pathname.replace(/^\//, "");
	return `${parsed.origin}/cdn-cgi/image/${avatarTransformOptions(size)}/${path}`;
}

/**
 * The enablement-gated entry point used by the render surfaces. Until Cloudflare Image Resizing is
 * verified live (`AVATAR_RESIZE_ENABLED`), returns the raw canonical URL — so nothing 404s on a host
 * whose resizing isn't enabled. After go-live it delegates to the (already-tested) pure builder.
 */
export function resizeAvatarUrl(
	url: string | null | undefined,
	size: AvatarSize,
): string {
	if (!AVATAR_RESIZE_ENABLED) return (url ?? "").trim();
	return buildResizedAvatarUrl(url, size);
}
