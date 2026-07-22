/**
 * `<certrev-cert-modal>` — the ONE Shadow-DOM element that renders both in-page cert
 * dialogs (certificate 3a + reviewer 4b) across Shopify / WordPress / Builder
 * (POR-10102). Replaces the three drifting per-platform modal implementations.
 *
 * Design:
 *  - One element, one OPEN shadow root, two `<dialog>`s (`#cert`, `#expert`). Public
 *    `open('cert'|'expert')` → `dialog.showModal()` (guarded). Data is public SSR
 *    content already, so an open shadow adds no exposure and eases debugging/tests.
 *  - CSS is adopted via a shared constructable stylesheet (falls back to an inline
 *    `<style>` on older engines). Shadow scoping means the brand theme can't bleed in
 *    and these rules can't leak out — the literal-hex/theme-armor constraints that
 *    bind the `body_html` modal do not apply here.
 *  - Envelope acquisition, in priority order: (1) a light-DOM
 *    `<script type="application/json" data-certrev-envelope>` child (Shopify + WP SSR,
 *    parsed lazily on first open — no network, crawl-safe); (2) a `data-envelope`
 *    attribute (stories/tests); (3) a Delivery-API fetch from
 *    `{data-delivery-api}/api/cert/v1/delivery/{data-platform}/{data-external-id}`
 *    (Builder/Hydrogen). The triggers (`data-certrev-modal-open`) stay in the light
 *    DOM (badge/memo) and are wired by `interactions.ts`.
 *  - Close plumbing (×, Close, backdrop, Esc) lives HERE, not in `interactions.ts`:
 *    a click inside a shadow root is retargeted to the host for a document listener,
 *    so the document-level delegate can't see the close controls.
 *  - Fonts inject at document level on first open (font faces don't scope into a
 *    shadow root); deferring to first open avoids loading them on every article view.
 */

import { type CertDeliveryArtifact, isTombstone } from '@certrev/cert-contract'
import { CERT_FONT_FACE_CSS, CERT_FONTS_ORIGIN } from './font-face.js'
import { type CertModalContent, renderCertDialogInner, renderExpertDialogInner } from './cert-modal-view.js'
import { CERT_MODAL_CSS } from './certrev-cert-modal.styles.js'

export const CERT_MODAL_TAG = 'certrev-cert-modal'
type ModalKind = 'cert' | 'expert'

/** Shared constructable stylesheet (one per document lifetime). */
let sharedSheet: CSSStyleSheet | null = null
function supportsConstructableSheets(): boolean {
	return (
		typeof CSSStyleSheet !== 'undefined' &&
		'replaceSync' in CSSStyleSheet.prototype &&
		'adoptedStyleSheets' in Document.prototype
	)
}
function getSharedSheet(): CSSStyleSheet | null {
	if (!supportsConstructableSheets()) return null
	if (!sharedSheet) {
		sharedSheet = new CSSStyleSheet()
		sharedSheet.replaceSync(CERT_MODAL_CSS)
	}
	return sharedSheet
}

/**
 * Inject the modal font families once, at document level, on first open — SELF-HOSTED from R2
 * (POR-10657). Declares the shared CERT_FONT_FACE_CSS @font-face block inline instead of loading a
 * render-blocking `fonts.googleapis.com` stylesheet (which also leaked the visitor's IP to Google).
 * @font-face at document level resolves across the shadow boundary, so the shadow-DOM modal picks
 * these up exactly as it did the old Google <link>. A crossorigin preconnect warms the R2 origin
 * (an @font-face fetch is always a CORS request). Idempotent across instances via the marker attr.
 */
let fontsInjected = false
function injectFontsOnce(doc: Document): void {
	if (fontsInjected) return
	fontsInjected = true
	if (doc.querySelector('style[data-certrev-modal-fonts]')) return
	if (!doc.querySelector('link[data-certrev-modal-preconnect]')) {
		const pre = doc.createElement('link')
		pre.rel = 'preconnect'
		pre.href = CERT_FONTS_ORIGIN
		pre.crossOrigin = ''
		pre.setAttribute('data-certrev-modal-preconnect', '')
		doc.head.appendChild(pre)
	}
	const style = doc.createElement('style')
	style.textContent = CERT_FONT_FACE_CSS
	style.setAttribute('data-certrev-modal-fonts', '')
	doc.head.appendChild(style)
}

