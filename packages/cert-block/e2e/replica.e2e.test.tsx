/**
 * cert-block 2.0 on a Hydrogen-shaped Builder replica, in Chromium (Playwright 1.59.1): the contract-1 card as a
 * reader gets it, at 1280 and 393 px.
 *
 *  - SC2: each part host the block prints renders the same shadow tree, byte for byte, as the same part printed on its
 *    own (the way the Appearance preview prints it), and the same pixels.
 *  - SC3 (local): the sidebar's 'Read the expert memo' fold on a phone; the profile and certificate dialogs open from
 *    their controls, keep focus inside, close on Escape and give focus back; after an in-app navigation too.
 *  - SC4: under a policy whose only CertREV sources are `script-src`/`connect-src https://portal.certrev.com` and
 *    `font-src`/`img-src https://assets.certrev.com`, no violation; removing any one of them produces one.
 *
 * Run: `pnpm test:replica` (needs Chromium for Playwright 1.59.1 under PLAYWRIGHT_BROWSERS_PATH). Writes its measurements
 * and one screenshot per cell to `CERT_BLOCK_E2E_OUT` (default `e2e/.out`).
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright-core'
import { version } from 'react'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ReplicaArticle } from './replica/app.js'
import {
	type CertrevDirective,
	type CertrevSide,
	type CspOptions,
	certrevSide,
	type Placement,
	previewParity,
	type ReplicaServer,
	routeCertrev,
	startReplica,
} from './replica/harness.js'

const OUT = process.env.CERT_BLOCK_E2E_OUT ?? join(process.cwd(), 'e2e/.out')
mkdirSync(OUT, { recursive: true })

const PLACEMENTS: Placement[] = [
	{ entryId: 'replica-banner', fixture: 'banner-elf-like' },
	{ entryId: 'replica-sidebar', fixture: 'sidebar-elf-like' },
	{ entryId: 'replica-floating', fixture: 'floating-elf-like' },
	{ entryId: 'replica-toned', fixture: 'sidebar-saved-3-toned' },
	{ entryId: 'replica-split', fixture: 'banner-elf-like' },
	{ entryId: 'replica-next', fixture: 'sidebar-elf-like', rotated: true },
	{ entryId: 'replica-revoked', fixture: 'sidebar-elf-like' },
	// 2.0.1: CertREV not reached, and the placement hints (Owen: the reviewer after the byline, the memo at the end).
	{ entryId: 'replica-unreachable', fixture: 'banner-elf-like', unreachable: true },
	{
		entryId: 'replica-placed',
		fixture: 'banner-elf-like',
		placement: { top: { anchor: 'after-byline' }, bottom: { anchor: 'content-end' } },
	},
	{ entryId: 'replica-hinted', fixture: 'banner-elf-like' },
	...Object.values(previewParity().cases).map((c) => ({
		entryId: c.externalId,
		fixture: 'banner-elf-like' as const,
		painted: { card: c.builderCard, content: c.content, lifecycle: c.lifecycle, renderDef: c.renderDef },
	})),
]

const ARTICLES: ReplicaArticle[] = [
	{ path: '/blogs/the-elf-word/banner', title: 'Retinol, banner card', entryId: 'replica-banner' },
	{ path: '/blogs/the-elf-word/sidebar', title: 'Retinol, sidebar card', entryId: 'replica-sidebar' },
	{ path: '/blogs/the-elf-word/floating', title: 'Retinol, floating card', entryId: 'replica-floating' },
	{ path: '/blogs/the-elf-word/toned', title: 'Retinol, toned sidebar', entryId: 'replica-toned' },
	{
		path: '/blogs/the-elf-word/split',
		title: 'Retinol, split banner',
		entryId: 'replica-split',
		part: 'header',
		memoBlock: true,
		// 2.0.1: as mission e60680df22f2's e.l.f. export lays it out (the byline is in the template, above the body).
		references: true,
	},
	{ path: '/blogs/the-elf-word/next', title: 'Next article', entryId: 'replica-next' },
	{ path: '/blogs/the-elf-word/revoked', title: 'Retinol, revoked', entryId: 'replica-revoked' },
	{ path: '/blogs/the-elf-word/no-marker', title: 'Retinol, no marker', entryId: 'replica-nomarker', noMarker: true },
	{ path: '/blogs/the-elf-word/unreachable', title: 'Retinol, CertREV down', entryId: 'replica-unreachable' },
	{
		path: '/blogs/the-elf-word/placed',
		title: 'Retinol, placed by the hints',
		entryId: 'replica-placed',
		hero: true,
		byline: true,
		cardAt: 2,
	},
	{
		path: '/blogs/the-elf-word/hinted',
		title: 'Retinol, default hints',
		entryId: 'replica-hinted',
		hero: true,
		references: true,
		cardAt: 2,
	},
	...Object.entries(previewParity().cases).map(([name, c]) => ({
		path: `/blogs/the-elf-word/preview-${name}`,
		title: `Retinol, the preview's ${name}`,
		entryId: c.externalId,
	})),
]
const VIEWPORTS = [
	{ name: '1280', width: 1280, height: 900 },
	{ name: '393', width: 393, height: 852 },
] as const

/** The page's policy: its own baseline and exactly the four CertREV sources (no `data:` images: the logo is inline SVG). */
const STRICT: CspOptions = { dataImages: false }

let browser: Browser
let side: CertrevSide
let server: ReplicaServer
const evidence: Record<string, unknown> = {}

beforeAll(async () => {
	browser = await chromium.launch()
	side = certrevSide(PLACEMENTS)
	server = await startReplica(side, ARTICLES, STRICT)
	evidence.browser = browser.version()
	evidence.react = version
	evidence.runtime = { src: side.runtime.src, integrity: side.runtime.integrity, from: 'S2 9d8f844e5c (PR #8352)' }
}, 120_000)

