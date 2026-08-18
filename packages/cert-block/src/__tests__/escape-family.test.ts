/**
 * The escape/format FAMILY under hostile input.
 *
 * Every helper here sits downstream of a `JSON.parse(...) as CertDeliveryEnvelope` cast
 * (`get-verified-envelope.ts`) or of untyped CMS/Builder props. `verifyEnvelope` checks the
 * SIGNATURE, never the SHAPE — so a signed-but-malformed payload reaches these helpers with
 * a number, an object, or an array where the contract promised a string. In a React Server
 * Component that throw is not a missing badge: `renderToReadableStream` aborts the whole
 * article route with zero HTML, and the Builder SDK ships no error boundary on its node/edge
 * builds. So the family's contract is: NEVER THROW, never emit an unescaped byte.
 *
 * The other half of this file is the security invariant that makes the first half safe to
 * change: for a NORMAL STRING every helper's output must stay byte-identical, because four
 * hand-built-HTML renderers use `escapeHtml`/`escapeAttribute` as their only XSS boundary.
 */

import { describe, expect, it } from 'vitest'
import { escapeAttribute, escapeHtml, safeCssColor, safeHttpUrl, tidyText } from '../components/escape.js'
import { credentialSuffix, dedupeCredential, expertNameWithCredentials, formatDate } from '../components/format.js'
import type { CertContent } from '../contract/kernel.js'

/** The shapes an untyped `JSON.parse` actually hands us where a string was promised. */
const HOSTILE: ReadonlyArray<readonly [string, unknown]> = [
	['undefined', undefined],
	['null', null],
	['a number', 42],
	['an object', { toString: () => '<script>' }],
	['an array', ['<script>', 'x']],
	['a boolean', true],
]

/** Cast helper — these calls are deliberately off-contract, which is the whole point. */
const asString = (v: unknown): string => v as string

