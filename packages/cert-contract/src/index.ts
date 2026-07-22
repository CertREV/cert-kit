// @certrev/cert-contract — MAIN entry (EDGE-RUNTIME SAFE).
//
// This entry imports ZERO `node:crypto` and uses NO `Buffer`, so it loads + runs on
// edge/Workers runtimes (Shopify Oxygen, Cloudflare Workers, Vercel Edge) as well as Node.
// It carries the VERIFY path (the VerdictKernel, WebCrypto Ed25519), the RFC-8785
// canonicalization (the cross-language byte contract), runtime-agnostic base64, and the
// envelope types.
//
// The ISSUER/SIGN path (`mintEnvelope`, `buildPayload`, `localEd25519Signer`,
// `signPayloadEd25519`, `computeContentDigest`, `sha256Hex`/`sha256OfCanonical`) is
// `node:crypto`-backed and lives on the `@certrev/cert-contract/signer` subpath. The
// portal (Node issuer) imports from there; nothing on this entry pulls a Node builtin.

// Runtime-agnostic base64 / base64url (no Buffer)
export { base64ToBytes, base64urlDecode, base64urlEncode, bytesToBase64 } from './base64.js'
// Canonicalization (the cross-language byte contract) — pure, edge-safe
export { canonicalBytes, canonicalizeJson, canonicalPayloadBytes, canonicalTombstoneBytes } from './canonical.js'
// VerdictKernel + WebCrypto verification primitives (verify only)
export {
	type Ed25519PublicKeyInput,
	importEd25519PublicKey,
	isTombstone,
	type RenderContext,
	type ResolvePublicKeyByKid,
	renderVerdict,
	verifyArtifact,
	verifyDetachedSignature,
	verifyEnvelope,
	verifySignatureOnly,
	verifyTombstone,
} from './kernel.js'
export {
	CANONICALIZATION,
	type CertContent,
	type CertCredential,
	type CertDeliveryArtifact,
	type CertDeliveryEnvelope,
	type CertDisplayConfig,
	type CertLifecycle,
	type CertPayload,
	type CertSignature,
	type CertSubject,
	type CertSuppressReason,
	type CertTombstone,
	type CertTombstoneSignable,
	type CertVerdict,
	CONTRACT_VERSION,
	type ComplianceClass,
	type ContractVersion,
	SIGNATURE_ALG,
	type SignatureAlg,
} from './types.js'
