# @certrev/cert-block

The headless / `crypto_verify` render edge for the CertREV `CertDeliveryEnvelope`. Sign once in the portal, render everywhere: SSR-safe React components, a deterministic schema.org JSON-LD projector, a fail-closed verify layer over the shared `VerdictKernel`, and a framework-agnostic `<certrev-badge>` Web Component.

This is the SDK the brand SSRs into a Hydrogen loader, a Next server component, a Builder client component, or a universal server-side include. It is the `headless_react` + `universal_embed` surface classes from the cross-platform delivery design.

## What this is

CertREV's durable asset is a portable, forgery-proof "this content was reviewed by a credentialed expert" credential: a single Ed25519-signed `CertDeliveryEnvelope`. Each delivery surface renders the visible UI + JSON-LD from that envelope and enforces its validity. The WordPress plugin does it in PHP; the Shopify Liquid extension does it in Liquid; **this package does it in TS/JS for any React or vanilla-JS surface that can run Node/WebCrypto.**

The package gives a brand four things:

1. **React components**: `<CertBadge>`, `<ExpertBio>`, `<CertRevBacklink>`, `<CertJsonLd>`, and the `<CertReview>` composite. SSR-safe (render-pure; no `useState`/`useEffect`/browser globals), theme-light, accessible, and they escape every field. Presentation is driven by the signed `content.display` config (`badgeStyle`, `accentColor`, `showExpertPhoto`, `showMemo`, `showAuthor`), which is deprecated on the wire from v0.2 (no current issuer writes it) and still read at the render edge, so a v0.1.x envelope renders exactly as it was signed.
2. **A deterministic JSON-LD projector**: `projectCertJsonLd(facts)` → a schema.org `@graph` of `WebPage` + `Article` + `reviewedBy(Person)` + `EducationalOccupationalCredential` + `Review` + `Organization`, designed to **merge by `@id`** into the host page's existing WebPage/Article graph (won't collide with Yoast / the theme's structured data). The JSON-LD is **projected from the facts at render time, never stored in the envelope**, and every field mirroring something the card hides is gated by the same `resolveDisplay` the card uses; the graph never asserts what the reader cannot see.
3. **A thin verify layer**: `getVerifiedEnvelope(source)` fetches the signed envelope from **either a Shopify metafield OR the Delivery API** (`GET /api/cert/v1/delivery/{platform}/{externalId}`), runs the fail-closed `VerdictKernel`, and caches the verdict (TTL + single-flight) so concurrent SSR renders don't stampede the origin.
4. **A Web Component**: `<certrev-badge>`, the `universal_embed` surface for sites with no native integration, wrapping the same render as `<CertBadge>` via a shared string renderer.

## The contract shape (settled)

A `CertDeliveryEnvelope = { payload, signature }`. The detached `signature` is **Ed25519 over RFC-8785 JCS(payload)**.

```
payload = {
  contractVersion: 1,
  certId,
  subject:   { platform, externalId, logicalArticleId, canonicalUrls[], installationId, contentDigest },
  content:   { expert{displayName,credentials[],profileUrl,photoUrl,bio?,background?,compensationCue?},
               author{name,title,photoUrl?,bio?}, memo, certifiedAt, contentModifiedAt, verifyUrl,
               articleTitle?, displayCertId?,   // v0.5, signed
               display? },                      // deprecated v0.2: accept-on-read only
  lifecycle: { issuedAt, expiresAt, revokedAt|null, revision },
}
```

`content` is **structured FACTS**, not rendered JSON-LD; the JSON-LD is projected from these facts at render, never stored. The `VerdictKernel` (shared) verifies the signature, then checks subject (`platform`/`externalId`), lifecycle (`revokedAt`/`expiresAt`), and content drift (`contentDigest` vs the live hash), failing closed at every step.

## Public API

```ts
// React components (SSR-safe)
import { CertBadge, ExpertBio, CertRevBacklink, CertJsonLd, CertReview } from '@certrev/cert-block'

// JSON-LD projector
import { projectCertJsonLd, projectCertJsonLdString, serializeJsonLdForScript } from '@certrev/cert-block'

// Verify layer
import { getVerifiedEnvelope, invalidateVerdict, sharedVerdictCache, TtlCache } from '@certrev/cert-block'
import { staticKidResolver, fetchingKidResolver } from '@certrev/cert-block'

// Contract surface (re-exported from the binding point; → @certrev/cert-contract on publish)
import type { CertDeliveryEnvelope, CertPayload, CertVerdict, RenderContext } from '@certrev/cert-block'
import { verifyEnvelope, renderVerdict, verifySignatureOnly } from '@certrev/cert-block'

// Link qualification: the `rel` every anchor this package emits carries (read-only)
import { CERTREV_LINK_REL } from '@certrev/cert-block'

// Web Component (separate subpath: does NOT touch customElements on import)
import { defineCertRevBadge, setCertRevKidResolver } from '@certrev/cert-block/webcomponent'

// Builder.io registration (separate subpath; no Builder dependency)
import { certRevCertComponent, BUILDER_REGISTRATION, CERT_COMPONENT_NAME } from '@certrev/cert-block/builder'
// 1.2.0-canary.5: the design pin, for CertREV's own canary replica only (see "Design pin (staging replica)").
// Also on the main entry. Production brands never use it.
import { designPinFromUrl, parseDesignPin, type DesignPin } from '@certrev/cert-block/builder'

// The envelope face mapping on its own (separate subpath, react-free): verified envelope content
// plus the brand's render def, to the renderCertBlock input a `delivery`-marker card paints.
// A server-side preview renders through the same function as the card.
import { envelopeCardInput, faceFromDef, themeFromDef, layoutFor, CERT_FACE_FIELDS } from '@certrev/cert-block/builder/face'
// 1.2.0: the same subpath's card-level entry, which also picks the reader face when the def says
// `face: 'reader'` (every other def gets exactly the renderCertBlock face, as before).
import { envelopeCardHtml, isReaderFaceDef, READER_FACE } from '@certrev/cert-block/builder/face'

// 1.2.0: the reader face (certrev.com's "What your reader sees" design), react-free: the same markup
// the Shopify reader snippets paint, and its stylesheet. A `delivery`-marker Builder card paints it by
// itself when the brand's def says `face: 'reader'`; import this subpath for a server-side preview,
// or a host that places the pieces itself.
import { renderReaderFace, READER_CSS } from '@certrev/cert-block/reader'
// The same stylesheet as a file: the generated reader section of the Shopify stylesheet, byte for byte.
import readerCss from '@certrev/cert-block/reader.css'

// Certificate modal: the ONE SIDE-EFFECTING entry in the package. Importing it registers
// <certrev-cert-modal> and, in a browser, starts three DOM passes (placement, interactions,
// badge revalidation). Browser only. Never import it from server code. Most
// integrations should load the prebuilt IIFE as an external <script> instead (see below).
import '@certrev/cert-block/modal'
import { CERT_ISSUER_KID, CERT_ISSUER_PUBLIC_KEY_PEM, CERT_MODAL_TAG } from '@certrev/cert-block/modal'
import certScriptUrl from '@certrev/cert-block/modal/certrev-cert.js?url'

// The placement engine on its own: pure functions + selector constants, no registration,
// no DOM pass on import. This is the subpath to reach for if you only want the anchors.
import { placeCert, initCertPlacement, PLACEMENT_ANCHORS } from '@certrev/cert-block/modal/placement'

// Test/dev fixtures: Node-only (they sign with node:crypto), which is why they are NOT on
// the main entry: importing `@certrev/cert-block` must never pull a Node builtin into an edge bundle.
import { makeMockPayload, makeSignedEnvelope, FIXTURE_KID } from '@certrev/cert-block/fixtures'
```

