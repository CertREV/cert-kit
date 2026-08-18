import { describe, expect, it } from 'vitest'
import { makeMockPayload } from '../contract/fixtures.js'
import type { CertPayload } from '../contract/kernel.js'
import {
	CERTREV_ORGANIZATION_ID,
	type JsonLdValue,
	type ProjectJsonLdOptions,
	projectCertJsonLd,
	projectCertJsonLdString,
	serializeJsonLdForScript,
} from '../jsonld/project.js'

function graphOf(value: JsonLdValue | JsonLdValue[]): JsonLdValue[] {
	if (Array.isArray(value)) return value
	return value['@graph'] as JsonLdValue[]
}
function nodeOfType(value: JsonLdValue | JsonLdValue[], type: string): JsonLdValue {
	const n = graphOf(value).find((x) => x['@type'] === type)
	if (!n) throw new Error(`no ${type} node`)
	return n
}
function maybeNodeOfType(value: JsonLdValue | JsonLdValue[], type: string): JsonLdValue | undefined {
	return graphOf(value).find((x) => x['@type'] === type)
}

/** Build a payload with a patched `content` (the fixture's content is deeply frozen by convention). */
function withContent(patch: Partial<CertPayload['content']>): CertPayload {
	const base = makeMockPayload()
	return makeMockPayload({ content: { ...base.content, ...patch } })
}
/** Build a payload with a patched `content.display` (the deprecated-but-honoured display block). */
function withDisplay(patch: Record<string, unknown>): CertPayload {
	const base = makeMockPayload()
	return withContent({ display: { ...base.content.display, ...patch } })
}

/**
 * GRAPH INTEGRITY — every `{'@id': …}` REFERENCE in the output must resolve to a node
 * that is actually present in the same graph. This is the check that catches the next
 * orphan: a node id typo, a reference built from different options than the node it
 * points at (the `articleId(payload, {})` bug), or a node dropped by a visibility gate
 * while something still points at it. Returns the unresolved references.
 *
 * A top-level graph node DEFINES an `@id`; anything nested that carries one is a
 * reference (`{'@id': …}` bare, or a typed inline ref) and must resolve.
 */
function danglingReferences(value: JsonLdValue | JsonLdValue[]): string[] {
	const nodes = graphOf(value)
	const defined = new Set(nodes.map((n) => String(n['@id'])))
	const dangling: string[] = []
	const walk = (v: unknown, isTopLevelNode: boolean): void => {
		if (Array.isArray(v)) {
			for (const item of v) walk(item, false)
			return
		}
		if (typeof v !== 'object' || v === null) return
		const obj = v as Record<string, unknown>
		if (!isTopLevelNode && typeof obj['@id'] === 'string' && !defined.has(obj['@id'])) dangling.push(obj['@id'])
		for (const [key, child] of Object.entries(obj)) {
			if (key === '@id') continue
			walk(child, false)
		}
	}
	for (const node of nodes) walk(node, true)
	return dangling
}

