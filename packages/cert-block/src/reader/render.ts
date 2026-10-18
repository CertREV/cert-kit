/**
 * ─────────────────────────────────────────────────────────────────────────────
 * `renderReaderFace` — the certrev.com "reader" face, as the Builder card paints it (1.2.0)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The same markup, byte for byte, as the Shopify `certrev-reader-{banner,memo,sidebar,pill}` snippets, which are the
 * portal's canonical render of the face (the "What your reader sees" demo on certrev.com). Styling is `reader.css`
 * (the generated reader section of the Shopify stylesheet, `READER_CSS`); this file only emits the DOM it targets.
 * The golden tests compare the sections to the portal's golden pages, and the differential tests compare edge cases to
 * the portal's own Liquid harness output, so the two renderers cannot drift without a test saying so.
 *
 * It is a NEW face, selected only by a delivered render def that says `face: 'reader'` (see `envelopeCardHtml`).
 * Nothing in the legacy `renderCertBlock` is read or changed here.
 *
 * The facts are read exactly as the snippets read the same envelope:
 *  - the card renders only with a reviewer name (the memo and sidebar too); the pill needs only a verify URL;
 *  - the credential is each credential's `cardLabel` (else `abbreviation`), joined; the "Credential verified by CertREV"
 *    attribution is gated on a displayed credential, and "on {date}" binds `expert.credentialVerifiedAt` and nothing
 *    else (no fallback to the certified date: with no date only the undated, still-true attribution prints);
 *  - the compensation cue renders ONLY when the envelope carries `expert.compensationCue`; the def cannot hide it, and
 *    its words are fixed. `illustrative` (a CertREV preview, never a live page) fills the cue's slot with the demo's
 *    "Illustrative example" label when the envelope has no cue; a real cue always wins the slot;
 *  - the scope line is never hideable: the card carries it when there is no memo, the memo card and the sidebar always;
 *  - the text leaves are the demo's (what React server-renders): the memo name is the name, "," and the credential; the
 *    profile link is "View", the first name and "’s profile"; the sidebar name is the name, "," and the credential in
 *    one `<b>`; the certified date is direct text of its span beside the "Certified" cue (no `<time>`); the scope
 *    sentence is direct text of the scope element, which carries `data-ftc-line` itself (after the cue's " · " there
 *    is a `<!-- -->`, so the cue separator and the sentence are two text nodes). The `<!-- -->` marks between
 *    adjacent leaves are React's, kept so the bytes equal the Liquid snippets' and the portal's goldens;
 *  - the avatars: a photo when there is one to paint, else the person's initials (`face.ts` is the byte spec), else the
 *    silhouette for a name with none. The def's `hidden` set holding `reviewerPhoto`, and `display.showExpertPhoto ===
 *    false`, keep the photo URL out of the page entirely (the avatar is the initials); neither removes the avatar.
 *    `display.showAuthor === false` drops the author column.
 *
 * Every interpolated field is escaped and every URL passes `safeUrl`. A hostile type (a number, an object) renders as
 * nothing, never as a throw: see `helpers.ts`.
 */
import { asText } from '../components/escape.js'
import { CERTREV_LINK_REL } from '../components/rel.js'
import { CERT_SCOPE_LINE, CERT_STRINGS_VERSION, COMPENSATED_EXPERT_CUE } from '../components/render-def.js'
import type { CertContent } from '../contract/kernel.js'
import { readerFace } from './face.js'
import {
	cleaned,
	contains,
	esc,
	firstName,
	isBlank,
	isPresent,
	isTruthy,
	longDate,
	type Rec,
	rec,
	safeUrl,
	textOr,
} from './helpers.js'
import { readerLogo } from './logo.js'
import { readerTokens } from './tokens.js'

export type ReaderLayout = 'banner' | 'sidebar' | 'floating'

/** Which of the banner's two cards to paint: both (the page default), the byline card alone, or the memo card alone. */
export type ReaderPart = 'full' | 'header' | 'memo'

export interface ReaderFaceInput {
	/** The verified envelope's `payload.content`. */
	readonly content: CertContent
	/** The delivered render def (already known to say `face: 'reader'`); read for tokens and `hidden`. */
	readonly def?: unknown
	readonly layout: ReaderLayout
	/** Banner only; the sidebar and the floating pill are one section each. Defaults to `full`. */
	readonly part?: ReaderPart
	/** The envelope's `payload.certId`, stamped as `data-certrev-cert-id` (the revalidation hook reads it). */
	readonly certId?: string
	/** A CertREV preview (never a live page): label a cue-less article "Illustrative example". */
	readonly illustrative?: boolean
}

