/**
 * Browser bundle ENTRY for the cert-badge Web Component. `pnpm build:modal-bundle`
 * bundles this file into the IIFE at `dist/modal/certrev-cert.js` — the asset a
 * storefront loads with a plain `<script>` tag, and the same asset the Shopify
 * `certrev-cert` app block loads via its schema `javascript` key.
 *
 * Glue only: it resolves the published issuer key + the Delivery-API verifier (which runs the
 * canonical `verifyEnvelope` kernel) and kicks off the DOM revalidation pass. No crypto here.
 */

import type { ResolvePublicKeyByKid } from '@certrev/cert-contract'
import './certrev-cert-modal.js' // registers the unified <certrev-cert-modal> element
import { initCertInteractionsOnReady } from './interactions.js'
import { initCertPlacement } from './placement.js'
import { initBadgeRevalidation } from './revalidate.js'
import { createDeliveryVerifier } from './verify-client.js'

/**
 * The published CertREV issuer signing key (SPKI PEM) for kid `cert-issuer-1` — the PUBLIC
 * verification key, safe to ship to every storefront browser. Kept BYTE-IDENTICAL to
 * `CERT_ENVELOPE_SIGNING_PUBLIC_KEY_PEM` in the portal's cert-delivery signer. The equality is
 * asserted PORTAL-side against this package's exported `CERT_ISSUER_*`, so a key rotation can't
 * silently desync this copy; it cannot be asserted here, because the signer is node-only and
 * cannot be imported into a browser bundle — hence the copy.
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
	// No disclosure guard since 1.1.1: nothing here hides, replaces or re-checks a face at load or on
	// mutation, so a face that loads inside a closed <details>, tab or accordion renders when opened.
	// Tap-to-expand contributor bios + the in-page certificate modal (progressive enhancement).
	initCertInteractionsOnReady(document)
	initBadgeRevalidation(document, { verify: createDeliveryVerifier(resolveKid) })
}
