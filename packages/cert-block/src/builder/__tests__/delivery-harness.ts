/**
 * Test harness for the 1.1.0 delivery path: a fixture issuer that signs Builder envelopes and
 * tombstones with ONE key (so a revocation verifies against the same trust root as the envelope
 * it revokes), a scripted Delivery API, and a streaming SSR helper that waits for every Suspense
 * boundary. Real crypto throughout: nothing here mocks the kernel.
 */

import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import { Writable } from 'node:stream'
import type { CertDeliveryEnvelope, CertPayload, CertTombstone, ResolvePublicKeyByKid } from '@certrev/cert-contract'
import { localEd25519Signer, signPayloadEd25519, signTombstone } from '@certrev/cert-contract/signer'
import type { ReactElement } from 'react'
import { renderToPipeableStream } from 'react-dom/server'
import { makeMockPayload } from '../../contract/fixtures.js'

/** The Builder entry the card renders inside: `builderContext.content.id` and the subject's externalId. */
export const ENTRY_ID = 'entry-fixture-1'
export const BASE = 'https://staging.portal.certrev.com'
export const MARKER = { v: 1, baseUrl: BASE } as const
export const DELIVERY_URL = `${BASE}/api/cert/v1/delivery/builder/${ENTRY_ID}`
/** A fixed render clock, well inside the fixture's lifecycle. */
export const T0 = Date.parse('2026-09-26T12:00:00.000Z')

/** An e.l.f.-shaped def: the memo preset, a black accent, the reviewer photo hidden. */
export const ELF_LIKE_DEF = {
	v: 4,
	preset: 'memo',
	rung: 'standard',
	tokens: { accentColor: '#000000' },
	hidden: ['reviewerPhoto'],
}

export function builderSubject(externalId = ENTRY_ID): CertPayload['subject'] {
	return {
		platform: 'builder',
		externalId,
		logicalArticleId: 'art_logical_builder',
		canonicalUrls: ['https://brand.example.com/blog/retinol-guide'],
		installationId: 'space-fixture-1',
		contentDigest: 'b1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
	}
}

/** A Builder payload whose expert carries the dated credential verification the portal stamps. */
export function builderPayload(overrides: Partial<CertPayload> = {}): CertPayload {
	const base = makeMockPayload({ subject: builderSubject() })
	const expert = {
		...base.content.expert,
		credentials: [
			{ abbreviation: 'MD', fullName: 'Doctor of Medicine' },
			{ abbreviation: 'FAAD', fullName: 'Fellow of the American Academy of Dermatology', cardLabel: 'FAAD' },
		],
		bio: 'Board-certified dermatologist.',
		compensationCue: 'Compensated expert',
		// Stamped untyped by the portal's mint source; the face reads it as the storefront does.
		credentialVerifiedAt: '2026-05-01T00:00:00.000Z',
	}
	return { ...base, content: { ...base.content, expert } as CertPayload['content'], ...overrides }
}

export interface FixtureIssuer {
	readonly kid: string
	readonly resolveKid: ResolvePublicKeyByKid
	readonly privateKey: KeyObject
	envelope(overrides?: Partial<CertPayload>): CertDeliveryEnvelope
	tombstone(subject?: CertPayload['subject']): Promise<CertTombstone>
}

export function makeIssuer(kid = 'fixture-issuer-1'): FixtureIssuer {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519')
	const base64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
	const resolveKid: ResolvePublicKeyByKid = (k) => (k === kid ? { format: 'spki-base64', base64 } : null)
	return {
		kid,
		resolveKid,
		privateKey,
		envelope(overrides = {}) {
			const payload = builderPayload(overrides)
			const sig = signPayloadEd25519(payload, privateKey)
			return { payload, signature: { alg: 'ed25519', kid, sig, signedAt: payload.lifecycle.issuedAt } }
		},
		tombstone(subject = builderSubject()) {
			return signTombstone(
				{ subject, revokedAt: '2026-09-26T11:00:00.000Z', revocationReason: 'cert_revoked' },
				{ kid, sign: localEd25519Signer(privateKey), signedAt: '2026-09-26T11:00:00.000Z' },
			)
		},
	}
}

export interface ScriptedDelivery {
	readonly fetch: typeof fetch
	readonly calls: string[]
	/** What the next request (and every one after, until changed) is answered with. */
	respond(next: () => Response | Promise<Response>): void
}

/** A Delivery API stand-in: records each URL, answers with whatever `respond` last set. */
export function scriptedDelivery(first: () => Response | Promise<Response>): ScriptedDelivery {
	let answer = first
	const calls: string[] = []
	const impl = (async (input: RequestInfo | URL) => {
		calls.push(String(input))
		return answer()
	}) as typeof fetch
	return {
		fetch: impl,
		calls,
		respond(next) {
			answer = next
		},
	}
}

export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** The Builder Delivery body: the artifact with the def sibling spliced beside it. */
export function deliveryBody(artifact: object, renderDef: unknown = ELF_LIKE_DEF): Record<string, unknown> {
	return { ...artifact, renderDef }
}

/**
 * Stream-render to completion (every Suspense boundary resolved), as a streaming SSR host does
 * before it flushes the page. Rejects on a shell error.
 */
export function renderToHtml(element: ReactElement): Promise<string> {
	return new Promise((resolve, reject) => {
		let html = ''
		const sink = new Writable({
			write(chunk, _enc, done) {
				html += chunk.toString()
				done()
			},
		})
		sink.on('finish', () => resolve(html))
		const stream = renderToPipeableStream(element, {
			onAllReady() {
				stream.pipe(sink)
			},
			onShellError: reject,
			onError(error) {
				reject(error)
			},
		})
	})
}

/** The one cert-chrome root in `html`, or null. */
export function chromeRoot(html: string): string | null {
	const at = html.indexOf('<div data-certrev-cert-chrome')
	return at === -1 ? null : html.slice(at)
}
