// @vitest-environment jsdom
/**
 * Two faces on one page: every `[data-certrev-modal-open]` control opens ITS OWN face's
 * `<certrev-cert-modal>`, never the document's first one (1.1.0 opened the first for every
 * control), and a revocation hides only its own face's controls. The shapes are the three surfaces'
 * real markup: the WordPress face root (`data-certrev-cert`, card wrap carrying the modal, memo wrap
 * carrying controls only), the Shopify embed (card wrap and memo wrap placed apart, one modal) and a
 * Builder page (one page-level modal fetched from the Delivery API).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { type CertModalContent } from './cert-modal-view.js'
import { CERT_MODAL_TAG, FACE_ROOT_SELECTOR, ownCertModal } from './certrev-cert-modal.js'
import { FTC_DISCLOSURE_LINE } from './ftc-disclosure.js'
import {
	initCertInteractions,
	MODAL_UNRESOLVED_ATTR,
	MODAL_UNRESOLVED_EVENT,
	openCertModal,
	openOwnModal,
} from './interactions.js'

/** jsdom has `<dialog>` but no `showModal`; the element guards on it, so give it the real effect. */
beforeAll(() => {
	HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
		this.setAttribute('open', '')
	}
	HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
		this.removeAttribute('open')
	}
	initCertInteractions(document)
})

function content(tag: string): CertModalContent {
	return {
		expert: {
			displayName: `Dr. ${tag} Reviewer, MD`,
			credentials: [{ abbreviation: 'MD', fullName: 'Doctor of Medicine' }],
			profileUrl: `https://certrev.com/experts/${tag.toLowerCase()}`,
			bio: `${tag} reviews cardiology.`,
		},
		certifiedAt: '2026-09-01T00:00:00Z',
		verifyUrl: `https://certrev.com/verify/cert_${tag.toLowerCase()}`,
		articleTitle: `Article ${tag}`,
		displayCertId: `CR-${tag.toUpperCase()}-0001`,
	}
}

function modalHtml(c: CertModalContent): string {
	const json = JSON.stringify(c).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
	return `<certrev-cert-modal data-fonts="host"><script type="application/json" data-certrev-envelope>${json}</script></certrev-cert-modal>`
}

/** The controls a face carries: the card header div (role=button), its CTA and profile links, and
 *  the memo's profile + certificate links: the WordPress renderer's / Liquid's attribute set. */
function cardHtml(tag: string, open = true): string {
	const o = (v = '') => (open ? ` data-certrev-modal-open${v ? `="${v}"` : ''}` : '')
	const t = tag.toLowerCase()
	return `<certrev-badge><div class="certrev-card"><div class="cert-header" role="button" tabindex="0" data-ctl="${t}-header"${o()}>Expert reviewed<a class="cert-header__cta" href="https://certrev.com/verify/cert_${t}" data-ctl="${t}-cta"${o()}>View certificate</a></div><a class="cert-link" href="https://certrev.com/experts/${t}" data-ctl="${t}-profile"${o('expert')}>Dr. ${tag} Reviewer</a></div></certrev-badge>`
}

function memoHtml(tag: string, open = true): string {
	const o = (v = '') => (open ? ` data-certrev-modal-open${v ? `="${v}"` : ''}` : '')
	const t = tag.toLowerCase()
	return `<div class="certrev-memo"><a class="certrev-memo__link" href="https://certrev.com/experts/${t}" data-ctl="${t}-memo-profile"${o('expert')}>Dr. ${tag} Reviewer</a><p>Memo ${tag}.</p><a class="certrev-memo__link" href="https://certrev.com/verify/cert_${t}" data-ctl="${t}-memo-cert"${o()}>Certificate</a><span data-ftc-line>${FTC_DISCLOSURE_LINE}</span></div>`
}

