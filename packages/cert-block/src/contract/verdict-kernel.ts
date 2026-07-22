/**
 * VerdictKernel — cert-block's edge-local view of the kernel function set.
 *
 * The published `@certrev/cert-contract` exposes the kernel as FREE FUNCTIONS
 * (`verifyEnvelope`, `renderVerdict`, `verifySignatureOnly`), NOT as a bundled interface,
 * because different edges bundle them with different key-resolver shapes: cert-block
 * resolves keys as `Ed25519PublicKeyInput`, while the portal Delivery API's kernel
 * resolves raw `Uint8Array`. There is therefore no single canonical `VerdictKernel`
 * interface to live in the contract — each edge declares the bundled shape it depends on.
 * This is cert-block's.
 */

import type {
	CertDeliveryEnvelope,
	CertPayload,
	CertSuppressReason,
	CertVerdict,
	RenderContext,
	ResolvePublicKeyByKid,
} from '@certrev/cert-contract'

/** Full kernel: verify signature, then apply subject/lifecycle/drift policy. */
export type VerifyEnvelope = (
	envelope: CertDeliveryEnvelope,
	resolveKid: ResolvePublicKeyByKid,
	ctx: RenderContext,
) => Promise<CertVerdict>

/** Phase-2-only policy over an already-verified payload. */
export type RenderVerdict = (payload: CertPayload, ctx: RenderContext) => CertVerdict

/** Phase-1-only cryptographic verification. */
export type VerifySignatureOnly = (
	envelope: CertDeliveryEnvelope,
	resolveKid: ResolvePublicKeyByKid,
) => Promise<{ ok: true } | { ok: false; reason: CertSuppressReason }>

/**
 * The kernel function trio as a single named interface — the value-level surface for
 * callers that want them as one object. `@certrev/cert-contract` exposes these as free
 * functions; this is a convenience binding, deliberately kept out of the wire contract.
 */
export interface VerdictKernel {
	readonly verifyEnvelope: VerifyEnvelope
	readonly renderVerdict: RenderVerdict
	readonly verifySignatureOnly: VerifySignatureOnly
}
