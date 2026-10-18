// @vitest-environment jsdom
/**
 * The reader card and its fonts. canary.2 (finding B1) had the card bring certrev.com's web fonts with it: the reader
 * stylesheet's `@font-face` rules (DM Sans, Playfair Display, Plus Jakarta Sans and JetBrains Mono, at
 * `font-stretch: 101%`, from `https://assets.certrev.com/fonts/`), inlined in the card's own markup.
 *
 * 1.2.0 REVERSES that on purpose. A storefront whose CSP `font-src` does not name assets.certrev.com (e.l.f.'s live
 * policy does not) refuses every one of those loads and logs a violation, and the text falls back anyway. The brief
 * for 1.2.0 is "no new CSP for e.l.f.: font-src is not needed", so the card now inlines `CARD_READER_CSS`: the reader
 * stylesheet minus its 40 remote `@font-face` rules, keeping the 4 `local()` fallback faces (Arial or Times New Roman
 * under each family's metric overrides), which any CSP allows. The portal and the Shopify reader keep the full sheet.
 * These tests pin the reversal: the card's document holds NO remote `@font-face` and keeps the `local()` fallbacks.
 * The modal's own `injectFontsOnce` (the legacy `CERT_FONT_FACE_CSS`, on the first open) is a different block that this
 * path neither needs nor triggers; the last test shows it never ran.
 */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { READER_CSS } from '../../reader/reader-css.generated.js'
import { CARD_READER_CSS } from '../card-reader-css.js'
import { CertReviewCard } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import {
	deliveryBody,
	ENTRY_ID,
	json,
	MARKER,
	makeIssuer,
	renderToHtml,
	scriptedDelivery,
	T0,
} from './delivery-harness.js'
import { RAW_DEFS } from './legacy-face-cases.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A `@font-face` rule as the stylesheet text spells it. */
interface Face {
	readonly family: string
	readonly stretch: string
	readonly src: string
}

/** Every `@font-face` rule in a stylesheet's text. */
function fontFaces(css: string): Face[] {
	return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
		const body = m[1] as string
		return {
			family: /font-family:\s*"([^"]+)"/.exec(body)?.[1] ?? '',
			stretch: /font-stretch:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? '',
			src: /src:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? '',
		}
	})
}

const WEB_FAMILIES = ['DM Sans', 'Playfair Display', 'Plus Jakarta Sans', 'JetBrains Mono']

let issuer: ReturnType<typeof makeIssuer>
let restore: () => void = () => {}
let container: HTMLElement | null = null
let unmount: () => void = () => {}

beforeEach(() => {
	issuer = makeIssuer()
})
afterEach(() => {
	unmount()
	unmount = () => {}
	container?.remove()
	container = null
	restore()
	document.head.innerHTML = ''
	document.body.innerHTML = ''
})

const serve = (def: unknown) => {
	const server = scriptedDelivery(() => json(deliveryBody(issuer.envelope(), def)))
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => server.fetch,
		now: () => T0,
	})
	return server
}

// `clientRead`: since 1.2.0 a card mounted in the browser with no server HTML reads only when the block opts in.
const card = (mode?: 'banner' | 'sidebar' | 'floating') => (
	<CertReviewCard delivery={MARKER} clientRead builderContext={{ content: { id: ENTRY_ID } }} mode={mode} />
)

/**
 * Mount the card in the browser only (no server HTML, a cold cache, the `clientRead` opt-in) and wait for the delivery
 * read to settle.
 */
async function mount(def: unknown, mode?: 'banner' | 'sidebar' | 'floating') {
	serve(def)
	container = document.createElement('div')
	document.body.appendChild(container)
	const root = createRoot(container)
	unmount = () => act(() => root.unmount())
	await act(async () => {
		root.render(card(mode))
	})
	for (let i = 0; i < 20; i++) {
		await act(async () => {
			await new Promise((r) => setTimeout(r, 5))
		})
	}
}

