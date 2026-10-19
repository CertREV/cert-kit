# Changelog: @certrev/cert-block

The cert card is a **design-locked** component. Semver contract: **patch and minor releases never
change the rendered cert output and never break a compiling integration** (registration surface,
exports, types). Anything that would alter what a visitor sees, or require integration changes,
is announced loudly here first.

## 1.3.0 · 2026-10-18

Minor: **a `delivery` card can paint the face CertREV rendered for the brand's design, when the signed envelope binds
it.** Backward compatible: **with no delivered face, or an envelope without `faceDigest`, the card renders exactly what
1.2.1 renders, byte for byte** (the server's HTML and its seed, hydration, a streamed record, a fallback record, a
`clientRead` read). A block without the marker and a pinned card are untouched, and no integration needs a code
change. Like 1.1.0's marker, the new face is switched on from CertREV's side, never by the upgrade: it takes an
envelope minted with a `faceDigest` (`@certrev/cert-contract` 0.6.0) AND a Delivery response serving the face it hashes.

- **A delivered face, bound by a signed digest.** The Builder Delivery response may carry an unsigned top-level
  `face: { html, css }` beside `payload`, `signature` and `renderDef`. The signature does not cover it; the signed
  `payload.content.faceDigest` (`{ v: 1, defVersion, html, css }`, the lowercase hex sha256 of each half's UTF-8
  bytes for one saved design version) binds it. The card paints the delivered face only when ALL of these hold: the
  verdict is `render`; the card is not pinned; the block shows the whole card (below); the verified content carries a
  `faceDigest` with `v: 1`; a well-formed face was served; a `renderDef` was served and its `v` is
  `faceDigest.defVersion`; and sha256(html) and sha256(css), computed with WebCrypto (`crypto.subtle.digest`, the
  global the kernel already verifies with), equal the signed values. It then paints `<style>` + css + `</style>` +
  html inside the card's usual wrapper, which keeps `data-certrev-cert-chrome`, `data-certrev-delivery`,
  `data-certrev-strings-version`, `data-certrev-def-version` and the seed, and gains
  `data-certrev-face="delivered"`. It paints in place of the legacy or reader face, with no reader stylesheet and no
  sidebar flow rules.
- **A split banner keeps its own halves.** The delivered face is a whole design, so only a block whose `part` is
  absent or `'full'` (or null, or a value `renderCertBlock` does not recognise, which it paints as the full card)
  paints it. A block with `part: 'header'` or `part: 'memo'` paints its own part as 1.2.1 does, and hashes nothing.
  The block's `mode` is not consulted: the delivered face carries the design's own layout.
- **The browser re-checks the face before it paints it.** A server that painted the delivered face ends the seed with
  the same `face`: `{ v: 1, baseUrl, externalId, payload, signature?, renderDef, face }`. A seed without one is the
  1.2.1 seed byte for byte. The browser repaints the face from the seed (hydration, a later client mount, a record
  streamed in while the page loads) only after hashing it against the seed payload's own `faceDigest`, for the
  seed's def; a `clientRead` read is judged as the server judges it. A seed with no `face`, a malformed one, or one
  whose hashes fail paints what 1.2.1 paints for it. While a card hydrates over the server's delivered face and the
  browser cannot confirm it (no WebCrypto, as on an insecure `http:` page), it adopts the server's element without
  rendering that markup, and the render right after hydration replaces it with the face 1.2.1 paints, with no
  hydration error. A card hydrating a delivered face suspends once while WebCrypto hashes it, and keeps the server's
  HTML on screen meanwhile; the hashes are memoized by the face's content, so one face is hashed once per process.
- **Page weight.** The face is on the page twice: painted, and in the seed, where JSON and attribute escaping add
  between a few percent and about 60% (more for quote- and markup-dense HTML). A face the size of the 1.2.1 reader
  card (about 43 KB with its stylesheet) adds about 46 KB to the seed, uncompressed. The delivered face replaces the
  card's own face, so the painted half costs about what the reader face did.
- **Fails closed as before.** A digest rewritten in transit fails the signature, so the card renders nothing and
  writes a `"none"` record, as for any tampering. Markup whose bytes do not hash to the signed digest is never
  painted, and a WebCrypto failure counts as a mismatch.
- **New API, all additive.** Root: `parseDeliveredFace` (the face sibling's shape check, as `parseRenderDef` is the
  def's), the `DeliveredFace` type and the `CertFaceDigest` contract type. `VerifiedDelivery` and `CachedDelivery`
  gain an optional `face`, present only on a `render` verdict whose response carried a well-formed face, so a read
  with no face is the 1.2.1 object exactly. **`face` is carried unverified:** a `getVerifiedDelivery` caller that
  paints it must check it against the digest first, as the card does.
- **Dependency.** `@certrev/cert-contract` is now `^0.6.0` (was `^0.5.0`), for `CertFaceDigest`. The `^0.5.0` range
  did not match the workspace's 0.6.0, so `pnpm -r build` on a cold tree built cert-block before cert-contract and
  failed; it now builds in order.
- **Unchanged:** every face 1.2.1 paints, the seed and fallback records without a face, the stale window and the
  deadline, the pinned card, the options path (no marker), the registration and inputs, the web component, and the
  storefront modal bundle (`src/modal/*` and `dist/modal/certrev-cert.js`: nothing it bundles changed).
- **Tests.** `builder/__tests__/delivered-face.test.tsx` (server) and `delivered-face-client.test.tsx` (jsdom):
  the delivered face on the server for the legacy, the legacy-without-hidden-fields and the reader defs (exact bytes,
  the seed the 1.2.1 seed plus the face); every other case of the matrix (17 failing deliveries per def, the two
  split-banner parts, the pinned card, a tombstone) against `__golden__/delivered-face-1.2.1.json`, rendered by the
  unmodified 1.2.1 card; the browser's hydration (same node, no read, no error), client mount, streamed record and
  `clientRead` with a face, and with a face the browser cannot confirm, against `__golden__/delivered-face-client-1.2.1.json`;
  1.2.1's server HTML hydrating as served; tampering; and the seed's `face` parse and write. `delivered-face-use.test.tsx`
  pins the one promise per face a React 19 `use` replays. `get-verified-delivery.test.ts` gains the face sibling's
  parse, cache and settle. No existing expectation changed.

## 1.2.1 · 2026-10-09

Patch, stable (dist-tag `latest`): **1.2.1-canary.0, below, as a stable release.** A card the browser renders while
the page is still loading waits for the record a streaming server sends after it, so a phone's first load of a
streamed page keeps its card. The source is the canary's, byte for byte; only the version stamps change. No
integration change, and the rendered cert output is unchanged: a card that hydrates, a `clientRead` card and a card
mounted after the page has loaded paint exactly as in 1.2.0. The profile and certificate modals for the Builder card
are not in this release.

## 1.2.1-canary.0 · 2026-10-07

Patch, canary tag only: **a card the browser renders while the page is still loading waits for the record a
streaming server sends after it, instead of painting the options face (or nothing) and never looking again.** No
integration change; a card that hydrates, a `clientRead` card and a card mounted after the page has loaded paint
exactly as in 1.2.0.

- **The loss it fixes (the judge's round 15, CertREV's canary replica on 1.2.0).** On a phone's first load of a pinned
  URL, the one document response held the card at the pinned version, but no card was ever attached to the page. A
  streaming host (Hydrogen, React Router 7) sends a visitor's browser the page's shell first; a card whose server
  read is still running streams later, in a hidden `<div id="S:0">` after `</html>`, with a script (`$RC`) that moves
  it into its Suspense boundary. A local replay of the served page found two ways React renders the card on the
  client before that part arrives: an update that reaches the waiting boundary (React error #421: React deletes the
  boundary and client-renders it, and `$RC` then drops the part), and a hydration mismatch above it (#418, #425, then
  #423: React client-renders the whole document, removing the server's `<html>`, and the parser goes on writing the
  stream into that detached tree, where no script runs). Either way the card mounted with no record in the page and,
  with no `clientRead`, painted the block's options face, or nothing for the replica's block, which has no options.
- **Now** (`StreamedRecordCard`, `watchStreamedRecords` in `ssr-seed.ts`): a card the client renders while
  `document.readyState` is `loading`, with no record in the page and no `clientRead`, paints nothing and waits. One
  `MutationObserver` per page watches the document and the `<html>` element the server sent (held from module load
  and from the card's first render, so React's whole-document render cannot take it away first); every record it
  sees is kept, even one `$RC` removes a moment later. When the card's own record arrives it paints exactly what the
  record says: the server's face (judged at the browser's clock, as a hydrated card is), the options face, or
  nothing. When the page has loaded (`DOMContentLoaded`) the watch scans once more, the document and the removed
  `<html>`, and stops; a card still without a record then paints what a client mount paints (the options face, or
  nothing). A browser with no `MutationObserver` gets that last scan only. No browser read, ever.
