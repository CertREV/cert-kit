/**
 * The reader's token allow-list (M3): a colour is `#RGB` or `#RRGGBB`, a radius is a bare `0` or one non-negative
 * px / rem / em / % length, and anything else paints the default (navy, 14px). The portal's `certrev-reader-tokens`
 * snippet and the PHP twin's def parser hold the same list.
 *
 * `reader-differential.test.ts` already compares ~70 grammar cells with the Liquid harness's output; this file spells
 * the list out, so a reader of the port sees the rule rather than the cells, and pins the two inputs the harness
 * cannot speak for (see the array case).
 *
 * A denylist of characters was 1.2.0-canary.0's guard. It let a quote, a backslash, a comment opener or a bracket
 * through whenever it was not one of `; ( ) { } < > "` or a space, and a value such as `#abc/*` hides the `;` that
 * ends it and swallows the declarations after it.
 */
import { describe, expect, it } from 'vitest'
import { readerTokens } from '../tokens.js'

const NAVY = '#0A1B3F'
const style = (tokens: Record<string, unknown>, extra: Record<string, unknown> = {}): string =>
	readerTokens({ tokens, ...extra }).style
const accentOf = (value: unknown, extra: Record<string, unknown> = {}): string =>
	style({ accentColor: value }, extra).match(/--cr-ba:([^;]*);/)?.[1] as string
const radiusOf = (value: unknown): string => style({ cornerRadius: value }).match(/--cr-br:([^;]*);/)?.[1] as string

describe('a colour is #RGB or #RRGGBB', () => {
	it.each(['#abc', '#ABC', '#a1B', '#0A1B3F', '#ffffff', '#F5C518', '#abcdef'])('accepts %s', (hex) => {
		expect(accentOf(hex)).toBe(hex)
	})

	it.each([
		'',
		'#',
		'#ab',
		'#abcd',
		'#abcde',
		'#abcdeff',
		'#abcdefff',
		'abc',
		'abcdef',
		'#ggg',
		'#abg',
		'#abc ',
		' #abc',
		'#abc\n',
		'#abç',
		'#a\u{1F600}',
		'red',
		'navy',
		'rgb(1,2,3)',
		'hsl(0 0% 0%)',
		'transparent',
		'#abc;',
		"#ab'",
		'#ab"',
		'#abc/*',
		'#abc\\',
		'#abc}',
		'#abc<',
		'#abc;}x{',
	])('paints navy for %j', (hex) => {
		expect(accentOf(hex)).toBe(NAVY)
	})

	it('reads only a string: a number, a boolean, an object, a null or an array paints navy', () => {
		for (const hex of [123456, 0, true, false, null, undefined, { a: 1 }, ['#abc'], ['#abc', '#def']]) {
			expect(accentOf(hex)).toBe(NAVY)
		}
	})

	it('takes the bar ink first, and falls to the accent colour when the bar ink is not a colour', () => {
		expect(style({ accentColor: '#F5C518', barInk: '#0a1B3f' })).toContain('--cr-ba:#0a1B3f;')
		expect(style({ accentColor: '#F5C518', barInk: 'red' })).toContain('--cr-ba:#F5C518;')
		expect(style({ accentColor: 'red', barInk: 'red' })).toContain(`--cr-ba:${NAVY};`)
	})

	it('takes the foreground baked for the colour that painted the accent, and white otherwise', () => {
		const fg = (tokens: Record<string, unknown>, def: Record<string, unknown>) => readerTokens({ tokens, ...def }).fg
		expect(fg({ barInk: '#fa0', accentColor: '#abc' }, { barInkFg: '#141414', accentFg: '#ffffff' })).toBe('#141414')
		// a bar ink that is not a colour is no bar ink: the accent's foreground decides, not the bar ink's
		expect(fg({ barInk: 'red', accentColor: '#F5C518' }, { barInkFg: '#141414', accentFg: '#ffffff' })).toBe('#ffffff')
		expect(fg({ barInk: 'red', accentColor: '#F5C518' }, { barInkFg: '#ffffff', accentFg: '#141414' })).toBe('#141414')
		// neither is a colour: the navy default, with white ink
		expect(fg({ barInk: 'red', accentColor: 'blue' }, { barInkFg: '#141414', accentFg: '#141414' })).toBe('#ffffff')
	})
})

describe('a radius is a bare 0 or a non-negative px / rem / em / % length', () => {
	it.each([
		'0',
		'0px',
		'8px',
		'14px',
		'22px',
		'1.25em',
		'.5rem',
		'.5%',
		'100%',
		'007px',
		'0.5rem',
	])('accepts %s', (radius) => {
		expect(radiusOf(radius)).toBe(radius)
	})

	it('reads a number as its text: 0 is the bare zero, 8 has no unit', () => {
		expect(radiusOf(0)).toBe('0')
		expect(radiusOf(8)).toBe('14px')
	})

	it.each([
		'',
		'8',
		'0.0',
		'00',
		'-4px',
		'+4px',
		'8PX',
		'8Px',
		'8pt',
		'8vh',
		'8rpx',
		'1.2.3px',
		'5.px',
		'.px',
		'px',
		'rem',
		'em',
		'%',
		'4 px',
		' 4px',
		'4px ',
		'1e3px',
		'calc(1px)',
		'8px;',
		'8px"',
		"8px'",
		'8px}',
		'8px/*',
		'8px\\',
		'inherit',
		'50% 10%',
		'4px 8px',
	])('paints 14px for %j', (radius) => {
		expect(radiusOf(radius)).toBe('14px')
	})

	it('reads only a string or a number: a boolean, an object, a null or an array paints 14px', () => {
		for (const radius of [true, false, null, undefined, { a: 1 }, ['4px']]) {
			expect(radiusOf(radius)).toBe('14px')
		}
	})
})

describe('the style attribute cannot be left', () => {
	it('keeps every value of a hostile def inside the four declarations', () => {
		const hostile = style({
			accentColor: '#abc;--x:1',
			barInk: '#abc"><script>',
			cornerRadius: '8px;}body{x:y',
			fontSlot: "serif';}",
		})
		expect(hostile).toBe(
			`--cr-ba:${NAVY};--cr-ba-fg:#ffffff;--cr-br:14px;--cr-bf:'DM Sans', ui-sans-serif, system-ui, sans-serif`,
		)
	})
})
