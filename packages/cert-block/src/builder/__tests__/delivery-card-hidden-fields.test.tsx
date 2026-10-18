// @vitest-environment jsdom
/**
 * Hidden must mean absent from the page (1.2.0), and a server render needs no switch.
 *
 * A def that hides `reviewerPhoto` or `memo` takes that field off the face, but the seed the face carries
 * (`data-certrev-envelope`) is the payload, so the field would still sit in the page's HTML. The seed is therefore
 * stripped of what the def hides, before anything is painted from it, and the signature is left off a stripped seed (the
 * stripped payload no longer verifies, and the browser never re-checks it: it re-runs `renderVerdict` at its own
 * clock). These tests render the whole card on the server and assert the field's text is nowhere in the HTML, then
 * hydrate that HTML and assert the browser paints it unchanged.
 *
 * They run under jsdom with no test switch on the card's server detection: a `react-dom/server` render beside a
 * `document` must paint, as a Hydrogen server render under a DOM shim does.
 */

import { verifyArtifact } from '@certrev/cert-contract'
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CertContent } from '../../contract/kernel.js'
import { CertReviewCard } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import { SEED_ATTRIBUTE } from '../ssr-seed.js'
import {
	builderPayload,
	deliveryBody,
	ELF_LIKE_DEF,
	ENTRY_ID,
	json,
	MARKER,
	makeIssuer,
	renderToHtml,
	scriptedDelivery,
	seedOf,
	T0,
} from './delivery-harness.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const EXPERT_PHOTO = 'https://cdn.certrev.com/experts/jane-doe.jpg'
const AUTHOR_PHOTO = 'https://cdn.certrev.com/authors/sam-writer.jpg'
const MEMO = 'Zebrafish memo sentence: the retinol concentrations and sun-protection advice are accurate.'

/** The legacy face's def and the reader face's: the same hidden set, the same payload. */
const LEGACY_DEF = ELF_LIKE_DEF
const READER_DEF = { ...ELF_LIKE_DEF, face: 'reader', layout: 'banner' }
const FACES = [
	['the legacy face', LEGACY_DEF],
	['the reader face', READER_DEF],
] as const

let restore: () => void = () => {}
afterEach(() => {
	restore()
	document.body.innerHTML = ''
})

let issuer: ReturnType<typeof makeIssuer>
beforeEach(() => {
	issuer = makeIssuer()
})

/** The Builder payload with an expert photo, an author photo and a memo, none of them hidden by the payload itself. */
function payloadWithPhotosAndMemo(extra: Partial<CertContent> = {}) {
	const base = builderPayload()
	const author = { ...(base.content.author as object), photoUrl: AUTHOR_PHOTO }
	return { content: { ...base.content, author, memo: MEMO, ...extra } as CertContent }
}

async function settle() {
	for (let i = 0; i < 20; i++) {
		await act(async () => {
			await new Promise((r) => setTimeout(r, 5))
		})
	}
}

const card = () => <CertReviewCard delivery={MARKER} builderContext={{ content: { id: ENTRY_ID } }} />

/** The server: `react-dom/server` while a jsdom `document` exists. Nothing tells the card it is a server. */
async function serverHtml(def: object, overrides = payloadWithPhotosAndMemo()): Promise<string> {
	expect(typeof document).toBe('object')
	const server = scriptedDelivery(() => json(deliveryBody(issuer.envelope(overrides), def)))
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () => server.fetch,
		now: () => T0,
	})
	try {
		return await renderToHtml(card())
	} finally {
		restore()
	}
}