afterAll(async () => {
	writeFileSync(join(OUT, 'replica-evidence.json'), `${JSON.stringify(evidence, null, '\t')}\n`)
	await server?.close()
	await browser?.close()
})

interface Watched {
	readonly page: Page
	readonly context: BrowserContext
	readonly violations: { directive: string; blocked: string }[]
	readonly requests: string[]
	readonly errors: string[]
}

async function open(
	viewport: (typeof VIEWPORTS)[number],
	options: { js?: boolean; noSetHtml?: boolean } = {},
): Promise<Watched> {
	const context = await browser.newContext({
		viewport: { width: viewport.width, height: viewport.height },
		deviceScaleFactor: 1,
		javaScriptEnabled: options.js !== false,
	})
	const page = await context.newPage()
	const violations: Watched['violations'] = []
	const requests: string[] = []
	const errors: string[] = []
	page.on('console', (msg) => {
		const text = msg.text()
		if (/Content Security Policy/i.test(text)) {
			const directive =
				/directive: "([^"]+)"/.exec(text)?.[1] ?? /violates the following[^"]*"([^" ]+)/.exec(text)?.[1] ?? 'unknown'
			violations.push({ directive, blocked: text.slice(0, 160) })
		} else if (msg.type() === 'error' && !/Failed to load resource/.test(text)) errors.push(text)
		// 2.0.1: Chrome's warning for a declarative template written through innerHTML counts as an error here.
		else if (msg.type() === 'warning' && /shadowrootmode|declarative Shadow DOM/i.test(text)) errors.push(text)
	})
	page.on('pageerror', (e) => errors.push(String(e)))
	if (options.noSetHtml) {
		await page.addInitScript(() => {
			// A browser without setHTMLUnsafe: the card attaches its roots from the templates.
			delete (Element.prototype as unknown as { setHTMLUnsafe?: unknown }).setHTMLUnsafe
			delete (ShadowRoot.prototype as unknown as { setHTMLUnsafe?: unknown }).setHTMLUnsafe
		})
	}
	await routeCertrev(page, side, requests)
	return { page, context, violations, requests, errors }
}

async function settle(page: Page) {
	await page.waitForLoadState('networkidle')
	await page.waitForTimeout(150)
}

const article = (entryId: string) => ARTICLES.find((a) => a.entryId === entryId) as ReplicaArticle

/** Each host the page's card wrappers hold: its part, whether it has a root, the root's HTML and its painted box. */
async function hosts(page: Page) {
	return page.evaluate(() =>
		Array.from(document.querySelectorAll('[data-certrev-face="card"] > certrev-card, #bare > certrev-card')).map(
			(host) => {
				const root = (host as HTMLElement).shadowRoot
				const boxes = root
					? Array.from(root.querySelectorAll('*'))
							// What is rendered only: a closed <details> keeps boxes for its hidden content.
							.filter((el) => el.checkVisibility())
							.map((el) => el.getBoundingClientRect())
							.filter((r) => r.width > 0 && r.height > 0)
					: []
				const box =
					boxes.length === 0
						? null
						: {
								x: Math.min(...boxes.map((r) => r.left)) + window.scrollX,
								y: Math.min(...boxes.map((r) => r.top)) + window.scrollY,
								right: Math.max(...boxes.map((r) => r.right)) + window.scrollX,
								bottom: Math.max(...boxes.map((r) => r.bottom)) + window.scrollY,
							}
				const hostBox = host.getBoundingClientRect()
				return {
					part: host.getAttribute('data-certrev-part') ?? '',
					attached: root !== null,
					html: root?.innerHTML ?? null,
					box,
					host: { x: hostBox.left + window.scrollX, y: hostBox.top + window.scrollY, width: hostBox.width },
					fixed: getComputedStyle(host).position === 'fixed',
				}
			},
		),
	)
}

/**
 * A pinned part (the floating pill) sits over the article, so its edges and shadow blend with whatever text is behind
 * it; the page's own text is hidden for that capture, and the part is compared on the same white as the part alone.
 */
async function hidePageBehind(page: Page) {
	await page.evaluate(() => {
		for (const el of Array.from(document.querySelectorAll('header, h1, .builder-block p'))) {
			;(el as HTMLElement).style.visibility = 'hidden'
		}
	})
}

/** Pixel difference of two PNG screenshots, decoded by the browser itself. */
async function pixelDiff(a: Buffer, b: Buffer): Promise<{ width: number; height: number; differing: number }> {
	const context = await browser.newContext()
	const page = await context.newPage()
	try {
		return await page.evaluate(
			async ([pa, pb]) => {
				const load = (src: string) =>
					new Promise<HTMLImageElement>((resolve, reject) => {
						const img = new Image()
						img.onload = () => resolve(img)
						img.onerror = reject
						img.src = src
					})
				const [ia, ib] = await Promise.all([load(pa), load(pb)])
				if (ia.width !== ib.width || ia.height !== ib.height) return { width: -1, height: -1, differing: -1 }
				const data = (img: HTMLImageElement) => {
					const canvas = document.createElement('canvas')
					canvas.width = img.width
					canvas.height = img.height
					const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
					ctx.drawImage(img, 0, 0)
					return ctx.getImageData(0, 0, img.width, img.height).data
				}
				const da = data(ia)
				const db = data(ib)
				let differing = 0
				for (let i = 0; i < da.length; i += 4) {
					if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2] || da[i + 3] !== db[i + 3])
						differing++
				}
				return { width: ia.width, height: ia.height, differing }
			},
			[`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`],
		)
	} finally {
		await context.close()
	}
}