/** One WordPress face exactly as CertREV_Renderer::render() nests it. */
function wpFace(tag: string, opts: { modal?: boolean } = {}): string {
	const modal = opts.modal === false ? '' : modalHtml(content(tag))
	return `<div data-certrev-cert="1" id="face-${tag.toLowerCase()}"><div class="certrev-card-wrap" data-certrev-placement="inline">${cardHtml(tag)}${modal}</div>
<div class="certrev-memo-wrap" data-certrev-placement="inline">${memoHtml(tag)}</div></div>`
}

const ctl = (id: string): HTMLElement => {
	const el = document.querySelector<HTMLElement>(`[data-ctl="${id}"]`)
	if (!el) throw new Error(`fixture has no control ${id}`)
	return el
}
const modalIn = (sel: string): HTMLElement => {
	const el = document.querySelector<HTMLElement>(`${sel} ${CERT_MODAL_TAG}`)
	if (!el) throw new Error(`no modal in ${sel}`)
	return el
}
/** The dialogs currently open in a modal's shadow root, with the text that identifies the cert. */
function openDialogs(modal: Element): { id: string; text: string }[] {
	const root = modal.shadowRoot
	if (!root) return []
	return Array.from(root.querySelectorAll('dialog[open]')).map((d) => ({ id: d.id, text: d.textContent ?? '' }))
}
function allOpenDialogs(): { id: string; text: string }[] {
	return Array.from(document.querySelectorAll(CERT_MODAL_TAG)).flatMap(openDialogs)
}
function closeAll(): void {
	for (const m of Array.from(document.querySelectorAll(CERT_MODAL_TAG))) {
		for (const d of Array.from(m.shadowRoot?.querySelectorAll('dialog[open]') ?? [])) d.removeAttribute('open')
	}
}

/** Click like a visitor, and report whether the delegate took the click (so the href did not run).
 *  A window listener runs after the document delegate and cancels jsdom's own navigation. */
function click(el: Element): boolean {
	let prevented = false
	const after = (e: Event) => {
		prevented = e.defaultPrevented
		e.preventDefault()
	}
	window.addEventListener('click', after, { once: true })
	el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
	return prevented
}
function pressEnter(el: Element): boolean {
	const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
	el.dispatchEvent(ev)
	return ev.defaultPrevented
}

afterEach(() => {
	document.body.innerHTML = ''
	vi.restoreAllMocks()
})

describe('two WordPress faces on one page (Query Loop / related posts)', () => {
	beforeEach(() => {
		document.body.innerHTML = `<main>${wpFace('Alpha')}<article>Between the faces.</article>${wpFace('Beta')}</main>`
	})

	const controls: [string, 'cert' | 'expert'][] = [
		['header', 'cert'],
		['cta', 'cert'],
		['profile', 'expert'],
		['memo-profile', 'expert'],
		['memo-cert', 'cert'],
	]

	for (const [tag, other] of [
		['Alpha', 'Beta'],
		['Beta', 'Alpha'],
	] as const) {
		for (const [suffix, kind] of controls) {
			it(`${tag}'s ${suffix} control opens ${tag}'s ${kind} dialog and nothing of ${other}'s`, () => {
				const own = modalIn(`#face-${tag.toLowerCase()}`)
				const neighbour = modalIn(`#face-${other.toLowerCase()}`)
				expect(click(ctl(`${tag.toLowerCase()}-${suffix}`))).toBe(true)
				const opened = openDialogs(own)
				expect(opened.map((d) => d.id)).toEqual([kind])
				// The identity of what the visitor sees: this face's cert id / reviewer, not the other's.
				const want = kind === 'cert' ? `CR-${tag.toUpperCase()}-0001` : `${tag} Reviewer`
				const notWant = kind === 'cert' ? `CR-${other.toUpperCase()}-0001` : `${other} Reviewer`
				expect(opened[0]?.text).toContain(want)
				expect(opened[0]?.text).not.toContain(notWant)
				expect(openDialogs(neighbour)).toEqual([])
				expect(allOpenDialogs()).toHaveLength(1)
			})
		}
	}

	it('keyboard parity: Enter on the second face header opens the second face certificate', () => {
		expect(pressEnter(ctl('beta-header'))).toBe(true)
		expect(openDialogs(modalIn('#face-beta')).map((d) => d.id)).toEqual(['cert'])
		expect(openDialogs(modalIn('#face-alpha'))).toEqual([])
	})

	it('opening one face then the other shows each its own certificate', () => {
		click(ctl('alpha-memo-cert'))
		closeAll()
		click(ctl('beta-memo-cert'))
		const shown = allOpenDialogs()
		expect(shown).toHaveLength(1)
		expect(shown[0]?.text).toContain('CR-BETA-0001')
		expect(shown[0]?.text).toContain('Article Beta')
	})

	it('ownCertModal names each face its own element', () => {
		for (const tag of ['alpha', 'beta']) {
			const own = modalIn(`#face-${tag}`)
			for (const [suffix] of controls) expect(ownCertModal(ctl(`${tag}-${suffix}`))).toEqual({ modal: own, reason: null })
		}
	})

	it('openCertModal(document) is unchanged: the page-level helper still opens the first element', () => {
		expect(openCertModal(document)).toBe(true)
		expect(openDialogs(modalIn('#face-alpha')).map((d) => d.id)).toEqual(['cert'])
		expect(openDialogs(modalIn('#face-beta'))).toEqual([])
	})
})

