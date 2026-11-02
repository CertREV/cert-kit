/**
 * SC2, against the Appearance preview's own bytes: for the same design and content, the hosts this block prints are the
 * hosts the preview page prints (`__fixtures__/contract-v1/preview-parity.json`: the portal's `renderReaderPreview` for a
 * brand on contract 1, its `standInArticle({ surface: 'v1' })` page, and `buildCardDocument` for a Builder placement with
 * the same content, lifecycle and projected def; see the fixture's `source`). The head fragment is byte-identical; every
 * part's and dialog's shadow tree is byte-identical but for the one identity value a preview cannot share with a live
 * card, the certificate id (`appearance-preview`); the hosts' placement attributes name each its own placement. Chromium
 * renders them to the same pixels (`e2e/replica.e2e.test.tsx`, "SC2").
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalizeJson } from '@certrev/cert-contract'
import { afterEach, describe, expect, it } from 'vitest'
import type { CardDocumentV1 } from '../card-contract.js'
import { CertReviewCard } from '../cert-review-card.js'
import { setCardDeliveryRuntimeForTests } from '../delivery-runtime.js'
import { contractBinding, contractBody, contractFixture } from './contract-v1-shapes.js'
import { sha256Hex } from './delivered-face-shapes.js'
import { builderSubject, json, MARKER, makeIssuer, renderToHtml, scriptedDelivery } from './delivery-harness.js'

interface ParityCase {
	readonly externalId: string
	readonly previewHead: string
	readonly previewHosts: Record<string, string>
	readonly previewCertId: string
	readonly builderCard: CardDocumentV1
	readonly builderDoc: string
	readonly content: Record<string, unknown>
	readonly lifecycle: Record<string, unknown>
	readonly renderDef: unknown
}
const parity = JSON.parse(
	readFileSync(join(process.cwd(), 'src/builder/__tests__/__fixtures__/contract-v1/preview-parity.json'), 'utf8'),
) as { readonly now: string; readonly cases: Record<string, ParityCase> }

const issuer = makeIssuer()
let restore: () => void = () => {}
afterEach(() => restore())

/** Every `<certrev-card>` host in `html`, by its part. */
function hostsIn(html: string): Record<string, string> {
	const out: Record<string, string> = {}
	for (const m of html.matchAll(/<certrev-card data-certrev-part="([a-z-]+)"[^>]*>[\s\S]*?<\/certrev-card>/g))
		out[m[1]] = m[0]
	return out
}
/** A host's shadow-root content: its template's inner HTML. */
const rootOf = (host: string) =>
	/<template shadowrootmode="open">([\s\S]*)<\/template><\/certrev-card>$/.exec(host)?.[1] ?? null
const withoutCertId = (html: string | null) =>
	html?.replace(/data-certrev-cert-id="[^"]*"/g, 'data-certrev-cert-id=""') ?? null

describe.each(Object.keys(parity.cases))('%s', (name) => {
	const c = parity.cases[name]

	it('the fixture is what it says: the Builder card hashes to its digest, and the preview names its stand-in identity', () => {
		expect(sha256Hex(canonicalizeJson(c.builderCard))).toBe(c.builderDoc)
		expect(c.previewCertId).toBe('appearance-preview')
		expect(c.builderCard.subject).toEqual({ platform: 'builder', externalId: c.externalId })
	})

	it('the block prints the preview’s head byte for byte, and each host’s shadow tree byte for byte but the certificate id', async () => {
		const fixture = {
			...contractFixture('banner-elf-like'),
			certId: c.builderCard.certId,
			content: c.content as never,
			lifecycle: c.lifecycle as never,
			renderDef: c.renderDef as never,
			card: c.builderCard,
			doc: c.builderDoc,
		}
		const delivery = scriptedDelivery(() =>
			json(
				contractBody(issuer, fixture, {
					faceDigest: contractBinding(fixture),
					payload: { subject: builderSubject(c.externalId) },
				}),
			),
		)
		restore = setCardDeliveryRuntimeForTests({
			resolveKid: issuer.resolveKid,
			fetchImpl: () => delivery.fetch,
			now: () => Date.parse(parity.now),
		})
		const html = await renderToHtml(
			<CertReviewCard delivery={MARKER} builderContext={{ content: { id: c.externalId } }} />,
		)
		expect(html).toContain(c.previewHead)
		const printed = hostsIn(html)
		expect(Object.keys(printed).sort()).toEqual(Object.keys(c.previewHosts).sort())
		for (const [part, host] of Object.entries(printed)) {
			const ours = rootOf(host)
			const theirs = rootOf(c.previewHosts[part])
			expect(ours, `${name} ${part}`).not.toBeNull()
			expect(withoutCertId(ours), `${name} ${part}: shadow tree`).toBe(withoutCertId(theirs))
			// The only difference, where there is one, is the certificate id.
			if (ours !== theirs) {
				expect(ours).toContain(`data-certrev-cert-id="${c.builderCard.certId}"`)
				expect(theirs).toContain('data-certrev-cert-id="appearance-preview"')
			}
		}
	})
})