- **Unchanged:** the server's render and its record; hydration (a card in front of its own server HTML); a card
  mounted after the page has loaded (an in-app navigation, Builder's editor); `clientRead`; a pinned card takes only
  a record carrying its pin.
- **Tests:** `src/builder/__tests__/streamed-record-card.test.tsx` (jsdom; 14 tests): the #421 path, the #423 path
  with and without `MutationObserver`, the replica's pinned card, a pinned card and an unpinned record, no record,
  streamed options and none records, an expired seed, `clientRead`, a loaded page and hydration unchanged, and
  `streamedRecordFor`. Positive controls: with the wait disabled 8 of the 14 fail; without the observer on the
  server's `<html>` the #423 test fails; without the last scan of it the no-`MutationObserver` test fails.

## 1.2.0 · 2026-10-06

Minor, the first stable release with the `delivery` card's reader face (dist-tag `latest`). It follows
`1.2.0-canary.5` (the design pin, below, is part of it) and adds these changes: **the delivery card never reads
from the browser unless the brand opts in, so no storefront needs a Content-Security-Policy change**, **a card whose
server could not reach CertREV paints the block's own options face, never nothing**, **the server's read waits 8 s
and serves a certificate stale while it refreshes**, **a field the def hides is absent from the page**, **the reader
face's avatar shows the person's initials where it has no photo to paint, or a photo fails to load**, and **the
reader sidebar card's float leaves its Builder block** (canary.6). No integration needs a code change, and an
options-only block is untouched.

- **No browser read by default; the options face when CertREV is not reached (the 1.2.0 re-cut).** A proof run on a
  cold staging read found the failure this release exists to remove: the server's read missed the verifier's 3 s
  deadline, so the server painted no card, and the browser's own read was then blocked by the storefront's CSP. Now:
  - The card **never fetches from the browser** unless the block opts in with the new `clientRead` prop (code only,
    not a Builder input). A card the browser renders with no server render behind it paints the block's options face,
    or nothing (a block with no options).
  - Where the server has no envelope it writes a **fallback record** in the seed attribute,
    `{ v: 1, baseUrl, externalId, design?, face }` with `face` `"options"` or `"none"` and nothing of a certificate.
    CertREV not reached (a 5xx, a body that is not an envelope, a network error, the deadline) paints the block's
    own **options face**, the 1.0.3 bytes, in the block's `mode`, else its def's `layout`, else the banner; a block
    whose options cannot paint writes `"none"`. A pinned card (canary.5's design pin, CertREV's replica) paints the
    options face too, with a record naming its pin, so the replica shows what a brand's page shows: of canary.5's
    fail-closed list below, only the 503 changes. A definitive no (revoked, expired, unverifiable,
    another entry, a 404 or 410) still paints nothing, with `"none"`, so the options face never paints over a
    revocation. The browser keeps the recorded face through hydration and through React's client re-render after a
    hydration error, with no read.
  - The card runtime's server read waits **8 s** (`CARD_DELIVERY_TIMEOUT_MS`; `getVerifiedEnvelope` and
    `getVerifiedDelivery` keep their 3 s default). Its cache gains `staleMs` (5 minutes, `CARD_DELIVERY_STALE_MS`):
    past the 60 s TTL a certificate is served at once while ONE background refresh runs (stale-while-revalidate),
    and kept while CertREV cannot be reached (stale-if-error); a definitive refusal replaces it as soon as its
    refresh lands, and a negative entry is never served stale. `inflightMaxMs` (deadline + 2 s) lets the next render
    start a new load instead of joining one the host runtime abandoned. `TtlCache` without the new options behaves
    exactly as before.
  - A reviewer photo that **fails to load** (a CSP `img-src` block, a 404) is repainted as the person's initials,
    whether it failed before hydration or after; the record is unchanged and nothing is requested.