describe('projectCertJsonLd', () => {
	it('emits a wrapped @graph with WebPage, Article, Review, Person(expert), Organization', () => {
		const g = projectCertJsonLd(makeMockPayload())
		expect(Array.isArray(g)).toBe(false)
		const graph = graphOf(g)
		const types = graph.map((n) => n['@type']).sort()
		expect(types).toEqual(['Article', 'Organization', 'Person', 'Review', 'WebPage'])
		expect((g as JsonLdValue)['@context']).toBe('https://schema.org')
	})

	it('Article @id aligns to the page URL (#article) so it MERGES into the host/Yoast node', () => {
		const g = projectCertJsonLd(makeMockPayload(), {
			pageUrl: 'https://brand.example.com/blogs/skincare/retinol-guide?utm=x',
		})
		const article = nodeOfType(g, 'Article')
		// Fragment + query stripped, #article appended — the Yoast convention.
		expect(article['@id']).toBe('https://brand.example.com/blogs/skincare/retinol-guide#article')
	})

	it('falls back to subject.canonicalUrls[0] for the Article @id when no pageUrl given', () => {
		const article = nodeOfType(projectCertJsonLd(makeMockPayload()), 'Article')
		expect(article['@id']).toBe('https://brand.example.com/blogs/skincare/retinol-guide#article')
	})

	it('attaches the EXPERT as reviewedBy (the E-E-A-T signal), not as author', () => {
		const g = projectCertJsonLd(makeMockPayload())
		const article = nodeOfType(g, 'Article')
		const person = nodeOfType(g, 'Person')
		expect(person.name).toBe('Dr. Jane Doe')
		expect((article.reviewedBy as JsonLdValue)['@id']).toBe(person['@id'])
		// Distinct author present + attached separately.
		expect((article.author as JsonLdValue).name).toBe('Sam Writer')
	})

	it('projects credentials as hasCredential + honorificSuffix', () => {
		const person = nodeOfType(projectCertJsonLd(makeMockPayload()), 'Person')
		expect(person.honorificSuffix).toBe('MD, FAAD')
		expect((person.hasCredential as JsonLdValue[]).map((c) => c.alternateName)).toEqual(['MD', 'FAAD'])
	})

	it('Review node binds itemReviewed→Article, author→expert, publisher→CertREV org', () => {
		const g = projectCertJsonLd(makeMockPayload())
		const review = nodeOfType(g, 'Review')
		const article = nodeOfType(g, 'Article')
		const person = nodeOfType(g, 'Person')
		const org = nodeOfType(g, 'Organization')
		expect((review.itemReviewed as JsonLdValue)['@id']).toBe(article['@id'])
		expect((review.author as JsonLdValue)['@id']).toBe(person['@id'])
		expect((review.publisher as JsonLdValue)['@id']).toBe(org['@id'])
		expect(review.reviewBody).toContain('retinol claims')
	})

	/**
	 * P2-1 — the Review used to build `itemReviewed` from `articleId(payload, {})`, dropping
	 * the caller's opts, so ANY caller-supplied `pageUrl` that differed from the payload's
	 * canonical (locale prefix, `www`, trailing slash, a plain third-party embed) pointed the
	 * Review at an `@id` no node in the graph carried. The guard above never passed a
	 * `pageUrl`, so it passed against a projector that ignored `opts` entirely.
	 */
	it('Review itemReviewed follows the CALLER pageUrl, not just the payload canonical', () => {
		const g = projectCertJsonLd(makeMockPayload(), { pageUrl: 'https://brand.example.com/fr/blogs/skincare/retinol' })
		const review = nodeOfType(g, 'Review')
		const article = nodeOfType(g, 'Article')
		expect(article['@id']).toBe('https://brand.example.com/fr/blogs/skincare/retinol#article')
		expect((review.itemReviewed as JsonLdValue)['@id']).toBe(article['@id'])
	})

	it('CertREV node @ids never collide with the host page nodes, whatever origin the cert is served from', () => {
		// Verify + profile origins deliberately OFF certrev.com — the old test asserted every id
		// started with `https://certrev.com/`, which was a property of the FIXTURE (its verifyUrl
		// and profileUrl both happen to live there), not of the projector.
		const payload = withContent({
			verifyUrl: 'https://verify-staging.certrev.dev/verify/cert_fixture_001',
			expert: { ...makeMockPayload().content.expert, profileUrl: 'https://med.example.edu/faculty/jane-doe' },
		})
		const g = projectCertJsonLd(payload, { pageUrl: 'https://brand.example.com/blogs/skincare/retinol-guide' })
		const hostIds = [nodeOfType(g, 'Article')['@id'], nodeOfType(g, 'WebPage')['@id']]
		const certRevIds = [
			nodeOfType(g, 'Person')['@id'],
			nodeOfType(g, 'Organization')['@id'],
			nodeOfType(g, 'Review')['@id'],
		]
		for (const id of certRevIds) {
			expect(hostIds).not.toContain(id)
			// Nor may a CertREV id sit under the host page's own id namespace (`{page}#…`).
			expect(String(id).startsWith('https://brand.example.com/')).toBe(false)
		}
	})

	it('omits dateModified when contentModifiedAt is null', () => {
		const article = nodeOfType(projectCertJsonLd(withContent({ contentModifiedAt: null })), 'Article')
		expect('dateModified' in article).toBe(false)
	})

	it('does not double-attribute when author === expert', () => {
		const p = makeMockPayload()
		const article = nodeOfType(
			projectCertJsonLd(withContent({ author: { name: p.content.expert.displayName, title: null } })),
			'Article',
		)
		expect('author' in article).toBe(false)
	})

	it('is DETERMINISTIC — same facts → byte-identical serialization', () => {
		const a = projectCertJsonLdString(makeMockPayload(), { pageUrl: 'https://x.com/p' })
		const b = projectCertJsonLdString(makeMockPayload(), { pageUrl: 'https://x.com/p' })
		expect(a).toBe(b)
	})

	it('wrapGraph:false returns the SAME nodes as the wrapped graph, just unwrapped', () => {
		const opts: ProjectJsonLdOptions = { pageUrl: 'https://brand.example.com/blogs/skincare/retinol-guide' }
		const arr = projectCertJsonLd(makeMockPayload(), { ...opts, wrapGraph: false })
		expect(Array.isArray(arr)).toBe(true)
		expect(arr).toEqual(graphOf(projectCertJsonLd(makeMockPayload(), opts)))
	})
})

