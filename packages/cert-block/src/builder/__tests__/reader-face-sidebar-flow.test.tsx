// @vitest-environment jsdom
/**
 * 1.2.0-canary.6: the reader sidebar card's float leaves its Builder block (`BUILDER_SIDEBAR_FLOW_CSS`).
 *
 * In a Builder page the card's block is a flex item of the flex column holding the page's blocks, so it contains the
 * sidebar's float: the block spanned the whole column at the aside's height and no copy could sit beside the aside.
 * What is pinned here is what the delivery card serves and what the rules select:
 *  - every reader face paints the rules once, as a `<style data-certrev-builder-flow>` right after the face's wrapper,
 *    byte for byte the package constant (React would escape its `>` and `"` in a text child);
 *  - every other face, and the options-only card, paints nothing new;
 *  - the rules apply only above the reader CSS's own sidebar breakpoint (the complement of its `@media`, read from the
 *    stylesheet, so the two cannot drift apart);
 *  - in a page shaped as Builder serves it (`.builder-blocks > .builder-block > card`), the three selectors match the
 *    column, the card's block and the face's wrapper around a reader SIDEBAR, and nothing around a banner, a floating
 *    pill or a legacy face.
 * A real browser's layout (the zero-height block, the aside flush in the column, the copy beside it) is measured
 * outside this suite, on the served canary page with the rules added; jsdom has no layout.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { READER_CSS } from '../../reader/reader-css.generated.js'
import { BUILDER_SIDEBAR_FLOW_CSS, CertReviewCard, type CertReviewCardProps } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import {
	chromeRoot,
	deliveryBody,
	ENTRY_ID,
	type FixtureIssuer,
	json,
	MARKER,
	makeIssuer,
	renderToHtml,
	type ScriptedDelivery,
	scriptedDelivery,
	T0,
} from './delivery-harness.js'
import { RAW_DEFS } from './legacy-face-cases.js'
import { OPTIONS_ONLY_SHAPES } from './options-only-shapes.js'

const FLOW_STYLE = `<style data-certrev-builder-flow="">${BUILDER_SIDEBAR_FLOW_CSS}</style>`

/** The three rules' selectors, in order: the column, the card's block, the face's wrapper. */
function flowSelectors(): string[] {
	const inner = BUILDER_SIDEBAR_FLOW_CSS.slice(BUILDER_SIDEBAR_FLOW_CSS.indexOf('{') + 1, -1)
	return [...inner.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => (m[1] ?? '').trim())
}

/**
 * `el` matches `rule`, a selector ending in one `:has(> …)`. jsdom's selector engine (nwsapi 2.2) cannot parse an
 * attribute selector inside `:has()` (a browser can), so the relative part is evaluated as what `:has(> …)` means: an
 * element reached by `:scope > …` from `el`.
 */
function matchesRule(el: Element, rule: string): boolean {
	const at = rule.indexOf(':has(')
	expect(at).toBeGreaterThan(0)
	expect(rule.endsWith(')')).toBe(true)
	const relative = rule.slice(at + ':has('.length, -1).trim()
	expect(relative.startsWith('> ')).toBe(true)
	return el.matches(rule.slice(0, at)) && el.querySelector(`:scope ${relative}`) !== null
}

/** Every element of the page that one of the three rules selects. */
function selected(): Element[] {
	return [...document.querySelectorAll('*')].filter((el) => flowSelectors().some((rule) => matchesRule(el, rule)))
}

describe('the sidebar flow rules on the delivery card', () => {
	let issuer: FixtureIssuer
	let delivery: ScriptedDelivery
	let restore: () => void

	const card = (overrides: Partial<CertReviewCardProps> = {}) => (
		<CertReviewCard mode={undefined} delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} {...overrides} />
	)
	const serve = (def: unknown) => {
		delivery.respond(() => json(deliveryBody(issuer.envelope(), def)))
	}

	beforeEach(() => {
		issuer = makeIssuer()
		delivery = scriptedDelivery(() => json(deliveryBody(issuer.envelope(), RAW_DEFS['face-reader'])))
		restore = setCardDeliveryRuntimeForTests({
			resolveKid: issuer.resolveKid,
			fetchImpl: () => delivery.fetch,
			now: () => T0,
		})
	})
	afterEach(() => {
		restore()
		document.body.innerHTML = ''
	})

	it.each([
		['the def layout (banner)', 'face-reader', undefined],
		['the def layout (sidebar)', 'face-reader-sidebar', undefined],
		['the editor (sidebar)', 'face-reader', 'sidebar'],
		['the editor (floating)', 'face-reader-sidebar', 'floating'],
		['the editor (banner)', 'face-reader-sidebar', 'banner'],
	] as const)('a reader face, %s, paints the rules once, right after its wrapper', async (_label, def, mode) => {
		serve(RAW_DEFS[def])
		const html = await renderToHtml(card({ mode }))
		const root = chromeRoot(html) ?? ''
		expect(html.split('data-certrev-builder-flow')).toHaveLength(2)
		// Unescaped: the selectors' `>` and `"` reach the page as they are in the constant.
		expect(root).toContain(`</div>${FLOW_STYLE}`)
		expect(root.indexOf(FLOW_STYLE)).toBeGreaterThan(root.indexOf('</section>'))
	})

	it.each(
		Object.keys(RAW_DEFS).filter((k) => !k.startsWith('face-reader')),
	)('the %s def paints no rules', async (key) => {
		serve(RAW_DEFS[key])
		const html = await renderToHtml(card({ mode: 'sidebar' }))
		expect(chromeRoot(html)).not.toBeNull()
		expect(html).not.toContain('data-certrev-builder-flow')
		expect(html).not.toContain('builder-block')
		expect(html).not.toContain(':has(')
	})

	it('the options-only card paints no rules', async () => {
		const html = await renderToHtml(
			<CertReviewCard {...(OPTIONS_ONLY_SHAPES.todaysExport as CertReviewCardProps)} mode="sidebar" />,
		)
		expect(html).toContain('data-certrev-cert-chrome')
		expect(html).not.toContain('data-certrev-builder-flow')
		expect(delivery.calls).toEqual([])
	})

	it('a revoked envelope paints neither the face nor the rules', async () => {
		const tombstone = await issuer.tombstone()
		delivery.respond(() => json(tombstone))
		const html = await renderToHtml(card({ mode: 'sidebar' }))
		expect(chromeRoot(html)).toBeNull()
		expect(html).not.toContain('data-certrev-builder-flow')
	})
})