/** Hydrate `html` in a browser whose every read is refused; resolves with what React reported. */
async function hydrateRefusing(html: string) {
	const calls: string[] = []
	restore = setCardDeliveryRuntimeForTests({
		resolveKid: issuer.resolveKid,
		fetchImpl: () =>
			(async (input: RequestInfo | URL) => {
				calls.push(String(input))
				throw new TypeError('Failed to fetch')
			}) as typeof fetch,
		now: () => T0,
	})
	const container = document.createElement('div')
	container.innerHTML = html
	document.body.appendChild(container)
	const serverDom = container.innerHTML
	const chromeNode = container.querySelector('[data-certrev-cert-chrome]')
	const recoverable: unknown[] = []
	const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
	try {
		await act(async () => {
			hydrateRoot(container, card(), { onRecoverableError: (e) => recoverable.push(e) })
		})
		await settle()
		return { container, serverDom, chromeNode, recoverable, consoleErrors: consoleError.mock.calls.length, calls }
	} finally {
		consoleError.mockRestore()
	}
}

describe('a server render beside a document paints, with no switch', () => {
	it.each(FACES)('%s: the server HTML is the face, not an empty Suspense boundary', async (_name, def) => {
		const html = await serverHtml(def, { content: builderPayload().content })
		expect(html).not.toBe('<!--$--><!--/$-->')
		expect(html).toContain('data-certrev-cert-chrome')
		expect(html).toContain('Dr. Jane Doe')
		expect(seedOf(html)?.externalId).toBe(ENTRY_ID)
	})
})

describe('hidden reviewerPhoto', () => {
	const hidesPhoto = (base: object) => ({ ...base, hidden: ['reviewerPhoto'] })

	it.each(FACES)('%s: no photo URL anywhere in the full server HTML, the seed included', async (_name, def) => {
		const html = await serverHtml(hidesPhoto(def))
		expect(html).toContain('data-certrev-cert-chrome')
		expect(html).not.toContain(EXPERT_PHOTO)
		expect(html).not.toContain('jane-doe.jpg')
		expect(html).not.toContain(AUTHOR_PHOTO)
		expect(html).not.toContain('sam-writer.jpg')
		const seed = seedOf(html)
		expect(seed?.payload.content.expert.photoUrl).toBeNull()
		expect(seed?.payload.content.author.photoUrl).toBeNull()
		// the rest of the payload is the served one: the names, the cue, the memo
		expect(seed?.payload.content.expert.displayName).toBe('Dr. Jane Doe')
		expect(seed?.payload.content.memo).toBe(MEMO)
	})

	it.each(FACES)('%s: the seed carries no signature (a stripped payload no longer verifies)', async (_name, def) => {
		const seed = seedOf(await serverHtml(hidesPhoto(def)))
		expect(seed).not.toBeNull()
		expect(seed).not.toHaveProperty('signature')
	})

	it.each(FACES)('%s: the browser hydrates that HTML unchanged, with no read and no mismatch', async (_name, def) => {
		const html = await serverHtml(hidesPhoto(def))
		const { container, serverDom, chromeNode, recoverable, consoleErrors, calls } = await hydrateRefusing(html)
		expect(recoverable).toEqual([])
		expect(consoleErrors).toBe(0)
		expect(calls).toEqual([])
		expect(chromeNode).not.toBeNull()
		expect(container.querySelector('[data-certrev-cert-chrome]')).toBe(chromeNode)
		expect(container.innerHTML).toBe(serverDom)
		expect(container.innerHTML).not.toContain('jane-doe.jpg')
		expect(container.innerHTML).not.toContain('sam-writer.jpg')
	})

	it.each(
		FACES,
	)('%s: a def that does not hide it keeps the photo, the signature and the payload as served', async (_name, def) => {
		const envelope = issuer.envelope(payloadWithPhotosAndMemo())
		const html = await serverHtml({ ...def, hidden: [] })
		const seed = seedOf(html)
		expect(seed?.payload.content.expert.photoUrl).toBe(EXPERT_PHOTO)
		expect(seed?.payload.content.author.photoUrl).toBe(AUTHOR_PHOTO)
		expect(seed?.signature).toEqual(envelope.signature)
		const verdict = await verifyArtifact(
			{ payload: seed?.payload, signature: seed?.signature } as never,
			issuer.resolveKid,
			{ platform: 'builder', externalId: ENTRY_ID, now: new Date(T0) },
		)
		expect(verdict.decision).toBe('render')
	})
})

