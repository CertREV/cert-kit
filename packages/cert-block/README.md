# @certrev/cert-block

The headless / `crypto_verify` render edge for the CertREV `CertDeliveryEnvelope`. Sign once in the portal, render everywhere: SSR-safe React components, a deterministic schema.org JSON-LD projector, a fail-closed verify layer over the shared `VerdictKernel`, and a framework-agnostic `<certrev-badge>` Web Component.

This is the SDK the brand SSRs into a Hydrogen loader, a Next server component, a Builder client component, or a universal server-side include. It is the `headless_react` + `universal_embed` surface classes from the cross-platform delivery design.

## What this is

CertREV's durable asset is a portable, forgery-proof "this content was reviewed by a credentialed expert" credential — a single Ed25519-signed `CertDeliveryEnvelope`. Each delivery surface renders the visible UI + JSON-LD from that envelope and enforces its validity. The WordPress plugin does it in PHP; the Shopify Liquid extension does it in Liquid; **this package does it in TS/JS for any React or vanilla-JS surface that can run Node/WebCrypto.**

The package gives a brand four things:

1. **React components** — `<CertBadge>`, `<ExpertBio>`, `<CertRevBacklink>`, `<CertJsonLd>`, and the `<CertReview>` composite. SSR-safe (render-pure; no `useState`/`useEffect`/browser globals), theme-light, accessible, and they escape every field. Presentation is driven by the signed `content.display` config (`badgeStyle`, `accentColor`, `showExpertPhoto`, `showMemo`, `showAuthor`).
2. **A deterministic JSON-LD projector** — `projectCertJsonLd(facts)` → a schema.org `Article` + `reviewedBy(Person)` + `Review` + `Organization` `@graph`, designed to **merge by `@id`** into the host page's existing Article graph (won't collide with Yoast / the theme's structured data). The JSON-LD is **projected from the facts at render time, never stored in the envelope.**
3. **A thin verify layer** — `getVerifiedEnvelope(source)` fetches the signed envelope from **either a Shopify metafield OR the Delivery API** (`GET /api/cert/v1/delivery/{platform}/{externalId}`), runs the fail-closed `VerdictKernel`, and caches the verdict (TTL + single-flight) so concurrent SSR renders don't stampede the origin.
4. **A Web Component** — `<certrev-badge>`, the `universal_embed` surface for sites with no native integration, wrapping the same render as `<CertBadge>` via a shared string renderer.

## The contract shape (settled)

A `CertDeliveryEnvelope = { payload, signature }`. The detached `signature` is **Ed25519 over RFC-8785 JCS(payload)**.

```
payload = {
  contractVersion: 1,
  certId,
  subject:   { platform, externalId, logicalArticleId, canonicalUrls[], installationId, contentDigest },
  content:   { expert{displayName,credentials[],profileUrl,photoUrl}, author{name,title},
               memo, certifiedAt, contentModifiedAt, verifyUrl,
               display{accentColor,showExpertPhoto,showAuthor,showMemo,badgeStyle} },
  lifecycle: { issuedAt, expiresAt, revokedAt|null, revision },
}
```

`content` is **structured FACTS**, not rendered JSON-LD — the JSON-LD is projected from these facts at render, never stored. The `VerdictKernel` (shared) verifies the signature, then checks subject (`platform`/`externalId`), lifecycle (`revokedAt`/`expiresAt`), and content drift (`contentDigest` vs the live hash), failing closed at every step.

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

// Web Component (separate subpath — does NOT touch customElements on import)
import { defineCertRevBadge, setCertRevKidResolver } from '@certrev/cert-block/webcomponent'

// Builder.io registration (separate subpath; no Builder dependency)
import { certRevCertComponent, BUILDER_REGISTRATION, CERT_COMPONENT_NAME } from '@certrev/cert-block/builder'
```

## Usage — headless React (Hydrogen / Next server component)

Fetch + verify in the **server** runtime (it can run Ed25519 over JCS — full `crypto_verify` parity), then render the badge + JSON-LD only on a `render` verdict.

```tsx
import { getVerifiedEnvelope, staticKidResolver, CertReview } from '@certrev/cert-block'

const resolveKid = staticKidResolver({ 'certrev-2026-1': process.env.CERTREV_PUBKEY_PEM! })

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

## Usage — JSON-LD merge (don't collide with Yoast)

The Article node carries the SAME `@id` the host page's primary Article uses (`{pageUrl}#article`, query + fragment stripped), so a consumer **merges** our `reviewedBy` / `dateModified` into the existing node instead of emitting a competing primary entity. Pass `wrapGraph: false` to get a bare node array to splice into a `@graph` you already own.

