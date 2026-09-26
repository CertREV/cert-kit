// @vitest-environment jsdom
/**
 * No runtime disclosure guard: a face that loads inside a closed `<details>`, an inactive tab or a
 * collapsed accordion is left exactly as rendered, and shows normally when the visitor opens it.
 *
 * 1.1.0's bundle checked every memo's disclosure line at load and on each DOM mutation and replaced
 * the memo with "This CertREV verification cannot be displayed…" when the line had a zero-size box,
 * which is what a browser reports for anything inside a closed container. jsdom has no layout (every
 * box is zero), so a stub below reports boxes as a browser would: zero inside a closed container,
 * non-zero otherwise. With it, the 1.1.0 guard replaces all three faces here.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CertModalContent } from './cert-modal-view.js'
import { CERT_MODAL_TAG } from './certrev-cert-modal.js'
import { DEPRECATED_API_EVENT, installFtcGuard } from './deprecated.js'
import { FTC_DISCLOSURE_LINE } from './ftc-disclosure.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const NOTICE = 'cannot be displayed'
const NEUTRALIZED_ATTR = 'data-certrev-ftc-neutralized'

/** What a browser reports: no box inside a closed <details> (bar its summary), a `hidden` element,
 *  or a `display:none` one; a real box everywhere else. */
function inClosedContainer(el: Element): boolean {
	for (let n: Element | null = el; n; n = n.parentElement) {
		if (n.hasAttribute('hidden') || (n as HTMLElement).style?.display === 'none') return true
		const p = n.parentElement
		if (p instanceof HTMLDetailsElement && !p.open && n.tagName !== 'SUMMARY') return true
	}
	return false
}
const realRect = Element.prototype.getBoundingClientRect
function layoutRect(this: Element): DOMRect {
	const [w, h] = inClosedContainer(this) ? [0, 0] : [320, 24]
	return { x: 0, y: 0, top: 0, left: 0, right: w, bottom: h, width: w, height: h, toJSON: () => ({}) } as DOMRect
}

function content(tag: string): CertModalContent {
	return {
		expert: { displayName: `Dr. ${tag} Reviewer`, profileUrl: `https://certrev.com/experts/${tag.toLowerCase()}` },
		certifiedAt: '2026-09-01T00:00:00Z',
		verifyUrl: `https://certrev.com/verify/cert_${tag.toLowerCase()}`,
		articleTitle: `Article ${tag}`,
		displayCertId: `CR-${tag.toUpperCase()}-0001`,
	}
}

/** One WordPress face (CertREV_Renderer::render()'s nesting), memo carrying the verbatim line. */
function face(tag: string): string {
	const t = tag.toLowerCase()
	const json = JSON.stringify(content(tag)).replace(/</g, '\\u003c')
	return `<div data-certrev-cert="1" id="face-${t}"><div class="certrev-card-wrap" data-certrev-placement="inline"><certrev-badge><div class="certrev-card"><a class="cert-header__cta" href="https://certrev.com/verify/cert_${t}" data-certrev-modal-open data-ctl="${t}-cta">View certificate</a></div></certrev-badge><certrev-cert-modal data-fonts="host"><script type="application/json" data-certrev-envelope>${json}</script></certrev-cert-modal></div>
<div class="certrev-memo-wrap" data-certrev-placement="inline"><div class="certrev-memo"><p>Memo ${tag}.</p><a class="certrev-memo__link" href="https://certrev.com/verify/cert_${t}" data-certrev-modal-open data-ctl="${t}-memo-cert">Certificate</a><span data-ftc-line>${FTC_DISCLOSURE_LINE}</span></div></div></div>`
}

const PAGE = `<main>
<details id="details"><summary>Expert review</summary>${face('Details')}</details>
<div class="tabs"><button role="tab" aria-selected="true">Overview</button><button role="tab" aria-selected="false">Review</button>
<div role="tabpanel" id="tab-overview">Overview copy.</div><div role="tabpanel" id="tab-review" hidden>${face('Tab')}</div></div>
<div class="accordion"><button aria-expanded="false" aria-controls="acc-panel">Who reviewed this?</button><div id="acc-panel" style="display:none">${face('Accordion')}</div></div>
</main>`
const TAGS = ['details', 'tab', 'accordion'] as const

