# @certrev/cert-contract

The signed, platform-agnostic **CertDeliveryEnvelope** — CertREV's portable "this content was reviewed by a credentialed expert" credential. Sign once, deliver everywhere; every render edge (WordPress plugin, Shopify theme app extension, headless-React SDK, Web Component) verifies it and renders the badge + JSON-LD from the verified facts.

## What this is

CertREV's durable asset isn't the WordPress block or the Shopify block — it's a forgery-proof credential. The issuer mints + **signs** one `CertDeliveryEnvelope` per certified placement. Each delivery edge reproduces the canonical bytes, verifies the detached Ed25519 signature, runs the fail-closed **VerdictKernel** (subject / lifecycle / drift), and only then renders.

This package is the **shared seam** both render layers (and the issuer) build against, so they can't silently diverge.

## The two design invariants

### 1. Sign FACTS, not rendered JSON-LD

`payload.content` holds **structured facts** — expert (`displayName`, `credentials[]`, `profileUrl`, `photoUrl`), author, memo, `certifiedAt`, `contentModifiedAt`, `verifyUrl`, `display`. The schema.org JSON-LD is **projected from these facts at the edge** — it is NOT in the signed payload. A schema.org change (new property, vocabulary tweak) therefore never forces re-signing every live credential; only the edge's projection changes.

### 2. Detached Ed25519 over RFC-8785 (JCS) canonicalization of `payload`

```
signature.sig = base64url( Ed25519_sign( privKey, RFC8785_canonicalize(payload) ) )
```

Any language that implements RFC 8785 (JSON Canonicalization Scheme) reproduces **byte-identical** signing input, so a PHP libsodium verifier and a Node WebCrypto verifier check the same signature over the same bytes. The signature is **detached** — it does NOT cover `signature` itself. The cross-language byte contract is pinned by [`src/__tests__/vectors.json`](src/__tests__/vectors.json).

## Shape

```ts
CertDeliveryEnvelope = {
  payload: {
    contractVersion: 1,
    certId: string,
    subject: {                       // richer identity — binds the credential to a STABLE identity
      platform: string,             //   'shopify' | 'wordpress' | 'headless' | …
      externalId: string,           //   stable per-placement id (Shopify Article GID, WP post id)
      logicalArticleId: string,     //   CertREV's platform-independent article identity
      canonicalUrls: string[],      //   every URL this credential may render on (primary + locale/slug variants)
      installationId: string | null,//   which app install placed it
      contentDigest: string | null, //   hex SHA-256 of the reviewed body — the anti-drift hash (null = unbound)
    },
    content: { expert, author, memo, certifiedAt, contentModifiedAt, verifyUrl, display },  // FACTS, no JSON-LD
    lifecycle: { issuedAt, expiresAt, revokedAt: string | null, revision: number },
  },
  signature: {
    alg: 'ed25519',
    kid: string,                    // selects the issuer public key (rotation); live root = GCP KMS cryptoKeyVersion name
    sig: string,                    // base64url detached Ed25519 over canonicalize(payload)
    signedAt: string,
  },
}
```

JSON Schema (draft 2020-12, versioned `$id`): [`schema/cert-delivery-envelope.v1.schema.json`](schema/cert-delivery-envelope.v1.schema.json).

## The VerdictKernel — the one algorithm every edge runs (fail-closed)

```
1. parse + shape-check the envelope; unknown contractVersion → suppress
2. signature.alg === 'ed25519'                                → else suppress
3. resolve signature.kid → public key                         → else suppress (unknown_key)
4. Ed25519-verify(sig) over canonicalize(payload)             → else suppress (invalid_signature)
5. subject.platform === this edge's platform                  → else suppress (platform_mismatch)
6. subject.externalId === the article being rendered          → else suppress (subject_mismatch)
7. lifecycle.revokedAt === null AND now < expiresAt           → else suppress (revoked | expired)
8. live content hash, if supplied AND subject.contentDigest set, must match → else suppress (content_drift)
otherwise → render (carrying the verified payload)
```

Steps 1–4 are cryptographic; 5–8 are policy. `verifyEnvelope()` runs the whole pipeline. A malformed envelope or a throwing resolver **fails closed to `suppress`** — it never throws into the caller (which might swallow it into a render).

```ts
import { verifyEnvelope, type CertDeliveryEnvelope } from '@certrev/cert-contract'

const verdict = await verifyEnvelope(envelope, resolveKid, {
  platform: 'shopify',
  externalId: 'gid://shopify/Article/8675309',
  liveContentHash, // optional; omit when the edge can't read live content (drift check is then skipped)
  now: new Date(),
})

if (verdict.decision === 'render') {
  // verdict.payload is cryptographically verified — project JSON-LD + render the badge from it
} else {
  // verdict.reason ∈ unsupported_contract_version | unsupported_alg | unknown_key |
  //                  invalid_signature | platform_mismatch | subject_mismatch |
  //                  revoked | expired | content_drift  → render NOTHING
}
```

