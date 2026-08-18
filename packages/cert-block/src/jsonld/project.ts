/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Deterministic JSON-LD projector — facts → schema.org graph (mergeable by @id)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * INVARIANT #1 of the contract: the JSON-LD is PROJECTED from `payload.content` facts
 * at render time, never stored in (or signed into) the envelope. This is that projector.
 * It is DETERMINISTIC — same facts in → byte-identical graph out — so two edges (and a
 * server pre-render) produce the same structured data, and a snapshot diff is meaningful.
 *
 * DESIGN GOAL: MERGE, don't collide.
 *   A brand page usually already emits a `WebPage` + `Article` (or `BlogPosting`) graph —
 *   Yoast on WordPress, the theme on Shopify, the framework on headless. If we emit a
 *   SECOND top-level `Article`, crawlers see two competing primary entities. Instead we
 *   emit a `@graph` whose WebPage / Article nodes carry the SAME `@id`s the page's own
 *   nodes use (the unmodified canonical URL for the page, the page URL + `#article` for
 *   the article — the Yoast convention) so a consumer MERGES our `reviewedBy` /
 *   `lastReviewed` / `dateModified` into the existing nodes by `@id` rather than
 *   duplicating them. Our own nodes are keyed to the CERTIFICATION instead (the verify
 *   URL, the expert's profile, the fixed CertREV organization id) — never under the host
 *   page's `@id` namespace — so they cannot clash with the host page's nodes.
 *
 * The Person we attach is the reviewing EXPERT (schema.org `reviewedBy`), which is the
 * E-E-A-T signal CertREV exists to add — not the author. The author (content byline) is
 * attached as `author` only when present + distinct.
 *
 * VISIBILITY: "Don't mark up content that is not visible to readers" (Google's
 * structured-data guidelines) is a HARD rule here, not a nicety. Every field on this
 * graph that mirrors something the card paints behind a visibility flag — the memo, the
 * author byline, the reviewer photo — is gated by the SAME `resolveDisplay` the card
 * uses (which folds in the render-def's subtractive hide-set), so the graph can never
 * assert to a crawler what the reader cannot see. Re-deriving those flags here instead
 * of importing the card's resolver is exactly how the two would silently drift.
 */

import { type ResolvedDisplay, resolveDisplay } from '../components/format.js'
import type { CertRenderDef } from '../components/render-def.js'
import type { CertPayload } from '../contract/kernel.js'

/** A JSON-LD node/graph value. Loose by design — this is wire JSON, not a TS model. */
export type JsonLdValue = Record<string, unknown>

export interface ProjectJsonLdOptions {
	/**
	 * The canonical page URL the article renders on. Used to derive the primary
	 * WebPage / Article node `@id`s (`${pageUrl}` and `${pageUrl}#article`) so we merge
	 * into the host page's graph instead of colliding. When omitted, the first
	 * `subject.canonicalUrls` entry is used; when there is none either, the WebPage node
	 * is DROPPED and a CertREV-scoped article `@id` is derived from `verifyUrl` (still
	 * mergeable, just not aligned to a host node).
	 */
	readonly pageUrl?: string
	/**
	 * The brand render-def in force for THIS face. Read for its SUBTRACTIVE hide-set only
	 * (its theming half means nothing to structured data): a brand that hides the memo or
	 * the reviewer photo on the card must not have it published in the graph either.
	 */
	readonly renderDef?: CertRenderDef
	/**
	 * When true (default), emit the wrapping `{ "@context": "...", "@graph": [...] }`.
	 * When false, return just the array of nodes — for a caller that merges them into an
	 * existing `@graph` it already owns.
	 */
	readonly wrapGraph?: boolean
}

const SCHEMA_CONTEXT = 'https://schema.org'

/**
 * THE CertREV organization node `@id` — a hard CONSTANT, not a per-payload derivation.
 *
 * It used to be `${new URL(verifyUrl).origin}/#certrev-organization` under a comment
 * claiming "one stable CertREV organization node across all pages", which it was not: a
 * cert served from a second verify origin (a staging/preview host, a vanity verify
 * domain, a future regional origin) minted a SECOND CertREV org node that would never
 * merge with the first. CertREV is ONE real-world organization; its node id must not
 * move because of which host happened to serve a verify link. Portal must emit this
 * exact literal for the two halves to merge — see the package README.
 */
export const CERTREV_ORGANIZATION_ID = 'https://certrev.com/#certrev-organization'

/** CertREV's canonical homepage — the `url` of the organization node above, same reasoning. */
export const CERTREV_ORGANIZATION_URL = 'https://certrev.com'

/**
 * Strip the query AND fragment from a URL for a stable, mergeable @id. The Yoast / host
 * convention keys the primary Article node on `{path}#article` with no query — so a page
 * reached with a `?utm=…` tracking param must derive the SAME `@id` as the canonical URL,
 * else our `reviewedBy` lands on a sibling node instead of merging into the host's Article.
 */
function baseUrl(url: string): string {
	const cut = Math.min(...[url.indexOf('#'), url.indexOf('?')].filter((i) => i !== -1), url.length)
	return url.slice(0, cut)
}

/**
 * The page this face renders on — the caller's `pageUrl` first (it knows the actual
 * request), else the payload's primary canonical. Null when neither is known, which is
 * the ONLY honest answer: we then assert nothing about any page.
 */
function pageBaseUrl(payload: CertPayload, opts: ProjectJsonLdOptions): string | null {
	const page = opts.pageUrl ?? payload.subject.canonicalUrls[0]
	return page ? baseUrl(page) : null
}

/** Derive the primary Article `@id`, aligned to the Yoast/host convention when we can. */
function articleId(payload: CertPayload, opts: ProjectJsonLdOptions): string {
	const page = pageBaseUrl(payload, opts)
	if (page) return `${page}#article`
	// No page URL known — derive a stable, mergeable id from the verify URL.
	return `${baseUrl(payload.content.verifyUrl)}#article`
}

/** CertREV-scoped node ids — namespaced under the certification, so they never clash. */
function reviewId(payload: CertPayload): string {
	return `${payload.content.verifyUrl}#certrev-review`
}
function expertId(payload: CertPayload): string {
	const { expert, verifyUrl } = payload.content
	return expert.profileUrl ? `${expert.profileUrl}#person` : `${verifyUrl}#expert`
}

/**
 * The `YYYY-MM-DD` head of an ISO-8601 instant, or null. `lastReviewed`'s schema.org
 * range is `Date` — not `DateTime` — so the certified instant is truncated to its
 * calendar day. String-sliced rather than `Date`-parsed on purpose: parsing would
 * re-render the day in the runtime's timezone and break the determinism invariant
 * (server and edge could disagree by a day).
 */
function isoDate(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const match = /^\d{4}-\d{2}-\d{2}/.exec(value)
	return match ? match[0] : null
}

/** Build the reviewing-expert Person node (the E-E-A-T signal). */
function expertPersonNode(payload: CertPayload, display: ResolvedDisplay): JsonLdValue {
	const { expert } = payload.content
	const node: JsonLdValue = {
		'@type': 'Person',
		'@id': expertId(payload),
		name: expert.displayName,
	}
	if (expert.profileUrl) node.url = expert.profileUrl
	// The photo is a brand-toggleable (`free`) field: a face that hides the reviewer photo
	// must not publish one either. `showExpertPhoto` already folds in the render-def's
	// `reviewerPhoto` hide-set. Deliberately NOT gated on `badgeStyle` — a compact card
	// omits the photo as a LAYOUT choice, and the same payload may render full elsewhere on
	// the page, so keying the graph to it would make the projection slot-dependent.
	if (display.showExpertPhoto && expert.photoUrl) node.image = expert.photoUrl
	if (expert.credentials.length > 0) {
		// hasCredential → EducationalOccupationalCredential per credential; also a flat
		// honorificSuffix list for consumers that don't read hasCredential. `recognizedBy`
		// (a Credential property whose expected type is Organization) names CertREV as the
		// body that verified it — the structured-data form of the face's locked
		// "Credential verified by CertREV" attribution, and what the reviewedby-schema
		// validator looks for.
		node.hasCredential = expert.credentials.map((c) => ({
			'@type': 'EducationalOccupationalCredential',
			name: c.fullName,
			alternateName: c.abbreviation,
			recognizedBy: { '@id': CERTREV_ORGANIZATION_ID },
		}))
		node.honorificSuffix = expert.credentials.map((c) => c.abbreviation).join(', ')
	}
	return node
}

/** Build the CertREV organization node (publisher of the review credential). */
function certRevOrgNode(): JsonLdValue {
	return {
		'@type': 'Organization',
		'@id': CERTREV_ORGANIZATION_ID,
		name: 'CertREV',
		url: CERTREV_ORGANIZATION_URL,
	}
}

/** Build the Review node binding the article to its expert review. */
function reviewNode(payload: CertPayload, opts: ProjectJsonLdOptions, display: ResolvedDisplay): JsonLdValue {
	const node: JsonLdValue = {
		'@type': 'Review',
		'@id': reviewId(payload),
		// The SAME opts the Article node is built from. Passing `{}` here (as this did)
		// pointed `itemReviewed` at the payload's canonical while the Article node carried
		// the caller's `pageUrl` — an orphaned reference on every page whose URL differs
		// from `canonicalUrls[0]` (locale prefix, `www`, trailing slash, a syndicated copy).
		itemReviewed: { '@id': articleId(payload, opts) },
		author: { '@id': expertId(payload) },
		publisher: { '@id': CERTREV_ORGANIZATION_ID },
		datePublished: payload.content.certifiedAt,
		url: payload.content.verifyUrl,
	}
	// The memo is the one piece of REVIEW PROSE on the face, and it is brand-toggleable.
	// Publishing `reviewBody` off a hidden memo marks up text no reader can see.
	if (display.showMemo && payload.content.memo) node.reviewBody = payload.content.memo
	return node
}

/**
 * The host page node — where `lastReviewed` and `reviewedBy` actually belong: BOTH are
 * schema.org `WebPage` properties (`lastReviewed`: "Date on which the content on this web
 * page was last reviewed for accuracy and/or completeness", range `Date`; `reviewedBy`:
 * "People or organizations that have reviewed the content on this web page", range
 * `Organization`/`Person`). Keyed on the UNMODIFIED canonical URL, the Yoast WebPage
 * convention, so this merges into the host's existing WebPage node instead of adding a
 * competing one — and, like the Article node, it carries ONLY the certification-relevant
 * properties so a merge never overwrites the host's richer page fields.
 *
 * Returns null when no page URL is known: `lastReviewed` on a page we cannot name would
 * either be a dangling node or — worse — an assertion about the CertREV verify page,
 * which is not the reviewed content.
 */
function webPageNode(payload: CertPayload, opts: ProjectJsonLdOptions): JsonLdValue | null {
	const id = pageBaseUrl(payload, opts)
	if (!id) return null
	const lastReviewed = isoDate(payload.content.certifiedAt)
	return {
		'@type': 'WebPage',
		'@id': id,
		url: id,
		...(lastReviewed ? { lastReviewed } : {}),
		reviewedBy: { '@id': expertId(payload) },
	}
}

/**
 * The primary Article node — carries the SAME `@id` the host page's article uses so a
 * consumer merges our `reviewedBy` / `dateModified` into the existing node rather than
 * duplicating the primary entity. We deliberately emit ONLY the certification-relevant
 * properties (reviewedBy, dateModified, plus author when distinct AND shown) — not
 * headline, body, image, etc. — so we never overwrite the host's richer Article fields
 * on merge.
 */
function articleNode(payload: CertPayload, opts: ProjectJsonLdOptions, display: ResolvedDisplay): JsonLdValue {
	const { content } = payload
	const node: JsonLdValue = {
		'@type': 'Article',
		'@id': articleId(payload, opts),
		reviewedBy: { '@id': expertId(payload) },
		review: { '@id': reviewId(payload) },
	}
	if (content.contentModifiedAt) node.dateModified = content.contentModifiedAt
	// Author only when the face SHOWS the byline (a `free`, brand-toggleable field) and it
	// is present + distinct from the expert (don't double-attribute).
	if (display.showAuthor && content.author.name && content.author.name !== content.expert.displayName) {
		const author: JsonLdValue = { '@type': 'Person', name: content.author.name }
		if (content.author.title) author.jobTitle = content.author.title
		node.author = author
	}
	return node
}

/**
 * Project the verified certification facts into a schema.org `@graph`.
 *
 * @param payload  The cryptographically-verified payload (the same facts the badge renders).
 * @param opts     Page URL for @id alignment, the render-def whose hide-set gates
 *                 visibility-bound fields, + graph-wrapping control.
 * @returns        A `{ "@context", "@graph" }` object (wrapGraph !== false) OR a bare
 *                 array of nodes (wrapGraph === false) for merge-into-existing-graph callers.
 */
export function projectCertJsonLd(payload: CertPayload, opts: ProjectJsonLdOptions = {}): JsonLdValue | JsonLdValue[] {
	// ONE resolution of the visibility flags, shared by every node — the same resolver
	// (and therefore the same answer) the rendered card uses. No accent override: theming
	// is meaningless to structured data.
	const display = resolveDisplay(payload.content.display, undefined, opts.renderDef)
	const page = webPageNode(payload, opts)
	const nodes: JsonLdValue[] = [
		...(page ? [page] : []),
		articleNode(payload, opts, display),
		reviewNode(payload, opts, display),
		expertPersonNode(payload, display),
		certRevOrgNode(),
	]
	if (opts.wrapGraph === false) return nodes
	return { '@context': SCHEMA_CONTEXT, '@graph': nodes }
}

/**
 * Serialize the projected graph to the exact JSON string that goes inside a
 * `<script type="application/ld+json">`. We use `JSON.stringify` with no extra
 * whitespace for a compact, deterministic body. The string is then made safe to embed
 * by `serializeJsonLdForScript` (which neutralizes `</script>`).
 */
export function projectCertJsonLdString(payload: CertPayload, opts: ProjectJsonLdOptions = {}): string {
	return serializeJsonLdForScript(projectCertJsonLd(payload, opts))
}

/**
 * Serialize an arbitrary JSON-LD value for safe inclusion inside a `<script>` element.
 * Inside `application/ld+json`, two HTML sequences can break out of the tag: `</script>`
 * (closes the element early) and HTML-comment markers `<!--` / `-->` (some parsers treat
 * a comment opened inside a script as suspending script-data parsing). A memo or name
 * containing either is attacker-influenced text, so we neutralize BOTH angle brackets to
 * their `\uXXXX` form. This is valid JSON that parses back to the identical string — the
 * structured data is unchanged, but no `<…>`/`-->` sequence can terminate the script.
 * Standard Next.js / Yoast hardening.
 */
export function serializeJsonLdForScript(value: unknown): string {
	return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
}
