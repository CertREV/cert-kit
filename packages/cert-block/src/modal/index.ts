/**
 * `@certrev/cert-block/modal` — the browser cert MODAL + badge-revalidation Web Component
 * (POR-10721 W2). A BYTE-FAITHFUL relocation of portal `src/lib/cert-delivery/wc/`; the IIFE
 * built from `certrev-cert.entry.ts` (`build:modal-bundle`) is structurally byte-identical to the
 * Shopify-deployed `certrev-cert.js`, so a headless brand can drop the SAME verified modal onto its
 * storefront (`<script src=".../dist/modal/certrev-cert.js">`) instead of vendoring a copy.
 *
 * Importing this module as ESM has the SAME side effect as loading the IIFE: it registers the
 * `<certrev-cert-modal>` element and (in a browser) runs placement + interactions + FTC guard +
 * badge revalidation. Bundler users: `import '@certrev/cert-block/modal'`.
 */

// Side-effect: register the element + (in a browser) kick off the DOM passes.
import "./certrev-cert.entry.js";

// The published issuer PUBLIC key — re-exported so a portal-side test can assert the package's
// bundled key matches portal's signer (`CERT_ENVELOPE_*`) after portal re-points at this package
// (the cross-repo "published key sync" guard that used to live in wc/revalidate.test.ts).
export {
	CERT_ISSUER_KID,
	CERT_ISSUER_PUBLIC_KEY_PEM,
} from "./certrev-cert.entry.js";

// Composable entry points for advanced consumers (the IIFE wires these itself).
export { CERT_MODAL_TAG } from "./certrev-cert-modal.js";
export { installFtcGuard } from "./ftc-guard.js";
export { initCertInteractionsOnReady } from "./interactions.js";
export { initCertPlacement } from "./placement.js";
export {
	initBadgeRevalidation,
	type RevalidateDeps,
	revalidateBadge,
} from "./revalidate.js";
export { createDeliveryVerifier } from "./verify-client.js";
