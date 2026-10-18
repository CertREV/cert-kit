/**
 * The reader face's copies of the portal's files are locked to what the refresh script recorded.
 *
 * `scripts/refresh-reader.mjs` copies the generated reader stylesheet and the portal's golden pages byte for byte and
 * writes `fixtures/SOURCES.json` (portal commit + sha256 of each copy). Nothing here talks to the portal: these tests
 * re-hash the files on disk, so a hand edit to any copy (or a half-finished refresh) fails loudly instead of letting the
 * renderer, the CSS and the goldens quietly disagree.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { READER_CSS as FROM_INDEX } from '../index.js'
import { READER_CSS } from '../reader-css.generated.js'

const PKG = fileURLToPath(new URL('../../../', import.meta.url))
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

interface Entry {
	readonly bytes: number
	readonly sha256: string
}
interface Manifest {
	readonly portal: { readonly head: string | null; readonly cssAndGoldensCommitted: boolean }
	readonly css: Entry & { readonly file: string }
	readonly goldens: { readonly dir: string; readonly files: Record<string, Entry> }
	readonly oracle: { readonly dir: string; readonly files: Record<string, Entry> }
}

const manifest = JSON.parse(readFileSync(`${FIXTURES}SOURCES.json`, 'utf8')) as Manifest
const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')

describe('reader.css', () => {
	const cssBytes = readFileSync(`${PKG}${manifest.css.file}`)

	it('is the byte-for-byte copy the manifest recorded', () => {
		expect(cssBytes.length).toBe(manifest.css.bytes)
		expect(sha256(cssBytes)).toBe(manifest.css.sha256)
	})

	it('is exactly the generated section, markers included, and nothing else', () => {
		const text = cssBytes.toString('utf8')
		expect(text.startsWith('/* CERTREV-READER-GEN:BEGIN */\n')).toBe(true)
		expect(text.endsWith('/* CERTREV-READER-GEN:END */\n')).toBe(true)
		expect(text.split('/* CERTREV-READER-GEN:BEGIN */')).toHaveLength(2)
		expect(text.split('/* CERTREV-READER-GEN:END */')).toHaveLength(2)
	})

	it('READER_CSS (the string the Builder card inlines) equals the file', () => {
		expect(READER_CSS).toBe(cssBytes.toString('utf8'))
		expect(sha256(READER_CSS)).toBe(manifest.css.sha256)
		expect(FROM_INDEX).toBe(READER_CSS)
	})

	it('can be inlined into a <style> element', () => {
		expect(READER_CSS.toLowerCase()).not.toContain('</style')
		expect(READER_CSS).not.toContain('<!--')
	})

	it('keeps the --cr-* variables on .certrev-reader that the renderer sets inline', () => {
		for (const name of ['--cr-ba', '--cr-ba-fg', '--cr-br', '--cr-bf']) {
			expect(READER_CSS, name).toContain(`var(${name}`)
		}
		expect(READER_CSS).toContain('.certrev-reader')
	})
})

describe('the portal golden pages', () => {
	const dir = `${PKG}${manifest.goldens.dir}`

	it('are exactly the files the manifest lists', () => {
		const onDisk = readdirSync(dir)
			.filter((name) => name.endsWith('.html'))
			.sort()
		expect(onDisk).toEqual(Object.keys(manifest.goldens.files).sort())
		expect(onDisk.length).toBeGreaterThanOrEqual(11)
	})

	it.each(Object.entries(manifest.goldens.files))('%s is the recorded copy', (name, entry) => {
		const bytes = readFileSync(`${dir}/${name}`)
		expect(bytes.length).toBe(entry.bytes)
		expect(sha256(bytes)).toBe(entry.sha256)
	})
})

describe('the oracle inputs and the Liquid harness output', () => {
	it.each(Object.entries(manifest.oracle.files))('%s is the recorded copy', (name, entry) => {
		const bytes = readFileSync(`${PKG}${manifest.oracle.dir}/${name}`)
		expect(bytes.length).toBe(entry.bytes)
		expect(sha256(bytes)).toBe(entry.sha256)
	})

	it('cover the golden cells and the edge cells', () => {
		expect(Object.keys(manifest.oracle.files).sort()).toEqual(['golden-cells.json', 'oracle-extra.json'])
	})
})

describe('the manifest', () => {
	it('names the portal commit the copies came from', () => {
		expect(manifest.portal.head).toMatch(/^[0-9a-f]{40}$/)
	})
})
