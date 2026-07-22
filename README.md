# CertREV cert kit

Public source for the two packages CertREV publishes to npm:

| Package | What it is |
|---|---|
| [`@certrev/cert-block`](https://www.npmjs.com/package/@certrev/cert-block) | The render edge: SSR-safe React cert components, the Builder.io registration (`certRevCertComponent`), a deterministic schema.org JSON-LD projector, a fail-closed verify layer, and the certificate-modal Web Component. |
| [`@certrev/cert-contract`](https://www.npmjs.com/package/@certrev/cert-contract) | The signed-envelope contract: `CertDeliveryEnvelope` (detached Ed25519 over RFC-8785 JCS), the fail-closed `VerdictKernel`, and golden cross-language canonicalization vectors. |

Both are MIT. Releases are published from CI via npm trusted publishing (OIDC); each
package's `CHANGELOG.md` states the semver contract (patch/minor never change rendered
output or break a compiling integration).

```sh
pnpm install
pnpm build && pnpm typecheck && pnpm test
```
