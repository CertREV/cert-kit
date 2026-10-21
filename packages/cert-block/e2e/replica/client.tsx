/**
 * The replica's browser entry: hydrate the whole document, as a Hydrogen (React Router) app does.
 *
 * The one thing that differs from a brand's storefront is the trust root. The replica's envelopes are signed by a
 * fixture issuer (CertREV's signing key never leaves CertREV), so the package's internal test seam bakes the fixture
 * issuer's public key in place of `cert-issuer-1`. Everything else is the package's production path: the browser's
 * own reads, the published key-set read for a kid that is not baked, verification, the card digest, printing,
 * root attachment and the runtime injection.
 */

import { hydrateRoot } from 'react-dom/client'
import { setCardDeliveryRuntimeForTests } from '../../src/builder/delivery-runtime.js'
import { App, type ReplicaArticle } from './app.js'

declare const __REPLICA__: {
	readonly kid: string
	readonly spki: string
	readonly articles: readonly ReplicaArticle[]
}

setCardDeliveryRuntimeForTests({
	resolveKid: (kid) => (kid === __REPLICA__.kid ? { format: 'spki-base64', base64: __REPLICA__.spki } : null),
	fetchImpl: () => globalThis.fetch.bind(globalThis),
	now: Date.now,
})

hydrateRoot(document, <App articles={__REPLICA__.articles} path={window.location.pathname} />, {
	onRecoverableError(error) {
		;(window as unknown as { __replicaRecoverable: string[] }).__replicaRecoverable.push(String(error))
	},
})
