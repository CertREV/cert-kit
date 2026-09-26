/**
 * The PHONE face (1.1.0 `responsive`): what it adds to the card, and that it adds nothing else.
 *
 *  - absent (or `false`), every face is byte-identical to what 1.0.3 painted (the golden is the
 *    1.0.3 tarball's own output for the same inputs);
 *  - present, the card gains exactly the scoped phone rules, the stacking hook and, for a long
 *    memo, the collapsible box, its clamped text and a native toggle: stripping those gives the
 *    1.0.3 card back byte for byte, so a desktop reader sees the card they saw before.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
	MEMO_COLLAPSE_LABEL,
	MEMO_COLLAPSE_MIN_CHARS,
	MEMO_EXPAND_LABEL,
	memoCollapses,
	NARROW_VIEWPORT,
} from '../memo-toggle.js'
import { type RenderCertBlockInput, renderCertBlock } from '../render-cert-block.js'
import { LONG_MEMO, RENDER_SHAPES } from './render-cert-block-shapes.js'

const golden = JSON.parse(
	readFileSync(new URL('./__golden__/render-cert-block-1.0.3.json', import.meta.url), 'utf8'),
) as { generatedFrom: string; golden: Record<string, string> }

const shape = (name: string) => RENDER_SHAPES[name] as unknown as RenderCertBlockInput
const phone = (name: string) => renderCertBlock({ ...shape(name), responsive: true })

/** The phone face with everything it adds taken out again. */
function withoutPhoneFace(html: string): string {
	return html
		.replace(/<style>@media [^<]*<\/style>/g, '')
		.replace(/ data-certrev-responsive/g, '')
		.replace(/ data-certrev-stack/g, '')
		.replace(
			/<div data-certrev-memo="collapsed">(<blockquote[^>]*>[\s\S]*?<\/blockquote>)<button [^>]*>[^<]*<\/button><\/div>/g,
			'$1',
		)
		.replace(/ data-certrev-memo="collapsed"/g, '')
		.replace(/ id="certrev-memo-[0-9a-z]+" data-certrev-memo-text/g, '')
		.replace(/<button type="button" data-certrev-memo-toggle [^>]*>[^<]*<\/button>/g, '')
}

function toggles(html: string): string[] {
	return html.match(/<button [^>]*data-certrev-memo-toggle[^>]*>[^<]*<\/button>/g) ?? []
}

describe('responsive absent: the 1.0.3 card, byte for byte', () => {
	it('the golden is the 1.0.3 tarball output', () => {
		expect(golden.generatedFrom).toBe('@certrev/cert-block@1.0.3 (tarball src)')
		expect(Object.keys(golden.golden).sort()).toEqual(Object.keys(RENDER_SHAPES).sort())
	})

	for (const name of Object.keys(RENDER_SHAPES)) {
		it(`${name}: absent and false both paint what 1.0.3 painted`, () => {
			expect(renderCertBlock(shape(name))).toBe(golden.golden[name])
			expect(renderCertBlock({ ...shape(name), responsive: false })).toBe(golden.golden[name])
		})
	}

	it('a truthy non-boolean is not `true`: untyped input cannot switch the phone face on', () => {
		const input = { ...shape('bannerLong'), responsive: 'yes' } as unknown as RenderCertBlockInput
		expect(renderCertBlock(input)).toBe(golden.golden.bannerLong)
	})
})

describe('responsive: the phone face is additive', () => {
	for (const name of Object.keys(RENDER_SHAPES)) {
		it(`${name}: stripping the phone markup gives the 1.0.3 card back`, () => {
			expect(withoutPhoneFace(phone(name))).toBe(golden.golden[name])
		})
	}
})

describe('responsive: the rules', () => {
	it('one scoped stylesheet, first inside the root, every rule inside the phone media query', () => {
		const html = phone('bannerLong')
		expect(html.startsWith('<div class="certrev-cert certrev-cert--banner" data-certrev-mode="banner"')).toBe(true)
		const root = html.slice(0, html.indexOf('>') + 1)
		expect(root).toContain(' data-certrev-responsive ')
		const styles = html.match(/<style>[\s\S]*?<\/style>/g) ?? []
		expect(styles).toHaveLength(1)
		expect(html.indexOf('<style>')).toBe(root.length)
		const css = styles[0] as string
		expect(css.startsWith(`<style>@media ${NARROW_VIEWPORT}{`)).toBe(true)
		expect(css.endsWith('}}</style>')).toBe(true)
		const rules = css.slice(`<style>@media ${NARROW_VIEWPORT}{`.length, -'}</style>'.length).match(/[^{}]+\{[^}]*\}/g)
		expect(rules).toHaveLength(3)
		for (const rule of rules ?? []) expect(rule.startsWith('.certrev-cert[data-certrev-responsive] ')).toBe(true)
		expect(css).toContain('[data-certrev-stack]{grid-template-columns:1fr!important}')
		expect(css).toContain(
			'[data-certrev-memo="collapsed"] [data-certrev-memo-text]{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;line-clamp:4;overflow:hidden}',
		)
		expect(css).toContain('[data-certrev-memo-toggle]{display:inline-flex!important}')
	})

	it('the banner header grid carries the stacking hook, with or without the author column', () => {
		expect(phone('bannerLong')).toContain(
			'<div data-certrev-stack style="display:grid;grid-template-columns:1fr 1fr;gap:22px;">',
		)
		expect(phone('bannerNoAuthor')).toContain(
			'<div data-certrev-stack style="display:grid;grid-template-columns:1fr;gap:22px;">',
		)
	})

	it('each banner part is its own root with its own rules', () => {
		for (const name of ['bannerHeaderPart', 'bannerMemoPart']) {
			const html = phone(name)
			expect(html).toContain(' data-certrev-responsive ')
			expect(html.match(/<style>/g)).toHaveLength(1)
		}
		expect(toggles(phone('bannerHeaderPart'))).toEqual([])
		expect(toggles(phone('bannerMemoPart'))).toHaveLength(1)
	})

	it('the floating pill has no memo and no columns: nothing changes', () => {
		expect(phone('floating')).toBe(golden.golden.floating)
	})
})

