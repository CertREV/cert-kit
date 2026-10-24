// @vitest-environment jsdom
/**
 * 2.0.1: the card document's placement hints, applied among a Builder page's top-level blocks (`card-placement.ts`).
 * The page is built as `@builder.io/sdk-react` renders an entry (`[builder-content-id] > .builder-blocks > .builder-block`,
 * as on CertREV's deployed replica); the card block holds the wrapper with its part hosts, as `ContractCardFace` prints it.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { CardDocumentV1 } from '../card-contract.js'
import { afterPageSettles, applyCardPlacement } from '../card-placement.js'

afterEach(() => {
	document.body.innerHTML = ''
})

interface PageOptions {
	readonly hero?: boolean
	readonly byline?: string
	readonly references?: boolean
	/** Where the card block sits among the text blocks (0 = first). */
	readonly cardAt?: number
}

/** A Builder page with the card block (both banner parts and the head and dialogs) among plain blocks. */
function page(options: PageOptions = {}): { root: Element; column: Element; wrapper: Element } {
	const blocks: string[] = []
	if (options.hero) blocks.push('<div class="builder-block" id="hero"><img src="h.jpg" alt=""></div>')
	if (options.byline) blocks.push(`<div class="builder-block" id="byline-block">${options.byline}</div>`)
	blocks.push('<div class="builder-block" id="p1"><p>One.</p></div>')
	blocks.push('<div class="builder-block" id="p2"><p>Two.</p></div>')
	if (options.references)
		blocks.push('<div class="builder-block" id="refs"><h2>References</h2><ol><li>A</li></ol></div>')
	const card =
		'<div class="builder-block" id="card-block"><div data-certrev-face="card" id="wrapper">' +
		'<style data-certrev-card-head></style>' +
		'<certrev-card data-certrev-part="top"></certrev-card><certrev-card data-certrev-part="bottom"></certrev-card>' +
		'<certrev-card data-certrev-part="dialog-expert"></certrev-card></div></div>'
	blocks.splice(options.cardAt ?? 1, 0, card)
	document.body.innerHTML = `<main><div builder-content-id="entry-1"><div class="builder-blocks">${blocks.join('')}</div></div></main>`
	return {
		root: document.querySelector('[builder-content-id]') as Element,
		column: document.querySelector('.builder-blocks') as Element,
		wrapper: document.getElementById('wrapper') as Element,
	}
}

const card = (placement: unknown) => ({ layout: 'banner', placement }) as unknown as CardDocumentV1

/** The top-level column in order: each block's id, a holder as `placed:<part>`. */
const order = (column: Element) =>
	Array.from(column.children)
		.filter((el) => el.tagName !== 'STYLE')
		.map((el) => (el.getAttribute('data-certrev-placed') ? `placed:${el.getAttribute('data-certrev-placed')}` : el.id))