/*
 * Every reader anchor carries the package's own link policy, `CERTREV_LINK_REL` (`nofollow sponsored noopener`), the
 * same as the legacy faces: a Builder page's CertREV links are a vendor-required placement and must keep the
 * sponsored/nofollow signal. The Shopify snippets (and so the portal's goldens) say `rel="noopener noreferrer"`; that is
 * theirs, not the target. It is the ONE byte the reader differs from them in, and `reader-link-rel.test.ts` pins that:
 * the golden and differential tests rewrite the Liquid's rel on anchors to this value and compare everything else exactly.
 */

/** What every section of one render shares: the facts read once from the envelope and the def. */
interface Facts {
	readonly content: Rec
	readonly expert: Rec
	readonly disp: Rec
	readonly def: unknown
	readonly certId: string
	readonly ename: string
	/** Whether a photo may be painted: neither `reviewerPhoto` hidden nor `showExpertPhoto: false`. */
	readonly showPhoto: boolean
	/** The joined credential labels, '' when there are none. */
	readonly creds: string
	readonly hasCue: boolean
	readonly illus: boolean
	readonly noMemo: boolean
	readonly purl: string
	readonly vurl: string
	readonly style: string
	readonly fg: string
}

function readFacts(input: ReaderFaceInput): Facts {
	const content = rec(input.content)
	const expert = rec(content.expert)
	const disp = rec(content.display)
	const def = input.def
	const rd = rec(def)

	const showPhoto = disp.showExpertPhoto !== false && !contains(rd.hidden, 'reviewerPhoto')

	// POR-9738: each credential's cardLabel over its bare abbreviation, joined with ', ' (labels are not trimmed).
	const labels: string[] = []
	if (Array.isArray(expert.credentials)) {
		for (const credential of expert.credentials) {
			const cr = rec(credential)
			const label = asText(isPresent(cr.cardLabel) ? cr.cardLabel : cr.abbreviation)
			if (!isBlank(label)) labels.push(label)
		}
	}

	const hasCue = isPresent(expert.compensationCue)
	const { style, fg } = readerTokens(def)
	return {
		content,
		expert,
		disp,
		def,
		certId: asText(input.certId),
		ename: textOr(expert.displayName),
		showPhoto,
		creds: labels.join(', '),
		hasCue,
		illus: input.illustrative === true && !hasCue,
		noMemo: isBlank(content.memo),
		purl: cleaned(safeUrl(expert.profileUrl)),
		vurl: cleaned(safeUrl(content.verifyUrl)),
		style,
		fg,
	}
}

/** The `<section>` open tag every reader section shares. `badge` is the `.certrev-badge` hook the revalidation reads. */
function sectionOpen(f: Facts, badge: boolean, aria: string): string {
	const cls = badge ? 'certrev-reader certrev-badge' : 'certrev-reader'
	// `{% if rd %}`: any def that is not nil/false stamps its version.
	const version = isTruthy(f.def) ? ` data-certrev-def-version="${esc(rec(f.def).v)}"` : ''
	return (
		`<section class="${cls}" style="${f.style}"${version} data-certrev-strings-version="${CERT_STRINGS_VERSION}" ` +
		`data-certrev-cert-id="${esc(f.certId)}" aria-label="${esc(aria)}">`
	)
}

const anchor = (href: string, modal: string, label: string): string =>
	`<a href="${esc(href)}" target="_blank" rel="${CERTREV_LINK_REL}" data-certrev-modal-open${modal}>${label}</a>`

/**
 * The words the memo-less banner and the memo link row use for the profile link: the demo's three leaves ("View", the
 * first name, "’s profile"), set apart by the `<!-- -->` React paints between adjacent text expressions. With no first
 * name the wording stays one leaf.
 */
function profileLabel(f: Facts): string {
	const first = cleaned(firstName(f.ename))
	return first !== '' ? `View <!-- -->${esc(first)}<!-- -->&rsquo;s profile` : 'View profile'
}

const credentialAria = (f: Facts): string => `Content reviewed by ${f.ename}${f.creds !== '' ? `, ${f.creds}` : ''}`

/**
 * The compensation cue's slot at the head of the scope line (memo footer, sidebar). The separator is followed by an
 * empty `<!-- -->`, as React's server render puts between the demo's two adjacent text children: the element's DOM
 * holds " · " and the sentence as two text nodes. The comment is not text, so the `data-ftc-line` element still
 * reads `{cue} · {sentence}`. With no cue there is no separator and no comment.
 */
function scopeLead(f: Facts): string {
	if (f.hasCue) return `<em>${COMPENSATED_EXPERT_CUE}</em> · <!-- -->`
	if (f.illus) return '<em>Illustrative example</em> · <!-- -->'
	return ''
}

/**
 * The scope sentence is DIRECT text of the scope element (the demo's `<span class="dg-scope">`), which carries the
 * `data-ftc-line` marker itself: no inner span, so the element's `.certrev-r-scope em` cue and the sentence are leaves of
 * one element, as the demo paints them. The marker is on exactly one element per render, as before.
 */
