/**
 * The browser-side Delivery-API fetch + verify the Shopify Web Component uses. Thin glue around
 * the CANONICAL kernel: it GETs the public, CDN-cacheable Delivery API
 * (`{baseUrl}/api/cert/v1/delivery/{platform}/{externalId}`) and runs `verifyArtifact` from
 * `@certrev/cert-contract` (WebCrypto Ed25519 over RFC-8785 JCS — the same kernel the server +
 * every other edge run). No crypto is reimplemented here.
 *
 * `verifyArtifact` (POR-10684, cert-contract 0.3.0) dispatches on the `kind: 'tombstone'`
 * discriminator: a full `CertDeliveryEnvelope` runs the whole crypto + lifecycle pipeline, while
 * the SLIM `CertTombstone` the control plane now serves for a revoked placement (POR-10481) —
 * which carries NO payload — verifies its own signature + subject and resolves to
 * `suppress:'revoked'`. The old `verifyEnvelope` fails a tombstone's shape-check and returns
 * `suppress:'unsupported_contract_version'` (still a blank badge, but the wrong suppressed-reason
 * telemetry), so the suppression path routes through `verifyArtifact`.
 *
 * Drift is core-compensated (the browser can't recompute the canonical body hash), so
 * `liveContentHash` is null → the kernel verifies signature + subject + lifecycle and skips
 * drift. A non-2xx response (the API 404s on an untracked placement) THROWS, so the caller keeps
 * the lifecycle-gated SSR badge rather than false-hiding it.
 */

import { type CertDeliveryArtifact, type ResolvePublicKeyByKid, verifyArtifact } from '@certrev/cert-contract'
import type { BadgeSource, VerifyBadgeFn } from './revalidate.js'

export function createDeliveryVerifier(
	resolveKid: ResolvePublicKeyByKid,
	fetchImpl: typeof fetch = fetch,
): VerifyBadgeFn {
	return async (source: BadgeSource) => {
		const base = source.baseUrl.replace(/\/+$/, '')
		const url = `${base}/api/cert/v1/delivery/${encodeURIComponent(source.platform)}/${encodeURIComponent(source.externalId)}`
		const res = await fetchImpl(url, { headers: { accept: 'application/json' } })
		if (!res.ok) throw new Error(`cert delivery ${res.status}`)
		const artifact = (await res.json()) as CertDeliveryArtifact
		return verifyArtifact(artifact, resolveKid, {
			platform: source.platform,
			externalId: source.externalId,
			liveContentHash: null,
			now: new Date(),
		})
	}
}
