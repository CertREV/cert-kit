/**
 * Framework-agnostic badge HTML renderer.
 *
 * The single source of badge markup for BOTH the Web Component (client upgrade) and any
 * server-side include that wants to emit the badge as a string without React. It mirrors
 * the <CertBadge> JSX one-for-one — same classes, same structure, same accessibility —
 * but builds an HTML string, so EVERY interpolated field is escaped by hand
 * (`escapeHtml` for content, `escapeAttribute` for attributes, `safeHttpUrl` for hrefs).
 *
 * It is pure + DOM-free, so it runs server-side (the SSR string the crawler sees) and is
 * reused client-side by the Web Component. Crawlability requirement from the contract:
 * the badge must be in the server HTML, never client-only.
 */

import { escapeAttribute, escapeHtml, safeCssColor, safeHttpUrl } from '../components/escape.js'
import {
	credentialSuffix,
	dedupeCredential,
	expertNameWithCredentials,
	formatDate,
	resolveDisplay,
} from '../components/format.js'
import { CERTREV_LINK_REL } from '../components/rel.js'
import {
	CERT_SCOPE_LINE,
	CERT_STRINGS_VERSION,
	type CertRenderDef,
	resolveRenderTheme,
	themeCssVarDeclarations,
} from '../components/render-def.js'
import type { CertContent, CertPayload } from '../contract/kernel.js'

export interface RenderBadgeOptions {
	readonly accentColor?: string
	readonly badgeStyle?: 'full' | 'compact'
	/**
	 * The brand render-def. ABSENT → the badge renders the CertREV preset
	 * default (theme output byte-identical to un-themed). PRESENT → validated
	 * themeable tokens are emitted as `--certrev-*` CSS vars + subtractive
	 * visibility applies. Mirrors `<CertBadge>`'s `renderDef` prop exactly.
	 */
	readonly renderDef?: CertRenderDef
}

const C = 'certrev-badge'

/**
 * The payload as it ACTUALLY arrives, not as the contract types promise it.
 *
 * `getVerifiedEnvelope` casts raw JSON (`JSON.parse(value) as CertDeliveryEnvelope`) and
 * `verifyEnvelope` checks the signature, subject, lifecycle and drift — it never asserts the
 * SHAPE of `content`. `renderBadgeHtml` is public API on top of that (the README shows a
 * consumer calling it with a payload of their own), so every field is read as absent-able.
 * The escape/format helpers already coerce a non-string VALUE (`asText`); what no helper can
 * absorb is a missing PARENT object, which is what this view exists for. `cert-modal-view.ts`
 * has read the same data this way since the unified modal landed — two renderers in one package
 * disagreeing
 * about whether the same payload is trusted is itself the defect.
 *
 * The `format.ts` helpers still take the CONTRACT type (`payload?.content`): they are
 * shape-guarded on their own side, so widening them here would only hide that.
 */
type Loose<T> = { readonly [K in keyof T]?: T[K] | null }
type LooseContent = Omit<Loose<CertContent>, 'expert' | 'author'> & {
	readonly expert?: Loose<CertContent['expert']> | null
	readonly author?: Loose<CertContent['author']> | null
}

/**
 * The badge has exactly two faces, and this is the ONE place that decides which. Anything
 * that is not the compact face renders the full face — so an unvalidated `badgeStyle` (a
 * malformed envelope's number, an untyped caller's typo) can never reach the class name.
 */
function badgeFace(style: unknown): 'full' | 'compact' {
	return style === 'compact' ? 'compact' : 'full'
}

function attr(name: string, value: string | null | undefined): string {
	if (value == null || value === '') return ''
	return ` ${name}="${escapeAttribute(value)}"`
}

/**
 * Render the certified-badge markup for a verified payload as an HTML string. Returns ''
 * when there is nothing safe to link to AND nothing to show (defensive; the kernel has
 * already decided to render by the time this is called).
 */