/** The deep focused element's description: inside which host and dialog, and the element itself. */
async function deepFocus(page: Page) {
	return page.evaluate(() => {
		let el: Element | null = document.activeElement
		const chain: string[] = []
		while (el && (el as HTMLElement).shadowRoot?.activeElement) {
			chain.push(
				el.tagName.toLowerCase() +
					(el.getAttribute('data-certrev-part') ? `[${el.getAttribute('data-certrev-part')}]` : ''),
			)
			el = (el as HTMLElement).shadowRoot?.activeElement ?? null
		}
		const tag = el?.tagName.toLowerCase() ?? null
		const dialog = el?.closest('dialog')?.id ?? null
		return {
			chain,
			tag,
			inDialog: dialog,
			// Where focus is: in a dialog, on nothing of the page (the browser's own UI: `body` is the active element), or
			// on another element of the page (which a modal dialog must never allow).
			where: dialog ? `dialog:${dialog}` : !el || tag === 'body' ? 'browser' : `page:${tag}`,
			modalOpen:
				el?.getAttribute('data-certrev-modal-open') ?? (el?.hasAttribute('data-certrev-modal-open') ? '' : null),
		}
	})
}

/** The placement's dialog of this kind: whether one is open (and modal), and in which card wrapper (page order). */
async function dialogState(page: Page, part: 'dialog-expert' | 'dialog-certificate', entryId: string) {
	return page.evaluate(
		([p, id]) => {
			const hosts = Array.from(
				document.querySelectorAll(`certrev-card[data-certrev-part="${p}"][data-certrev-external-id="${id}"]`),
			)
			const dialogs = hosts.map((h) => h.shadowRoot?.querySelector('dialog') ?? null)
			const open = dialogs.find((d) => d?.open) ?? null
			const wrappers = Array.from(document.querySelectorAll('[data-certrev-face="card"]'))
			const host = open ? hosts[dialogs.indexOf(open)] : null
			return {
				hosts: hosts.length,
				exists: dialogs.some((d) => d !== null),
				open: open !== null,
				modal: open ? open.matches(':modal') : false,
				wrapper: host ? wrappers.indexOf(host.parentElement as Element) : null,
			}
		},
		[part, entryId] as const,
	)
}

/**
 * Open a dialog from its control with the keyboard, walk Tab inside it, close it with Escape; then mouse and ×. The
 * dialog that opens is the page's one dialog for the placement: in the control's own wrapper, or in `dialogWrapper` (the
 * index of the wrapper that printed the dialogs, for a control in a block that prints its part only).
 */
async function exerciseDialogs(
	page: Page,
	entryId: string,
	partSelector: string,
	cell: string,
	dialogWrapper?: number,
) {
	const results: Record<string, unknown> = {}
	for (const [kind, attr, part] of [
		['profile', '[data-certrev-modal-open="expert"]', 'dialog-expert'],
		['certificate', '[data-certrev-modal-open=""]', 'dialog-certificate'],
	] as const) {
		const control = page.locator(`certrev-card${partSelector}[data-certrev-external-id="${entryId}"] a${attr}`).first()
		await control.scrollIntoViewIfNeeded()
		await control.focus()
		await page.keyboard.press('Enter')
		await page.waitForTimeout(100)
		const opened = await dialogState(page, part, entryId)
		const focusOnOpen = await deepFocus(page)
		const tabbed: string[] = []
		for (let i = 0; i < 6; i++) {
			await page.keyboard.press('Tab')
			tabbed.push((await deepFocus(page)).where)
		}
		await page.screenshot({ path: join(OUT, `${cell}-${kind}-dialog.png`) })
		await page.keyboard.press('Escape')
		await page.waitForTimeout(100)
		const closed = await dialogState(page, part, entryId)
		const focusAfter = await deepFocus(page)
		// Mouse, then the dialog's own close control.
		await control.click()
		await page.waitForTimeout(100)
		const reopened = await dialogState(page, part, entryId)
		await page
			.locator(
				`certrev-card[data-certrev-part="${part}"][data-certrev-external-id="${entryId}"] dialog[open] [data-certrev-modal-close].crm-close`,
			)
			.click()
		await page.waitForTimeout(100)
		const closedByButton = await dialogState(page, part, entryId)
		results[kind] = { opened, focusOnOpen, tabbed, closed, focusAfter, reopened, closedByButton }
		expect(opened, `${cell} ${kind}: opened`).toMatchObject({ exists: true, open: true, modal: true })
		// The dialog that opens is the page's one dialog for this placement (2.0.1: a part the document's hints moved
		// opens the dialog its card block printed). Where a cell knows which wrapper printed it, it says so.
		expect(opened.hosts, `${cell} ${kind}: one dialog host on the page`).toBe(1)
		if (dialogWrapper !== undefined) expect(opened.wrapper, `${cell} ${kind}: the page's dialog`).toBe(dialogWrapper)
		expect(focusOnOpen.inDialog, `${cell} ${kind}: focus moves into the dialog`).toBe(
			part === 'dialog-expert' ? 'expert' : 'cert',
		)
		// CertREV's runtime traps focus in the open dialog: Tab cycles through the dialog's controls and never leaves it.
		const here = `dialog:${part === 'dialog-expert' ? 'expert' : 'cert'}`
		expect(tabbed, `${cell} ${kind}: Tab stays in the dialog`).toEqual(Array(tabbed.length).fill(here))
		expect(closed.open, `${cell} ${kind}: Escape closes`).toBe(false)
		expect(focusAfter.modalOpen, `${cell} ${kind}: focus returns to the control`).toBe(
			kind === 'profile' ? 'expert' : '',
		)
		expect(reopened.open && !closedByButton.open, `${cell} ${kind}: mouse open and close`).toBe(true)
	}
	return results
}

