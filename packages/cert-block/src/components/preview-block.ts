/**
 * `renderPreviewBlock` — a STATIC, NON-DELIVERY preview of the cert block for pre-sales
 * look-demos (POR-10743, from the Builder demo).
 *
 * The visual is BYTE-FOR-BYTE `renderCertBlock` (pixel-parity — "see it on your own site
 * today"), wrapped in a `[data-certrev-preview]` container carrying a REQUIRED expiry.
 *
 * Why it is safe by construction — and can NEVER be delivery:
 *  - A preview has NO signed envelope and NO modal. CertREV's verify / badge-revalidation /
 *    crawl-audit all key off a signed `CertDeliveryEnvelope`; an unsigned block is SUPPRESSED
 *    on any live verify, never rendered as a certification. So a preview literally cannot pass
 *    as a delivered cert — the "never delivery" property is structural, not a policy.
 *  - The container marker (`data-certrev-preview="1"`) + the default-on visible label make it
 *    unmistakable to humans AND tooling; the required `data-certrev-preview-expires` bounds its
 *    life so a stale snapshot can be refused downstream.
 *  - It is NOT revocable — the kill-switch cannot reach a static HTML snapshot — so it must stay
 *    demo / draft-only. That is the CALLER's duty; this renderer bakes the markers that let the
 *    surrounding systems enforce it.
 */

import { escapeAttribute, escapeHtml } from './escape.js'
import { type RenderCertBlockInput, renderCertBlock } from './render-cert-block.js'

export interface PreviewBlockOptions {
	/**
	 * REQUIRED — when this preview expires (ISO 8601). A preview MUST be time-bounded so a stale
	 * snapshot can be refused downstream; there is deliberately NO default (an unbounded preview
	 * is the drift-into-shadow-delivery risk this option exists to prevent).
	 */
	readonly expiresAt: string
	/**
	 * Show the visible caption. Default `true` — the SAFE default. Opt out (`false`) ONLY for a
	 * true pixel-parity look-demo; the machine marker + expiry + non-delivery guarantee remain.
	 */
	readonly showLabel?: boolean
	/** Override the caption text (default below). */
	readonly labelText?: string
}

const DEFAULT_LABEL = 'Preview — not a verified certification'

/** Extract a preview block's baked expiry (ISO), or null if the HTML isn't a preview block. */
export function previewExpiry(html: string): string | null {
	const m = html.match(/data-certrev-preview-expires="([^"]*)"/)
	return m ? m[1] : null
}

/**
 * Render a static, clearly-labeled, time-bounded preview of the cert block. See the module doc
 * for the safety model. `expiresAt` is required; throws without it.
 */
export function renderPreviewBlock(input: RenderCertBlockInput, options: PreviewBlockOptions): string {
	const expires = options.expiresAt.trim()
	if (!expires) {
		throw new Error('renderPreviewBlock: `expiresAt` is required — a preview must be time-bounded.')
	}
	// The bound must be REAL — an unparseable expiry is a toothless bound (downstream can't refuse a
	// stale preview it can't date). Reject anything Date can't parse, so `previewExpiry()` consumers
	// always get a usable timestamp.
	if (Number.isNaN(new Date(expires).getTime())) {
		throw new Error(`renderPreviewBlock: \`expiresAt\` must be a parseable date (got "${expires}").`)
	}
	const showLabel = options.showLabel !== false
	const label = showLabel
		? `<div data-certrev-preview-label style="font:500 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:#9a9a9a;margin-bottom:8px;">${escapeHtml(options.labelText ?? DEFAULT_LABEL)}</div>`
		: ''
	return (
		`<!-- CertREV PREVIEW — static, non-revocable, NOT a verified certification. Expires ${escapeHtml(expires)}. Never use as delivery. -->` +
		`<div data-certrev-preview="1" data-certrev-preview-expires="${escapeAttribute(expires)}">` +
		label +
		renderCertBlock(input) +
		`</div>`
	)
}