/**
 * P2-2 — "Don't mark up content that is not visible to readers" (Google structured-data
 * guidelines). Three fields on this graph mirror something the card paints behind a
 * visibility flag; each must be gated by the SAME resolution the card uses
 * (`resolveDisplay`, which also folds in the render-def's subtractive hide-set), or the
 * graph asserts to a crawler what the reader cannot see.
 */
describe('projectCertJsonLd — visibility gating (mark up only what the page shows)', () => {
	it('emits reviewBody / author / image when the display flags are on (the default)', () => {
		const g = projectCertJsonLd(makeMockPayload())
		expect(nodeOfType(g, 'Review').reviewBody).toContain('retinol claims')
		expect(nodeOfType(g, 'Article').author).toBeDefined()
		expect(nodeOfType(g, 'Person').image).toBe('https://cdn.certrev.com/experts/jane-doe.jpg')
	})

	it('omits reviewBody when showMemo is off — the memo is on the wire but not on the page', () => {
		const review = nodeOfType(projectCertJsonLd(withDisplay({ showMemo: false })), 'Review')
		expect('reviewBody' in review).toBe(false)
	})

	it('omits reviewBody when a render-def HIDES the memo (subtractive visibility)', () => {
		const g = projectCertJsonLd(makeMockPayload(), { renderDef: { hidden: ['memo'] } })
		expect('reviewBody' in nodeOfType(g, 'Review')).toBe(false)
	})

	it('omits Article author when showAuthor is off', () => {
		const article = nodeOfType(projectCertJsonLd(withDisplay({ showAuthor: false })), 'Article')
		expect('author' in article).toBe(false)
	})

	it('omits Person image when showExpertPhoto is off', () => {
		const person = nodeOfType(projectCertJsonLd(withDisplay({ showExpertPhoto: false })), 'Person')
		expect('image' in person).toBe(false)
	})

	it('omits Person image when a render-def HIDES the reviewer photo', () => {
		const g = projectCertJsonLd(makeMockPayload(), { renderDef: { hidden: ['reviewerPhoto'] } })
		expect('image' in nodeOfType(g, 'Person')).toBe(false)
	})
})

/**
 * P2-3 — `lastReviewed` and `reviewedBy` are WebPage properties (schema.org: domain
 * WebPage, ranges Date and Organization|Person), and `recognizedBy` is a Credential
 * property whose expected type is Organization. Verified against schema.org v30 before
 * this was written — see the projector's own comments.
 */
describe('projectCertJsonLd — WebPage + credential recognition', () => {
	it('emits a WebPage node carrying lastReviewed (DATE-only) + reviewedBy→expert', () => {
		const g = projectCertJsonLd(makeMockPayload(), {
			pageUrl: 'https://brand.example.com/blogs/skincare/retinol-guide',
		})
		const page = nodeOfType(g, 'WebPage')
		const person = nodeOfType(g, 'Person')
		// Yoast's WebPage piece keys on the UNMODIFIED canonical URL (no fragment) — merge, don't collide.
		expect(page['@id']).toBe('https://brand.example.com/blogs/skincare/retinol-guide')
		expect(page.url).toBe('https://brand.example.com/blogs/skincare/retinol-guide')
		// schema.org range is Date, not DateTime — the certifiedAt instant truncated to its day.
		expect(page.lastReviewed).toBe('2026-06-21')
		expect((page.reviewedBy as JsonLdValue)['@id']).toBe(person['@id'])
	})

	it('omits the WebPage node entirely when no page URL is known (never assert about the verify page)', () => {
		const payload = makeMockPayload({ subject: { ...makeMockPayload().subject, canonicalUrls: [] } })
		const g = projectCertJsonLd(payload)
		expect(maybeNodeOfType(g, 'WebPage')).toBeUndefined()
		expect(danglingReferences(g)).toEqual([])
	})

	it('every credential carries recognizedBy → the CertREV Organization node', () => {
		const g = projectCertJsonLd(makeMockPayload())
		const org = nodeOfType(g, 'Organization')
		const credentials = nodeOfType(g, 'Person').hasCredential as JsonLdValue[]
		expect(credentials).toHaveLength(2)
		for (const c of credentials) {
			expect(c['@type']).toBe('EducationalOccupationalCredential')
			expect((c.recognizedBy as JsonLdValue)['@id']).toBe(org['@id'])
		}
	})
})

