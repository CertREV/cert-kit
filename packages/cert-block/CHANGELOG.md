# Changelog: @certrev/cert-block

The cert card is a **design-locked** component. Semver contract: **patch and minor releases never
change the rendered cert output and never break a compiling integration** (registration surface,
exports, types). Anything that would alter what a visitor sees, or require integration changes,
is announced loudly here first.

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
