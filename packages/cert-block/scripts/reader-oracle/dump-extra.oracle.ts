/**
 * Reader-face ORACLE, part 2 (edge cells). Runs inside the PORTAL's vitest (the `@` alias points at the portal's src/): it paints
 * the portal's own Liquid harness (the same one that writes the portal's reader goldens) for inputs the cert-block
 * port must reproduce, and writes JSON for src/reader/__tests__/fixtures/. Driven by scripts/refresh-reader.mjs
 * --oracle; it never writes into the portal.
 */
import fs from 'node:fs'
import path from 'node:path'
import { it } from 'vitest'
import { content, paint, rawDef, readerDef } from '@/lib/cert-render/reader/reader-test-kit'

const OUT = process.env.READER_ORACLE_OUT ?? path.join(__dirname, 'out')
const GOLD = { accentColor: '#F5C518', barInk: '#F5C518', fontSlot: 'serif', cornerRadius: '0px' } as const
const NAVY = { accentColor: '#0A1B3F' } as const

type Over = Parameters<typeof content>[0]
interface Cell {
	id: string
	layout: 'banner' | 'sidebar' | 'floating'
	def: unknown
	over?: Over
	illustrative?: boolean
}

const HOSTILE_NAME = `Dr. <b>"Quinn"</b> & O'Neil`
const hostile: Over = {
	expert: {
		displayName: HOSTILE_NAME,
		credentials: [
			{ abbreviation: 'RDN', fullName: 'x', cardLabel: `R"D'N <i>` },
			{ abbreviation: 'PhD', fullName: 'y' },
		],
		profileUrl: `https://certrev.com/e/?a="b"&c='d'`,
		photoUrl: `https://cdn.example.test/p.jpg?x="1"&y='2'`,
		bio: `Bio with <script>alert("x")</script> & 'quotes'`,
		compensationCue: 'Compensated expert',
	},
	author: { name: `Mo "Writer" <Staff>`, title: `T & 'U'` },
	memo: `Memo "with" <tags> & 'apostrophes'`,
	root: { verifyUrl: `https://certrev.com/verify/x?a="b"&c='d'` },
}

const cells: Cell[] = []
const add = (c: Cell) => cells.push(c)
const both = (id: string, over: Over | undefined, tokens = NAVY as Record<string, string>, hidden: string[] = []) => {
	for (const layout of ['banner', 'sidebar'] as const)
		add({ id: `x.${layout}.${id}`, layout, def: readerDef(tokens as never, hidden as never, layout), over })
}

