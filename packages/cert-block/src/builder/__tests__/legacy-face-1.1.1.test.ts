/**
 * 1.2.0 adds a face and changes nothing about the old one: against what 1.1.1 itself painted.
 *
 * `__golden__/envelope-face-1.1.1.json` was written by `scripts/legacy-golden/dump-envelope-111.oracle.ts` from the
 * source of the 1.1.1 tag (816b288), for every case in `legacy-face-cases.ts`: the def 1.1.1's `parseRenderDef` kept
 * of the raw def, and the HTML `renderCertBlock(envelopeCardInput(...))` painted from it. This file holds the 1.2.0
 * tree to those bytes:
 *
 *  - a def with no `face`, an unknown `face` (`legacy`, `minimal-v9`, `Reader`, `reader `, a number, null, ''), and any
 *    def that merely carries `accentFg` paint EXACTLY the 1.1.1 bytes through `envelopeCardHtml`: the reader face is
 *    selected by `face === 'reader'`, spelled exactly, and nothing else;
 *  - a def with `face: 'reader'` is the only one that paints something else, and it paints the reader face;
 *  - `envelopeCardInput` and `renderCertBlock` themselves, which the reader branch sits beside, are byte-identical.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderCertBlock } from '../../components/render-cert-block.js'
import { parseRenderDef } from '../../verify/get-verified-delivery.js'
import type { CertChromeRenderDef } from '../cert-chrome-data.js'
import { envelopeCardHtml, envelopeCardInput, isReaderFaceDef } from '../envelope-face.js'
import { CONTENTS, LEGACY_CASES, OPTION_SETS, RAW_DEFS } from './legacy-face-cases.js'

const GOLDEN = JSON.parse(readFileSync(new URL('./__golden__/envelope-face-1.1.1.json', import.meta.url), 'utf8')) as {
	generatedFrom: string
	parsed: Record<string, unknown>
	cases: Record<string, { bytes: number; sha256: string; html: string }>
}

/** What 1.2.0 keeps of a raw def beyond what 1.1.1 kept: only `face` (a string) and `accentFg` (a valid ink). */
const EXTRA_KEPT: Record<string, Record<string, string>> = {
	'face-reader': { face: 'reader', accentFg: '#141414' },
	'face-reader-sidebar': { face: 'reader', accentFg: '#141414' },
	'face-legacy': { face: 'legacy' },
	'face-unknown': { face: 'minimal-v9', accentFg: '#ffffff' },
	'face-capitalised': { face: 'Reader' },
	'face-padded': { face: 'reader ' },
	'face-empty': { face: '' },
	'accentfg-only': { accentFg: '#ffffff' },
}

const isReaderRaw = (name: string) => EXTRA_KEPT[name]?.face === 'reader'

describe('the golden is 1.1.1 itself', () => {
	it('names its source and covers the whole matrix', () => {
		expect(GOLDEN.generatedFrom).toContain('816b288')
		expect(Object.keys(GOLDEN.cases).sort()).toEqual(LEGACY_CASES.map((c) => c.id).sort())
		expect(LEGACY_CASES.length).toBeGreaterThanOrEqual(100)
	})

	it('1.1.1 dropped `face` and `accentFg` while parsing the def (it neither rejected nor honoured them)', () => {
		for (const name of [
			'face-reader',
			'face-reader-sidebar',
			'face-unknown',
			'accentfg-only',
			'face-number',
			'face-null',
		]) {
			expect(GOLDEN.parsed[name], name).not.toHaveProperty('face')
			expect(GOLDEN.parsed[name], name).not.toHaveProperty('accentFg')
			expect(GOLDEN.parsed[name], name).not.toBeNull()
		}
	})

	it('so 1.1.1 painted a reader-face def exactly as the same def without the face keys', () => {
		expect(GOLDEN.cases['full.face-reader.default']?.html).toBeTruthy()
		expect(GOLDEN.cases['full.face-reader.default']?.html).toBe(GOLDEN.cases['full.branded.default']?.html)
		expect(GOLDEN.cases['full.face-unknown.default']?.html).toBe(GOLDEN.cases['full.branded.default']?.html)
	})
})

