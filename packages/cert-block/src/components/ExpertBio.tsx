/**
 * <ExpertBio> — the reviewing expert's identity block (photo, name, credentials, link).
 *
 * Renders the E-E-A-T-bearing facts about WHO reviewed the content, separate from the
 * compact badge. Brands place this near the article footer / author box. SSR-safe + pure
 * like the rest; every field React-escaped; URLs through `safeHttpUrl`.
 */

import type { CertPayload } from '../contract/kernel.js'
import { safeHttpUrl } from './escape.js'
import { resolveDisplay } from './format.js'

export interface ExpertBioProps {
	readonly payload: CertPayload
	readonly accentColor?: string
	readonly className?: string
	/** Heading level for the expert name (default 'h3') so it slots into the page outline. */
	readonly headingLevel?: 'h2' | 'h3' | 'h4'
}

const ROOT_CLASS = 'certrev-expert-bio'

export function ExpertBio(props: ExpertBioProps) {
	const { payload } = props
	const { expert } = payload.content
	const display = resolveDisplay(payload.content.display, props.accentColor)
	const profileUrl = safeHttpUrl(expert.profileUrl)
	const photoUrl = display.showExpertPhoto ? safeHttpUrl(expert.photoUrl) : null
	const Heading = props.headingLevel ?? 'h3'
	const rootClass = `${ROOT_CLASS}${props.className ? ` ${props.className}` : ''}`
	const rootStyle: Record<string, string> = { ['--certrev-accent']: display.accentColor }

	const nameNode = (
		<Heading className={`${ROOT_CLASS}__name`}>
			{expert.displayName}
			{expert.credentials.length > 0 ? (
				<span className={`${ROOT_CLASS}__credentials`}>, {expert.credentials.map((c) => c.abbreviation).join(', ')}</span>
			) : null}
		</Heading>
	)

	return (
		<aside className={rootClass} style={rootStyle} aria-label={`About the reviewing expert, ${expert.displayName}`}>
			{photoUrl ? (
				<img
					className={`${ROOT_CLASS}__photo`}
					src={photoUrl}
					alt={`Photo of ${expert.displayName}`}
					width={64}
					height={64}
					loading="lazy"
					decoding="async"
				/>
			) : null}
			<div className={`${ROOT_CLASS}__body`}>
				{profileUrl ? (
					<a className={`${ROOT_CLASS}__name-link`} href={profileUrl} rel="noopener">
						{nameNode}
					</a>
				) : (
					nameNode
				)}
				{expert.credentials.length > 0 ? (
					<ul className={`${ROOT_CLASS}__credential-list`}>
						{expert.credentials.map((c) => (
							<li key={`${c.abbreviation}:${c.fullName}`} className={`${ROOT_CLASS}__credential`}>
								<abbr title={c.fullName}>{c.abbreviation}</abbr>
								<span className={`${ROOT_CLASS}__credential-full`}> — {c.fullName}</span>
							</li>
						))}
					</ul>
				) : null}
				<p className={`${ROOT_CLASS}__role`}>Verified expert reviewer</p>
			</div>
		</aside>
	)
}