describe('a face root with no modal of its own', () => {
	beforeEach(() => {
		// Beta printed without a modal (what Embed B's one-modal-per-page workaround produces).
		document.body.innerHTML = `${wpFace('Alpha')}${wpFace('Beta', { modal: false })}`
	})

	it('never borrows the neighbour face modal: the link follows its own href', () => {
		expect(ownCertModal(ctl('beta-memo-cert'))).toEqual({ modal: null, reason: 'none', count: 0 })
		expect(click(ctl('beta-memo-cert'))).toBe(false)
		expect(click(ctl('beta-profile'))).toBe(false)
		expect(allOpenDialogs()).toEqual([])
		// 'none' is the plain no-modal page, not a resolution failure: nothing is stamped.
		expect(ctl('beta-memo-cert').hasAttribute(MODAL_UNRESOLVED_ATTR)).toBe(false)
	})

	it('a control outside every face root does not reach into one', () => {
		document.body.insertAdjacentHTML(
			'beforeend',
			'<p><a href="https://certrev.com/verify/cert_loose" data-certrev-modal-open data-ctl="loose">Certificate</a></p>',
		)
		expect(ownCertModal(ctl('loose'))).toEqual({ modal: null, reason: 'none', count: 0 })
		expect(click(ctl('loose'))).toBe(false)
		expect(allOpenDialogs()).toEqual([])
	})
})

describe('review B4: a face whose own modal cannot open', () => {
	it('lets its own href run (no dead click) and opens no other face', () => {
		// Alpha's modal printed with neither an envelope nor a fetch source, so it declines; Beta is whole.
		document.body.innerHTML = `<div data-certrev-cert="1" id="face-alpha"><div class="certrev-card-wrap" data-certrev-placement="inline">${cardHtml('Alpha')}<certrev-cert-modal data-fonts="host"></certrev-cert-modal></div><div class="certrev-memo-wrap" data-certrev-placement="inline">${memoHtml('Alpha')}</div></div>${wpFace('Beta')}`
		expect(ownCertModal(ctl('alpha-cta')).modal).toBe(modalIn('#face-alpha'))
		expect(openOwnModal(ctl('alpha-cta'), 'cert')).toBe(false)
		expect(click(ctl('alpha-cta'))).toBe(false)
		expect(click(ctl('alpha-memo-cert'))).toBe(false)
		expect(pressEnter(ctl('alpha-header'))).toBe(false)
		expect(allOpenDialogs()).toEqual([])
	})
})