```ts
const graph = projectCertJsonLd(payload, { pageUrl: canonicalUrl })          // { '@context', '@graph' }
const nodes = projectCertJsonLd(payload, { pageUrl: canonicalUrl, wrapGraph: false }) // bare node[]
```

## Usage — universal embed (Web Component)

Preferred mode is **SSR + hydrate** (crawlable): a server-side include emits the badge HTML (via `renderBadgeHtml`) inside the element; the component leaves the server-rendered child alone. Client-fetch mode (not crawlable) is a documented fallback and is **fail-closed** — it renders nothing without a configured key resolver.

```html
<!-- SSR: server emits the badge markup inside the tag; crawler reads it -->
<certrev-badge>{{ renderBadgeHtml(payload) }}</certrev-badge>

<script type="module">
  import { defineCertRevBadge, setCertRevKidResolver } from '@certrev/cert-block/webcomponent'
  setCertRevKidResolver(myResolver) // only needed for the client-fetch fallback
  defineCertRevBadge()
</script>
```

## Usage — Builder.io (the cert component)

Two ways to place the visible cert on a Builder.io page. **PUSH is the primary story** for
exporter-driven brands (the cert block arrives with the CertREV-drafted entry); the PULL anchor
is the editor-placed alternative (W4, POR-10721).

### PUSH — the registered cert block (recommended)

CertREV's exporter emits a cert block whose options are the `BuilderCertChromeData` projection.
Register the ready component once, from the `./builder` subpath — one import, one entry in the
`customComponents` array your app already passes to the gen2 SDK's `<Content>` (the same array
your other custom components render from). No hand-mapped options, no hand-maintained inputs:

```tsx
// gen2 SDKs (@builder.io/sdk-react and friends — Hydrogen/Remix, Next, Gatsby)
import { certRevCertComponent } from '@certrev/cert-block/builder'

<Content
  model="blog-article"
  content={content}
  apiKey={apiKey}
  customComponents={[...yourExistingComponents, certRevCertComponent]}
/>
```

On `0.5.2` and earlier (before `certRevCertComponent` existed), build the entry from the
canonical readonly view — the spread sheds the `readonly` typing, which the gen2 SDK's mutable
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
`BuilderCertChromeData` wire type (drift-locked — the exporter option keys, the registered
inputs, and the type can never diverge silently). The 19 exporter-populated wire inputs are
marked `advanced`, so the editor's Options tab leads with the two placement choices an editor
actually makes (`mode`, `part`). The component enforces the fused-credential rule by
construction (a credential is unrenderable without its dated verification) and themes to the
brand's render-def (accent / surface / corners / font + v2 bar-ink / body-ink).

### The certificate modal + CSP