describe('escapeHtml / escapeAttribute — the XSS boundary', () => {
	it('escapes & < > " \' byte-identically (the invariant every other test here must not break)', () => {
		expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;')
		expect(escapeHtml('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
		expect(escapeHtml("Tom O'Brien & Sons")).toBe('Tom O&#39;Brien &amp; Sons')
		// Already-escaped text double-escapes — that is correct, and consumers rely on it.
		expect(escapeHtml('&amp;')).toBe('&amp;amp;')
		// Non-ASCII passes through untouched: CERT_SCOPE_LINE's curly apostrophe (U+2019) is
		// pinned to MSA §3 and must survive the escape byte-for-byte.
		expect(escapeHtml('CertREV’s scope')).toBe('CertREV’s scope')
		expect(escapeHtml('')).toBe('')
		expect(escapeAttribute('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;')
	})

	for (const [label, value] of HOSTILE) {
		it(`does not throw on ${label}`, () => {
			expect(() => escapeHtml(asString(value))).not.toThrow()
			expect(() => escapeAttribute(asString(value))).not.toThrow()
			expect(typeof escapeHtml(asString(value))).toBe('string')
		})
	}

	it('drops a non-text value rather than rendering "[object Object]" into the article', () => {
		expect(escapeHtml(asString(undefined))).toBe('')
		expect(escapeHtml(asString(null))).toBe('')
		expect(escapeHtml(asString({ a: 1 }))).toBe('')
		expect(escapeHtml(asString(['<b>', 'x']))).toBe('')
		expect(escapeHtml(asString(true))).toBe('')
	})

	it('renders a stray number as its digits — still escaped, never raw', () => {
		expect(escapeHtml(asString(42))).toBe('42')
		expect(escapeHtml(asString(Number.NaN))).toBe('')
		expect(escapeHtml(asString(Number.POSITIVE_INFINITY))).toBe('')
	})

	it('cannot be talked into unescaped output by a hostile toString/valueOf', () => {
		const evil = { toString: () => '<img src=x onerror=alert(1)>' }
		expect(escapeHtml(asString(evil))).not.toContain('<')
		const evilValueOf = { valueOf: () => '<script>' }
		expect(escapeHtml(asString(evilValueOf))).not.toContain('<')
		// A null-prototype object throws on coercion in JS — proof we never coerce blindly.
		const bare = Object.create(null)
		expect(() => escapeHtml(asString(bare))).not.toThrow()
	})
})

describe('formatDate', () => {
	it('formats an ISO-8601 instant to the stable, locale-independent label', () => {
		expect(formatDate('2026-06-21T12:00:00.000Z')).toBe('Jun 21, 2026')
		expect(formatDate('2026-01-01T00:00:00.000Z')).toBe('Jan 1, 2026')
		expect(formatDate(null)).toBeNull()
		expect(formatDate(undefined)).toBeNull()
		expect(formatDate('')).toBeNull()
		expect(formatDate('banana')).toBeNull()
	})

	it('REJECTS a number — the wire contract is ISO-8601 strings, not an epoch shorthand', () => {
		// `Date.parse(42)` coerces to "42" and yields the YEAR 2042 — a stray count from a
		// malformed payload would render as a confident, wrong certification date.
		expect(formatDate(asString(42))).toBeNull()
		// And the reading a caller would EXPECT of a number (epoch ms) is not supported
		// either, so there is no half-right behaviour to trip over.
		expect(formatDate(asString(1750000000000))).toBeNull()
	})

	for (const [label, value] of HOSTILE) {
		it(`does not throw on ${label}`, () => {
			expect(() => formatDate(asString(value))).not.toThrow()
			expect(formatDate(asString(value))).toBeNull()
		})
	}
})

const content = (expert: unknown): CertContent => ({ expert }) as CertContent

const WELL_FORMED = content({
	displayName: 'Dr. Jane Doe',
	credentials: [
		{ abbreviation: 'PhD', fullName: 'Doctor of Philosophy' },
		{ abbreviation: 'RD', fullName: 'Registered Dietitian' },
	],
})

describe('credentialSuffix / expertNameWithCredentials', () => {
	it('is byte-identical for a well-formed envelope', () => {
		expect(credentialSuffix(WELL_FORMED)).toBe('PhD, RD')
		expect(expertNameWithCredentials(WELL_FORMED)).toBe('Dr. Jane Doe, PhD, RD')
		const noCreds = content({ displayName: 'Dr. Jane Doe', credentials: [] })
		expect(credentialSuffix(noCreds)).toBe('')
		expect(expertNameWithCredentials(noCreds)).toBe('Dr. Jane Doe')
	})

	it('survives a signed-but-malformed expert block', () => {
		for (const [label, value] of HOSTILE) {
			expect(() => credentialSuffix(content({ displayName: value, credentials: value })), label).not.toThrow()
			expect(() => expertNameWithCredentials(content({ displayName: value, credentials: value })), label).not.toThrow()
		}
		expect(() => credentialSuffix(content(undefined))).not.toThrow()
		expect(() => credentialSuffix({} as CertContent)).not.toThrow()
		expect(() => expertNameWithCredentials({} as CertContent)).not.toThrow()
		expect(() => expertNameWithCredentials(undefined as unknown as CertContent)).not.toThrow()
	})

	it('drops junk credential entries instead of emitting a leading comma', () => {
		const ragged = content({
			displayName: 'Dr. Jane Doe',
			credentials: [{ abbreviation: undefined }, { abbreviation: 'RD' }, null, { abbreviation: { x: 1 } }],
		})
		expect(credentialSuffix(ragged)).toBe('RD')
		expect(expertNameWithCredentials(ragged)).toBe('Dr. Jane Doe, RD')
	})

	it('attributes nothing when there is no name to attribute', () => {
		expect(expertNameWithCredentials(content({ displayName: null, credentials: [{ abbreviation: 'PhD' }] }))).toBe('')
		expect(expertNameWithCredentials(content({ credentials: [] }))).toBe('')
	})

	it('does not print a credential the display name already carries (P2-6)', () => {
		const carried = content({
			displayName: 'Dr. Erik Schraga, MD',
			credentials: [{ abbreviation: 'MD' }, { abbreviation: 'EM' }],
		})
		expect(expertNameWithCredentials(carried)).toBe('Dr. Erik Schraga, MD, EM')
		// `credentialSuffix` itself is UNCHANGED — it is the verified credential list, and a
		// consumer rendering it away from the name must still get all of it.
		expect(credentialSuffix(carried)).toBe('MD, EM')
	})

	it('leaves a name that merely CONTAINS the letters alone (the false-positive guard)', () => {
		expect(
			expertNameWithCredentials(content({ displayName: 'Dr. MDonald', credentials: [{ abbreviation: 'MD' }] })),
		).toBe('Dr. MDonald, MD')
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// P2-6 — the render-boundary duplicate guard
//
// The defect it answers is DATA, not render: portal's `resolveStampReviewerName`
// skips `cleanExpertDisplayName`, and `package_drafts.expert_display_name` carries no
// CHECK constraint, so a stored display name arrives with its own post-nominal already
// attached — and every composition site then appended the credential again
// ("Dr. Erik Schraga, MD, MD, EM" on a live customer page). These tests pin the rule's
// two halves: it removes what is provably already printed, and it removes NOTHING else,
// because dropping a real credential off a compliance-facing card is the worse failure.
// ─────────────────────────────────────────────────────────────────────────────

describe('dedupeCredential', () => {
	it('drops the token the name already carries and keeps the rest (the reported case)', () => {
		expect(dedupeCredential('Dr. Erik Schraga, MD', 'MD, EM')).toBe('EM')
		expect(dedupeCredential('Jane Doe, MD', 'MD, FAAD')).toBe('FAAD')
	})

	it('returns the credential UNTOUCHED when nothing duplicates — byte-identical, spacing and all', () => {
		expect(dedupeCredential('Dr. Jane Doe', 'PhD, RD')).toBe('PhD, RD')
		expect(dedupeCredential('Jane Doe, PhD', 'MD')).toBe('MD')
		// Not re-joined: an unchanged suffix is passed through verbatim, so no render moves.
		expect(dedupeCredential('Dr. Jane Doe', 'MD,FAAD')).toBe('MD,FAAD')
		expect(dedupeCredential('Doe, Jane', 'MD')).toBe('MD')
	})

	it('matches whole comma-separated TOKENS, never substrings of a name word', () => {
		// The whole reason this is not a regex over the name: every one of these is a real name.
		expect(dedupeCredential('Dr. MDonald', 'MD')).toBe('MD')
		expect(dedupeCredential('Jane Amdahl', 'MD')).toBe('MD')
		expect(dedupeCredential('Md. Rahman', 'MD')).toBe('MD')
		expect(dedupeCredential('Emma Doe', 'EM')).toBe('EM')
		// A trailing segment that merely CONTAINS the token is not the token.
		expect(dedupeCredential('Jane Doe, PhD candidate', 'PhD')).toBe('PhD')
	})

	it('reads "M.D." and "md" as the same token as "MD"', () => {
		expect(dedupeCredential('Erik Schraga, M.D.', 'MD')).toBe('')
		expect(dedupeCredential('Erik Schraga, MD', 'M.D.')).toBe('')
		expect(dedupeCredential('Erik Schraga, md', 'MD')).toBe('')
		expect(dedupeCredential('Erik Schraga, MD.', 'MD')).toBe('')
	})

	it('drops the suffix entirely rather than leaving a dangling comma for the caller', () => {
		expect(dedupeCredential('Jane Doe, MD', 'MD')).toBe('')
		expect(dedupeCredential('Jane Doe, MD, FAAD', 'MD, FAAD')).toBe('')
		expect(dedupeCredential('Jane Doe', '')).toBe('')
		expect(dedupeCredential('', 'MD')).toBe('MD')
	})

	it('handles a name that is nothing BUT a credential — the token still shows exactly once', () => {
		expect(dedupeCredential('MD', 'MD')).toBe('')
		expect(dedupeCredential('MD', 'MD, FAAD')).toBe('FAAD')
	})

	for (const [label, value] of HOSTILE) {
		it(`does not throw on ${label}`, () => {
			expect(() => dedupeCredential(asString(value), asString(value))).not.toThrow()
			expect(typeof dedupeCredential(asString(value), 'MD')).toBe('string')
			expect(dedupeCredential('Jane Doe', asString(value))).toBe(typeof value === 'number' ? String(value) : '')
		})
	}
})

describe('safeHttpUrl', () => {
	it('keeps its allow-list semantics for strings', () => {
		expect(safeHttpUrl('https://certrev.com/verify/x')).toBe('https://certrev.com/verify/x')
		expect(safeHttpUrl('/experts/jane')).toBe('/experts/jane')
		expect(safeHttpUrl('  https://certrev.com/x  ')).toBe('https://certrev.com/x')
		expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
		expect(safeHttpUrl('data:text/html,<script>')).toBeNull()
		expect(safeHttpUrl(null)).toBeNull()
		expect(safeHttpUrl('')).toBeNull()
	})

	for (const [label, value] of HOSTILE) {
		it(`does not throw on ${label}`, () => {
			expect(() => safeHttpUrl(asString(value))).not.toThrow()
			expect(safeHttpUrl(asString(value))).toBeNull()
		})
	}
})

describe('safeCssColor', () => {
	it('keeps its allow-list semantics for strings', () => {
		expect(safeCssColor('#0f766e')).toBe('#0f766e')
		expect(safeCssColor('rgb(15, 118, 110)')).toBe('rgb(15, 118, 110)')
		expect(safeCssColor('teal')).toBe('teal')
		expect(safeCssColor('expression(alert(1))')).toBeNull()
		expect(safeCssColor('url(x)')).toBeNull()
		expect(safeCssColor(null)).toBeNull()
	})

	for (const [label, value] of HOSTILE) {
		it(`does not throw on ${label}`, () => {
			expect(() => safeCssColor(asString(value))).not.toThrow()
			expect(safeCssColor(asString(value))).toBeNull()
		})
	}
})

describe('tidyText', () => {
	it('collapses interior whitespace + trims, byte-identically', () => {
		expect(tidyText('  Dr.   Jane\n\tDoe ')).toBe('Dr. Jane Doe')
		expect(tidyText(null)).toBe('')
		expect(tidyText(undefined)).toBe('')
	})

	for (const [label, value] of HOSTILE) {
		it(`does not throw on ${label}`, () => {
			expect(() => tidyText(asString(value))).not.toThrow()
			expect(typeof tidyText(asString(value))).toBe('string')
		})
	}
})
