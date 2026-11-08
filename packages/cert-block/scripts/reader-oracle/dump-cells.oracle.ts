/**
 * Reader-face ORACLE, part 1 (the golden cells' inputs). Runs inside the PORTAL's vitest (the `@` alias points at the portal's src/): it paints
 * the portal's own Liquid harness (the same one that writes the portal's reader goldens) for inputs the cert-block
 * port must reproduce, and writes JSON for src/reader/__tests__/fixtures/. Driven by scripts/refresh-reader.mjs
 * --oracle --masked-brand <slug> (the portal masked fixture brand to paint; required, no default); it never writes
 * into the portal.
 */
import fs from 'node:fs'
import path from 'node:path'
import { it } from 'vitest'
import { maskedBrand } from '@/lib/cert-render/parity/__fixtures__/masked-brands'
import { contentFor } from '@/lib/cert-render/reader/legacy-cells'
import { paint, readerDef } from '@/lib/cert-render/reader/reader-test-kit'

const MASKED_BRAND = process.env.READER_ORACLE_MASKED_BRAND
if (!MASKED_BRAND) throw new Error('READER_ORACLE_MASKED_BRAND is required (refresh-reader.mjs --oracle --masked-brand <slug>)')
const OUT = process.env.READER_ORACLE_OUT ?? path.join(__dirname, 'out')
const GOLD = { accentColor: '#F5C518', barInk: '#F5C518', fontSlot: 'serif', cornerRadius: '0px' } as const
const BURG = { accentColor: '#7A1F2B', barInk: '#7A1F2B', fontSlot: 'mono', cornerRadius: '22px' } as const

it('dumps the golden cell inputs and the Liquid output', async () => {
	fs.mkdirSync(OUT, { recursive: true })
	const brand = maskedBrand(MASKED_BRAND)
	const cells = [
		{ id: 'banner.navy-full', variant: 'full', def: readerDef({ accentColor: '#0A1B3F' }) },
		{ id: 'banner.navy-sparse', variant: 'sparse', def: readerDef() },
		{ id: 'banner.gold-serif-sharp-full', variant: 'full', def: readerDef(GOLD) },
		{ id: 'banner.burgundy-mono-pill-nophoto', variant: 'full', def: readerDef(BURG, ['reviewerPhoto']) },
		{ id: 'sidebar.navy-full', variant: 'full', def: readerDef({ accentColor: '#0A1B3F' }, [], 'sidebar') },
		{ id: 'sidebar.navy-sparse', variant: 'sparse', def: readerDef({}, [], 'sidebar') },
		{ id: 'sidebar.gold-serif-sharp-full', variant: 'full', def: readerDef(GOLD, [], 'sidebar') },
		{ id: 'sidebar.burgundy-mono-pill-nophoto', variant: 'full', def: readerDef(BURG, ['reviewerPhoto'], 'sidebar') },
		{ id: 'floating.navy', variant: 'full', def: readerDef({ accentColor: '#0A1B3F' }, [], 'floating') },
		{ id: 'floating.gold-serif-sharp', variant: 'full', def: readerDef(GOLD, [], 'floating') },
		{ id: 'floating.burgundy-mono-pill', variant: 'full', def: readerDef(BURG, [], 'floating') },
	] as const
	const out = cells.map((c) => ({ id: c.id, variant: c.variant, def: c.def, content: contentFor(brand, c.variant) }))
	// The golden cells' inputs. The expected bytes are the portal's committed goldens, copied by the refresh script.
	const certId = /data-certrev-cert-id="([^"]*)"/.exec(await paint(out[0].content, out[0].def as never))?.[1] ?? ''
	fs.writeFileSync(path.join(OUT, 'golden-cells.json'), JSON.stringify({ certId, cells: out }))
})