- **The browser hydrates from the server's read (no browser fetch).** Through canary.5 a `delivery`-marker
  card read the Delivery API on the server and again in the browser on hydration; a storefront whose CSP
  `connect-src` names no CertREV origin blocked the second read, the read settled as a suppress and the
  server's card vanished. The face's wrapper now carries the envelope it was painted from,
  `data-certrev-envelope` = `{ v: 1, baseUrl, externalId, design?, payload, signature?, renderDef }` (the payload
  as served, less hidden fields, below; `src/builder/ssr-seed.ts`), and the browser hydrates from it with zero
  requests. After hydration the card re-runs the lifecycle and subject policy at the browser's clock, so an
  expiry that passes while the page is open still takes it down. A card the browser mounts later paints
  from any seed the page carried for the same placement. A card with no server render behind it (a
  client-only page, Builder's editor preview) makes no read unless the block opts in with `clientRead`
  (above); where an opted-in read is blocked or fails it renders nothing and logs nothing, and it never
  unmounts the host's tree. A pinned card
  (canary.5's `certrevDesignPin`) takes only a seed carrying the same pin, and the seed records it.
- **Server render or browser hydration is decided from the page, with no switch.** The card used to ask the
  delivery runtime's `isServer()`, which defaulted to `typeof document === 'undefined'`; a `react-dom/server` render
  under jsdom (or any DOM shim) therefore took the browser path and painted `<!--$--><!--/$-->`. The seam is gone.
  A card with no `document` is a server; a card past hydration or mounted on the client is a browser; a card that is
  hydrating is a browser only when the live document already holds server-rendered HTML in front of it (this
  placement's seed, or any React Suspense boundary marker, which the card's own `<Suspense>` always leaves) and is a
  server render otherwise. One case is not seen: a server render run while the document still holds server-rendered
  React HTML is taken for a hydration, so a harness that hydrates one page and renders another into the same document
  clears it between them.
- **A hidden field is absent from the page.** The seed (and so the page source) used to carry the reviewer's photo
  URL even where the def hides `reviewerPhoto` or the payload's `display.showExpertPhoto` is `false`, and the memo text
  where the def hides `memo`. Now the payload is stripped of what is hidden before the card paints and before it writes
  the seed: `reviewerPhoto` removes `content.expert.photoUrl` and `content.author.photoUrl`, `display.showExpertPhoto:
  false` removes the same two (whatever the def hides; only a literal `false` counts, as the reader face reads it), and
  `memo` removes `content.memo`. The face is painted from the
  stripped payload, on the server and in the browser, so the two stay identical. The seed then **carries no
  signature**: it signs the full payload, a stripped one no longer verifies, the browser never re-checks a seed's
  signature (it re-runs the lifecycle and subject policy only, which read nothing that is stripped), and a pair that
  fails to verify would only mislead. A seed that stripped nothing keeps the signature. `content.expert.compensationCue`
  is never stripped: it is a locked disclosure, and the banner, the memo and the sidebar paint "Compensated expert" from it (the floating pill's own markup carries no
  disclosure line, as in the portal's snippets; the modal it opens paints the cue). One visible
  consequence: a reader def that hides `memo` now paints no memo on the Builder card (the reader face called directly,
  and the portal's snippets, still paint the memo they are given).
- **The reader face's avatar is the person's initials where it has no photo to paint.** The silhouette is now the
  fallback for a name with no initials, not for a missing photo. A photo that is missing or unsafe, `display.showExpertPhoto:
  false`, and a def that hides `reviewerPhoto` (which used to remove the avatar altogether, and now removes the photo:
  its URL is never written) all paint the initials. The initials are fixed bytes the portal's Liquid and PHP twins
  print too: trim the name, split on single spaces and skip the empty parts (so "Jane  Doe", two spaces, is "JD"), drop a
  leading dr, mr, mrs, ms, prof or mx (with or without the dot), take the first character of each of the first two
  parts left, uppercase, and paint exactly
  `<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><text x="20" y="20" text-anchor="middle"
  dominant-baseline="central" font-size="15" font-weight="700">JD</text></svg>`, escaped. It applies to every avatar of the face
  (the sidebar reviewer, the banner and memo reviewer, and the banner's writer under the writer's own name). A photo that is
  painted is the same `<img>` as before.
- **The reader card loads no font file.** Its inlined `<style>` is `READER_CSS` without the 40 remote
  `@font-face` rules (`https://assets.certrev.com/fonts/…`), so the card needs no `font-src` and logs no
  violation on a strict CSP. The four metric Fallback faces stay, so text paints in Arial and Times New Roman
  sized to the demo's fonts and the layout holds. `READER_CSS` and `./reader.css` are unchanged and still
  carry all 44 rules: a host that wants certrev.com's faces links `./reader.css` and allows the origin.
- **The reader sidebar card's float leaves its Builder block (canary.6).** Builder serves a page's blocks as a flex
  column (`.builder-blocks`), and each block (`.builder-block`) is a flex item, which is a formatting context of its
  own and so contains a float. The block around a reader sidebar card therefore spanned the whole column at the
  aside's height (at 1280: 1208 px wide), and no copy could sit beside the aside. A reader face now paints one more
  element right after its wrapper: `<style data-certrev-builder-flow="">` holding `BUILDER_SIDEBAR_FLOW_CSS`
  (exported from `./builder/cert-review-card`). Its three rules apply only above the reader CSS's own stacking
  breakpoint (`@media not all and (max-width: 820px)`), and only in a Builder column holding a reader SIDEBAR card
  as `.builder-blocks > .builder-block > [data-certrev-face="reader"] > .certrev-reader > .certrev-r-side`:
  - that column becomes `display: flow-root`;
  - the card's block and the face's wrapper become `display: block`, so they take no height and the aside is the
    box the copy flows around.

  Any other column, a card that is not a direct child of a Builder block, the stacked widths and a browser with no
  `:has()` keep their layout. In a column the rules do apply, its blocks lay out as blocks: `align-self` has no
  effect there, and vertical margins between blocks collapse. `reader-face-sidebar-flow.test.tsx` pins the element,
  the breakpoint read from the reader CSS, and what the rules select in a Builder-shaped page.
- **Bytes.** The legacy face's HTML is unchanged. The reader face's is unchanged except the avatars above and the
  flow rules' `<style>` after the wrapper. The wrapper of either gains the one attribute, and the card's inlined
  stylesheet loses the remote font faces. The cache
  keeps the envelope's signature beside the verdict so the seed can carry it.
- **Tests.** `delivery-card-hydrate.test.tsx` (rewritten: zero browser reads on hydration for both faces, the
  same DOM nodes, the seed verifying against the issuer key, revoked and browser-clock-expired cards, a later
  client mount, the options and none records kept through hydration and through a client re-render after a
  hydration error with no read, the no-record client mount making no read without `clientRead` and with it reading
  once or failing closed silently, a broken or pre-failed photo repainted as initials, every server render under
  jsdom with no switch), `delivery-card.test.tsx` (each unreachable case paints the 1.0.3 options face byte for
  byte with an options record; the def layout and an editor's mode; a pinned card's options record; the 8 s deadline; a
  read slower than 3 s still painting; the stale window over a CertREV outage), `cache.test.ts` (new: the stale
  window, stale-if-error and the in-flight limit, and the cache unchanged without them) and `ssr-seed.test.tsx` (the seed and fallback-record parsers' refusals, `withoutPhotos`, the design pin in the seed key, the hidden-field
  strip and the signature decision, and a card stylesheet with no font URL). The reader tests gain the initials
  cases (`reader-initials.test.ts`).

## 1.2.0-canary.5 · 2026-10-06

Minor, still on the `canary` dist-tag. It adds a design pin for CertREV's own canary replica (the judge's Part 3,
route a). **Output without a pin is unchanged.** A card with no pin reads the same Delivery URL, under the same
cache key, and paints the same bytes as canary.4. The faces, the stylesheet, the modal, `CERT_FONT_FACE_CSS` and
`@certrev/cert-contract` are as they were. No integration needs a code change, and production brands never send
a pin.

- **The pin.** Builder `<Content>`'s `context` prop may carry `certrevDesignPin` (`{ design, designBrand? }`).
  The card reads it from `builderContext.context`. A pinned card reads
  `<base>/api/cert/v1/delivery/builder/<entryId>?design=<version>[&designBrand=<brandKey>]`. The version must
  match `/^[1-9][0-9]{0,8}$/` and the brand `/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/`; the brand is sent
  URL-encoded. The pinned read gets its own cache entry and suspense key.
- **Fail-closed.** A pinned card paints only a reader def (`face: 'reader'`) at exactly the pinned version, and
  never the live design in its place. Each of these renders nothing:
  - a pin that cannot be read, with no fetch;
  - a pin on a block without the `delivery` marker, with no fetch;
  - a 404 (`no_design`) or 503 from the API;
  - any other def: none, malformed, legacy, an unknown face, or another version.

  A missing pin is `undefined` or `null`, including a missing or empty `context`. Such a card is the unpinned
  card.
- **API.** These are new on `.` and `./builder`:
  - `DesignPin` (`{ version, brand? }`);
  - `parseDesignPin(raw)`, which returns a `DesignPin`, `'invalid'` or `undefined`;
  - `designPinFromUrl(url)`, which returns `{ design, designBrand? }` from a URL's query, or `undefined`, and
    never throws.

  `GetVerifiedDeliveryOptions` gains an optional `design`. `deliveryUrl`, `deliveryCacheKey`,
  `peekVerifiedDelivery` and `invalidateDelivery` take it. Without it, they build exactly what canary.4 built.
- **Tests.** There are two new files:
  - `design-pin-card.test.tsx`, which covers the card through the real delivery path;
  - `design-pin-card-use.test.tsx`, which covers the React 19 `use` path, with one promise per read.

  `get-verified-delivery.test.ts` adds the pinned URL, key and cache, and the grammar tables for
  `parseDesignPin` and `designPinFromUrl`. One of those checks is that the unpinned key is unchanged. No
  existing test changed.

## 1.2.0-canary.4 · 2026-10-05

Minor, still on the `canary` dist-tag: the judge's round 6 E1 (portal `1ff942fff6`). **Legacy output is
unchanged**: a def without `face: 'reader'` paints the 1.1.1 bytes, and the modal, `CERT_FONT_FACE_CSS` and
`@certrev/cert-contract` are as they were. No integration needs a code change.

- **The banner foot's cue is plain words (E1).** The reader banner's foot read `Compensated <a …>expert</a>`, and
  the stylesheet's `.certrev-reader .certrev-r-foot a` rule underlined the link, so every banner drew a 1 px line
  under "expert" that the demo's foot does not have (the demo's foot is plain text). The cue is now
  `<span>Compensated expert</span>` and the rule is gone. The words are unchanged (`COMPENSATED_EXPERT_CUE`); the
  reviewer's profile stays one click away through the card's or the memo's "View … profile" link, which opens the
  same modal. Three goldens changed on this account (the banners of navy-full, gold-serif-sharp-full and
  burgundy-mono-pill-nophoto, the three cued cells), each by exactly the link; the sparse cells carry no cue.
- **Stylesheet.** `reader.css` is the portal's generated section byte for byte without the 4-line foot-link rule
  (31,558 bytes, sha256 `7ce6f09e...d10e`; full value in `src/reader/__tests__/fixtures/SOURCES.json`).
- **Tests.** Goldens, the oracle cells and SOURCES.json come from portal `1ff942fff6` by
  `pnpm refresh:reader --portal --oracle`; the stylesheet pin in `reader-face-card.test.tsx` follows. Nothing is
  loosened: every golden and differential test still compares byte for byte.

## 1.2.0-canary.3 · 2026-10-04

Minor, still on the `canary` dist-tag: the reader face brought to the portal's M9 reader (the judge's round 3
text and image leaves; portal `d232d7e2ae`). **Legacy output is unchanged**: a def without `face: 'reader'`
paints the 1.1.1 bytes (the 1.1.1 golden still passes), an options-only block never reads the def, and the
modal, `CERT_FONT_FACE_CSS` and `@certrev/cert-contract` are as they were. No integration needs a code change.

- **The logo is the demo's own file (R3-W2 / R3-S2 b).** certrev.com's reader card prints `<img>` elements that
  point at `logo-white.svg` and `logo-mono.svg`, and the judge compares the `src`. The face's logo was a
  redrawn inline mark. It is now the two files themselves, as base64 `data:image/svg+xml` URIs of their exact
  bytes, which is what the portal's Liquid parity engine prints for the Shopify snippet's `asset_url`:
  `logo-white.svg` on a dark accent's cap, `logo-mono.svg` in the verified footer and on a light accent's cap
  (sha256 `3c819f65...2d07` and `da906f44...3c3e`, 9,289 bytes each). They are bundled in
  `src/reader/logo-assets.generated.ts`, written by `pnpm refresh:reader` from the portal's copies; it is still
  a `data:` URI, so no host `img-src` changes, and the face still makes no request. Eight goldens changed on
  this account, in the `<img src>` only: the banner and sidebar of navy-full, gold-serif-sharp-full,
  burgundy-mono-pill-nophoto and navy-sparse. The two files' bytes make a banner with a memo (it paints both)
  about 22 KB larger in its server HTML.
- **Scope text nodes (R3-W2 / R3-S2 a).** The cue's separator in the scope line is followed by an empty
  `<!-- -->` (`<em>Illustrative example</em> · <!-- -->Independent editorial review ...`, and the same after
  `<em>Compensated expert</em>`), as the demo's React server render leaves it: the element's DOM holds " · " and
  the sentence as two text nodes, which is what the judge compares. The comment is not text, so the
  `data-ftc-line` element still reads `{cue} · {sentence}` and the FTC sentence is byte-exact. With no cue there
  is no separator and no comment. Six goldens changed on this account (the banner and the sidebar of the three
  cued cells, navy-full, gold-serif-sharp-full and burgundy-mono-pill-nophoto), each by exactly the inserted
  comment; the sparse cells carry no cue and are unchanged.
- **Wrapper armor.** The stylesheet ends with the portal's rule
  `:is(.certrev-card-wrap, .certrev-memo-wrap):has(.certrev-reader) { margin-block: 0 !important; padding: 0 !important; }`
  (WordPress's block-gap margin and Shopify's body-fallback padding stacked on the card's own). The Builder face
  paints neither wrapper, so the rule matches nothing on a Builder page; it is carried because `reader.css` is the
  portal's generated section byte for byte (31,664 bytes, sha256 `5f90e70a...a466`; full value in
  `src/reader/__tests__/fixtures/SOURCES.json`). Nothing else in the stylesheet changed.
- **Not in this release.** The portal's trimmed Liquid doc comments and its rebuilt WordPress zip change nothing
  here: no renderer, stylesheet or golden of the Builder face depends on them.
- **Tests.** New: `reader-logo-files.test.ts` (the two files' sha256, the white/mono choice per accent, no inline
  mark left) and `reader-scope-text-nodes.test.ts` (the scope line's DOM shape, cued, illustrative and uncued).
  Goldens, the oracle cells (236, now carrying the data URIs) and SOURCES.json, which now also records the two
  logo files, come from portal `d232d7e2ae` by `pnpm refresh:reader --portal --oracle`; the script now writes
  the logo module too and formats the oracle file past biome's 1 MiB default. Two tests that encoded the old
  bytes are updated to the new exact values, not loosened: the stylesheet sha pin in
  `reader-face-card.test.tsx`, and the list of reader sources in `reader-safety.test.ts`, which gains
  `logo-assets.generated.ts` (so the new file is held to the same no-network, no-script rules as the rest).

## 1.2.0-canary.2 · 2026-10-04

Minor, still on the `canary` dist-tag: the reader face brought to the portal's current render (its M4, judge
round 2; portal `4cc33bd`). **Legacy output is unchanged**: a def without `face: 'reader'` paints the 1.1.1
bytes (the 1.1.1 golden still passes), an options-only block never reads the def, and the legacy `@font-face`
rules and the modal's font injection are as they were. No integration needs a code change.

- **Fonts (B1).** The "CertREV Reader Serif" and "CertREV Reader Grotesk" aliases are gone. The serif and
  grotesk `--cr-bf` stacks are the demo's own (`'Playfair Display', ui-serif, Georgia, serif` and
  `'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif`), and the stylesheet ends with 44 `@font-face`
  rules: certrev.com's own DM Sans, Playfair Display, Plus Jakarta Sans and JetBrains Mono faces (40 rules over
  12 `https://assets.certrev.com/fonts/cert-reader-*.woff2` files) and the four metric "* Fallback" faces
  (`src: local(Arial)`, no fetch), all at `font-stretch: 101%`. The reader root asks for 101%, so the faces
  apply to reader text only and never to a legacy face of the same name. The card inlines this stylesheet in
  its own `<style data-certrev-reader-css>` (server HTML and a browser-only mount alike), so DM Sans and
  JetBrains Mono, which the card used to name with no face of its own until a modal had opened, are in the
  document when the card mounts. A host with a `font-src` CSP needs `https://assets.certrev.com` for the card
  on every slot now, not only serif and grotesk; without it the stack falls to its generic family.
