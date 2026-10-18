/**
 * The reader stylesheet as the Builder card inlines it (1.2.0): `READER_CSS` without its remote `@font-face` rules.
 *
 * The portal's reader CSS loads its faces from `https://assets.certrev.com/fonts/…`. A storefront whose CSP
 * `font-src` does not name that origin (e.l.f.'s live policy names `'self' data:` and a list of font CDNs, no
 * CertREV origin) refuses each load and logs a violation, and the text falls back anyway. So the card ships only the
 * `local()` fallback faces (Arial or Times New Roman under each family's metric overrides), which need no CSP at all:
 * the face looks the same as it does on a page that blocks the remote fonts, with nothing refused. The portal and the
 * Shopify reader keep `READER_CSS` unchanged.
 *
 * INTERNAL: not on the package `exports` map.
 */

import { READER_CSS } from '../reader/reader-css.generated.js'

/** One `@font-face { … }` rule whose body has a `url(`; the reader CSS has no nested braces inside a face rule. */
const REMOTE_FONT_FACE = /@font-face\s*\{[^{}]*\burl\([^{}]*\}\s*/g

export const CARD_READER_CSS = READER_CSS.replace(REMOTE_FONT_FACE, '')
