/**
 * 1.1.0: `CertReviewCard` with and without the `delivery` marker.
 *
 *  - Without it, every options-only shape paints what 1.0.3 painted, byte for byte (the golden
 *    was rendered by the 1.0.3 tarball source, not by this tree).
 *  - With it, the card paints the VERIFIED envelope for its own Builder entry with the brand's
 *    def, and renders nothing for every way that can fail.
 */

import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
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
	T0,
} from './delivery-harness.js'
import { OPTIONS_ONLY_SHAPES } from './options-only-shapes.js'

const GOLDEN = JSON.parse(readFileSync(new URL('./__golden__/options-only-1.0.3.json', import.meta.url), 'utf8')) as {
	golden: Record<string, string>
}

describe('no delivery marker: the 1.0.3 options face, unchanged', () => {
	for (const [name, props] of Object.entries(OPTIONS_ONLY_SHAPES)) {
		it(`${name} paints exactly what 1.0.3 painted`, () => {
			expect(GOLDEN.golden[name]).toBeTypeOf('string')
			expect(renderToStaticMarkup(<CertReviewCard {...(props as CertReviewCardProps)} />)).toBe(GOLDEN.golden[name])
		})
	}

	it("today's export, with no builderContext, paints the options face (the transition)", () => {
		const html = renderToStaticMarkup(<CertReviewCard {...(OPTIONS_ONLY_SHAPES.todaysExport as CertReviewCardProps)} />)
		expect(html).toContain('data-certrev-cert-chrome')
		expect(html).not.toContain('data-certrev-delivery')
		expect(html).toContain('Dr. Jane Doe')
	})

	it('an options-only block never fetches, even with builderContext present', async () => {
		const delivery = scriptedDelivery(() => json({}))
		const restore = setCardDeliveryRuntimeForTests({ fetchImpl: () => delivery.fetch })
		try {
			const props = { ...OPTIONS_ONLY_SHAPES.todaysExport, builderContext: { content: { id: ENTRY_ID } } }
			const html = await renderToHtml(<CertReviewCard {...(props as CertReviewCardProps)} />)
			expect(html).toBe(GOLDEN.golden.todaysExport)
			expect(delivery.calls).toEqual([])
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
	})

	afterEach(() => restore())

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
			await expectNothing()
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

		it('404 (never certified here)', async () => {
			delivery.respond(() => json({ error: 'not_found' }, 404))
			await expectNothing()
		})

		it('500', async () => {
			delivery.respond(() => json({ error: 'boom' }, 500))
			await expectNothing()
		})

		it('a body that is not JSON', async () => {
			delivery.respond(() => new Response('<html>oops</html>', { status: 200 }))
			await expectNothing()
		})

		it('a network error', async () => {
			delivery.respond(() => Promise.reject(new TypeError('fetch failed')))
			await expectNothing()
		})

		it('the fetch deadline', async () => {
			delivery.respond(() => new Promise<Response>(() => {}))
			await expectNothing()
		})

		it('no builderContext, or no content id: never fetches', async () => {
			await expectNothing(card({ builderContext: undefined }))
			await expectNothing(card({ builderContext: { content: null } }))
			await expectNothing(card({ builderContext: { content: { id: '' } } }))
			await expectNothing(card({ builderContext: { content: { id: 42 } } }))
			expect(delivery.calls).toEqual([])
		})

		it.each([
			['http', { v: 1, baseUrl: 'http://staging.portal.certrev.com' }],
			['a foreign origin', { v: 1, baseUrl: 'https://evil.example.com' }],
			['v 2', { v: 2, baseUrl: BASE }],
			['a bare string', BASE],
			['true', true],
		])('a marker that is %s: never fetches, never falls back to the options', async (_label, marker) => {
			await expectNothing(card({ delivery: marker as never }))
			expect(delivery.calls).toEqual([])
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

	describe('lifecycle is judged at render time, over a cached verified read', () => {
		it('an expiry lands at expiresAt without a refetch', async () => {
			const payload = issuer.envelope().payload
			const expiresAt = new Date(T0 + 30_000).toISOString()
			delivery.respond(() => json(deliveryBody(issuer.envelope({ lifecycle: { ...payload.lifecycle, expiresAt } }))))
			expect(chromeRoot(await renderToHtml(card()))).not.toBeNull()
			clock = T0 + 31_000
			expect(chromeRoot(await renderToHtml(card()))).toBeNull()
			expect(delivery.calls).toHaveLength(1)
		})

		it('a revocation lands after the cache TTL with no write on the brand side', async () => {
			expect(chromeRoot(await renderToHtml(card()))).not.toBeNull()
			const tombstone = await issuer.tombstone()
			delivery.respond(() => json(tombstone))
			clock = T0 + 30_000
			expect(chromeRoot(await renderToHtml(card()))).not.toBeNull()
			expect(delivery.calls).toHaveLength(1)
			clock = T0 + 61_000
			expect(chromeRoot(await renderToHtml(card()))).toBeNull()
			expect(delivery.calls).toHaveLength(2)
		})

		it('a def change lands after the cache TTL', async () => {
			expect(await renderToHtml(card())).toContain('--ba:#000000')
			delivery.respond(() =>
				json(deliveryBody(issuer.envelope(), { ...ELF_LIKE_DEF, v: 5, tokens: { accentColor: '#e6007e' } })),
			)
			clock = T0 + 61_000
			const after = await renderToHtml(card())
			expect(after).toContain('--ba:#e6007e')
			expect(after).toContain('data-certrev-def-version="5"')
		})

		it('a failed read is retried after the short negative TTL', async () => {
			delivery.respond(() => json({ error: 'boom' }, 500))
			expect(chromeRoot(await renderToHtml(card()))).toBeNull()
			delivery.respond(() => json(deliveryBody(issuer.envelope())))
			clock = T0 + 6_000
			expect(chromeRoot(await renderToHtml(card()))).not.toBeNull()
		})

		it('two cards on one page share one read', async () => {
			const html = await renderToHtml(
				<>
					{card()}
					{card({ mode: 'sidebar' })}
				</>,
			)
			expect(html.split('<div data-certrev-cert-chrome').length - 1).toBe(2)
			expect(delivery.calls).toHaveLength(1)
		})
	})
})