## Usage: headless React (Hydrogen / Next server component)

Fetch + verify in the **server** runtime (it can run Ed25519 over JCS: full `crypto_verify` parity), then render the badge + JSON-LD only on a `render` verdict.

```tsx
import { getVerifiedEnvelope, fetchingKidResolver, CertReview } from '@certrev/cert-block'

// Reach for this one first: it reads CertREV's published key set, so a key rotation resolves
// without a redeploy. One fetch populates every kid; concurrent misses single-flight; the set
// is cached for an hour by default (`ttlMs`) and the fetch itself has a 3s deadline
// (`timeoutMs`), because this runs on the render path.
const resolveKid = fetchingKidResolver({ jwksUrl: 'https://certrev.com/.well-known/jwks.json' })

// In a Hydrogen loader / Next server component:
const verdict = await getVerifiedEnvelope({
  // PULL from the Delivery API (or { kind: 'metafield', value } for a Shopify metafield)
  source: { kind: 'delivery_api', baseUrl: 'https://portal.certrev.com', platform: 'shopify', externalId: articleGid },
  resolveKid,
  context: { platform: 'shopify', externalId: articleGid, liveContentHash },
})

// <CertReview> is fail-closed: renders the badge + projected JSON-LD on `render`, NOTHING on `suppress`.
return <CertReview verdict={verdict} pageUrl={canonicalUrl} />
```

### Picking a key resolver

Two resolvers ship, and the difference matters at rotation time:

- **`fetchingKidResolver({ jwksUrl, ttlMs?, timeoutMs?, fetchImpl? })`**: fetches CertREV's
  published key set and caches it. Right for anything long-running: a rotated kid resolves on
  the next cache miss with no redeploy. Costs one cross-origin fetch per TTL window.
- **`staticKidResolver({ [kid]: pem })`**: a key set baked into the deploy. Zero network at
  render time, which is why it is right for an edge/Workers runtime that must not make an
  outbound call, or for a build whose key you pin deliberately. The cost is that a rotation
  needs a redeploy. Today CertREV publishes exactly one key, `cert-issuer-1`:

  ```ts
  import { staticKidResolver } from '@certrev/cert-block'
  const resolveKid = staticKidResolver({ 'cert-issuer-1': process.env.CERTREV_PUBKEY_PEM! })
  ```

  Get the PEM from `https://certrev.com/.well-known/jwks.json` (the `x` value is the base64url
  raw Ed25519 key; the resolver also accepts a JWK directly).

