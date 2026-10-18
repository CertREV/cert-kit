/**
 * 1.2.0: the Builder card paints the reader face when, and only when, the delivered def says `face: 'reader'`.
 *
 * Everything runs through the real delivery path (a signed envelope, a scripted Delivery API, the kernel), exactly as
 * `delivery-card.test.tsx` does, so what is pinned is what a Builder page serves:
 *  - a reader def: the wrapper, ONE inline `<style>` holding the portal's reader CSS byte for byte, and the same
 *    markup `renderReaderFace` (the Liquid twin, golden-tested in `src/reader`) paints for the same facts; after the
 *    wrapper, the Builder sidebar flow rules (pinned in `reader-face-sidebar-flow.test.tsx`);
 *  - every other def: the 1.1.1 wrapper around the 1.1.1 bytes (`legacy-face-1.1.1.test.ts` holds the golden), with
 *    nothing of the reader added (no style, no marker attribute);
 *  - the reader face keeps the card's contract: it fails closed, ignores the block's options, takes the editor's mode,
 *    and its modal hooks are the Liquid face's (`data-certrev-modal-open`), with no network of its own.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CERTREV_LINK_REL } from '../../components/rel.js'
import { READER_CSS } from '../../reader/reader-css.generated.js'
import { renderReaderFace } from '../../reader/render.js'
import { CARD_READER_CSS } from '../card-reader-css.js'
import { CertReviewCard, type CertReviewCardProps } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import {
	builderPayload,
	chromeRoot,
	DELIVERY_URL,
	deliveryBody,
	ENTRY_ID,
	type FixtureIssuer,
	json,
	MARKER,
	makeIssuer,
	renderToHtml,
	type ScriptedDelivery,
	scriptedDelivery,
	seedOf,
	T0,
	withoutSeed,
} from './delivery-harness.js'
import { CONTENTS, RAW_DEFS } from './legacy-face-cases.js'
import { OPTIONS_ONLY_SHAPES } from './options-only-shapes.js'

const GOLDEN = JSON.parse(readFileSync(new URL('./__golden__/envelope-face-1.1.1.json', import.meta.url), 'utf8')) as {
	cases: Record<string, { html: string }>
}

/**
 * The wrapper the delivery card has always painted, spelled out (1.1.1's bytes), for a def version. Since 1.2.0 the
 * wrapper also carries `data-certrev-envelope` (the seed a browser hydrates from), so these pins are compared against
 * the markup with that one attribute taken off (`withoutSeed`), and the attribute itself is pinned in its own test.
 */
const legacyWrapper = (defVersion: number) =>
	`<div data-certrev-cert-chrome="" data-certrev-delivery="" data-certrev-strings-version="2026-07" data-certrev-def-version="${defVersion}">`
const readerWrapper = (defVersion: number) =>
	`<div data-certrev-cert-chrome="" data-certrev-delivery="" data-certrev-strings-version="2026-07" data-certrev-def-version="${defVersion}" data-certrev-face="reader" style="display:flow-root">`

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/**
 * The page without the reader's inline stylesheet and the Builder sidebar flow rules beside the wrapper, so a class
 * name asserted on is a class the markup carries.
 */
const withoutStyle = (html: string) =>
	html
		.replace(/<style data-certrev-reader-css>[\s\S]*?<\/style>/, '')
		.replace(/<style data-certrev-builder-flow="">[\s\S]*?<\/style>/, '')

