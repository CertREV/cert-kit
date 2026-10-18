/**
 * The CertREV mark the reader face paints in the card cap (18px) and the memo footer (17px): the demo's own logo
 * files, `logo-white.svg` (the cap on a dark accent) and `logo-mono.svg` (the verified footer, and the cap on a light
 * accent), as the base64 `data:image/svg+xml` URIs of their exact bytes. That is what the portal's Liquid parity engine
 * prints for the Shopify snippet's `asset_url`, so a Builder page and a Shopify page carry the same image, and what
 * certrev.com's own `<img>` elements point at.
 *
 * The URIs live in `logo-assets.generated.ts`, written by `scripts/refresh-reader.mjs` from the portal's copies of
 * the two files; `reader-logo-files.test.ts` decodes each and pins the sha256 of its bytes. The golden tests compare
 * the whole element, so a different image fails there.
 */
import { escapeHtml } from '../components/escape.js'
import { LOGO_MONO_DATA_URI, LOGO_WHITE_DATA_URI } from './logo-assets.generated.js'

export type ReaderLogoInk = 'white' | 'mono'

/** The `<img>` for the mark: `size` is the pixel width and height, `alt` is '' where the words carry the meaning. */
export function readerLogo(ink: ReaderLogoInk, size: number, alt: string): string {
	const src = ink === 'white' ? LOGO_WHITE_DATA_URI : LOGO_MONO_DATA_URI
	return (
		`<img src="${src}" ` +
		`alt="${escapeHtml(alt)}" width="${escapeHtml(String(size))}" height="${escapeHtml(String(size))}" decoding="async">`
	)
}