const byId = (id: string): HTMLElement => {
	const el = document.getElementById(id)
	if (!el) throw new Error(`no #${id}`)
	return el
}
const memoOf = (t: string) => byId(`face-${t}`).querySelector('.certrev-memo')
const lineOf = (t: string) => byId(`face-${t}`).querySelector('[data-ftc-line]')
const settle = () => new Promise((r) => setTimeout(r, 0))

/** Shown as a browser would paint it: a box, and no `hidden` / display:none / visibility:hidden /
 *  opacity:0 on it or any ancestor. */
function shown(el: Element | null): boolean {
	if (!el || el.getBoundingClientRect().width === 0) return false
	for (let n: Element | null = el; n; n = n.parentElement) {
		if (n.hasAttribute('hidden')) return false
		const s = getComputedStyle(n)
		if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false
	}
	return true
}

let observersCreated = 0
let rendered: { memo: Element | null; html: string }[] = []

beforeAll(async () => {
	Element.prototype.getBoundingClientRect = layoutRect
	HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
		this.setAttribute('open', '')
	}
	// Count every observer anything creates from here on (the 1.1.0 guard made one per memo wrap).
	const RealMO = window.MutationObserver
	window.MutationObserver = class extends RealMO {
		constructor(cb: MutationCallback) {
			super(cb)
			observersCreated++
		}
	}
	document.body.innerHTML = PAGE
	rendered = TAGS.map((t) => ({ memo: memoOf(t), html: byId(`face-${t}`).outerHTML }))
	// Load the bundle entry exactly as a page's <script> does, then fire the load event it waited on.
	await import('./certrev-cert.entry.js')
	document.dispatchEvent(new Event('DOMContentLoaded'))
	await settle()
})
afterAll(() => {
	Element.prototype.getBoundingClientRect = realRect
})

describe('a face inside a closed container', () => {
	it('is what a browser reports: the disclosure line has no box while closed (what fired 1.1.0)', () => {
		for (const t of TAGS) expect(lineOf(t)?.getBoundingClientRect().width).toBe(0)
	})

	it('is left exactly as rendered at load: no notice, no neutralized marker, same nodes', () => {
		expect(document.body.textContent).not.toContain(NOTICE)
		expect(document.querySelector(`[${NEUTRALIZED_ATTR}]`)).toBeNull()
		TAGS.forEach((t, i) => {
			expect(memoOf(t)).toBe(rendered[i]?.memo)
			expect(memoOf(t)?.isConnected).toBe(true)
			expect(lineOf(t)?.textContent).toBe(FTC_DISCLOSURE_LINE)
			// Review B1: the whole face, card wrap included, not only the memo: no attribute or style added.
			expect(byId(`face-${t}`).outerHTML).toBe(rendered[i]?.html)
		})
	})

	it('the bundle entry installs no MutationObserver', () => {
		expect(observersCreated).toBe(0)
	})

	it('renders normally when opened, and its control opens its own certificate', async () => {
		;(byId('details') as HTMLDetailsElement).open = true
		byId('tab-overview').setAttribute('hidden', '')
		byId('tab-review').removeAttribute('hidden')
		byId('acc-panel').style.display = ''
		await settle()
		TAGS.forEach((t, i) => {
			expect(lineOf(t)?.getBoundingClientRect().width).toBeGreaterThan(0)
			expect(memoOf(t)).toBe(rendered[i]?.memo)
			expect(byId(`face-${t}`).querySelector(`[${NEUTRALIZED_ATTR}]`)).toBeNull()
			expect(memoOf(t)?.textContent).toContain(`Memo ${t[0]?.toUpperCase()}${t.slice(1)}.`)
			expect(lineOf(t)?.textContent).toBe(FTC_DISCLOSURE_LINE)
		})
		expect(document.body.textContent).not.toContain(NOTICE)
		for (const t of TAGS) {
			const control = document.querySelector(`[data-ctl="${t}-memo-cert"]`) as HTMLElement
			const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
			window.addEventListener('click', (e) => e.preventDefault(), { once: true })
			control.dispatchEvent(ev)
			const modal = byId(`face-${t}`).querySelector(CERT_MODAL_TAG)
			const dialog = modal?.shadowRoot?.querySelector('dialog#cert[open]')
			expect(dialog?.textContent).toContain(`CR-${t.toUpperCase()}-0001`)
			dialog?.removeAttribute('open')
		}
	})

	it('review B1: once opened the WHOLE face is shown: card wrap, card, its control and the memo', () => {
		for (const t of TAGS) {
			const face = byId(`face-${t}`)
			for (const sel of ['.certrev-card-wrap', '.certrev-card', `[data-ctl="${t}-cta"]`, '.certrev-memo-wrap', '.certrev-memo', '[data-ftc-line]']) {
				expect(shown(face.querySelector(sel)), `${t} ${sel}`).toBe(true)
			}
		}
	})

	it('closing and reopening it again changes nothing', async () => {
		;(byId('details') as HTMLDetailsElement).open = false
		byId('acc-panel').style.display = 'none'
		await settle()
		;(byId('details') as HTMLDetailsElement).open = true
		byId('acc-panel').style.display = ''
		await settle()
		expect(document.querySelector(`[${NEUTRALIZED_ATTR}]`)).toBeNull()
		TAGS.forEach((t, i) => expect(memoOf(t)).toBe(rendered[i]?.memo))
	})
})

