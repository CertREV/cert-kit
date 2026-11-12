/**
 * Brand-code guard: no client brand literal in this kit's shipped source or its scripts.
 *
 * Owner rule (2026-11-06): "zero brand specific code in system. every difference between clients should be config."
 * Scans non-test files under packages/*\/src and packages/*\/scripts for the catalog's brand tokens, domains and ids
 * (brand-code-guard.catalog.json, a copy of the portal's catalog). COMMENTS are stripped before matching (prose may
 * say where a requirement came from, but should name the general case); string, template and identifier text is
 * scanned. Test files, __tests__/__fixtures__ and type tests are not scanned: they are data about a case.
 * The reviewed allowlist below is for names the code cannot change without renaming committed fixture files.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import catalog from './brand-code-guard.catalog.json'

interface CatalogBrand {
	brand: string
	tokens?: string[][]
	caseSensitiveTokens?: string[]
	wordTokens?: string[]
	notFollowedBy?: string[]
	domains?: string[]
	ids?: string[]
}

const REPO = join(__dirname, '..', '..', '..', '..')
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SEP = '[^a-z0-9]*'

/** Replace comments with spaces (same offsets, same newlines), leaving string/template/regex bodies alone. */
export function stripComments(src: string): string {
	let out = ''
	let i = 0
	const n = src.length
	while (i < n) {
		const c = src[i]
		const d = src[i + 1]
		if (c === '/' && d === '/') {
			while (i < n && src[i] !== '\n') { out += ' '; i++ }
		} else if (c === '/' && d === '*') {
			const end = src.indexOf('*/', i + 2)
			const stop = end === -1 ? n : end + 2
			for (; i < stop; i++) out += src[i] === '\n' ? '\n' : ' '
		} else if (c === '"' || c === "'" || c === '`') {
			out += c
			i++
			while (i < n && src[i] !== c) {
				if (src[i] === '\\') { out += src[i++] }
				if (i < n) out += src[i++]
			}
			if (i < n) out += src[i++]
		} else {
			out += c
			i++
		}
	}
	return out
}

export function scanCode(src: string): { brand: string; what: string; line: number }[] {
	const hits: { brand: string; what: string; line: number }[] = []
	stripComments(src).split('\n').forEach((raw, idx) => {
		const lower = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
		for (const b of catalog.brands as CatalogBrand[]) {
			const hit = (what: string) => hits.push({ brand: b.brand, what, line: idx + 1 })
			for (const words of b.tokens ?? [])
				if (new RegExp(`(?<![a-z0-9])${words.map(esc).join(SEP)}(?![a-z0-9])`).test(lower)) hit(`token ${words.join(' ')}`)
			for (const w of b.wordTokens ?? []) if (new RegExp(`(?<![a-z0-9])${esc(w)}(?![a-z0-9])`).test(lower)) hit(`word ${w}`)
			for (const t of b.caseSensitiveTokens ?? []) {
				for (let at = raw.indexOf(t); at !== -1; at = raw.indexOf(t, at + t.length)) {
					const after = raw.slice(at + t.length)
					if (/[A-Za-z0-9]/.test(raw[at - 1] ?? '') || /^[A-Za-z0-9]/.test(after)) continue
					if (b.notFollowedBy?.some((nf) => after.startsWith(nf))) continue
					hit(`token ${t}`)
				}
			}
			for (const d of b.domains ?? []) if (raw.toLowerCase().includes(d)) hit(`domain ${d}`)
			for (const id of b.ids ?? []) if (raw.toLowerCase().includes(id)) hit(`id ${id}`)
		}
	})
	return hits
}

/**
 * Reviewed exceptions: `file` + exact `text` the hit line must contain + the reason. Each entry must still match a hit
 * (a stale entry fails), so the list can only shrink.
 */
const ALLOW: { file: string; text: string; reason: string }[] = [
	{
		file: 'packages/cert-block/scripts/card-fixtures.portal.ts',
		text: '-elf-like',
		reason: 'class "history": names of the committed contract-v1 fixture files the tests and the e2e replica read; renaming them is a fixture migration, not a behaviour change',
	},
]

function walk(dir: string, out: string[] = []): string[] {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === 'node_modules' || e.name === 'dist' || e.name === '__tests__' || e.name === '__fixtures__') continue
		const p = join(dir, e.name)
		if (e.isDirectory()) walk(p, out)
		else if (/\.(ts|tsx|mts|mjs|js)$/.test(e.name) && !/\.(test|test-d|e2e\.test)\.(ts|tsx)$/.test(e.name)) out.push(p)
	}
	return out
}

function repoHits() {
	const found: { file: string; text: string; brand: string; what: string }[] = []
	for (const pkg of readdirSync(join(REPO, 'packages'))) {
		for (const sub of ['src', 'scripts']) {
			const root = join(REPO, 'packages', pkg, sub)
			let files: string[] = []
			try { files = walk(root) } catch { continue }
			for (const f of files) {
				const text = readFileSync(f, 'utf8')
				const lines = stripComments(text).split('\n')
				for (const h of scanCode(text)) found.push({ file: relative(REPO, f), text: lines[h.line - 1], brand: h.brand, what: h.what })
			}
		}
	}
	return found
}

describe('brand-code guard', () => {
	it('flags a planted brand literal and passes plain code and comments', () => {
		expect(scanCode("const m = maskedBrand('yise')").map((h) => h.brand)).toContain('yise')
		expect(scanCode("const host = 'www.elfcosmetics.com'").length).toBeGreaterThan(0)
		expect(scanCode('const brandSlug = process.argv[2]\n// first used for a beauty client (BODi-style export)\n')).toEqual([])
		expect(scanCode('const s = "it\'s // not a comment: bodi"').length).toBeGreaterThan(0)
	})

	it('finds no brand literal in non-test source or scripts outside the reviewed allowlist', () => {
		const unallowed = repoHits().filter((h) => !ALLOW.some((a) => a.file === h.file && h.text.includes(a.text)))
		expect(unallowed.map((h) => `${h.file}: ${h.brand} ${h.what} :: ${h.text.trim()}`)).toEqual([])
	})

	it('has no stale allowlist entry', () => {
		const hits = repoHits()
		const stale = ALLOW.filter((a) => !hits.some((h) => h.file === a.file && h.text.includes(a.text)))
		expect(stale).toEqual([])
	})
})