describe.each(VIEWPORTS)('at $name px', (viewport) => {
	it.each([
		['banner', 'replica-banner'],
		['sidebar', 'replica-sidebar'],
		['floating', 'replica-floating'],
		['toned sidebar', 'replica-toned'],
	])(
		'%s: server-rendered, hydrated, every part equal to the part printed alone (DOM and pixels), dialogs work, no CSP violation',
		async (label, entryId) => {
			const cell = `${entryId}-${viewport.name}`
			const w = await open(viewport)
			try {
				// 2.0.1: the hosts the browser's parser built from the server's page.
				await w.page.addInitScript(() =>
					document.addEventListener('DOMContentLoaded', () => {
						;(window as unknown as { __serverHosts: Element[] }).__serverHosts = Array.from(
							document.querySelectorAll('certrev-card'),
						)
					}),
				)
				await w.page.goto(`${server.origin}${article(entryId).path}`)
				await settle(w.page)
				const printed = await hosts(w.page)
				const card = side.cards.get(entryId)
				expect(card).toBeDefined()
				expect(printed.length).toBeGreaterThan(2)
				expect(printed.every((h) => h.attached)).toBe(true)
				// Hydration and the render right after it keep those very nodes: React never rewrites the card (React 19
				// rewrites an element's HTML whenever its dangerouslySetInnerHTML is a new object).
				const kept = await w.page.evaluate(() => {
					const before = (window as unknown as { __serverHosts: Element[] }).__serverHosts ?? []
					const now = Array.from(document.querySelectorAll('certrev-card'))
					return { before: before.length, now: now.length, same: now.every((h) => before.includes(h)) }
				})
				expect(kept, `${cell}: the server's hosts kept`).toEqual({
					before: printed.length,
					now: printed.length,
					same: true,
				})
				const parts = printed.filter((h) => !h.part.startsWith('dialog-'))
				const equal: Record<string, unknown> = {}
				for (const h of parts) {
					// The same part printed alone, the Appearance preview's way, at the replica host's own place and width.
					const bare = await open(viewport)
					try {
						// Print the part alone at the replica host's width, then move it so its painted box lands on the
						// replica's exact (sub-pixel) coordinates: the two rasterisations are then comparable pixel for pixel.
						const goBare = async (x: number, y: number) => {
							const q = new URLSearchParams({ x: String(x), y: String(y), w: String(h.host.width) })
							await bare.page.goto(`${server.origin}/bare/${entryId}/${h.part}?${q}`)
							await settle(bare.page)
						}
						await goBare(h.host.x, h.host.y)
						const first = (await hosts(bare.page)).find((x) => x.part === h.part)?.box
						if (first && h.box && !h.fixed) await goBare(h.host.x + (h.box.x - first.x), h.host.y + (h.box.y - first.y))
						const alone = (
							await bare.page.evaluate(() =>
								Array.from(document.querySelectorAll('#bare > certrev-card')).map(
									(x) => (x as HTMLElement).shadowRoot?.innerHTML ?? null,
								),
							)
						)[0]
						expect(h.html, `${cell} ${h.part}: shadow tree`).toBe(alone)
						let pixels: unknown = 'not compared (no painted box)'
						// Each page's own painted box of the part: the same size, wherever the page's flow put it (a margin that
						// collapses through the host on the bare page stays inside the replica's flex item).
						const own = (await hosts(bare.page)).find((x) => x.part === h.part)?.box ?? null
						const clipOf = (box: typeof h.box) =>
							box && { x: box.x, y: box.y, width: box.right - box.x, height: box.bottom - box.y }
						const clip = clipOf(h.box)
						const bareClip = clipOf(own)
						if (clip && bareClip) {
							expect([bareClip.width, bareClip.height], `${cell} ${h.part}: painted size`).toEqual([
								clip.width,
								clip.height,
							])
							if (h.fixed) await hidePageBehind(w.page)
							const a = await w.page.screenshot({ clip, fullPage: !h.fixed })
							const b = await bare.page.screenshot({ clip: bareClip, fullPage: !h.fixed })
							pixels = await pixelDiff(a, b)
							if ((pixels as { differing: number }).differing !== 0) {
								writeFileSync(join(OUT, `${cell}-${h.part}-replica.png`), a)
								writeFileSync(join(OUT, `${cell}-${h.part}-alone.png`), b)
							}
							expect((pixels as { differing: number }).differing, `${cell} ${h.part}: pixels`).toBe(0)
						}
						equal[h.part] = { sameShadowTree: h.html === alone, bytes: h.html?.length, box: h.box, pixels }
						expect(bare.violations, `${cell} bare ${h.part}: CSP`).toEqual([])
					} finally {
						await bare.context.close()
					}
				}
				await w.page.screenshot({ path: join(OUT, `${cell}-page.png`), fullPage: true })
				const partSelector =
					parts[0].part === 'top' ? '[data-certrev-part="bottom"]' : `[data-certrev-part="${parts[0].part}"]`
				const dialogs = await exerciseDialogs(w.page, entryId, partSelector, cell)
				const recoverable = await w.page.evaluate(
					() => (window as unknown as { __replicaRecoverable: string[] }).__replicaRecoverable,
				)
				evidence[`${label}@${viewport.name}`] = {
					parts: equal,
					dialogs,
					violations: w.violations,
					errors: w.errors,
					recoverable,
					browserReads: w.requests.filter((r) => r.includes('/api/cert/v1/delivery/')),
				}
				expect(w.violations, `${cell}: CSP`).toEqual([])
				expect(w.errors, `${cell}: page errors`).toEqual([])
				expect(recoverable, `${cell}: hydration`).toEqual([])
				// Hydrated from the server's record: the browser never read the Delivery API.
				expect(w.requests.filter((r) => r.includes('/api/cert/v1/delivery/'))).toEqual([])
				// The runtime the document names was loaded (its SRI held, or the dialogs would not open).
				expect(w.requests).toContain(side.runtime.src)
			} finally {
				await w.context.close()
			}
		},
		120_000,
	)

	it('the sidebar’s long-memo fold: folded behind “Read the expert memo” on a phone, absent on a desktop', async () => {
		const w = await open(viewport)
		try {
			await w.page.goto(`${server.origin}${article('replica-sidebar').path}`)
			await settle(w.page)
			const rail = 'certrev-card[data-certrev-part="rail"]'
			const state = () =>
				w.page.evaluate((sel) => {
					const root = document.querySelector(sel)?.shadowRoot
					const details = root?.querySelector('details.certrev-r-more') as HTMLDetailsElement | null
					// A closed <details> keeps its content's boxes (content-visibility: hidden), so ask what is rendered.
					const shown = (el: Element | null | undefined) =>
						!!el && el.checkVisibility() && el.getBoundingClientRect().height > 0
					return {
						details: details ? getComputedStyle(details).display !== 'none' : false,
						open: details?.open ?? null,
						summary: details?.querySelector('summary')?.textContent?.trim() ?? null,
						memoInFold: shown(details?.querySelector('blockquote')),
						memoOutside: shown(root?.querySelector('.certrev-r-side-body > blockquote')),
					}
				}, rail)
			const before = await state()
			const cells: Record<string, unknown> = { before }
			if (viewport.width <= 640) {
				expect(before).toEqual({
					details: true,
					open: false,
					summary: 'Read the expert memo',
					memoInFold: false,
					memoOutside: false,
				})
				await w.page.screenshot({ path: join(OUT, `replica-sidebar-${viewport.name}-fold-closed.png`) })
				await w.page.locator(`${rail} details.certrev-r-more > summary`).click()
				const opened = await state()
				expect(opened).toMatchObject({ open: true, memoInFold: true, memoOutside: false })
				await w.page
					.locator(`${rail} details.certrev-r-more`)
					.screenshot({ path: join(OUT, `replica-sidebar-${viewport.name}-fold-open.png`) })
				await w.page.locator(`${rail} details.certrev-r-more > summary`).click()
				const closedAgain = await state()
				expect(closedAgain).toMatchObject({ open: false, memoInFold: false })
				Object.assign(cells, { opened, closedAgain })
			} else {
				expect(before).toMatchObject({ details: false, memoOutside: true })
				// Above the card's 820px breakpoint the rail floats and the article's copy flows beside it, as on every CMS.
				const flow = await w.page.evaluate(() => {
					const rail = (document.querySelector('certrev-card[data-certrev-part="rail"]') as HTMLElement).shadowRoot
						?.querySelector('.certrev-r-side')
						?.getBoundingClientRect()
					const p = document.querySelector('.builder-block p')?.getBoundingClientRect()
					return rail && p ? { railLeft: rail.left, railBottom: rail.bottom, pTop: p.top, pRight: p.right } : null
				})
				expect(flow).not.toBeNull()
				expect(flow && flow.pTop < flow.railBottom && flow.pRight <= flow.railLeft, 'copy flows beside the rail').toBe(
					true,
				)
				cells.flow = flow
				await w.page.screenshot({ path: join(OUT, `replica-sidebar-${viewport.name}-flow.png`) })
			}
			evidence[`fold@${viewport.name}`] = cells
		} finally {
			await w.context.close()
		}
	}, 120_000)
})