**When the kid is wrong the failure is silent.** A resolver that returns `null` for the kid on
the envelope (a typo'd key name, a stale bake after a rotation) produces
`{ decision: 'suppress', reason: 'unknown_key' }`, and `<CertReview>` renders nothing. This
package writes nothing to the console on any path, so `verdict.reason` is the only signal you
get. Log it while integrating.

For finer control, render the pieces independently from `verdict.payload`:

```tsx
{verdict.decision === 'render' && (
  <>
    <CertBadge payload={verdict.payload} badgeStyle="compact" />
    <ExpertBio payload={verdict.payload} headingLevel="h2" />
    <CertRevBacklink payload={verdict.payload} />
    <CertJsonLd payload={verdict.payload} pageUrl={canonicalUrl} />
  </>
)}
```

### Caching + deadlines

`getVerifiedEnvelope` is safe to call on every render. What bounds the origin load:

- **A process-local `TtlCache`.** Default: 60s for a `render` verdict, 5s for a `suppress`, 1000
  entries, and single-flight. N concurrent renders of the same page do one fetch, not N.
- **`ttlMs`** raises or lowers the TTL for a `render` verdict written by that call. It
  deliberately does **not** apply to a `suppress`, which keeps the short negative TTL, so a
  longer `ttlMs` can never make a transient origin failure sticky.
- **`timeoutMs`** (default 3s) is the deadline on the Delivery-API fetch. On expiry the request
  is aborted and the call fails closed; a hung origin never holds a render open. The metafield
  source does no I/O and ignores it. `fetchingKidResolver` carries the same deadline for its own
  JWKS fetch.
- **`cache`** takes your own `TtlCache` instance instead of the module-level
  `sharedVerdictCache`: the seam a test or a multi-tenant server uses to avoid one shared map.
- **`invalidateVerdict(source, context, cache?)`** drops every cached verdict for one placement,
  whatever live content hash each was cached under. Call it from a revocation webhook: the
  webhook knows the article, never the body hash a given render observed.

The cache key covers the source URL (or a hash of the metafield value), the platform/externalId,
and the live content hash. So staging and production do not share an entry, and a verdict
computed before the article drifted is not served after it.

This cache is **per instance, and nothing more**. On a multi-instance deploy each instance keeps
its own copy. A shared L2 (a CDN in front of the Delivery API, cacheable on
`lifecycle.revision`, or a KV store) is the caller's to add, and this package has no hook for
one. If you do add one, bound it: a positive verdict held past a revocation is exactly the
failure the verify layer exists to prevent.

## Usage: JSON-LD merge (don't collide with Yoast)

The Article node carries the SAME `@id` the host page's primary Article uses (`{pageUrl}#article`, query + fragment stripped), so a consumer **merges** our `reviewedBy` / `dateModified` into the existing node instead of emitting a competing primary entity. Pass `wrapGraph: false` to get a bare node array to splice into a `@graph` you already own.

```ts
const graph = projectCertJsonLd(payload, { pageUrl: canonicalUrl })          // { '@context', '@graph' }
const nodes = projectCertJsonLd(payload, { pageUrl: canonicalUrl, wrapGraph: false }) // bare node[]
```

Three `@id` conventions the merge depends on. Any surface emitting a CertREV graph (this package,
Portal, the WordPress plugin, the Liquid extension) has to agree on all three, or the halves land
as sibling nodes instead of merging:

- **WebPage** → the canonical page URL, query and fragment stripped.
- **Article** → that same URL + `#article` (the Yoast convention). A page reached with a `?utm=…`
  param must still derive the canonical `@id`, which is why the query is stripped.
- **The CertREV `Organization`** → the hard literal `https://certrev.com/#certrev-organization`,
  never derived from whichever host served the verify link. CertREV is one real-world
  organization; a staging origin, a vanity verify domain or a future regional host must not mint a
  second org node that never merges with the first. Emit the literal.

Our own nodes (`Review`, the expert `Person`, their credentials) are keyed to the certification:
the verify URL, the expert profile, that fixed organization id. They never sit under the host
page's `@id` namespace, so they cannot clash with anything the host emits.

Pass `renderDef` alongside `pageUrl` when the brand hides fields on the card: the projector gates
the memo, the author byline and the reviewer photo through the same `resolveDisplay` the card
uses, so a hidden field is absent from the graph too.

## Usage: universal embed (Web Component)

Preferred mode is **SSR + hydrate** (crawlable): a server-side include emits the badge HTML (via `renderBadgeHtml`) inside the element; the component leaves the server-rendered child alone. Client-fetch mode (not crawlable) is a documented fallback and is **fail-closed**; it renders nothing without a configured key resolver.

```html
<!-- SSR: server emits the badge markup inside the tag; crawler reads it -->
<certrev-badge>{{ renderBadgeHtml(payload) }}</certrev-badge>

<script type="module">
  import { defineCertRevBadge, setCertRevKidResolver } from '@certrev/cert-block/webcomponent'
  setCertRevKidResolver(myResolver) // only needed for the client-fetch fallback
  defineCertRevBadge()
</script>
```

## Usage: Builder.io (the cert component)

Two ways to place the visible cert on a Builder.io page. **PUSH is the primary story** for
exporter-driven brands (the cert block arrives with the CertREV-drafted entry); the PULL anchor
is the editor-placed alternative.

**They do not have the same trust model, and that should drive the choice more than layout does.**
PULL renders from a verdict your own loader verified and passed down through `CertRevProvider`:
the editor picks the spot, the system picks the credential, and a `suppress` verdict renders
nothing. PUSH renders from strings the exporter wrote into the CMS entry, and verifies nothing.
Read [PUSH trust model](#push-trust-model) before choosing it.

### PUSH: the registered cert block

CertREV's exporter emits a cert block whose options are the `BuilderCertChromeData` projection.
Register the ready component once, from the `./builder` subpath: one import, one entry in the
`customComponents` array your app already passes to the gen2 SDK's `<Content>` (the same array
your other custom components render from). No hand-mapped options, no hand-maintained inputs:

```tsx
// gen2 SDKs (@builder.io/sdk-react and friends: Hydrogen/Remix, Next, Gatsby)
import { certRevCertComponent } from '@certrev/cert-block/builder'

<Content
  model="blog-article"
  content={content}
  apiKey={apiKey}
  customComponents={[...yourExistingComponents, certRevCertComponent]}
/>
```

On `0.5.2` and earlier (before `certRevCertComponent` existed), build the entry from the
canonical readonly view; the spread sheds the `readonly` typing, which the gen2 SDK's mutable
`inputs[]` type won't accept directly:

```ts
import { BUILDER_REGISTRATION } from '@certrev/cert-block/builder'

const certRevComponent = {
  component: BUILDER_REGISTRATION.component,
  name: BUILDER_REGISTRATION.name,
  inputs: [...BUILDER_REGISTRATION.inputs],
}
```

Gen1 SDK (`@builder.io/react`) consumers register the same data imperatively:
`Builder.registerComponent(certRevCertComponent.component, certRevCertComponent)`.

`CERT_COMPONENT_NAME` (`"CertREV Cert"`) is the canonical block name the portal's
`certComponent` connection field defaults to; the inputs are single-sourced from the
`BuilderCertChromeData` wire type (drift-locked: the exporter option keys, the registered
inputs, and the type can never diverge silently). The 19 exporter-populated wire inputs are
marked `advanced`, so the editor's Options tab leads with the two placement choices an editor
actually makes (`mode`, `part`). The component enforces the fused-credential rule by
construction (a credential is unrenderable without its dated verification) and themes to the
brand's render-def (accent / surface / corners / font + v2 bar-ink / body-ink).

### The reader face (1.2.0, opt-in)

certrev.com's "reader" design (a banner card plus the expert memo, a sidebar card, a floating pill) is a
**second face** beside the one every earlier version paints. A `delivery`-marker card paints it only when
the Delivery API's render def says `face: 'reader'`, spelled exactly. Any other def (no `face`, `legacy`, an
unknown name, a non-string) paints exactly the face bytes 1.1.1 painted: the byte tests in
`src/builder/__tests__/legacy-face-1.1.1.test.ts` compare it to the 1.1.1 tag's own output. (From 1.2.0
the face's wrapper also carries its `data-certrev-envelope` seed; see
[The delivery card in the browser](#the-delivery-card-in-the-browser-120).) A block without
the `delivery` marker (an options-only block) never reads the envelope, so it stays on the legacy face.

- **Same bytes as the Liquid.** The markup is the Shopify `certrev-reader-*` snippets', and the portal's
  golden pages are copied into `src/reader/__tests__/fixtures/golden/` with their sha256, so the two
  cannot drift without a test saying so.
- **The stylesheet** is the generated reader section of `certrev-cert.css`
  (`/* CERTREV-READER-GEN:BEGIN */ ... END`), copied byte for byte as `src/reader/reader.css` (`./reader.css`)
  and as `READER_CSS`. The card inlines it once, in a `<style data-certrev-reader-css>`, inside the face's
  wrapper; the brand's colours, corners and font ride the `--cr-*` variables on `.certrev-reader`.
  `pnpm refresh:reader` regenerates the CSS, the TS copy and the fixtures from a portal checkout.
  The stylesheet ends with 44 `@font-face` rules: certrev.com's own DM Sans, Playfair Display, Plus Jakarta
  Sans and JetBrains Mono faces (40 rules over 12 files, `https://assets.certrev.com/fonts/cert-reader-*.woff2`)
  and the four metric "* Fallback" faces (`src: local(Arial)`, so no fetch). They are declared at
  `font-stretch: 101%` and the reader root asks for 101%, so they apply to reader text only and never to a
  legacy face of the same name. The brand font stacks are the demo's own (`'DM Sans', ui-sans-serif, ...`);
  there are no "CertREV Reader" aliases. **The card's own `<style>` (1.2.0) is `READER_CSS` without the 40
  remote faces**: it keeps the four Fallback faces and names no font URL, so a card loads no font file and
  needs no `font-src`, and a storefront whose CSP allows no CertREV origin logs no violation. Its text paints
  in the Fallback metric faces (Arial and Times New Roman sized to the demo's fonts, so the layout matches)
  unless the page already declares the demo's families. A host that wants certrev.com's own faces links
  `@certrev/cert-block/reader.css` (which keeps all 44 rules) from its own stylesheet and allows
  `font-src https://assets.certrev.com`; the card then paints in them with no change of its own.
  Every declaration on the `.certrev-reader` root is `!important`, a guard rule makes descendant text inherit
  the reader's font, colour and spacing over a host theme's element rules, and an image armor keeps `img`
  corners square (`border-radius: 0 !important`; Hydrogen's starter `app.css` rounds every `img` 4px).
  The stylesheet also ends with the portal's wrapper rule,
  `:is(.certrev-card-wrap, .certrev-memo-wrap):has(.certrev-reader) { margin-block: 0 !important; padding: 0 !important; }`,
  which a Shopify or WordPress page needs so its card and memo wrappers add no spacing around a reader card.
  The Builder face paints no such wrapper (it emits the `.certrev-reader` sections alone), so the rule matches
  nothing there; it is in the file because the file is the portal's bytes.
- **The logo is the demo's own file.** The `<img>` in the card cap and in the memo's verified footer is
  `logo-white.svg` (the cap on a dark accent) or `logo-mono.svg` (the footer, and the cap on a light accent),
  printed as a base64 `data:image/svg+xml` URI of the file's exact bytes
  (`src/reader/logo-assets.generated.ts`, from the portal by `pnpm refresh:reader`; sha256 `3c819f65...2d07` and
  `da906f44...3c3e`). It is a `data:` URI as before, so a host's `img-src` needs nothing new, and the face
  still loads no image of its own. The scope line's cue separator is followed by an empty `<!-- -->`
  (`<em>Compensated expert</em> · <!-- -->Independent editorial review ...`), as the demo's React render leaves
  it, so the separator and the sentence are two text nodes.
- **Modal and links.** The profile and certificate links carry `data-certrev-modal-open` (the profile's
  with `="expert"`), as in the Liquid face; the card only emits the hooks, and the host loads the modal
  script as for any face. The face makes no request of its own. Its links carry `CERTREV_LINK_REL`
  (`nofollow sponsored noopener`), as every other face's do, so a Builder page keeps declaring the paid
  placement; the Liquid snippets say `noopener noreferrer`, and that `rel` value is the one byte the face
  does not share with them.
- **Layout** follows the editor's `mode` when set, else the def's `layout`, else the banner; the reader
  has no custom composition, so a `custom` layout paints the banner. The sidebar card floats right inside
  a wrapper that establishes its own formatting context (`display: flow-root`).
- **Brand tokens** are an allow-list, as the Shopify and WordPress twins' are. The accent and bar ink must
  be a `#RGB` or `#RRGGBB` string; the corner radius a bare `0` or one non-negative `px`, `rem`, `em` or `%`
  length. Anything else (a named colour, `rgb()`, a negative or unitless radius, a value with a quote, a
  comment opener or a bracket) paints the default, navy `#0A1B3F` and `14px`, and never reaches the
  `style` attribute. The font is one of five stacks (`sans`, `serif`, `grotesk`, `mono`, `system`); an
  unknown slot paints sans.
- **Avatars.** Every byline paints a round avatar: the person's photo when there is one to paint, else their
  initials, else the silhouette (a name with no initials). It is 36 px for the writer, 42 px for the banner
  reviewer, 46 px for the memo and sidebar reviewer. The initials and the silhouette are an inline `<svg>`, not an
  `<img>`, so a page with no photos holds no avatar image. The initials are the same bytes the portal's Liquid
  snippets and WordPress renderer print: the name trimmed and split on single spaces (empty parts skipped, so
  "Jane  Doe" is "JD"), a leading dr, mr, mrs, ms, prof or mx (with or without the dot) dropped, the first character (by code point) of each of the first two parts left,
  uppercased, in
  `<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><text x="20" y="20" text-anchor="middle" dominant-baseline="central" font-size="15" font-weight="700">JD</text></svg>`
  (the initials escaped); an empty result paints the silhouette. A def that hides `reviewerPhoto`, and
  `display.showExpertPhoto: false`, never read a photo URL and paint the initials: the hidden photo is removed, not
  the avatar. `reviewerPhoto` takes the reviewer's and the writer's photo alike, which is data on the brand, not a face
  setting.
- **Credential line.** The banner prints the reviewer's credential, a middle dot and the attribution as
  three leaves of one `<em>` (`RDN, LD, PhD · Credential verified by CertREV on May 1, 2026`); a reviewer
  with no displayed credential makes no verification claim. The writer's `<em>` under the name is the
  envelope's `author.title`, printed only when it is non-empty.

### The delivery card in the browser (1.2.0)

A `delivery`-marker card reads the signed envelope (and the brand's render def) from the Delivery API **on
the server**, and the face it paints carries that read as one attribute on its wrapper:
`data-certrev-envelope` = `{ v: 1, baseUrl, externalId, design?, payload, signature?, renderDef }`. The payload is
the served one less the fields the def hides (below), and `design` is the design pin the read was made with. The
browser hydrates from it:

- **A server-rendered card makes no browser read.** It hydrates from its own `data-certrev-envelope`,
  byte for byte the server's face, so a storefront whose CSP `connect-src` names no CertREV origin keeps
  the card painted and logs nothing. Through 1.1.1 the browser re-read the Delivery API on hydration, and a
  blocked read took the server's card down.
- **Where the server had no envelope to paint, it writes what it painted instead**, in the same attribute: a
  record `{ v: 1, baseUrl, externalId, design?, face }` with no payload, no signature and no def. The browser keeps
  that face through hydration and any later render of the same placement, and reads nothing:
  - **CertREV not reached** (a 5xx, a body that is not an envelope, a network error, the 8 s deadline): the
    block's own options face, the card 0.5.x and 1.0.x painted from the same fields, with `face: "options"`. Its
    placement is the block's `mode`, else its def's `layout`, else the banner. A page never loses its card to an
    outage. A pinned card (below) paints it too, with a record naming its pin. A block whose options cannot
    paint (no reviewer) paints nothing, with `face: "none"`.
  - **A definitive no** (revoked, expired, unverifiable, another entry's envelope, a 404 or 410): nothing, with
    `face: "none"`, so a revocation is never painted over by the options face.
- **After hydration** the card re-runs the lifecycle and subject policy at the browser's clock: a cert
  whose `expiresAt` passed while the page was open comes down. The signature is not re-checked in the
  browser (whoever can write the page's HTML can already write any card), and a revocation shows on the
  next page load, which is when the server reads again.
- **A card the browser mounts later** (an in-app navigation, a re-render) paints from any seed the page's
  server HTML carried for the same placement, so it makes no read either. A pinned card (the design pin,
  below) takes only a seed carrying the same pin.
- **A card with no server render behind it** (a client-only page, Builder's visual editor preview) **makes no
  read**: it paints the block's own options face, as the unreachable case does, pinned or not, or nothing (a
  block with no options). The browser never fetches by default, so no brand's CSP needs a CertREV origin.
- **A card the browser renders while the page is still loading waits for its record (1.2.1).** A streaming
  server (`renderToPipeableStream`, `renderToReadableStream`: Hydrogen and React Router for a visitor's browser)
  sends a card whose read was still running after the page's shell, in a hidden `<div id="S:0">` past `</html>`.
  When React renders the card on the client before that part arrives (an update reaches the waiting boundary,
  React error #421; a hydration mismatch above it re-renders the whole document, #418 then #423), the card has no
  record in front of it. Through 1.2.0 it painted the options face, or nothing, at once and never looked again, so
  a phone's first load could end with no card. Now it paints nothing until the record streams in, then exactly
  what the record says (the server's face, the options face, or nothing), and what the bullet above says if the
  page finishes loading (`DOMContentLoaded`) without one. It watches the document, and the `<html>` element the
  server sent, which React's whole-document render removes while the parser goes on writing into it: one
  `MutationObserver` for every card on the page, and one scan when the page has loaded (the only look where
  `MutationObserver` is missing). It makes no read. A hydrating card, a `clientRead` card and a card mounted
  after the page loaded behave as in 1.2.0.
- **`clientRead` (a prop, off by default) opts in to that read.** A card with `clientRead` and no server render
  behind it reads the Delivery API once from the browser and settles exactly as a server does. That read needs
  `connect-src` for the Delivery origin; where it is blocked or fails, the card **renders nothing and logs
  nothing**, never a broken card and never the host's tree unmounted. It is not a Builder input: a brand that wants
  it sets it in code, on a wrapper of the registered component.
- **The delivered face (1.3.0).** The Delivery API may serve, beside the envelope, a face it rendered for the
  brand's design: an unsigned `face: { html, css }`. The envelope's signed `content.faceDigest`
  (`@certrev/cert-contract` 0.6.0) holds the sha256 of each half's UTF-8 bytes and the def version they were
  rendered for. The card paints that face (`<style>` + css + `</style>` + html, in its usual wrapper, marked
  `data-certrev-face="delivered"`) only for an unpinned block that shows the whole card (not a split banner's
  `part: 'header'` or `'memo'`), when the def served is that version and both hashes, computed with WebCrypto,
  equal the signed values. The seed then ends with the same `face`, and the browser hashes it again against the
  seed payload's digest before it paints it; with no WebCrypto (an insecure `http:` page) or bytes that do not
  hash, the card paints what 1.2.1 paints. Every other delivery paints exactly what 1.2.1 paints, seed included.
  The face is on the page twice (painted, and in the seed).
- **The server's read** waits up to 8 s (the verifier's own default stays 3 s). Its cache keeps a certificate for
  60 s, then serves it for up to 5 minutes more while one background refresh runs or while CertREV cannot be
  reached; a refusal (revoked, expired) lands as soon as its refresh does. A cold placement waits once; a warm one
  never waits.
- **A reviewer photo the browser cannot load** (a CSP `img-src` without the photo's origin, a 404) is repainted as
  the person's initials, the same bytes the face paints for a hidden photo (below), with no request and no change to
  the record.
- **Server render or hydration is decided from the page, with no switch.** React tells a component nothing
  about which it is in, and under jsdom (or a DOM shim) a `react-dom/server` render sees a `document` too.
  So the card reads what a hydration has and a server render cannot: server-rendered HTML in the document. No
  `document` is a server; a card mounted on the client, or past its hydration, is a browser; a card that is
  hydrating is a browser only if the live document holds this placement's seed or a React Suspense boundary marker
  (the card's own `<Suspense>` leaves one even where the server painted no card), and otherwise is a server render,
  which reads and seeds as a server does. The one case that is not seen is a server render run while the document
  still holds server-rendered React HTML (a test or shim that hydrates one page and renders another into the same
  document): it is taken for a hydration, so clear the document between pages in such a harness.

#### Hidden fields are absent from the page

A def's `hidden` set (`reviewerPhoto`, `memo`) and the payload's `display.showExpertPhoto: false` are the brand's
statement that the page does not show those fields, so the seed does not carry them either. Before the card paints and
before it writes the seed, the payload is stripped:

| hidden by | removed from the payload |
| --- | --- |
| the def's `reviewerPhoto` | `content.expert.photoUrl` and `content.author.photoUrl` (the reader face paints the writer's photo under the same switch) |
| `display.showExpertPhoto: false` (a literal `false`; absent or `null` shows the photo) | the same two photo URLs, whatever the def hides |
| the def's `memo` | `content.memo` |

The face is painted from the stripped payload on the server and in the browser, so the two are identical and the page
source holds neither the photo URL nor the memo text. `content.expert.compensationCue` is never stripped: it is a locked
disclosure no def can hide, and the banner, the memo and the sidebar paint "Compensated expert" from it (the floating pill's own markup carries no
disclosure line, as in the portal's snippets; the modal it opens paints the cue). **When anything was stripped the seed
carries no `signature`.** The signature signs the whole payload, so a stripped payload no longer verifies against it;
the browser never re-checks a seed's signature, only the lifecycle and subject policy at its own clock, and neither reads
a stripped field. A seed that stripped nothing keeps the signature, so its payload can still be checked against the issuer
key. A reader def that hides `memo` paints no memo card on the Builder card (the reader face called directly, like the
portal's Shopify snippets, paints the memo it is given).

### Design pin (staging replica)

1.2.0-canary.5. **This is for CertREV's own canary replica only; production brands never send it.** The
replica paints one saved design version of a brand's Appearance settings on a real Builder page, chosen by the
replica's own page URL. A production page passes no pin, and its card reads
the same URL, under the same cache key, and paints the same bytes as before.

- **The URL.** A pinned card asks the Delivery API for that design instead of the brand's live def:
  `GET <base>/api/cert/v1/delivery/builder/<entryId>?design=<version>[&designBrand=<brandKey>]`. `version`
  matches `/^[1-9][0-9]{0,8}$/` and `brandKey` matches `/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/` (sent
  URL-encoded). The pin is part of the URL, so a pinned read has its own cache entry and its own suspense key.
  It never shares either with the unpinned read or with another pin.
- **The context key.** The card never reads the page URL itself. The replica passes the pin through Builder
  `<Content>`'s own `context` prop as `certrevDesignPin`, and the card reads
  `builderContext.context.certrevDesignPin`. `designPinFromUrl(request.url)` builds that value from the
  replica's own request: `{ design, designBrand? }` as strings, or `undefined` when the URL has neither param. It
  never throws. `parseDesignPin` is the card's judge: `undefined` for no pin, a `DesignPin`
  (`{ version, brand? }`), or `'invalid'`.

  ```tsx
  import { certRevCertComponent, designPinFromUrl } from '@certrev/cert-block/builder'

  const certrevDesignPin = designPinFromUrl(request.url) // in the replica's loader
  <Content model="blog-article" content={content} apiKey={apiKey} customComponents={[certRevCertComponent]}
    context={certrevDesignPin ? { certrevDesignPin } : {}} />
  ```
- **Fail-closed.** A pin never falls back to the live design. Each of these renders nothing:
  - a pin that cannot be read. This covers a brand without a version, `0`, a leading zero, a word, an
    upper-case or empty brand, and anything that is not a `{ design, designBrand? }` object. Nothing is
    fetched.
  - a pin on a block without the `delivery` marker. The options face is never the pinned design, and nothing
    is fetched.
  - a 404 (`no_design`) from the API, and every verdict that already suppresses an unpinned card
    (revoked, expired, unverifiable, another entry).

  CertREV not reached (a 503, a timeout, a network error) is not a fail-closed case since 1.2.0: a pinned card
  paints the block's own options face, as an unpinned card does, with a record that names the pin and says
  `options`. That is never the live design, and the record tells a capture it is not the pinned one either.
  - a def that is anything other than a **reader** def (`face: 'reader'`) at **exactly** the pinned version.
    That includes no def, a malformed def, a legacy or unknown face, and another version.

  No pin at all is `undefined` or `null`, which also covers a missing or empty `context`. In that case the
  card is the unpinned card, byte for byte, as `src/builder/__tests__/design-pin-card.test.tsx` checks.

### PUSH trust model

Read this before choosing PUSH. The registered card is **chrome, not a verifier**, and it is a
different trust model from the headless-React path above.

**Nothing cryptographic runs at card render.** The card draws entirely from the block options the
CertREV exporter wrote into the CMS entry: display strings that were projected from the signed
envelope at export time. Its whole guard is that `reviewerName` and `verifyUrl` are non-empty
strings; anything malformed degrades to the name-only face. There is no signature check, no
subject check, and `revokedAt` / `expiresAt` / `contentDigest` are not fields on
`BuilderCertChromeData` at all; they are not on the wire, so the card could not check them.

**What follows from that:** anyone who can write to the CMS entry can render a fully-branded cert
card, because to the card a hand-typed option and an exporter-written option are the same string.
The trust boundary on this path is **write access to the Builder space**, not a signature.
Treat the space's editor permissions and the exporter's API key accordingly. If you need the
credential itself verified at render, use the headless-React path (`getVerifiedEnvelope` +
`<CertReview>`), where a bad signature, wrong subject, revocation, expiry or content drift each
collapse to `suppress`.

**Revocation, precisely.** A CMS snapshot cannot self-invalidate: a revocation upstream does not
reach the entry, and the card keeps rendering the chrome until something rewrites or removes that
entry. One narrower thing does happen, and only this. When a visitor **clicks** a
`data-certrev-modal-open` control (the "View certificate" / reviewer links the card emits) on a
page that loaded the modal script and carries `data-delivery-api` + `data-platform` +
`data-external-id`, the modal fetches the Delivery API live. If that returns a revocation
tombstone, or an envelope with `revokedAt` set or `expiresAt` passed, the modal refuses to open
and calls `markSuppressed()`: it stamps `data-certrev-suppressed` on itself and sets `hidden` +
`aria-hidden` on the `[data-certrev-modal-open]` controls **of its own face** (the controls that
open that element; see "Several faces on one page" below). So that face's certificate links disappear on that page view, and
another face on the same page keeps its own. The card body (the reviewer's name, the credential, the memo,
the "Expert reviewed" chrome) is not touched, and nothing happens at all for a visitor who never
clicks, for a page without the modal script, or for a crawler. One more way to lose even that: the
modal prefers a synchronous envelope source, so if the page inlines one (a light-DOM
`<script data-certrev-envelope>` child or a `data-envelope` attribute) it opens from that snapshot
and never fetches. Leave the modal on the routing attributes if you want the live check.

**How a revoked cert actually stops rendering on this path is a CMS-side question**: who rewrites
or unpublishes the entry, and how fast. This package does not implement it and does not assume it.

**The card emits no structured data.** By design: a drag-droppable page-builder block must not own
JSON-LD, or an editor can duplicate it, move it out of `<head>`, or delete it. So the card renders
chrome only, and the **article route** emits the JSON-LD server-side via `projectCertJsonLd` from
the verified payload. See [The article route example](#the-article-route-example). It cannot come
from the block options: `projectCertJsonLd` takes a `CertPayload`, and the CMS hands the card
display strings.

### The certificate modal + CSP

The "View certificate" affordance opens an envelope-verified modal. The browser bundle **ships
in-package**: a prebuilt, dependency-free, minified IIFE at `@certrev/cert-block/modal/certrev-cert.js`.
Serve it as an external `<script>`. Do **not** side-effect-import it into server code (it
registers `customElements` and touches `window`; keeping it an external script keeps it out of
the SSR bundle entirely):

```tsx
// Vite-family stacks (Hydrogen/Remix): resolve the shipped asset to a URL, load it deferred
import certScriptUrl from '@certrev/cert-block/modal/certrev-cert.js?url'

<certrev-cert-modal
  data-delivery-api="https://portal.certrev.com"
  data-platform={platform}
  data-external-id={externalId}
  data-fonts="host"
/>
<script src={certScriptUrl} defer />
```

CSP allowances for the headless host. The **registered card** needs none when the server renders it
(1.2.0): it hydrates from the envelope in its own server HTML with no browser read (see
[The delivery card in the browser](#the-delivery-card-in-the-browser-120)), fetches no font (the reader
face's inlined stylesheet names no font URL), and paints its logo and silhouette avatars inline. Two
things a host may still want: `img-src` for the reviewer's photo when the brand's def shows it (a reader
face `<img>` of the envelope's `photoUrl`, usually `https://assets.certrev.com`; a def that hides
`reviewerPhoto` loads no image, and a photo the policy blocks is repainted as the person's initials), and
`connect-src` only for a block that opts in to a browser read with `clientRead`. These are what the **modal**
needs:

- `connect-src` → the CertREV Delivery origin the element fetches the signed envelope from
  (production `https://portal.certrev.com`; staging `https://staging.portal.certrev.com`).
- `img-src` → `https://assets.certrev.com` (where CertREV headshots live, and where the modal's
  `/cdn-cgi/image/` display-sized derivative is served from) plus any other origin the envelope's
  `photoUrl` points at. `<CertBadge>` and `renderBadgeHtml` need the same allowance on the
  headless-React and universal-embed paths, since both emit the expert photo as an `<img>`.
- `font-src` → `https://assets.certrev.com`, unless you set `data-fonts="host"`. This one is easy
  to miss: Hydrogen's default `font-src` falls back to `default-src`, which does not include that
  host, so the modal's font faces fail to load and it renders in the fallback stack.

**`data-fonts` is the switch for that last one.** On first open the modal injects a `<style>` into
`document.head` declaring the five self-hosted families it uses: DM Sans, Playfair Display,
JetBrains Mono, Plus Jakarta Sans and Allura (12 `@font-face` rules, all pointing at
`https://assets.certrev.com/fonts/`), plus a crossorigin `preconnect` to that origin. Font faces
do not scope into a shadow root, which is why the injection is at document level. Set
`data-fonts="host"` to suppress it entirely; then the host page must self-host those five families
itself, and the modal adds no `font-src` origin to its CSP. Omitting the attribute is the default
and is fine; it just means the origin has to be in `font-src`.

`data-delivery-api` is the **origin only**: the element appends
`/api/cert/v1/delivery/{platform}/{externalId}`.

**Several faces on one page.** Each `[data-certrev-modal-open]` control opens its **own** face's
`<certrev-cert-modal>`, never simply the first one in the document (1.1.0 and earlier did that, so
every control on a two-face page opened the first face's certificate). A control's own modal is the
one in the smallest subtree around the control that holds exactly one; when the control sits inside
a face root `[data-certrev-cert]` (the WordPress plugin's per-face wrapper), only modals of that
same face count and the search never leaves it. So give each face its own modal, and wrap each face
in `data-certrev-cert` when faces share a container. A single face whose card and controls sit apart
(the Shopify embed), or one page-level modal (a Builder page), resolves as before. A control that
cannot tell which modal is its own (its face has none and it sits between two other faces' modals)
opens nothing: it gets `data-certrev-modal-unresolved="ambiguous"`, a bubbling
`certrev:modal-unresolved` event (`detail: { reason, modals }`) fires on it, and a link control
follows its own `href`.

### PULL: the editor-placed anchor (alternative)

`CertRevProvider` + the zero-input `CertRevAnchor` (`@certrev/cert-block/builder`) let an editor
drop the cert wherever they want it. Use this when placement is editorial
rather than exporter-driven. *(The anchor is preset-default only today; render-def theming on
the anchor path is a follow-up.)*

## The article route example

The route is where the two halves meet: `<Content>` renders the CMS-driven card, and the route
itself (server-side, from the verified envelope) emits the JSON-LD the card deliberately does
not own. This is the example `src/builder/index.tsx` refers to.

**Hydrogen / Remix** (`app/routes/blog.$handle.tsx`):

```tsx
import { useLoaderData } from '@remix-run/react'
import { Content, fetchOneEntry, isPreviewing } from '@builder.io/sdk-react'
import { certRevCertComponent } from '@certrev/cert-block/builder'
import { CertJsonLd, fetchingKidResolver, getVerifiedEnvelope } from '@certrev/cert-block'
import certScriptUrl from '@certrev/cert-block/modal/certrev-cert.js?url'

const MODEL = 'blog-article'
const resolveKid = fetchingKidResolver({ jwksUrl: 'https://certrev.com/.well-known/jwks.json' })

export async function loader({ params, request, context }) {
  const urlPath = new URL(request.url).pathname
  const apiKey = context.env.BUILDER_PUBLIC_API_KEY

  const content = await fetchOneEntry({ model: MODEL, apiKey, userAttributes: { urlPath } })
  if (!content) throw new Response('Not found', { status: 404 })

  // The externalId the cert was issued against: the Builder entry id for a Builder placement.
  const externalId = content.id
  const canonicalUrl = new URL(urlPath, 'https://brand.example.com').toString()

  // Verify per request. Do NOT long-cache this HTML: a revoked credential sitting in a stale
  // edge cache defeats fail-closed. The in-process TTL cache below already bounds origin load.
  const verdict = await getVerifiedEnvelope({
    source: {
      kind: 'delivery_api',
      baseUrl: 'https://portal.certrev.com',
      platform: 'builder',
      externalId,
    },
    resolveKid,
    context: { platform: 'builder', externalId },
  })

  return { content, apiKey, externalId, canonicalUrl, verdict }
}

export default function ArticleRoute() {
  const { content, apiKey, externalId, canonicalUrl, verdict } = useLoaderData<typeof loader>()

  return (
    <>
      {/* The STRUCTURED DATA: route-owned, from the verified payload. The card emits none. */}
      {verdict.decision === 'render' && (
        <CertJsonLd payload={verdict.payload} pageUrl={canonicalUrl} />
      )}

      {/* The VISIBLE CARD: placed by the CMS, rendered from the exporter's block options. */}
      <Content
        model={MODEL}
        content={content}
        apiKey={apiKey}
        customComponents={[certRevCertComponent]}
      />

      {/* The certificate modal the card's "View certificate" link opens. */}
      <certrev-cert-modal
        data-delivery-api="https://portal.certrev.com"
        data-platform="builder"
        data-external-id={externalId}
      />
      <script src={certScriptUrl} defer />
    </>
  )
}
```

The **Next.js App Router** shape is the same two halves in one async server component:

```tsx
import { Content, fetchOneEntry } from '@builder.io/sdk-react'
import { certRevCertComponent } from '@certrev/cert-block/builder'
import { CertJsonLd, fetchingKidResolver, getVerifiedEnvelope } from '@certrev/cert-block'

const resolveKid = fetchingKidResolver({ jwksUrl: 'https://certrev.com/.well-known/jwks.json' })

export default async function Page({ params }: { params: { slug: string[] } }) {
  const urlPath = `/${params.slug.join('/')}`
  const apiKey = process.env.NEXT_PUBLIC_BUILDER_API_KEY!
  const content = await fetchOneEntry({ model: 'blog-article', apiKey, userAttributes: { urlPath } })
  if (!content) return null

  const verdict = await getVerifiedEnvelope({
    source: {
      kind: 'delivery_api',
      baseUrl: 'https://portal.certrev.com',
      platform: 'builder',
      externalId: content.id,
    },
    resolveKid,
    context: { platform: 'builder', externalId: content.id },
  })

  return (
    <>
      {verdict.decision === 'render' && (
        <CertJsonLd payload={verdict.payload} pageUrl={`https://brand.example.com${urlPath}`} />
      )}
      <Content
        model="blog-article"
        content={content}
        apiKey={apiKey}
        customComponents={[certRevCertComponent]}
      />
    </>
  )
}
```

Four things about this shape that are easy to get wrong:

- **`<CertJsonLd>` is the route's, not the block's.** It wraps `projectCertJsonLd` +
  `serializeJsonLdForScript`; call those two directly if you are not rendering through React. Put
  it where your framework hoists `<script>` into `<head>` (Next: a layout/head; Hydrogen: React 19
  hoists it).
- **The two halves can disagree, and the failure is one-directional.** The card comes from the CMS
  and the JSON-LD comes from the verify layer, so on a `suppress` verdict the JSON-LD is correctly
  omitted while the card **still renders**. See [PUSH trust model](#push-trust-model). Only the
  structured data is fail-closed here.
- **Verify per request.** Treat the loader as a dynamic edge subrequest and do not long-cache the
  rendered HTML. `getVerifiedEnvelope`'s own TTL + single-flight cache is what keeps origin load
  bounded; see [Caching + deadlines](#caching--deadlines).
- **`externalId` must be the id the cert was issued against.** For a Builder placement that is the
  entry id the portal recorded at publish. A mismatch is not a soft failure: the kernel returns
  `suppress` with `reason: 'subject_mismatch'`, and nothing is logged.

## Fail-closed, where the verifying happens

**The verify layer never yields a credential it could not verify.** Every error path through
`getVerifiedEnvelope` / the `VerdictKernel` (bad signature, unknown kid, wrong post, revoked,
expired, content drift, network failure, fetch deadline, malformed JSON, a throwing resolver)
collapses to a `suppress` verdict, never an exception that a caller could swallow into a render.
`<CertReview>` and `<CertRevBacklink>` fail closed at the component boundary too (suppress /
unsafe URL → render nothing). The verify path is the one to reach for when the guarantee has to
be cryptographic.

**Scope it deliberately: this is a property of the verify layer, not of every entry point.** The
registered Builder card takes CMS block options, not an envelope, so it verifies nothing. See
[PUSH trust model](#push-trust-model). `renderCertBlock` and `renderBadgeHtml` are string
renderers over facts a caller supplies; whether those facts were verified is the caller's
business. A component that never receives a signature cannot check one, and this section used to
read as though it did.

What IS true everywhere, including those paths: nothing here throws into a render, and every
field is escaped. URLs pass through `safeHttpUrl` (drops `javascript:`/`data:`); accent colors
through `safeCssColor`; a value of the wrong type degrades to an empty render instead of crashing
the route; the JSON-LD body neutralizes `<`/`>` so a hostile memo can't break out of the
`<script>` tag; and every anchor the package emits carries `CERTREV_LINK_REL`
(`nofollow sponsored noopener`).

## Server-safe guarantee

- The main entry never touches `customElements` / `window`; the Web Component ships from the `./webcomponent` subpath so importing `@certrev/cert-block` in an RSC/Node loader is side-effect-free. Registration only happens when you call `defineCertRevBadge()` in a browser.
- The React components are render-pure (verified by `react-dom/server` SSR tests) so they work as Server Components and as client components that SSR identically: same crawlable output either way.
- Date formatting is deterministic UTC (fixed English month abbreviations, not `toLocaleDateString`) so SSR output is byte-stable and never causes a hydration mismatch.

## The contract dependency

The shared contract types + the fail-closed `VerdictKernel` live in
[`@certrev/cert-contract`](https://www.npmjs.com/package/@certrev/cert-contract) (published, MIT).
Since `0.5.3` it is a **regular dependency**: `npm i @certrev/cert-block` brings it along; a
brand integration never imports it directly. Its one runtime dependency is `canonicalize` (the
RFC-8785 JCS implementation used for signature verification). To be clear about that word:
**nothing cryptographic runs at card render**. The cert card draws purely from block options;
verification enters only with the modal / the `getVerifiedEnvelope` verify layer.

React is the one **peer** dependency left: **`react >=18.0.0`**, declared non-optional, so a
peer-enforcing resolver (npm 7+) fails the install on React 17 with `ERESOLVE` rather than
warning. Only the React entries need it: `./webcomponent` and `./modal` build React-free (no
`react/jsx-runtime`) and there is no `react-dom` peer.

**What CI actually proves about that range: React 18.3 only.** One job, Node 20, installing the
`react@^18.3.1` devDependency: it builds, typechecks and runs the whole suite including the
`react-dom/server` SSR tests, but there is no version matrix and no React 19 job. `>=18.0.0` is
the range `package.json` declares, not a range CI exercises. Nothing in the package imports a
React-19-only API (the package's only `react` import is `createContext` / `useContext` in the
PULL anchor, and every other component is render-pure with no hooks), so 19 is expected to work.
That is expectation, not evidence; if you run 19 you are the first to find out.

## Known issues (upstream)

- `@builder.io/sdk-react@5.2.4` ships types that fail to compile under
  `moduleResolution: "nodenext"` (TS2834 cascade inside the SDK's own imports). cert-block's own
  types are clean under both `bundler` and `nodenext` in an ESM consumer. Hydrogen / Remix / Vite
  storefronts use `bundler` resolution and are unaffected.

## Target surfaces

- Brand-owned Hydrogen / Next / Remix storefronts (`headless_react`), Builder.io spaces
  (`headless_visual_cms`), and any site dropping in `<certrev-badge>` (`universal_embed`).

## Current consumers

| Consumer | Status |
|---|---|
| Portal | **Not importing yet.** Portal is where the vendored halves came FROM, and it still holds its own copies: `BuilderCertChromeData` is duplicated on the Portal side, and `src/modal/font-face.ts` + `src/modal/avatar-resize.ts` here are byte-faithful copies of Portal's. Portal also owns the exporter that writes the block options, and its `certComponent` connection field defaults to `CERT_COMPONENT_NAME`. The migration (Portal importing this package instead of hand-syncing) is what the package headers call "gated on publishing". Ping on any change to `BuilderCertChromeData`, `renderCertBlock`, the modal bundle, or `CERT_ISSUER_KID` / `CERT_ISSUER_PUBLIC_KEY_PEM`. |
| Brand headless storefronts | **Live, via npmjs, and NOT enumerable from this repo.** `@certrev/cert-block` publishes publicly, so anyone can `npm i` it. Nothing in this repo records which brands have. |
| AgOS | None. No AgOS-side import is referenced anywhere in this repo. |
| This monorepo | None. No other package here declares a dependency on `@certrev/cert-block` (it depends on `@certrev/cert-contract`, not the reverse). |

**The edge this list admits: the public npm consumers are unknown to it.** A version bump here can
reach a brand storefront nobody in this repo can name, which is the difference between this package
and the `file:`-dep packages alongside it. Treat the CHANGELOG's semver contract (patch and minor
never change the rendered cert output and never break a compiling integration) as the actual
notification channel, because for those consumers it is the only one.

## Tests

`pnpm test` (Vitest) runs every test file. They sit next to what they cover: `src/__tests__/`
for the cross-cutting suites, `src/builder/__tests__/` for the Builder kit, and `src/modal/*.test.ts`
alongside each modal module. The load-bearing ones:

- **`__tests__/verify.test.ts`** exercises the kernel via the SDK binding with **real Ed25519 over JCS** (freshly-signed fixture envelopes, no mocked crypto): render, tamper → `invalid_signature`, unknown kid, platform/subject mismatch, revoked, expired, content drift; `getVerifiedEnvelope` over metafield (object + JSON-string) and Delivery API sources, 404/410 fail-closed, fetch deadlines (a hung origin and a hung JWKS endpoint both abort), cache-key identity (base URL, placement, live content hash), and the **single-flight** thundering-herd guard (N concurrent renders → one fetch).
- **`__tests__/project.test.ts`** covers the JSON-LD projector: `@graph` shape, WebPage / Article `@id` host-merge alignment (query + fragment stripped), expert-as-`reviewedBy`, credentials → `hasCredential` + `honorificSuffix`, CertREV-namespaced node `@id`s, visibility gating through `resolveDisplay`, determinism, and `</script>` / HTML-comment neutralization.
- **`__tests__/components.test.tsx`** renders every React component through `react-dom/server` with mock facts: structure, accessibility (`aria-label`, heading levels), accent theming, display-flag honoring, hostile-input escaping, `javascript:`-URL dropping, link qualification, and fail-closed (`suppress` verdict / unsafe URL → nothing).
- **`__tests__/render-cert-block.test.ts`** + **`__tests__/render-def.test.tsx`**: the locked 3-mode string renderer (placement default, banner `part` split, locked compliance copy) and render-def theming / subtractive visibility.
- **`__tests__/escape-family.test.ts`** puts both escape families (`components/` and `modal/`) against wrong-typed input, not just null: a half-filled CMS object must degrade, never throw.
- **`__tests__/webcomponent.test.tsx`**: the shared `renderBadgeHtml` string renderer (hand-escaping, unsafe-URL/color dropping, compact style) and the `<certrev-badge>` custom element (idempotent registration, SSR light-DOM preservation, client-mode fail-closed without a resolver).
- **`builder/__tests__/builder.test.tsx`** covers the PUSH card and its registration: the wire-type ⇄ inputs parity lock, the fused-credential gate, and the mistyped-option degradation.
- **`builder/__tests__/delivery-card-hydrate.test.tsx`** + **`builder/__tests__/ssr-seed.test.tsx`** (1.2.0): a server-rendered delivery card hydrates on both faces with zero browser reads, no mismatch and the same nodes; its seed is the served envelope and still verifies; revoked and browser-clock-expired cards come down; a later client mount reuses the page's seed; the server's options and none records are kept through hydration and through React's client re-render after a hydration error, with no read; a client mount with no record makes no read and paints the options face or nothing, and only with `clientRead` reads once, or renders nothing and logs nothing when the read is refused; a reviewer photo that fails to load repaints as initials; the seed and fallback-record parsers refuse malformed records and each other's; the design pin is part of the seed's key; a hidden `reviewerPhoto` or `memo`, or `display.showExpertPhoto: false` (the photo URLs), is absent from the whole server HTML and the seed carries no signature; every server render in these files runs under jsdom with no server switch; and the card's inlined reader stylesheet names no font URL. **`builder/__tests__/delivery-card.test.tsx`** pins the unreachable cases to the 1.0.3 options face byte for byte, and the 8 s deadline and the stale window; **`verify/__tests__/cache.test.ts`** the cache's stale-while-revalidate, stale-if-error and in-flight limit. **`reader/__tests__/reader-initials.test.ts`** pins the initials bytes (honorifics, escaping, hidden and missing photos, `showExpertPhoto`, the empty name).
- **`builder/__tests__/delivered-face.test.tsx`** + **`builder/__tests__/delivered-face-client.test.tsx`** + **`builder/__tests__/delivered-face-use.test.tsx`** (1.3.0): the delivered face paints, server and browser (hydration, a client mount over the page's record, a streamed record, `clientRead`), only when its hashes match the signed digest for the def served, on an unpinned whole-card block; every other delivery, and a browser that cannot hash, renders what the unmodified 1.2.1 card rendered for the same input, byte for byte, seed included (`__golden__/delivered-face-1.2.1.json`, `__golden__/delivered-face-client-1.2.1.json`); a tampered digest suppresses.
- **`builder/__tests__/streamed-record-card.test.tsx`** (1.2.1): a card the client renders while the page loads paints nothing, then the record the stream adds, to the document (#421) or to the server's `<html>` after React replaced it (#423, with and without `MutationObserver`), and what a client mount paints once the page loads with none; pinned, options, none and expired records; no read; hydration, `clientRead` and a loaded page unchanged.
- **`modal/*.test.ts`**, per module: the modal element (tombstone → `markSuppressed`), the dialog view, interactions, placement, badge revalidation, and the Delivery-API verify client. `modal/own-face-modal.test.ts` puts two faces on one page and proves each control opens its own face's modal; `modal/closed-container-face.test.ts` proves a face that loads inside a closed `<details>`, tab or accordion is left alone and renders when opened (there is no runtime disclosure guard).
- **`__tests__/readme-version.test.ts`** + **`__tests__/readme-contract.test.ts`** pin the claims in this file that rot silently: the version stamp against `package.json`, the key id, the route-example heading, and every `exports` subpath appearing under Public API.

Facts are mocked via `makeMockPayload` / `makeSignedEnvelope` (`src/contract/fixtures.ts`, also
published at `@certrev/cert-block/fixtures`).

## Version

`1.3.0`: see [CHANGELOG.md](./CHANGELOG.md) for the release history and the semver contract
(patch/minor never change the rendered cert output or break a compiling integration). Publishes
**publicly** to npm as `@certrev/cert-block` (`publishConfig.access: public`) via GitHub Actions
trusted publishing (OIDC); the internal `@certrev` GitHub-Packages channel mirrors it.

Source is public at [`CertREV/cert-kit`](https://github.com/CertREV/cert-kit) (MIT). This
package is `packages/cert-block/`; report a vulnerability privately through that repo's
`SECURITY.md`. The tarball also ships `src/` alongside `dist/`, so a security review reads the
exact code for the version it installed.

**cert-kit is a published-source mirror, not the build repo, so don't go looking for the CI in
it.** It is a flat snapshot: source and config, one commit per release, no `.github/`. The
workflows referenced above (build, typecheck, test, biome; and the OIDC trusted publish) live in
CertREV's private release repo, which is what npm records as this package's `gitHead`. Two
consequences worth naming rather than leaving a reviewer to discover: those `gitHead` commits 404
against the public mirror, and the publishes carry **no provenance attestation**: npm generates
provenance under trusted publishing only when the OIDC claim says the source repo is public, and
this one is private. Moving the publish job into the mirror is the only real fix; adding
`--provenance` to a private-repo publish changes nothing. What you CAN check today is the code
itself: the mirror is gated to rebuild every published `dist/` file byte for byte from the `src/`
in the same tag.
