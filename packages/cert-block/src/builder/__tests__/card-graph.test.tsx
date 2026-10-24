/**
 * 2.0.1: the page's CertREV graph (`cardGraphTag` in `card-contract.ts`). CertREV's server resolves the standalone
 * graph for a Builder placement and serves it as `card.jsonld.graph` (agreed with the lead, relay 3604f5104499: an
 * additive key under contract 1, a complete `{@context, @graph}`). The block prints it verbatim, once per page, in the
 * block that carries the page's assets, and never builds or edits it; a document without it prints no graph.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalizeJson } from '@certrev/cert-contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	type CardDocumentV1,
	cardDocumentDigest,
	cardGraphTag,
	cardHtml,
	cardPartsFor,
	parseCardDocument,
} from '../card-contract.js'
import { CertReviewCard } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import { contractBinding, contractBody, contractFixture } from './contract-v1-shapes.js'
import { sha256Hex } from './delivered-face-shapes.js'
import {
	ENTRY_ID,
	json,
	MARKER,
	makeIssuer,
	renderToHtml,
	type ScriptedDelivery,
	scriptedDelivery,
	T0,
} from './delivery-harness.js'

const GRAPH = {
	'@context': 'https://schema.org',
	'@graph': [
		{ '@type': 'WebPage', '@id': 'https://brand.example/blogs/a#webpage', url: 'https://brand.example/blogs/a' },
		{
			'@type': 'Certification',
			'@id': 'https://certrev.com/verify/x#certification',
			description: 'A memo that quotes </script><script>alert(1)</script> verbatim.',
		},
	],
}

const withGraph = (card: CardDocumentV1, graph: unknown = GRAPH) =>
	({
		...card,
		jsonld: { ...((card as unknown as { jsonld?: object }).jsonld ?? {}), graph },
	}) as unknown as CardDocumentV1

describe('cardGraphTag: the server’s graph, verbatim and inert', () => {
	const banner = contractFixture('banner-elf-like').card

	it('one ld+json script naming the placement; every < escaped, so no value closes it; the same JSON back', () => {
		const tag = cardGraphTag(withGraph(banner))
		expect(
			tag.startsWith('<script type="application/ld+json" data-certrev-graph="" data-certrev-platform="builder"'),
		).toBe(true)
		expect(tag).toContain(`data-certrev-external-id="${banner.subject.externalId}"`)
		const body = tag.slice(tag.indexOf('>') + 1, tag.lastIndexOf('</script>'))
		expect(body).not.toContain('<')
		expect(JSON.parse(body)).toEqual(GRAPH)
	})

	it.each<[string, unknown]>([
		['no jsonld', undefined],
		['jsonld without graph', 'absent'],
		['a graph that is an array', [{ '@type': 'Thing' }]],
		['a graph that is a string', '{"@graph":[]}'],
		['a null graph', null],
	])('%s: no graph printed', (_label, graph) => {
		const card =
			graph === undefined
				? ({ ...banner, jsonld: undefined } as unknown as CardDocumentV1)
				: graph === 'absent'
					? banner
					: withGraph(banner, graph)
		expect(cardGraphTag(card)).toBe('')
	})

	it('only the block that carries the page’s assets prints it (a split banner’s memo block does not)', () => {
		const card = withGraph(banner)
		expect(cardHtml(card, ['top'])).toContain('data-certrev-graph')
		expect(cardHtml(card, ['bottom'])).not.toContain('data-certrev-graph')
		expect(cardHtml(card, ['top', 'bottom']).split('data-certrev-graph').length - 1).toBe(1)
	})
})

describe('a contract-1 placement whose document carries the graph', () => {
	const issuer = makeIssuer()
	let delivery: ScriptedDelivery
	let restore: () => void
	let warn: ReturnType<typeof vi.spyOn>
	beforeEach(() => {
		delivery = scriptedDelivery(() => json({ error: 'unset' }, 500))
		restore = setCardDeliveryRuntimeForTests({
			resolveKid: issuer.resolveKid,
			fetchImpl: () => delivery.fetch,
			now: () => T0,
			timeoutMs: 500,
		})
		warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	})
	afterEach(() => {
		restore()
		warn.mockRestore()
	})

	it('server-renders the card and the graph once, parseable; a split pair prints it once', async () => {
		const fixture = contractFixture('banner-elf-like')
		const card = withGraph(fixture.card)
		const doc = sha256Hex(canonicalizeJson(card))
		delivery.respond(() =>
			json(contractBody(issuer, { ...fixture, card, doc }, { card, faceDigest: contractBinding(fixture, { doc }) })),
		)
		const html = await renderToHtml(
			<div>
				<CertReviewCard delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} part="header" />
				<p>The article.</p>
				<CertReviewCard delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} part="memo" />
			</div>,
		)
		const scripts =
			html.match(/<script type="application\/ld\+json" data-certrev-graph="[^"]*"[^>]*>([^<]*)<\/script>/g) ?? []
		expect(scripts).toHaveLength(1)
		const body = (scripts[0] ?? '').replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')
		expect(JSON.parse(body)).toEqual(GRAPH)
		expect(warn).not.toHaveBeenCalled()
	})
})

describe('the portal’s own Builder document with its graph (s1/builder-card-graph 302c3dd0fd)', () => {
	const fixture = JSON.parse(
		readFileSync(
			join(process.cwd(), 'src/builder/__tests__/__fixtures__/contract-v1/builder-card-with-graph.json'),
			'utf8',
		),
	) as { doc: string; card: CardDocumentV1 & { jsonld: { graph: unknown } } }

	it('its digest is the one the portal signs; its test-environment runtime URL is refused (runtime from certrev.com only, break-it B7)', async () => {
		expect(await cardDocumentDigest(fixture.card)).toBe(fixture.doc)
		// The portal's unit tests serve the runtime from http://localhost:3000; staging and production from
		// https://(staging.)portal.certrev.com, which this client accepts (the live canary cards, evidence/staging/).
		expect(fixture.card.assets.runtime?.src.startsWith('http://localhost')).toBe(true)
		expect(parseCardDocument(fixture.card)).toBeNull()
		const served = {
			...fixture.card,
			assets: {
				...fixture.card.assets,
				runtime: {
					...fixture.card.assets.runtime,
					src: 'https://portal.certrev.com/api/cert/v1/runtime/card-runtime.6bd3e6a563e0408a.js',
				},
			},
		}
		expect(parseCardDocument(served)).not.toBeNull()
	})

	it('prints its graph once, verbatim, with no < inside the element', () => {
		const names = cardPartsFor(fixture.card, undefined)
		const html = cardHtml(fixture.card, names)
		const tags =
			html.match(/<script type="application\/ld\+json" data-certrev-graph="[^"]*"[^>]*>[\s\S]*?<\/script>/g) ?? []
		expect(tags).toHaveLength(1)
		const body = (tags[0] ?? '').replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')
		expect(body).not.toContain('<')
		expect(JSON.parse(body)).toEqual(fixture.card.jsonld.graph)
		expect(JSON.stringify(fixture.card.jsonld.graph)).not.toMatch(/"\$(link|page)"/)
		// Everything else the block prints is the document's own bytes, as before.
		expect(html.startsWith(fixture.card.assets.head)).toBe(true)
		for (const name of names) expect(html).toContain(fixture.card.parts[name] as string)
	})
})
