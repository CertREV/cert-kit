import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Both public packages open a `## Version` section with a bare version stamp, and both ship
 * README.md inside the published tarball (`files`) — so the stamp is what a consumer reads
 * after `npm i`, not just what a browser shows on GitHub.
 *
 * It has now drifted twice, in both packages:
 *   - cert-contract 0.5.1 was a docs-only release whose entire purpose was unsticking this
 *     stamp ("README Version section brought current (0.4.0 / 0.5.0 were missing)").
 *   - cert-block 0.5.4 bumped package.json and touched nothing else, so the published 0.5.4
 *     tarball ships a README claiming to be 0.5.3. That is live on npm right now.
 *
 * Nothing caught either one, because nothing was looking: the stamp is prose, and prose has
 * no compiler. A release step nobody can forget beats a release step written down somewhere.
 * This is that step.
 *
 * The two packages word the line differently ("`x.y.z` — see" vs "Current: `x.y.z` — see"),
 * so the pattern below matches the first backticked token after the heading rather than a
 * fixed sentence. If a README reshapes that section, update the pattern — do not delete the
 * assertion; the drift it catches has shipped to npm twice.
 */
const PACKAGES = ['cert-block', 'cert-contract'] as const

describe.each(PACKAGES)('%s README version stamp', (pkgName) => {
	const pkgUrl = new URL(`../../../${pkgName}/package.json`, import.meta.url)
	const readmeUrl = new URL(`../../../${pkgName}/README.md`, import.meta.url)

	const { version } = JSON.parse(readFileSync(pkgUrl, 'utf8')) as { version: string }
	const readme = readFileSync(readmeUrl, 'utf8')

	it('matches package.json — bump both, or neither', () => {
		// First backticked token after the `## Version` heading.
		const stamp = readme.match(/^## Version\s*\n+[^`\n]*`([^`]+)`/m)

		expect(
			stamp,
			`${pkgName}: README has no \`## Version\` section opening with a backticked stamp. If the ` +
				'section was renamed or reshaped, update this pattern to match the new shape rather ' +
				'than deleting the assertion.',
		).not.toBeNull()

		expect(
			stamp?.[1],
			`${pkgName}: README's \`## Version\` stamp is ${stamp?.[1]} but package.json is ${version}. ` +
				'README.md ships inside the npm tarball, so this mismatch gets published to consumers. ' +
				`Bump the stamp in packages/${pkgName}/README.md.`,
		).toBe(version)
	})
})