both('no-credential', { expert: { credentials: [] } })
both('blank-credential-label', {
	expert: {
		credentials: [
			{ abbreviation: '', fullName: 'x', cardLabel: '  ' },
			{ abbreviation: 'PhD', fullName: 'y' },
		],
	},
})
both('cardlabel-null-falls-to-abbrev', {
	expert: { credentials: [{ abbreviation: 'MD', fullName: 'x', cardLabel: null }] },
})
both('no-cred-date', { expert: { credentialVerifiedAt: null } })
both('cred-date-bad', { expert: { credentialVerifiedAt: 'not-a-date' } })
both('no-memo', { memo: null })
both('blank-memo', { memo: '   ' })
both('no-memo-no-profile', { memo: null, expert: { profileUrl: null } })
both('no-memo-no-links', { memo: null, expert: { profileUrl: null }, root: { verifyUrl: 'javascript:alert(1)' } })
both('no-links-with-memo', { expert: { profileUrl: null }, root: { verifyUrl: 'javascript:alert(1)' } })
both('verify-only-relative', { expert: { profileUrl: '/experts/x' }, root: { verifyUrl: '//certrev.com/v/1' } })
both('url-case-and-hash', { expert: { profileUrl: '  HTTPS://certrev.com/e/1  ' }, root: { verifyUrl: '#verify' } })
both('pro-bono', { expert: { compensationCue: null } })
both('empty-cue', { expert: { compensationCue: '' } })
both('no-certified', { root: { certifiedAt: '' } })
both('bad-certified', { root: { certifiedAt: 'garbage' } })
both('cue-no-profile', { expert: { profileUrl: null } })
both('author-same-as-reviewer', { author: { name: 'Dr. Avery Quinlan' } })
both('author-blank', { author: { name: '', title: null } })
both('author-no-title', { author: { title: null } })
both('show-author-false', { display: { showAuthor: false } })
both('show-photo-false', { display: { showExpertPhoto: false } })
both('show-bio-false', { display: { showBio: false } })
both('no-bio', { expert: { bio: null } })
both('blank-bio', { expert: { bio: '  ' } })
both('photo-assets', {
	expert: { photoUrl: 'https://assets.certrev.com/experts/a%20b.jpg?v=3&w=9' },
	author: { photoUrl: 'https://staging-assets.certrev.com/authors/z.png' },
})
both('photo-already-wrapped', {
	expert: { photoUrl: 'https://assets.certrev.com/cdn-cgi/image/width=84/experts/a.jpg' },
})
both('photo-lookalike-host', {
	expert: { photoUrl: 'https://assets.certrev.com.evil.example/x.jpg' },
	author: { photoUrl: 'http://assets.certrev.com/x.jpg' },
})
both('photo-relative', { expert: { photoUrl: '/img/a.jpg' }, author: { photoUrl: '//cdn.example.test/b.jpg' } })
both('photo-unsafe', {
	expert: { photoUrl: 'javascript:alert(1)' },
	author: { photoUrl: 'data:image/png;base64,AAAA' },
})
// Every names-* cell has no photo on the envelope: with one the face paints the <img> and the initials are never reached.
both('names-honorific-prof', { expert: { displayName: 'Prof. Ada Lovelace', photoUrl: null } })
both('names-honorific-mx-only', { expert: { displayName: 'Mx.', photoUrl: null } })
both('names-honorific-dr-only', { expert: { displayName: 'Dr', photoUrl: null } })
both('names-no-honorific', { expert: { displayName: 'Avery Quinlan', photoUrl: null } })
both('names-lowercase-honorific', { expert: { displayName: 'dr. Avery Quinlan', photoUrl: null } })
both('names-padded', { expert: { displayName: '  Dr.   Avery   Quinlan  ', photoUrl: null } })
both('names-single', { expert: { displayName: 'Cher', photoUrl: null } })
// Empty parts (a run of spaces) are skipped by the Liquid's own loop: "Jane  Doe" is JD, and a bare honorific is no name.
both('names-inner-double-space', { expert: { displayName: 'Jane  Doe', photoUrl: null } })
both('names-honorific-double-gaps', { expert: { displayName: 'Dr.  Marie   Park', photoUrl: null } })
both('names-honorific-then-spaces', { expert: { displayName: 'Dr.   ', photoUrl: null } })
both('author-inner-double-space', { author: { name: 'Sam  Writer', title: null, photoUrl: null } })
both('hostile', hostile)
both('hostile-hidden-photo', hostile, NAVY, ['reviewerPhoto'])
both('def-hidden-bio-and-photo', undefined, GOLD, ['reviewerPhoto', 'bio'])
// The writer column's subline: the author's title, printed only when it is not the empty string (a blank one still prints).
// The sidebar has no writer byline at all, so only two of these ride on it, to show that no title paints there.
const banner = (id: string, over: Over) =>
	add({ id: `x.banner.${id}`, layout: 'banner', def: readerDef(NAVY, [], 'banner'), over })
both('author-title-empty', { author: { title: '' } })
banner('author-title-null', { author: { title: null } })
banner('author-title-absent', { author: { title: undefined } })
banner('author-title-blank', { author: { title: '   ' } })
banner('author-title-number', { author: { title: 42 } })
both('author-title-markup', { author: { title: `Staff <b>"Writer"</b> & 'Co'` } })

// The avatars. A def as the Delivery API serves one for a Banners brand (v9, navy accent and bar ink, Sans, rounded 14px,
// white surface), with and without photos on the envelope: no hidden element paints a silhouette (or the photo) per
// byline; `reviewerPhoto` hidden paints none; `showExpertPhoto: false` keeps the silhouettes and never reads a photo.
const V9 = (hidden: string[] | undefined, layout?: string) =>
	rawDef({
		v: 9,
		tokens: { accentColor: '#0A1B3F', barInk: '#0A1B3F', fontSlot: 'sans', cornerRadius: '14px', surface: '#ffffff' },
		barInkFg: '#ffffff',
		accentFg: '#ffffff',
		hidden,
		...(layout ? { layout } : {}),
	})