const SCOPE = CERT_SCOPE_LINE

/**
 * The muted credential line, empty when the reviewer has no displayed credential (so no "verified" claim prints).
 *
 * The banner's is the demo's three leaves in one `<em>`: the credential, " · ", and the attribution, which reads
 * "Credential verified by CertREV on {date}" or, with no date, just "Credential verified by CertREV". The spans carry
 * no style of their own. The sidebar names the credential in its bold line already, so its `<em>` is the attribution
 * alone.
 */
function verifiedLine(f: Facts, withCredentials: boolean): string {
	if (f.creds === '') return ''
	const date = cleaned(isBlank(f.expert.credentialVerifiedAt) ? '' : longDate(f.expert.credentialVerifiedAt))
	const on = date !== '' ? ` on ${esc(date)}` : ''
	if (!withCredentials) return `<em>Credential verified by CertREV${on}</em>`
	return `<em><span>${esc(f.creds)}</span> · <span>Credential verified by CertREV${on}</span></em>`
}

// ─────────────────────────────────────────────────────────────────────────────
// Banner: the "Expert reviewed & certified" card, and the expert memo card beneath it
// ─────────────────────────────────────────────────────────────────────────────

function bannerCard(f: Facts): string {
	if (f.ename === '') return ''
	const author = rec(f.content.author)
	const authorName = textOr(author.name)
	const authorTitle = textOr(author.title)
	const hasAuthor = f.disp.showAuthor !== false && authorName !== '' && authorName !== f.ename
	const avatar = (photo: unknown, name: string, size: 'sm' | ''): string =>
		readerFace({ photo, show: f.showPhoto, name, size, width: 84 })

	const authorBy = hasAuthor
		? `<div class="certrev-r-by">${avatar(author.photoUrl, authorName, 'sm')}<div>\n              <b>${esc(authorName)}</b>` +
			`${authorTitle !== '' ? `<em>${esc(authorTitle)}</em>` : ''}<span class="certrev-r-role">Written by</span>\n            </div>\n          </div>`
		: ''
	const expertBy =
		`<div class="certrev-r-by">${avatar(f.expert.photoUrl, f.ename, '')}<div>\n            <b>${esc(f.ename)}</b>` +
		`${verifiedLine(f, true)}<span class="certrev-r-role on">Reviewed by</span>\n          </div>\n        </div>`

	const certifiedAt = f.content.certifiedAt
	const certified = isBlank(certifiedAt) ? '' : cleaned(longDate(certifiedAt))

	// A memo-less article gets the profile and certificate row, so the certificate stays reachable.
	let links = ''
	if (f.noMemo && (f.purl !== '' || f.vurl !== '')) {
		links =
			'<div class="certrev-r-links">' +
			(f.purl !== '' ? anchor(f.purl, '="expert"', profileLabel(f)) : '') +
			(f.vurl !== '' ? anchor(f.vurl, '', 'View certificate') : '') +
			'</div>'
	}

	const hasFoot = certified !== '' || f.hasCue || f.illus
	const rule = hasFoot || f.noMemo ? '<div class="certrev-r-rule"></div>' : ''

	let foot = ''
	if (hasFoot) {
		// The demo's `<span><em>Certified</em>{date}</span>`: the date is direct text of the span (no `<time>`), so the
		// span paints the mono cue and the date's own face.
		const when = certified !== '' ? `<span><em>Certified</em>${esc(certified)}</span>` : '<span></span>'
		let cue = ''
		if (f.hasCue) {
			// The locked cue in plain words, as the demo's foot (judge round 6, E1): no link, so nothing underlines
			// "expert"; the reviewer's profile is the card's or the memo's "View … profile" link.
			cue = `<span>${COMPENSATED_EXPERT_CUE}</span>`
		} else if (f.illus) {
			cue = '<span>Illustrative example</span>'
		}
		foot = `<div class="certrev-r-foot">${when}${cue}</div>`
	}

	// POR-9317: the memo card carries the scope line when there is a memo; with none this card is the sole claim face.
	const scope = f.noMemo ? `<div class="certrev-r-scope" data-ftc-disclosure data-ftc-line>${SCOPE}</div>` : ''

	return (
		`${sectionOpen(f, true, credentialAria(f))}\n  <div class="certrev-r-card">\n` +
		`    <div class="certrev-r-cap">${readerLogo(f.fg === '#ffffff' ? 'white' : 'mono', 18, 'CertREV')}Expert reviewed &amp; certified</div>\n` +
		`    <div class="certrev-r-cap-body">\n      <div class="certrev-r-bys${hasAuthor ? '' : ' solo'}">${authorBy}${expertBy}\n      </div>` +
		`${links}${rule}${foot}${scope}</div>\n  </div>\n</section>`
	)
}