- **Theme armor (W1).** Every declaration on the `.certrev-reader` root is `!important` (colour, font family,
  size, style, weight, `font-stretch: 101%`, line height, spacing, alignment, case, shadow, wrapping and
  hyphenation), and `box-sizing: border-box` covers the root and everything in it. A guard rule,
  `.certrev-reader :is(div, section, aside, p, blockquote, span, a, b, strong, em, i, time, small)`, makes
  descendant text inherit those over a host theme's element rules; `b`/`strong` stay `bolder`, `em`/`i`
  italic, and `p` carries the DM Sans stack, all `!important`.
- **Square images (B2).** The image armor adds `border-radius: 0 !important`: Hydrogen's starter `app.css`
  rounds every `img` 4px, which reached the cap and verified logos and the reviewer photo. The round avatar
  stays its wrapper's 50% clip.
- **Text leaves are the demo's.** The Liquid snippets split text as the demo's React does, and the face follows
  them (the Liquid-harness oracle and the goldens hold it byte for byte): the memo name is the name, `,` and
  the credential (`<b>Name</b>, <!-- -->RDN, LD, PhD`); the profile link is "View", the first name and
  "&rsquo;s profile" (`View <!-- -->Avery<!-- -->&rsquo;s profile`); the sidebar name is the name, `,` and the
  credential in one `<b>`; the certified date is direct text of its span beside the "Certified" cue (no
  `<time>`); and the scope sentence is direct text of the scope element, which now carries `data-ftc-line`
  itself (no inner `<span>`; still one marker per render). The "Certified" and "Illustrative example" mono
  labels are nested in the date's and the disclaimer's elements, as in the demo.
- **Stylesheet and tests.** `reader.css` is 31,542 bytes, sha256 `e43fd748...fbab` (full value in
  `src/reader/__tests__/fixtures/SOURCES.json`); goldens, the oracle cells and SOURCES.json come from portal
  `4cc33bd` by `pnpm refresh:reader --portal --oracle`. New: `reader-face-card-fonts.test.tsx` (10), which
  mounts the card with no modal opened and finds the DM Sans `@font-face` at `font-stretch: 101%` in the
  document, and checks that every family the card or the stylesheet asks for has a face. Two tests that
  encoded the old aliases are updated to the new rules: the stylesheet-loads-only-CertREV-fonts test in
  `reader-safety.test.ts` and the stylesheet sha pin in `reader-face-card.test.tsx`.

## 1.2.0-canary.1 · 2026-10-04

Minor, still on the `canary` dist-tag: the reader face brought to the portal's current render (its M3).
**Legacy output is unchanged**: a def without `face: 'reader'` paints the 1.1.1 bytes, and an options-only
block never reads the def. No integration needs a code change.

- **Greys.** The stylesheet's muted text is the portal's AA-floor greys: `#14141495` in place of
  `#1414148c` and `#14141459` (seven declarations). The stylesheet is 13,764 bytes, sha256 `29d8ab04...a8b0`
  (full value in `src/reader/__tests__/fixtures/SOURCES.json`).
- **The banner's credential line** is the demo's three leaves in one `<em>`:
  `<em><span>RDN, LD, PhD</span> · <span>Credential verified by CertREV on May 1, 2026</span></em>`.
  It was one string in a single text node. A reviewer with no displayed credential still makes no
  verification claim, and the sidebar's line (the attribution alone) is unchanged.