describe('the reader face on the delivery card', () => {
	let issuer: FixtureIssuer
	let delivery: ScriptedDelivery
	let restore: () => void

	const card = (overrides: Partial<CertReviewCardProps> = {}) => (
		<CertReviewCard
			{...(OPTIONS_ONLY_SHAPES.todaysExport as CertReviewCardProps)}
			// No editor placement: the def's own layout decides, as a freshly dropped block does.
			mode={undefined}
			delivery={MARKER}
			builderContext={{ content: { id: ENTRY_ID } }}
			{...overrides}
		/>
	)
	const serve = (def: unknown, payload: Parameters<FixtureIssuer['envelope']>[0] = {}) => {
		delivery.respond(() => json(deliveryBody(issuer.envelope(payload), def)))
		setCardDeliveryRuntimeForTests({ resolveKid: issuer.resolveKid, fetchImpl: () => delivery.fetch, now: () => T0 })
	}
	const content = builderPayload().content
	const faceFor = (layout: 'banner' | 'sidebar' | 'floating', def: unknown, part?: 'full' | 'header' | 'memo') =>
		renderReaderFace({ content, def, layout, part, certId: 'cert_fixture_001' })

	beforeEach(() => {
		issuer = makeIssuer()
		delivery = scriptedDelivery(() => json(deliveryBody(issuer.envelope(), RAW_DEFS['face-reader'])))
		restore = setCardDeliveryRuntimeForTests({
			resolveKid: issuer.resolveKid,
			fetchImpl: () => delivery.fetch,
			now: () => T0,
			timeoutMs: 200,
		})
	})
	afterEach(() => restore())

	it('paints the wrapper, one <style> with the reader CSS, and the reader banner for the verified facts', async () => {
		const html = await renderToHtml(card())
		expect(delivery.calls).toEqual([DELIVERY_URL])
		const root = chromeRoot(html)
		const parsed = { ...RAW_DEFS['face-reader'] } as never
		expect(root).not.toBeNull()
		expect(
			withoutSeed(root ?? '').startsWith(
				`${readerWrapper(2)}<style data-certrev-reader-css>${CARD_READER_CSS}</style>`,
			),
		).toBe(true)
		expect(withoutSeed(root ?? '')).toContain(`</style>${faceFor('banner', parsed)}</div>`)
	})

	it('inlines the stylesheet exactly once per card: the portal CSS less its remote font faces', async () => {
		const html = await renderToHtml(card())
		// Two style elements: the reader CSS inside the wrapper, and the Builder sidebar flow rules after it
		// (`reader-face-sidebar-flow.test.tsx`).
		expect(html.match(/<style/g)).toHaveLength(2)
		expect(html.match(/<style data-certrev-reader-css>/g)).toHaveLength(1)
		expect(html.match(/<style data-certrev-builder-flow="">/g)).toHaveLength(1)
		expect(html).toContain(`<style data-certrev-reader-css>${CARD_READER_CSS}</style>`)
		// The portal's own sheet is unchanged (the Shopify reader and the portal still inline all of it) ...
		expect(sha256(READER_CSS)).toBe('7ce6f09e2f7cfb821de6b063d3585bcfc20b9a09e9db3df9b5505a9da803d10e')
		// ... and the card's is that sheet with 40 remote `@font-face` rules cut out (44 faces -> the 4 local() fallbacks).
		expect(READER_CSS.match(/@font-face/g)).toHaveLength(44)
		expect(CARD_READER_CSS.match(/@font-face/g)).toHaveLength(4)
		expect(html.match(/@font-face/g)).toHaveLength(4)
	})

	it('the wrapper carries the envelope seed between the def version and the face marker', async () => {
		const html = await renderToHtml(card())
		const root = chromeRoot(html) ?? ''
		const opening = /^<div [^>]*>/.exec(root)?.[0] ?? ''
		expect(opening).toMatch(
			/^<div data-certrev-cert-chrome="" data-certrev-delivery="" data-certrev-strings-version="2026-07" data-certrev-def-version="2" data-certrev-envelope="[^"]+" data-certrev-face="reader" style="display:flow-root">$/,
		)
		expect(withoutSeed(opening)).toBe(readerWrapper(2))
	})

	it('stamps the verified payload certId and the def version', async () => {
		const html = await renderToHtml(card())
		expect(html).toContain('data-certrev-cert-id="cert_fixture_001"')
		expect(html).toContain('data-certrev-def-version="2"')
	})

	it('the reader markup carries no legacy chrome', async () => {
		const html = await renderToHtml(card())
		expect(html).not.toContain('certrev-cert--banner')
		expect(html).not.toContain('data-certrev-mode=')
		expect(html).not.toContain('data-certrev-strings-version="2026-07" style=')
	})

	it('the def layout picks the reader layout, and an editor-chosen mode wins over it', async () => {
		serve(RAW_DEFS['face-reader-sidebar'])
		const bySidebarDef = withoutStyle(await renderToHtml(card()))
		expect(bySidebarDef).toContain('certrev-r-side')
		expect(bySidebarDef).not.toContain('certrev-r-bys')

		const byEditor = withoutStyle(await renderToHtml(card({ mode: 'floating' })))
		expect(byEditor).toContain('certrev-r-pill')
		expect(byEditor).not.toContain('certrev-r-side')

		const banner = withoutStyle(await renderToHtml(card({ mode: 'banner' })))
		expect(banner).toContain('certrev-r-bys')
		expect(banner).not.toContain('certrev-r-side')
	})

	it('banner part: header is the card alone, memo is the memo card alone', async () => {
		const header = await renderToHtml(card({ mode: 'banner', part: 'header' }))
		const memo = await renderToHtml(card({ mode: 'banner', part: 'memo' }))
		const full = await renderToHtml(card({ mode: 'banner', part: 'full' }))
		const def = RAW_DEFS['face-reader'] as never
		expect(header).toContain(faceFor('banner', def, 'header'))
		expect(memo).toContain(faceFor('banner', def, 'memo'))
		expect(full).toContain(faceFor('banner', def, 'full'))
		expect(header).not.toBe(memo)
	})

	it('a def that asks for the custom composition paints the reader banner (the reader has no custom face)', async () => {
		serve({
			...(RAW_DEFS['face-reader'] as object),
			layout: 'custom',
			customFace: { placedFields: ['label', 'memo'] },
		})
		const html = withoutStyle(await renderToHtml(card()))
		expect(html).toContain('certrev-r-bys')
		expect(html).not.toContain('certrev-cert--')
	})

	it('keeps the Liquid face modal hooks and adds no network of its own', async () => {
		const html = await renderToHtml(card())
		expect(html).toContain('data-certrev-modal-open')
		expect(html).toContain('data-certrev-modal-open="expert"')
		expect(html).not.toMatch(/<script/i)
		expect(html).not.toMatch(/\bonclick=|\bonload=/i)
		// One read of the Delivery API for the whole card: the face itself fetches nothing.
		expect(delivery.calls).toEqual([DELIVERY_URL])
	})

	it('every link opens the certificate or profile with CERTREV_LINK_REL, never the bare opener', async () => {
		const html = await renderToHtml(card())
		const anchors = html.match(/<a [^>]*>/g) ?? []
		expect(anchors.length).toBeGreaterThanOrEqual(2)
		for (const a of anchors) {
			expect(a, a).toContain(`rel="${CERTREV_LINK_REL}"`)
			expect(a, a).toContain('target="_blank"')
		}
	})

	it('ignores every option: a block whose options name another reviewer paints the envelope', async () => {
		const html = await renderToHtml(
			card({ reviewerName: 'Someone Else, PhD', verifyUrl: 'https://evil.example.com/x' }),
		)
		expect(html).toContain('Dr. Jane Doe')
		expect(html).not.toContain('Someone Else')
		expect(html).not.toContain('evil.example.com')
	})

	it('a def without the face keys paints the legacy face; the same def with face "reader" paints the reader', async () => {
		serve({ ...(RAW_DEFS['face-reader'] as object), face: undefined, accentFg: undefined })
		const legacy = await renderToHtml(card())
		expect(legacy).toContain('certrev-cert--banner')
		expect(legacy).not.toContain('certrev-reader')
		serve(RAW_DEFS['face-reader'])
		const reader = await renderToHtml(card())
		expect(reader).toContain('class="certrev-reader')
		expect(reader).not.toContain('certrev-cert--banner')
	})

	describe('fails closed, as the legacy face does', () => {
		const expectNothing = async () => {
			const html = await renderToHtml(card())
			expect(chromeRoot(html)).toBeNull()
			expect(html).not.toContain('Dr. Jane Doe')
			expect(html).not.toContain('certrev-reader')
			expect(html).not.toContain('data-certrev-reader-css')
		}

		it('revoked', async () => {
			const tombstone = await issuer.tombstone()
			delivery.respond(() => json(tombstone))
			await expectNothing()
		})

		it('a tampered envelope', async () => {
			const envelope = issuer.envelope()
			const tampered = {
				...envelope,
				payload: { ...envelope.payload, content: { ...envelope.payload.content, memo: 'changed after signing' } },
			}
			delivery.respond(() => json(deliveryBody(tampered, RAW_DEFS['face-reader'])))
			await expectNothing()
		})

		it('a reviewer-less content', async () => {
			const payload = issuer.envelope().payload
			serve(RAW_DEFS['face-reader'], {
				content: { ...payload.content, expert: { ...payload.content.expert, displayName: '' } },
			})
			await expectNothing()
		})
	})

	it("unreachable (1.2.0): the block's own options face, with nothing of the reader and an options record", async () => {
		delivery.respond(() => new Response('nope', { status: 503 }))
		const html = await renderToHtml(card())
		expect(chromeRoot(html)).not.toBeNull()
		// The block's memo, not the envelope's (the block names the same reviewer).
		expect(html).toContain((OPTIONS_ONLY_SHAPES.todaysExport as { memo: string }).memo)
		expect(html).not.toContain('certrev-reader')
		expect(html).not.toContain('data-certrev-reader-css')
		expect(html).not.toContain('data-certrev-delivery')
		expect(seedOf(html)).toMatchObject({ v: 1, externalId: ENTRY_ID, face: 'options' })
	})
})

