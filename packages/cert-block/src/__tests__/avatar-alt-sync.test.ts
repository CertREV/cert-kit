import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every image this package emits is an expert avatar, and every one of them sits beside the same
 * person's name rendered as text. So all four faces must mark the image DECORATIVE (`alt=""`) and
 * let the adjacent text carry the name.
 *
 * Three of the four did the opposite until 1.0.0: `alt="Photo of {name}"`. In `<ExpertBio>` that
 * made a screen reader announce the name three times in a row — the aside's `aria-label`, then
 * "Photo of Jane Doe, image", then the heading. The modal avatar had `alt=""` correct from the
 * start, which is the tell: the same decision was made four times by hand and landed differently.
 *
 * This is a vendor string renderer on a page the brand did not author, so a consumer cannot patch
 * the markup. That is the same reason `link-rel-sync.test.ts` exists, and this file is modelled on
 * its source sweep: it reads the package's own source rather than any one rendered output, so an
 * avatar added to a NEW face is covered on the day it lands.
 *
 * If a genuinely informative image is ever added, this test should fail and be widened
 * deliberately — an image whose content is not already in adjacent text needs real alt text, and
 * that is a decision worth making at a red test rather than by default.
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

interface Img {
	readonly where: string
	readonly tag: string
}

function imagesInSource(): readonly Img[] {
	const found: Img[] = []
	for (const path of sourceFiles(SRC_DIR)) {
		const src = stripComments(readFileSync(path, 'utf8'))
		for (const match of src.matchAll(/<img[\s>][\s\S]*?>/g)) {
			const line = src.slice(0, match.index).split('\n').length
			found.push({ where: `${path.slice(SRC_DIR.length)}:${line}`, tag: match[0] })
		}
	}
	return found
}

describe('every avatar the package emits is marked decorative', () => {
	const images = imagesInSource()

	it('finds every image the package emitted when this was written', () => {
		// Without a floor, a refactor that builds images somewhere this regex cannot see would make
		// the sweep pass on nothing at all.
		expect(
			images.length,
			`the sweep found ${images.length} images; the package emitted 4 across 4 files when this was ` +
				'written (the React badge, the expert bio, the string renderer, the modal). Fewer means ' +
				'either images were genuinely removed, or the regex no longer recognizes how they are ' +
				'built, which is the case this assertion exists for.',
		).toBeGreaterThanOrEqual(4)
	})

	it('sets an empty alt, so the adjacent name is announced once', () => {
		for (const { where, tag } of images) {
			expect(
				/\balt=/.test(tag),
				`${where}: this image sets no alt at all, so a screen reader falls back to announcing the ` +
					'src URL.\n' +
					tag,
			).toBe(true)
			expect(
				/\balt=(""|''|\{''\}|\{""\})/.test(tag),
				`${where}: this image's alt is not empty. Every image here is an avatar sitting beside the ` +
					'same name in text, so alt text repeats it. If this one is genuinely informative, widen ' +
					'this assertion in the same commit and say why.\n' +
					tag,
			).toBe(true)
		}
	})
})
