/**
 * Options-only Builder blocks, as the CertREV exporter wrote them before 1.1.0 (no `delivery`
 * key) plus the shapes an editor can leave behind. `__golden__/options-only-1.0.3.json` is these
 * props rendered by the UNMODIFIED 1.0.3 `CertReviewCard` (generated from the 1.0.3 tarball
 * source, not from this tree), so the back-compat test compares 1.1.0 against what 1.0.3 really
 * painted rather than against a re-derivation of it.
 *
 * Data only: nothing here imports the card, so the 1.0.3 generator can load this file unchanged.
 */

const renderDef = {
	v: 7,
	preset: 'memo',
	rung: 'standard',
	tokens: { accentColor: '#000000', surface: '#ffffff', cornerRadius: '8px', fontSlot: 'brand' },
	hidden: ['reviewerPhoto'],
}

/** The 19-key projection `buildCertChromeData` returns, spread verbatim into the block's options. */
const todaysExport = {
	bylineCredentialed: 'Reviewed by Dr. Jane Doe, MD on June 21, 2026',
	credentialVerification: { credential: 'MD, FAAD', verifiedAt: '2026-05-01T00:00:00.000Z' },
	bylinePlain: 'Reviewed by Dr. Jane Doe on June 21, 2026',
	reviewerName: 'Dr. Jane Doe',
	bio: 'Board-certified dermatologist.',
	background: null,
	memo: 'The retinol guidance and usage cadence are accurate and safely framed.',
	compensationCue: 'This expert was compensated for their review.',
	scopeLine: 'Expert review covers the article text only.',
	reviewerPhoto: 'https://cdn.certrev.com/experts/jane-doe.jpg',
	reviewerProfileUrl: 'https://certrev.com/expert/exp_fixture_1',
	verifyUrl: 'https://certrev.com/verify/cert_fixture_001',
	certifiedAt: '2026-06-21T15:30:00.000Z',
	contentModifiedAt: null,
	authorName: 'Sam Writer',
	authorTitle: 'Senior Content Editor',
	display: { showExpertPhoto: true, showCredentials: true },
	renderDef: null,
	stringsVersion: '2026-07',
}

export const OPTIONS_ONLY_SHAPES: Readonly<Record<string, Record<string, unknown>>> = {
	/** Today's export: 19 keys, no `mode` (the banner bridge), no def. */
	todaysExport,
	/** Today's export for a brand with an active def (tokens applied, `hidden` ignored by 1.0.3). */
	todaysExportWithDef: { ...todaysExport, renderDef },
	/** Pro-bono expert: the exporter writes `compensationCue: null`. */
	proBono: { ...todaysExport, compensationCue: null },
	/** No credential verification: the name-only face. */
	nameOnly: { ...todaysExport, bylineCredentialed: null, credentialVerification: null },
	/** An editor-chosen placement on an exported block. */
	sidebar: { ...todaysExport, mode: 'sidebar' },
	floating: { ...todaysExport, mode: 'floating' },
	/** Banner memo placement. */
	bannerMemoPart: { ...todaysExport, mode: 'banner', part: 'memo' },
	/** `mode: null`, which Builder writes when an editor clears the select. */
	modeNull: { ...todaysExport, mode: null },
	/** A block with no reviewer renders nothing. */
	noReviewer: { ...todaysExport, reviewerName: null },
	/** A block with no verify URL renders nothing. */
	noVerifyUrl: { ...todaysExport, verifyUrl: null },
	/**
	 * What a 1.1.0 exporter writes when it opts a block OUT of the envelope face: the 20th key,
	 * explicitly null. 1.0.3 has no such prop and ignores it, so this must paint `todaysExport`.
	 */
	deliveryNull: { ...todaysExport, delivery: null },
	/** An editor-built block with a handful of keys. */
	handBuilt: {
		reviewerName: 'Dr. Jane Doe',
		verifyUrl: 'https://certrev.com/verify/cert_fixture_001',
		memo: 'Checked.',
	},
}
