/**
 * Pure envelope → modal-HTML mapping for `<certrev-cert-modal>`.
 *
 * DOM-free and side-effect-free so it unit-tests without a browser: given the
 * signed envelope's `payload.content`, it returns the inner HTML of the certificate
 * (3a) and reviewer (4b) `<dialog>`s. The element (`certrev-cert-modal.ts`) owns the
 * shadow root, the `<dialog>` wrappers, and the open/close wiring; this module owns
 * only the content.
 *
 * Invariants:
 *  - Every dynamic value is `escapeHtml`'d (the envelope is signed, but a reviewer
 *    name / memo is still attacker-adjacent content).
 *  - Only `http(s)` hrefs render (mirrors the Liquid `certrev-safe-url` guard).
 *  - Verified-only fields: the bio binds the envelope's verified
 *    `background`/`bio`; this module never reaches for a raw column.
 *  - Graceful degradation: a missing article title drops the "Certifies the article"
 *    block; a missing display cert id drops that meta column; no credentials → no
 *    chips / no creds line; no bio → no bio paragraph. Nothing renders an empty gap.
 *  - Display-eviction accept-on-read: an ABSENT `display` block resolves to the
 *    preset default (show-all) — every read below is `display?.x !== false` / `=== false`,
 *    so `undefined` never suppresses a field. The modal is the LOCKED navy trust chrome and
 *    is deliberately NOT themeable by a brand render-def; it reads visibility off the signed
 *    envelope only, so no render-def wiring belongs here.
 *  - Type tolerance, not just shape tolerance: `content` is a `JSON.parse(...) as` cast off an
 *    envelope whose SIGNATURE was checked and whose SHAPE never was, so every read below goes
 *    through `asText` before it touches a string method. `(x || '').trim()` looks defensive but
 *    throws on a number, and a throw here is the dialog the reader just clicked failing to open.
 */

import { asText, escapeHtml } from './escape.js'
import { resizeAvatarUrl } from './avatar-resize.js'
import { CERT_SCOPE_LINE, formatCertDisplayDate } from './display-strings.js'
import { checkIcon, chevronMark, verifiedStamp } from './certrev-cert-modal.styles.js'

export interface CertModalCredential {
	abbreviation?: string | null
	fullName?: string | null
	cardLabel?: string | null
}

export interface CertModalExpert {
	displayName?: string | null
	credentials?: readonly CertModalCredential[] | null
	profileUrl?: string | null
	photoUrl?: string | null
	bio?: string | null
	background?: string | null
	/** The pre-composed material-connection label ('Compensated expert') or null/absent for
	 *  a pro-bono reviewer. Present → the disclosure footer renders the label; null/absent → label omitted. */
	compensationCue?: string | null
}

/** The subset of the signed `payload.content` the modals read (structural). */
export interface CertModalContent {
	expert?: CertModalExpert | null
	certifiedAt?: string | null
	verifyUrl?: string | null
	articleTitle?: string | null
	displayCertId?: string | null
	display?: { showExpertPhoto?: boolean | null; showBio?: boolean | null } | null
}

/**
 * The `rel` every CertREV anchor in this module carries.
 *
 * `../components/rel.ts` (`CERTREV_LINK_REL`) is the SOURCE OF TRUTH for the qualification
 * tokens and the policy reasoning behind them — read it there. The value is duplicated rather
 * than imported because `src/modal/` is bundled standalone into the dependency-free
 * `certrev-cert.js` IIFE (`build:modal-bundle`) and imports NOTHING from `src/components/`;
 * crossing that boundary for a string constant would pull the SSR module graph into a
 * storefront asset. This copy adds `noreferrer` on top of the shared tokens: both anchors here
 * are `target="_blank"`, where it still earns its place.
 *
 * Keep in lockstep with `CERTREV_LINK_REL` — `nofollow` + `sponsored` are the qualification the
 * link-spam policy names, and dropping either from one copy silently un-qualifies half the
 * package's links.
 */
export const CERTREV_MODAL_LINK_REL = 'nofollow sponsored noopener noreferrer'

const HONORIFIC_RE = /^(dr|prof|professor|mr|mrs|ms|mx|rev|sir|dame)\.?\s+/i

/** The bare given+family name: strip the leading honorific AND the trailing post-nominal
 *  (`, MD`), so "Dr. Erik Schraga, MD" → "Erik Schraga". */
function coreName(displayName: string): string {
	const withoutHonorific = asText(displayName).replace(HONORIFIC_RE, '').trim()
	const comma = withoutHonorific.indexOf(',')
	return (comma === -1 ? withoutHonorific : withoutHonorific.slice(0, comma)).trim()
}

