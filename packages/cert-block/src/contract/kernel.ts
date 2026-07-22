/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Contract binding point — the SDK's single import of @certrev/cert-contract
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every other SDK module imports the contract TYPES and the KERNEL functions from HERE,
 * never directly from `@certrev/cert-contract`, so the whole SDK's dependency on the
 * contract is funnelled through one module. The published package owns the envelope types
 * (`CertDeliveryEnvelope`, `CertPayload`, `CertCredential`, …), the RFC-8785
 * canonicalization (`canonicalPayloadBytes`), and the fail-closed WebCrypto kernel
 * (`verifyEnvelope`, `renderVerdict`, `verifySignatureOnly`, `importEd25519PublicKey`).
 *
 * `VerdictKernel` is the ONE name NOT re-exported from the package: the contract exposes
 * the kernel as free functions, and different edges bundle them with different key-resolver
 * shapes (cert-block uses `Ed25519PublicKeyInput`; the portal Delivery API uses raw
 * `Uint8Array`), so the bundled interface stays edge-local — see ./verdict-kernel.
 */

export * from '@certrev/cert-contract'
export type { VerdictKernel } from './verdict-kernel.js'
