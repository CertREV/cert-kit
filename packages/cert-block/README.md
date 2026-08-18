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

// Certificate modal: the ONE SIDE-EFFECTING entry in the package. Importing it registers
// <certrev-cert-modal> and, in a browser, starts four DOM passes (placement, interactions,
// FTC guard, badge revalidation). Browser only. Never import it from server code. Most
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
`aria-hidden` on **every** `[data-certrev-modal-open]` control in the document. So the certificate
links disappear on that page view. The card body (the reviewer's name, the credential, the memo,
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

CSP allowances for the headless host. The **registered card** needs none; it fetches no font,
loads no image (the avatar is rendered initials) and inlines its logo as SVG. These are what the
**modal** needs:

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

`pnpm test` (Vitest) runs all 17 test files. They sit next to what they cover: `src/__tests__/`
for the cross-cutting suites, `src/builder/__tests__/` for the Builder kit, and `src/modal/*.test.ts`
alongside each modal module. The load-bearing ones:

- **`__tests__/verify.test.ts`** exercises the kernel via the SDK binding with **real Ed25519 over JCS** (freshly-signed fixture envelopes, no mocked crypto): render, tamper → `invalid_signature`, unknown kid, platform/subject mismatch, revoked, expired, content drift; `getVerifiedEnvelope` over metafield (object + JSON-string) and Delivery API sources, 404/410 fail-closed, fetch deadlines (a hung origin and a hung JWKS endpoint both abort), cache-key identity (base URL, placement, live content hash), and the **single-flight** thundering-herd guard (N concurrent renders → one fetch).
- **`__tests__/project.test.ts`** covers the JSON-LD projector: `@graph` shape, WebPage / Article `@id` host-merge alignment (query + fragment stripped), expert-as-`reviewedBy`, credentials → `hasCredential` + `honorificSuffix`, CertREV-namespaced node `@id`s, visibility gating through `resolveDisplay`, determinism, and `</script>` / HTML-comment neutralization.
- **`__tests__/components.test.tsx`** renders every React component through `react-dom/server` with mock facts: structure, accessibility (`aria-label`, heading levels), accent theming, display-flag honoring, hostile-input escaping, `javascript:`-URL dropping, link qualification, and fail-closed (`suppress` verdict / unsafe URL → nothing).
- **`__tests__/render-cert-block.test.ts`** + **`__tests__/render-def.test.tsx`**: the locked 3-mode string renderer (placement default, banner `part` split, locked compliance copy) and render-def theming / subtractive visibility.
- **`__tests__/escape-family.test.ts`** puts both escape families (`components/` and `modal/`) against wrong-typed input, not just null: a half-filled CMS object must degrade, never throw.
- **`__tests__/webcomponent.test.tsx`**: the shared `renderBadgeHtml` string renderer (hand-escaping, unsafe-URL/color dropping, compact style) and the `<certrev-badge>` custom element (idempotent registration, SSR light-DOM preservation, client-mode fail-closed without a resolver).
- **`builder/__tests__/builder.test.tsx`** covers the PUSH card and its registration: the wire-type ⇄ inputs parity lock, the fused-credential gate, and the mistyped-option degradation.
- **`modal/*.test.ts`**, per module: the modal element (tombstone → `markSuppressed`), the dialog view, interactions, placement, badge revalidation, the FTC guard, and the Delivery-API verify client.
- **`__tests__/readme-version.test.ts`** + **`__tests__/readme-contract.test.ts`** pin the claims in this file that rot silently: the version stamp against `package.json`, the key id, the route-example heading, and every `exports` subpath appearing under Public API.

Facts are mocked via `makeMockPayload` / `makeSignedEnvelope` (`src/contract/fixtures.ts`, also
published at `@certrev/cert-block/fixtures`).

## Version

`1.0.3`: see [CHANGELOG.md](./CHANGELOG.md) for the release history and the semver contract
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
