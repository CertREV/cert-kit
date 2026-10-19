/**
 * 1.3.0, server renders: the delivery card paints the server-rendered face served beside the artifact ONLY when its
 * bytes hash to the signed `content.faceDigest` for the def served with it, on an unpinned block that shows the whole
 * card. Every other delivery renders what 1.2.1 rendered, byte for byte, seed included: the golden was rendered by the
 * unmodified 1.2.1 tree for the same deliveries (`delivered-face-shapes.ts`), not by this one.
 *
 * Real crypto throughout: the envelopes are signed with a fixed fixture key and the kernel runs; the face digests are
 * computed with Node's `createHash`, the card hashes with WebCrypto.
 */

import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CERT_STRINGS_VERSION } from '../../components/render-def.js'
import { CertReviewCard, type CertReviewCardProps } from '../cert-review-card.js'
import { acceptedFaceDigest, sha256HexUtf8, showsWholeCard } from '../delivered-face.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import { parseSeed, serializeSeed } from '../ssr-seed.js'
import {
	type CaseProps,
	DEFS,
	DELIVERED_FACE,
	type DefName,
	faceDigestFor,
	fixedIssuer,
	matchingBody,
	PIN_CONTEXT,
	serverCases,
	sha256Hex,
	withFaceDigest,
} from './delivered-face-shapes.js'
import {
	chromeRoot,
	DELIVERY_URL,
	ENTRY_ID,
	json,
	MARKER,
	renderToHtml,
	type ScriptedDelivery,
	scriptedDelivery,
	seedOf,
	T0,
} from './delivery-harness.js'
import { OPTIONS_ONLY_SHAPES } from './options-only-shapes.js'

interface Golden {
	readonly generatedFrom: string
	readonly readerCssPlaceholder: string
	readonly readerCss: string
	readonly cases: Record<string, number>
	readonly outputs: string[]
}
const SERVER = JSON.parse(
	readFileSync(new URL('./__golden__/delivered-face-1.2.1.json', import.meta.url), 'utf8'),
) as Golden
const CLIENT = JSON.parse(
	readFileSync(new URL('./__golden__/delivered-face-client-1.2.1.json', import.meta.url), 'utf8'),
) as { readonly seedsWithFace: Record<DefName, string> }

/** What 1.2.1 streamed for one server case, with the reader stylesheet put back. */
const golden121 = (name: string): string => {
	const at = SERVER.cases[name]
	if (at === undefined) throw new Error(`no golden for ${name}`)
	return SERVER.outputs[at].split(SERVER.readerCssPlaceholder).join(SERVER.readerCss)
}

/** React's attribute escaping (`escapeTextForBrowser`). */
const attr = (raw: string) =>
	raw.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * What the card streams for a matching delivery: the 1.2.1 wrapper attributes, the seed (the 1.2.1 seed for the same
 * envelope with `face` appended, built by the 1.2.1 generator), `data-certrev-face="delivered"`, the stylesheet, the
 * markup.
 */
const deliveredOutput = (seed: string, face: { html: string; css: string } = DELIVERED_FACE, defVersion = 4) =>
	`<!--$--><div data-certrev-cert-chrome="" data-certrev-delivery="" data-certrev-strings-version="${CERT_STRINGS_VERSION}" data-certrev-def-version="${defVersion}" data-certrev-envelope="${attr(seed)}" data-certrev-face="delivered"><style>${face.css}</style>${face.html}</div><!--/$-->`

const issuer = fixedIssuer()
let delivery: ScriptedDelivery
let clock: number
let restore: () => void

/** The block as the portal exports it (options beside the marker), with a case's part or pin, or any other prop. */
const card = (props: CaseProps | ({ readonly pinned?: true } & Partial<CertReviewCardProps>) = {}) => {
	const { pinned, ...rest } = props as { readonly pinned?: true } & Partial<CertReviewCardProps>
	return (
		<CertReviewCard
			{...(OPTIONS_ONLY_SHAPES.todaysExport as CertReviewCardProps)}
			delivery={MARKER}
			builderContext={{ content: { id: ENTRY_ID }, ...(pinned ? { context: PIN_CONTEXT } : {}) }}
			{...rest}
		/>
	)
}

beforeEach(() => {
	clock = T0
	delivery = scriptedDelivery(() => json(matchingBody(issuer)))
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => delivery.fetch,
		now: () => clock,
		timeoutMs: 200,
	})
})
afterEach(() => restore())

