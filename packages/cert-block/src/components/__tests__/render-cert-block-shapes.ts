/**
 * `renderCertBlock` inputs for the phone-face tests. `__golden__/render-cert-block-1.0.3.json` is
 * these inputs rendered by the UNMODIFIED 1.0.3 `renderCertBlock` (generated from the 1.0.3
 * tarball source, not from this tree), so "absent `responsive` changes nothing" is checked against
 * what 1.0.3 really painted, long memos included.
 *
 * Data only: nothing here imports the renderer, so the 1.0.3 generator can load this file unchanged.
 */

/** 167 characters: over the 160-character collapse threshold, with no line breaks. */
export const LONG_MEMO =
	'I reviewed the retinol claims against current dermatology guidance; the concentrations, the usage cadence and the sun-protection advice are accurate and safely framed.'

/** Short, but five paragraphs: collapses on its line breaks. */
export const BROKEN_MEMO = 'Accurate.\nSafe.\nCurrent.\nWell sourced.\nClear.'

/** Under the threshold with three breaks: never collapses. */
export const SHORT_MEMO = 'Accurate.\nSafe.\nCurrent.\nClear.'

const facts = {
	authorName: 'Sam Writer',
	authorTitle: 'Senior Content Editor',
	reviewerName: 'Dr. Jane Doe',
	credential: 'MD, FAAD',
	credentialVerifiedAt: '2026-05-01T00:00:00.000Z',
	certifiedAt: '2026-06-21T15:30:00.000Z',
	memo: LONG_MEMO,
	bio: 'Board-certified dermatologist.',
	profileUrl: 'https://certrev.com/experts/jane-doe',
	certificateUrl: 'https://certrev.com/verify/cert_fixture_001',
	compensationCue: undefined,
}

const allFields = [
	'label',
	'authorName',
	'authorTitle',
	'reviewerPhoto',
	'bylineCredentialed',
	'bylinePlain',
	'bio',
	'memo',
	'profileLink',
	'certificateLink',
	'scopeLine',
	'compensationCue',
]

/** The e.l.f.-shaped def as the envelope face maps it: black accent, no reviewer photo. */
const elfFace = { rung: 'standard', placedFields: allFields.filter((f) => f !== 'reviewerPhoto') }
const elfTheme = { accentColor: '#000000', accentFg: '#ffffff' }

export const RENDER_SHAPES: Readonly<Record<string, Record<string, unknown>>> = {
	bannerLong: { mode: 'banner', facts },
	bannerLongElf: { mode: 'banner', theme: elfTheme, face: elfFace, facts },
	bannerHeaderPart: { mode: 'banner', part: 'header', face: elfFace, facts },
	bannerMemoPart: { mode: 'banner', part: 'memo', face: elfFace, facts },
	bannerBroken: { mode: 'banner', face: elfFace, facts: { ...facts, memo: BROKEN_MEMO } },
	bannerShort: { mode: 'banner', face: elfFace, facts: { ...facts, memo: SHORT_MEMO } },
	bannerNoAuthor: {
		mode: 'banner',
		face: { ...elfFace, placedFields: elfFace.placedFields.filter((f) => f !== 'authorName') },
		facts,
	},
	bannerEmptyMemo: { mode: 'banner', face: elfFace, facts: { ...facts, memo: '' } },
	sidebarLong: { mode: 'sidebar', facts },
	sidebarLongElf: { mode: 'sidebar', theme: elfTheme, face: elfFace, facts },
	sidebarShort: { mode: 'sidebar', face: elfFace, facts: { ...facts, memo: SHORT_MEMO } },
	floating: { mode: 'floating', face: elfFace, facts },
	customLong: { mode: 'custom', face: { rung: 'standard', placedFields: ['label', 'memo', 'certificateLink'] }, facts },
	escapedMemo: { mode: 'banner', facts: { ...facts, memo: `${LONG_MEMO} <script>alert(1)</script> & "quoted"` } },
}