describe('hidden memo', () => {
	const hidesMemo = (base: object) => ({ ...base, hidden: ['memo'] })

	it.each(FACES)('%s: no memo text anywhere in the full server HTML, the seed included', async (_name, def) => {
		const html = await serverHtml(hidesMemo(def))
		expect(html).toContain('data-certrev-cert-chrome')
		expect(html).not.toContain(MEMO)
		expect(html).not.toContain('Zebrafish')
		const seed = seedOf(html)
		expect(seed?.payload.content.memo).toBeNull()
		// the photo is not what this def hides
		expect(seed?.payload.content.expert.photoUrl).toBe(EXPERT_PHOTO)
		expect(seed).not.toHaveProperty('signature')
	})

	it.each(FACES)('%s: the browser hydrates that HTML unchanged, with no read and no mismatch', async (_name, def) => {
		const html = await serverHtml(hidesMemo(def))
		const { container, serverDom, chromeNode, recoverable, consoleErrors, calls } = await hydrateRefusing(html)
		expect(recoverable).toEqual([])
		expect(consoleErrors).toBe(0)
		expect(calls).toEqual([])
		expect(container.querySelector('[data-certrev-cert-chrome]')).toBe(chromeNode)
		expect(container.innerHTML).toBe(serverDom)
		expect(container.innerHTML).not.toContain('Zebrafish')
	})

	it.each(FACES)('%s: a def that does not hide it paints the memo text', async (_name, def) => {
		const html = await serverHtml({ ...def, hidden: [] })
		expect(html).toContain('Zebrafish')
		expect(seedOf(html)?.payload.content.memo).toBe(MEMO)
	})
})

describe('display.showExpertPhoto: false', () => {
	/** The payload's own switch, with the photos and the memo present and the def hiding nothing. */
	const photoOff = () => {
		const base = builderPayload().content
		return payloadWithPhotosAndMemo({
			display: { ...(base as { display?: object }).display, showExpertPhoto: false },
		} as Partial<CertContent>)
	}
	const hidesNothing = (base: object) => ({ ...base, hidden: [] })

	it.each(FACES)('%s: no photo URL anywhere in the full server HTML, the seed included', async (_name, def) => {
		const html = await serverHtml(hidesNothing(def), photoOff())
		expect(html).toContain('data-certrev-cert-chrome')
		expect(html).not.toContain(EXPERT_PHOTO)
		expect(html).not.toContain('jane-doe.jpg')
		expect(html).not.toContain(AUTHOR_PHOTO)
		expect(html).not.toContain('sam-writer.jpg')
		const seed = seedOf(html)
		expect(seed?.payload.content.expert.photoUrl).toBeNull()
		expect(seed?.payload.content.author.photoUrl).toBeNull()
		// the switch itself, and the rest of the payload, are the served ones
		expect(seed?.payload.content.display.showExpertPhoto).toBe(false)
		expect(seed?.payload.content.expert.displayName).toBe('Dr. Jane Doe')
		expect(seed?.payload.content.memo).toBe(MEMO)
		expect(seed?.payload.content.expert.compensationCue).toBe('Compensated expert')
	})

	it.each(FACES)('%s: the seed carries no signature, as for a stripped def', async (_name, def) => {
		const seed = seedOf(await serverHtml(hidesNothing(def), photoOff()))
		expect(seed).not.toBeNull()
		expect(seed).not.toHaveProperty('signature')
	})

	it('the reader face paints the initials where the photo would be', async () => {
		const html = await serverHtml(hidesNothing(READER_DEF), photoOff())
		expect(html).toContain('>JD</text>')
		expect(html).not.toMatch(/class="certrev-r-face[^"]*"><img/)
	})

	it.each(FACES)('%s: the browser hydrates that HTML unchanged, with no read and no mismatch', async (_name, def) => {
		const html = await serverHtml(hidesNothing(def), photoOff())
		const { container, serverDom, chromeNode, recoverable, consoleErrors, calls } = await hydrateRefusing(html)
		expect(recoverable).toEqual([])
		expect(consoleErrors).toBe(0)
		expect(calls).toEqual([])
		expect(chromeNode).not.toBeNull()
		expect(container.querySelector('[data-certrev-cert-chrome]')).toBe(chromeNode)
		expect(container.innerHTML).toBe(serverDom)
		expect(container.innerHTML).not.toContain('jane-doe.jpg')
		expect(container.innerHTML).not.toContain('sam-writer.jpg')
	})

	it.each(FACES)('%s: with the def hiding the photo as well, the result is the same', async (_name, def) => {
		const both = await serverHtml({ ...def, hidden: ['reviewerPhoto'] }, photoOff())
		const switchOnly = await serverHtml(hidesNothing(def), photoOff())
		for (const html of [both, switchOnly]) {
			expect(html).not.toContain('jane-doe.jpg')
			expect(html).not.toContain('sam-writer.jpg')
			expect(seedOf(html)).not.toHaveProperty('signature')
		}
	})

	it.each(FACES)('%s: with the switch on, the photo and the signature are the served ones', async (_name, def) => {
		const html = await serverHtml(hidesNothing(def))
		const seed = seedOf(html)
		expect(seed?.payload.content.expert.photoUrl).toBe(EXPERT_PHOTO)
		expect(seed?.payload.content.author.photoUrl).toBe(AUTHOR_PHOTO)
		expect(seed?.signature).toBeTruthy()
	})
})

