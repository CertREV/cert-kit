/**
 * <CertBadge> — the visible "Reviewed by a credentialed expert" badge.
 *
 * SSR-SAFE: a pure render component. No `useState`/`useEffect`/`useRef`, no browser-only
 * calls, no event handlers — so it works as a React Server Component AND as a client
 * component that SSRs identically (the crawlable output is the same either way). All
 * presentation comes from `payload.content.display`; all text is React-escaped; every
 * URL passes through `safeHttpUrl`.
 *
 * ACCESSIBILITY: rendered as a <section> with an accessible name, the accent applied via
 * an inline custom property (no color-only meaning — the credential text carries it), an
 * expert photo with meaningful alt text, and a verify link with a descriptive label.
 *
 * `badgeStyle: 'compact'` collapses the reviewer block to a single line (name + credentials);
 * `'full'` shows the photo, certified/updated dates, and the memo (per display flags). BOTH
 * styles carry the compensation cue + FTC scope line (the always-on compliance disclosures).
 *
 * THEMING (WS6): presentation defaults come from `payload.content.display`; an optional
 * `renderDef` prop layers a brand's validated themeable tokens (emitted as `--certrev-*`
 * CSS custom properties) and its subtractive field-visibility on top. No `renderDef` → the
 * CertREV preset default (theme output byte-identical to un-themed).
 */

import type { CertContent, CertPayload } from '../contract/kernel.js'
import { safeHttpUrl } from './escape.js'
import { credentialSuffix, expertNameWithCredentials, formatDate, resolveDisplay } from './format.js'
import {
	CERT_SCOPE_LINE,
	CERT_STRINGS_VERSION,
	type CertRenderDef,
	resolveRenderTheme,
	themeCssVarDeclarations,
} from './render-def.js'

export interface CertBadgeProps {
	/** The cryptographically-verified payload (from `getVerifiedEnvelope`). */
	readonly payload: CertPayload
	/** Optional accent override (else render-def, else `display.accentColor`, else CertREV default). */
	readonly accentColor?: string
	/** Extra class names appended to the root element's class list. */
	readonly className?: string
	/** Override the badge style independent of the signed display config. */
	readonly badgeStyle?: 'full' | 'compact'
	/**
	 * The brand render-def (WS6). ABSENT → the badge renders the CertREV preset
	 * default (fail-safe; theme output byte-identical to un-themed). PRESENT → its
	 * validated themeable tokens are emitted as `--certrev-*` CSS custom properties
	 * and its subtractive hide-set removes brand-toggleable fields. Invalid tokens
	 * are dropped (defense-in-depth over the write-path gate).
	 */
	readonly renderDef?: CertRenderDef
}

const ROOT_CLASS = 'certrev-badge'