const NO_PHOTOS: Over = { expert: { photoUrl: null }, author: { photoUrl: null } }
for (const layout of ['banner', 'sidebar'] as const) {
	const lay = layout === 'banner' ? undefined : layout
	add({ id: `x.${layout}.v9-no-hidden-no-photos`, layout, def: V9([], lay), over: NO_PHOTOS })
	add({ id: `x.${layout}.v9-no-hidden-photos`, layout, def: V9([], lay) })
	add({ id: `x.${layout}.v9-hidden-absent-no-photos`, layout, def: V9(undefined, lay), over: NO_PHOTOS })
	add({ id: `x.${layout}.v9-hidden-reviewer-photo`, layout, def: V9(['reviewerPhoto'], lay), over: NO_PHOTOS })
	add({ id: `x.${layout}.v9-hidden-reviewer-photo-photos`, layout, def: V9(['reviewerPhoto'], lay) })
	add({ id: `x.${layout}.v9-hidden-other-only`, layout, def: V9(['bio', 'memo'], lay), over: NO_PHOTOS })
	add({
		id: `x.${layout}.v9-show-photo-false`,
		layout,
		def: V9([], lay),
		over: { display: { showExpertPhoto: false } },
	})
	add({
		id: `x.${layout}.v9-show-photo-false-no-photos`,
		layout,
		def: V9([], lay),
		over: { ...NO_PHOTOS, display: { showExpertPhoto: false } },
	})
}
add({ id: 'x.floating.v9-no-hidden', layout: 'floating', def: V9([], 'floating') })

add({
	id: 'x.banner.illustrative-no-cue',
	layout: 'banner',
	def: readerDef(NAVY, [], 'banner'),
	over: { expert: { compensationCue: null } },
	illustrative: true,
})
add({ id: 'x.banner.illustrative-cue-wins', layout: 'banner', def: readerDef(NAVY, [], 'banner'), illustrative: true })
add({
	id: 'x.banner.illustrative-no-memo',
	layout: 'banner',
	def: readerDef(NAVY, [], 'banner'),
	over: { expert: { compensationCue: null }, memo: null },
	illustrative: true,
})
add({
	id: 'x.sidebar.illustrative-no-cue',
	layout: 'sidebar',
	def: readerDef(NAVY, [], 'sidebar'),
	over: { expert: { compensationCue: null } },
	illustrative: true,
})
add({
	id: 'x.sidebar.illustrative-cue-wins',
	layout: 'sidebar',
	def: readerDef(NAVY, [], 'sidebar'),
	illustrative: true,
})

// token variants (banner + sidebar + floating)
const tokenCases: Record<string, unknown> = {
	'tok-dark-ink-barink': rawDef({
		tokens: { accentColor: '#F5C518', barInk: '#F5C518', fontSlot: 'grotesk', cornerRadius: '8px' },
		barInkFg: '#141414',
		accentFg: '#ffffff',
	}),
	'tok-accent-only-dark-ink': rawDef({
		tokens: { accentColor: '#F5C518', fontSlot: 'system' },
		barInkFg: '#ffffff',
		accentFg: '#141414',
	}),
	'tok-accent-only-no-accentfg': rawDef({
		tokens: { accentColor: '#F5C518' },
		accentFg: undefined,
		barInkFg: '#141414',
	}),
	'tok-barink-ink-no-barinkfg': rawDef({
		tokens: { accentColor: '#F5C518', barInk: '#7A1F2B' },
		barInkFg: undefined,
		accentFg: '#141414',
	}),
	'tok-barink-bad-accent-wins': rawDef({
		tokens: { accentColor: '#F5C518', barInk: 'rgb(1,2,3)' },
		barInkFg: '#141414',
		accentFg: '#141414',
	}),
	'tok-hostile-accent': rawDef({
		tokens: { accentColor: 'red;x', barInk: 'url(x)', cornerRadius: '4px; color:red', fontSlot: 'weird' },
		barInkFg: '#141414',
		accentFg: '#141414',
	}),
	'tok-hostile-all-blank-radius': rawDef({ tokens: { accentColor: '', barInk: '', cornerRadius: '', fontSlot: '' } }),
	'tok-quote-in-accent': rawDef({ tokens: { accentColor: '#fff"onload=x', cornerRadius: "3px'" } }),
	'tok-no-tokens': rawDef({ tokens: undefined, accentFg: undefined, barInkFg: undefined }),
	'tok-fg-garbage': rawDef({ tokens: { accentColor: '#F5C518' }, accentFg: '#000000', barInkFg: '#000000' }),
	'tok-version-7': rawDef({ v: 7 }),
	'tok-hidden-not-array': rawDef({ hidden: 'reviewerPhoto' }),
	'tok-hidden-absent': rawDef({ hidden: undefined }),
	'tok-sans': readerDef({ accentColor: '#0A1B3F', fontSlot: 'sans' } as never),
	'tok-mono-sharp': readerDef({
		accentColor: '#222222',
		barInk: '#222222',
		fontSlot: 'mono',
		cornerRadius: '0px',
	} as never),
}
for (const [id, def] of Object.entries(tokenCases))
	for (const layout of ['banner', 'sidebar', 'floating'] as const) {
		// the def carries the layout (banner is the default and is omitted), as the write path stores it
		add({ id: `x.${layout}.${id}`, layout, def: layout === 'banner' ? def : { ...(def as object), layout } })
	}

