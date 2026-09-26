// @vitest-environment jsdom
/**
 * The memo toggle in a DOM: it flips the box it sits in, mirrors the state on the button, and
 * touches nothing else (another card's memo, a host's `.open` class).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { MEMO_COLLAPSE_LABEL, MEMO_EXPAND_LABEL, memoToggleFor, toggleMemo } from '../memo-toggle.js'
import { type RenderCertBlockInput, renderCertBlock } from '../render-cert-block.js'
import { RENDER_SHAPES } from './render-cert-block-shapes.js'

afterEach(() => {
	document.body.innerHTML = ''
})

function mount(...names: string[]): HTMLElement {
	const host = document.createElement('div')
	host.innerHTML = names
		.map((n) => renderCertBlock({ ...(RENDER_SHAPES[n] as unknown as RenderCertBlockInput), responsive: true }))
		.join('')
	document.body.appendChild(host)
	return host
}

const buttons = (host: ParentNode) => [...host.querySelectorAll<HTMLButtonElement>('[data-certrev-memo-toggle]')]

describe('toggleMemo', () => {
	it('expands and collapses the memo box, mirroring the state on aria-expanded and the label', () => {
		const host = mount('bannerLongElf')
		const [button] = buttons(host)
		if (!button) throw new Error('no toggle')
		const box = host.querySelector('[data-certrev-memo]')
		const text = host.querySelector(`#${button.getAttribute('aria-controls')}`)
		expect(text?.hasAttribute('data-certrev-memo-text')).toBe(true)
		expect(box?.contains(button)).toBe(true)
		expect(box?.contains(text as Node)).toBe(true)

		expect(box?.getAttribute('data-certrev-memo')).toBe('collapsed')
		expect(button.getAttribute('aria-expanded')).toBe('false')
		expect(button.textContent).toBe(MEMO_EXPAND_LABEL)

		expect(toggleMemo(button)).toBe(true)
		expect(box?.getAttribute('data-certrev-memo')).toBe('open')
		expect(button.getAttribute('aria-expanded')).toBe('true')
		expect(button.textContent).toBe(MEMO_COLLAPSE_LABEL)

		expect(toggleMemo(button)).toBe(false)
		expect(box?.getAttribute('data-certrev-memo')).toBe('collapsed')
		expect(button.getAttribute('aria-expanded')).toBe('false')
		expect(button.textContent).toBe(MEMO_EXPAND_LABEL)
	})

	it('flips only its own card: two cards on one page are independent', () => {
		const host = mount('bannerLong', 'sidebarLong')
		const [first, second] = buttons(host)
		if (!first || !second) throw new Error('expected two toggles')
		toggleMemo(first)
		expect(first.getAttribute('aria-expanded')).toBe('true')
		expect(second.getAttribute('aria-expanded')).toBe('false')
		expect(second.closest('[data-certrev-memo]')?.getAttribute('data-certrev-memo')).toBe('collapsed')
	})

	it('never reads or writes a class, so a host `.open` rule cannot reach the memo', () => {
		const host = mount('bannerLong')
		const [button] = buttons(host)
		if (!button) throw new Error('no toggle')
		const box = button.closest('[data-certrev-memo]') as HTMLElement
		// A box with no class stays class-less through open and close.
		toggleMemo(button)
		expect(box.getAttribute('data-certrev-memo')).toBe('open')
		expect(box.hasAttribute('class')).toBe(false)
		expect(button.hasAttribute('class')).toBe(false)
		toggleMemo(button)
		expect(box.hasAttribute('class')).toBe(false)
		// A host's own class survives both directions untouched.
		box.classList.add('open')
		toggleMemo(button)
		expect(box.className).toBe('open')
		toggleMemo(button)
		expect(box.getAttribute('data-certrev-memo')).toBe('collapsed')
		expect(box.className).toBe('open')
	})

	it('a button outside any memo box is left alone', () => {
		const loose = document.createElement('button')
		loose.setAttribute('data-certrev-memo-toggle', '')
		loose.textContent = 'x'
		document.body.appendChild(loose)
		expect(toggleMemo(loose)).toBeNull()
		expect(loose.hasAttribute('aria-expanded')).toBe(false)
		expect(loose.textContent).toBe('x')
	})
})

describe('memoToggleFor', () => {
	it('finds the toggle from the button or anything inside it, and nothing from elsewhere', () => {
		const host = mount('bannerLong')
		const [button] = buttons(host)
		if (!button) throw new Error('no toggle')
		expect(memoToggleFor(button)).toBe(button)
		const inner = document.createElement('span')
		button.appendChild(inner)
		expect(memoToggleFor(inner)).toBe(button)
		expect(memoToggleFor(host.querySelector('[data-certrev-memo-text]'))).toBeNull()
		expect(memoToggleFor(null)).toBeNull()
		expect(memoToggleFor(document.createTextNode('t'))).toBeNull()
	})
})
