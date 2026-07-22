/**
 * <CertRevBacklink> — the live "Verify on CertREV" link.
 *
 * The local badge is a bounded-stale snapshot; `content.verifyUrl` is ALWAYS the live
 * source of truth. This standalone link lets brands place the verification entry point
 * wherever they want, independent of the badge. SSR-safe + pure; URL through
 * `safeHttpUrl`. Renders nothing if the verify URL is unsafe/absent (fail-closed).
 */

import type { CertPayload } from '../contract/kernel.js'
import { safeHttpUrl } from './escape.js'
import { resolveDisplay } from './format.js'

export interface CertRevBacklinkProps {
	readonly payload: CertPayload
	readonly accentColor?: string
	readonly className?: string
	/** Link text (default "Verify on CertREV"). */
	readonly label?: string
}

const ROOT_CLASS = 'certrev-backlink'

export function CertRevBacklink(props: CertRevBacklinkProps) {
	const verifyUrl = safeHttpUrl(props.payload.content.verifyUrl)
	if (!verifyUrl) return null
	const display = resolveDisplay(props.payload.content.display, props.accentColor)
	const rootClass = `${ROOT_CLASS}${props.className ? ` ${props.className}` : ''}`
	// Typed as a string record (not inline) so the `--certrev-accent` CSS custom property
	// is accepted — React's CSSProperties rejects arbitrary custom props on an inline literal.
	const rootStyle: Record<string, string> = { ['--certrev-accent']: display.accentColor, color: display.accentColor }

	return (
		<a
			className={rootClass}
			style={rootStyle}
			href={verifyUrl}
			rel="noopener"
			aria-label="Verify this certification on CertREV"
		>
			<svg
				className={`${ROOT_CLASS}__icon`}
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				aria-hidden="true"
				focusable="false"
			>
				<title>Verified</title>
				<path
					d="M12 2l7 3v6c0 4.4-3 8.3-7 9-4-0.7-7-4.6-7-9V5l7-3z"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinejoin="round"
				/>
				<path d="M8.5 12l2.3 2.3L15.5 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
			<span className={`${ROOT_CLASS}__label`}>{props.label ?? 'Verify on CertREV'}</span>
		</a>
	)
}