// The token allow-list (M3): a colour is '#' and 3 or 6 hex digits, a radius a bare 0 or a number with px, rem, em or %;
// anything else paints the default (navy, 14px). The grammar cells are on the floating pill, which carries the same
// root `style` as the two cards and is a fifth of their size; a few cells ride on all three layouts above.
const grammar: Record<string, Record<string, unknown>> = {
	'hex-3': { accentColor: '#abc' },
	'hex-6-upper': { accentColor: '#ABCDEF' },
	'hex-6-mixed-barink': { accentColor: '#F5C518', barInk: '#0a1B3f' },
	'hex-4-digits': { accentColor: '#abcd' },
	'hex-5-digits': { accentColor: '#abcde' },
	'hex-8-digits': { accentColor: '#aabbccdd' },
	'hex-no-hash': { accentColor: 'abc123' },
	'hex-no-hash-3': { accentColor: 'abc' },
	'hex-non-hex-3': { accentColor: '#ggg' },
	'hex-non-hex-6': { accentColor: '#12345z' },
	'hex-just-hash': { accentColor: '#' },
	'hex-named': { accentColor: 'red', barInk: 'transparent' },
	'hex-currentcolor': { accentColor: 'currentcolor' },
	'hex-backslash-3': { accentColor: '#ab\\' },
	'hex-backslash-6': { accentColor: '#12345\\' },
	'hex-bracket': { accentColor: '#ab]' },
	'hex-bang': { accentColor: '#ab!' },
	'hex-newline-3': { accentColor: '#abc\n' },
	'hex-newline-6': { accentColor: '#abcde\n' },
	'hex-leading-space': { accentColor: ' #abc' },
	'hex-trailing-space': { accentColor: '#abc ' },
	'hex-quote': { accentColor: "#ab'" },
	'hex-unicode': { accentColor: '#abç' },
	'hex-astral': { accentColor: '#a\u{1F600}' },
	'hex-number-accent': { accentColor: 123456 },
	'hex-number-barink': { accentColor: '#F5C518', barInk: 1234 },
	'hex-bool-accent': { accentColor: true },
	'hex-object-accent': { accentColor: { a: 1 } },
	// No array cell: liquidjs's `append` stringifies ['#abc'] to '#abc' (Array#toString) and so paints it, where Shopify's
	// Ruby Liquid (to_s: '["#abc"]') and the PHP twin (is_string) paint the default. reader-tokens.test.ts pins the default.
	'hex-barink-bad-accent-good': { accentColor: '#F5C518', barInk: '#12' },
	'hex-barink-bad-accent-bad': { accentColor: 'nope', barInk: 'nope' },
	'radius-0': { cornerRadius: '0' },
	'radius-0px': { cornerRadius: '0px' },
	'radius-8px': { cornerRadius: '8px' },
	'radius-22px': { cornerRadius: '22px' },
	'radius-dot-5-rem': { cornerRadius: '.5rem' },
	'radius-1-25-em': { cornerRadius: '1.25em' },
	'radius-100-pct': { cornerRadius: '100%' },
	'radius-dot-5-pct': { cornerRadius: '.5%' },
	'radius-leading-zeros': { cornerRadius: '007px' },
	'radius-number-0': { cornerRadius: 0 },
	'radius-number-8': { cornerRadius: 8 },
	'radius-no-unit': { cornerRadius: '8' },
	'radius-zero-point-zero': { cornerRadius: '0.0' },
	'radius-upper-unit': { cornerRadius: '8PX' },
	'radius-mixed-unit': { cornerRadius: '8Px' },
	'radius-pt': { cornerRadius: '8pt' },
	'radius-vh': { cornerRadius: '8vh' },
	'radius-negative': { cornerRadius: '-4px' },
	'radius-plus': { cornerRadius: '+4px' },
	'radius-two-dots': { cornerRadius: '1.2.3px' },
	'radius-trailing-dot': { cornerRadius: '5.px' },
	'radius-only-dot': { cornerRadius: '.px' },
	'radius-only-px': { cornerRadius: 'px' },
	'radius-only-rem': { cornerRadius: 'rem' },
	'radius-only-em': { cornerRadius: 'em' },
	'radius-only-pct': { cornerRadius: '%' },
	'radius-space-before-unit': { cornerRadius: '4 px' },
	'radius-padded': { cornerRadius: ' 4px' },
	'radius-trailing-space': { cornerRadius: '4px ' },
	'radius-calc': { cornerRadius: 'calc(1px)' },
	'radius-exponent': { cornerRadius: '1e3px' },
	'radius-semicolon': { cornerRadius: '8px;' },
	'radius-newline': { cornerRadius: '8px\n' },
	'radius-backslash': { cornerRadius: '8px\\' },
	'radius-quote': { cornerRadius: "8px'" },
	'radius-rpx': { cornerRadius: '5rpx' },
	'radius-double-unit': { cornerRadius: '5pxpx' },
	'radius-bool': { cornerRadius: true },
	'radius-object': { cornerRadius: { a: 1 } },
	'radius-blank': { cornerRadius: '' },
}
for (const [id, tokens] of Object.entries(grammar)) {
	add({
		id: `x.floating.tok-${id}`,
		layout: 'floating',
		def: { ...rawDef({ tokens: { accentColor: '#0A1B3F', ...tokens } }), layout: 'floating' },
	})
}
// The same grammar reaching the banner card's root style, and the logo ink that follows the validated bar ink (the
// sidebar and the pill build their root style with the same function, and the pill carries the grammar above).
for (const [id, tokens, extra] of [
	['short-hex-barink-dark-ink', { accentColor: '#abc', barInk: '#fa0' }, { barInkFg: '#141414' }],
	[
		'bad-barink-falls-to-accent-ink',
		{ accentColor: '#F5C518', barInk: 'red' },
		{ barInkFg: '#141414', accentFg: '#ffffff' },
	],
	['named-colour-navy', { accentColor: 'red' }, { accentFg: '#141414' }],
	['radius-rem', { accentColor: '#0A1B3F', cornerRadius: '.5rem' }, {}],
	['radius-bad-unit', { accentColor: '#0A1B3F', cornerRadius: '8PX' }, {}],
] as [string, Record<string, unknown>, Record<string, unknown>][])
	add({ id: `x.banner.tok-${id}`, layout: 'banner', def: rawDef({ tokens, ...extra }) })

