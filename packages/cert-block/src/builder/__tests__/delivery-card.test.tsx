/**
 * 1.1.0: `CertReviewCard` with and without the `delivery` marker.
 *
 *  - 2.0.1: without it, nothing at all (1.0.3 to 2.0.0 painted the block's export-time options, facts nobody signed),
 *    and one `no_marker` report.
 *  - With it, the card paints the VERIFIED envelope for its own Builder entry with the brand's
 *    def, and renders nothing for every definitive no (revoked, expired, unverifiable, for another
 *    entry, not found).
 *  - 2.0.1: where CertREV cannot be reached (a 5xx, a body that is not JSON, a network error, the deadline), nothing
 *    either, with a `'none'` record naming `delivery_unreachable` and one report (1.2.0 to 2.0.0 painted the block's
 *    options face). 2.0.2: the server's render waits up to 300 ms (2.0.1: 8 s) and a failure is remembered 60 s (2.0.1:
 *    5 s); a cached certificate is fresh for 30 s and served at most 30 s past that while one refresh runs or while
 *    CertREV is down, then nothing.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderCertBlock } from '../../components/render-cert-block.js'
import { CERT_STRINGS_VERSION } from '../../components/render-def.js'
import { BUILDER_CERT_CHROME_KEYS } from '../cert-chrome-data.js'
import {
	acceptedDeliveryMarker,
	BUILDER_REGISTRATION,
	CERT_COMPONENT_NAME,
	CertReviewCard,
	type CertReviewCardProps,
	certRevCertComponent,
	WIRE_INPUTS,
} from '../cert-review-card.js'
import {
	CARD_DELIVERY_FAILURE_MS,
	CARD_DELIVERY_STALE_MS,
	CARD_DELIVERY_TIMEOUT_MS,
	CARD_DELIVERY_TTL_MS,
	CARD_SERVER_WAIT_MS,
	cardDeliveryRuntime,
	setCardDeliveryRuntimeForTests,
} from '../delivery-runtime.js'
import {
	BASE,
	builderSubject,
	chromeRoot,
	DELIVERY_URL,
	deliveryBody,
	ELF_LIKE_DEF,
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
} from './delivery-harness.js'
import { OPTIONS_ONLY_SHAPES } from './options-only-shapes.js'

/** The memo the fixture block's OPTIONS carry; the envelope's memo is another sentence, so this tells the faces apart. */
const OPTIONS_MEMO = 'The retinol guidance and usage cadence are accurate and safely framed.'
/** The record a server writes beside a face it did not paint from an envelope (2.0.1: always `'none'`). */
const fallbackRecord = (reason?: 'delivery_unreachable' | 'unknown_key') => ({
	v: 1,
	baseUrl: BASE,
	externalId: ENTRY_ID,
	face: 'none',
	...(reason ? { reason } : {}),
})
/** The server's one-line reports in `warn`'s calls, parsed. */
const reports = (warn: ReturnType<typeof vi.spyOn>) =>
	warn.mock.calls
		.map((call) => String(call[0]))
		.filter((line) => line.startsWith('[certrev] card_fallback '))
		.map((line) => JSON.parse(line.slice('[certrev] card_fallback '.length)) as { reason: string; externalId: string })

/** None of the block's export-time facts (the options beside the marker) is in `html`. */
function expectNoExportTimeFact(html: string) {
	for (const fact of ['Dr. Jane Doe', 'MD, FAAD', OPTIONS_MEMO, 'certrev.com/verify/', 'Sam Writer']) {
		expect(html).not.toContain(fact)
	}
}

