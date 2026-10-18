/**
 * 1.2.0-canary.1 (and 1.2.0): what the Builder card's avatars depend on, through the real delivery path (a signed
 * envelope, a scripted Delivery API, the kernel).
 *
 * The 1.2.0-canary.0 canary page (a v9 Banners def: accent and bar ink #0A1B3F, Sans, rounded 14px, surface #ffffff)
 * drew no avatars. The reader face paints them for every such def. Since 1.2.0 a person with no photo to paint shows
 * their INITIALS (the writer "Sam Writer" -> SW, the reviewer "Dr. Jane Doe" -> JD, the honorific dropped), the same
 * bytes the portal's Liquid and PHP twins print; the silhouette is for a person with no name to take them from:
 *
 *  - nothing hidden, no photo on the envelope: the initials (36 px writer, 42 px reviewer, 46 px reviewer in the memo),
 *    each an inline `<svg>` in a `span.certrev-r-face`, never an `<img>`;
 *  - nothing hidden, a photo: the photo (the writer's too, when it has one);
 *  - `display.showExpertPhoto: false`: the initials, and the photo URL is not on the page;
 *  - `hidden: ['reviewerPhoto']`: the initials too, the writer's included, and the photo URL is not on the page, the
 *    seed in `data-certrev-envelope` included. (Before 1.2.0 this removed the avatars; it removes the photos now.)
 *
 * `src/reader/__tests__/reader-byline.test.ts` holds the same facts against the Liquid harness's cells, and
 * `src/reader/__tests__/reader-initials.test.ts` the initials spec.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { READER_CSS } from '../../reader/reader-css.generated.js'
import { CARD_READER_CSS } from '../card-reader-css.js'
import { CertReviewCard, type CertReviewCardProps } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import {
	builderPayload,
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
	withoutSeed,
} from './delivery-harness.js'
import { OPTIONS_ONLY_SHAPES } from './options-only-shapes.js'

/** The def the judge's canary brand served: v9, Banners (no `layout`), nothing hidden unless a test says so. */
const v9 = (hidden: unknown = []) => ({
	v: 9,
	preset: 'memo',
	rung: 'memo',
	tokens: { accentColor: '#0A1B3F', barInk: '#0A1B3F', fontSlot: 'sans', cornerRadius: '14px', surface: '#ffffff' },
	barInkFg: '#ffffff',
	accentFg: '#ffffff',
	face: 'reader',
	hidden,
})

/**
 * The avatars on a page, in order, as `size:kind`: `img` for a photo, `svg` for the silhouette, the initials themselves
 * for the initials avatar; the 18 px logo's `<img>` is not one.
 */
const avatars = (html: string): string[] =>
	[...html.matchAll(/<span class="certrev-r-face( sm| lg)?">(<img|<svg[^>]*>(?:<text[^>]*>([^<]*)<\/text>)?)/g)].map(
		(m) => `${(m[1] ?? '').trim()}:${m[2]?.startsWith('<img') ? 'img' : (m[3] ?? 'svg')}`,
	)