/** Two-letter initials — first + last of the core name (honorific + post-nominal stripped),
 *  so "Dr. Erik Schraga, MD" → "ES" (matches the Liquid derivation), not "EM". */
export function deriveInitials(name: string): string {
	const words = coreName(name).split(/\s+/).filter(Boolean)
	if (words.length === 0) return ''
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
	return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/** The handwritten-signature form (the core name). */
export function signatureName(displayName: string): string {
	return coreName(displayName)
}

/** `https://certrev.com/verify/x` → `certrev.com/verify/x` (footer URL line). */
export function stripProtocol(url: string): string {
	return asText(url).replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

/** Return the url only if it is an absolute http(s) URL, else `#` (safe-url guard). */
export function safeHref(url: string | null | undefined): string {
	const href = asText(url).trim()
	if (!href) return '#'
	return /^https?:\/\//i.test(href) ? href : '#'
}

/** A single credential's display label (cardLabel ?? fullName ?? abbreviation). */
function credLabel(c: CertModalCredential | null | undefined): string {
	return (asText(c?.cardLabel) || asText(c?.fullName) || asText(c?.abbreviation)).trim()
}

/** The verified credential labels, in order, de-duped + non-empty. */
function credLabels(expert: CertModalExpert | null | undefined): string[] {
	const out: string[] = []
	// `Array.isArray`, not `?? []`: a `credentials` that parsed as an object is not iterable, and
	// `for…of` over one throws before any of the per-entry guards below get a chance to run.
	const credentials = Array.isArray(expert?.credentials) ? expert.credentials : []
	for (const c of credentials) {
		const label = credLabel(c)
		if (label && !out.includes(label)) out.push(label)
	}
	return out
}

/** The reviewer bio — verified background preferred, then verified bio. */
function bioText(expert: CertModalExpert | null | undefined, display: CertModalContent['display']): string {
	if (display?.showBio === false) return ''
	return (asText(expert?.background) || asText(expert?.bio)).trim()
}

/** An avatar cell — the cert-frozen photo (when shown) or the initials chip. */
function avatarHtml(
	expert: CertModalExpert | null | undefined,
	name: string,
	sizeClass: string,
	showPhoto: boolean,
): string {
	const photo = asText(expert?.photoUrl).trim()
	if (showPhoto && /^https?:\/\//i.test(photo)) {
		// Display px from the size class; request the @2x derivative for retina crispness.
		// resizeAvatarUrl is host-guarded + enablement-gated: until Cloudflare Image Resizing is live it
		// returns the raw canonical URL, so the modal never 404s an unresized host.
		const displayPx = sizeClass.includes('--64') ? 64 : 56
		const src = resizeAvatarUrl(photo, displayPx === 64 ? 128 : 112)
		return `<img class="crm-avatar ${sizeClass}" src="${escapeHtml(src)}" alt="" width="${displayPx}" height="${displayPx}" decoding="async">`
	}
	return `<span class="crm-avatar ${sizeClass}">${escapeHtml(deriveInitials(name))}</span>`
}

const CLOSE_BUTTON = `<button type="button" class="crm-close" data-certrev-modal-close aria-label="Close">&times;</button>`

function headHtml(eyebrow: string): string {
	return `<div class="crm-head">${chevronMark(16, '#ffffff')}<span class="crm-head__eyebrow">${escapeHtml(eyebrow)}</span><span class="crm-head__wordmark">CertREV</span></div>`
}

function certifiedChip(cls: string): string {
	return `<span class="${cls}">${checkIcon(8)}Certified</span>`
}

/**
 * The FTC disclosure footer, rendered on both dialogs. The material-connection cue
 * (`expert.compensationCue`, a FINISHED string off the signed envelope) leads ONLY when the reviewer
 * was compensated; a pro-bono reviewer (null/absent cue) drops the label but keeps the scope line —
 * which makes no compensation claim, so it is true for volunteers too and renders unconditionally.
 * The scope line is the verbatim FTC copy (`CERT_SCOPE_LINE`), never re-assembled here.
 */
function disclosureFooter(expert: CertModalExpert | null | undefined): string {
	const cue = asText(expert?.compensationCue).trim()
	const cueHtml = cue ? `<span class="crm-disclosure__cue">${escapeHtml(cue)}</span> ` : ''
	return `<div class="crm-disclosure">${cueHtml}${escapeHtml(CERT_SCOPE_LINE)}</div>`
}

/**
 * The certificate modal (3a) inner HTML. Returns `null` when there is no reviewer
 * name to display — a certificate card must never render anonymous (fail-closed,
 * mirrors the Liquid `ename != ''` gate).
 */
export function renderCertDialogInner(content: CertModalContent): string | null {
	const expert = content.expert ?? null
	const name = asText(expert?.displayName).trim()
	if (!name) return null

	const showPhoto = content.display?.showExpertPhoto !== false
	const creds = credLabels(expert).join(' · ')
	const issued = formatCertDisplayDate(content.certifiedAt) ?? ''
	const certId = asText(content.displayCertId).trim()
	const title = asText(content.articleTitle).trim()
	const verifyUrl = asText(content.verifyUrl).trim()
	const sig = signatureName(name)

	const certifiesBlock = title
		? `<div class="crm-certifies"><div class="crm-certifies__eyebrow">Certifies the article</div><div class="crm-certifies__title">${escapeHtml(title)}</div></div>`
		: ''

	const certIdCol = certId
		? `<div class="crm-meta__col"><div class="crm-meta__label">Certificate ID</div><div class="crm-meta__value crm-meta__value--mono">${escapeHtml(certId)}</div></div>`
		: ''

	const urlLine = verifyUrl ? `<div class="crm-sig__url">${escapeHtml(stripProtocol(verifyUrl))}</div>` : ''

	return `${CLOSE_BUTTON}${headHtml('Certificate of Expert Review')}<div class="crm-body--cert"><div class="crm-expert-row">${avatarHtml(expert, name, 'crm-avatar--56', showPhoto)}<div class="crm-expert-row__info"><div class="crm-expert-row__eyebrow">Reviewing Expert</div><div class="crm-expert-row__name">${escapeHtml(name)}</div>${creds ? `<div class="crm-expert-row__creds">${escapeHtml(creds)}</div>` : ''}</div></div>${certifiesBlock}<div class="crm-meta"><div class="crm-meta__col"><div class="crm-meta__label">Issued</div><div class="crm-meta__value">${escapeHtml(issued)}</div></div>${certIdCol}<div class="crm-meta__col"><div class="crm-meta__label">Status</div><div class="crm-meta__status">${certifiedChip('crm-chip')}</div></div></div><div class="crm-sig"><div><div class="crm-sig__name">${escapeHtml(sig)}</div><div class="crm-sig__rule"></div>${urlLine}</div>${verifiedStamp('cert')}</div>${disclosureFooter(expert)}<div class="crm-actions"><a class="crm-cta" href="${escapeHtml(safeHref(verifyUrl))}" target="_blank" rel="${CERTREV_MODAL_LINK_REL}">View full certificate</a><button type="button" class="crm-ghost" data-certrev-modal-close>Close</button></div></div>`
}

/**
 * The reviewer/profile modal inner HTML. Returns `null` when there is no
 * reviewer name (fail-closed). The affiliation subtitle is intentionally omitted:
 * there is no verified data source for it.
 */
export function renderExpertDialogInner(content: CertModalContent): string | null {
	const expert = content.expert ?? null
	const name = asText(expert?.displayName).trim()
	if (!name) return null

	const showPhoto = content.display?.showExpertPhoto !== false
	const chips = credLabels(expert)
	const bio = bioText(expert, content.display)
	const date = formatCertDisplayDate(content.certifiedAt)

	const chipsHtml = chips.length
		? `<div class="crm-chips">${chips.map((c) => `<span class="crm-chips__chip">${escapeHtml(c)}</span>`).join('')}</div>`
		: ''
	const bioHtml = bio ? `<p class="crm-bio">${escapeHtml(bio)}</p>` : ''
	const trustText = date ? `Independently reviewed · Certified ${escapeHtml(date)}` : 'Independently reviewed'

	return `${CLOSE_BUTTON}${headHtml('Verified reviewer')}<div class="crm-body--expert"><div class="crm-id">${avatarHtml(expert, name, 'crm-avatar--64', showPhoto)}<div class="crm-id__info"><div class="crm-id__name">${escapeHtml(name)}</div></div></div>${chipsHtml}${bioHtml}<div class="crm-trust">${certifiedChip('crm-trust__chip')}<span class="crm-trust__text">${trustText}</span></div>${disclosureFooter(expert)}<div class="crm-actions"><a class="crm-cta" href="${escapeHtml(safeHref(expert?.profileUrl))}" target="_blank" rel="${CERTREV_MODAL_LINK_REL}">View full profile on CertREV</a><button type="button" class="crm-ghost" data-certrev-modal-close>Close</button></div></div>`
}