describe('applyCardPlacement: each part to its hinted anchor among the top-level blocks', () => {
	it('header after the byline, memo at the end (Owen: the reviewer up top, the memo at the end)', () => {
		const { column, wrapper } = page({ byline: '<p class="byline">By Ann Writer</p>', cardAt: 2 })
		applyCardPlacement(wrapper, card({ top: { anchor: 'after-byline' }, bottom: { anchor: 'content-end' } }), [
			'top',
			'bottom',
		])
		expect(order(column)).toEqual(['byline-block', 'placed:top', 'p1', 'card-block', 'p2', 'placed:bottom'])
		// The block keeps the head and the dialogs; each part sits in its holder.
		expect(wrapper.querySelector('style[data-certrev-card-head]')).not.toBeNull()
		expect(wrapper.querySelector('[data-certrev-part="dialog-expert"]')).not.toBeNull()
		expect(column.querySelector('[data-certrev-placed="top"] > certrev-card[data-certrev-part="top"]')).not.toBeNull()
	})

	it('the default banner hints: the card at content start after a leading image, the memo before the references', () => {
		const { column, wrapper } = page({ hero: true, references: true, cardAt: 2 })
		applyCardPlacement(
			wrapper,
			card({
				top: { anchor: 'content-start', after: 'leading-media' },
				bottom: { anchor: 'before-references', else: 'content-end' },
			}),
			['top', 'bottom'],
		)
		expect(order(column)).toEqual(['hero', 'placed:top', 'p1', 'card-block', 'p2', 'placed:bottom', 'refs'])
	})

	it('a part whose block already sits at its anchor stays in the block (the memo of a card block placed last)', () => {
		const { column, wrapper } = page({ cardAt: 2 })
		applyCardPlacement(wrapper, card({ bottom: { anchor: 'content-end' } }), ['bottom'])
		expect(order(column)).toEqual(['p1', 'p2', 'card-block'])
		expect(wrapper.querySelector(':scope > certrev-card[data-certrev-part="bottom"]')).not.toBeNull()
	})

	it('content start without a leading image: before the first block', () => {
		const { column, wrapper } = page({ cardAt: 2 })
		applyCardPlacement(wrapper, card({ top: { anchor: 'content-start', after: 'leading-media' } }), ['top'])
		expect(order(column)).toEqual(['placed:top', 'p1', 'p2', 'card-block'])
	})

	it('an explicit byline marker wins over a byline-looking class elsewhere', () => {
		const { column, wrapper } = page({ byline: '<p data-certrev-anchor="byline">By Ann</p>', cardAt: 3 })
		// A later block with a byline class must not win over the marked one.
		column.insertAdjacentHTML('beforeend', '<div class="builder-block" id="late"><span class="byline">x</span></div>')
		applyCardPlacement(wrapper, card({ top: { anchor: 'after-byline' } }), ['top'])
		expect(order(column).slice(0, 2)).toEqual(['byline-block', 'placed:top'])
	})

	it('an anchor the page does not have falls back to `else`, then stays where the editor put it', () => {
		const { column, wrapper } = page({ cardAt: 1 })
		applyCardPlacement(wrapper, card({ bottom: { anchor: 'before-references', else: 'content-end' } }), ['bottom'])
		expect(order(column)).toEqual(['p1', 'card-block', 'p2', 'placed:bottom'])
		document.body.innerHTML = ''
		const second = page({ cardAt: 1 })
		applyCardPlacement(second.wrapper, card({ top: { anchor: 'after-byline' } }), ['top'])
		expect(order(second.column)).toEqual(['p1', 'card-block', 'p2'])
	})

	it('an unknown anchor, `pinned`, or no hint at all: the part stays (forward compatible)', () => {
		const { column, wrapper } = page({ cardAt: 1 })
		applyCardPlacement(wrapper, card({ top: { anchor: 'after-the-hero-video' }, bottom: { anchor: 'pinned' } }), [
			'top',
			'bottom',
		])
		applyCardPlacement(wrapper, card(undefined), ['top', 'bottom'])
		applyCardPlacement(wrapper, card({ top: 'content-end' }), ['top'])
		expect(order(column)).toEqual(['p1', 'card-block', 'p2'])
		expect(wrapper.querySelectorAll(':scope > certrev-card').length).toBe(3)
	})

	it('a part already in place does not move; rails and pills never move', () => {
		const { column, wrapper } = page({ cardAt: 0 })
		applyCardPlacement(wrapper, card({ top: { anchor: 'content-start' } }), ['top'])
		expect(order(column)).toEqual(['card-block', 'p1', 'p2'])
		wrapper.insertAdjacentHTML('beforeend', '<certrev-card data-certrev-part="rail"></certrev-card>')
		applyCardPlacement(wrapper, card({ rail: { anchor: 'content-end' } }), ['rail'])
		expect(order(column)).toEqual(['card-block', 'p1', 'p2'])
	})

	it('outside a Builder page (no builder-content-id): nothing moves', () => {
		document.body.innerHTML =
			'<div id="w"><certrev-card data-certrev-part="top"></certrev-card></div><p id="after">x</p>'
		const wrapper = document.getElementById('w') as Element
		applyCardPlacement(wrapper, card({ top: { anchor: 'content-end' } }), ['top'])()
		expect(wrapper.querySelector('certrev-card')).not.toBeNull()
	})
})

describe('the undo: a part is never printed twice', () => {
	it('puts a moved part back in its wrapper, in its place, when the same card is printed again', () => {
		const { column, wrapper } = page({ byline: '<p class="byline">By</p>', cardAt: 3 })
		const undo = applyCardPlacement(wrapper, card({ top: { anchor: 'after-byline' } }), ['top', 'bottom'])
		expect(wrapper.querySelector(':scope > certrev-card[data-certrev-part="top"]')).toBeNull()
		undo()
		expect(order(column)).toEqual(['byline-block', 'p1', 'p2', 'card-block'])
		expect(
			Array.from(wrapper.children).map((el) => el.getAttribute('data-certrev-part') ?? el.tagName.toLowerCase()),
		).toEqual(['style', 'top', 'bottom', 'dialog-expert'])
	})

	it('drops the moved part when React already printed a new document into the wrapper', () => {
		const { column, wrapper } = page({ byline: '<p class="byline">By</p>', cardAt: 3 })
		const undo = applyCardPlacement(wrapper, card({ top: { anchor: 'after-byline' } }), ['top'])
		wrapper.innerHTML = '<certrev-card data-certrev-part="top" id="new-top"></certrev-card>'
		undo()
		expect(column.querySelectorAll('certrev-card[data-certrev-part="top"]').length).toBe(1)
		expect(column.querySelector('[data-certrev-placed]')).toBeNull()
		expect(wrapper.querySelector('#new-top')).not.toBeNull()
	})

	it('drops the moved part when the card left the page', () => {
		const { column, wrapper } = page({ byline: '<p class="byline">By</p>', cardAt: 3 })
		const undo = applyCardPlacement(wrapper, card({ top: { anchor: 'after-byline' } }), ['top'])
		document.getElementById('card-block')?.remove()
		undo()
		expect(column.querySelector('certrev-card')).toBeNull()
	})
})

describe('afterPageSettles: never during a render or hydration', () => {
	it('waits for load and two frames; a cancel before then applies nothing, after then undoes', async () => {
		let applied = 0
		let undone = 0
		const cancelEarly = afterPageSettles(() => {
			applied++
			return () => undone++
		})
		cancelEarly()
		await new Promise((r) => setTimeout(r, 80))
		expect(applied).toBe(0)
		const cancelLate = afterPageSettles(() => {
			applied++
			return () => undone++
		})
		await new Promise((r) => setTimeout(r, 120))
		expect(applied).toBe(1)
		cancelLate()
		expect(undone).toBe(1)
	})
})