/**
 * P2-4 — the Organization node claimed "one stable CertREV organization node across all
 * pages" while deriving its `@id` from the per-payload verify URL's ORIGIN, so a cert
 * served from a second verify origin minted a SECOND CertREV org node that would never
 * merge with the first.
 */
describe('projectCertJsonLd — the CertREV organization is ONE node', () => {
	it('Organization @id + url are identical across payloads with different verify origins', () => {
		const a = projectCertJsonLd(withContent({ verifyUrl: 'https://certrev.com/verify/cert_a' }))
		const b = projectCertJsonLd(withContent({ verifyUrl: 'https://verify.certrev.dev/v/cert_b' }))
		expect(nodeOfType(b, 'Organization')['@id']).toBe(nodeOfType(a, 'Organization')['@id'])
		expect(nodeOfType(b, 'Organization').url).toBe(nodeOfType(a, 'Organization').url)
		expect(nodeOfType(a, 'Organization')['@id']).toBe(CERTREV_ORGANIZATION_ID)
	})

	it('an unparseable verifyUrl cannot move the organization node', () => {
		const g = projectCertJsonLd(withContent({ verifyUrl: 'not a url' }))
		expect(nodeOfType(g, 'Organization')['@id']).toBe(CERTREV_ORGANIZATION_ID)
	})
})

/**
 * The real deliverable of this file: whatever options, flags or missing facts a caller
 * hands the projector, the emitted graph must be CLOSED — no reference points outside it.
 */
describe('projectCertJsonLd — graph integrity (no orphaned references)', () => {
	const cases: ReadonlyArray<readonly [string, CertPayload, ProjectJsonLdOptions]> = [
		['defaults', makeMockPayload(), {}],
		['caller pageUrl differing from the canonical', makeMockPayload(), { pageUrl: 'https://brand.example.com/fr/x' }],
		['pageUrl with query + fragment', makeMockPayload(), { pageUrl: 'https://brand.example.com/x?utm=1#top' }],
		['no canonical urls at all', makeMockPayload({ subject: { ...makeMockPayload().subject, canonicalUrls: [] } }), {}],
		['every display flag off', withDisplay({ showMemo: false, showAuthor: false, showExpertPhoto: false }), {}],
		['render-def hides memo + photo', makeMockPayload(), { renderDef: { hidden: ['memo', 'reviewerPhoto'] } }],
		[
			'no memo, no author, no photo, no profile',
			withContent({
				memo: null,
				author: { name: '', title: null },
				expert: { ...makeMockPayload().content.expert, photoUrl: null, profileUrl: null, credentials: [] },
			}),
			{},
		],
		['unwrapped', makeMockPayload(), { wrapGraph: false }],
	]

	for (const [name, payload, opts] of cases) {
		it(`every @id reference resolves to a node in the graph — ${name}`, () => {
			expect(danglingReferences(projectCertJsonLd(payload, opts))).toEqual([])
		})
	}
})

describe('serializeJsonLdForScript', () => {
	it('neutralizes </script> so the body cannot break out of the <script> tag', () => {
		const evilPayload = withContent({ memo: 'totally safe </script><script>alert(1)</script>' })
		const out = projectCertJsonLdString(evilPayload)
		expect(out).not.toContain('</script>')
		expect(out).toContain('\\u003c/script')
		// Still valid JSON that round-trips to the original string.
		const parsed = JSON.parse(out.replace(/\\u003c/g, '<'))
		const review = (parsed['@graph'] as JsonLdValue[]).find((n) => n['@type'] === 'Review')
		expect(review?.reviewBody).toContain('</script>')
	})

	it('escapes every < (HTML-comment opener defense)', () => {
		expect(serializeJsonLdForScript({ a: '<!-- x -->' })).toBe('{"a":"\\u003c!-- x --\\u003e"}')
	})
})
