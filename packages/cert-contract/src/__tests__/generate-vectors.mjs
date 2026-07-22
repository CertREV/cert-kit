/**
 * Golden-vector generator. Run with:
 *   node src/__tests__/generate-vectors.mjs > schema/../src/__tests__/vectors.json
 * (we write it explicitly below). These vectors are THE cross-language contract:
 * input JSON value → RFC-8785 canonical UTF-8 bytes (hex) → SHA-256 (hex). Any other
 * language reproducing this package MUST match the canonicalHex + sha256 columns.
 *
 * We do NOT hand-author the hex; we derive it from the SAME canonicalize() the runtime
 * uses, then the test suite re-derives and asserts equality — so a vector can never
 * silently drift from the implementation, and a foreign implementation has an exact
 * byte target to hit.
 */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import canonicalize from 'canonicalize'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Representative + adversarial inputs exercising every JCS edge: unicode, key order,
 *  nesting, arrays, integers/floats, empty/null, escapes, exponent forms. */
const cases = [
	{ name: 'empty_object', value: {} },
	{ name: 'null_value', value: { a: null } },
	{ name: 'key_order_simple', value: { b: 1, a: 2 } },
	{
		name: 'key_order_unicode_codepoint',
		// JCS sorts by UTF-16 code unit; mix ASCII + non-ASCII keys to pin the order.
		value: { z: 1, a: 1, ä: 1, 1: 1, A: 1, '🎯': 1 },
	},
	{ name: 'unicode_string_values', value: { s: 'héllo→世界', emoji: '🎯✅', mixed: 'caféé' } },
	{
		name: 'string_escapes',
		// Control chars + the two mandatory JSON escapes (" and \).
		value: { quote: 'a"b', backslash: 'a\\b', tab: 'a\tb', newline: 'a\nb', cr: 'a\rb', ctrl: 'ab' },
	},
	{
		name: 'nested_objects_and_arrays',
		value: { z: { y: [3, 1, 2], x: { w: true } }, a: null, m: [{ k: 1 }, { k: 2 }] },
	},
	{ name: 'integers', value: { zero: 0, neg_zero: -0, big: 100000, negative: -42 } },
	{ name: 'floats', value: { half: 1.5, third_ish: 0.333, neg: -2.25, point_one: 0.1 } },
	{ name: 'exponent_numbers', value: { big: 1e21, small: 1e-7, tiny: 5e-324 } },
	{ name: 'booleans_and_empty', value: { t: true, f: false, emptyArr: [], emptyObj: {}, emptyStr: '' } },
	{ name: 'array_of_mixed', value: { arr: [1, 'two', true, null, { nested: 'x' }, [9, 8]] } },
	{
		// A representative-ish CertPayload-shaped value — proves the real envelope payload
		// canonicalizes deterministically (this is the actual signing input shape).
		name: 'cert_payload_shape',
		value: {
			contractVersion: 1,
			certId: 'cert_01HXYZ',
			subject: {
				platform: 'shopify',
				externalId: 'gid://shopify/Article/123',
				logicalArticleId: 'art_abc',
				canonicalUrls: ['https://brand.com/blogs/news/shea-butter', 'https://brand.com/fr/blogs/news/beurre'],
				installationId: 'inst_42',
				contentDigest: 'a'.repeat(64),
			},
			content: {
				expert: {
					displayName: 'Dr. Jane Doe',
					credentials: [{ abbreviation: 'MD', fullName: 'Doctor of Medicine' }],
					profileUrl: 'https://certrev.com/experts/jane',
					photoUrl: null,
				},
				author: { name: 'Brand Team', title: null },
				memo: 'Reviewed for accuracy — claims are well supported. 世界',
				certifiedAt: '2026-06-21T12:00:00.000Z',
				contentModifiedAt: null,
				verifyUrl: 'https://certrev.com/verify/cert_01HXYZ',
				display: { accentColor: '#0a0', showExpertPhoto: true, badgeStyle: 'full' },
			},
			lifecycle: {
				issuedAt: '2026-06-21T12:00:00.000Z',
				expiresAt: '2026-07-21T12:00:00.000Z',
				revokedAt: null,
				revision: 1,
			},
		},
	},
	{
		// RFC 8785 §3.2.3: object keys sort by UTF-16 CODE UNIT, not by code point. An astral
		// (surrogate-pair) key sorts by its HIGH surrogate (0xD800-0xDBFF): BELOW U+E000+ and
		// ABOVE U+D7FF, NOT after them by code point. A codepoint-sorting implementation orders
		// the astral keys after U+FFFF and yields DIFFERENT bytes. This is the exact §3.2.3 case
		// the hand-rolled PHP JCS twin (class-certrev-jcs.php) must reproduce. Keys via \u escapes
		// (pure-ASCII source; identical runtime strings) for unambiguous surrogate boundaries.
		name: 'key_order_surrogate_pairs',
		value: {
			A: 1, // U+0041
			ä: 2, // ä U+00E4
			'퟿': 3, // U+D7FF — last scalar before the surrogate block
			'𝄞': 4, // 𝄞 U+1D11E (high surrogate 0xD834) — sorts INSIDE the surrogate range
			'😀': 5, // 😀 U+1F600 (high surrogate 0xD83D)
			'': 6, // U+E000 — first scalar after the surrogate block
			'￿': 7, // U+FFFF — max BMP code unit
		},
	},
	{
		// The BYTE-EXACT legally load-bearing strings production ships (display-strings.ts /
		// ftc-disclosure.ts). The U+2019 curly apostrophe in "article's" is byte-load-bearing
		// (CERT_SCOPE_LINE). Per RFC 8785, JCS emits non-ASCII as RAW UTF-8 (minimal escaping), so the
		// canonical bytes carry U+2019 verbatim — this pins that a PHP/Go twin emits U+2019 identically
		// as raw UTF-8 (NOT \uXXXX). The JCS twins were only ASCII-tested before v0.2; this case + the
		// surrogate case close that gap.
		name: 'curly_apostrophe_production_strings',
		value: {
			compensationCue: 'Compensated expert',
			scopeLine:
				'Independent editorial review of this article’s text and sources. Not a product endorsement, nor medical advice.',
		},
	},
	{
		// The v0.2 FACTS-ONLY wire shape: the compensation FACT (`expert.compensationCue`),
		// per-credential `complianceClass`/`claimBearing`/`cardLabel`, author photo/bio — and NO
		// `display` block (evicted to brand_render_defs). Proves the new payload canonicalizes
		// deterministically and gives the render twins an exact byte target for a v0.2-era envelope.
		name: 'cert_payload_shape_v0_2',
		value: {
			contractVersion: 1,
			certId: 'cert_v0_2_shape',
			subject: {
				platform: 'shopify',
				externalId: 'gid://shopify/Article/456',
				logicalArticleId: 'art_v0_2',
				canonicalUrls: ['https://brand.com/blogs/news/retinol'],
				installationId: 'inst_99',
				contentDigest: 'b'.repeat(64),
			},
			content: {
				expert: {
					displayName: 'Dr. Jane Doe',
					credentials: [
						{
							abbreviation: 'RDN',
							fullName: 'Registered Dietitian Nutritionist',
							cardLabel: null,
							complianceClass: 'gated',
							claimBearing: true,
						},
					],
					profileUrl: 'https://certrev.com/experts/jane',
					photoUrl: null,
					bio: 'Board-certified reviewer. 世界',
					background: null,
					compensationCue: 'Compensated expert',
				},
				author: { name: 'Brand Team', title: null, photoUrl: null, bio: null },
				memo: 'Reviewed for accuracy; claims well supported. 世界',
				certifiedAt: '2026-06-21T12:00:00.000Z',
				contentModifiedAt: null,
				verifyUrl: 'https://certrev.com/verify/cert_v0_2_shape',
			},
			lifecycle: {
				issuedAt: '2026-06-21T12:00:00.000Z',
				expiresAt: '2026-07-21T12:00:00.000Z',
				revokedAt: null,
				revision: 1,
			},
		},
	},
	{
		// POR-10481 — the SLIM tombstone SIGNABLE shape: exactly the fields the detached signature
		// covers (kind, contractVersion, subject, revokedAt, revocationReason) — NO certified content.
		// Proves the tombstone canonicalizes deterministically and gives the render twins an exact
		// byte target for a revocation artifact. `kind` sorts between `contractVersion` and
		// `revocationReason` under JCS key ordering.
		name: 'cert_tombstone_signable_shape',
		value: {
			kind: 'tombstone',
			contractVersion: 1,
			subject: {
				platform: 'wordpress',
				externalId: '4242',
				logicalArticleId: 'art_tombstone',
				canonicalUrls: ['https://brand.example/?p=4242'],
				installationId: 'inst_wp_1',
				contentDigest: 'c'.repeat(64),
			},
			revokedAt: '2026-06-21T13:00:00.000Z',
			revocationReason: 'cert_revoked',
		},
	},
]

const vectors = cases.map(({ name, value }) => {
	const canonical = canonicalize(value)
	const bytes = new TextEncoder().encode(canonical)
	const canonicalHex = Buffer.from(bytes).toString('hex')
	const sha256 = createHash('sha256').update(bytes).digest('hex')
	return { name, value, canonical, canonicalHex, sha256 }
})

const out = {
	$comment:
		'Golden cross-language vectors for @certrev/cert-contract. canonical = RFC-8785 (JCS) string; canonicalHex = its UTF-8 bytes in hex; sha256 = SHA-256 of those bytes. Generated by generate-vectors.mjs; asserted by canonical.test.ts. A foreign (PHP/Go/…) RFC-8785 implementation MUST reproduce canonicalHex + sha256 for each input value.',
	canonicalization: 'RFC8785-JCS',
	vectors,
}

writeFileSync(join(__dirname, 'vectors.json'), `${JSON.stringify(out, null, '\t')}\n`)
console.log(`wrote ${vectors.length} vectors`)