- **Token allow-list.** The brand's accent, bar ink and corner radius are no longer filtered by a list of
  forbidden characters. A colour must be `#RGB` or `#RRGGBB` and a radius a bare `0` or one non-negative
  `px`, `rem`, `em` or `%` length; anything else paints the default (navy `#0A1B3F`, `14px`). The old
  guard let a value such as `#abc/*` through, and its comment opener hid the `;` that ends the declaration.
  The Shopify snippets and the WordPress twin hold the same list.
- **Avatars and the writer's line, pinned, not changed.** A v9 Banners def with nothing hidden paints the
  silhouette avatars (36 px writer, 42 px reviewer, 46 px in the memo); `hidden: ["reviewerPhoto"]` removes
  every avatar, the writer's included, as the Liquid does; `display.showExpertPhoto: false` keeps the
  silhouettes. The writer's `<em>` is the envelope's `author.title`, printed only when it is non-empty.
  New tests hold each case against the Liquid harness and through the delivery card.
- **Tests.** The Liquid-harness oracle covers 236 cells (was 136): the 100 new ones are 75 colour and
  radius cells, 17 avatar cells and 8 writer-line cells. Goldens and cells come from portal `fa4e8e5b2a`
  (the reader CSS, snippets and goldens are as at `32525a64`). A card-level test
  (`reader-face-avatars.test.tsx`) drives the avatar cases through a signed envelope.

## 1.2.0-canary.0 · 2026-10-03

Minor, published to the `canary` dist-tag only until a CertREV Builder space has painted it: a new,
**opt-in** card face. **Legacy output is unchanged**: every def that does not say `face: 'reader'`
renders exactly the bytes 1.1.1 renders, and an options-only block (no `delivery` marker) never reads
the def at all. No integration needs a code change.