describe('an in-app navigation (no server render for the next article)', () => {
	it.each([
		['setHTMLUnsafe', false],
		['no setHTMLUnsafe (roots from templates)', true],
	] as const)(
		'%s: one browser read and the published key set (rotated kid), the card printed with its roots, dialogs work',
		async (label, noSetHtml) => {
			const viewport = VIEWPORTS[1]
			const w = await open(viewport, { noSetHtml })
			try {
				await w.page.goto(`${server.origin}${article('replica-banner').path}`)
				await settle(w.page)
				expect(w.requests.filter((r) => r.includes('/api/cert/v1/delivery/'))).toEqual([])
				await w.page.locator('[data-replica-nav="/blogs/the-elf-word/next"]').click()
				await w.page.waitForSelector('[data-replica-entry="replica-next"] [data-certrev-face="card"] > certrev-card', {
					state: 'attached',
				})
				await settle(w.page)
				const reads = w.requests.filter((r) => /\/api\/cert\/v1\/(delivery|keys)/.test(r))
				expect(reads).toEqual([
					'https://portal.certrev.com/api/cert/v1/delivery/builder/replica-next',
					'https://portal.certrev.com/api/cert/v1/keys',
				])
				const printed = await hosts(w.page)
				expect(printed.map((h) => [h.part, h.attached])).toEqual([
					['rail', true],
					['dialog-expert', true],
					['dialog-certificate', true],
				])
				const templates = await w.page.evaluate(
					() => document.querySelectorAll('[data-certrev-face="card"] template').length,
				)
				expect(templates).toBe(0)
				const card = side.cards.get('replica-next')
				const scratch = await w.page.evaluate((html) => {
					const t = document.createElement('template')
					t.innerHTML = html
					return (t.content.querySelector('certrev-card > template') as HTMLTemplateElement).innerHTML
				}, card?.parts.rail ?? '')
				expect(printed[0].html).toBe(scratch)
				const dialogs = await exerciseDialogs(
					w.page,
					'replica-next',
					'[data-certrev-part="rail"]',
					`client-nav-${noSetHtml ? 'polyfill' : 'sethtml'}`,
				)
				expect(w.violations).toEqual([])
				expect(w.errors).toEqual([])
				evidence[`client-nav (${label})`] = { reads, dialogs, violations: w.violations }
			} finally {
				await w.context.close()
			}
		},
		120_000,
	)
})

