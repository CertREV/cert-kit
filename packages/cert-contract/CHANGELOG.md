# Changelog: @certrev/cert-contract

The signed-envelope contract. Semver contract: **the canonical byte contract (RFC-8785 JCS over
the payload) and the fail-closed `VerdictKernel` semantics never change in a patch or minor**;
payload extensions are additive (old edges suppress unknown shapes: fail-closed by design).

## 0.6.0 · 2026-08-30

- **New top-level content field: `basis`.** Mirrors the portal's `certifications.basis` CHECK
  vocabulary (`direct_review`, `faithful_incorporation`, `hand_back_reapproval`, and the new
  `brand_amendment_unreviewed`) — the certification's provenance basis, riding the signed bytes
  when a mint supplies it. Additive and optional: `buildPayload` omits the key entirely when the
  caller does not populate `CertFacts.basis`, so an envelope minted without it is byte-identical to
  a pre-0.6 envelope (same omit-when-undefined discipline as `articleTitle`/`displayCertId` in
  0.5). `CONTRACT_VERSION` stays `1` — this is a non-breaking content extension, not an envelope
  version bump.
- **Schema updated to match.** `cert-delivery-envelope.v1.schema.json`'s `CertContent` gained a
  `basis` enum property (the four vocabulary values plus `null`), `additionalProperties: false`
  otherwise unchanged.
- A top-level key, not nested under `expert`: `basis` describes what the certificate COVERS, not
  who reviewed it, so it does not ride for free the way a nested `expert.*`/`author.*` extension
  would — it must be (and now is) enumerated explicitly in `buildPayload`.

## 0.5.4 · 2026-08-18

- **One thrown-error string loses an em dash.** `canonicalPayloadBytes`' cross-language number
  guard set one between the failure and the reason; it is now a full stop, because the second half
  is a complete sentence, and its first word is capitalized to match. The canonical byte contract,
  the `VerdictKernel` semantics, and every signature this package produces or verifies are
  untouched: the string is only ever read by a human debugging a payload that already failed.
- **Why this package is in a cert-block release at all.** `@certrev/cert-block` bundles
  `canonical.ts` into its browser IIFE, so that string ships to every page the cert modal loads on,
  not just to a Node consumer of this package. It was the first of ten em dashes found in that
  bundle. Fixing cert-block alone would have left it on the wire.

## 0.5.3 · 2026-08-17

- **No executable code changed.** Every `dist/*.js` file is semantically identical to 0.5.2
  (checked by minifying both sides and comparing, not by assertion), and the canonical byte
  contract and `VerdictKernel` semantics are unchanged. Ten files under `dist/` do differ byte for
  byte, and the earlier releases' "no file under `dist/` differs" phrasing would have been wrong
  here: `tsc` emits source comments into the output, and a publish-hygiene sweep stripped private
  tracker ids from those comments. Comment-only, but not byte-neutral.
- **Fixed a false claim about our own crypto.** "Dependencies + crypto" said Ed25519 verify ran on
  Node `crypto.verify(null, …)` and that SHA-256 was on the main entry. Neither has been true since
  the edge-runtime split: the main entry imports no `node:crypto`, verifies with
  `crypto.subtle.importKey` / `crypto.subtle.verify`, and `sha256Hex` / `sha256OfCanonical` live on
  `./signer`. The section also contradicted this package's own npm description.
- **API table rebuilt with an `Entry` column.** Several rows were reachable only from `./signer`
  and only one of them said so. `toEd25519PublicKey` is removed: it has not existed since 0.2.0,
  and the export is `importEd25519PublicKey`, which returns a `Promise<CryptoKey>`, not a Node
  `KeyObject`.
- **`resolveKid` contract corrected.** The README said a resolver may return a Node `KeyObject`.
  The kernel deliberately rejects one, so a resolver written to the old text produced silently
  blank badges. Note the failure is reported as **`invalid_signature`**, not `unknown_key`:
  `isCryptoKey` correctly refuses the `KeyObject`, but `importEd25519PublicKey`'s `switch` has no
  `default: throw`, so it resolves `undefined` instead of throwing, the caller's
  `try/catch → unknown_key` never fires, and the failure surfaces one stage later. That mislabels a
  key-resolution problem as a signature problem and sends an integrator to debug the wrong thing.
  The README documents the behaviour as it actually is; the kernel one-liner that would restore the
  documented `unknown_key` is deliberately NOT in this release, because it is a behaviour change to
  a fail-closed security kernel and this release is docs-only.
- **Shape + invariant #1 brought to v0.5.** `content` now shows `articleTitle` / `displayCertId`
  (signed since 0.5.0) and marks `display` optional and deprecated from v0.2.
- **`LICENSE` added.** The package declared MIT and shipped no license text. Holder: CertREV LLC.
- **npm `description` rewritten to 241 characters.** npm caps the packument description at 255, so
  the published string was cut off mid-word at "…edge-runtime safe (We", severing the exact clause
  that is the correction to the `node:crypto` claim above.

## 0.5.2 · 2026-07-31

- **New:** `repository`, `homepage`, and `bugs` in `package.json`: the npm page now links to the
  public source mirror (`github.com/CertREV/cert-kit`, `packages/cert-contract`) and to the issue
  tracker. Until now the registry listing carried no source link at all, so a dependency reviewer
  was never told the public repo exists. Metadata only: no code, no exports, no dependency change.
- **Docs:** README `## Version` stamp bumped in lockstep, and a test now asserts it matches
  `package.json`. 0.5.1 was itself a docs-only release fixing this same stamp having gone stale,
  so the second occurrence is fixed with a guard rather than a third correction.
- Canonical byte contract and `VerdictKernel` semantics: **unchanged**, and no file under `dist/`
  differs from 0.5.1.

## 0.5.1 · 2026-07-22

- Docs-only: README Version section brought current (0.4.0 / 0.5.0 were missing) + this
  changelog added and shipped in the tarball. Code identical to 0.5.0.

## 0.5.0 · 2026-07-20

- `articleTitle` / `displayCertId` threaded onto the **signed** envelope (covered by
  the signature). First 0.5-line publish to the public npm registry.

## 0.4.0 · 2026-07

- The `articleTitle` / `displayCertId` payload extensions formalized.

## 0.3.0 · 2026-07

- The slim `CertTombstone` revocation artifact (`signTombstone` +
  `verifyArtifact` / `verifyTombstone` + `canonicalTombstoneBytes`): subject + revocation facts
  only, no certified content. Additive + fail-closed. Golden tombstone canonicalization vector.

## 0.2.0 · 2026-06

- Facts-only signed envelope (sign facts, not rendered JSON-LD).

## 0.1.x · initial releases

- `CertDeliveryEnvelope` facts model, RFC-8785 JCS canonicalizer + SHA-256, golden cross-language
  vectors, fail-closed `VerdictKernel`, WebCrypto verify path (edge-safe) + Node-only `./signer`
  subpath, native-ESM packaging.