export class CertRevCertModal extends HTMLElement {
	private root: ShadowRoot
	private rendered = false
	private content: CertModalContent | null = null
	private fetchInFlight: Promise<void> | null = null

	constructor() {
		super()
		this.root = this.attachShadow({ mode: 'open' })
		const sheet = getSharedSheet()
		if (sheet) {
			this.root.adoptedStyleSheets = [sheet]
		} else {
			const style = document.createElement('style')
			style.textContent = CERT_MODAL_CSS
			this.root.appendChild(style)
		}
		// One delegated close listener inside the shadow root.
		this.root.addEventListener('click', (e) => this.onShadowClick(e))
	}

	/**
	 * Open the given dialog. Returns `true` when this element will handle the open
	 * (so a link-shaped trigger should `preventDefault`), `false` when it cannot
	 * (no envelope + no fetch source) so the caller lets the `href` fall back.
	 */
	open(kind: ModalKind): boolean {
		// A host page that already provides the five families (e.g. the design guide, which
		// self-hosts them) suppresses the modal's font injection with `data-fonts="host"` — so
		// embedding the component adds no font-src/style-src origins to that page's CSP.
		if (this.getAttribute('data-fonts') !== 'host') injectFontsOnce(document)
		if (this.ensureRendered()) {
			this.show(kind)
			return true
		}
		if (this.hasFetchSource()) {
			void this.fetchThenShow(kind)
			return true
		}
		return false
	}

	/** Parse the synchronous envelope source (embedded JSON / attr) + render once. */
	private ensureRendered(): boolean {
		if (this.rendered) return this.content != null
		const content = this.readSyncContent()
		if (!content) return false
		this.content = content
		this.renderDialogs(content)
		this.rendered = true
		return true
	}

	private readSyncContent(): CertModalContent | null {
		const attr = this.getAttribute('data-envelope')
		if (attr) return safeParseContent(attr)
		const script = this.querySelector('script[data-certrev-envelope]')
		if (script?.textContent) return safeParseContent(script.textContent)
		return null
	}

	private hasFetchSource(): boolean {
		return !!(
			this.getAttribute('data-delivery-api') &&
			this.getAttribute('data-platform') &&
			this.getAttribute('data-external-id')
		)
	}

	private async fetchThenShow(kind: ModalKind): Promise<void> {
		if (!this.fetchInFlight) {
			const base = (this.getAttribute('data-delivery-api') || '').replace(/\/$/, '')
			const platform = this.getAttribute('data-platform') || ''
			const externalId = this.getAttribute('data-external-id') || ''
			this.fetchInFlight = (async () => {
				try {
					const res = await fetch(
						`${base}/api/cert/v1/delivery/${encodeURIComponent(platform)}/${encodeURIComponent(externalId)}`,
						{
							cache: 'no-store',
							credentials: 'omit',
						},
					)
					if (!res.ok) return
					const artifact = (await res.json()) as CertDeliveryArtifact
					// A 200 may be a REVOCATION — either the SLIM `CertTombstone` the control plane now
					// serves for a revoked placement (POR-10481, no payload) or a legacy envelope with
					// `revokedAt` set — plus an EXPIRED envelope. The Delivery API serves those signed so
					// the edge SUPPRESSES rather than fail-opening on a 404 (POR-10101). Never render
					// "verified" content from a revoked/expired artifact.
					if (isArtifactSuppressed(artifact)) {
						this.markSuppressed()
						return
					}
					// Not suppressed → a live envelope (a tombstone always suppresses above); `isTombstone`
					// narrows the union so the payload read is type-safe (POR-10684).
					const content = isTombstone(artifact)
						? undefined
						: (artifact.payload?.content as CertModalContent | undefined)
					if (content) {
						this.content = content
						this.renderDialogs(content)
						this.rendered = true
					}
				} catch {
					// fail-open: no modal, the trigger's href (if any) already prevented — a dead click at worst
				}
			})()
		}
		await this.fetchInFlight
		if (this.rendered) this.show(kind)
	}