describe('a split banner (a header block first in the body, a memo block just before the references)', () => {
	it.each(
		VIEWPORTS,
	)('at $name px the header block prints the head, its card, both dialogs and the runtime; the memo block its memo only; the memo’s controls open the page’s one dialog; the default hints move neither', async (viewport) => {
		const w = await open(viewport)
		try {
			await w.page.goto(`${server.origin}${article('replica-split').path}`)
			await settle(w.page)
			const wrappers = await w.page.evaluate(() =>
				Array.from(document.querySelectorAll('[data-certrev-face="card"]')).map((el) =>
					Array.from(el.children).map((c) => c.getAttribute('data-certrev-part') ?? c.tagName.toLowerCase()),
				),
			)
			expect(wrappers).toEqual([['style', 'top', 'dialog-expert', 'dialog-certificate', 'script'], ['bottom']])
			const cell = `split-${viewport.name}`
			// 2.0.1: the document's default hints (the card at the start of the content, the memo before the references) are
			// where the export put both blocks, so after the page has settled nothing has moved.
			await w.page.waitForTimeout(500)
			const order = await blockOrder(w.page, 'replica-split')
			expect(order[0]).toBe('card-block')
			expect(order.slice(-2)).toEqual(['card-block', 'references'])
			expect(order.filter((b) => b.startsWith('placed:'))).toEqual([])
			expect(order.filter((b) => b === 'card-block')).toHaveLength(2)
			await w.page.screenshot({ path: join(OUT, `${cell}-page.png`), fullPage: true })
			const dialogs = await exerciseDialogs(w.page, 'replica-split', '[data-certrev-part="bottom"]', cell, 0)
			expect(w.violations).toEqual([])
			expect(w.errors).toEqual([])
			evidence[`split banner@${viewport.name}`] = { order, wrappers, dialogs }
		} finally {
			await w.context.close()
		}
	}, 120_000)
})

describe('JavaScript off', () => {
	it.each(
		VIEWPORTS,
	)('at $name px the server’s card is complete (declarative roots attached by the parser) and the fold is native', async (viewport) => {
		// A first visit warms the page server's delivery cache, as any earlier reader does; a cold streamed render sends
		// the card after the shell, where only a script moves it in (a host app that waits for the whole render, as Hydrogen
		// does for crawlers, sends it in place).
		const warm = await open(viewport)
		await warm.page.goto(`${server.origin}${article('replica-sidebar').path}`)
		await settle(warm.page)
		await warm.context.close()
		const w = await open(viewport, { js: false })
		// React 19 streams a Suspense boundary larger than its progressiveChunkSize (12,800 bytes by default) after the
		// shell, so with JavaScript off the card is complete only on a host that raises it (README, "React 19 hosts").
		const react19 = Number(version.split('.')[0]) >= 19
		try {
			if (react19) {
				await w.page.goto(`${server.origin}${article('replica-sidebar').path}`)
				const outlined = await w.page.evaluate(
					() => document.querySelector('certrev-card[data-certrev-part="rail"]')?.closest('[hidden]') !== null,
				)
				evidence[`js-off@${viewport.name} default chunk size`] = { outlinedInHiddenSegment: outlined }
			}
			await w.page.goto(`${server.origin}${article('replica-sidebar').path}${react19 ? '?chunk=big' : ''}`)
			await w.page.waitForLoadState('load')
			const rail = w.page.locator('certrev-card[data-certrev-part="rail"] .certrev-r-side')
			await expect(rail.isVisible()).resolves.toBe(true)
			const text = await rail.innerText()
			expect(text).toContain('Dr. Avery Quinlan')
			expect(text).toContain('View Certificate')
			await rail.screenshot({ path: join(OUT, `replica-sidebar-${viewport.name}-js-off.png`) })
			if (viewport.width <= 640) {
				await w.page.locator('certrev-card[data-certrev-part="rail"] details.certrev-r-more > summary').click()
				await expect(
					w.page.locator('certrev-card[data-certrev-part="rail"] details.certrev-r-more blockquote').isVisible(),
				).resolves.toBe(true)
			}
			expect(w.violations).toEqual([])
			evidence[`js-off@${viewport.name}`] = { text: text.slice(0, 80), violations: w.violations }
		} finally {
			await w.context.close()
		}
	}, 120_000)
})

/** A shadow tree with the placement's identity values blanked: the certificate id the card names (the preview's is
 * `appearance-preview`, a live card's its own). Every other byte is compared. */
const withoutIdentity = (html: string | null) =>
	html?.replace(/data-certrev-cert-id="[^"]*"/g, 'data-certrev-cert-id=""') ?? null

