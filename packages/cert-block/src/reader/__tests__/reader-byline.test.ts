/**
 * The reader face's bylines: the avatars and the writer's subline.
 *
 * Both were reported against the 1.2.0-canary.0 Builder page (a v9 Banners def, nothing hidden, no avatars; a writer
 * with no line under the name), so both are pinned here against the portal's Liquid harness, the cells of
 * `fixtures/oracle-extra.json`, as well as against what the face is documented to paint:
 *
 *  - AVATARS. Every byline paints a round avatar, a photo when there is one to paint and otherwise the person's
 *    INITIALS (an inline `<svg>`, not an `<img>`; see `face.ts` and `reader-initials.test.ts`): 36 px for the writer,
 *    42 px for the banner reviewer, 46 px for the memo and sidebar reviewer. A def that hides `reviewerPhoto` hides the
 *    PHOTOS, both the reviewer's and the writer's, and the initials paint in their place with no photo URL on the page;
 *    `display.showExpertPhoto: false` paints the initials too and never reads a photo URL. A person with no name to take
 *    initials from would get the silhouette; every cell here has names.
 *
 *    The oracle cells are the portal's own Liquid, refreshed with the initials, so the compare is byte for byte on the
 *    whole page, avatars included; the avatars are also asserted on their own against the face's documented behaviour.
 *  - THE WRITER'S SUBLINE. The `<em>` under the writer's name is the envelope's `author.title`, printed when it is
 *    non-empty and absent when it is empty, null or missing. It is data: a writer with no title has no subline.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CertContent } from '../../contract/kernel.js'
import { READER_CSS } from '../reader-css.generated.js'
import { type ReaderLayout, renderReaderFace } from '../render.js'
import { withPackageRel } from './liquid-rel.js'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

interface ExtraCell {
	readonly id: string
	readonly layout: ReaderLayout
	readonly def: unknown
	readonly content: CertContent
	readonly expected: readonly string[]
}

const { certId } = JSON.parse(readFileSync(`${FIXTURES}golden-cells.json`, 'utf8')) as { certId: string }
const { cells } = JSON.parse(readFileSync(`${FIXTURES}oracle-extra.json`, 'utf8')) as { cells: ExtraCell[] }

const cell = (id: string): ExtraCell => {
	const found = cells.find((c) => c.id === id)
	if (!found) throw new Error(`no oracle cell ${id}`)
	return found
}
const shopifyEscape = (html: string): string => html.replaceAll('&#34;', '&quot;')
/** What the Liquid painted for the cell, as the reader face spells it (the harness's `&#34;` and its `rel`). */
const liquid = (id: string): string => cell(id).expected.map(shopifyEscape).map(withPackageRel).join('\n')
const port = (id: string): string => {
	const { layout, def, content } = cell(id)
	return renderReaderFace({ content, def, layout, certId })
}

/**
 * The avatars in a page, in order, as `size:kind`: `img` for a photo, `svg` for the silhouette, the initials themselves
 * for the initials avatar (`sm:MP`, `:AQ`, `lg:AQ`). The logo's `<img>` is not among them.
 */
const avatars = (html: string): string[] =>
	[...html.matchAll(/<span class="certrev-r-face( sm| lg)?">(<img|<svg[^>]*>(?:<text[^>]*>([^<]*)<\/text>)?)/g)].map(
		(m) => `${(m[1] ?? '').trim()}:${m[2]?.startsWith('<img') ? 'img' : (m[3] ?? 'svg')}`,
	)

