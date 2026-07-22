/**
 * renderPreviewBlock (POR-10743) — a static, non-delivery, hard-bounded pre-sales preview.
 * Asserts: pixel-parity with renderCertBlock, the required expiry bound, the machine markers,
 * and the safe-by-default visible label.
 */

import { describe, expect, it } from 'vitest'
import { previewExpiry, renderPreviewBlock } from '../components/preview-block.js'
import type { CertBlockFacts } from '../components/render-cert-block.js'
import { renderCertBlock } from '../components/render-cert-block.js'

const FACTS: CertBlockFacts = {
	authorName: 'Editorial',
	reviewerName: 'Dr. Jane Doe',
	credential: 'MD',
	credentialVerifiedAt: '2026-06-20T00:00:00.000Z',
	certifiedAt: '2026-06-20T00:00:00.000Z',
	memo: 'Reviewed the claims against current guidance; accurate and safely framed.',
	profileUrl: 'https://certrev.com/experts/jane',
	certificateUrl: 'https://certrev.com/verify/cert_x',
}

const EXPIRES = '2026-08-01T00:00:00.000Z'
const input = { mode: 'banner', facts: FACTS } as const

describe('renderPreviewBlock', () => {
	it('REQUIRES expiresAt — a preview must be time-bounded', () => {
		expect(() => renderPreviewBlock(input, { expiresAt: '' })).toThrow(/time-bounded/)
		expect(() => renderPreviewBlock(input, { expiresAt: '   ' })).toThrow(/time-bounded/)
	})

	it('REJECTS an unparseable expiry — the bound must be a real date, not a toothless string', () => {
		expect(() => renderPreviewBlock(input, { expiresAt: 'banana' })).toThrow(/parseable date/)
		expect(() => renderPreviewBlock(input, { expiresAt: 'someday' })).toThrow(/parseable date/)
		// a valid ISO date is accepted
		expect(() => renderPreviewBlock(input, { expiresAt: EXPIRES })).not.toThrow()
	})

	it('is PIXEL-PARITY — the inner visual is byte-identical to renderCertBlock', () => {
		const preview = renderPreviewBlock(input, { expiresAt: EXPIRES, showLabel: false })
		expect(preview).toContain(renderCertBlock(input))
	})

	it('carries the non-delivery machine markers + the required expiry', () => {
		const html = renderPreviewBlock(input, { expiresAt: EXPIRES })
		expect(html).toContain('data-certrev-preview="1"')
		expect(html).toContain(`data-certrev-preview-expires="${EXPIRES}"`)
		// a leading comment banner spells out the non-delivery contract
		expect(html).toContain('<!-- CertREV PREVIEW')
		expect(html).toContain('Never use as delivery')
	})

	it('shows the safe-default visible label; suppressible for a pixel-parity look-demo', () => {
		const labeled = renderPreviewBlock(input, { expiresAt: EXPIRES })
		expect(labeled).toContain('data-certrev-preview-label')
		expect(labeled).toContain('Preview — not a verified certification')

		const bare = renderPreviewBlock(input, { expiresAt: EXPIRES, showLabel: false })
		expect(bare).not.toContain('data-certrev-preview-label')
		// even bare, the machine marker + expiry remain (never suppressible)
		expect(bare).toContain('data-certrev-preview="1"')
		expect(bare).toContain(`data-certrev-preview-expires="${EXPIRES}"`)
	})

	it('honors a custom label', () => {
		const html = renderPreviewBlock(input, { expiresAt: EXPIRES, labelText: 'Sample only' })
		expect(html).toContain('Sample only')
	})

	it('ESCAPES the caller-supplied label — a malicious labelText cannot inject markup', () => {
		const html = renderPreviewBlock(input, {
			expiresAt: EXPIRES,
			labelText: '<img src=x onerror=alert(1)>',
		})
		expect(html).not.toContain('<img src=x onerror=alert(1)>')
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
	})

	it('previewExpiry extracts the baked expiry, and is null for a non-preview', () => {
		const html = renderPreviewBlock(input, { expiresAt: EXPIRES })
		expect(previewExpiry(html)).toBe(EXPIRES)
		expect(previewExpiry(renderCertBlock(input))).toBeNull()
	})
})