describe('installFtcGuard (deprecated since 1.1.1)', () => {
	it('is still exported from @certrev/cert-block/modal', async () => {
		const mod = await import('./index.js')
		expect(mod.installFtcGuard).toBe(installFtcGuard)
	})

	it('guards nothing: a closed face stays, no observer, one deprecation event per document', async () => {
		;(byId('details') as HTMLDetailsElement).open = false
		await settle()
		const before = observersCreated
		const seen: CustomEvent[] = []
		const onDeprecated = (e: Event) => seen.push(e as CustomEvent)
		document.addEventListener(DEPRECATED_API_EVENT, onDeprecated)
		installFtcGuard(document)
		installFtcGuard(document)
		await settle()
		document.removeEventListener(DEPRECATED_API_EVENT, onDeprecated)
		expect(seen).toHaveLength(1)
		expect(seen[0]?.detail).toEqual({ api: 'installFtcGuard', removedIn: '1.1.1' })
		expect(observersCreated).toBe(before)
		expect(document.querySelector(`[${NEUTRALIZED_ATTR}]`)).toBeNull()
		expect(memoOf('details')).toBe(rendered[0]?.memo)
	})
})

describe('what the browser bundle is built from', () => {
	/** Every module `build:modal-bundle` pulls in: the entry's relative import graph. */
	function bundleModules(): string[] {
		const seen = new Set<string>()
		const visit = (file: string): void => {
			if (seen.has(file)) return
			seen.add(file)
			const src = readFileSync(file, 'utf8')
			for (const m of src.matchAll(/(?:from|import)\s+['"](\.{1,2}\/[^'"]+)\.js['"]/g)) {
				visit(resolve(dirname(file), `${m[1]}.ts`))
			}
		}
		visit(join(HERE, 'certrev-cert.entry.ts'))
		return [...seen]
	}

	it('contains no guard: no notice text, no neutralize marker, no disclosure check', () => {
		const modules = bundleModules()
		expect(modules.length).toBeGreaterThan(5)
		for (const file of modules) {
			const src = readFileSync(file, 'utf8')
			expect(src, file).not.toContain(NOTICE)
			expect(src, file).not.toContain(NEUTRALIZED_ATTR)
			expect(src, file).not.toMatch(/from\s+['"][^'"]*(?:ftc-guard|deprecated)[^'"]*['"]|installFtcGuard\s*\(/)
		}
	})

	it('no source module in the package carries the guard any more', () => {
		const walk = (dir: string): string[] =>
			readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
				d.isDirectory() ? walk(join(dir, d.name)) : /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [join(dir, d.name)] : [],
			)
		const files = walk(resolve(HERE, '..'))
		expect(files.some((f) => f.endsWith('ftc-guard.ts'))).toBe(false)
		for (const file of files) {
			const src = readFileSync(file, 'utf8')
			expect(src, file).not.toContain(NOTICE)
			expect(src, file).not.toContain(`'${NEUTRALIZED_ATTR}'`)
		}
	})
})