/** Inline-SVG verified checkmark — no external asset, accent-tinted, decorative. */
function VerifiedMark({ accent }: { accent: string }) {
	return (
		<svg
			className={`${ROOT_CLASS}__mark`}
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			aria-hidden="true"
			focusable="false"
		>
			<title>Verified</title>
			<circle cx="12" cy="12" r="11" fill={accent} />
			<path d="M7 12.5l3.2 3.2L17 9" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

function ExpertPhoto({ content, show }: { content: CertContent; show: boolean }) {
	const src = show ? safeHttpUrl(content.expert.photoUrl) : null
	if (!src) return null
	return (
		<img
			className={`${ROOT_CLASS}__photo`}
			src={src}
			alt={`Photo of ${content.expert.displayName}`}
			width={40}
			height={40}
			loading="lazy"
			decoding="async"
		/>
	)
}

export function CertBadge(props: CertBadgeProps) {
	const { payload } = props
	const content = payload.content
	const display = resolveDisplay(content.display, props.accentColor, props.renderDef)
	const theme = resolveRenderTheme(props.renderDef)
	const style = props.badgeStyle ?? display.badgeStyle
	const verifyUrl = safeHttpUrl(content.verifyUrl)
	const profileUrl = safeHttpUrl(content.expert.profileUrl)
	const certifiedLabel = formatDate(content.certifiedAt)
	const updatedLabel = formatDate(content.contentModifiedAt)
	const suffix = credentialSuffix(content)
	const accent = display.accentColor

	const rootClass = `${ROOT_CLASS} ${ROOT_CLASS}--${style}${props.className ? ` ${props.className}` : ''}`
	// Accent is exposed as a custom property so brand themes can read it, and applied
	// directly to the accent border so the component is self-styling without a stylesheet.
	// A THEMED brand additionally emits the surface/radius/font vars; with no render-def
	// `themeCssVarDeclarations` is empty, so the un-themed style is byte-identical.
	const rootStyle: Record<string, string> = {
		['--certrev-accent']: accent,
		borderInlineStartColor: accent,
	}
	for (const [name, value] of themeCssVarDeclarations(theme)) rootStyle[name] = value

	const expertName = (
		<span className={`${ROOT_CLASS}__expert-name`}>
			{content.expert.displayName}
			{suffix ? <span className={`${ROOT_CLASS}__credentials`}>, {suffix}</span> : null}
		</span>
	)

	return (
		<section
			className={rootClass}
			style={rootStyle}
			data-certrev-cert-id={payload.certId}
			data-certrev-strings-version={CERT_STRINGS_VERSION}
			data-certrev-def-version={theme.version}
			aria-label={`Content reviewed by ${expertNameWithCredentials(content)}`}
		>
			<div className={`${ROOT_CLASS}__header`}>
				<VerifiedMark accent={accent} />
				{style === 'full' ? <ExpertPhoto content={content} show={display.showExpertPhoto} /> : null}
				<div className={`${ROOT_CLASS}__heading`}>
					<span className={`${ROOT_CLASS}__eyebrow`}>Expert reviewed</span>
					<span className={`${ROOT_CLASS}__byline`}>
						Reviewed by{' '}
						{profileUrl ? (
							<a className={`${ROOT_CLASS}__expert-link`} href={profileUrl} rel="noopener">
								{expertName}
							</a>
						) : (
							expertName
						)}
					</span>
				</div>
			</div>

			{style === 'full' ? (
				<>
					{display.showMemo && content.memo ? <p className={`${ROOT_CLASS}__memo`}>{content.memo}</p> : null}
					{display.showAuthor && content.author.name && content.author.name !== content.expert.displayName ? (
						<p className={`${ROOT_CLASS}__author`}>
							Written by {content.author.name}
							{content.author.title ? `, ${content.author.title}` : ''}
						</p>
					) : null}
					<dl className={`${ROOT_CLASS}__dates`}>
						{certifiedLabel ? (
							<div className={`${ROOT_CLASS}__date`}>
								<dt>Certified</dt>
								<dd>
									<time dateTime={content.certifiedAt}>{certifiedLabel}</time>
								</dd>
							</div>
						) : null}
						{updatedLabel ? (
							<div className={`${ROOT_CLASS}__date`}>
								<dt>Last updated</dt>
								<dd>
									<time dateTime={content.contentModifiedAt ?? undefined}>{updatedLabel}</time>
								</dd>
							</div>
						) : null}
					</dl>
				</>
			) : null}

			{/* Design guide §3: the compensation cue + FTC scope line are LOCKED on every
			    claim-bearing face (named / credentialed / memo) — with or without a memo —
			    so a brand can never show an endorsement impression without its disclosures.
			    cert-block only ever renders a claim face (it always carries the reviewer
			    byline), so both lines render on both the full AND compact styles. This is
			    the compliance BASELINE — it lands regardless of a render-def, matching the
			    Shopify/WordPress engine fix. The cue's "expert" links to the reviewer's
			    CertREV profile (the whole cue tag-strips to the byte-verbatim
			    COMPENSATED_EXPERT_CUE). The scope line is byte-verbatim CERT_SCOPE_LINE. */}
			<div className={`${ROOT_CLASS}__disclosure`}>
				<span className={`${ROOT_CLASS}__compensated-cue`}>
					Compensated{' '}
					{profileUrl ? (
						<a className={`${ROOT_CLASS}__cue-link`} href={profileUrl} rel="noopener">
							expert
						</a>
					) : (
						'expert'
					)}
				</span>
				<p className={`${ROOT_CLASS}__ftc`} data-ftc-disclosure>
					<span data-ftc-line>{CERT_SCOPE_LINE}</span>
				</p>
			</div>

			{verifyUrl ? (
				<a
					className={`${ROOT_CLASS}__verify`}
					href={verifyUrl}
					rel="noopener"
					aria-label="Verify this certification on CertREV"
				>
					Verify on CertREV
				</a>
			) : null}
		</section>
	)
}
