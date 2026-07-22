/**
 * @certrev/cert-block/builder — Builder.io adapter, "ambient-URL anchor" model.
 *
 * Validated by an independent architecture panel (Codex gpt-5.5 + Gemini, blind): a visual
 * page builder must NOT choose WHICH credential renders — that invites cross-article misuse and
 * re-opens the wrong-subject surface. Instead:
 *   • the CMS controls LAYOUT — an editor drags a ZERO-INPUT <CertRevAnchor/> to position the
 *     badge on the page;
 *   • the SYSTEM controls TRUTH — the headless loader resolves THIS page's credential from its
 *     own URL (Track-1 delivery), crypto-verifies it (fail-closed VerdictKernel), and supplies
 *     the verdict via context.
 * The anchor renders the current page's verified badge or NOTHING. It cannot be pointed at
 * another article, and there is no `placementId` input to forge or mis-select.
 *
 * JSON-LD is DECOUPLED (panel finding): the anchor renders the BADGE only (`omitJsonLd`). The
 * article template emits the schema.org JSON-LD server-side from the same verified verdict, so a
 * page builder can't duplicate, move, or omit structured data. (See the route example.)
 *
 * EDGE-CACHE DISCIPLINE (panel finding): the consumer's loader MUST verify per request as a
 * dynamic edge subrequest and must NOT long-cache the rendered badge HTML — a revoked/expired
 * credential sitting in a stale edge cache would defeat fail-closed. Bound any positive-verdict
 * cache by min(expiry, revocation-TTL, content-version).
 *
 * cert-block carries no Builder dependency: the registration shape is declared structurally, and
 * `isEditing` is a passed-in flag (the consumer supplies Builder's `isPreviewing()`).
 */
import { createContext, type ReactNode, useContext } from 'react'
import { CertReview } from '../components/CertReview.js'
import type { CertVerdict } from '../contract/kernel.js'

/** The current page's credential, resolved + verified by the loader (Track-1 delivery). */
export interface CurrentCredential {
	readonly verdict: CertVerdict
	/** Canonical page URL for JSON-LD @id alignment (used by the server-side JSON-LD, not the anchor). */
	readonly pageUrl?: string
}

interface CertRevContextValue {
	readonly current: CurrentCredential | null
	readonly isEditing: boolean
}

const CertRevContext = createContext<CertRevContextValue>({ current: null, isEditing: false })

/**
 * Supplies THIS page's loader-verified credential to the anchor. `current` is the verdict for
 * the current page (or null if the page has no delivered credential). `isEditing` is the
 * consumer's Builder `isPreviewing()` result — it ONLY toggles a design-time placeholder and
 * NEVER affects the published render.
 */
export function CertRevProvider({
	current,
	isEditing = false,
	children,
}: {
	readonly current: CurrentCredential | null
	readonly isEditing?: boolean
	readonly children: ReactNode
}) {
	return <CertRevContext.Provider value={{ current, isEditing }}>{children}</CertRevContext.Provider>
}

/**
 * Design-time placeholder shown ONLY in the Builder editor when the current page has no live
 * verified credential. Truthful (never a fake badge), emits NO JSON-LD, and never renders in
 * production — so it cannot leak to or be crawled on the live site.
 */
export function CertRevEditorPlaceholder() {
	return (
		<div
			data-certrev-editor-placeholder=""
			style={{
				border: '1px dashed #e6007e',
				borderRadius: 8,
				padding: '10px 14px',
				font: '13px system-ui',
				color: '#6b7280',
				background: '#fff5fa',
			}}
		>
			CertREV Review — <b>resolves at publish</b> from issuer verification. The expert badge appears here once this
			page’s article is certified, and only while the credential is valid.
		</div>
	)
}

/**
 * The Builder block. ZERO inputs — a layout anchor only. Renders the current page's VERIFIED
 * badge (badge only; JSON-LD is emitted server-side), the editor placeholder in design mode, or
 * NOTHING in production (fail-closed). The credential is whatever Track-1 delivered + verified for
 * THIS page; the editor can neither choose nor forge it.
 */
export function CertRevAnchor() {
	const { current, isEditing } = useContext(CertRevContext)
	if (current && current.verdict.decision === 'render') {
		return <CertReview verdict={current.verdict} pageUrl={current.pageUrl} omitJsonLd />
	}
	if (isEditing) return <CertRevEditorPlaceholder />
	return null
}

/**
 * Structural shape of `@builder.io/sdk-react`'s `RegisteredComponent` — the subset cert-block
 * populates. Declared locally so cert-block needs no Builder build/runtime dependency; assignable
 * to Builder's `RegisteredComponent` at the consumer's `<Content customComponents={[...]}>`.
 */
export interface CertRevBuilderRegistration {
	component: typeof CertRevAnchor
	name: string
	inputs: never[]
}

/**
 * The registration to pass to Builder's `<Content customComponents={[...]}>`. ZERO inputs by
 * design — the editor places it (layout); the system resolves the credential from the page URL
 * (truth). Matched by NAME at render, so Write-API content works without visual-editor setup.
 */
export const certRevAnchorComponent: CertRevBuilderRegistration = {
	component: CertRevAnchor,
	name: 'CertREV Review',
	inputs: [],
}

// ── POR-10721 W1/W3: the Builder.io PUSH kit (CertReviewCard) + single-sourced wire type ──
export {
	BUILDER_CERT_CHROME_KEYS,
	type BuilderCertChromeData,
	type BuilderCertChromeKey,
	type CertChromeRenderDef,
} from './cert-chrome-data.js'
export {
	BUILDER_REGISTRATION,
	type BuilderInput,
	CERT_COMPONENT_NAME,
	type CertBlockBuilderRegistration,
	certRevCertComponent,
	CertReviewCard,
	type CertReviewCardProps,
	type CertReviewCardRegisteredComponent,
	PLACEMENT_INPUTS,
	WIRE_INPUTS,
} from './cert-review-card.js'