describe('no delivery marker: nothing at all (2.0.1), and one no_marker report', () => {
	let warn: ReturnType<typeof vi.spyOn>
	beforeEach(() => {
		warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	})
	afterEach(() => warn.mockRestore())

	for (const [name, props] of Object.entries(OPTIONS_ONLY_SHAPES)) {
		it(`${name} prints nothing, never its export-time options`, () => {
			const html = renderToStaticMarkup(<CertReviewCard {...(props as CertReviewCardProps)} />)
			expect(html).toBe('')
			expect(reports(warn)).toEqual([{ reason: 'no_marker', platform: 'builder', externalId: '' }])
		})
	}

	it('a block with no marker but a Builder entry names the entry in its report, and never fetches', async () => {
		const delivery = scriptedDelivery(() => json({}))
		const restore = setCardDeliveryRuntimeForTests({ fetchImpl: () => delivery.fetch })
		try {
			const props = { ...OPTIONS_ONLY_SHAPES.todaysExport, builderContext: { content: { id: ENTRY_ID } } }
			const html = await renderToHtml(<CertReviewCard {...(props as CertReviewCardProps)} />)
			expect(chromeRoot(html)).toBeNull()
			expectNoExportTimeFact(html)
			expect(delivery.calls).toEqual([])
			expect(reports(warn)).toEqual([{ reason: 'no_marker', platform: 'builder', externalId: ENTRY_ID }])
		} finally {
			restore()
		}
	})
})

describe('registration: same name, same import, one new input', () => {
	it('keeps the registered name and the component', () => {
		expect(CERT_COMPONENT_NAME).toBe('CertREV Cert')
		expect(certRevCertComponent.name).toBe('CertREV Cert')
		expect(BUILDER_REGISTRATION.name).toBe('CertREV Cert')
		expect(certRevCertComponent.component).toBe(CertReviewCard)
	})

	it('asks the SDK for builderContext on both registrations', () => {
		expect(certRevCertComponent.shouldReceiveBuilderProps).toEqual({ builderContext: true })
		expect(BUILDER_REGISTRATION.shouldReceiveBuilderProps).toEqual({ builderContext: true })
	})

	it('appends delivery as the 20th wire key, registered advanced with do-not-edit help', () => {
		expect(BUILDER_CERT_CHROME_KEYS).toHaveLength(20)
		expect(BUILDER_CERT_CHROME_KEYS.at(-1)).toBe('delivery')
		const input = WIRE_INPUTS.find((i) => i.name === 'delivery')
		expect(input).toMatchObject({ type: 'object', advanced: true })
		expect(input?.helperText).toMatch(/Do not edit/)
		expect(certRevCertComponent.inputs.map((i) => i.name)).toContain('delivery')
	})
})

describe('acceptedDeliveryMarker', () => {
	it('accepts an https certrev.com origin and normalises it', () => {
		expect(acceptedDeliveryMarker({ v: 1, baseUrl: 'https://portal.certrev.com' })).toEqual({
			baseUrl: 'https://portal.certrev.com',
		})
		expect(acceptedDeliveryMarker({ v: 1, baseUrl: 'https://staging.portal.certrev.com/' })).toEqual({
			baseUrl: 'https://staging.portal.certrev.com',
		})
		expect(acceptedDeliveryMarker({ v: 1, baseUrl: 'https://CERTREV.com' })).toEqual({ baseUrl: 'https://certrev.com' })
	})

	it.each([
		['null', null],
		['a string', 'https://portal.certrev.com'],
		['an array', [1, 'https://portal.certrev.com']],
		['v 2', { v: 2, baseUrl: 'https://portal.certrev.com' }],
		['v "1"', { v: '1', baseUrl: 'https://portal.certrev.com' }],
		['no baseUrl', { v: 1 }],
		['not a URL', { v: 1, baseUrl: 'portal.certrev.com' }],
		['http', { v: 1, baseUrl: 'http://portal.certrev.com' }],
		['a foreign host', { v: 1, baseUrl: 'https://evil.example.com' }],
		['a lookalike suffix', { v: 1, baseUrl: 'https://certrev.com.evil.example' }],
		['a lookalike label', { v: 1, baseUrl: 'https://evilcertrev.com' }],
		['a path', { v: 1, baseUrl: 'https://portal.certrev.com/api' }],
		['a query', { v: 1, baseUrl: 'https://portal.certrev.com/?x=1' }],
		['a fragment', { v: 1, baseUrl: 'https://portal.certrev.com/#x' }],
		['a port', { v: 1, baseUrl: 'https://portal.certrev.com:8443' }],
		['credentials', { v: 1, baseUrl: 'https://user:pw@portal.certrev.com' }],
	])('rejects %s', (_label, value) => {
		expect(acceptedDeliveryMarker(value)).toBeNull()
	})
})