`resolveKid(kid)` returns the issuer public key for a `kid` (or `null` → `unknown_key`). It can return a Node `KeyObject` or an `Ed25519PublicKeyInput` (`pem` | `spki-base64` | `spki-der` | `raw` 32-byte). It may be async so an edge can fetch + cache a published key set.

## Signing

The **live signing root** is GCP KMS (`EC_SIGN_ED25519`, PureEdDSA — no digest flag), so private key material never leaves KMS. KMS returns a raw 64-byte Ed25519 signature over the canonical bytes; the issuer base64url-encodes it into `signature.sig` and sets `kid` to the KMS cryptoKeyVersion resource name. For tests and any signer holding a local key, `signPayloadEd25519(payload, privateKey)` produces the identical signature over the same bytes.

## Revocation tombstone (v0.3)

A revoked placement should serve proof of revocation, **not** the certified facts — a blanked badge has no business carrying the expert's identity (an avoidable privacy + payload-size leak). So instead of re-minting a full envelope with `lifecycle.revokedAt` set, the issuer mints a slim **`CertTombstone`**: `{ kind: 'tombstone', contractVersion, subject, revokedAt, revocationReason, signature }`. It reuses the envelope's `CertSubject` (so the edge's platform + externalId match is unchanged) and is signed by the **same trust root** — the detached Ed25519 signature covers `canonicalTombstoneBytes` (the signable fields, RFC-8785 JCS). The kernel's `verifyArtifact` dispatches on the `kind` discriminator: a valid, subject-matched tombstone → `suppress: 'revoked'`; an envelope → the full pipeline.

**Rollout is fail-safe.** An old (pre-0.3) edge that receives a tombstone fails its envelope shape-check (`!payload`) and suppresses — a blank badge, the correct outcome for a revoked cert. So a tombstone is safe to serve to an un-upgraded edge; new edges call `verifyArtifact` for the precise `'revoked'` verdict. Mint one with `signTombstone(...)` on the `./signer` subpath.

## API

| Export | Purpose |
|---|---|
| `canonicalizeJson` / `canonicalBytes` / `canonicalPayloadBytes` | RFC-8785 canonicalization (string / UTF-8 bytes / payload-bytes). The signing + hashing input. |
| `canonicalTombstoneBytes` | RFC-8785 canonicalization of a tombstone's signable fields (the tombstone signing input, v0.3). |
| `sha256Hex` / `sha256OfCanonical` | SHA-256 helpers (used for `subject.contentDigest` + the golden vectors). |
| `verifyEnvelope` | The full VerdictKernel — verify + policy, fail-closed. |
| `verifyArtifact` | Unified kernel entry (v0.3) — dispatches an envelope OR a `CertTombstone`. New edges call this. |
| `verifyTombstone` / `isTombstone` | Tombstone verdict (verify + subject-match → `suppress:'revoked'`) / the `kind` discriminator. |
| `signTombstone` | Mint a slim revocation tombstone (`./signer` subpath). |
| `verifySignatureOnly` | Phase-1-only (parse + kid + Ed25519). For app-proxy edges that split crypto from policy. |
| `renderVerdict` | Phase-2-only policy over an already-verified payload (pure, sync). |
| `verifyDetachedSignature` | Low-level: does this base64url sig verify over `canonicalize(payload)`? |
| `signPayloadEd25519` | Sign with a local Ed25519 key (tests / non-KMS signers). |
| `toEd25519PublicKey` | Build a Node `KeyObject` from pem / spki-base64 / spki-der / raw. |
| `base64urlEncode` / `base64urlDecode` | base64url (unpadded) codec for the signature. |
| Types | `CertDeliveryEnvelope`, `CertDeliveryArtifact`, `CertTombstone`, `CertTombstoneSignable`, `CertPayload`, `CertSubject`, `CertContent`, `CertDisplayConfig`, `CertLifecycle`, `CertSignature`, `CertVerdict`, `CertSuppressReason`, `RenderContext`, `ResolvePublicKeyByKid`, `Ed25519PublicKeyInput` |
| Constants | `CONTRACT_VERSION` (1), `CANONICALIZATION` (`'RFC8785-JCS'`), `SIGNATURE_ALG` (`'ed25519'`) |

## Cross-language contract — golden vectors

[`src/__tests__/vectors.json`](src/__tests__/vectors.json) maps representative + adversarial input values (unicode, key-order, nested objects, arrays, integers/floats, exponent forms, empty/null, control-char escapes, and a full CertPayload shape) → their RFC-8785 canonical UTF-8 bytes (hex) → SHA-256. A foreign (PHP / Go / …) RFC-8785 implementation MUST reproduce `canonicalHex` + `sha256` for every input. The vectors are **generated** from the same `canonicalize()` the runtime uses (`src/__tests__/generate-vectors.mjs`) and **re-asserted** by the test suite, so a vector can never silently drift from the implementation, and an independent SHA-256 of the recorded bytes is checked too.

## Dependencies + crypto

- **Canonicalization:** [`canonicalize`](https://www.npmjs.com/package/canonicalize) (RFC 8785) — vetted, not hand-rolled.
- **Ed25519:** Node `crypto` (`crypto.verify(null, …)` / `crypto.sign(null, …)`) — PureEdDSA, GCP-KMS-compatible, no extra dependency. PHP edges use libsodium `sodium_crypto_sign_verify_detached`.
- **SHA-256:** Node `crypto`.

Server-safe (no DOM lib). A browser edge (Web Component) can supply WebCrypto Ed25519 + a JCS lib and run the same kernel logic.

## Tests

```bash
pnpm test       # 89 deterministic + 2 live-KMS = 91
pnpm build
pnpm typecheck
```

- **Golden vectors:** every recorded canonical-bytes + SHA-256 re-derived and asserted, plus an independent hash of the recorded bytes.
- **Round-trip:** sign with a generated Ed25519 keypair → `verifyEnvelope` renders the verified payload.
- **Tamper:** a changed payload field (and a re-pointed nested `subject.externalId`, a wrong-key signature, a garbage signature) → `invalid_signature`, fail-closed.
- **Verdict pipeline:** unknown kid, wrong alg, unknown contract version, platform/subject mismatch, revoked, expired, content drift, drift-check-skipped paths, throwing resolver → fail-closed.
- **Live GCP KMS real-sign proof** (`real-sign-kms.test.ts`): signs `canonicalize(payload)` with the production KMS Ed25519 key, the kernel renders it against the real SPKI public key, and a tampered payload with the same KMS signature fails closed. Conditional — runs only when `gcloud` can reach the KMS key version; config-gated skip otherwise.

## Live signing root

| | |
|---|---|
| GCP project | `portal-486217` |
| KMS keyring | `certrev-signing` (location `global`) |
| Key / version | `cert-envelope-issuer` v1, `EC_SIGN_ED25519` |
| `kid` | `projects/portal-486217/locations/global/keyRings/certrev-signing/cryptoKeys/cert-envelope-issuer/cryptoKeyVersions/1` |
| Public key (SPKI base64) | `MCowBQYDK2VwAyEAMWN956IOPjpAq900dL428VzA28TO/pVXnq3brwqUmwM=` |

```bash
gcloud kms asymmetric-sign --version 1 --key cert-envelope-issuer \
  --keyring certrev-signing --location global --project portal-486217 \
  --input-file <CANONICAL_BYTES> --signature-file <SIG>   # PureEdDSA — no --digest; output = raw 64-byte sig
```

## Current consumers

| Repo | Status |
|---|---|
| Portal | Planned — issuer (mint + KMS-sign) + the WordPress/Shopify/headless delivery adapters build against this seam. |
| AgOS | Planned — any AgOS-side verification of a delivered credential runs the same `verifyEnvelope`. |
| WordPress plugin (PHP) | Planned — ports the VerdictKernel to libsodium; the golden vectors are its JCS conformance target. |

## Version

Current: `0.5.1` — see [CHANGELOG.md](./CHANGELOG.md).

- `0.5.1` — docs-only (this README + changelog brought current). Code identical to 0.5.0.
- `0.5.0` — POR-10481: `articleTitle` / `displayCertId` threaded onto the **signed** envelope
  (covered by the signature). First 0.5-line publish to the public npm registry.
- `0.4.0` — POR-10481 Part 3: the `articleTitle` / `displayCertId` payload extensions formalized.
- `0.3.0` — POR-10481: the slim **`CertTombstone`** revocation artifact (`signTombstone` + `verifyArtifact`/`verifyTombstone` + `canonicalTombstoneBytes`), carrying only the subject + revocation facts (no certified content). Additive + fail-closed: old edges suppress an unknown tombstone shape (a blank badge — the correct revoked outcome). Golden tombstone canonicalization vector added.
- `0.1.0` — initial release. `CertDeliveryEnvelope` facts model (sign facts, not JSON-LD), richer `subject` identity binding, RFC-8785 JCS canonicalizer + SHA-256, golden cross-language vectors, fail-closed VerdictKernel, live GCP KMS real-sign proof.