describe('parseRenderDef keeps what 1.1.1 kept, plus the two well-formed reader keys', () => {
	it.each(Object.keys(RAW_DEFS))('%s', (name) => {
		const parsed = parseRenderDef(RAW_DEFS[name])
		const before = GOLDEN.parsed[name]
		if (before === null) return expect(parsed).toBeNull()
		expect(parsed).toEqual({ ...(before as object), ...(EXTRA_KEPT[name] ?? {}) })
	})

	it('an unknown, non-string or malformed face / accentFg is dropped, never a reason to reject the def', () => {
		for (const name of ['face-number', 'face-null', 'accentfg-malformed']) {
			const parsed = parseRenderDef(RAW_DEFS[name])
			expect(parsed, name).not.toBeNull()
			expect(parsed, name).toEqual(GOLDEN.parsed[name])
		}
	})
})

describe.each(LEGACY_CASES)('$id', (c) => {
	const golden = GOLDEN.cases[c.id]
	const content = CONTENTS[c.content]
	const options = OPTION_SETS[c.options]
	const def = parseRenderDef(RAW_DEFS[c.def])
	if (!golden || !content || !options) throw new Error(`missing fixture for ${c.id}`)

	it('envelopeCardInput + renderCertBlock still paint the 1.1.1 bytes', () => {
		const input = envelopeCardInput(content, def, options)
		const html = input ? renderCertBlock(input) : ''
		expect(html).toBe(golden.html)
		expect(Buffer.byteLength(html)).toBe(golden.bytes)
		expect(createHash('sha256').update(html).digest('hex')).toBe(golden.sha256)
	})

	if (isReaderRaw(c.def)) {
		it('face "reader": envelopeCardHtml paints the reader face, not the legacy bytes', () => {
			expect(isReaderFaceDef(def)).toBe(true)
			const html = envelopeCardHtml(content, def, options)
			if (c.content === 'sparse' && c.options === 'banner-memo') {
				// The memo part of a cert with no memo is nothing, on the reader face as in the Liquid.
				expect(html).toBe('')
				return
			}
			expect(html.startsWith('<section class="certrev-reader')).toBe(true)
			expect(html).not.toBe(golden.html)
			expect(html).not.toContain('data-certrev-mode=')
		})
	} else {
		it('every other face: envelopeCardHtml paints exactly the 1.1.1 bytes', () => {
			expect(isReaderFaceDef(def)).toBe(false)
			expect(envelopeCardHtml(content, def, options)).toBe(golden.html)
		})
	}
})

describe('the reader face is chosen by `face === "reader"` and nothing else', () => {
	const legacyDef = parseRenderDef(RAW_DEFS.branded) as CertChromeRenderDef

	it.each([
		['absent', legacyDef],
		['"legacy"', { ...legacyDef, face: 'legacy' }],
		['"READER"', { ...legacyDef, face: 'READER' }],
		['"reader "', { ...legacyDef, face: 'reader ' }],
		['"readers"', { ...legacyDef, face: 'readers' }],
		['a different face', { ...legacyDef, face: 'minimal-v9' }],
		['no def at all', null],
	])('%s paints the legacy face', (_label, def) => {
		expect(isReaderFaceDef(def as CertChromeRenderDef | null)).toBe(false)
		const html = envelopeCardHtml(CONTENTS.full as never, def as CertChromeRenderDef | null)
		expect(html).toContain('certrev-cert--banner')
		expect(html).not.toContain('certrev-reader')
	})

	it('"reader" paints the reader face', () => {
		const html = envelopeCardHtml(CONTENTS.full as never, { ...legacyDef, face: 'reader' })
		expect(html).toContain('class="certrev-reader')
		expect(html).not.toContain('certrev-cert--banner')
	})

	it('a hostile type in `face` is not the reader face and does not throw', () => {
		for (const face of [{ toString: () => 'reader' }, ['reader'], 7, true, null, undefined]) {
			const def = { ...legacyDef, face } as unknown as CertChromeRenderDef
			expect(isReaderFaceDef(def)).toBe(false)
			expect(() => envelopeCardHtml(CONTENTS.full as never, def)).not.toThrow()
			expect(envelopeCardHtml(CONTENTS.full as never, def)).toContain('certrev-cert--banner')
		}
	})

	it('both faces keep the shared gate: no reviewer or no certificate URL paints nothing', () => {
		const noReviewer = { ...CONTENTS.full, expert: { ...CONTENTS.full?.expert, displayName: '' } } as never
		const noUrl = { ...CONTENTS.full, verifyUrl: '' } as never
		for (const face of [undefined, 'reader']) {
			const def = { ...legacyDef, ...(face ? { face } : {}) }
			expect(envelopeCardHtml(noReviewer, def)).toBe('')
			expect(envelopeCardHtml(noUrl, def)).toBe('')
		}
	})
})