describe('the reader face on the delivery card: avatars', () => {
	let issuer: FixtureIssuer
	let delivery: ScriptedDelivery
	let restore: () => void

	const base = builderPayload().content
	const { photoUrl: _reviewerPhoto, ...expertWithoutPhoto } = base.expert as typeof base.expert & { photoUrl?: string }
	/** The envelope's content: the fixture's, with the reviewer's photo removed unless `photos`, and a display patch. */
	const content = (opts: { photos?: boolean; display?: Record<string, unknown> } = {}) =>
		({
			...base,
			expert: opts.photos ? base.expert : expertWithoutPhoto,
			display: { ...base.display, ...opts.display },
		}) as typeof base

	const card = () => (
		<CertReviewCard
			{...(OPTIONS_ONLY_SHAPES.todaysExport as CertReviewCardProps)}
			mode={undefined}
			delivery={MARKER}
			builderContext={{ content: { id: ENTRY_ID } }}
		/>
	)
	const paint = async (def: unknown, envelopeContent: typeof base): Promise<string> => {
		delivery.respond(() => json(deliveryBody(issuer.envelope({ content: envelopeContent }), def)))
		const html = await renderToHtml(card())
		const root = chromeRoot(html)
		expect(root).not.toBeNull()
		return root as string
	}

	beforeEach(() => {
		issuer = makeIssuer()
		delivery = scriptedDelivery(() => json(deliveryBody(issuer.envelope(), v9())))
		restore = setCardDeliveryRuntimeForTests({
			resolveKid: issuer.resolveKid,
			fetchImpl: () => delivery.fetch,
			now: () => T0,
			timeoutMs: 200,
		})
	})
	afterEach(() => restore())

	it('fixture: the writer has a name and a title but no photo, the reviewer a photo unless a test removes it', () => {
		expect(base.author).toMatchObject({ name: 'Sam Writer', title: 'Senior Content Editor' })
		expect((base.author as { photoUrl?: string }).photoUrl).toBeUndefined()
		expect(base.expert.photoUrl).toBe('https://cdn.certrev.com/experts/jane-doe.jpg')
	})

	it('paints the three initials avatars for a v9 def with nothing hidden and no photo (the judge page)', async () => {
		const html = await paint(v9([]), content())
		expect(html).toContain('data-certrev-face="reader"')
		expect(avatars(html)).toEqual(['sm:SW', ':JD', 'lg:JD'])
		// the initials are inline, so the only <img> on the page is each CertREV logo
		expect(html).not.toMatch(/<img [^>]*certrev-r-face/)
		expect(html.match(/<img /g)).toHaveLength(2)
	})

	it('sizes them with the stylesheet it inlines: 36, 42 and 46 px', async () => {
		const html = await paint(v9([]), content())
		// the card's sheet is the portal's less its remote font faces; the avatar rules are in both
		expect(html).toContain(`<style data-certrev-reader-css>${CARD_READER_CSS}</style>`)
		for (const css of [READER_CSS, CARD_READER_CSS]) {
			expect(css).toMatch(/\.certrev-r-face \{[^}]*width: 42px;\s*height: 42px/)
			expect(css).toMatch(/\.certrev-r-face\.sm \{\s*width: 36px;\s*height: 36px/)
			expect(css).toMatch(/\.certrev-r-face\.lg \{\s*width: 46px;\s*height: 46px/)
		}
	})

	it("paints the reviewer's photo, and the writer's initials, when only the reviewer has a photo", async () => {
		const html = await paint(v9([]), content({ photos: true }))
		expect(avatars(html)).toEqual(['sm:SW', ':img', 'lg:img'])
		expect(html).toContain('jane-doe.jpg')
	})

	it('treats a def that hides a field the faces ignore as one that hides no avatar', async () => {
		expect(avatars(await paint(v9(['bio']), content()))).toEqual(['sm:SW', ':JD', 'lg:JD'])
	})

	it('a def that hides the memo paints no memo card, so no memo avatar: the memo is stripped before the card paints (1.2.0)', async () => {
		// canary.5 painted all three here (the face ignored `memo`); the memo text is not on the page now, in either the
		// face or the seed, so there is no memo card to hold the third avatar. The byline avatars stay.
		const html = await paint(v9(['bio', 'memo']), content())
		expect(avatars(html)).toEqual(['sm:SW', ':JD'])
		expect(html).not.toContain(base.memo as string)
	})

	it('paints the initials and drops the photo URL when showExpertPhoto is false', async () => {
		const html = await paint(v9([]), content({ photos: true, display: { showExpertPhoto: false } }))
		expect(avatars(html)).toEqual(['sm:SW', ':JD', 'lg:JD'])
		// `showExpertPhoto: false` is not stripped from the seed (it is not a hidden field), so the photo URL may be in
		// the seed's payload; it is in no painted element: the face never reads it
		expect(withoutSeed(html)).not.toContain('jane-doe.jpg')
	})

	it("paints the initials, the writer's included, and no photo URL anywhere, when the def hides reviewerPhoto", async () => {
		for (const photos of [false, true]) {
			const html = await paint(v9(['reviewerPhoto']), content({ photos }))
			expect(html).toContain('data-certrev-face="reader"')
			expect(avatars(html)).toEqual(['sm:SW', ':JD', 'lg:JD'])
			// hidden means absent from the page: the face never read the URL, and the seed has it stripped
			expect(html).not.toContain('jane-doe.jpg')
			expect(html).not.toContain('cdn.certrev.com/experts')
			// the bylines themselves stay
			expect(html).toContain('<b>Sam Writer</b>')
			expect(html).toContain('Written by')
		}
	})
})
