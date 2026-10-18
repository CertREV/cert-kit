/**
 * The banner's credential line is the demo's three leaves in ONE `<em>` (the credential, " · ", the attribution), as
 * the portal's `certrev-reader-banner` snippet prints it (M3): the line reads as one string and is never split, and
 * the spans carry no style of their own. The sidebar's is unchanged, one `<em>` holding the attribution alone, because
 * its bold name line already carries the credential.
 *
 * Each case is held to the Liquid harness's output for the cell (`fixtures/oracle-extra.json`) as well as to the line
 * spelled out here, so the port cannot drift from either.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CertContent } from '../../contract/kernel.js'
import { type ReaderLayout, renderReaderFace } from '../render.js'
import { withPackageRel } from './liquid-rel.js'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

interface ExtraCell {
	readonly id: string
	readonly layout: ReaderLayout
	readonly def: unknown
	readonly content: CertContent
	readonly expected: readonly string[]
}

const { certId } = JSON.parse(readFileSync(`${FIXTURES}golden-cells.json`, 'utf8')) as { certId: string }
const { cells } = JSON.parse(readFileSync(`${FIXTURES}oracle-extra.json`, 'utf8')) as { cells: ExtraCell[] }

const cell = (id: string): ExtraCell => {
	const found = cells.find((c) => c.id === id)
	if (!found) throw new Error(`no oracle cell ${id}`)
	return found
}
const liquid = (id: string): string =>
	cell(id)
		.expected.map((html) => html.replaceAll('&#34;', '&quot;'))
		.map(withPackageRel)
		.join('\n')
const port = (id: string): string => {
	const { layout, def, content } = cell(id)
	return renderReaderFace({ content, def, layout, certId })
}
/** Every `<em>` that makes the credential claim. */
const claims = (html: string): string[] =>
	html.match(/<em>(?:(?!<\/em>)[\s\S])*Credential verified[\s\S]*?<\/em>/g) ?? []

describe('the banner credential line: three leaves in one <em>', () => {
	const CASES = [
		// dated; the credential is the cards' labels joined (cardLabel first, then the bare abbreviation)
		[
			'v9-no-hidden-photos',
			'<em><span>RDN, LD, PhD</span> · <span>Credential verified by CertREV on May 1, 2026</span></em>',
		],
		// no date, or a date that does not parse: only the undated attribution prints, never a made-up date
		['no-cred-date', '<em><span>RDN, LD, PhD</span> · <span>Credential verified by CertREV</span></em>'],
		['cred-date-bad', '<em><span>RDN, LD, PhD</span> · <span>Credential verified by CertREV</span></em>'],
		// a blank label falls to the next credential; a null cardLabel to the abbreviation
		[
			'blank-credential-label',
			'<em><span>PhD</span> · <span>Credential verified by CertREV on May 1, 2026</span></em>',
		],
		[
			'cardlabel-null-falls-to-abbrev',
			'<em><span>MD</span> · <span>Credential verified by CertREV on May 1, 2026</span></em>',
		],
	] as const

	it.each(CASES)('%s prints %s', (name, line) => {
		const id = `x.banner.${name}`
		expect(claims(liquid(id))).toEqual([line])
		expect(claims(port(id))).toEqual([line])
		expect(port(id)).toBe(liquid(id))
	})

	it('makes no verification claim for a reviewer with no displayed credential', () => {
		expect(claims(liquid('x.banner.no-credential'))).toEqual([])
		expect(claims(port('x.banner.no-credential'))).toEqual([])
	})

	it('never prints the old one-string line, nor a span with a class or a style', () => {
		const html = port('x.banner.v9-no-hidden-photos')
		expect(html).not.toContain('<em>RDN, LD, PhD · Credential verified')
		for (const line of claims(html)) expect(line).not.toMatch(/<span[^>]*\s(?:class|style)=/)
	})
})

describe('the sidebar credential line is unchanged: one <em>, the attribution alone', () => {
	it.each([
		['v9-no-hidden-photos', '<em>Credential verified by CertREV on May 1, 2026</em>'],
		['no-cred-date', '<em>Credential verified by CertREV</em>'],
	] as const)('%s prints %s', (name, line) => {
		const id = `x.sidebar.${name}`
		expect(claims(liquid(id))).toEqual([line])
		expect(claims(port(id))).toEqual([line])
		expect(port(id)).toBe(liquid(id))
	})
})
