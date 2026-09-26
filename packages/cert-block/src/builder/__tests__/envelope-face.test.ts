/**
 * `envelopeCardInput`: the one mapping from verified content + the brand's def to the
 * `renderCertBlock` input. Exported on `./builder/face` so a server-side preview renders through
 * it; these pin the mapping itself, independent of React and of the fetch.
 */

import { describe, expect, it } from 'vitest'
import { HIDEABLE_FIELDS } from '../../components/render-def.js'
import {
	CERT_FACE_FIELDS,
	credentialLabel,
	envelopeCardInput,
	faceFromDef,
	layoutFor,
	themeFromDef,
} from '../envelope-face.js'
import { builderPayload, ELF_LIKE_DEF } from './delivery-harness.js'

const def = { ...ELF_LIKE_DEF }

describe('layoutFor', () => {
	it('an editor mode wins, then the def layout, then banner', () => {
		expect(layoutFor({ ...def, layout: 'sidebar' }, 'floating')).toBe('floating')
		expect(layoutFor({ ...def, layout: 'sidebar' }, undefined)).toBe('sidebar')
		expect(layoutFor({ ...def, layout: 'sidebar' }, 'nonsense')).toBe('sidebar')
		expect(layoutFor(def, undefined)).toBe('banner')
		expect(layoutFor(null, null)).toBe('banner')
	})

	it('custom only when the def carries its composition', () => {
		expect(layoutFor({ ...def, layout: 'custom', customFace: { placedFields: ['memo'] } }, undefined)).toBe('custom')
		expect(layoutFor({ ...def, layout: 'custom' }, undefined)).toBe('banner')
	})
})

describe('faceFromDef', () => {
	it('places every field except the hideable ones the def hides', () => {
		expect(faceFromDef(def, 'banner')).toEqual({
			rung: 'standard',
			placedFields: CERT_FACE_FIELDS.filter((f) => f !== 'reviewerPhoto'),
		})
	})

	it('ignores a hide on a field that is not hideable', () => {
		const face = faceFromDef({ ...def, hidden: ['scopeLine', 'compensationCue', 'certificateLink', 'memo'] }, 'banner')
		expect(face?.placedFields).toEqual(CERT_FACE_FIELDS.filter((f) => f !== 'memo'))
		expect(HIDEABLE_FIELDS).toEqual(['reviewerPhoto', 'memo'])
	})

	it('a custom layout places exactly its composition', () => {
		expect(faceFromDef({ ...def, customFace: { placedFields: ['memo', 'scopeLine'] } }, 'custom')).toEqual({
			rung: 'standard',
			placedFields: ['memo', 'scopeLine'],
		})
	})

	it('no def, no face (the preset default)', () => {
		expect(faceFromDef(null, 'banner')).toBeUndefined()
	})
})

describe('themeFromDef', () => {
	it('maps the tokens and derives the accent ink', () => {
		expect(themeFromDef({ ...def, tokens: { accentColor: '#000000', cornerRadius: '4px' } })).toEqual({
			accentColor: '#000000',
			accentFg: '#ffffff',
			surface: undefined,
			cornerRadius: '4px',
			fontSlot: undefined,
			barInk: undefined,
			inkColor: undefined,
		})
		expect(themeFromDef({ ...def, tokens: { accentColor: '#ffe600' } })?.accentFg).toBe('#141414')
	})

	it('derives no ink for an accent that is not an opaque hex', () => {
		expect(themeFromDef({ ...def, tokens: { accentColor: 'red' } })).not.toHaveProperty('accentFg')
	})
})

describe('credentialLabel', () => {
	it('joins cardLabel ?? abbreviation, only with the dated verification', () => {
		const expert = {
			credentials: [{ abbreviation: 'MD' }, { abbreviation: 'FAAD', cardLabel: 'Board-certified' }],
			credentialVerifiedAt: '2026-05-01T00:00:00.000Z',
		}
		expect(credentialLabel(expert)).toEqual({
			credential: 'MD, Board-certified',
			verifiedAt: '2026-05-01T00:00:00.000Z',
		})
		expect(credentialLabel({ ...expert, credentialVerifiedAt: undefined })).toBeNull()
		expect(credentialLabel({ ...expert, credentials: [] })).toBeNull()
	})
})

describe('envelopeCardInput', () => {
	it('maps the verified content to the renderCertBlock input', () => {
		const { content } = builderPayload()
		expect(envelopeCardInput(content, def, { mode: undefined, part: 'memo' })).toEqual({
			mode: 'banner',
			theme: themeFromDef(def),
			face: faceFromDef(def, 'banner'),
			part: 'memo',
			// The envelope face is always the phone-aware one (a desktop paints it as without).
			responsive: true,
			facts: {
				authorName: 'Sam Writer',
				authorTitle: 'Senior Content Editor',
				reviewerName: 'Dr. Jane Doe',
				credential: 'MD, FAAD',
				credentialVerifiedAt: '2026-05-01T00:00:00.000Z',
				certifiedAt: '2026-06-21T15:30:00.000Z',
				memo: content.memo,
				bio: 'Board-certified dermatologist.',
				profileUrl: 'https://certrev.com/experts/jane-doe',
				certificateUrl: 'https://certrev.com/verify/cert_fixture_001',
				compensationCue: undefined,
			},
		})
	})

	it('pro bono (a null cue) is the no-cue face; the name-only face has no credential', () => {
		const { content } = builderPayload()
		const input = envelopeCardInput(
			{ ...content, expert: { ...content.expert, compensationCue: null, credentialVerifiedAt: undefined } as never },
			null,
		)
		expect(input?.facts.compensationCue).toBeNull()
		expect(input?.facts.credential).toBe('')
		expect(input).not.toHaveProperty('face')
		expect(input).not.toHaveProperty('theme')
	})

	it('falls back to "Editorial" for a missing author, and drops an unknown part', () => {
		const { content } = builderPayload()
		const input = envelopeCardInput({ ...content, author: { name: '', title: null } }, def, { part: 'everything' })
		expect(input?.facts.authorName).toBe('Editorial')
		expect(input).not.toHaveProperty('part')
	})

	it('is null without a reviewer or a verify URL', () => {
		const { content } = builderPayload()
		expect(envelopeCardInput({ ...content, verifyUrl: '' }, def)).toBeNull()
		expect(envelopeCardInput({ ...content, expert: { ...content.expert, displayName: '' } }, def)).toBeNull()
	})
})
