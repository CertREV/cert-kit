# Changelog — @certrev/cert-block

The cert card is a **design-locked** component. Semver contract: **patch and minor releases never
change the rendered cert output and never break a compiling integration** (registration surface,
exports, types). Anything that would alter what a visitor sees — or require integration changes —
is announced loudly here first.

## 0.5.5 — 2026-07-31

- **New:** `repository`, `homepage`, and `bugs` in `package.json` — the npm page now links to the
  public source mirror (`github.com/CertREV/cert-kit`, `packages/cert-block`) and to the issue
  tracker, so the registry listing is no longer a dead end. Provenance metadata only: no code, no
  exports, no dependency change.
- **Docs:** README gains a source-repo link and states the peer requirement explicitly — **React
  `>=18`**. `peerDependencies.react` has enforced `>=18.0.0` since before 0.5.0 (and
  `peerDependenciesMeta` marks it non-optional), but the README never said so; a consumer had to
  read `package.json` to find the floor.
- Rendered output: **byte-identical to 0.5.4** (metadata and prose only — no file under `dist/`
  changes).

## 0.5.4 — 2026-07-23

- **Backfilled — this release shipped with no entry.** 0.5.4 published 2026-07-23 and is the first
  release after this file was written; every other version from 0.3.0 on has a section, including
  0.5.2 (a no-op republish). It changed the public type surface without the notice the contract
  above requires. The omission is recorded here rather than quietly closed.
- **Changed:** `FONT_SLOTS` / `FONT_STACKS` (`render-def`) widened 3 → 5 — `grotesk` (Plus Jakarta
  Sans) and `mono` (JetBrains Mono) added at the shared guide values, byte-identical to this
  package's `RENDER_BLOCK_FONT_STACKS`, the portal `FONT_SLOT_STACKS`, and the Liquid twin's
  branches. Purely additive: `sans` / `serif` / `system` are untouched, so the card == modal
  invariant holds. Shipped lockstep with the portal's Liquid + WordPress grotesk/mono wiring
  (POR-10775 / POR-10721) — Phase-3 enablement of a vocabulary that was dormant on both engines,
  not a repair of a live intra-page mismatch: before this release the Liquid card dropped
  `grotesk`/`mono` too, and fell back exactly as the modal did.
- **Breaking (types) — belonged in a minor, with notice:** `FONT_SLOTS`, `FONT_STACKS`, `FontSlot`
  and `isFontSlot` are public exports. Widening the `FontSlot` union 3 → 5 breaks any consumer
  holding an exhaustive `Record<FontSlot, string>` or an exhaustive `switch` over the slots — a
  break of a compiling integration (exports, types) under the semver contract at the top of this
  file, shipped in a patch.
- Rendered output: the design-locked cert card and the modal bundle are **byte-identical to
  0.5.3** — across the two published tarballs `dist/components/render-cert-block.js` (sha1
  `22267d5d…`) and all 65 files under `dist/modal/` (`certrev-cert.js` sha1 `2013ebbe…`) are
  unchanged, and neither resolves the shared `FONT_STACKS` (the card carries its own
  `RENDER_BLOCK_FONT_STACKS`, which already listed all five slots; the modal consults no font map
  at all). `<certrev-badge>` passes no `renderDef`, so it is unaffected by construction. Output can
  differ on ONE path: a caller passing a `renderDef` with `fontSlot: 'grotesk' | 'mono'` into the
  legacy `<CertBadge>` / `renderBadgeHtml`, where that slot now resolves to a `--certrev-font`
  stack instead of being dropped as invalid. No brand could author those slots at release time (the
  portal editor did not offer them; every known `render_def` writer emits `sans`), so no visitor's
  render is known to have changed — that last point is inference from the call graph and the
  authoring surface, not a production data check.

## 0.5.3 — 2026-07-22

- **New:** `certRevCertComponent` (`./builder`) — the drop-in gen2 registration entry, with the
  mutable `inputs[]` the SDK's `RegisteredComponent` type expects:
  `customComponents={[...yourComponents, certRevCertComponent]}`. One import, no re-wrapping, no
  readonly spread. `BUILDER_REGISTRATION` (the readonly canonical view) is unchanged.
- **New:** the 19 exporter-populated wire inputs are marked `advanced` — the Builder editor's
  Options tab now leads with the two placement inputs (`mode`, `part`) and tucks the
  system-populated fields under "Advanced". Editor-cosmetic only.
- **Changed:** `@certrev/cert-contract` moved from a peer dependency (`>=0.5.0`, unbounded) to a
  regular dependency (bounded `^0.5.0`) — a plain `npm i @certrev/cert-block` is a complete
  install regardless of the consumer's peer-install settings, and a future contract 0.6 can no
  longer float in unreviewed.
- **Docs:** README rewritten for the gen2 SDK (`customComponents` array) — the previous README
  showed the gen1 `Builder.registerComponent` API and pre-publish notes that no longer applied
  (the contract package and the modal bundle both ship for real since 0.5.x). Added in-package
  modal instructions (`?url` import + external script + literal CSP allowances), a known-issues
  note (`@builder.io/sdk-react@5.2.4` types under `moduleResolution: nodenext`), and this
  changelog.
- Rendered output: **byte-identical to 0.5.2** (changes outside the registration surface are
  comment-only).

## 0.5.2 — 2026-07-21

- Republish of 0.5.1 (the 0.5.1 GitHub-Packages tarball was unfetchable). No code changes.

## 0.5.1 — 2026-07

- `./modal/placement` subpath exposed (the side-effect-free placement engine).

## 0.5.0 — 2026-07

- The certificate-modal Web Component moved **into** the package (POR-10721 W2): prebuilt
  dependency-free IIFE at `./modal/certrev-cert.js` (byte-parity with the deployed theme-extension
  asset) + the `./modal` subpath. Banner memo placement (`part`), font hook, static preview block.

## 0.4.0 — 2026-07

- Render strictly from `placedFields` + `renderCustomFace`; v2 brand-ink theming
  (`barInk` / `inkColor`).

## 0.3.0 and earlier

- The locked 3-mode `renderCertBlock` faces, re-synced to the final Liquid design; the
  ambient-URL anchor model (`CertRevAnchor`, zero-input); the initial React components, JSON-LD
  projector, fail-closed verify layer, and `<certrev-badge>` Web Component.