export function renderBadgeHtml(payload: CertPayload, opts: RenderBadgeOptions = {}): string {
	const content: LooseContent = payload?.content ?? {}
	const expert = content.expert ?? null
	const display = resolveDisplay(content.display ?? undefined, opts.accentColor, opts.renderDef)
	const theme = resolveRenderTheme(opts.renderDef)
	const style = badgeFace(opts.badgeStyle ?? display.badgeStyle)
	const accent = safeCssColor(display.accentColor) ?? '#0f766e'
	const verifyUrl = safeHttpUrl(content.verifyUrl)
	const profileUrl = safeHttpUrl(expert?.profileUrl)
	const photoUrl = style === 'full' && display.showExpertPhoto ? safeHttpUrl(expert?.photoUrl) : null
	// Same composition rule as <CertBadge>: the suffix drops a credential the display name
	// already carries, so the two renderers never disagree about one payload.
	const suffix = dedupeCredential(expert?.displayName, credentialSuffix(payload?.content))
	const certified = formatDate(content.certifiedAt)
	const updated = formatDate(content.contentModifiedAt)

	const name = `${escapeHtml(expert?.displayName)}${
		suffix ? `<span class="${C}__credentials">, ${escapeHtml(suffix)}</span>` : ''
	}`
	const nameNode = profileUrl
		? `<a class="${C}__expert-link" href="${escapeAttribute(profileUrl)}" rel="${CERTREV_LINK_REL}">${name}</a>`
		: name

	const mark =
		`<svg class="${C}__mark" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">` +
		`<circle cx="12" cy="12" r="11" fill="${escapeAttribute(accent)}"></circle>` +
		`<path d="M7 12.5l3.2 3.2L17 9" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`

	// alt="" is deliberate: the byline below renders the same name as text, so alt text would make a
	// screen reader announce it twice. Kept in lockstep with <CertBadge> and the modal avatar.
	const photo = photoUrl
		? `<img class="${C}__photo" src="${escapeAttribute(photoUrl)}" alt="" width="40" height="40" loading="lazy" decoding="async" />`
		: ''

	const header =
		`<div class="${C}__header">${mark}${photo}` +
		`<div class="${C}__heading">` +
		`<span class="${C}__eyebrow">Expert reviewed</span>` +
		`<span class="${C}__byline">Reviewed by ${nameNode}</span>` +
		`</div></div>`

	let body = ''
	if (style === 'full') {
		if (display.showMemo && content.memo) {
			body += `<p class="${C}__memo">${escapeHtml(content.memo)}</p>`
		}
		if (display.showAuthor && content.author?.name && content.author.name !== expert?.displayName) {
			const title = content.author.title ? `, ${escapeHtml(content.author.title)}` : ''
			body += `<p class="${C}__author">Written by ${escapeHtml(content.author.name)}${title}</p>`
		}
		const dates: string[] = []
		if (certified) {
			dates.push(
				`<div class="${C}__date"><dt>Certified</dt><dd><time datetime="${escapeAttribute(content.certifiedAt)}">${escapeHtml(certified)}</time></dd></div>`,
			)
		}
		if (updated && content.contentModifiedAt) {
			dates.push(
				`<div class="${C}__date"><dt>Last updated</dt><dd><time datetime="${escapeAttribute(content.contentModifiedAt)}">${escapeHtml(updated)}</time></dd></div>`,
			)
		}
		if (dates.length) body += `<dl class="${C}__dates">${dates.join('')}</dl>`
	}

	// Design guide §3: the compensation cue + FTC scope line are LOCKED on every
	// claim-bearing face (cert-block always carries the reviewer byline, so both
	// render on the full AND compact styles). The compliance BASELINE — present
	// regardless of a render-def, matching the Shopify/WordPress engine fix. The
	// cue's "expert" links to the reviewer profile; the whole cue tag-strips to the
	// byte-verbatim COMPENSATED_EXPERT_CUE. The scope line is byte-verbatim
	// CERT_SCOPE_LINE (its curly apostrophe U+2019 survives escapeHtml untouched).
	const cueInner = profileUrl
		? `Compensated <a class="${C}__cue-link" href="${escapeAttribute(profileUrl)}" rel="${CERTREV_LINK_REL}">expert</a>`
		: 'Compensated expert'
	const disclosure =
		`<div class="${C}__disclosure">` +
		`<span class="${C}__compensated-cue">${cueInner}</span>` +
		`<p class="${C}__ftc" data-ftc-disclosure><span data-ftc-line>${escapeHtml(CERT_SCOPE_LINE)}</span></p>` +
		`</div>`

	const verify = verifyUrl
		? `<a class="${C}__verify" href="${escapeAttribute(verifyUrl)}" rel="${CERTREV_LINK_REL}" aria-label="Verify this certification on CertREV">Verify on CertREV</a>`
		: ''

	// Same derivation <CertBadge> labels with, so the two renderers cannot drift on the one
	// string a screen reader actually announces.
	const ariaLabel = `Content reviewed by ${expertNameWithCredentials(payload?.content)}`
	// Accent LEADS so the un-themed output is byte-identical to the older single-var
	// form. A THEMED brand appends surface/radius/font: the data-bearing tokens ride
	// escaped (a no-op for validated hex/length — defense in depth), the font is a
	// controlled literal stack emitted raw. The whole string is NOT re-escaped
	// (the font stack's single quotes are valid inside a double-quoted attribute and
	// re-escaping would corrupt them).
	let rootStyle = `--certrev-accent:${escapeAttribute(accent)};border-inline-start-color:${escapeAttribute(accent)}`
	for (const [name, value] of themeCssVarDeclarations(theme)) {
		rootStyle += name === '--certrev-font' ? `;${name}:${value}` : `;${name}:${escapeAttribute(value)}`
	}

	return (
		// `style` is one of two literals by construction (`badgeFace`), so the class name needs
		// no escaping — there is no path by which caller data reaches it.
		`<section class="${C} ${C}--${style}" style="${rootStyle}"` +
		attr('data-certrev-cert-id', payload?.certId) +
		` data-certrev-strings-version="${CERT_STRINGS_VERSION}"` +
		attr('data-certrev-def-version', theme.version != null ? String(theme.version) : null) +
		` aria-label="${escapeAttribute(ariaLabel)}">${header}${body}${disclosure}${verify}</section>`
	)
}
