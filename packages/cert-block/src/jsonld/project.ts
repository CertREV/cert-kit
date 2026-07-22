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
 *   A brand page usually already emits an `Article` (or `BlogPosting`) graph — Yoast on
 *   WordPress, the theme on Shopify, the framework on headless. If we emit a SECOND
 *   top-level `Article`, crawlers see two competing primary entities. Instead we emit a
 *   `@graph` whose Article node carries the SAME `@id` the page's primary article uses
 *   (the page URL + `#article`, the Yoast convention) so a consumer MERGES our
 *   `reviewedBy` / `dateModified` into the existing node by `@id` rather than duplicating
 *   it. Our own nodes (the review, the expert Person, the CertREV org) use CertREV-scoped
 *   `@id`s that cannot clash with the host page's nodes.
 *
 * The Person we attach is the reviewing EXPERT (schema.org `reviewedBy`), which is the
 * E-E-A-T signal CertREV exists to add — not the author. The author (content byline) is
 * attached as `author` only when present + distinct.
 */

import type { CertContent, CertPayload } from '../contract/kernel.js'

/** A JSON-LD node/graph value. Loose by design — this is wire JSON, not a TS model. */
export type JsonLdValue = Record<string, unknown>

export interface ProjectJsonLdOptions {
	/**
	 * The canonical page URL the article renders on. Used to derive the primary
	 * Article node `@id` (`${pageUrl}#article`) so we merge into the host page's graph
	 * instead of colliding. When omitted, the first `subject.canonicalUrls` entry is
	 * used; when there is none either, a CertREV-scoped article `@id` is derived from
	 * `verifyUrl` (still mergeable, just not aligned to a host node).
	 */
	readonly pageUrl?: string
	/**
	 * When true (default), emit the wrapping `{ "@context": "...", "@graph": [...] }`.
	 * When false, return just the array of nodes — for a caller that merges them into an
	 * existing `@graph` it already owns.
	 */
	readonly wrapGraph?: boolean
}

const SCHEMA_CONTEXT = 'https://schema.org'

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

/** Derive the primary Article `@id`, aligned to the Yoast/host convention when we can. */
function articleId(payload: CertPayload, opts: ProjectJsonLdOptions): string {
	const page = opts.pageUrl ?? payload.subject.canonicalUrls[0]
	if (page) return `${baseUrl(page)}#article`
	// No page URL known — derive a stable, mergeable id from the verify URL.
	return `${baseUrl(payload.content.verifyUrl)}#article`
}

/** CertREV-scoped node ids — namespaced under the verify URL so they never clash. */
function reviewId(content: CertContent): string {
	return `${content.verifyUrl}#certrev-review`
}
function expertId(content: CertContent): string {
	return content.expert.profileUrl ? `${content.expert.profileUrl}#person` : `${content.verifyUrl}#expert`
}
function orgId(content: CertContent): string {
	// One stable CertREV organization node across all pages: derive from the verify
	// URL origin so it dedupes cleanly when a page hosts multiple certified articles.
	try {
		return `${new URL(content.verifyUrl).origin}/#certrev-organization`
	} catch {
		return 'https://certrev.com/#certrev-organization'
	}
}

/** Build the reviewing-expert Person node (the E-E-A-T signal). */
function expertPersonNode(payload: CertPayload): JsonLdValue {
	const { expert } = payload.content
	const node: JsonLdValue = {
		'@type': 'Person',
		'@id': expertId(payload.content),
		name: expert.displayName,
	}
	if (expert.profileUrl) node.url = expert.profileUrl
	if (expert.photoUrl) node.image = expert.photoUrl
	if (expert.credentials.length > 0) {
		// hasCredential → EducationalOccupationalCredential per credential; also a flat
		// honorificSuffix list for consumers that don't read hasCredential.
		node.hasCredential = expert.credentials.map((c) => ({
			'@type': 'EducationalOccupationalCredential',
			name: c.fullName,
			alternateName: c.abbreviation,
		}))
		node.honorificSuffix = expert.credentials.map((c) => c.abbreviation).join(', ')
	}
	return node
}

/** Build the CertREV organization node (publisher of the review credential). */
function certRevOrgNode(payload: CertPayload): JsonLdValue {
	let url = 'https://certrev.com'
	try {
		url = new URL(payload.content.verifyUrl).origin
	} catch {
		/* keep default */
	}
	return {
		'@type': 'Organization',
		'@id': orgId(payload.content),
		name: 'CertREV',
		url,
	}
}

/** Build the Review node binding the article to its expert review. */
function reviewNode(payload: CertPayload): JsonLdValue {
	const node: JsonLdValue = {
		'@type': 'Review',
		'@id': reviewId(payload.content),
		itemReviewed: { '@id': articleId(payload, {}) },
		author: { '@id': expertId(payload.content) },
		publisher: { '@id': orgId(payload.content) },
		datePublished: payload.content.certifiedAt,
		url: payload.content.verifyUrl,
	}
	if (payload.content.memo) node.reviewBody = payload.content.memo
	return node
}

/**
 * The primary Article node — carries the SAME `@id` the host page's article uses so a
 * consumer merges our `reviewedBy` / `dateModified` into the existing node rather than
 * duplicating the primary entity. We deliberately emit ONLY the certification-relevant
 * properties (reviewedBy, dateModified, plus author when distinct) — not headline, body,
 * image, etc. — so we never overwrite the host's richer Article fields on merge.
 */
function articleNode(payload: CertPayload, opts: ProjectJsonLdOptions): JsonLdValue {
	const { content } = payload
	const node: JsonLdValue = {
		'@type': 'Article',
		'@id': articleId(payload, opts),
		reviewedBy: { '@id': expertId(content) },
		review: { '@id': reviewId(content) },
	}
	if (content.contentModifiedAt) node.dateModified = content.contentModifiedAt
	// Author only when present + distinct from the expert (don't double-attribute).
	if (content.author.name && content.author.name !== content.expert.displayName) {
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
 * @param opts     Page URL for @id alignment + graph-wrapping control.
 * @returns        A `{ "@context", "@graph" }` object (wrapGraph !== false) OR a bare
 *                 array of nodes (wrapGraph === false) for merge-into-existing-graph callers.
 */
export function projectCertJsonLd(payload: CertPayload, opts: ProjectJsonLdOptions = {}): JsonLdValue | JsonLdValue[] {
	const nodes: JsonLdValue[] = [
		articleNode(payload, opts),
		reviewNode(payload),
		expertPersonNode(payload),
		certRevOrgNode(payload),
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