describe('SC2: the parts equal the Appearance preview’s own, for the same design', () => {
	describe.each(VIEWPORTS)('at $name px', (viewport) => {
		it.each(
			Object.keys(previewParity().cases),
		)('%s: every host the block prints renders the preview page’s host for the same design (shadow tree and pixels)', async (name) => {
			const c = previewParity().cases[name]
			const w = await open(viewport)
			try {
				await w.page.goto(`${server.origin}/blogs/the-elf-word/preview-${name}`)
				await settle(w.page)
				const printed = await hosts(w.page)
				expect(printed.map((h) => h.part).sort()).toEqual(Object.keys(c.previewHosts).sort())
				const cells: Record<string, unknown> = {}
				for (const h of printed) {
					const alone = await open(viewport)
					try {
						const go = async (x: number, y: number) => {
							const q = new URLSearchParams({ x: String(x), y: String(y), w: String(h.host.width) })
							await alone.page.goto(`${server.origin}/preview/${name}/${h.part}?${q}`)
							await settle(alone.page)
						}
						await go(h.host.x, h.host.y)
						const first = (await hosts(alone.page))[0]
						if (first?.box && h.box && !h.fixed)
							await go(h.host.x + (h.box.x - first.box.x), h.host.y + (h.box.y - first.box.y))
						const own = (await hosts(alone.page))[0]
						expect(own?.attached, `${name} ${h.part}: the preview host attaches`).toBe(true)
						// The same shadow tree, byte for byte, but for the certificate id the preview stands in for.
						expect(withoutIdentity(h.html), `${name}@${viewport.name} ${h.part}: shadow tree`).toBe(
							withoutIdentity(own?.html ?? null),
						)
						let pixels: unknown = 'no painted box (a closed dialog)'
						if (h.box && own?.box) {
							const clip = { x: h.box.x, y: h.box.y, width: h.box.right - h.box.x, height: h.box.bottom - h.box.y }
							const clipOwn = {
								x: own.box.x,
								y: own.box.y,
								width: own.box.right - own.box.x,
								height: own.box.bottom - own.box.y,
							}
							expect([clipOwn.width, clipOwn.height]).toEqual([clip.width, clip.height])
							if (h.fixed) await hidePageBehind(w.page)
							const a = await w.page.screenshot({ clip, fullPage: !h.fixed })
							const b = await alone.page.screenshot({ clip: clipOwn, fullPage: !h.fixed })
							pixels = await pixelDiff(a, b)
							if ((pixels as { differing: number }).differing !== 0) {
								writeFileSync(join(OUT, `preview-${name}-${viewport.name}-${h.part}-replica.png`), a)
								writeFileSync(join(OUT, `preview-${name}-${viewport.name}-${h.part}-preview.png`), b)
							}
							expect((pixels as { differing: number }).differing, `${name}@${viewport.name} ${h.part}: pixels`).toBe(0)
						}
						cells[h.part] = {
							sameShadowTreeButCertId: withoutIdentity(h.html) === withoutIdentity(own?.html ?? null),
							rawEqual: h.html === own?.html,
							bytes: h.html?.length,
							pixels,
						}
					} finally {
						await alone.context.close()
					}
				}
				expect(w.violations).toEqual([])
				evidence[`preview-parity ${name}@${viewport.name}`] = cells
			} finally {
				await w.context.close()
			}
		}, 120_000)
	})
})

describe('a revoked placement (S2’s runtime revalidates against the card route)', () => {
	it('the server-printed card is removed after revalidation, and stays removed when the block prints it again after an in-app navigation', async () => {
		await side.revoke('replica-revoked')
		const w = await open(VIEWPORTS[1])
		try {
			await w.page.goto(`${server.origin}${article('replica-revoked').path}`)
			await w.page.waitForFunction(() => document.querySelectorAll('certrev-card').length === 0, null, {
				timeout: 10_000,
			})
			const afterLoad = await w.page.evaluate(() => document.querySelectorAll('certrev-card').length)
			await w.page.locator('[data-replica-nav="/blogs/the-elf-word/banner"]').click()
			await w.page.waitForSelector('[data-replica-entry="replica-banner"] certrev-card', { state: 'attached' })
			await w.page.locator('[data-replica-nav="/blogs/the-elf-word/revoked"]').click()
			await settle(w.page)
			const afterReturn = await w.page.evaluate(
				() => document.querySelectorAll('[data-replica-entry="replica-revoked"] certrev-card').length,
			)
			const routeReads = w.requests.filter((r) => r.includes('/api/cert/v1/card/builder/replica-revoked'))
			evidence.revoked = { afterLoad, afterReturn, routeReads }
			expect(afterLoad).toBe(0)
			expect(afterReturn).toBe(0)
			expect(routeReads.length).toBeGreaterThan(0)
			expect(w.violations).toEqual([])
		} finally {
			await w.context.close()
		}
	}, 120_000)
})

describe('CSP: exactly the four CertREV sources', () => {
	it.each<[CertrevDirective, string]>([
		['script-src', 'runtime'],
		['connect-src', 'client-nav'],
		['font-src', 'fonts'],
		['img-src', 'photo'],
	])(
		'without %s: at least one violation (a positive control)',
		async (directive, scenario) => {
			server.csp = { ...STRICT, without: directive }
			const w = await open(VIEWPORTS[0])
			try {
				await w.page.goto(`${server.origin}${article('replica-banner').path}`)
				await settle(w.page)
				if (scenario === 'client-nav') {
					await w.page.locator('[data-replica-nav="/blogs/the-elf-word/next"]').click()
					await settle(w.page)
				}
				evidence[`csp-without-${directive}`] = { violations: w.violations }
				expect(w.violations.length).toBeGreaterThan(0)
			} finally {
				await w.context.close()
				server.csp = STRICT
			}
		},
		120_000,
	)
})

/** The entry's top-level blocks in order: the hero, the byline, copy, the card's own block, references, or a holder. */
async function blockOrder(page: Page, entryId: string): Promise<string[]> {
	return page.evaluate((id) => {
		const column = document.querySelector(`[builder-content-id="${id}"] > .builder-blocks`)
		return Array.from(column?.children ?? []).map((el) => {
			const placed = el.getAttribute('data-certrev-placed')
			if (placed) return `placed:${placed}`
			if (el.querySelector('svg[aria-label="Hero"]')) return 'hero'
			if (el.querySelector('.byline')) return 'byline'
			if (el.querySelector('h2')?.textContent === 'References') return 'references'
			if (el.querySelector('[data-certrev-face="card"]')) return 'card-block'
			return 'copy'
		})
	}, entryId)
}

/** The beacons the browser posted for an entry, parsed. */
function beaconsFor(entryId: string): { family: string; events: { reason: string; outcome: string }[] }[] {
	return side.beacons.map((raw) => JSON.parse(raw)).filter((b) => b.externalId === entryId)
}

