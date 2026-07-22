/**
 * Shopify cert-badge Web-Component revalidation — the `crypto_verify` progressive-enhancement
 * layer over the SSR Liquid badge.
 *
 * The Liquid edge renders the badge server-side (crawlable) and gates lifecycle in Liquid, but
 * it CANNOT run Ed25519 (`platform_ownership`). This module upgrades the HUMAN-visible badge to
 * a real crypto_verify check: on page load it re-fetches the Delivery artifact from the public
 * Delivery API and runs CertREV's CANONICAL verdict kernel (`verifyArtifact` from
 * `@certrev/cert-contract` — NOT a re-implementation), then:
 *
 *   • verdict `render`  → leave the SSR badge (verified live);
 *   • verdict `suppress` (invalid-sig / subject-mismatch / revoked / expired) → HIDE it
 *     (fail-closed), stamping `data-certrev-suppressed` with the verdict's reason. A revoked
 *     placement now serves the SLIM `CertTombstone` (POR-10481), which `verifyArtifact`
 *     resolves to `suppress:'revoked'` — so the badge hides AND the suppressed-reason telemetry
 *     is right (`verifyEnvelope` used to mis-report it as `unsupported_contract_version`;
 *     POR-10684);
 *   • the Delivery API 404s (no servable artifact) or the network errors → LEAVE the SSR badge.
 *     The SSR copy already passed the Liquid lifecycle gate against the app-owned metafield
 *     (the authoritative revoke/expire surface — the binding retracts it on revoke), so the WC
 *     is enhancement, never a NEW failure mode or a false-hide on an untracked placement.
 *
 * Crawlers + AI extractors read the SSR copy regardless (this never blocks first paint). The
 * verdict source is injected so the unit test drives it without a network; the production entry
 * (`certrev-cert.entry.ts`) wires the real fetch-+-`verifyArtifact` verifier + published key.
 */

import type { CertVerdict } from '@certrev/cert-contract'

/** Where + what to verify, derived from the `<certrev-badge>` host's routing attributes. */
export interface BadgeSource {
	readonly baseUrl: string
	readonly platform: string
	readonly externalId: string
}

/** Fetch-the-Delivery-API-+-verify, injected so tests drive it without a network. THROWS on a
 *  404 / network error (→ keep SSR); returns a verdict on a served envelope. */
export type VerifyBadgeFn = (source: BadgeSource) => Promise<CertVerdict>

export interface RevalidateDeps {
	readonly verify: VerifyBadgeFn
}

/**
 * Re-verify one `<certrev-badge revalidate>` host and hide its inner `.certrev-badge` on a
 * definitive `suppress` verdict. No-op (keep SSR) when the host lacks routing attributes or the
 * verify call throws (404 / offline).
 */
export async function revalidateBadge(host: Element, deps: RevalidateDeps): Promise<void> {
	const badge = host.querySelector('.certrev-badge')
	if (!badge) return

	const baseUrl = host.getAttribute('data-delivery-api')
	const externalId = host.getAttribute('data-external-id')
	const platform = host.getAttribute('data-platform') ?? 'shopify'
	if (!baseUrl || !externalId) return // no source → keep the lifecycle-gated SSR copy

	let verdict: CertVerdict
	try {
		verdict = await deps.verify({ baseUrl, platform, externalId })
	} catch {
		return // 404 / offline → keep SSR (never a new failure mode or a false-hide)
	}

	if (verdict.decision !== 'render') {
		badge.setAttribute('hidden', '')
		badge.setAttribute('data-certrev-suppressed', verdict.reason)
	}
}

/** Revalidate every `<certrev-badge revalidate>` once the DOM is ready. */
export function initBadgeRevalidation(doc: Document, deps: RevalidateDeps): void {
	const run = (): void => {
		for (const host of Array.from(doc.querySelectorAll('certrev-badge[revalidate]'))) {
			void revalidateBadge(host, deps)
		}
	}
	if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', run, { once: true })
	else run()
}