describe('with the delivery marker: the envelope face', () => {
	let issuer: FixtureIssuer
	let delivery: ScriptedDelivery
	let clock: number
	let restore: () => void
	let warn: ReturnType<typeof vi.spyOn>

	const card = (overrides: Partial<CertReviewCardProps> = {}) => (
		<CertReviewCard
			{...(OPTIONS_ONLY_SHAPES.todaysExport as CertReviewCardProps)}
			delivery={MARKER}
			builderContext={{ content: { id: ENTRY_ID } }}
			{...overrides}
		/>
	)

	/** The face `renderCertBlock` paints for the harness payload with a def, written out by hand. */
	const expectedFace = (hidden: readonly string[], accent: string | undefined) => {
		const placed = [
			'label',
			'authorName',
			'authorTitle',
			'reviewerPhoto',
			'bylineCredentialed',
			'bylinePlain',
			'bio',
			'memo',
			'profileLink',
			'certificateLink',
			'scopeLine',
			'compensationCue',
		].filter((f) => !hidden.includes(f))
		return renderCertBlock({
			mode: 'banner',
			theme: accent ? { accentColor: accent, accentFg: '#ffffff' } : {},
			face: { rung: 'standard', placedFields: placed },
			responsive: true,
			facts: {
				authorName: 'Sam Writer',
				authorTitle: 'Senior Content Editor',
				reviewerName: 'Dr. Jane Doe',
				credential: 'MD, FAAD',
				credentialVerifiedAt: '2026-05-01T00:00:00.000Z',
				certifiedAt: '2026-06-21T15:30:00.000Z',
				memo: 'I reviewed the retinol claims against current dermatology guidance; the concentrations and usage cadence cited are accurate and safely framed.',
				bio: 'Board-certified dermatologist.',
				profileUrl: 'https://certrev.com/experts/jane-doe',
				certificateUrl: 'https://certrev.com/verify/cert_fixture_001',
				compensationCue: undefined,
			},
		})
	}

	beforeEach(() => {
		issuer = makeIssuer()
		clock = T0
		delivery = scriptedDelivery(() => json(deliveryBody(issuer.envelope())))
		restore = setCardDeliveryRuntimeForTests({
			resolveKid: issuer.resolveKid,
			fetchImpl: () => delivery.fetch,
			now: () => clock,
			timeoutMs: 200,
		})
		warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	})

	afterEach(() => {
		restore()
		warn.mockRestore()
	})

	it('reads the Delivery API for its own entry and paints the verified facts with the def', async () => {
		const html = await renderToHtml(card())
		expect(delivery.calls).toEqual([DELIVERY_URL])
		const root = chromeRoot(html)
		expect(root).not.toBeNull()
		expect(root).toContain('data-certrev-delivery=""')
		expect(root).toContain(`data-certrev-strings-version="${CERT_STRINGS_VERSION}"`)
		expect(root).toContain('data-certrev-def-version="4"')
		expect(html).toContain(expectedFace(ELF_LIKE_DEF.hidden, '#000000'))
	})

	it('applies the def: the hidden reviewer photo is gone, the black accent carries white ink', async () => {
		const withDef = await renderToHtml(card())
		// The same verified cert with a def that hides nothing, to prove the difference is the def.
		setCardDeliveryRuntimeForTests({ resolveKid: issuer.resolveKid, fetchImpl: () => delivery.fetch, now: () => clock })
		delivery.respond(() => json(deliveryBody(issuer.envelope(), { ...ELF_LIKE_DEF, hidden: [] })))
		const withoutHide = await renderToHtml(card())
		const reviewerTile = '>JD</div>'
		expect(withoutHide).toContain(reviewerTile)
		expect(withDef).not.toContain(reviewerTile)
		expect(withDef).toContain('--ba:#000000')
		expect(withDef).toContain('--ba-fg:#ffffff')
	})

	it('derives the accent ink from the def accent: a light accent carries dark ink', async () => {
		delivery.respond(() =>
			json(deliveryBody(issuer.envelope(), { ...ELF_LIKE_DEF, tokens: { accentColor: '#ffe600' } })),
		)
		const html = await renderToHtml(card())
		expect(html).toContain('--ba:#ffe600')
		expect(html).toContain('--ba-fg:#141414')
	})

	it('a block copied onto another entry asks for, and checks against, that entry', async () => {
		const other = 'entry-fixture-2'
		delivery.respond(() => json(deliveryBody(issuer.envelope({ subject: builderSubject(other) }))))
		const html = await renderToHtml(card({ builderContext: { content: { id: other } } }))
		expect(delivery.calls).toEqual([`${BASE}/api/cert/v1/delivery/builder/${other}`])
		expect(chromeRoot(html)).not.toBeNull()
		// And the original entry's cert, served (by a misrouting cache, say) for the copy, does not paint.
		setCardDeliveryRuntimeForTests({ resolveKid: issuer.resolveKid, fetchImpl: () => delivery.fetch, now: () => clock })
		delivery.respond(() => json(deliveryBody(issuer.envelope())))
		expect(chromeRoot(await renderToHtml(card({ builderContext: { content: { id: other } } })))).toBeNull()
	})

	it('ignores every option: a block whose options name another reviewer paints the envelope', async () => {
		const html = await renderToHtml(
			card({ reviewerName: 'Someone Else, PhD', verifyUrl: 'https://evil.example.com/x' }),
		)
		expect(html).toContain('Dr. Jane Doe')
		expect(html).not.toContain('Someone Else')
		expect(html).not.toContain('evil.example.com')
	})

	it('paints the preset default when the def sibling is absent or malformed', async () => {
		delivery.respond(() => json(issuer.envelope()))
		const noDef = await renderToHtml(card())
		expect(noDef).toContain('Dr. Jane Doe')
		expect(noDef).not.toContain('data-certrev-def-version')
		expect(noDef).toContain(
			renderCertBlock({
				mode: 'banner',
				responsive: true,
				facts: {
					authorName: 'Sam Writer',
					authorTitle: 'Senior Content Editor',
					reviewerName: 'Dr. Jane Doe',
					credential: 'MD, FAAD',
					credentialVerifiedAt: '2026-05-01T00:00:00.000Z',
					certifiedAt: '2026-06-21T15:30:00.000Z',
					memo: 'I reviewed the retinol claims against current dermatology guidance; the concentrations and usage cadence cited are accurate and safely framed.',
					bio: 'Board-certified dermatologist.',
					profileUrl: 'https://certrev.com/experts/jane-doe',
					certificateUrl: 'https://certrev.com/verify/cert_fixture_001',
					compensationCue: undefined,
				},
			}),
		)
		setCardDeliveryRuntimeForTests({ resolveKid: issuer.resolveKid, fetchImpl: () => delivery.fetch, now: () => clock })
		delivery.respond(() => json(deliveryBody(issuer.envelope(), { v: 'x', hidden: 'reviewerPhoto' })))
		expect(await renderToHtml(card())).toBe(noDef)
	})

	it('a def cannot hide the scope line or the certificate link', async () => {
		delivery.respond(() =>
			json(
				deliveryBody(issuer.envelope(), { ...ELF_LIKE_DEF, hidden: ['scopeLine', 'certificateLink', 'reviewerPhoto'] }),
			),
		)
		expect(await renderToHtml(card())).toContain(expectedFace(ELF_LIKE_DEF.hidden, '#000000'))
	})

	it('an editor-chosen mode wins over the def layout', async () => {
		delivery.respond(() => json(deliveryBody(issuer.envelope(), { ...ELF_LIKE_DEF, layout: 'sidebar' })))
		const byDef = await renderToHtml(card({ mode: undefined }))
		setCardDeliveryRuntimeForTests({ resolveKid: issuer.resolveKid, fetchImpl: () => delivery.fetch, now: () => clock })
		const byEditor = await renderToHtml(card({ mode: 'floating' }))
		expect(byDef).toContain('data-certrev-mode="sidebar"')
		expect(byEditor).toContain('data-certrev-mode="floating"')
	})

	it('reads the pro-bono face from the envelope, not from the options', async () => {
		const payload = issuer.envelope().payload
		const proBono = issuer.envelope({
			content: { ...payload.content, expert: { ...payload.content.expert, compensationCue: null } },
		})
		const paid = await renderToHtml(card())
		expect(paid).toContain('Compensated expert')
		setCardDeliveryRuntimeForTests({ resolveKid: issuer.resolveKid, fetchImpl: () => delivery.fetch, now: () => clock })
		delivery.respond(() => json(deliveryBody(proBono)))
		// The block's options still carry a compensation cue string; the envelope says pro bono.
		const html = await renderToHtml(card())
		expect(html).toContain('Dr. Jane Doe')
		expect(html).not.toContain('Compensated expert')
	})

	describe('fails closed: renders nothing', () => {
		const expectNothing = async (element = card()) => {
			const html = await renderToHtml(element)
			expect(chromeRoot(html)).toBeNull()
			expect(html).not.toContain('Dr. Jane Doe')
			expect(html).not.toContain('Someone')
			return html
		}

		it('revoked: the Delivery API serves a tombstone', async () => {
			const tombstone = await issuer.tombstone()
			delivery.respond(() => json(tombstone))
			const html = await expectNothing()
			// An empty hidden element carries the server's "nothing", so a client re-render keeps it (1.2.0).
			expect(html).toMatch(/<div hidden="" data-certrev-envelope="/)
			expect(seedOf(html)).toEqual(fallbackRecord())
			// A definitive no is not a fallback: nothing is reported.
			expect(reports(warn)).toEqual([])
		})

		it('revoked inside the envelope (revokedAt set)', async () => {
			const payload = issuer.envelope().payload
			delivery.respond(() =>
				json(
					deliveryBody(issuer.envelope({ lifecycle: { ...payload.lifecycle, revokedAt: '2026-09-01T00:00:00.000Z' } })),
				),
			)
			await expectNothing()
		})

		it('expired', async () => {
			const payload = issuer.envelope().payload
			delivery.respond(() =>
				json(
					deliveryBody(issuer.envelope({ lifecycle: { ...payload.lifecycle, expiresAt: '2026-09-01T00:00:00.000Z' } })),
				),
			)
			await expectNothing()
		})

		it('an envelope for another Builder entry', async () => {
			delivery.respond(() => json(deliveryBody(issuer.envelope({ subject: builderSubject('another-entry') }))))
			await expectNothing()
		})

		it('an envelope for another platform with the same id', async () => {
			delivery.respond(() =>
				json(deliveryBody(issuer.envelope({ subject: { ...builderSubject(), platform: 'shopify' } }))),
			)
			await expectNothing()
		})

		it('a tampered payload (signature no longer matches)', async () => {
			const env = issuer.envelope()
			const tampered = {
				...env,
				payload: { ...env.payload, content: { ...env.payload.content, memo: 'Someone rewrote this memo.' } },
			}
			delivery.respond(() => json(deliveryBody(tampered)))
			await expectNothing()
		})

		it('signed by a key the card does not trust', async () => {
			const stranger = makeIssuer('fixture-issuer-1')
			delivery.respond(() => json(deliveryBody(stranger.envelope())))
			await expectNothing()
		})

		it('an unknown kid', async () => {
			delivery.respond(() => json(deliveryBody(makeIssuer('some-other-kid').envelope())))
			await expectNothing()
		})

		it.each([
			['404 (never certified here)', 404],
			['410 (gone)', 410],
		])('%s', async (_label, status) => {
			delivery.respond(() => json({ error: 'not_found' }, status))
			expect(seedOf(await expectNothing())).toEqual(fallbackRecord())
		})

		it('an envelope for another entry carries the none record too (it is a definitive no, not an outage)', async () => {
			delivery.respond(() => json(deliveryBody(issuer.envelope({ subject: builderSubject('another-entry') }))))
			expect(seedOf(await expectNothing())).toEqual(fallbackRecord())
		})

		it('no builderContext, or no content id: never fetches, and reports marker_invalid', async () => {
			await expectNothing(card({ builderContext: undefined }))
			await expectNothing(card({ builderContext: { content: null } }))
			await expectNothing(card({ builderContext: { content: { id: '' } } }))
			await expectNothing(card({ builderContext: { content: { id: 42 } } }))
			expect(delivery.calls).toEqual([])
			expect(reports(warn).map((r) => r.reason)).toEqual(Array(4).fill('marker_invalid'))
		})

		it.each([
			['http', { v: 1, baseUrl: 'http://staging.portal.certrev.com' }],
			['a foreign origin', { v: 1, baseUrl: 'https://evil.example.com' }],
			['v 2', { v: 2, baseUrl: BASE }],
			['a bare string', BASE],
			['true', true],
		])('a marker that is %s: never fetches, never falls back to the options, reports marker_invalid', async (_label, marker) => {
			expectNoExportTimeFact(await expectNothing(card({ delivery: marker as never })))
			expect(delivery.calls).toEqual([])
			expect(reports(warn)).toEqual([{ reason: 'marker_invalid', platform: 'builder', externalId: ENTRY_ID }])
		})

		it('uses the baked trust root when no test resolver is installed', async () => {
			// Back to the baked resolver: only `cert-issuer-1` with the production public key. A
			// fixture key, even one stamped with that kid, does not verify.
			restore()
			restore = setCardDeliveryRuntimeForTests({ fetchImpl: () => delivery.fetch, now: () => clock })
			delivery.respond(() => json(deliveryBody(makeIssuer('cert-issuer-1').envelope())))
			await expectNothing()
			expect(delivery.calls).toEqual([DELIVERY_URL])
		})
	})

	describe('CertREV not reached: nothing, a delivery_unreachable record and one report (2.0.1)', () => {
		/** Nothing printed, none of the block's export-time facts, the `'none'` record naming the outage, one report. */
		const expectUnreachable = async (element = card(), status?: number) => {
			const html = await renderToHtml(element)
			expect(chromeRoot(html)).toBeNull()
			expectNoExportTimeFact(html)
			expect(html).not.toContain('I reviewed the retinol claims')
			// 2.0.1 (final review R1-7): an HTTP error answer carries its status.
			expect(reports(warn)).toEqual([
				{ reason: 'delivery_unreachable', platform: 'builder', externalId: ENTRY_ID, ...(status ? { status } : {}) },
			])
			return html
		}

		it.each<[string, () => Response | Promise<Response>, number | undefined]>([
			['a 500', () => json({ error: 'boom' }, 500), 500],
			['a 503', () => json({ error: 'unavailable' }, 503), 503],
			['a body that is not JSON', () => new Response('<html>oops</html>', { status: 200 }), undefined],
			['a JSON body that is not an object', () => json([1, 2]), undefined],
			['a network error', () => Promise.reject(new TypeError('fetch failed')), undefined],
			['the fetch deadline', () => new Promise<Response>(() => {}), undefined],
		])('%s: nothing, never the options face', async (_label, answer, status) => {
			delivery.respond(answer)
			const html = await expectUnreachable(card(), status)
			expect(seedOf(html)).toEqual(fallbackRecord('delivery_unreachable'))
			expect(html).toMatch(/^<!--\$--><div hidden="" data-certrev-envelope="[^"]*"><\/div><!--\/\$-->$/)
			expect(delivery.calls).toEqual([DELIVERY_URL])
		})

		it('whatever layout the block carries or an editor chose, nothing', async () => {
			delivery.respond(() => json({ error: 'boom' }, 500))
			const sidebarDef = { ...(OPTIONS_ONLY_SHAPES.todaysExportWithDef.renderDef as object), layout: 'sidebar' }
			await expectUnreachable(card({ renderDef: sidebarDef as never }), 500)
			warn.mockClear()
			await expectUnreachable(card({ renderDef: sidebarDef as never, mode: 'banner' }), 500)
		})

		it('a block with no reviewer in its options: the same nothing and the same record', async () => {
			delivery.respond(() => json({ error: 'boom' }, 500))
			const html = await expectUnreachable(card({ reviewerName: null as never }), 500)
			expect(seedOf(html)).toEqual(fallbackRecord('delivery_unreachable'))
		})

		it('a pinned card (the canary replica): nothing, with a record that names its pin and the outage', async () => {
			delivery.respond(() => json({ error: 'boom' }, 500))
			const html = await expectUnreachable(
				card({
					builderContext: {
						content: { id: ENTRY_ID },
						context: { certrevDesignPin: { design: '4', designBrand: 'staging-shopify-canary' } },
					},
				}),
				500,
			)
			expect(seedOf(html)).toEqual({
				...fallbackRecord('delivery_unreachable'),
				design: { version: 4, brand: 'staging-shopify-canary' },
			})
			expect(delivery.calls).toEqual([`${DELIVERY_URL}?design=4&designBrand=staging-shopify-canary`])
		})

		it('2.0.2 (SC1): a server render waits 300 ms; the read itself may run 8 s; a failure is remembered 60 s; a certificate is fresh 30 s and served 30 s past that', () => {
			restore()
			expect(CARD_SERVER_WAIT_MS).toBe(300)
			expect(CARD_DELIVERY_TIMEOUT_MS).toBe(8_000)
			expect(CARD_DELIVERY_FAILURE_MS).toBe(60_000)
			expect(CARD_DELIVERY_TTL_MS).toBe(30_000)
			expect(CARD_DELIVERY_STALE_MS).toBe(30_000)
			expect(cardDeliveryRuntime().timeoutMs).toBe(CARD_DELIVERY_TIMEOUT_MS)
			expect(cardDeliveryRuntime().serverWaitMs).toBe(CARD_SERVER_WAIT_MS)
			restore = setCardDeliveryRuntimeForTests({ fetchImpl: () => delivery.fetch })
			expect(cardDeliveryRuntime().timeoutMs).toBe(CARD_DELIVERY_TIMEOUT_MS)
			expect(cardDeliveryRuntime().serverWaitMs).toBe(CARD_SERVER_WAIT_MS)
		})

		it('2.0.2 (SC1): a read slower than the server wait prints nothing at 300 ms, lands in the cache, and the next render paints it with no new read', async () => {
			restore()
			restore = setCardDeliveryRuntimeForTests({
				resolveKid: issuer.resolveKid,
				fetchImpl: () => delivery.fetch,
				now: () => clock,
				timeoutMs: CARD_DELIVERY_TIMEOUT_MS,
				serverWaitMs: CARD_SERVER_WAIT_MS,
			})
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
			try {
				const body = deliveryBody(issuer.envelope())
				delivery.respond(() => new Promise<Response>((resolve) => setTimeout(() => resolve(json(body)), 5_000)))
				let done = false
				const pending = renderToHtml(card()).then((html) => {
					done = true
					return html
				})
				await vi.advanceTimersByTimeAsync(299)
				expect(done).toBe(false)
				await vi.advanceTimersByTimeAsync(1)
				const first = await pending
				expect(chromeRoot(first)).toBeNull()
				expect(seedOf(first)).toEqual(fallbackRecord('delivery_unreachable'))
				// The read runs on and lands at 5 s (its verification is real async work): from then on a render paints it, at
				// once, and nothing reads again. Every render before it lands prints nothing at once (the remembered failure).
				await vi.advanceTimersByTimeAsync(4_700)
				await vi.waitFor(async () => expect(await renderToHtml(card())).toContain('I reviewed the retinol claims'), {
					timeout: 2_000,
					interval: 5,
				})
				expect(delivery.calls).toHaveLength(1)
			} finally {
				vi.useRealTimers()
			}
		})
	})

	describe('lifecycle is judged at render time, over a cached verified read', () => {
		/** Render until `check` holds: a stale read's one background refresh lands between renders. */
		const eventually = (check: (html: string) => void) =>
			vi.waitFor(async () => check(await renderToHtml(card())), { timeout: 2_000, interval: 5 })

		it('an expiry lands at expiresAt without a refetch', async () => {
			const payload = issuer.envelope().payload
			// Inside the cached read's TTL, so the expiry is the payload's own, judged at the render's clock.
			const expiresAt = new Date(T0 + CARD_DELIVERY_TTL_MS - 10_000).toISOString()
			delivery.respond(() => json(deliveryBody(issuer.envelope({ lifecycle: { ...payload.lifecycle, expiresAt } }))))
			expect(chromeRoot(await renderToHtml(card()))).not.toBeNull()
			clock = T0 + CARD_DELIVERY_TTL_MS - 9_000
			expect(chromeRoot(await renderToHtml(card()))).toBeNull()
			expect(delivery.calls).toHaveLength(1)
		})

		it('a revocation lands with the first refresh after the cache TTL, with no write on the brand side', async () => {
			expect(chromeRoot(await renderToHtml(card()))).not.toBeNull()
			const tombstone = await issuer.tombstone()
			delivery.respond(() => json(tombstone))
			clock = T0 + CARD_DELIVERY_TTL_MS - 1_000
			expect(chromeRoot(await renderToHtml(card()))).not.toBeNull()
			expect(delivery.calls).toHaveLength(1)
			// Past the TTL the cached certificate paints once more, at once, while ONE refresh reads the tombstone.
			clock = T0 + CARD_DELIVERY_TTL_MS + 1_000
			expect(chromeRoot(await renderToHtml(card()))).not.toBeNull()
			expect(delivery.calls).toHaveLength(2)
			await eventually((html) => expect(chromeRoot(html)).toBeNull())
			expect(delivery.calls).toHaveLength(2)
		})

		it('a def change lands with the first refresh after the cache TTL', async () => {
			expect(await renderToHtml(card())).toContain('--ba:#000000')
			delivery.respond(() =>
				json(deliveryBody(issuer.envelope(), { ...ELF_LIKE_DEF, v: 5, tokens: { accentColor: '#e6007e' } })),
			)
			clock = T0 + CARD_DELIVERY_TTL_MS + 1_000
			expect(await renderToHtml(card())).toContain('--ba:#000000')
			await eventually((after) => {
				expect(after).toContain('--ba:#e6007e')
				expect(after).toContain('data-certrev-def-version="5"')
			})
		})

		it('CertREV down past the TTL: the verified card keeps painting 30 s more, then nothing (never stale forever)', async () => {
			expect(await renderToHtml(card())).toContain('I reviewed the retinol claims')
			delivery.respond(() => json({ error: 'boom' }, 500))
			clock = T0 + CARD_DELIVERY_TTL_MS + 1_000
			expect(await renderToHtml(card())).toContain('I reviewed the retinol claims')
			// The failed refreshes keep the stale entry, but never move its end.
			await eventually((html) => expect(html).toContain('I reviewed the retinol claims'))
			clock = T0 + CARD_DELIVERY_TTL_MS + CARD_DELIVERY_STALE_MS - 1_000
			expect(await renderToHtml(card())).toContain('I reviewed the retinol claims')
			clock = T0 + CARD_DELIVERY_TTL_MS + CARD_DELIVERY_STALE_MS
			const after = await renderToHtml(card())
			expect(chromeRoot(after)).toBeNull()
			expectNoExportTimeFact(after)
			expect(seedOf(after)).toEqual(fallbackRecord('delivery_unreachable'))
			// And it stays nothing while CertREV stays down, however long.
			clock = T0 + 3_600_000
			expect(chromeRoot(await renderToHtml(card()))).toBeNull()
		})

		it('2.0.2 (SC1): a failed read prints nothing, is remembered 60 s with no read, then read once more', async () => {
			delivery.respond(() => json({ error: 'boom' }, 500))
			expect(seedOf(await renderToHtml(card()))).toEqual(fallbackRecord('delivery_unreachable'))
			delivery.respond(() => json(deliveryBody(issuer.envelope())))
			clock = T0 + 6_000
			expect(seedOf(await renderToHtml(card()))).toEqual(fallbackRecord('delivery_unreachable'))
			clock = T0 + CARD_DELIVERY_FAILURE_MS - 1
			expect(seedOf(await renderToHtml(card()))).toEqual(fallbackRecord('delivery_unreachable'))
			expect(delivery.calls).toHaveLength(1)
			clock = T0 + CARD_DELIVERY_FAILURE_MS
			expect(await renderToHtml(card())).toContain('I reviewed the retinol claims')
			expect(delivery.calls).toHaveLength(2)
		})

		it('two cards on one page share one read (2.0.2: on the cold read the second does not wait for it)', async () => {
			const page = (
				<>
					{card()}
					{card({ mode: 'sidebar' })}
				</>
			)
			// 2.0.2 (final review R1-1): the cold render's second card prints the skipped marker instead of waiting.
			const cold = await renderToHtml(page)
			expect(cold.split('<div data-certrev-cert-chrome').length - 1).toBe(1)
			expect(cold).toContain('data-certrev-skipped=')
			const html = await renderToHtml(page)
			expect(html.split('<div data-certrev-cert-chrome').length - 1).toBe(2)
			expect(delivery.calls).toHaveLength(1)
		})
	})
})