describe('Shopify embed: card wrap and memo wrap placed apart, one modal', () => {
	it('memo controls far from the card open the page modal', () => {
		document.body.innerHTML = `<header><nav>Shop</nav></header><main><article class="banner">Hero</article><article class="page-width"><div class="rte"><div class="certrev-card-wrap" data-certrev-placement="rte">${cardHtml('Gamma')}${modalHtml(content('Gamma'))}</div><p>Body copy.</p><section><div class="certrev-memo-wrap" data-certrev-placement="references">${memoHtml('Gamma')}</div><ol id="references"><li>Ref</li></ol></section></div></article></main>`
		expect(document.querySelector(FACE_ROOT_SELECTOR)).toBeNull()
		for (const [id, kind] of [
			['gamma-memo-cert', 'cert'],
			['gamma-memo-profile', 'expert'],
			['gamma-header', 'cert'],
		] as const) {
			closeAll()
			expect(click(ctl(id))).toBe(true)
			expect(allOpenDialogs().map((d) => d.id)).toEqual([kind])
		}
		expect(allOpenDialogs()[0]?.text).toContain('Gamma Reviewer')
	})
})

describe('Builder page: one page-level modal fetched from the Delivery API', () => {
	it('the card controls open the page modal', async () => {
		const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ payload: { content: content('Delta') } }) }))
		vi.stubGlobal('fetch', fetchMock)
		document.body.innerHTML = `<div class="builder-content"><div class="builder-block">${cardHtml('Delta')}</div></div><certrev-cert-modal data-fonts="host" data-delivery-api="https://portal.certrev.com" data-platform="builder" data-external-id="entry-delta"></certrev-cert-modal>`
		expect(click(ctl('delta-cta'))).toBe(true)
		await vi.waitFor(() => expect(allOpenDialogs().map((d) => d.id)).toEqual(['cert']))
		expect(allOpenDialogs()[0]?.text).toContain('CR-DELTA-0001')
		expect(fetchMock).toHaveBeenCalledWith(
			'https://portal.certrev.com/api/cert/v1/delivery/builder/entry-delta',
			expect.objectContaining({ credentials: 'omit' }),
		)
		vi.unstubAllGlobals()
	})
})

describe('a control that cannot tell which modal is its own', () => {
	beforeEach(() => {
		// Two non-WordPress faces, each with a modal, and a control-only section between them.
		document.body.innerHTML = `<section id="s-a"><div class="certrev-card-wrap">${cardHtml('Alpha')}${modalHtml(content('Alpha'))}</div></section><section id="s-c"><a href="https://certrev.com/verify/cert_c" data-certrev-modal-open data-ctl="orphan">Certificate</a></section><section id="s-b"><div class="certrev-card-wrap">${cardHtml('Beta')}${modalHtml(content('Beta'))}</div></section>`
	})

	it('opens neither neighbour, says why on the control and in an event, and lets the href run', () => {
		const events: CustomEvent[] = []
		const onUnresolved = (e: Event) => events.push(e as CustomEvent)
		document.addEventListener(MODAL_UNRESOLVED_EVENT, onUnresolved)
		expect(ownCertModal(ctl('orphan'))).toEqual({ modal: null, reason: 'ambiguous', count: 2 })
		expect(click(ctl('orphan'))).toBe(false)
		expect(allOpenDialogs()).toEqual([])
		expect(ctl('orphan').getAttribute(MODAL_UNRESOLVED_ATTR)).toBe('ambiguous')
		expect(events).toHaveLength(1)
		expect(events[0]?.target).toBe(ctl('orphan'))
		expect(events[0]?.detail).toEqual({ reason: 'ambiguous', modals: 2 })
		document.removeEventListener(MODAL_UNRESOLVED_EVENT, onUnresolved)
	})

	it('the faces either side still open their own', () => {
		expect(click(ctl('beta-cta'))).toBe(true)
		expect(openDialogs(modalIn('#s-b')).map((d) => d.id)).toEqual(['cert'])
		expect(openDialogs(modalIn('#s-a'))).toEqual([])
	})

	it('openOwnModal reports false for the ambiguous control', () => {
		expect(openOwnModal(ctl('orphan'), 'cert')).toBe(false)
	})
})