The "View certificate" affordance opens an envelope-verified modal. The browser bundle **ships
in-package**: a prebuilt, dependency-free, minified IIFE at `@certrev/cert-block/modal/certrev-cert.js`.
Serve it as an external `<script>` — do **not** side-effect-import it into server code (it
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

Two CSP allowances for the headless host — the modal is the ONLY part that needs any (the card
renders zero external assets: no fonts fetched, no images, inline-SVG logo):

- `connect-src` → the CertREV Delivery origin the element fetches the signed envelope from
  (production `https://portal.certrev.com`; staging `https://staging.portal.certrev.com`).
- `img-src` → `https://cdn.builder.io` + whatever origin the envelope's expert-headshot
  `photoUrl` points at (CertREV portal assets in production).

`data-delivery-api` is the **origin only** — the element appends
`/api/cert/v1/delivery/{platform}/{externalId}`. Preview drafts with `includeUnpublished` on the
public key.

### PULL — the editor-placed anchor (alternative)

`CertRevProvider` + the zero-input `CertRevAnchor` (`@certrev/cert-block/builder`) let an editor
drop the cert wherever they want it (panel-validated). Use this when placement is editorial
rather than exporter-driven. *(The anchor is preset-default only today — render-def theming on
the anchor path is a follow-up.)*

## Fail-closed, everywhere

The package never renders an unverified credential. Every error path — bad signature, unknown kid, wrong post, revoked, expired, content drift, network failure, malformed JSON, a throwing resolver — collapses to a `suppress` verdict (or a `null` render), never an exception that a caller could swallow into a render. `<CertReview>` and `<CertRevBacklink>` also fail closed at the component boundary (suppress / unsafe URL → render nothing). URLs pass through `safeHttpUrl` (drops `javascript:`/`data:`); accent colors through `safeCssColor`; the JSON-LD body neutralizes `<`/`>` so a hostile memo can't break out of the `<script>` tag.

## Server-safe guarantee

- The main entry never touches `customElements` / `window` — the Web Component ships from the `./webcomponent` subpath so importing `@certrev/cert-block` in an RSC/Node loader is side-effect-free. Registration only happens when you call `defineCertRevBadge()` in a browser.
- The React components are render-pure (verified by `react-dom/server` SSR tests) so they work as Server Components and as client components that SSR identically — same crawlable output either way.
- Date formatting is deterministic UTC (fixed English month abbreviations, not `toLocaleDateString`) so SSR output is byte-stable and never causes a hydration mismatch.

## The contract dependency

The shared contract types + the fail-closed `VerdictKernel` live in
[`@certrev/cert-contract`](https://www.npmjs.com/package/@certrev/cert-contract) (published, MIT).
Since `0.5.3` it is a **regular dependency** — `npm i @certrev/cert-block` brings it along; a
brand integration never imports it directly. Its one runtime dependency is `canonicalize` (the
RFC-8785 JCS implementation used for signature verification). To be clear about that word:
**nothing cryptographic runs at card render** — the cert card draws purely from block options;
verification enters only with the modal / the `getVerifiedEnvelope` verify layer.

React is the one **peer** dependency left — **`react >=18.0.0`**, declared non-optional, so a
peer-enforcing resolver (npm 7+) fails the install on React 17 with `ERESOLVE` rather than
warning. Only the React entries need it: `./webcomponent` and `./modal` build React-free (no
`react/jsx-runtime`) and there is no `react-dom` peer. CI builds and runs the SSR tests on
React 18.3; the range admits 19.

## Known issues (upstream)

- `@builder.io/sdk-react@5.2.4` ships types that fail to compile under
  `moduleResolution: "nodenext"` (TS2834 cascade inside the SDK's own imports). cert-block's own
  types are clean under both `bundler` and `nodenext` in an ESM consumer. Hydrogen / Remix / Vite
  storefronts use `bundler` resolution and are unaffected.

## Target surfaces

- Brand-owned Hydrogen / Next / Remix storefronts (`headless_react`), Builder.io spaces
  (`headless_visual_cms`), and any site dropping in `<certrev-badge>` (`universal_embed`).

## Tests

`pnpm test` (Vitest). Coverage:

- **`__tests__/verify.test.ts`** — the kernel via the SDK binding with **real Ed25519 over JCS** (freshly-signed fixture envelopes, no mocked crypto): render, tamper → `invalid_signature`, unknown kid, platform/subject mismatch, revoked, expired, content drift; `getVerifiedEnvelope` over metafield (object + JSON-string) and Delivery API sources, 404/410 fail-closed, and the **single-flight** thundering-herd guard (N concurrent renders → one fetch).
- **`__tests__/project.test.ts`** — the JSON-LD projector: `@graph` shape, Article `@id` host-merge alignment (query + fragment stripped), expert-as-`reviewedBy`, credentials → `hasCredential` + `honorificSuffix`, CertREV-namespaced node `@id`s, determinism, and `</script>` / HTML-comment neutralization.
- **`__tests__/components.test.tsx`** — every React component rendered through `react-dom/server` with mock facts: structure, accessibility (`aria-label`, heading levels), accent theming, display-flag honoring, hostile-input escaping, `javascript:`-URL dropping, and fail-closed (`suppress` verdict / unsafe URL → nothing).
- **`__tests__/webcomponent.test.tsx`** — the shared `renderBadgeHtml` string renderer (hand-escaping, unsafe-URL/color dropping, compact style) and the `<certrev-badge>` custom element (idempotent registration, SSR light-DOM preservation, client-mode fail-closed without a resolver).

Facts are mocked via `makeMockPayload` / `makeSignedEnvelope` (`src/contract/fixtures.ts`).

## Version

`0.5.5` — see [CHANGELOG.md](./CHANGELOG.md) for the release history and the semver contract
(patch/minor never change the rendered cert output or break a compiling integration). Publishes
**publicly** to npm as `@certrev/cert-block` (`publishConfig.access: public`) via GitHub Actions
trusted publishing (OIDC); the internal `@certrev` GitHub-Packages channel mirrors it.

Source is public at [`CertREV/cert-kit`](https://github.com/CertREV/cert-kit) (MIT) — this
package is `packages/cert-block/`; report a vulnerability privately through that repo's
`SECURITY.md`. The tarball also ships `src/` alongside `dist/`, so a security review reads the
exact code for the version it installed.
