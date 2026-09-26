import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CERTREV_LINK_REL } from '../components/rel.js'
import { CERTREV_MODAL_LINK_REL } from '../modal/cert-modal-view.js'

/**
 * One link-qualification policy, three hand-maintained copies of it, and nothing but this file
 * connecting two of them.
 *
 * `CERTREV_LINK_REL` (`src/components/rel.ts`) is the source of truth and carries the policy
 * reasoning. `src/modal/` keeps its own copy on purpose: it is bundled standalone into the
 * dependency-free `certrev-cert.js` IIFE and imports NOTHING from `src/components/`, so an import
 * across that boundary would drag the SSR module graph into a storefront asset. A test directory
 * is in NEITHER bundle graph, which is why the check can live here and only here.
 *
 * SUPERSET, not equality: the modal copy legitimately adds `noreferrer`, because its anchors are
 * the only `target="_blank"` ones the package emits. The invariant is that every token of the
 * shared constant survives in the modal copy, and that `nofollow` + `sponsored` — the two tokens
 * Google's link-spam policy names as the remedy — are in both, so deleting one from EITHER side
 * fails here.
 *
 * A third copy, `NOTICE_LINK_REL`, lived in `src/modal/ftc-guard.ts` until 1.1.1 removed the runtime
 * FTC guard; the guard module and its test were deleted with it, leaving the two copies above.
 */

const tokensOf = (rel: string): readonly string[] => rel.split(/\s+/).filter(Boolean)

/** The tokens the link-spam policy names. Neither copy may lose one. */
const QUALIFICATION_TOKENS = ['nofollow', 'sponsored'] as const

describe('the two rel constants stay in lockstep across the bundle boundary', () => {
	const shared = tokensOf(CERTREV_LINK_REL)
	const modal = tokensOf(CERTREV_MODAL_LINK_REL)

	it('neither constant is empty', () => {
		// Guards the assertions below: a superset check against nothing passes vacuously.
		expect(shared.length).toBeGreaterThan(0)
		expect(modal.length).toBeGreaterThan(0)
	})

	it('the modal copy carries every token of CERTREV_LINK_REL', () => {
		for (const token of shared) {
			expect(
				modal,
				`CERTREV_MODAL_LINK_REL ("${CERTREV_MODAL_LINK_REL}") is missing "${token}", which ` +
					`CERTREV_LINK_REL ("${CERTREV_LINK_REL}") carries. src/modal/ cannot import ` +
					'src/components/ — the copy is deliberate — so update src/modal/cert-modal-view.ts by ' +
					'hand rather than deleting this assertion.',
			).toContain(token)
		}
	})

	it.each(QUALIFICATION_TOKENS)('both copies carry %s', (token) => {
		expect(shared, `src/components/rel.ts dropped "${token}"`).toContain(token)
		expect(modal, `src/modal/cert-modal-view.ts dropped "${token}"`).toContain(token)
	})

	it('the modal copy adds `noreferrer` and nothing else', () => {
		const extra = modal.filter((token) => !shared.includes(token))
		expect(
			extra,
			'the modal copy has diverged beyond its one documented addition. A token that belongs on ' +
				'every anchor belongs in CERTREV_LINK_REL; a token that is genuinely modal-only (the ' +
				'target="_blank" case) belongs here AND in the comment above it.',
		).toEqual(['noreferrer'])
	})
})

/**
 * The constant-level checks above cover the anchors we know about. This one covers the anchor
 * nobody has written yet: it reads the package's own source and asserts that EVERY `<a` it emits
 * — in any renderer, existing or new — sets `rel` from one of the named `*LINK_REL` constants
 * rather than a hand-written string. A new renderer added with an unqualified or bespoke anchor
 * fails here on the day it lands, with no per-renderer test to remember to write.
 *
 * It is a floor, not a proof: the regex is crude (it takes an open tag as everything up to the
 * first `>`), so an anchor whose attributes contain a literal `>` could be read wrongly. Comments
 * are stripped first, because several of them mention `<a>` in prose.
 */
const SRC_DIR = fileURLToPath(new URL('../', import.meta.url))

function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir).sort()) {
		const path = join(dir, entry)
		if (statSync(path).isDirectory()) {
			if (entry !== '__tests__') sourceFiles(path, out)
		} else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
			out.push(path)
		}
	}
	return out
}

/** Source with block comments and whole-line `//` comments removed (a URL's `//` is left alone). */
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

interface Anchor {
	readonly where: string
	readonly tag: string
}

function anchorsInSource(): readonly Anchor[] {
	const found: Anchor[] = []
	for (const path of sourceFiles(SRC_DIR)) {
		const src = stripComments(readFileSync(path, 'utf8'))
		for (const match of src.matchAll(/<a[\s>][\s\S]*?>/g)) {
			const line = src.slice(0, match.index).split('\n').length
			found.push({ where: `${path.slice(SRC_DIR.length)}:${line}`, tag: match[0] })
		}
	}
	return found
}

describe('every anchor in the package source is qualified by a named constant', () => {
	const anchors = anchorsInSource()

	it('finds every anchor the package emitted when this was written', () => {
		// Without a floor, a refactor that builds anchors somewhere this regex cannot see would make
		// the sweep pass on nothing at all.
		expect(
			anchors.length,
			`the sweep found ${anchors.length} anchors; the package emitted 13 across 6 files when this ` +
				'was written. Fewer means either anchors were genuinely removed — lower this number in ' +
				'the same commit — or the regex no longer recognizes how they are built, which is the ' +
				'case this assertion exists for.',
		).toBeGreaterThanOrEqual(13)
	})

	it('sets rel from a *LINK_REL constant, never a literal', () => {
		for (const { where, tag } of anchors) {
			expect(
				/\brel=/.test(tag),
				`${where}: this anchor sets no rel. Every link this package emits points at a ` +
					'CertREV-owned host on a page the brand did not author, so it must carry the ' +
					'qualification — see src/components/rel.ts.\n' +
					tag,
			).toBe(true)
			expect(
				/\brel=[^>]*LINK_REL/.test(tag),
				`${where}: this anchor's rel is a hand-written value. Use CERTREV_LINK_REL ` +
					'(src/components/) or CERTREV_MODAL_LINK_REL (src/modal/) so the policy stays in one ' +
					'place — a fourth copy is a fourth thing to forget.\n' +
					tag,
			).toBe(true)
		}
	})
})