function bannerMemo(f: Facts): string {
	if (f.ename === '' || isBlank(f.content.memo)) return ''
	const links =
		f.purl !== '' || f.vurl !== ''
			? '<div class="certrev-r-links">' +
				(f.purl !== '' ? anchor(f.purl, '="expert"', profileLabel(f)) : '') +
				(f.vurl !== '' ? anchor(f.vurl, '', 'View certificate') : '') +
				'</div>'
			: ''
	const avatar = readerFace({ photo: f.expert.photoUrl, show: f.showPhoto, name: f.ename, size: 'lg', width: 112 })
	return (
		`${sectionOpen(f, false, `Expert memo by ${f.ename}`)}\n  <div class="certrev-r-card pad">\n` +
		'    <div class="certrev-r-kick">Expert memo</div>\n' +
		`    <div class="certrev-r-memo">${avatar}<div>\n` +
		`        <div class="certrev-r-memo-name"><b>${esc(f.ename)}</b>${f.creds !== '' ? `, <!-- -->${esc(f.creds)}` : ''}</div>\n` +
		`        <blockquote>${esc(f.content.memo)}</blockquote>${links}</div>\n    </div>\n` +
		'    <div class="certrev-r-rule"></div>\n    <div class="certrev-r-vfoot">\n' +
		`      <span class="certrev-r-verified">${readerLogo('mono', 17, '')}Verified by <b>CertREV</b></span>\n` +
		`      <span class="certrev-r-scope" data-ftc-disclosure data-ftc-line>${scopeLead(f)}${SCOPE}</span>\n    </div>\n  </div>\n</section>`
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar and floating pill
// ─────────────────────────────────────────────────────────────────────────────

function sidebar(f: Facts): string {
	if (f.ename === '') return ''
	const bio = f.disp.showBio !== false && !isBlank(f.expert.bio) ? asText(f.expert.bio) : ''
	const avatar = readerFace({ photo: f.expert.photoUrl, show: f.showPhoto, name: f.ename, size: 'lg', width: 112 })
	const both = f.purl !== '' && f.vurl !== ''
	const links =
		f.purl !== '' || f.vurl !== ''
			? `<div class="certrev-r-side-links${both ? '' : ' single'}">` +
				(f.purl !== '' ? anchor(f.purl, '="expert"', 'View Profile') : '') +
				(f.vurl !== '' ? anchor(f.vurl, '', 'View Certificate') : '') +
				'</div>'
			: ''
	return (
		`${sectionOpen(f, true, credentialAria(f))}\n  <div class="certrev-r-side">\n` +
		`    <div class="certrev-r-cap center">${readerLogo(f.fg === '#ffffff' ? 'white' : 'mono', 18, 'CertREV')}Expert reviewed</div>\n` +
		`    <div class="certrev-r-side-body">\n      <div class="certrev-r-by">${avatar}<div>\n` +
		`          <b>${esc(f.ename)}${f.creds !== '' ? `<!-- -->, <!-- -->${esc(f.creds)}` : ''}</b>${verifiedLine(f, false)}</div>\n      </div>` +
		`${bio !== '' ? `<p>${esc(bio)}</p>` : ''}` +
		`${isBlank(f.content.memo) ? '' : `<blockquote>${esc(f.content.memo)}</blockquote>`}` +
		`<div class="certrev-r-scope" data-ftc-disclosure data-ftc-line>${scopeLead(f)}${SCOPE}</div>\n    </div>` +
		`${links}</div>\n</section>`
	)
}

function pill(f: Facts): string {
	if (f.vurl === '') return ''
	const profile = f.purl !== '' ? `${anchor(f.purl, '="expert"', 'Profile')}<i aria-hidden="true">·</i>` : ''
	return (
		`${sectionOpen(f, true, 'Expert reviewed')}\n  <div class="certrev-r-pill">\n    <span>Expert reviewed:</span>` +
		`${profile}${anchor(f.vurl, '', 'Certificate')}\n  </div>\n</section>`
	)
}

/**
 * The reader face's HTML for one layout. '' where the face paints nothing (no reviewer name; a pill with no safe
 * verify URL; a banner `part` that has no block): the caller treats '' as "render nothing", never as an empty section.
 *
 * A def with no `layout` meaning here (`custom`, or any value that is not banner, sidebar or floating) is the
 * caller's to resolve before it calls: this takes the layout it will paint.
 */
export function renderReaderFace(input: ReaderFaceInput): string {
	const f = readFacts(input)
	if (input.layout === 'sidebar') return sidebar(f)
	if (input.layout === 'floating') return pill(f)
	const part = input.part ?? 'full'
	if (part === 'header') return bannerCard(f)
	if (part === 'memo') return bannerMemo(f)
	return [bannerCard(f), bannerMemo(f)].filter((block) => block !== '').join('\n')
}
