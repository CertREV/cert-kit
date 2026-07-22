/**
 * Browser bundle ENTRY for the Shopify cert-badge Web Component (built by
 * scripts/build-shopify-cert-asset.mjs → shopify/extensions/certrev-schema/assets/certrev-cert.js,
 * loaded by the `certrev-cert` app block via its schema `javascript` key).
 *
 * Glue only: it resolves the published issuer key + the Delivery-API verifier (which runs the
 * canonical `verifyEnvelope` kernel) and kicks off the DOM revalidation pass. No crypto here.
 */

import type { ResolvePublicKeyByKid } from '@certrev/cert-contract'
import './certrev-cert-modal.js' // registers the unified <certrev-cert-modal> element (POR-10102)
import { installFtcGuard } from './ftc-guard.js'
import { initCertInteractionsOnReady } from './interactions.js'
import { initCertPlacement } from './placement.js'
import { initBadgeRevalidation } from './revalidate.js'
import { createDeliveryVerifier } from './verify-client.js'

/**
 * The published CertREV issuer signing key (SPKI PEM) for kid `cert-issuer-1` — the PUBLIC
 * verification key, safe to ship to every storefront browser. Kept BYTE-IDENTICAL to
 * `CERT_ENVELOPE_SIGNING_PUBLIC_KEY_PEM` in src/lib/cert-delivery/signer.ts; revalidate.test.ts
 * asserts the equality so a key rotation can't silently desync this copy. (signer.ts is
 * node-only, so it cannot be imported into a browser bundle — hence the asserted copy.)
 */
export const CERT_ISSUER_KID = 'cert-issuer-1'
export const CERT_ISSUER_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAMWN956IOPjpAq900dL428VzA28TO/pVXnq3brwqUmwM=
-----END PUBLIC KEY-----`

const resolveKid: ResolvePublicKeyByKid = (kid) =>
	kid === CERT_ISSUER_KID ? { format: 'pem', pem: CERT_ISSUER_PUBLIC_KEY_PEM } : null

if (typeof document !== 'undefined') {
	// Placement runs FIRST — relocate the @graph to <head> + move the card wrapper to its final
	// in-article position — so the badge re-verify pass below finds `<certrev-badge>` already in
	// place and never re-runs against a detached/re-attached node.
	initCertPlacement(document)
	// Tap-to-expand contributor bios + the in-page certificate modal (progressive enhancement).
	initCertInteractionsOnReady(document)
	// FTC §3 anti-stripping: neutralize a memo whose verbatim disclosure was stripped/hidden/altered
	// (restores the iframe kill switch in the native, in-DOM render). No-op when there's no memo.
	installFtcGuard(document)
	initBadgeRevalidation(document, { verify: createDeliveryVerifier(resolveKid) })
}