describe('the avatars of a v9 Banners/Sidebar def', () => {
	// The cells' people: the writer "Morgan Placeholder", the reviewer "Dr. Avery Quinlan" (the honorific is dropped).
	const INITIALS = {
		banner: ['sm:MP', ':AQ', 'lg:AQ'],
		sidebar: ['lg:AQ'],
	} as const
	const PHOTOS = {
		banner: ['sm:img', ':img', 'lg:img'],
		sidebar: ['lg:img'],
	} as const

	// `v9-*` cells: the canary brand's def (accent and bar ink #0A1B3F, Sans, rounded 14px, surface #ffffff).
	const CASES = [
		// the judge's page: nothing hidden, and no photo on the envelope: the initials paint
		['v9-no-hidden-no-photos', 'initials'],
		['v9-hidden-absent-no-photos', 'initials'],
		// hiding other fields hides no avatar
		['v9-hidden-other-only', 'initials'],
		// with photos on the envelope the photos paint (the writer's too)
		['v9-no-hidden-photos', 'photos'],
		// `showExpertPhoto: false` paints the initials and asks for no photo
		['v9-show-photo-false', 'initials'],
		['v9-show-photo-false-no-photos', 'initials'],
		// `reviewerPhoto` in `hidden` hides the photos, not the avatars: the initials, with no photo URL (1.2.0)
		['v9-hidden-reviewer-photo', 'initials'],
		['v9-hidden-reviewer-photo-photos', 'initials'],
	] as const

	describe.each(['banner', 'sidebar'] as const)('%s', (layout) => {
		it.each(CASES)('%s paints %s', (name, painted) => {
			const id = `x.${layout}.${name}`
			const expected = painted === 'initials' ? INITIALS[layout] : PHOTOS[layout]
			expect(avatars(port(id))).toEqual(expected)
			// The whole page, avatars included, is what the Liquid painted, byte for byte.
			expect(port(id)).toBe(liquid(id))
		})
	})

	it('never requests a photo when showExpertPhoto is false, and drops the photo URL from the page', () => {
		for (const layout of ['banner', 'sidebar'] as const) {
			const html = port(`x.${layout}.v9-show-photo-false`)
			expect(html).not.toContain('masked/reviewer.jpg')
			expect(html).not.toContain('masked/author.jpg')
			// the logo's is the only <img>
			expect(html.match(/<img /g)).toHaveLength(layout === 'banner' ? 2 : 1)
		}
	})

	it('keeps the avatars with the photos hidden when reviewerPhoto is hidden: the initials, and no photo URL anywhere', () => {
		// the byline stays (name and "Written by") and so does the round face, now holding the initials
		const html = port('x.banner.v9-hidden-reviewer-photo-photos')
		expect(html).toContain('<b>Morgan Placeholder</b>')
		expect(html).toContain('<b>Dr. Avery Quinlan</b>')
		expect(avatars(html)).toEqual(INITIALS.banner)
		expect(html).not.toContain('masked/reviewer.jpg')
		expect(html).not.toContain('masked/author.jpg')
		// and the portal's Liquid paints the same avatars for the cell
		expect(avatars(liquid('x.banner.v9-hidden-reviewer-photo-photos'))).toEqual(INITIALS.banner)
	})

	it('sizes the avatars 36, 42 and 46 px, as the demo does', () => {
		const rule = (selector: string) => {
			const found = READER_CSS.match(new RegExp(`${selector.replaceAll('.', '\\.')} \\{([^}]*)\\}`))
			if (!found) throw new Error(`no rule for ${selector}`)
			return found[1] as string
		}
		expect(rule('.certrev-reader .certrev-r-face')).toMatch(/width: 42px;\s*height: 42px/)
		expect(rule('.certrev-reader .certrev-r-face.sm')).toMatch(/width: 36px;\s*height: 36px/)
		expect(rule('.certrev-reader .certrev-r-face.lg')).toMatch(/width: 46px;\s*height: 46px/)
		// and an inline svg avatar (the initials, the silhouette) inherits that box; it is neither an image request nor sized by an attribute
		expect(rule('.certrev-reader .certrev-r-face svg')).toMatch(/width: 100%;\s*height: 100%/)
	})
})

describe("the writer's subline (author.title)", () => {
	/** What sits between the writer's name and the "Written by" role on the banner: the subline, or nothing. */
	const between = (html: string): string | undefined =>
		html.match(/<b>Morgan Placeholder<\/b>([\s\S]*?)<span class="certrev-r-role">Written by<\/span>/)?.[1]

	const CASES = [
		['author-title-empty', ''],
		['author-title-null', ''],
		['author-title-absent', ''],
		// whitespace is not empty to the Liquid (`!= ''`), so it prints, and so does the port
		['author-title-blank', '<em>   </em>'],
		['author-title-number', '<em>42</em>'],
		['author-title-markup', '<em>Staff &lt;b&gt;&quot;Writer&quot;&lt;/b&gt; &amp; &#39;Co&#39;</em>'],
	] as const

	it.each(CASES)('%s: the banner prints %j under the writer, as the Liquid does', (name, subline) => {
		const id = `x.banner.${name}`
		expect(between(liquid(id))).toBe(subline)
		expect(between(port(id))).toBe(subline)
		expect(port(id)).toBe(liquid(id))
	})

	it('prints the title the envelope carries, once, in an <em> between the name and the role', () => {
		const html = port('x.banner.v9-no-hidden-photos')
		const title = cell('x.banner.v9-no-hidden-photos').content.author as { title?: string }
		expect(title.title).toBe('Staff Writer')
		expect(between(html)).toBe('<em>Staff Writer</em>')
		expect(html.match(/<em>Staff Writer<\/em>/g)).toHaveLength(1)
	})

	it('has no writer byline on the sidebar at all (the Liquid has none, and so title or not nothing prints)', () => {
		for (const name of ['author-title-empty', 'author-title-markup']) {
			expect(port(`x.sidebar.${name}`)).not.toContain('Written by')
			expect(port(`x.sidebar.${name}`)).not.toContain('Morgan Placeholder')
		}
	})
})
