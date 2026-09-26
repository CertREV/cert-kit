/**
 * @certrev/cert-block/builder — Builder.io adapter, "ambient-URL anchor" model.
 *
 * A visual page builder must NOT choose WHICH credential renders — that invites cross-article
 * misuse and re-opens the wrong-subject surface. The ANCHOR path splits the two concerns:
 *   • the CMS controls LAYOUT — an editor drags a ZERO-INPUT <CertRevAnchor/> to position the
 *     badge on the page;
 *   • the SYSTEM controls TRUTH — the headless loader resolves THIS page's credential from its
 *     own URL, crypto-verifies it (fail-closed VerdictKernel), and supplies the verdict via
 *     context.
 * The anchor renders the current page's verified badge or NOTHING. It cannot be pointed at
 * another article, and there is no `placementId` input to forge or mis-select.
 *
 * THE PUSH KIT DOES NOT INHERIT THAT PROPERTY, and this module exports it too. `CertReviewCard` /
 * `certRevCertComponent` register the 20 wire-type fields — `reviewerName`,
 * `credentialVerification`, `verifyUrl`, `memo` — as Builder INPUTS, and the card renders what
 * those inputs hold; it runs no signature check and consults no verdict. `advanced: true` folds
 * them out of the editor's default view, which is a UI reveal and not a lock, and `safeHttpUrl`
 * bounds `verifyUrl` to the http(s) SCHEME rather than to a CertREV origin. So to the card a
 * hand-typed option and an exporter-written one are the same string: the trust boundary on the
 * PUSH path is WRITE ACCESS TO THE CMS SPACE, not a signature, and nothing in this package
 * narrows it. See "PUSH trust model" in the package README for the full statement — including
 * what a revocation upstream does and does not reach.
 *
 * 1.1.0 NARROWS THAT FOR A BLOCK CARRYING THE `delivery` MARKER (`{ v: 1, baseUrl }`, which the
 * CertREV exporter writes). Such a block ignores every other option: it reads the signed envelope
 * for the entry it renders inside (`builderContext.content.id`) from the CertREV Delivery API on
 * `baseUrl` (an https certrev.com origin, nothing else), verifies it against the baked
 * `cert-issuer-1` key, re-judges revocation and expiry at every render, and paints the brand's
 * render def served beside it. A revoked, expired, unverifiable or unreachable cert, a marker that
 * is not exactly that shape, or a missing entry id renders nothing. A block WITHOUT the marker
 * (every entry exported before 1.1.0) renders from its options exactly as 1.0.3 did, so the
 * paragraph above still describes it: an editor who deletes the marker gets the options face back,
 * which is the 1.0.3 trust boundary, not a new one.
 *
 * Three things the card DOES enforce, and they are the limit of it: no chrome at all without a
 * `reviewerName` and a `verifyUrl`; a credential renders only welded to its dated verification
 * (the fused pair); and the FTC disclosures render from locked constants, so rewriting the
 * `compensationCue` / `scopeLine` options changes no pixel. Use the anchor when the page itself
 * must not be able to state a credential.
 *
 * JSON-LD is DECOUPLED: the anchor renders the BADGE only (`omitJsonLd`). The article template
 * emits the schema.org JSON-LD server-side from the same verified verdict, so a page builder
 * can't duplicate, move, or omit structured data. See "The article route example" in the package
 * README for the route both halves meet in.
 *
 * EDGE-CACHE DISCIPLINE: the consumer's loader MUST verify per request as a dynamic edge
 * subrequest and must NOT long-cache the rendered badge HTML — a revoked/expired credential
 * sitting in a stale edge cache would defeat fail-closed. Bound any positive-verdict cache by
 * min(expiry, revocation-TTL, content-version).
 *
 * cert-block carries no Builder dependency: the registration shape is declared structurally, and
 * `isEditing` is a passed-in flag (the consumer supplies Builder's `isPreviewing()`).
 */
import { createContext, type ReactNode, useContext } from 'react'
import { CertReview } from '../components/CertReview.js'
import type { CertVerdict } from '../contract/kernel.js'

/** The current page's credential, resolved + verified by the consumer's loader. */
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
			CertREV Review: <b>resolves at publish</b> from issuer verification. The expert badge appears here once this
			page’s article is certified, and only while the credential is valid.
		</div>
	)
}

/**
 * The Builder block. ZERO inputs — a layout anchor only. Renders the current page's VERIFIED
 * badge (badge only; JSON-LD is emitted server-side), the editor placeholder in design mode, or
 * NOTHING in production (fail-closed). The credential is whatever the loader delivered + verified
 * for THIS page; the editor can neither choose nor forge it.
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

// ── The Builder.io PUSH kit (CertReviewCard) + the single-sourced wire type ──
export {
	BUILDER_CERT_CHROME_KEYS,
	type BuilderCertChromeData,
	type BuilderCertChromeKey,
	type CertChromeRenderDef,
	type CertDeliveryMarker,
} from './cert-chrome-data.js'
export {
	acceptedDeliveryMarker,
	BUILDER_REGISTRATION,
	type BuilderInput,
	CERT_COMPONENT_NAME,
	type CertBlockBuilderRegistration,
	CertReviewCard,
	type CertReviewCardProps,
	type CertReviewCardRegisteredComponent,
	certRevCertComponent,
	PLACEMENT_INPUTS,
	WIRE_INPUTS,
} from './cert-review-card.js'
export {
	CERT_FACE_FIELDS,
	credentialLabel,
	type EnvelopeCardOptions,
	envelopeCardInput,
	faceFromDef,
	layoutFor,
	themeFromDef,
} from './envelope-face.js'