describe('hidden reviewerPhoto and memo together', () => {
	it.each(FACES)('%s: neither is anywhere in the HTML, and the disclosure stays', async (_name, def) => {
		const html = await serverHtml({ ...def, hidden: ['reviewerPhoto', 'memo'] })
		for (const absent of ['jane-doe.jpg', 'sam-writer.jpg', 'Zebrafish']) expect(html).not.toContain(absent)
		const seed = seedOf(html)
		expect(seed).not.toHaveProperty('signature')
		// compensated disclosure is a locked field: no def hides it, and the strip never touches it
		expect(seed?.payload.content.expert.compensationCue).toBe('Compensated expert')
		expect(html).toContain('Compensated expert')
		const { container, serverDom, recoverable, calls } = await hydrateRefusing(html)
		expect(recoverable).toEqual([])
		expect(calls).toEqual([])
		expect(container.innerHTML).toBe(serverDom)
	})
})

describe('the signature', () => {
	it('stays when the def hides a field the payload has nothing in: nothing was stripped, so it still verifies', async () => {
		const bare = builderPayload()
		const expert = { ...(bare.content.expert as object), photoUrl: null }
		const html = await serverHtml(
			{ ...READER_DEF, hidden: ['reviewerPhoto', 'memo'] },
			{ content: { ...bare.content, expert, memo: null } as unknown as CertContent },
		)
		const seed = seedOf(html)
		expect(seed?.signature).toBeTruthy()
		const verdict = await verifyArtifact(
			{ payload: seed?.payload, signature: seed?.signature } as never,
			issuer.resolveKid,
			{ platform: 'builder', externalId: ENTRY_ID, now: new Date(T0) },
		)
		expect(verdict.decision).toBe('render')
	})

	it('stays when the def names an id the faces ignore: only the hideable fields are stripped', async () => {
		const html = await serverHtml({ ...READER_DEF, hidden: ['bio', 'somethingElse'] })
		const seed = seedOf(html)
		expect(seed?.signature).toBeTruthy()
		expect(seed?.payload.content.expert.photoUrl).toBe(EXPERT_PHOTO)
		expect(seed?.payload.content.memo).toBe(MEMO)
	})

	it('the wrapper carries the seed attribute the browser reads', async () => {
		const html = await serverHtml({ ...READER_DEF, hidden: ['reviewerPhoto'] })
		expect(html).toContain(`${SEED_ATTRIBUTE}="`)
	})
})