describe('2.0.1: nothing, never unsigned facts; each fallback beacons to CertREV', () => {
	it.each(
		VIEWPORTS,
	)('at $name px a block with no delivery marker prints nothing of its export-time options', async (viewport) => {
		const w = await open(viewport)
		try {
			await w.page.goto(`${server.origin}${article('replica-nomarker').path}`)
			await settle(w.page)
			const html = await w.page.content()
			for (const exportTime of ['Dr. Export Time', 'export-time', 'An unsigned memo'])
				expect(html).not.toContain(exportTime)
			expect(await w.page.locator('[data-certrev-cert-chrome]').count()).toBe(0)
			expect(beaconsFor('replica-nomarker').map((b) => b.events[0])).toEqual([
				{ kind: 'fallback', reason: 'no_marker', outcome: 'other' },
			])
			expect(w.violations).toEqual([])
			expect(w.errors).toEqual([])
			await w.page.screenshot({ path: join(OUT, `no-marker-${viewport.name}.png`) })
			evidence[`no-marker@${viewport.name}`] = { beacons: beaconsFor('replica-nomarker'), chrome: 0 }
		} finally {
			side.beacons.length = 0
			await w.context.close()
		}
	})

	it.each(
		VIEWPORTS,
	)('at $name px CertREV not reached: nothing, a none record that says why, one beacon', async (viewport) => {
		const w = await open(viewport)
		try {
			await w.page.goto(`${server.origin}${article('replica-unreachable').path}`)
			await settle(w.page)
			expect(await w.page.locator('certrev-card').count()).toBe(0)
			const record = await w.page.evaluate(() =>
				document.querySelector('[hidden][data-certrev-envelope]')?.getAttribute('data-certrev-envelope'),
			)
			expect(JSON.parse(record ?? '{}')).toMatchObject({ face: 'none', reason: 'delivery_unreachable' })
			expect(beaconsFor('replica-unreachable').map((b) => b.events[0])).toEqual([
				{ kind: 'fallback', reason: 'delivery_unreachable', outcome: 'unreachable' },
			])
			expect(w.violations).toEqual([])
			expect(w.errors).toEqual([])
			await w.page.screenshot({ path: join(OUT, `unreachable-${viewport.name}.png`) })
			evidence[`unreachable@${viewport.name}`] = {
				record: JSON.parse(record ?? '{}'),
				beacons: beaconsFor('replica-unreachable'),
			}
		} finally {
			side.beacons.length = 0
			await w.context.close()
		}
	})
})

describe('2.0.1: the document places its parts (JS on); JS off leaves them where the editor put them', () => {
	it.each(
		VIEWPORTS,
	)('at $name px the hints put the card after the byline and the memo at the end', async (viewport) => {
		const w = await open(viewport)
		try {
			await w.page.goto(`${server.origin}${article('replica-placed').path}`)
			await settle(w.page)
			await w.page.waitForSelector('[data-certrev-placed="bottom"]', { timeout: 5_000 })
			const order = await blockOrder(w.page, 'replica-placed')
			expect(order).toEqual([
				'hero',
				'byline',
				'placed:top',
				'copy',
				'copy',
				'card-block',
				'copy',
				'copy',
				'copy',
				'placed:bottom',
			])
			// The moved memo (the banner's controls are in it) still opens CertREV's dialog, the page's one in the card block.
			const control = w.page
				.locator('[data-certrev-placed="bottom"] certrev-card a[data-certrev-modal-open="expert"]')
				.first()
			await control.click()
			await w.page.waitForTimeout(250)
			const open = await w.page.evaluate(() => {
				const dialog = document
					.querySelector('certrev-card[data-certrev-part="dialog-expert"]')
					?.shadowRoot?.querySelector('dialog')
				return { open: !!dialog?.open, modal: dialog?.matches(':modal') ?? false }
			})
			expect(open).toEqual({ open: true, modal: true })
			await w.page.keyboard.press('Escape')
			await w.page.evaluate(() => window.scrollTo(0, 0))
			await w.page.screenshot({ path: join(OUT, `placed-${viewport.name}-top.png`) })
			await w.page.locator('[data-certrev-placed="bottom"]').scrollIntoViewIfNeeded()
			await w.page.screenshot({ path: join(OUT, `placed-${viewport.name}-end.png`) })
			expect(w.violations).toEqual([])
			expect(w.errors).toEqual([])
			evidence[`placed@${viewport.name}`] = { order, dialog: open }
		} finally {
			await w.context.close()
		}
	})

	it.each(
		VIEWPORTS,
	)('at $name px the default hints: the card after the leading image, the memo before the references', async (viewport) => {
		const w = await open(viewport)
		try {
			await w.page.goto(`${server.origin}${article('replica-hinted').path}`)
			await settle(w.page)
			await w.page.waitForSelector('[data-certrev-placed="bottom"]', { timeout: 5_000 })
			const order = await blockOrder(w.page, 'replica-hinted')
			expect(order).toEqual([
				'hero',
				'placed:top',
				'copy',
				'copy',
				'card-block',
				'copy',
				'copy',
				'copy',
				'placed:bottom',
				'references',
			])
			expect(w.violations).toEqual([])
			expect(w.errors).toEqual([])
			evidence[`hinted@${viewport.name}`] = { order }
		} finally {
			await w.context.close()
		}
	})

	it('JavaScript off: no part moves; the card is where the editor put it, complete', async () => {
		const w = await open(VIEWPORTS[0], { js: false })
		try {
			// A raised progressiveChunkSize, as a React 19 host passes (README); React 18 inlines the card either way.
			await w.page.goto(`${server.origin}${article('replica-placed').path}?chunk=big`)
			await w.page.waitForLoadState('load')
			const order = await blockOrder(w.page, 'replica-placed')
			expect(order).toEqual(['hero', 'byline', 'copy', 'copy', 'card-block', 'copy', 'copy', 'copy'])
			const parts = await w.page.evaluate(() =>
				Array.from(document.querySelectorAll('[data-certrev-face="card"] > certrev-card')).map((h) =>
					h.getAttribute('data-certrev-part'),
				),
			)
			expect(parts).toEqual(['top', 'bottom', 'dialog-expert', 'dialog-certificate'])
			evidence['placed@js-off'] = { order, parts }
		} finally {
			await w.context.close()
		}
	})
})
