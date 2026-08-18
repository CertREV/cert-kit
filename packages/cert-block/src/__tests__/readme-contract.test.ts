import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The README ships INSIDE the npm tarball (`files`), so it is documentation a consumer reads
 * after `npm i`, not just a GitHub page — and it is the only documentation this package has.
 * `readme-version.test.ts` already pins the version stamp. This file pins the three claims
 * that went wrong WITHOUT anyone noticing, each of which cost a reader real time:
 *
 *   1. The KEY ID in the copy-pasteable resolver example. It read `certrev-2026-1`, a kid that
 *      existed in exactly one place on earth — that line. Copying it made the resolver return
 *      null → the kernel suppressed `unknown_key` → blank space. This package writes NOTHING to
 *      the console on any path, so there was no signal at all; the reader's only lead was a
 *      `verdict.reason` they had to think to log.
 *   2. The ROUTE EXAMPLE. `src/builder/index.tsx` has told readers to "see the route example"
 *      since the anchor model was designed, and no such example existed in any form — not in
 *      the repo, not in the tarball, not in the public mirror. That sentence ships in
 *      `dist/builder/index.d.ts`, so it surfaced on IDE hover for the exact import a Builder
 *      integration adds. The example now lives in the README under a fixed heading that
 *      `src/builder/index.tsx` links to; renaming the heading silently re-breaks that pointer.
 *   3. The PUBLIC API subpath list. It documented three of the seven `exports` entries. The
 *      most costly omission was `./modal`, which is SIDE-EFFECTING (importing it registers
 *      custom elements and starts DOM passes) — the one subpath whose behaviour a consumer
 *      MUST know before importing. The assertion below is derived from `package.json`, so a
 *      new subpath fails this test until it is documented rather than shipping unmentioned.
 *
 * None of these has a compiler. This is the compiler.
 */

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
	name: string
	exports: Record<string, unknown>
}

/**
 * The section heading `src/builder/index.tsx` links to. Changing this string means changing it
 * in BOTH places — which is the entire point of asserting it here.
 */
const ROUTE_SECTION_HEADING = '## The article route example'
const ROUTE_SECTION_ANCHOR = '#the-article-route-example'

/** The body of one `##` section, heading excluded, up to the next `##` heading or EOF. */
function section(heading: string): string {
	const start = readme.indexOf(`\n${heading}\n`)
	if (start === -1) return ''
	const from = start + heading.length + 2
	const next = readme.indexOf('\n## ', from)
	return readme.slice(from, next === -1 ? undefined : next)
}

describe('README — the published key id', () => {
	/**
	 * Read straight out of the browser bundle's entry rather than hardcoded here, so a key
	 * ROTATION also fails this test: the day `CERT_ISSUER_KID` changes, the README's example is
	 * stale and a reader who copies it gets the same silent blank. Parsed with a regex instead
	 * of imported because that module registers custom elements on import.
	 */
	const entry = readFileSync(new URL('../modal/certrev-cert.entry.ts', import.meta.url), 'utf8')
	const issuerKid = entry.match(/export const CERT_ISSUER_KID = '([^']+)'/)?.[1]

	it('the entry still declares a kid to check against', () => {
		expect(issuerKid, 'CERT_ISSUER_KID is no longer a single-quoted literal in certrev-cert.entry.ts').toBeTruthy()
	})

	it('every kid in a staticKidResolver example is the real one', () => {
		// Each `staticKidResolver({ 'kid': ... })` in the docs, whatever quoting the example uses.
		const kids = [...readme.matchAll(/staticKidResolver\(\{\s*['"]([^'"]+)['"]\s*:/g)].map((m) => m[1])

		expect(
			kids.length,
			'the README no longer shows a staticKidResolver example — restore one or drop this test',
		).toBeGreaterThan(0)
		for (const kid of kids) {
			expect(
				kid,
				`README documents kid '${kid}', but the package's published issuer kid is '${issuerKid}'. A ` +
					'consumer who copies the wrong kid gets a resolver that returns null → the kernel ' +
					"suppresses 'unknown_key' → blank space, with nothing logged anywhere.",
			).toBe(issuerKid)
		}
	})

	it('leads with the fetching resolver and names the real key-set URL', () => {
		// `fetchingKidResolver` survives a rotation; the static one needs a redeploy. The README
		// imported it for a year without documenting it once.
		expect(readme).toContain('fetchingKidResolver')
		expect(
			readme,
			"the README must name CertREV's published key set so a consumer can find the key without asking",
		).toContain('https://certrev.com/.well-known/jwks.json')
	})

	it('names the verdict a wrong kid produces, so a search for the symptom lands here', () => {
		expect(readme).toContain('unknown_key')
	})
})

describe('README — the route example src/builder/index.tsx points at', () => {
	it('exists under the exact heading that is linked from code', () => {
		expect(
			readme.includes(`\n${ROUTE_SECTION_HEADING}\n`),
			`README is missing the section "${ROUTE_SECTION_HEADING}". src/builder/index.tsx links to ` +
				`"${ROUTE_SECTION_ANCHOR}"; renaming the heading breaks that link AND the same pointer ` +
				'shipped in dist/builder/index.d.ts, where it shows on IDE hover.',
		).toBe(true)
	})

	it('actually shows both halves — the CMS card and the route-emitted JSON-LD', () => {
		const body = section(ROUTE_SECTION_HEADING)
		// The whole reason the section exists: the card renders no structured data by design, so
		// an example that shows only <Content> documents half a working route.
		expect(body, 'route example must register the PUSH card').toContain('certRevCertComponent')
		expect(body, 'route example must render Builder content').toContain('<Content')
		expect(body, 'route example must verify server-side').toContain('getVerifiedEnvelope')
		expect(body, 'route example must emit the JSON-LD the card does not').toMatch(/CertJsonLd|projectCertJsonLd/)
	})
})

describe('README — Public API covers every published subpath', () => {
	const publicApi = section('## Public API')

	it('the Public API section is still there to check', () => {
		expect(publicApi.length, 'README has no `## Public API` section').toBeGreaterThan(0)
	})

	it.each(Object.keys(pkg.exports))('documents the `%s` export', (key) => {
		const specifier = key === '.' ? pkg.name : `${pkg.name}/${key.replace(/^\.\//, '')}`
		// Bounded so `@certrev/cert-block/modal` is not satisfied by `.../modal/placement` alone.
		const pattern = new RegExp(`${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w./-])`)

		expect(
			pattern.test(publicApi),
			`package.json exports "${key}" but the README's Public API section never mentions ` +
				`\`${specifier}\`. Every subpath a consumer can import must be listed there — an ` +
				'undocumented subpath is one nobody can use safely, and `./modal` in particular is ' +
				'side-effecting (it registers custom elements and starts DOM passes on import).',
		).toBe(true)
	})

	it('warns that ./modal is side-effecting', () => {
		expect(
			/side-effect/i.test(publicApi),
			'the `./modal` subpath registers custom elements and starts DOM passes merely by being ' +
				'imported. That is the fact a consumer must read BEFORE importing it, so it belongs in ' +
				'the Public API section, not only in the modal usage section.',
		).toBe(true)
	})
})