	private renderDialogs(content: CertModalContent): void {
		const cert = renderCertDialogInner(content)
		const expert = renderExpertDialogInner(content)
		const wrap = document.createElement('div')
		wrap.innerHTML = `${cert ? `<dialog id="cert" class="crm-dialog crm-dialog--cert" aria-label="CertREV certificate">${cert}</dialog>` : ''}${expert ? `<dialog id="expert" class="crm-dialog crm-dialog--expert" aria-label="Verified reviewer profile">${expert}</dialog>` : ''}`
		// keep the adopted stylesheet / fallback <style>; append the dialogs
		for (const node of Array.from(wrap.childNodes)) this.root.appendChild(node)
	}

	private show(kind: ModalKind): void {
		const dlg = this.root.getElementById(kind) as HTMLDialogElement | null
		if (dlg && typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal()
	}

	/**
	 * The modal kill-switch (POR-10101): a fetched envelope is REVOKED/EXPIRED. Don't open;
	 * mark the host suppressed (mirrors the badge revalidation's `data-certrev-suppressed`) and
	 * hide the light-DOM triggers so a stale click can't re-open a pulled cert. Best-effort DOM.
	 */
	private markSuppressed(): void {
		this.setAttribute('data-certrev-suppressed', '')
		for (const t of Array.from(document.querySelectorAll('[data-certrev-modal-open]'))) {
			t.setAttribute('hidden', '')
			t.setAttribute('aria-hidden', 'true')
		}
	}

	private onShadowClick(e: Event): void {
		const target = e.target as HTMLElement | null
		if (!target) return
		// backdrop click (the click landed directly on the dialog element)
		if (target instanceof HTMLDialogElement && target.classList.contains('crm-dialog')) {
			target.close()
			return
		}
		const closer = target.closest('[data-certrev-modal-close]')
		if (closer) {
			e.preventDefault()
			closer.closest('dialog')?.close()
		}
	}
}

function safeParseContent(json: string): CertModalContent | null {
	try {
		const parsed = JSON.parse(json)
		return parsed && typeof parsed === 'object' ? (parsed as CertModalContent) : null
	} catch {
		return null
	}
}

/**
 * The modal-side lifecycle gate (POR-10101 / POR-10684): a fetched Delivery-API artifact that is
 * REVOKED or EXPIRED must NOT render "verified" content. Two revocation shapes suppress:
 *   • the SLIM `CertTombstone` the control plane serves for a revoked placement (POR-10481) —
 *     detected by the `kind: 'tombstone'` discriminator via `isTombstone`. It carries NO payload,
 *     so a `payload.lifecycle` read alone would MISS it (and `markSuppressed()` would never fire);
 *   • a legacy envelope with `lifecycle.revokedAt` set, or any envelope whose `expiresAt` passed.
 * The Delivery API only serves CertREV-signed artifacts, so this shape read is a safe suppress
 * signal for the display surface (the `<certrev-badge>` revalidation runs the full ed25519
 * verdict via `verifyArtifact` — this is the modal's belt-and-suspenders).
 */
export function isArtifactSuppressed(artifact: CertDeliveryArtifact | null | undefined): boolean {
	if (!artifact) return false
	if (isTombstone(artifact)) return true
	const lc = artifact.payload?.lifecycle
	if (!lc) return false
	if (lc.revokedAt != null) return true
	if (lc.expiresAt && Date.now() >= new Date(lc.expiresAt).getTime()) return true
	return false
}

/** Register the element once (idempotent — a double script-load must not throw). */
export function defineCertModal(): void {
	if (typeof customElements === 'undefined') return
	if (!customElements.get(CERT_MODAL_TAG)) customElements.define(CERT_MODAL_TAG, CertRevCertModal)
}

defineCertModal()