describe('the reader card brings its fonts when it mounts', () => {
	it('the reader stylesheet declares DM Sans at font-stretch 101%, from certrev.com files', () => {
		const dmSans = fontFaces(READER_CSS).filter((f) => f.family === 'DM Sans')
		expect(dmSans.length).toBeGreaterThan(0)
		for (const face of dmSans) {
			expect(face.stretch).toBe('101%')
			expect(face.src).toMatch(/^url\("https:\/\/assets\.certrev\.com\/fonts\/cert-reader-dm-sans[a-z-]*\.woff2"\)/)
		}
	})

	// canary.2's B1 asserted the opposite ("has the DM Sans @font-face at font-stretch 101% in the document"). It is
	// inverted on purpose in 1.2.0: no new CSP for e.l.f., font-src is not needed, so the card brings no remote face.
	it('a card mounted in the browser, no modal opened, has NO remote @font-face in the document and keeps the local() fallbacks', async () => {
		await mount(RAW_DEFS['face-reader'])
		expect(container?.querySelector('.certrev-reader')).not.toBeNull()

		const styles = [...document.querySelectorAll('style[data-certrev-reader-css]')]
		expect(styles).toHaveLength(1)
		expect(styles[0]?.isConnected).toBe(true)
		const text = styles[0]?.textContent ?? ''
		expect(text).toBe(CARD_READER_CSS)
		expect(text).not.toContain('https://assets.certrev.com')
		expect(text).not.toMatch(/url\(/)
		const faces = fontFaces(text)
		expect(faces.filter((f) => f.family === 'DM Sans')).toHaveLength(0)
		expect(faces.map((f) => f.family).sort()).toEqual(WEB_FAMILIES.map((f) => `${f} Fallback`).sort())
		expect(faces.every((f) => /^local\(/.test(f.src))).toBe(true)

		// The browser's own parse of it: the document's style sheets hold the four local() faces and nothing that loads.
		const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules])
		const faceRules = rules.filter((rule) => rule.cssText.startsWith('@font-face'))
		expect(faceRules).toHaveLength(4)
		expect(faceRules.some((rule) => /url\(/.test(rule.cssText))).toBe(false)
		expect(faceRules.every((rule) => /src:\s*local\(/.test(rule.cssText))).toBe(true)
		expect(faceRules.some((rule) => /font-family:\s*"?DM Sans Fallback"?;/.test(rule.cssText))).toBe(true)
	})

	it('the sheet is there for every layout', async () => {
		for (const mode of ['banner', 'sidebar', 'floating'] as const) {
			await mount(RAW_DEFS['face-reader'], mode)
			expect(document.querySelectorAll('style[data-certrev-reader-css]'), mode).toHaveLength(1)
			// 4, not the portal sheet's 44: the 40 remote faces are not shipped (see the file header).
			expect(fontFaces(document.querySelector('style[data-certrev-reader-css]')?.textContent ?? '').length, mode).toBe(
				4,
			)
			unmount()
			unmount = () => {}
			container?.remove()
			container = null
			restore()
		}
	})

	it('the server HTML carries the sheet ahead of the markup it styles', async () => {
		serve(RAW_DEFS['face-reader'])
		const html = await renderToHtml(card())
		const sheet = html.indexOf('<style data-certrev-reader-css>')
		const markup = html.indexOf('class="certrev-reader')
		expect(sheet).toBeGreaterThan(-1)
		expect(markup).toBeGreaterThan(sheet)
		const css = html.slice(sheet, html.indexOf('</style>', sheet))
		expect(css).not.toContain('https://assets.certrev.com')
		expect(
			fontFaces(css).some((f) => f.family === 'DM Sans Fallback' && f.stretch === '101%' && f.src.startsWith('local(')),
		).toBe(true)
		expect(fontFaces(css)).toHaveLength(4)
	})

	it.each([
		['sans', undefined, 'DM Sans'],
		['serif', 'serif', 'Playfair Display'],
		['grotesk', 'grotesk', 'Plus Jakarta Sans'],
		['mono', 'mono', 'JetBrains Mono'],
	] as const)('the %s brand font the card asks for falls back to a local() face, with nothing remote to load', async (_name, slot, family) => {
		const def = {
			...RAW_DEFS['face-reader'],
			tokens: { ...(RAW_DEFS['face-reader'] as { tokens: object }).tokens, fontSlot: slot },
		}
		serve(def)
		const html = await renderToHtml(card())
		// What the card asks for: the first family of the root's `--cr-bf`.
		const asked = /--cr-bf:'([^']+)'/.exec(html)?.[1]
		expect(asked).toBe(family)
		const faces = fontFaces(html.slice(html.indexOf('<style data-certrev-reader-css>'), html.indexOf('</style>')))
		// The web family is still named first in the stack (a page that has the font uses it) ...
		expect(faces.some((f) => f.family === asked)).toBe(false)
		// ... and the metric-matched local() fallback face that follows it in the stack is declared.
		expect(
			faces.some((f) => f.family === `${asked} Fallback` && f.stretch === '101%' && f.src.startsWith('local(')),
		).toBe(true)
		expect(faces.some((f) => f.src.startsWith('url('))).toBe(false)
	})

	it('every family the stylesheet asks for outside an @font-face has a face in it (the "* Fallback" faces read a local font)', () => {
		const rules = READER_CSS.replace(/@font-face\s*\{[^}]*\}/g, '')
		const asked = new Set<string>()
		for (const decl of rules.matchAll(/font-family:\s*([^;]+);/g)) {
			for (const name of (decl[1] as string).matchAll(/"([^"]+)"/g)) asked.add(name[1] as string)
		}
		// "Segoe UI" is an OS font in a system stack, not a web font.
		asked.delete('Segoe UI')
		expect([...asked].sort()).toEqual(
			[...WEB_FAMILIES, ...WEB_FAMILIES.map((f) => `${f} Fallback`)].filter((f) => asked.has(f)).sort(),
		)
		const declared = new Set(fontFaces(READER_CSS).map((f) => f.family))
		for (const family of asked) expect(declared.has(family), family).toBe(true)
		expect(asked.has('DM Sans')).toBe(true)
		expect(asked.has('JetBrains Mono')).toBe(true)
	})

	it('every "* Fallback" family the card sheet asks for is declared in it, as a local() face', () => {
		const rules = CARD_READER_CSS.replace(/@font-face\s*\{[^}]*\}/g, '')
		const asked = new Set<string>()
		for (const decl of rules.matchAll(/font-family:\s*([^;]+);/g)) {
			for (const name of (decl[1] as string).matchAll(/"([^"]+)"/g)) asked.add(name[1] as string)
		}
		const fallbacks = [...asked].filter((f) => f.endsWith(' Fallback'))
		expect(fallbacks.length).toBeGreaterThan(0)
		const declared = new Map(fontFaces(CARD_READER_CSS).map((f) => [f.family, f.src]))
		for (const family of fallbacks) expect(declared.get(family), family).toMatch(/^local\(/)
	})

	it("the modal's own font injection never ran: the faces came from the card alone", async () => {
		await mount(RAW_DEFS['face-reader'])
		expect(document.querySelector('style[data-certrev-modal-fonts]')).toBeNull()
		expect(document.querySelector('link[data-certrev-modal-preconnect]')).toBeNull()
		expect(document.querySelector('certrev-cert-modal')).toBeNull()
		// ...and the page's own head holds nothing of the card's: the sheet rides in the card, not in a shared place.
		expect(document.head.querySelector('style')).toBeNull()
	})
})
