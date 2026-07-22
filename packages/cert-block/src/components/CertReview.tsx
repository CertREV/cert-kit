/**
 * <CertReview> — the one-line convenience composite.
 *
 * Most brand integrations want "render the badge + the JSON-LD from a verified
 * envelope, or render nothing". This wraps that: pass a `CertVerdict` (the output of
 * `getVerifiedEnvelope` / the kernel) and it renders the badge + projected JSON-LD on
 * `render`, and NOTHING on `suppress` (fail-closed at the component boundary too). The
 * expert bio + backlink remain separately placeable for brands that want finer control.
 */

import type { CertVerdict } from '../contract/kernel.js'
import { CertBadge } from './CertBadge.js'
import { CertJsonLd } from './CertJsonLd.js'
import type { CertRenderDef } from './render-def.js'

export interface CertReviewProps {
	/** The verdict from `getVerifiedEnvelope` (or a direct kernel call). */
	readonly verdict: CertVerdict
	/** Canonical page URL for JSON-LD @id alignment (merge into the host article node). */
	readonly pageUrl?: string
	readonly accentColor?: string
	readonly className?: string
	readonly badgeStyle?: 'full' | 'compact'
	/**
	 * The brand render-def (WS6). Forwarded to `<CertBadge>` for themeable-token
	 * emission + subtractive visibility; absent → the CertREV preset default. The
	 * JSON-LD is presentation-blind, so the def never touches the structured data.
	 */
	readonly renderDef?: CertRenderDef
	/** Omit the JSON-LD (e.g. the page already emits it elsewhere). Default false. */
	readonly omitJsonLd?: boolean
}

export function CertReview(props: CertReviewProps) {
	// Fail-closed: a suppressed (or any non-render) verdict renders nothing.
	if (props.verdict.decision !== 'render') return null
	const payload = props.verdict.payload
	return (
		<>
			<CertBadge
				payload={payload}
				accentColor={props.accentColor}
				className={props.className}
				badgeStyle={props.badgeStyle}
				renderDef={props.renderDef}
			/>
			{props.omitJsonLd ? null : <CertJsonLd payload={payload} pageUrl={props.pageUrl} />}
		</>
	)
}
