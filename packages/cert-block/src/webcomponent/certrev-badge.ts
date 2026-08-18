/**
 * ─────────────────────────────────────────────────────────────────────────────
 * <certrev-badge> — the framework-agnostic universal-embed Web Component
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The `universal_embed` surface class: a custom element any site can drop in, fed by the
 * Delivery API, that renders the SAME badge as <CertBadge> (it shares
 * `renderBadgeHtml`). Two usage modes, both crawler-friendly:
 *
 *   1. SSR + hydrate (PREFERRED, crawlable). A server-side include emits the badge HTML
 *      (via `renderBadgeHtml`) INSIDE the element, plus the element tag. The component
 *      sees existing light-DOM children and leaves them; it only re-renders if asked to
 *      refresh. The crawler reads the server HTML; the component is progressive
 *      enhancement.
 *
 *   2. Client fetch (fallback, NOT crawlable — for already-client-only contexts). Given a
 *      `delivery-api` + `platform` + `external-id`, it fetches the envelope, runs the
 *      verdict via the kernel (WebCrypto path lives in cert-contract; here we accept a
 *      pre-supplied `resolveKid`), and renders on `render`. Documented as the weaker mode.
 *
 * The element NEVER renders an unverified credential: client-mode renders only on a
 * `render` verdict; on any suppress/error it renders nothing (fail-closed).
 *
 * Registration is side-effect-free until you call `defineCertRevBadge()` (so importing
 * the module in SSR doesn't touch `customElements`, which doesn't exist server-side).
 */

import type { CertVerdict, ResolvePublicKeyByKid } from '../contract/kernel.js'
import { getVerifiedEnvelope } from '../verify/get-verified-envelope.js'
import { renderBadgeHtml } from './render-badge-html.js'

export const CERTREV_BADGE_TAG = 'certrev-badge'

/**
 * A resolver registry the page sets once (the published CertREV keys) so the element can
 * verify in client-fetch mode without each tag carrying key config. SSR mode never needs
 * this (verification happened server-side).
 */
let globalResolveKid: ResolvePublicKeyByKid | null = null
export function setCertRevKidResolver(resolver: ResolvePublicKeyByKid): void {
	globalResolveKid = resolver
}

/**
 * `badge-style` is AUTHOR-typed markup, not signed data — a hand-written attribute on a page
 * we don't control. Only the two real faces are honored; anything else (`"Full"`, a stray
 * value, an empty attribute) reads as ABSENT, so the signed display config decides. The
 * attribute was previously CAST (`as 'full' | 'compact' | null`), which let a typo travel
 * into the renderer as if it were a face.
 */
function badgeStyleAttribute(value: string | null): 'full' | 'compact' | undefined {
	return value === 'full' || value === 'compact' ? value : undefined
}

export class CertRevBadgeElement extends HTMLElement {
	static get observedAttributes(): string[] {
		return ['delivery-api', 'platform', 'external-id', 'accent-color', 'badge-style', 'content-hash']
	}

	connectedCallback(): void {
		// SSR/light-DOM-present mode: server already rendered the badge inside us. Leave it.
		// Only client-fetch when there are no rendered children AND we have a source.
		if (this.querySelector('.certrev-badge')) return
		void this.clientFetchAndRender()
	}

	attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
		if (oldValue === newValue) return
		// Re-fetch only in client mode (no server-rendered child present).
		if (this.isConnected && !this.querySelector('.certrev-badge')) {
			void this.clientFetchAndRender()
		}
	}

	private async clientFetchAndRender(): Promise<void> {
		const baseUrl = this.getAttribute('delivery-api')
		const platform = this.getAttribute('platform')
		const externalId = this.getAttribute('external-id')
		if (!baseUrl || !platform || !externalId) return // nothing to fetch → render nothing
		if (!globalResolveKid) {
			// No keys configured → cannot verify → fail closed (render nothing).
			return
		}
		let verdict: CertVerdict
		try {
			verdict = await getVerifiedEnvelope({
				source: { kind: 'delivery_api', baseUrl, platform, externalId },
				resolveKid: globalResolveKid,
				context: {
					platform,
					externalId,
					liveContentHash: this.getAttribute('content-hash'),
				},
			})
		} catch {
			return // fail closed
		}
		if (verdict.decision !== 'render') return
		const accentColor = this.getAttribute('accent-color') ?? undefined
		const badgeStyle = badgeStyleAttribute(this.getAttribute('badge-style'))
		// The render is INSIDE the fail-closed boundary too. `connectedCallback` `void`s this
		// promise, so a throw from the renderer (a payload shape nothing runtime-validates —
		// the kernel checks the signature, never `content`) would escape as an unhandled
		// rejection instead of rendering nothing, which is the one behaviour this element
		// documents. Compute first, assign after, so a failure leaves the element untouched.
		let html: string
		try {
			html = renderBadgeHtml(verdict.payload, { accentColor, badgeStyle })
		} catch {
			return // fail closed
		}
		this.innerHTML = html
	}
}

/** Register the element. Idempotent + safe to call only in a browser/customElements env. */
export function defineCertRevBadge(): void {
	if (typeof customElements === 'undefined') return
	if (!customElements.get(CERTREV_BADGE_TAG)) {
		customElements.define(CERTREV_BADGE_TAG, CertRevBadgeElement)
	}
}