describe('sha256HexUtf8 and the digest shape', () => {
	it('is the lowercase hex sha256 of the UTF-8 bytes', async () => {
		expect(await sha256HexUtf8('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
		expect(await sha256HexUtf8('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
		expect(await sha256HexUtf8(DELIVERED_FACE.html)).toBe(sha256Hex(DELIVERED_FACE.html))
		expect(await sha256HexUtf8(DELIVERED_FACE.css)).toBe(sha256Hex(DELIVERED_FACE.css))
	})

	it('accepts only the cert-contract 0.6.0 digest shape', () => {
		const digest = faceDigestFor(DELIVERED_FACE, 4)
		const content = (d: unknown) => withFaceDigest(d).content
		expect(acceptedFaceDigest(content(digest))).toEqual(digest)
		expect(acceptedFaceDigest(content(undefined))).toBeNull()
		expect(acceptedFaceDigest(content({ ...digest, v: 2 }))).toBeNull()
		expect(acceptedFaceDigest(content({ ...digest, defVersion: '4' }))).toBeNull()
		expect(acceptedFaceDigest(content({ ...digest, html: digest.html.toUpperCase() }))).toBeNull()
		expect(acceptedFaceDigest(content({ ...digest, css: digest.css.slice(1) }))).toBeNull()
		expect(acceptedFaceDigest(content([digest]))).toBeNull()
	})

	it("a whole card is every part but 'header' and 'memo', by renderCertBlock's rule", () => {
		for (const part of [undefined, null, 'full', 'bogus', 3]) expect(showsWholeCard(part)).toBe(true)
		for (const part of ['header', 'memo']) expect(showsWholeCard(part)).toBe(false)
	})
})

describe('the matching delivery paints the delivered face', () => {
	it.each(
		Object.keys(DEFS) as DefName[],
	)('%s def: in the card wrapper, stylesheet first, marked delivered, its seed the 1.2.1 seed plus the face', async (defName) => {
		delivery.respond(() => json(matchingBody(issuer, DEFS[defName])))
		const html = await renderToHtml(card())
		expect(delivery.calls).toEqual([DELIVERY_URL])
		expect(html).toBe(deliveredOutput(CLIENT.seedsWithFace[defName]))
		// The face replaces the card's own; nothing of either 1.2.1 face, and (a reader def) no reader stylesheet.
		expect(html).not.toContain('certrev-cert--')
		expect(html).not.toContain('certrev-reader')
		expect(html).not.toContain('data-certrev-builder-flow')
		const seed = seedOf(html)
		expect(seed?.face).toEqual(DELIVERED_FACE)
		// Without the face, the seed is exactly the one 1.2.1 wrote for the same envelope.
		const { face: _face, ...rest } = JSON.parse(CLIENT.seedsWithFace[defName]) as Record<string, unknown>
		expect(Object.keys(seed ?? {}).at(-1)).toBe('face')
		expect(golden121(`${defName}.matching`)).toContain(`data-certrev-envelope="${attr(JSON.stringify(rest))}"`)
	})

	it.each([
		["'full'", 'full'],
		['null (Builder clears a select to null)', null],
	] as const)('on a block that shows the whole card: part %s', async (_label, part) => {
		const html = await renderToHtml(card({ part }))
		expect(html).toBe(deliveredOutput(CLIENT.seedsWithFace.legacy))
	})

	it('two cards on one page share one read and one hash', async () => {
		const digest = vi.spyOn(globalThis.crypto.subtle, 'digest')
		try {
			const page = (
				<>
					{card()}
					{card({ mode: 'sidebar' })}
				</>
			)
			const html = await renderToHtml(page)
			expect(html.split('data-certrev-face="delivered"').length - 1).toBe(2)
			expect(await renderToHtml(page)).toBe(html)
			expect(delivery.calls).toHaveLength(1)
			// One digest per half, for the one face, across both cards and both renders.
			expect(digest).toHaveBeenCalledTimes(2)
		} finally {
			digest.mockRestore()
		}
	})

	it('a new face and digest land with the next verified read, after the cache TTL', async () => {
		expect(await renderToHtml(card())).toBe(deliveredOutput(CLIENT.seedsWithFace.legacy))
		const next = { html: '<aside class="crv-face-v5">Reviewed</aside>', css: '.crv-face-v5{color:#e6007e}' }
		const def = { ...DEFS.legacy, v: 5 }
		delivery.respond(() =>
			json({ ...issuer.envelope(withFaceDigest(faceDigestFor(next, 5))), renderDef: def, face: next }),
		)
		clock = T0 + 61_000
		// Past the TTL the cached face paints while one refresh runs (1.2.0's stale window); the refresh brings the new one.
		expect(await renderToHtml(card())).toBe(deliveredOutput(CLIENT.seedsWithFace.legacy))
		let after = ''
		for (let i = 0; i < 20 && !after.includes('data-certrev-def-version="5"'); i++) after = await renderToHtml(card())
		expect(after).toContain(`data-certrev-def-version="5"`)
		expect(after).toContain(`data-certrev-face="delivered"><style>${next.css}</style>${next.html}</div>`)
		expect(seedOf(after)?.face).toEqual(next)
		expect(delivery.calls).toHaveLength(2)
	})
})

describe("every other delivery renders 1.2.1's output, byte for byte, seed included", () => {
	it('the golden covers exactly the shapes matrix, generated by 1.2.1', async () => {
		expect(SERVER.generatedFrom).toMatch(/@certrev\/cert-block@1\.2\.1/)
		expect(Object.keys(SERVER.cases).sort()).toEqual(Object.keys(await serverCases(issuer)).sort())
	})

	const DELIVERED = new Set(Object.keys(DEFS).map((d) => `${d}.matching`))
	for (const name of Object.keys(SERVER.cases).filter((n) => !DELIVERED.has(n))) {
		it(name, async () => {
			const c = (await serverCases(issuer))[name]
			delivery.respond(() => json(c.body))
			const html = await renderToHtml(card(c.props))
			expect(html).toBe(golden121(name))
			expect(html).not.toContain('data-certrev-face="delivered"')
			expect(html).not.toContain('crv-face')
		})
	}

	it.each(
		Object.keys(DEFS) as DefName[],
	)('%s def: a WebCrypto failure renders 1.2.1 output for the matching delivery, never the delivered face', async (defName) => {
		const digest = vi.spyOn(globalThis.crypto.subtle, 'digest').mockRejectedValue(new Error('no digest here'))
		try {
			delivery.respond(() => json(matchingBody(issuer, DEFS[defName])))
			const html = await renderToHtml(card())
			expect(digest).toHaveBeenCalled()
			expect(html).toBe(golden121(`${defName}.matching`))
		} finally {
			digest.mockRestore()
		}
	})

	it('a split banner block never hashes the face (there is nothing to decide)', async () => {
		const digest = vi.spyOn(globalThis.crypto.subtle, 'digest')
		try {
			expect(await renderToHtml(card({ part: 'header' }))).toBe(golden121('legacy.partHeader'))
			expect(await renderToHtml(card({ part: 'memo' }))).toBe(golden121('legacy.partMemo'))
			expect(digest).not.toHaveBeenCalled()
		} finally {
			digest.mockRestore()
		}
	})

	it('a split banner (header block + memo block on one page) never shows the delivered face', async () => {
		const html = await renderToHtml(
			<>
				{card({ part: 'header' })}
				{card({ part: 'memo' })}
			</>,
		)
		expect(html).toBe(golden121('legacy.partHeader') + golden121('legacy.partMemo'))
	})
})

describe('fails closed as 1.2.1 does: nothing and a none record', () => {
	const none = () => golden121('tombstoneWithFace')

	it('a digest rewritten to match other markup (the signature no longer verifies)', async () => {
		const env = issuer.envelope(withFaceDigest(faceDigestFor(DELIVERED_FACE, 4)))
		const evil = { html: '<p class="crv-evil">Endorsed by every dermatologist</p>', css: '.crv-evil{color:red}' }
		const tampered = {
			...env,
			payload: { ...env.payload, content: { ...env.payload.content, faceDigest: faceDigestFor(evil, 4) } },
		}
		delivery.respond(() => json({ ...tampered, renderDef: DEFS.legacy, face: evil }))
		const html = await renderToHtml(card())
		expect(html).toBe(none())
		expect(chromeRoot(html)).toBeNull()
		expect(html).not.toContain('crv-')
	})

	it('a digest stripped from the signed content', async () => {
		const env = issuer.envelope(withFaceDigest(faceDigestFor(DELIVERED_FACE, 4)))
		const { faceDigest: _dropped, ...content } = env.payload.content
		delivery.respond(() =>
			json({ ...env, payload: { ...env.payload, content }, renderDef: DEFS.legacy, face: DELIVERED_FACE }),
		)
		expect(await renderToHtml(card())).toBe(none())
	})

	it('a matching face on an expired envelope', async () => {
		const base = issuer.envelope().payload
		delivery.respond(() =>
			json({
				...issuer.envelope(
					withFaceDigest(faceDigestFor(DELIVERED_FACE, 4), {
						lifecycle: { ...base.lifecycle, expiresAt: '2026-09-01T00:00:00.000Z' },
					}),
				),
				renderDef: DEFS.legacy,
				face: DELIVERED_FACE,
			}),
		)
		expect(await renderToHtml(card())).toBe(none())
	})
})

describe('the seed record (1.3.0)', () => {
	const seedWithFace = () => parseSeed(CLIENT.seedsWithFace.legacyAll)

	it('parses the face, and writes it back last, byte for byte', () => {
		const seed = seedWithFace()
		expect(seed?.face).toEqual(DELIVERED_FACE)
		expect(seed?.signature).toBeDefined()
		if (!seed) throw new Error('no seed')
		expect(serializeSeed(seed)).toBe(CLIENT.seedsWithFace.legacyAll)
	})

	it('a seed with no face, or a malformed one, is the seed without it (and writes the 1.2.1 bytes)', () => {
		const raw = JSON.parse(CLIENT.seedsWithFace.legacyAll) as Record<string, unknown>
		const { face: _face, ...withoutFace } = raw
		const plain = JSON.stringify(withoutFace)
		for (const face of [undefined, null, 'x', [], { html: 1, css: '' }, { html: '' }]) {
			const seed = parseSeed(JSON.stringify(face === undefined ? withoutFace : { ...withoutFace, face }))
			expect(seed).not.toBeNull()
			expect(seed).not.toHaveProperty('face')
			if (!seed) throw new Error('no seed')
			expect(serializeSeed(seed)).toBe(plain)
		}
	})
})