describe('responsive: the collapsible memo', () => {
	it('banner: the memo column is the box, the paragraph is clamped, a native toggle follows it', () => {
		const html = phone('bannerLongElf')
		const [toggle] = toggles(html)
		const id = /aria-controls="(certrev-memo-[0-9a-z]+)"/.exec(toggle ?? '')?.[1]
		expect(id).toBeDefined()
		expect(html).toContain('<div data-certrev-memo="collapsed" style="flex:1;min-width:0;">')
		expect(html).toContain(`<p id="${id}" data-certrev-memo-text style="margin:11px 0 14px;`)
		// The paragraph's own text is untouched: the whole memo is in the markup (screen readers read it).
		expect(html).toContain(`>${LONG_MEMO}</p>${toggle}</div>`)
		expect(toggle).toBe(
			`<button type="button" data-certrev-memo-toggle aria-expanded="false" aria-controls="${id}" ` +
				'style="display:none;align-items:center;min-height:44px;padding:0;margin:0;border:0;background:none;cursor:pointer;font-family:var(--font-mono);font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--navy);text-decoration:underline;text-underline-offset:3px;">' +
				`${MEMO_EXPAND_LABEL}</button>`,
		)
		// Exactly one element carries the id the toggle controls.
		expect(html.match(new RegExp(`id="${id}"`, 'g'))).toHaveLength(1)
	})

	it('the toggle is hidden inline, never with `hidden` (a host `[hidden]!important` rule cannot pin it)', () => {
		for (const toggle of toggles(phone('bannerLong'))) {
			expect(toggle).toContain('style="display:none;')
			expect(toggle).not.toMatch(/\shidden[\s=>]/)
		}
	})

	it('sidebar and custom: the quote is wrapped in the box with its toggle', () => {
		for (const name of ['sidebarLong', 'sidebarLongElf', 'customLong']) {
			const html = phone(name)
			const [toggle] = toggles(html)
			expect(toggle).toBeDefined()
			expect(html).toMatch(
				/<div data-certrev-memo="collapsed"><blockquote id="certrev-memo-[0-9a-z]+" data-certrev-memo-text style="margin:16px 0 0;/,
			)
			expect(html).toContain(`${LONG_MEMO}</blockquote>${toggle}</div>`)
		}
	})

	it('a memo under the threshold with fewer than four breaks gets no box and no toggle', () => {
		for (const name of ['bannerShort', 'sidebarShort']) {
			const html = phone(name)
			expect(html).toContain(' data-certrev-responsive ')
			// The markup, not the stylesheet (whose selectors name the hooks).
			const markup = html.replace(/<style>[\s\S]*?<\/style>/, '')
			expect(markup).not.toContain('data-certrev-memo')
			expect(toggles(html)).toEqual([])
		}
	})

	it('a short memo with four or more breaks collapses on its paragraphs', () => {
		expect(toggles(phone('bannerBroken'))).toHaveLength(1)
	})

	it('an empty memo paints no memo section and no toggle', () => {
		const html = phone('bannerEmptyMemo')
		expect(html).not.toContain('Expert memo')
		expect(toggles(html)).toEqual([])
	})

	it('the threshold: 160 characters stays open, 161 collapses; 3 breaks stay open, 4 collapse', () => {
		expect(MEMO_COLLAPSE_MIN_CHARS).toBe(160)
		expect(memoCollapses('x'.repeat(160))).toBe(false)
		expect(memoCollapses('x'.repeat(161))).toBe(true)
		expect(memoCollapses('a\nb\nc\nd')).toBe(false)
		expect(memoCollapses('a\nb\nc\nd\ne')).toBe(true)
		expect(memoCollapses('')).toBe(false)
		expect(memoCollapses(undefined)).toBe(false)
		const at = (memo: string) =>
			toggles(
				renderCertBlock({ ...shape('bannerLong'), facts: { ...shape('bannerLong').facts, memo }, responsive: true }),
			)
		expect(at('x'.repeat(160))).toEqual([])
		expect(at('x'.repeat(161))).toHaveLength(1)
	})

	it('the memo stays escaped, and the id is derived from content, never from it raw', () => {
		const html = phone('escapedMemo')
		expect(html).not.toContain('<script>')
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot;')
		expect(toggles(html)).toHaveLength(1)
		expect(html).toMatch(/ id="certrev-memo-[0-9a-z]+" data-certrev-memo-text/)
	})

	it('the id is stable for one card and differs between certs and faces', () => {
		const idOf = (html: string) => /aria-controls="([^"]+)"/.exec(html)?.[1]
		const a = idOf(phone('bannerLong'))
		expect(idOf(phone('bannerLong'))).toBe(a)
		const otherCert = renderCertBlock({
			...shape('bannerLong'),
			facts: { ...shape('bannerLong').facts, certificateUrl: 'https://certrev.com/verify/cert_fixture_002' },
			responsive: true,
		})
		expect(idOf(otherCert)).not.toBe(a)
		expect(idOf(phone('sidebarLong'))).not.toBe(a)
	})

	it('the collapse label the toggle flips to is the locked one', () => {
		expect(MEMO_EXPAND_LABEL).toBe('Read the full memo')
		expect(MEMO_COLLAPSE_LABEL).toBe('Show less')
	})
})
