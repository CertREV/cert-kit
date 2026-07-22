import { describe, expect, it } from 'vitest'
import { makeMockPayload } from '../contract/fixtures.js'
import {
	type JsonLdValue,
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

describe('projectCertJsonLd', () => {
	it('emits a wrapped @graph with Article, Review, Person(expert), Organization', () => {
		const g = projectCertJsonLd(makeMockPayload())
		expect(Array.isArray(g)).toBe(false)
		const graph = graphOf(g)
		const types = graph.map((n) => n['@type']).sort()
		expect(types).toEqual(['Article', 'Organization', 'Person', 'Review'])
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

	it('CertREV node @ids are namespaced under certrev.com so they cannot collide with host nodes', () => {
		const g = projectCertJsonLd(makeMockPayload())
		const person = nodeOfType(g, 'Person')
		const org = nodeOfType(g, 'Organization')
		const review = nodeOfType(g, 'Review')
		for (const id of [person['@id'], org['@id'], review['@id']]) {
			expect(String(id).startsWith('https://certrev.com/')).toBe(true)
		}
	})

	it('omits dateModified when contentModifiedAt is null', () => {
		const article = nodeOfType(
			projectCertJsonLd(makeMockPayload({ content: { ...makeMockPayload().content, contentModifiedAt: null } })),
			'Article',
		)
		expect('dateModified' in article).toBe(false)
	})

	it('does not double-attribute when author === expert', () => {
		const p = makeMockPayload()
		const sameAuthor = makeMockPayload({
			content: { ...p.content, author: { name: p.content.expert.displayName, title: null } },
		})
		const article = nodeOfType(projectCertJsonLd(sameAuthor), 'Article')
		expect('author' in article).toBe(false)
	})

	it('is DETERMINISTIC — same facts → byte-identical serialization', () => {
		const a = projectCertJsonLdString(makeMockPayload(), { pageUrl: 'https://x.com/p' })
		const b = projectCertJsonLdString(makeMockPayload(), { pageUrl: 'https://x.com/p' })
		expect(a).toBe(b)
	})

	it('wrapGraph:false returns a bare node array for merge-into-existing-graph callers', () => {
		const arr = projectCertJsonLd(makeMockPayload(), { wrapGraph: false })
		expect(Array.isArray(arr)).toBe(true)
	})
})

describe('serializeJsonLdForScript', () => {
	it('neutralizes </script> so the body cannot break out of the <script> tag', () => {
		const evilPayload = makeMockPayload({
			content: { ...makeMockPayload().content, memo: 'totally safe </script><script>alert(1)</script>' },
		})
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
