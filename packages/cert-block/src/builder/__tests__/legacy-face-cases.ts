/**
 * The input matrix the "legacy face is unchanged" tests and their golden share.
 *
 * Every case is a verified content, the RAW def exactly as the Delivery API would serve it (so `parseRenderDef` is part
 * of what is pinned), and the card's options. `__golden__/envelope-face-1.1.1.json` holds what @certrev/cert-block
 * 1.1.1 (tag `cert-block@1.1.1`, commit 816b288) rendered for each case through `parseRenderDef` ->
 * `envelopeCardInput` -> `renderCertBlock`; `scripts/legacy-golden/dump-envelope-111.oracle.ts` regenerates it from the
 * tag's own source (see its header). This file must stay importable by that script unchanged, so it imports only what
 * 1.1.1 also has.
 *
 * Some raw defs carry the 1.2.0 keys (`face`, `accentFg`). 1.1.1 does not read them, so for those cases the golden is
 * the legacy face the def's tokens paint: exactly what a 1.1.x space paints for a reader-face brand, and exactly what
 * 1.2.0 must paint for every def whose `face` is not `'reader'`.
 */
import { makeMockPayload } from '../../contract/fixtures.js'
import type { CertContent } from '../../contract/kernel.js'

const BASE = makeMockPayload().content

const FULL = {
	...BASE,
	expert: {
		...BASE.expert,
		credentials: [
			{ abbreviation: 'MD', fullName: 'Doctor of Medicine' },
			{ abbreviation: 'FAAD', fullName: 'Fellow of the American Academy of Dermatology', cardLabel: 'FAAD' },
		],
		bio: 'Board-certified dermatologist.',
		compensationCue: 'Compensated expert',
		credentialVerifiedAt: '2026-05-01T00:00:00.000Z',
	},
} as unknown as CertContent

const SPARSE = {
	...BASE,
	memo: '',
	expert: { displayName: 'Dr. Jane Doe', credentials: [], profileUrl: '' },
	author: { name: '' },
} as unknown as CertContent

const HOSTILE = {
	...BASE,
	memo: `Memo "with" <b>tags</b> & 'apostrophes' <script>alert(1)</script>`,
	expert: {
		...BASE.expert,
		displayName: `Dr. <i>"Quinn"</i> & O'Neil`,
		bio: `Bio <img src=x onerror=alert(1)> & 'quotes'`,
		profileUrl: `https://certrev.com/e/?a="b"&c='d'`,
		credentials: [{ abbreviation: 'RDN', fullName: 'x', cardLabel: `R"D'N <i>` }],
		credentialVerifiedAt: '2026-05-01T00:00:00.000Z',
		compensationCue: 'Compensated expert',
	},
	author: { name: `Mo "Writer" <Staff>`, title: `T & 'U'` },
	verifyUrl: `https://certrev.com/verify/x?a="b"&c='d'`,
} as unknown as CertContent

export const CONTENTS: Readonly<Record<string, CertContent>> = { full: FULL, sparse: SPARSE, hostile: HOSTILE }

const ELF = { v: 4, preset: 'memo', rung: 'standard', tokens: { accentColor: '#000000' }, hidden: ['reviewerPhoto'] }
const BRANDED = {
	v: 2,
	preset: 'default',
	rung: 'standard',
	tokens: {
		accentColor: '#F5C518',
		surface: '#faf7f0',
		cornerRadius: '0px',
		fontSlot: 'serif',
		barInk: '#7A1F2B',
		inkColor: '#222222',
	},
	barInkFg: '#ffffff',
	hidden: [],
}

/** Raw defs as served. `null` is "no def sibling". */
export const RAW_DEFS: Readonly<Record<string, unknown>> = {
	none: null,
	elf: ELF,
	branded: BRANDED,
	'hidden-many': { ...ELF, hidden: ['reviewerPhoto', 'bio', 'authorTitle', 'scopeLine', 'certificateLink'] },
	'layout-sidebar': { ...ELF, layout: 'sidebar' },
	'layout-floating': { ...BRANDED, layout: 'floating' },
	'layout-custom': {
		...ELF,
		layout: 'custom',
		customFace: { placedFields: ['label', 'authorName', 'memo', 'certificateLink', 'scopeLine'] },
	},
	'tokens-light-accent': { ...ELF, tokens: { accentColor: '#ffe600', fontSlot: 'grotesk' } },
	// The 1.2.0 keys. 1.1.1 does not read any of them: all of these paint the legacy face.
	'face-reader': { ...BRANDED, face: 'reader', accentFg: '#141414' },
	'face-reader-sidebar': { ...BRANDED, face: 'reader', accentFg: '#141414', layout: 'sidebar' },
	'face-legacy': { ...ELF, face: 'legacy' },
	'face-unknown': { ...BRANDED, face: 'minimal-v9', accentFg: '#ffffff' },
	'face-capitalised': { ...ELF, face: 'Reader' },
	'face-padded': { ...ELF, face: 'reader ' },
	'face-empty': { ...ELF, face: '' },
	'face-number': { ...ELF, face: 7 },
	'face-null': { ...ELF, face: null },
	'accentfg-only': { ...BRANDED, accentFg: '#ffffff' },
	'accentfg-malformed': { ...BRANDED, accentFg: 'white' },
	'unknown-key': { ...ELF, extra: 'ignored' },
}

/** The card options a case is rendered with. */
export const OPTION_SETS: Readonly<Record<string, { mode?: unknown; part?: unknown }>> = {
	default: {},
	sidebar: { mode: 'sidebar' },
	floating: { mode: 'floating' },
	'banner-header': { mode: 'banner', part: 'header' },
	'banner-memo': { mode: 'banner', part: 'memo' },
}

export interface LegacyCase {
	readonly id: string
	readonly content: string
	readonly def: string
	readonly options: string
}

/** Every content x def x option triple, except that the two thin contents ride a smaller set of defs and options. */
export const LEGACY_CASES: readonly LegacyCase[] = (() => {
	const out: LegacyCase[] = []
	const thinDefs = ['none', 'elf', 'branded', 'face-reader', 'face-unknown', 'layout-custom']
	const thinOptions = ['default', 'sidebar', 'banner-memo']
	for (const content of Object.keys(CONTENTS)) {
		for (const def of Object.keys(RAW_DEFS)) {
			for (const options of Object.keys(OPTION_SETS)) {
				if (content !== 'full' && !(thinDefs.includes(def) && thinOptions.includes(options))) continue
				out.push({ id: `${content}.${def}.${options}`, content, def, options })
			}
		}
	}
	return out
})()