// floating variants
add({
	id: 'x.floating.no-profile',
	layout: 'floating',
	def: readerDef(NAVY, [], 'floating'),
	over: { expert: { profileUrl: null } },
})
add({
	id: 'x.floating.unsafe-verify',
	layout: 'floating',
	def: readerDef(NAVY, [], 'floating'),
	over: { root: { verifyUrl: 'javascript:alert(1)' } },
})
add({ id: 'x.floating.hostile', layout: 'floating', def: readerDef(NAVY, [], 'floating'), over: hostile })
add({
	id: 'x.floating.no-name',
	layout: 'floating',
	def: readerDef(NAVY, [], 'floating'),
	over: { expert: { displayName: '' } },
})
add({
	id: 'x.banner.no-name',
	layout: 'banner',
	def: readerDef(NAVY, [], 'banner'),
	over: { expert: { displayName: '' } },
})
add({
	id: 'x.sidebar.no-name',
	layout: 'sidebar',
	def: readerDef(NAVY, [], 'sidebar'),
	over: { expert: { displayName: '' } },
})

const SECTION = /<section class="certrev-reader[\s\S]*?<\/section>/g

it('dumps the extra cell inputs and the Liquid output', async () => {
	fs.mkdirSync(OUT, { recursive: true })
	const out: unknown[] = []
	for (const c of cells) {
		const body = content(c.over)
		const html = await paint(body, c.def as never, { illustrative: c.illustrative === true })
		// Only the reader sections are the contract; the embed page around them is the portal harness's.
		const expected = html.match(SECTION) ?? []
		out.push({
			id: c.id,
			layout: c.layout,
			def: c.def,
			content: body,
			...(c.illustrative ? { illustrative: true } : {}),
			expected,
		})
	}
	fs.writeFileSync(path.join(OUT, 'oracle-extra.json'), JSON.stringify({ cells: out }))
})
