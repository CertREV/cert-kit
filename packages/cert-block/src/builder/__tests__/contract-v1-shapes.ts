/**
 * Contract-1 test shapes (2.0.0): the portal's own card documents, and Builder deliveries that serve them.
 *
 * The documents in `__fixtures__/contract-v1/` were painted by CertREV's server core, not by this package: portal
 * branch `v1-core` (`buildCardDocument`, lead mission certrev-0a99cc1c5bef; the commit is in each file's `source`),
 * from a masked fixture certificate (no customer data) and five designs: an e.l.f.-like def (black accent, reviewer
 * photo hidden) on each layout, a toned def saved in production, and no saved def. `doc` is the portal's own digest of
 * each document (`cardDocumentDigest`, Node's `createHash` over cert-contract's RFC 8785 bytes); this package
 * recomputes it with WebCrypto and must agree. `scripts/card-fixtures.portal.ts` regenerates them.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CertContent, CertLifecycle, CertPayload } from '@certrev/cert-contract'
import type { CardDocumentV1 } from '../card-contract.js'
import { builderPayload, builderSubject, ENTRY_ID, type FixtureIssuer } from './delivery-harness.js'

export const CONTRACT_CASES = [
	'banner-elf-like',
	'sidebar-elf-like',
	'floating-elf-like',
	'sidebar-saved-3-toned',
	'banner-no-def',
] as const
export type ContractCase = (typeof CONTRACT_CASES)[number]

export interface ContractFixture {
	readonly source: string
	readonly case: ContractCase
	readonly certId: string
	readonly content: CertContent
	readonly lifecycle: CertLifecycle
	readonly renderDef: Record<string, unknown> | null
	readonly card: CardDocumentV1
	readonly doc: string
}

/** One fixture, parsed afresh (a test may mutate its copy). */
export function contractFixture(name: ContractCase): ContractFixture {
	// Read from the package root (vitest's cwd), as the jsdom tests read their goldens: under jsdom `import.meta.url` is
	// the page's URL, not the file's.
	const raw = readFileSync(
		join(process.cwd(), 'src/builder/__tests__/__fixtures__/contract-v1', `${name}.json`),
		'utf8',
	)
	const fixture = JSON.parse(raw) as ContractFixture
	if (fixture.card.subject.externalId !== ENTRY_ID) throw new Error(`fixture ${name} is for another entry`)
	return fixture
}

/** Any 64-char lowercase hex (the Builder binding's v1 face digests, which a contract-1 client does not read). */
export const HEX_A = 'a'.repeat(64)
export const HEX_B = 'b'.repeat(64)

/** The Builder binding the portal signs for a contract-1 placement: `{ v: 1, defVersion, html, css, contract: 1, doc }`. */
export function contractBinding(
	fixture: ContractFixture,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		v: 1,
		defVersion: fixture.card.defVersion,
		html: HEX_A,
		css: HEX_B,
		contract: 1,
		doc: fixture.doc,
		...overrides,
	}
}

/** The signed payload of a contract-1 placement: the fixture's facts with the binding as `faceDigest`. */
export function contractPayload(
	fixture: ContractFixture,
	faceDigest: Record<string, unknown> | null = contractBinding(fixture),
	overrides: Partial<CertPayload> = {},
): CertPayload {
	const content = { ...fixture.content, ...(faceDigest ? { faceDigest } : {}) } as unknown as CertContent
	return builderPayload({
		certId: fixture.certId,
		subject: builderSubject(),
		content,
		lifecycle: fixture.lifecycle,
		...overrides,
	})
}

/**
 * The Builder Delivery body of a contract-1 placement: the signed envelope, the def, and the card sibling (`card`
 * absent from the body when `undefined` is passed explicitly via `{ card: undefined }`).
 */
export function contractBody(
	issuer: FixtureIssuer,
	fixture: ContractFixture,
	options: {
		readonly faceDigest?: Record<string, unknown> | null
		readonly card?: unknown
		readonly payload?: Partial<CertPayload>
	} = {},
): Record<string, unknown> {
	const faceDigest = options.faceDigest === undefined ? contractBinding(fixture) : options.faceDigest
	const payload = contractPayload(fixture, faceDigest, options.payload)
	const envelope = issuer.signPayload(payload)
	const card = 'card' in options ? options.card : fixture.card
	return { ...envelope, renderDef: fixture.renderDef, ...(card === undefined ? {} : { card }) }
}

/**
 * What one Builder block prints for a fixture: the given parts in order and, when they hold the document's first part
 * (top, else rail, else pill, else bottom: the lead's ruling, relay 074dbd2c8ef3), the head before them and both dialogs
 * after; a block without it prints its parts only.
 */
export function expectedCardHtml(card: CardDocumentV1, names: readonly string[]): string {
	const parts = card.parts as Record<string, string | undefined>
	const printed = names.map((name) => parts[name] ?? '').join('')
	const first = ['top', 'rail', 'pill', 'bottom'].find((name) => typeof parts[name] === 'string')
	if (first === undefined || !names.includes(first)) return printed
	return card.assets.head + printed + (card.dialogs.expert ?? '') + (card.dialogs.certificate ?? '')
}