describe('BUILDER_SIDEBAR_FLOW_CSS', () => {
	it('applies exactly where the reader CSS floats the sidebar: above its own stacking breakpoint', () => {
		// The reader CSS's one media block that un-floats the sidebar; the rules are its complement, nothing wider.
		const stack = /@media ([^{]+)\{\s*\.certrev-reader \.certrev-r-side \{\s*float: none;/.exec(READER_CSS)
		expect(stack?.[1]?.trim()).toBe('(max-width: 820px)')
		expect(BUILDER_SIDEBAR_FLOW_CSS.startsWith(`@media not all and ${stack?.[1]?.trim()}{`)).toBe(true)
		expect(BUILDER_SIDEBAR_FLOW_CSS.endsWith('}}')).toBe(true)
		expect(BUILDER_SIDEBAR_FLOW_CSS.match(/@media/g)).toHaveLength(1)
	})

	it('sets display, and only display: the column to flow-root, the block and the wrapper to block', () => {
		const declarations = [...BUILDER_SIDEBAR_FLOW_CSS.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1])
		expect(declarations).toEqual([
			'display:flow-root !important',
			'display:block !important',
			'display:block !important',
		])
	})

	describe('in a page shaped as Builder serves it', () => {
		let issuer: FixtureIssuer
		let delivery: ScriptedDelivery
		let restore: () => void
		beforeEach(() => {
			issuer = makeIssuer()
			delivery = scriptedDelivery(() => json(deliveryBody(issuer.envelope(), RAW_DEFS['face-reader-sidebar'])))
			restore = setCardDeliveryRuntimeForTests({
				resolveKid: issuer.resolveKid,
				fetchImpl: () => delivery.fetch,
				now: () => T0,
			})
		})
		afterEach(() => {
			restore()
			document.body.innerHTML = ''
		})

		/** The served card in a column of Builder blocks, after a copy block, as the replica's entry places it. */
		async function page(def: unknown, mode?: 'banner' | 'sidebar' | 'floating') {
			delivery.respond(() => json(deliveryBody(issuer.envelope(), def)))
			const html = await renderToHtml(
				<CertReviewCard mode={mode} delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} />,
			)
			document.body.innerHTML =
				'<div class="builder-blocks"><div class="builder-block builder-copy"><p>Copy</p></div>' +
				`<div class="builder-block builder-card">${html}</div></div>`
			const column = document.querySelector('.builder-blocks') as Element
			const block = document.querySelector('.builder-card') as Element
			const wrapper = document.querySelector('[data-certrev-cert-chrome]') as Element
			const copy = document.querySelector('.builder-copy') as Element
			return { column, block, wrapper, copy }
		}

		it('selects the column, the card block and the wrapper around a reader sidebar, and nothing else', async () => {
			const [columnRule, blockRule, wrapperRule] = flowSelectors() as [string, string, string]
			const { column, block, wrapper, copy } = await page(RAW_DEFS['face-reader-sidebar'])
			expect(wrapper.querySelector(':scope > .certrev-reader > .certrev-r-side')).not.toBeNull()
			expect(matchesRule(column, columnRule)).toBe(true)
			expect(matchesRule(block, blockRule)).toBe(true)
			expect(matchesRule(wrapper, wrapperRule)).toBe(true)
			for (const rule of flowSelectors()) expect(matchesRule(copy, rule)).toBe(false)
			expect(selected()).toEqual([column, block, wrapper])
		})

		it.each([
			['a reader banner', RAW_DEFS['face-reader'], undefined],
			['a reader floating pill', RAW_DEFS['face-reader-sidebar'], 'floating'],
			['a legacy sidebar', RAW_DEFS['layout-sidebar'], 'sidebar'],
			['an unknown face', RAW_DEFS['face-unknown'], 'sidebar'],
		] as const)('selects nothing around %s', async (_label, def, mode) => {
			await page(def, mode)
			expect(selected()).toEqual([])
		})

		it('selects nothing when the card is not a direct child of a Builder block in a Builder column', async () => {
			const { block } = await page(RAW_DEFS['face-reader-sidebar'])
			const nested = document.createElement('div')
			nested.append(...block.childNodes)
			block.append(nested)
			expect(selected()).toEqual([])
		})
	})
})