describe('every other def paints the 1.1.1 wrapper around the 1.1.1 bytes, with nothing of the reader', () => {
	let issuer: FixtureIssuer
	let delivery: ScriptedDelivery
	let restore: () => void

	beforeEach(() => {
		issuer = makeIssuer()
		delivery = scriptedDelivery(() => json(deliveryBody(issuer.envelope(), null)))
		restore = setCardDeliveryRuntimeForTests({
			resolveKid: issuer.resolveKid,
			fetchImpl: () => delivery.fetch,
			now: () => T0,
			timeoutMs: 200,
		})
	})
	afterEach(() => restore())

	const legacyCard = (overrides: Partial<CertReviewCardProps> = {}) => (
		<CertReviewCard
			{...(OPTIONS_ONLY_SHAPES.todaysExport as CertReviewCardProps)}
			mode={undefined}
			delivery={MARKER}
			builderContext={{ content: { id: ENTRY_ID } }}
			{...overrides}
		/>
	)

	// The harness payload's content is the golden matrix's `full` content (same facts), so the golden answers for it.
	it('the harness content is the golden matrix content', () => {
		expect(builderPayload().content).toEqual(CONTENTS.full)
	})

	it.each([
		['elf', 4],
		['branded', 2],
		['face-legacy', 4],
		['face-unknown', 2],
		['face-capitalised', 4],
		['face-padded', 4],
		['face-empty', 4],
		['face-number', 4],
		['face-null', 4],
		['accentfg-only', 2],
		['accentfg-malformed', 2],
		['unknown-key', 4],
	])('%s', async (name, version) => {
		delivery.respond(() => json(deliveryBody(issuer.envelope(), RAW_DEFS[name])))
		const html = await renderToHtml(legacyCard())
		const golden = GOLDEN.cases[`full.${name}.default`]?.html
		expect(golden, name).toBeTruthy()
		expect(withoutSeed(chromeRoot(html) ?? '').startsWith(`${legacyWrapper(version)}${golden}</div>`)).toBe(true)
		expect(chromeRoot(html)).toContain(' data-certrev-envelope="')
		expect(html).not.toContain('data-certrev-face')
		expect(html).not.toContain('data-certrev-reader-css')
		expect(html).not.toContain('display:flow-root')
	})

	it('an editor-chosen mode on a def with an unknown face still paints the legacy face for that mode', async () => {
		delivery.respond(() => json(deliveryBody(issuer.envelope(), RAW_DEFS['face-unknown'])))
		const html = await renderToHtml(legacyCard({ mode: 'sidebar' }))
		const golden = GOLDEN.cases['full.face-unknown.sidebar']?.html
		expect(golden).toBeTruthy()
		expect(withoutSeed(chromeRoot(html) ?? '').startsWith(`${legacyWrapper(2)}${golden}</div>`)).toBe(true)
	})
})
