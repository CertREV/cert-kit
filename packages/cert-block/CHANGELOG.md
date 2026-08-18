# Changelog: @certrev/cert-block

The cert card is a **design-locked** component. Semver contract: **patch and minor releases never
change the rendered cert output and never break a compiling integration** (registration surface,
exports, types). Anything that would alter what a visitor sees, or require integration changes,
is announced loudly here first.

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
