# Changelog — @certrev/cert-contract

The signed-envelope contract. Semver contract: **the canonical byte contract (RFC-8785 JCS over
the payload) and the fail-closed `VerdictKernel` semantics never change in a patch or minor**;
payload extensions are additive (old edges suppress unknown shapes — fail-closed by design).

## 0.5.2 — 2026-07-31

- **New:** `repository`, `homepage`, and `bugs` in `package.json` — the npm page now links to the
  public source mirror (`github.com/CertREV/cert-kit`, `packages/cert-contract`) and to the issue
  tracker. Until now the registry listing carried no source link at all, so a dependency reviewer
  was never told the public repo exists. Metadata only: no code, no exports, no dependency change.
- **Docs:** README `## Version` stamp bumped in lockstep, and a test now asserts it matches
  `package.json` — 0.5.1 was itself a docs-only release fixing this same stamp having gone stale,
  so the second occurrence is fixed with a guard rather than a third correction.
- Canonical byte contract and `VerdictKernel` semantics: **unchanged** — no file under `dist/`
  differs from 0.5.1.

## 0.5.1 — 2026-07-22

- Docs-only: README Version section brought current (0.4.0 / 0.5.0 were missing) + this
  changelog added and shipped in the tarball. Code identical to 0.5.0.

## 0.5.0 — 2026-07-20

- POR-10481: `articleTitle` / `displayCertId` threaded onto the **signed** envelope (covered by
  the signature). First 0.5-line publish to the public npm registry.

## 0.4.0 — 2026-07

- POR-10481 Part 3: the `articleTitle` / `displayCertId` payload extensions formalized.

## 0.3.0 — 2026-07

- POR-10481: the slim `CertTombstone` revocation artifact (`signTombstone` +
  `verifyArtifact` / `verifyTombstone` + `canonicalTombstoneBytes`) — subject + revocation facts
  only, no certified content. Additive + fail-closed. Golden tombstone canonicalization vector.

## 0.2.0 — 2026-06

- Facts-only signed envelope (sign facts, not rendered JSON-LD).

## 0.1.x — initial releases

- `CertDeliveryEnvelope` facts model, RFC-8785 JCS canonicalizer + SHA-256, golden cross-language
  vectors, fail-closed `VerdictKernel`, WebCrypto verify path (edge-safe) + Node-only `./signer`
  subpath, native-ESM packaging.