describe('revocation hides only its own face controls (markSuppressed)', () => {
	it("a revoked first face hides the first face's controls and leaves the second face's", async () => {
		// Alpha's modal fetches live (no inline envelope) and gets a revoked envelope; Beta is inline.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => ({ payload: { lifecycle: { revokedAt: '2026-09-20T00:00:00Z' } } }) })),
		)
		const live =
			'<certrev-cert-modal data-fonts="host" data-delivery-api="https://portal.certrev.com" data-platform="wordpress" data-external-id="post-1"></certrev-cert-modal>'
		document.body.innerHTML = `<div data-certrev-cert="1" id="face-alpha"><div class="certrev-card-wrap" data-certrev-placement="inline">${cardHtml('Alpha')}${live}</div><div class="certrev-memo-wrap" data-certrev-placement="inline">${memoHtml('Alpha')}</div></div>${wpFace('Beta')}`
		click(ctl('alpha-cta'))
		await vi.waitFor(() => expect(modalIn('#face-alpha').hasAttribute('data-certrev-suppressed')).toBe(true))
		const alphaControls = Array.from(document.querySelectorAll('#face-alpha [data-certrev-modal-open]'))
		const betaControls = Array.from(document.querySelectorAll('#face-beta [data-certrev-modal-open]'))
		expect(alphaControls).toHaveLength(5)
		expect(betaControls).toHaveLength(5)
		for (const c of alphaControls) {
			expect(c.hasAttribute('hidden')).toBe(true)
			expect(c.getAttribute('aria-hidden')).toBe('true')
		}
		for (const c of betaControls) {
			expect(c.hasAttribute('hidden')).toBe(false)
			expect(c.hasAttribute('aria-hidden')).toBe(false)
		}
		expect(allOpenDialogs()).toEqual([])
		expect(click(ctl('beta-memo-cert'))).toBe(true)
		expect(openDialogs(modalIn('#face-beta')).map((d) => d.id)).toEqual(['cert'])
		vi.unstubAllGlobals()
	})

	it('review B4: controls with no modal of their own (a modal-less face, a loose link) stay visible', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => ({ payload: { lifecycle: { revokedAt: '2026-09-20T00:00:00Z' } } }) })),
		)
		const live =
			'<certrev-cert-modal data-fonts="host" data-delivery-api="https://portal.certrev.com" data-platform="wordpress" data-external-id="post-1"></certrev-cert-modal>'
		document.body.innerHTML = `<div data-certrev-cert="1" id="face-alpha"><div class="certrev-card-wrap" data-certrev-placement="inline">${cardHtml('Alpha')}${live}</div></div>${wpFace('Gamma', { modal: false })}<p><a href="https://certrev.com/verify/cert_loose" data-certrev-modal-open data-ctl="loose">Certificate</a></p>`
		click(ctl('alpha-cta'))
		await vi.waitFor(() => expect(modalIn('#face-alpha').hasAttribute('data-certrev-suppressed')).toBe(true))
		expect(ctl('alpha-cta').hasAttribute('hidden')).toBe(true)
		const others = [...Array.from(document.querySelectorAll('#face-gamma [data-certrev-modal-open]')), ctl('loose')]
		expect(others).toHaveLength(6)
		for (const c of others) {
			expect(ownCertModal(c).modal).toBeNull()
			expect(c.hasAttribute('hidden')).toBe(false)
			expect(c.hasAttribute('aria-hidden')).toBe(false)
		}
		vi.unstubAllGlobals()
	})
})