- **The reader face.** certrev.com's "reader" design (the banner card with the expert memo, the sidebar
  card, the floating pill) as a second face on the Builder card. It is selected only when the delivered
  render def says `face: 'reader'`, spelled exactly; `legacy`, an unknown name, a non-string, a padded or
  capitalised `Reader` all keep painting the face 1.1.1 paints. The markup is byte-equal to the Shopify
  `certrev-reader-*` snippets (the portal's canonical render), held by golden pages copied from the
  portal with their sha256 and by a differential suite over the Liquid harness's output.
- **What 1.1.1 did with the new keys.** Its def parser kept only `v`, `preset`, `rung`, `tokens`,
  `hidden`, `barInkFg`, `layout` and `customFace`: a def carrying `face` or `accentFg` was neither
  rejected nor honoured, the keys were dropped and the legacy face painted with the def's tokens. So a
  1.1.x space keeps painting the legacy face for a reader-face brand, and 1.2.0 reads `face` (a string)
  and `accentFg` (`#141414` or `#ffffff`) from the def; a malformed value is dropped, never a reason to
  reject the def.
- **The stylesheet** is the portal's reader CSS (the generated section of `certrev-cert.css`), copied
  byte for byte: new exports `@certrev/cert-block/reader.css` (the file) and `READER_CSS`
  (`@certrev/cert-block/reader`, react-free). The Builder card inlines it once per card, inside the
  face's wrapper, in a `<style data-certrev-reader-css>`. The `--cr-*` variables stay on `.certrev-reader`.
  `pnpm refresh:reader` regenerates the CSS, its TS copy and the golden fixtures from a portal checkout.
- **Fonts.** The stylesheet declares reader-only `@font-face` aliases, "CertREV Reader Serif" (400-700, with
  italic) and "CertREV Reader Grotesk" (400-800), whose `src` is `https://assets.certrev.com/fonts/*.woff2`,
  and the serif and grotesk `--cr-bf` stacks name the alias first, then the legacy family. The card makes no
  request itself, but the browser fetches those woff2 files for a serif or grotesk reader card: a host with a
  `font-src` CSP needs `https://assets.certrev.com` for the card too, and without it the stack falls through
  to the legacy name and the generic family. The legacy `@font-face` rules and the other slots are untouched.
- **New exports.** `@certrev/cert-block/reader` (`renderReaderFace`, `READER_CSS`),
  `envelopeCardHtml`, `isReaderFaceDef` and `READER_FACE` on `./builder` and `./builder/face`, and
  `face` / `accentFg` on `CertChromeRenderDef`. `envelopeCardInput`, `renderCertBlock` and
  `@certrev/cert-contract` are untouched.
- **Modal and links.** The profile and certificate links carry `data-certrev-modal-open` (the profile's
  `="expert"`), as the Liquid face's; the card emits the hooks and the host wires the modal script. The
  face makes no request of its own (the fonts above are the browser's). Its anchors carry `CERTREV_LINK_REL` (`nofollow sponsored noopener`), as the legacy
  faces' do, so the sponsored/nofollow signal Builder pages declare today survives the new face. The Liquid
  snippets say `noopener noreferrer`; the `rel` value on the anchors is the only byte the reader differs
  from them in, and a named test (`reader-link-rel.test.ts`) pins that over every golden and harness cell.
- **Tests.** The legacy face is pinned against 1.1.1's own output (136 cases, from the `cert-block@1.1.1`
  tag's source) and `avatar-alt-sync` now knows the brand mark the reader paints.

## 1.1.1 · 2026-09-26

Patch: the browser bundle no longer hides or replaces a face, and each certificate control opens
its own face's modal. Nothing about the rendered card changes; no integration needs a code change.

- **No runtime FTC disclosure guard.** 1.1.0's `dist/modal/certrev-cert.js` checked every memo on
  DOMContentLoaded and on every DOM mutation, and replaced any memo whose disclosure line was
  missing, altered or had a zero-size box with "This CertREV verification cannot be displayed". A
  face that loads inside a closed `<details>`, an inactive tab or a collapsed accordion has a zero
  box, so it was replaced for good and never showed when the visitor opened it. The guard is gone
  (`src/modal/ftc-guard.ts` deleted; the bundle installs no `MutationObserver`, never writes
  `data-certrev-ftc-neutralized` and contains no notice text). Whether a face shows its disclosure
  is settled where the face is configured. The disclosure line itself is unchanged: every face still
  renders it. A WordPress page can drop CSS that hid a card whose memo the guard had neutralized.
- **`installFtcGuard` stays exported, as a no-op.** It is public on `@certrev/cert-block/modal`,
  and the contract above says a patch never breaks a compiling integration, so the name remains,
  marked `@deprecated`. It installs nothing; its first call per document dispatches a
  `certrev:deprecated-api` event on the document (`detail: { api: 'installFtcGuard',
  removedIn: '1.1.1' }`) so a caller that still counts on it can find out. It goes in 2.0.
- **Each control opens its own face's modal.** A `[data-certrev-modal-open]` control used to open
  `document.querySelector('certrev-cert-modal')`, so on a page with two faces (a WordPress Query
  Loop, a related-posts block) every control opened the FIRST face's certificate. A control now
  opens the modal in the smallest subtree around it that holds exactly one, and inside a face root
  (`[data-certrev-cert]`, the WordPress plugin's per-face wrapper) only that face's modal counts, so
  the search never reaches a neighbour. A single Shopify embed (card and controls placed apart) and
  a Builder page-level modal resolve exactly as before. A control that cannot tell which modal is
  its own opens nothing and follows its own `href`, and says so: it gets
  `data-certrev-modal-unresolved="ambiguous"` and a bubbling `certrev:modal-unresolved` event
  (`detail: { reason, modals }`). A WordPress page no longer needs to print one modal per page.
- **Revocation hides only its own face's controls.** When the modal's live Delivery-API fetch
  returns a revocation or expiry, `markSuppressed()` used to hide every
  `[data-certrev-modal-open]` control in the document. It now hides the controls whose own modal is
  that element; another face's certificate links stay.
- **Unchanged:** the rendered output of every renderer and component, the exports (`openModal` and
  `openCertModal` keep their document-level behaviour; controls no longer go through them),
  placement, interactions other than the modal lookup, badge revalidation, the verify client, and
  `FTC_DISCLOSURE_LINE`.
- **For this repo's own suite:** `src/modal/ftc-guard.test.ts` goes with the module, and so does
  any assertion that the entry installs the guard. New: `src/modal/closed-container-face.test.ts`
  and `src/modal/own-face-modal.test.ts`.

## 1.1.0 · 2026-09-26

Minor: the Builder card can paint from the signed envelope and the brand's render def. **Read
this before upgrading a Builder integration: a block that carries the new `delivery` marker
renders a different face from the same block's options.** This is the one deliberate exception
to the contract above, and it is opt-in per block: the marker is written by the CertREV exporter,
never by the upgrade itself.

- **No marker, no change.** A block without `delivery` (every entry exported before 1.1.0, and
  every block an editor built by hand) renders through the options path exactly as 1.0.3 did,
  byte for byte, including the banner bridge for entries with no `mode`. Upgrading changes no
  pixel on an existing page. `delivery-card.test.tsx` pins this against the 1.0.3 mapping.
- **With the marker, the options are ignored.** `delivery: { v: 1, baseUrl }` makes
  `CertReviewCard` read `GET {baseUrl}/api/cert/v1/delivery/builder/{entry id}`, verify the signed
  artifact against the baked `cert-issuer-1` key (the key the storefront badge ships), and paint
  the verified content with the render def the Delivery API serves beside it (`renderDef`): the
  brand's accent and surface, hidden fields (e.g. no reviewer photo), rung and layout. The entry id
  is `builderContext.content.id`, so the registration now sets
  `shouldReceiveBuilderProps: { builderContext: true }`; a block copied onto another entry asks for
  that entry's cert.
- **Fail-closed.** A revoked cert (tombstone), an expired one, a signature that does not verify,
  an envelope for another entry, a 404/5xx/timeout, a marker that is not exactly `{ v: 1, baseUrl }`
  with `baseUrl` an `https:` origin on `certrev.com` or a subdomain, or a missing entry id: the card
  renders nothing. Revocation and expiry are re-judged at every render against the cached,
  verified payload, so an expiry lands at `expiresAt`, and a revocation or def change lands within
  the cache TTL (60s positive, 5s negative) with no republish.
- **Suspense.** The marker path suspends once per placement (`React.use` on React 19; the thrown
  promise on React 18) inside its own `<Suspense fallback={null}>`, so streaming SSR resolves it
  and hydration finds the read cached.
- **New API, all additive.** Root: `getVerifiedDelivery`, `peekVerifiedDelivery`,
  `settleDelivery`, `invalidateDelivery`, `parseRenderDef`, `deliveryUrl`, `deliveryCacheKey`,
  `sharedDeliveryCache` and their types. `./builder`: `acceptedDeliveryMarker`, the
  `CertDeliveryMarker` type and the envelope-face helpers. New subpath `./builder/face`
  (react-free): `envelopeCardInput`, the one mapping from verified content + def to the
  `renderCertBlock` input, so a server-side preview renders through the same function as the card.
- **Wire type.** `BuilderCertChromeData` gains `delivery: CertDeliveryMarker | null` (key 20,
  appended to `BUILDER_CERT_CHROME_KEYS`, registered as an `advanced` input with helper text
  telling editors not to edit it). A TypeScript exporter that builds the full wire object must
  now set it (`null` keeps the options face).
- **Phone face (opt-in, envelope card only).** `renderCertBlock` gains `responsive?: boolean`.
  Only `responsive: true` changes anything; absent or `false`, every face is byte-identical to
  1.0.3 (`render-cert-block-responsive.test.ts` pins 14 shapes against the 1.0.3 tarball's own
  output). The envelope face (`envelopeCardInput`) always sets it, so a marker card on a viewport
  640px wide or narrower stacks the banner header's two columns into one and clamps a long memo
  (over 160 characters, or four or more line breaks) to 4 lines behind a native
  `<button type="button">` ("Read the full memo" / "Show less") that flips `aria-expanded`. The
  full memo stays in the markup, so a screen reader reads all of it in both states. Wider
  viewports see the same card as before and no button. The rules ship as one `<style>` element,
  first inside the card root, every rule inside `@media (max-width: 640px)` and scoped to
  `.certrev-cert[data-certrev-responsive]`; a host that strips `<style>` or blocks it by CSP
  (it needs `style-src 'unsafe-inline'`, as the card's inline styles already do) gets the
  1.0.3 card, memo unclamped and button hidden. The toggle is `toggleMemo` / `memoToggleFor`,
  new root exports with the `MEMO_*` constants, which `CertReviewCard` binds on its wrapper and
  any other host of the phone face can call.
- **Unchanged:** the registered name `CertREV Cert`, the `@certrev/cert-block/builder` import,
  `certRevCertComponent` / `BUILDER_REGISTRATION`, every existing input, the anchor path, the web
  component and the modal bundle. `renderCertBlock` and `renderPreviewBlock` paint exactly what
  1.0.3 painted for every input without `responsive: true`, which is every caller in the package
  but the envelope face (the options card among them); the floating pill is unchanged in every case.

## 1.0.3 · 2026-08-18

Patch: restores the placement a pre-existing Builder entry renders. **If you integrated via
Builder before 1.0.0, upgrade to this from any 1.0.x.**

- **1.0.0 silently repainted already-exported Builder entries from banner to sidebar.** `mode` is
  a PLACEMENT input, not one of the 19 wire keys, and the exporter emits only the wire projection,
  so every entry exported to date carries no `mode` key. Through 0.5.5 `CertReviewCard` read
  `props.mode ?? 'banner'` and those entries rendered the banner face. 1.0.0 removed that fallback
  so the renderer would own a single default, which changed what those entries paint. Consumers
  install unpinned, so it reached live pages with no entry edit and no upgrade on their side.
- **The fallback is restored, as a bridge and not as a reversal.** The sidebar default stands
  everywhere it was actually the point: a direct `renderCertBlock` caller omitting `mode` still
  gets sidebar, and `sidebar` is still the registered `defaultValue`, so every block created in
  the editor from now on carries an explicit `mode` and never reaches the fallback. The bridge
  covers only entries that predate the exporter emitting `mode`, and is deleted once the exporter
  writes it and existing entries are backfilled. The registered enum, `defaultValue`, helper text
  and `render-cert-block.ts` are untouched by this release.
- **A third gate, of a kind neither existing one could be.** The rendered-surface sweep checks
  text that IS on a surface; the string-literal rule checks strings that ARE in the source. This
  regression was the absence of a value: what an entry paints when an input is missing. That is
  invisible to both, and it is why 1.0.0 shipped green. `builder.test.tsx` now pins the
  exported-entry shape (no `mode`, and `mode: null`) to the banner face, pins an explicit `mode`
  as still winning, and pins the direct renderer as still defaulting to sidebar so the bridge can
  never quietly widen into a package-wide change. Confirmed to fail with the fallback removed.
- **One editor-facing em dash**, in the design-time anchor placeholder (`builder/index.tsx`), now
  a colon. It is JSX text rather than a quoted string, so the 1.0.2 literal rule could not see it
  either; recorded here because it is the same blind spot, not a separate lesson.

## 1.0.2 · 2026-08-18

Patch: copy only, in strings nobody renders. No API change, no type change, no behaviour change.

- **The 1.0.1 sweep checked the wrong layer, and 1.0.1 shipped an em dash anyway.** It reached a
  reader through the timeout error in `fetchWithDeadline`, which set one between the deadline and
  the URL and prints into a consumer's console with our name on it. That is visible copy by every
  test this changelog has been applying, and the 33-surface rendered sweep could not see it, because
  a thrown error is not a surface anything renders. Found by auditing the published tarball rather
  than the render. It now uses a middle dot: the URL it appends is labelled data.
- **Two more in the same class, found by sweeping every string in shipped code rather than the one
  that was reported.** `renderPreviewBlock`'s missing-`expiresAt` error takes a full stop, because
  the second half is a complete sentence stating why. Nine CSS section comments inside
  `CERT_MODAL_CSS` take middle dots: that template literal is injected verbatim into the modal's
  shadow root, so its comments ship to every page the modal opens on and are readable in devtools,
  unlike the TypeScript comments around it, which `tsc` emits but nothing displays.
- **The gate is now two tests, because one could never have been enough.** The rendered sweep and
  the new string-literal sweep catch disjoint sets: the rendered one sees assembled output but only
  for surfaces something renders, and the literal one sees every shipped string but cannot tell
  which ones reach a human. The literal rule lives in `scripts/check-publish-hygiene.mjs`, strips
  comments with a real tokenizer rather than a regex (the ~795 in comments stay out of scope, and a
  regex cannot tell `//` in a URL from a comment), skips test files, and runs in CI. Confirmed to
  fail on all four 1.0.1 strings and pass with them fixed.
- **A note on how the first check missed the modal bundle.** Grepping the built
  `dist/modal/certrev-cert.js` for the character returned 0 on 1.0.1, and that was a false negative:
  esbuild's default `--charset` is ascii, so it emits non-ASCII as a `\u` escape rather than as the
  character. Ten occurrences were in there. Any future check of a minified artifact has to decode it
  first; grepping the raw bytes reads as clean no matter what is in it.

## 1.0.1 · 2026-08-18

Patch: copy only. No API change, no type change, no behaviour change beyond the five characters
named below.

- **Five em dashes were rendering to readers in 1.0.0.** Two of them on the customer's own article:
  the expert credential list set one between each abbreviation and its expansion (`MD`, then
  `Doctor of Medicine`). That is labelled data, so it now uses a middle dot, matching the preview
  caption and the modal. The other three sat in the
  Builder editor's helper text, where an editor reads them: one list qualifier takes a full stop
  (the middle dots already separate the three values, so a fourth would read as a fourth option),
  one pair of independent clauses takes a comma before `and`, and one consequence clause takes a
  colon.
- **Why 1.0.0 shipped with them.** Every guard in place checked PROSE or SOURCE. The prose guard
  covers the README and this changelog; a source grep cannot tell a string literal that renders
  from a comment that does not, and this package has ~795 em dashes in comments that are
  deliberately in scope for neither. So the one thing nobody checked was the output. They were
  found by rendering the package and grepping what came out, during the mirror leak sweep, after
  1.0.0 was already immutable on npm.
- **`rendered-voice.test.tsx` closes it as a gate**, not as something to remember: it renders all
  33 surfaces (every `mode` × `part`, both badge styles, the pro-bono and empty-memo shapes, the
  preview, the JSON-LD, both modal dialogs, all five React components, and the Builder
  registration) and asserts zero em dashes, plus an en dash only between digits. It carries a
  coverage floor, because an empty render is indistinguishable from a clean one. Confirmed to fail
  on the 1.0.0 strings, naming each surface and quoting the sentence.

## 1.0.0 · 2026-08-17

**A major, and the semver contract at the top of this file is why.** It says patch and minor
releases never change the rendered cert output and never break a compiling integration. This
release does both, deliberately. 0.5.4's entry records what happens when that rule is applied
loosely; this one applies it strictly.

### Breaking: sidebar is the default placement

Any previously-exported entry that omits `mode` rendered as a **banner** and now renders as a
**sidebar**, on every brand, not just the one that asked for it. That is the intended outcome. No
compatibility flag, no backfill, no per-brand switch: one default, everywhere.

The mechanism matters as much as the value. `renderCertBlock`'s `switch (mode)` had no `default:`,
so an unmatched mode returned `undefined` from a function declared `: string`. On the Builder path
that lands in `dangerouslySetInnerHTML` and emits a 39-byte empty div: HTTP 200, no console error,
no throw, card silently gone. `case 'sidebar':` now falls into `default:`, so the declared default
and the runtime fallback are the same physical line and cannot drift. `RenderCertBlockInput.mode`
is optional, and the `?? 'banner'` in the Builder card is deleted rather than flipped, because two
layers naming a default is the bug class. Every arm passes a string literal to the root wrapper, so
an untyped `mode` can no longer reach the root class name or `data-certrev-mode`. `part` is
normalised by an explicit rule instead of a catch-all ternary arm. The Builder `mode` and `part`
inputs now carry a default and an enum, which constrains new editor input; the runtime fallback is
what covers already-stored content and anything written through Builder's Write API.

### Breaking: compliance strings are constants, not caller input

- **Removed from `CertBlockFacts`:** `scopeLine` and `credentialLine`. The FTC scope line's curly
  apostrophe is documented in `render-def.ts` as pinned to MSA §3, and `locked(supplied, constant)`
  returned the caller's value whenever it was a non-blank string, so that copy was rewritable from
  a Builder "Advanced" text box. `locked()` is deleted; the package renders its constants.
- **`compensationCue` is now `string | null`,** and only `null` is meaningful: it OMITS the cue,
  which is the pro-bono reviewer. Any other value renders the locked constant. Previously a null
  cue caused the key to be dropped and the constant to substitute, so a volunteer's card asserted
  "Compensated expert" while the modal in this same package got the same null right.

### Breaking: the escape helpers accept what actually arrives

`escapeHtml` / `escapeAttribute` widen from `string` to `string | null | undefined` and coerce a
wrong TYPE rather than throwing. `formatDate` returns null for a non-string instead of fabricating
a date from a number. `expertNameWithCredentials` returns `''` when the display name is missing.
Well-formed output is byte-identical; only off-contract input behaves differently.

### Rendered output changes

- **Every anchor is qualified.** All 14 emission sites across the React components, the string
  renderer, the Web Component and the modal now carry `rel="nofollow sponsored noopener"` from one
  exported constant, `CERTREV_LINK_REL`. Google's link-spam policy names an unqualified
  vendor-required link on a customer's page directly, and `CertBadgeProps` had no `rel` prop, so
  the customer could not qualify them.
- **An empty memo no longer renders an "Expert memo" heading over an empty `<p>`,** or an empty
  accent-bordered blockquote on the sidebar and custom faces. `bio` already did this correctly
  three times in the same file; only `memo` skipped the check.
- **An unparseable or blank date no longer asserts a date.** "Credential verified by CertREV on
  not-a-date" and a dangling "on " are gone; so is a bare "Certified" with nothing after it.
- **A credential carried in the display name is no longer printed twice.** "Dr. Erik Schraga, MD,
  MD, EM" renders one "MD". A token is dropped only when it equals a WHOLE comma-separated segment
  of the name, so "MD" survives "Dr. MDonald", "Jane Amdahl" and "Md. Rahman". This is a render
  boundary declining to print a duplicate; the stored data is still wrong and the repair is
  portal-side.
- **The expert avatar is marked decorative (`alt=""`) on all four faces.** Three of them emitted
  `alt="Photo of {name}"` beside the same name in text. In `<ExpertBio>` that made a screen reader
  announce it three times running: the aside's `aria-label`, then "Photo of Jane Doe, image", then
  the heading. The modal avatar already had `alt=""`, which is the tell that one decision was made
  four times by hand and landed differently. A source sweep now holds all four in lockstep.
- **The bio accordion's toggle attribute changed** from `data-certrev-bio-toggle`, which had zero
  consumers anywhere, to `data-certrev-acc`, which is what `modal/interactions.ts` binds. The
  focusable `role="button"` was emitted even with no bio, so a screen reader announced "Read more
  about Dr. X, button, collapsed" over nothing: WCAG 2.1 4.1.2 and 2.1.1, in a vendor string
  renderer the consumer cannot patch. With no bio the row is now inert markup.

### JSON-LD

- `reviewNode` dropped the caller's `opts`, so any `pageUrl` differing from `canonicalUrls[0]` left
  the Review's `itemReviewed` pointing at an `@id` no node in the graph carried. Fixed, and a graph
  integrity test now walks every `@id` reference and asserts it resolves.
- `reviewBody`, `Article.author` and `Person.image` were emitted regardless of the display flags
  the card gates them on. All three now resolve visibility through the same `resolveDisplay` the
  card uses, which folds in the render-def's subtractive hide-set. Google: don't mark up content
  that is not visible to readers.
- **New:** a `WebPage` node with `lastReviewed`, and `recognizedBy` on every credential.
- **Changed `@id`:** the Organization node is now the constant
  `https://certrev.com/#certrev-organization` instead of being derived from the per-payload
  `verifyUrl` origin, which is what made "one stable CertREV organization node across all pages"
  false. Portal-side alignment is a separate job.
- `ProjectJsonLdOptions` gains an optional `renderDef`.

### Verify layer

- **Every fetch now has a deadline.** A hung origin was confirmed still pending at 45 seconds
  inside a server render, with no `AbortSignal` anywhere. An abort lands on the same fail-closed
  suppress path as any other failure.
- **`ttlMs` is wired through.** It was declared in the shipped `.d.ts` with a documented default
  and never read.
- **Truthful suppress reasons.** A network failure, a 404 and malformed JSON all collapsed to
  `unsupported_contract_version`.
- The `delivery_api` cache key omitted `baseUrl` and the whole `RenderContext`, while the
  `metafield` branch two lines below keyed on both.

### FTC guard

`enforceFtcDisclosure` returns `'intact' | 'tampered' | 'unguarded'` instead of a boolean. Nothing
in this package emits `.certrev-memo` (that markup is portal's Liquid), so on every React / Web
Component / `renderCertBlock` surface the guard installed a whole-body, subtree, attributes and
characterData observer that could never match, then reported `true` for "intact" on a page it had
not checked. It now declines to observe a document with no guarded surface, and says so. Which
surfaces the kill switch *should* cover is an open design question, documented not guessed.

### Packaging and docs

- **`LICENSE` now exists.** Both packages declared MIT and shipped no license text; there was no
  LICENSE file anywhere in the repo. Holder: CertREV LLC.
- **The tarball no longer ships its own test suite:** 227 files / 315.8 kB → 210 / 269.7 kB, with
  every production source still shipping, `.tsx` included.
- **The README's central trust claim was false about the path it recommends.** "The package never
  renders an unverified credential" is now scoped to the verify layer, where it holds, and a new
  "PUSH trust model" section states what the Builder path actually guarantees and what revocation
  does and does not do.
- **The route example exists.** "(See the route example.)" had shipped in `dist/builder/index.d.ts`
  for releases, pointing at a file that never existed.
- The Hydrogen example wired the kid `certrev-2026-1`, which appears nowhere else in the repo; the
  live JWKS serves `cert-issuer-1`, and a wrong kid suppresses silently with nothing logged.
- CSP docs gain `font-src` for the 12 `@font-face` rules the modal injects, and `data-fonts` is
  documented.
- **Biome now lints and formats `.tsx`.** `files.includes` had never listed the extension, so all
  11 React components in the repo were unchecked by the linter that gates every other file. Turning
  it on surfaced the avatar `alt` defect above, three computed keys that were plain string literals,
  a suppression comment for a rule that was never firing, and six files with unsorted imports.
- **Internal notes stripped from published source** (this package publishes `src/`), and
  `scripts/check-publish-hygiene.mjs` now fails CI on a new one, covering `@certrev/cert-contract`
  on the same rules.
- **Copy:** the preview block's caption is `Preview · Not a verified certification`; its HTML
  comment banner uses a colon; the Builder registration description uses a semicolon. The npm
  `description` is rewritten to 236 characters, because npm caps the packument description at 255
  and was serving this one cut off mid-word at "…and a".

541 tests, up from 249.

## 0.5.5 · 2026-07-31

- **New:** `repository`, `homepage`, and `bugs` in `package.json`: the npm page now links to the
  public source mirror (`github.com/CertREV/cert-kit`, `packages/cert-block`) and to the issue
  tracker, so the registry listing is no longer a dead end. Provenance metadata only: no code, no
  exports, no dependency change.
- **Docs:** README gains a source-repo link and states the peer requirement explicitly: **React
  `>=18`**. `peerDependencies.react` has enforced `>=18.0.0` since before 0.5.0 (and
  `peerDependenciesMeta` marks it non-optional), but the README never said so; a consumer had to
  read `package.json` to find the floor.
- Rendered output: **byte-identical to 0.5.4** (metadata and prose only: no file under `dist/`
  changes).

## 0.5.4 · 2026-07-23

- **Backfilled: this release shipped with no entry.** 0.5.4 published 2026-07-23 and is the first
  release after this file was written; every other version from 0.3.0 on has a section, including
  0.5.2 (a no-op republish). It changed the public type surface without the notice the contract
  above requires. The omission is recorded here rather than quietly closed.
- **Changed:** `FONT_SLOTS` / `FONT_STACKS` (`render-def`) widened 3 → 5: `grotesk` (Plus Jakarta
  Sans) and `mono` (JetBrains Mono) added at the shared guide values, byte-identical to this
  package's `RENDER_BLOCK_FONT_STACKS`, the portal `FONT_SLOT_STACKS`, and the Liquid twin's
  branches. Purely additive: `sans` / `serif` / `system` are untouched, so the card == modal
  invariant holds. Shipped lockstep with the portal's Liquid + WordPress grotesk/mono wiring
  This was Phase-3 enablement of a vocabulary that was dormant on both engines, not a repair of a
  live intra-page mismatch: before this release the Liquid card dropped
  `grotesk`/`mono` too, and fell back exactly as the modal did.
- **Breaking (types). This belonged in a minor, with notice:** `FONT_SLOTS`, `FONT_STACKS`, `FontSlot`
  and `isFontSlot` are public exports. Widening the `FontSlot` union 3 → 5 breaks any consumer
  holding an exhaustive `Record<FontSlot, string>` or an exhaustive `switch` over the slots: a
  break of a compiling integration (exports, types) under the semver contract at the top of this
  file, shipped in a patch.
- Rendered output: the design-locked cert card and the modal bundle are **byte-identical to
  0.5.3**: across the two published tarballs `dist/components/render-cert-block.js` (sha1
  `22267d5d…`) and all 65 files under `dist/modal/` (`certrev-cert.js` sha1 `2013ebbe…`) are
  unchanged, and neither resolves the shared `FONT_STACKS` (the card carries its own
  `RENDER_BLOCK_FONT_STACKS`, which already listed all five slots; the modal consults no font map
  at all). `<certrev-badge>` passes no `renderDef`, so it is unaffected by construction. Output can
  differ on ONE path: a caller passing a `renderDef` with `fontSlot: 'grotesk' | 'mono'` into the
  legacy `<CertBadge>` / `renderBadgeHtml`, where that slot now resolves to a `--certrev-font`
  stack instead of being dropped as invalid. No brand could author those slots at release time (the
  portal editor did not offer them; every known `render_def` writer emits `sans`), so no visitor's
  render is known to have changed; that last point is inference from the call graph and the
  authoring surface, not a production data check.

## 0.5.3 · 2026-07-22

- **New:** `certRevCertComponent` (`./builder`): the drop-in gen2 registration entry, with the
  mutable `inputs[]` the SDK's `RegisteredComponent` type expects:
  `customComponents={[...yourComponents, certRevCertComponent]}`. One import, no re-wrapping, no
  readonly spread. `BUILDER_REGISTRATION` (the readonly canonical view) is unchanged.
- **New:** the 19 exporter-populated wire inputs are marked `advanced`: the Builder editor's
  Options tab now leads with the two placement inputs (`mode`, `part`) and tucks the
  system-populated fields under "Advanced". Editor-cosmetic only.
- **Changed:** `@certrev/cert-contract` moved from a peer dependency (`>=0.5.0`, unbounded) to a
  regular dependency (bounded `^0.5.0`): a plain `npm i @certrev/cert-block` is a complete
  install regardless of the consumer's peer-install settings, and a future contract 0.6 can no
  longer float in unreviewed.
- **Docs:** README rewritten for the gen2 SDK (`customComponents` array): the previous README
  showed the gen1 `Builder.registerComponent` API and pre-publish notes that no longer applied
  (the contract package and the modal bundle both ship for real since 0.5.x). Added in-package
  modal instructions (`?url` import + external script + literal CSP allowances), a known-issues
  note (`@builder.io/sdk-react@5.2.4` types under `moduleResolution: nodenext`), and this
  changelog.
- Rendered output: **byte-identical to 0.5.2** (changes outside the registration surface are
  comment-only).

## 0.5.2 · 2026-07-21

- Republish of 0.5.1 (the 0.5.1 GitHub-Packages tarball was unfetchable). No code changes.

## 0.5.1 · 2026-07

- `./modal/placement` subpath exposed (the side-effect-free placement engine).

## 0.5.0 · 2026-07

- The certificate-modal Web Component moved **into** the package: prebuilt
  dependency-free IIFE at `./modal/certrev-cert.js` (byte-parity with the deployed theme-extension
  asset) + the `./modal` subpath. Banner memo placement (`part`), font hook, static preview block.

## 0.4.0 · 2026-07

- Render strictly from `placedFields` + `renderCustomFace`; v2 brand-ink theming
  (`barInk` / `inkColor`).

## 0.3.0 and earlier

- The locked 3-mode `renderCertBlock` faces, re-synced to the final Liquid design; the
  ambient-URL anchor model (`CertRevAnchor`, zero-input); the initial React components, JSON-LD
  projector, fail-closed verify layer, and `<certrev-badge>` Web Component.
