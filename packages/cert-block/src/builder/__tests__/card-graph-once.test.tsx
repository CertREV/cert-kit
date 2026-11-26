// @vitest-environment jsdom
/**
 * 2.1.3: ONE CertREV graph per placement per page. brand-b's Builder pages carry the same placement in two blocks: a
 * sidebar rail and a stacked copy for small screens. Each block holds the document's first part, so through 2.1.2 each
 * printed the same graph when mounted separately (Builder's client-rendered preview), and the page carried two identical
 * `ld+json` scripts. In the browser, `dedupeCardGraphs` keeps the first graph of a placement in document order and
 * removes the rest. Within one server render the second block already prints nothing (2.0.2), so the server prints once.
 * A page with a single block prints exactly what 2.1.2 printed.
 */

import { canonicalizeJson } from '@certrev/cert-contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type CardDocumentV1, dedupeCardGraphs } from '../card-contract.js'
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
	],
}

const withGraph = (card: CardDocumentV1) =>
	({
		...card,
		jsonld: { ...((card as unknown as { jsonld?: object }).jsonld ?? {}), graph: GRAPH },
	}) as unknown as CardDocumentV1

const GRAPH_SCRIPT = /<script type="application\/ld\+json" data-certrev-graph="[^"]*"[^>]*>[^<]*<\/script>/g

describe('dedupeCardGraphs: one graph per placement in the browser', () => {
	const tag = (id: string, n: number) =>
		`<script type="application/ld+json" data-certrev-graph="" data-certrev-external-id="${id}">{"n":${n}}</script>`
	afterEach(() => {
		document.body.innerHTML = ''
	})
	it('keeps the first of a placement in document order and removes the rest', () => {
		document.body.innerHTML = `<aside>${tag('entry-1', 1)}</aside><article>${tag('entry-1', 2)}</article>`
		expect(dedupeCardGraphs(document, 'entry-1')).toBe(1)
		const left = document.querySelectorAll('script[data-certrev-graph]')
		expect(left).toHaveLength(1)
		expect(left[0]?.textContent).toBe('{"n":1}')
	})
	it('leaves a single graph, and other placements’ graphs, alone', () => {
		document.body.innerHTML = `${tag('entry-1', 1)}${tag('entry-2', 2)}`
		expect(dedupeCardGraphs(document, 'entry-1')).toBe(0)
		expect(dedupeCardGraphs(document, 'entry-2')).toBe(0)
		expect(document.querySelectorAll('script[data-certrev-graph]')).toHaveLength(2)
	})
	it('leaves other ld+json on the page alone', () => {
		document.body.innerHTML = `<script type="application/ld+json">{"host":1}</script>${tag('entry-1', 1)}${tag('entry-1', 2)}`
		dedupeCardGraphs(document, 'entry-1')
		expect(document.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(2)
	})
})

describe('two blocks of one placement on one page (the brand-b sidebar + stacked shape), server-rendered', () => {
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
		const fixture = contractFixture('sidebar-brand-b-like')
		const card = withGraph(fixture.card)
		const doc = sha256Hex(canonicalizeJson(card))
		delivery.respond(() =>
			json(contractBody(issuer, { ...fixture, card, doc }, { card, faceDigest: contractBinding(fixture, { doc }) })),
		)
	})
	afterEach(() => {
		restore()
		warn.mockRestore()
	})

	it('a single block prints the graph once (unchanged from 2.1.2)', async () => {
		const html = await renderToHtml(<CertReviewCard delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} />)
		expect(html.match(GRAPH_SCRIPT)).toHaveLength(1)
	})

	it('two blocks with no option: whatever the server printed, the browser leaves exactly one', async () => {
		const html = await renderToHtml(
			<div>
				<CertReviewCard delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} />
				<CertReviewCard delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} />
			</div>,
		)
		const printed = html.match(GRAPH_SCRIPT)?.length ?? 0
		expect(printed).toBeGreaterThanOrEqual(1)
		// Two separately mounted blocks (Builder's client-rendered preview, two React roots) each print it: simulate both.
		document.body.innerHTML = html + html
		dedupeCardGraphs(document, ENTRY_ID)
		expect(document.querySelectorAll('script[data-certrev-graph]')).toHaveLength(1)
		document.body.innerHTML = ''
	})
})
