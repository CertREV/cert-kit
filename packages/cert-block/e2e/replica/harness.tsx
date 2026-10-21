/**
 * The replica harness: the page server (streamed React SSR under a strict Content-Security-Policy), CertREV's side
 * (the Delivery API, the published key set, the hosted runtime) answered from the portal's own card documents, and
 * the browser routes that serve CertREV's origins to Chromium.
 *
 * CertREV's side: every placement is a portal fixture document (`src/builder/__tests__/__fixtures__/contract-v1`,
 * painted by the portal's `buildCardDocument`), served for its own Builder entry. A document is moved to another
 * entry by replacing the entry id in its subject and its hosts' `data-certrev-external-id` (the only bytes that name
 * the entry) and re-digesting it; nothing else in it changes. The envelope binding it is signed by a fixture issuer
 * whose public key the replica bakes in (`client.tsx`); the in-app navigation's article is signed by a ROTATED kid
 * that only the origin's published key set, signed by the baked kid, vouches for.
 *
 * THE HOSTED RUNTIME is CertREV's own (sibling mission S2): `card-runtime.<hash>.js.txt` holds its bytes as S2 built them
 * (`card-runtime.release.json` names the commit and the SRI integrity; `standInRuntime` refuses bytes that do not hash to
 * it), served at its hashed URL on the portal's origin. It revalidates every placement against the card route
 * (`/api/cert/v1/card/builder/<entry>`), which this side answers with the envelope and the card, or with a signed
 * tombstone once a test revokes the placement (`CertrevSide.revoke`).
 */

import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { canonicalizeJson } from '@certrev/cert-contract'
import { build } from 'esbuild'
import type { Page, Route } from 'playwright-core'
import { renderToReadableStream } from 'react-dom/server.browser'
import {
	type ContractCase,
	type ContractFixture,
	contractBinding,
	contractFixture,
	contractPayload,
} from '../../src/builder/__tests__/contract-v1-shapes.js'
import { fixedIssuer } from '../../src/builder/__tests__/delivered-face-shapes.js'
import { builderSubject, type FixtureIssuer, makeIssuer } from '../../src/builder/__tests__/delivery-harness.js'
import type { CardDocumentV1 } from '../../src/builder/card-contract.js'
import { setCardDeliveryRuntimeForTests } from '../../src/builder/delivery-runtime.js'
import { bakedResolver, keySetBody, keySetObject, type TestKey } from '../../src/verify/__tests__/key-set-shapes.js'
import { App, DELIVERY_ORIGIN, type ReplicaArticle } from './app.js'

const PACKAGE = process.cwd()
export const ASSET_ORIGIN = 'https://assets.certrev.com'

/** The four CSP sources cert-block 2.0 asks a brand to add, by directive. */
export const CERTREV_CSP_SOURCES = {
	'script-src': 'https://portal.certrev.com',
	'connect-src': 'https://portal.certrev.com',
	'font-src': 'https://assets.certrev.com',
	'img-src': 'https://assets.certrev.com',
} as const
export type CertrevDirective = keyof typeof CERTREV_CSP_SOURCES

export interface CspOptions {
	/** Leave one of the four CertREV sources out (a positive control). */
	readonly without?: CertrevDirective
	/** The brand's own policy allows `data:` images (the card's logos are `data:image/svg+xml` today). */
	readonly dataImages: boolean
}

/**
 * The page's policy: a Hydrogen-style baseline (its own origin, a per-response nonce for its scripts, inline styles,
 * which every cert-block release has needed) plus exactly the four CertREV sources.
 */
export function cspFor(nonce: string, options: CspOptions): string {
	const add = (directive: CertrevDirective) =>
		options.without === directive ? '' : ` ${CERTREV_CSP_SOURCES[directive]}`
	return [
		"default-src 'self'",
		`script-src 'self' 'nonce-${nonce}'${add('script-src')}`,
		`connect-src 'self'${add('connect-src')}`,
		`font-src 'self'${add('font-src')}`,
		`img-src 'self'${options.dataImages ? ' data:' : ''}${add('img-src')}`,
		"style-src 'self' 'unsafe-inline'",
		"base-uri 'self'",
		"object-src 'none'",
		"frame-ancestors 'none'",
	].join('; ')
}

/** CertREV's hosted runtime (S2's build) as the portal serves it: its immutable hashed URL and its SRI integrity. */
export function standInRuntime(): { readonly src: string; readonly integrity: string; readonly body: string } {
	const release = JSON.parse(readFileSync(join(PACKAGE, 'e2e/replica/card-runtime.release.json'), 'utf8')) as {
		name: string
		integrity: string
	}
	const body = readFileSync(join(PACKAGE, `e2e/replica/${release.name}.txt`), 'utf8')
	const integrity = `sha384-${createHash('sha384').update(body).digest('base64')}`
	if (integrity !== release.integrity)
		throw new Error(`runtime ${release.name}: bytes do not hash to ${release.integrity}`)
	return { src: `${DELIVERY_ORIGIN}/api/cert/v1/runtime/${release.name}`, integrity, body }
}

const FIXTURE_ENTRY = 'entry-fixture-1'

/** A fixture document moved to another Builder entry (and given the runtime), re-digested. */
export function documentFor(name: ContractCase, entryId: string, runtime?: { src: string; integrity: string }) {
	const fixture = contractFixture(name)
	const host = (html: string | undefined) =>
		html?.split(`data-certrev-external-id="${FIXTURE_ENTRY}"`).join(`data-certrev-external-id="${entryId}"`)
	const parts = Object.fromEntries(Object.entries(fixture.card.parts).map(([k, v]) => [k, host(v)]))
	const dialogs = Object.fromEntries(Object.entries(fixture.card.dialogs).map(([k, v]) => [k, host(v)]))
	const card = {
		...fixture.card,
		subject: { platform: 'builder', externalId: entryId },
		parts,
		dialogs,
		assets: {
			...fixture.card.assets,
			...(runtime ? { runtime: { src: runtime.src, integrity: runtime.integrity } } : {}),
		},
	} as CardDocumentV1
	const doc = createHash('sha256').update(canonicalizeJson(card)).digest('hex')
	return { fixture: { ...fixture, card, doc }, card, doc }
}

export interface Placement {
	readonly entryId: string
	readonly fixture: ContractCase
	/** Sign with the rotated kid the origin's key set publishes, instead of the baked one. */
	readonly rotated?: boolean
	/**
	 * A document painted for this entry already (the preview-parity fixture's Builder card), served as it is, with its
	 * facts: then `fixture` is not used.
	 */
	readonly painted?: {
		readonly card: CardDocumentV1
		readonly content: Record<string, unknown>
		readonly lifecycle: Record<string, unknown>
		readonly renderDef: unknown
	}
}

export interface CertrevSide {
	readonly baked: FixtureIssuer
	readonly rotated: FixtureIssuer
	readonly bodies: ReadonlyMap<string, unknown>
	readonly cards: ReadonlyMap<string, CardDocumentV1>
	readonly keySet: unknown
	readonly runtime: ReturnType<typeof standInRuntime>
	/** The card route's answers by entry: the envelope and the card, or a tombstone once revoked. */
	readonly cardRoute: Map<string, unknown>
	/** Revoke a placement: the card route answers its signed tombstone from now on (the delivery's cache is untouched). */
	revoke(entryId: string): Promise<void>
}

function asTestKey(issuer: FixtureIssuer): TestKey {
	const jwk = issuer.privateKey.export({ format: 'jwk' }) as { x: string }
	const spki = (issuer.resolveKid(issuer.kid) as { base64: string }).base64
	return { kid: issuer.kid, privateKey: issuer.privateKey, x: jwk.x, spki }
}

export function certrevSide(placements: readonly Placement[]): CertrevSide {
	const baked = fixedIssuer('replica-issuer-1')
	const rotated = makeIssuer('replica-rotated-2')
	const runtime = standInRuntime()
	const bodies = new Map<string, unknown>()
	const cards = new Map<string, CardDocumentV1>()
	const cardRoute = new Map<string, unknown>()
	for (const p of placements) {
		let fixture: ContractFixture
		if (p.painted) {
			const card = {
				...p.painted.card,
				assets: { ...p.painted.card.assets, runtime: { src: runtime.src, integrity: runtime.integrity } },
			} as CardDocumentV1
			fixture = {
				...contractFixture('banner-elf-like'),
				certId: card.certId,
				content: p.painted.content as never,
				lifecycle: p.painted.lifecycle as never,
				renderDef: p.painted.renderDef as never,
				card,
				doc: createHash('sha256').update(canonicalizeJson(card)).digest('hex'),
			}
		} else {
			fixture = documentFor(p.fixture, p.entryId, runtime).fixture
		}
		const payload = contractPayload(fixture, contractBinding(fixture), { subject: builderSubject(p.entryId) })
		const envelope = (p.rotated ? rotated : baked).signPayload(payload)
		bodies.set(p.entryId, { ...envelope, renderDef: fixture.renderDef, card: fixture.card })
		cards.set(p.entryId, fixture.card)
		cardRoute.set(p.entryId, { envelope, card: fixture.card })
	}
	const keySet = keySetBody(keySetObject([asTestKey(baked), asTestKey(rotated)]), asTestKey(baked))
	return {
		baked,
		rotated,
		bodies,
		cards,
		keySet,
		runtime,
		cardRoute,
		async revoke(entryId) {
			cardRoute.set(entryId, await baked.tombstone(builderSubject(entryId)))
		},
	}
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
	})

/** CertREV's origin as a fetch: what the page server's reads get (and, through `routeCertrev`, the browser's). */
export function certrevFetch(side: CertrevSide): typeof fetch {
	return (async (input: RequestInfo | URL) => {
		const url = new URL(String(input))
		if (url.origin !== DELIVERY_ORIGIN) return json({ error: 'not_found' }, 404)
		if (url.pathname === '/api/cert/v1/keys') return json(side.keySet)
		const card = /^\/api\/cert\/v1\/card\/builder\/([^/]+)$/.exec(url.pathname)
		if (card) {
			const answer = side.cardRoute.get(decodeURIComponent(card[1]))
			return answer ? json(answer) : json({ error: 'not_found' }, 404)
		}
		const delivery = /^\/api\/cert\/v1\/delivery\/builder\/([^/]+)$/.exec(url.pathname)
		if (delivery) {
			const body = side.bodies.get(decodeURIComponent(delivery[1]))
			return body ? json(body) : json({ error: 'not_found' }, 404)
		}
		if (url.href === side.runtime.src) {
			return new Response(side.runtime.body, {
				headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' },
			})
		}
		return json({ error: 'not_found' }, 404)
	}) as typeof fetch
}

/** A grey 1x1 PNG, for every reviewer photo the fixtures name on CertREV's asset host. */
const PHOTO = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
	'base64',
)

/**
 * Serve CertREV's origins to the browser: the portal from `certrevFetch`; the asset host's fonts from the network
 * (CertREV's public fonts) or, offline, a 404, and its photos as a placeholder. Routes run after the policy check, so
 * a request the policy blocks never reaches them: the CSP evidence is the browser's own.
 */
export async function routeCertrev(page: Page, side: CertrevSide, requests: string[]): Promise<void> {
	const portal = certrevFetch(side)
	await page.route(`${DELIVERY_ORIGIN}/**`, async (route: Route) => {
		requests.push(route.request().url())
		const res = await portal(route.request().url())
		await route.fulfill({
			status: res.status,
			headers: Object.fromEntries(res.headers.entries()),
			body: Buffer.from(await res.arrayBuffer()),
		})
	})
	await page.route(`${ASSET_ORIGIN}/**`, async (route: Route) => {
		const url = route.request().url()
		requests.push(url)
		if (url.endsWith('.woff2')) {
			try {
				const res = await route.fetch({ timeout: 5_000 })
				await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } })
			} catch {
				await route.fulfill({ status: 404, body: '' })
			}
			return
		}
		await route.fulfill({
			status: 200,
			contentType: 'image/png',
			body: PHOTO,
			headers: { 'access-control-allow-origin': '*' },
		})
	})
}

/**
 * The Appearance preview's contract-1 page and the Builder card for the same design and content, both painted by the
 * portal's own code (`src/builder/__tests__/__fixtures__/contract-v1/preview-parity.json`, see its `source`).
 */
export interface PreviewParityCase {
	readonly externalId: string
	readonly previewHead: string
	readonly previewHosts: Record<string, string>
	readonly previewCertId: string
	readonly builderCard: CardDocumentV1
	readonly content: Record<string, unknown>
	readonly lifecycle: Record<string, unknown>
	readonly renderDef: unknown
}

let parity: { readonly cases: Record<string, PreviewParityCase> } | null = null
export function previewParity(): { readonly cases: Record<string, PreviewParityCase> } {
	parity ??= JSON.parse(
		readFileSync(join(PACKAGE, 'src/builder/__tests__/__fixtures__/contract-v1/preview-parity.json'), 'utf8'),
	) as { readonly cases: Record<string, PreviewParityCase> }
	return parity
}

export interface ReplicaServer {
	readonly origin: string
	csp: CspOptions
	close(): Promise<void>
}

/** The browser bundle: the client entry with the replica's articles and the baked fixture key. */
async function clientBundle(side: CertrevSide, articles: readonly ReplicaArticle[]): Promise<string> {
	const result = await build({
		entryPoints: [join(PACKAGE, 'e2e/replica/client.tsx')],
		bundle: true,
		write: false,
		format: 'esm',
		platform: 'browser',
		target: 'es2022',
		jsx: 'automatic',
		minify: false,
		// The same React the page server renders with (`vitest.e2e.config.ts`, CERT_BLOCK_E2E_REACT).
		...(process.env.CERT_BLOCK_E2E_REACT
			? {
					alias: {
						react: `${process.env.CERT_BLOCK_E2E_REACT}/react`,
						'react-dom': `${process.env.CERT_BLOCK_E2E_REACT}/react-dom`,
					},
				}
			: {}),
		define: {
			'process.env.NODE_ENV': '"production"',
			__REPLICA__: JSON.stringify({ kid: side.baked.kid, spki: asTestKey(side.baked).spki, articles }),
		},
		logLevel: 'silent',
	})
	return result.outputFiles[0].text
}

/** A bare page that prints one document's parts the way the Appearance preview prints them: each host on its own. */
export function barePage(card: CardDocumentV1, part: string, box: { x: number; y: number; width: number }): string {
	const html = (card.parts as Record<string, string>)[part] ?? (card.dialogs as Record<string, string>)[part] ?? ''
	return (
		'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
		'<style>html,body{margin:0;background:#fff}</style></head><body>' +
		`<div id="bare" style="position:absolute;left:${box.x}px;top:${box.y}px;width:${box.width}px">${card.assets.head}${html}</div>` +
		'</body></html>'
	)
}

export async function startReplica(
	side: CertrevSide,
	articles: readonly ReplicaArticle[],
	csp: CspOptions,
): Promise<ReplicaServer> {
	const bundle = await clientBundle(side, articles)
	const state = { csp }
	// One page server process: its delivery cache lives across requests (60 s, then refreshed), as a storefront's does.
	setCardDeliveryRuntimeForTests({
		resolveKid: bakedResolver(asTestKey(side.baked)),
		fetchImpl: () => certrevFetch(side),
		now: Date.now,
	})
	const server: Server = createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://replica.test')
		const nonce = randomBytes(16).toString('base64')
		const headers = { 'content-security-policy': cspFor(nonce, state.csp) }
		try {
			if (url.pathname === '/client.js') {
				res.writeHead(200, { 'content-type': 'application/javascript' })
				res.end(bundle)
				return
			}
			if (url.pathname === '/favicon.ico') {
				res.writeHead(404)
				res.end()
				return
			}
			const preview = /^\/preview\/([^/]+)\/([^/]+)$/.exec(url.pathname)
			if (preview) {
				// One part of the Appearance preview's own page (`previewParity`), printed alone the way `barePage` prints ours.
				const found = previewParity().cases[decodeURIComponent(preview[1])]
				if (!found) throw new Error(`no preview case ${preview[1]}`)
				const box = {
					x: Number(url.searchParams.get('x') ?? 0),
					y: Number(url.searchParams.get('y') ?? 0),
					width: Number(url.searchParams.get('w') ?? 640),
				}
				const host = found.previewHosts[decodeURIComponent(preview[2])] ?? ''
				res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...headers })
				res.end(
					barePage({ assets: { head: found.previewHead }, parts: { only: host }, dialogs: {} } as never, 'only', box),
				)
				return
			}
			const bare = /^\/bare\/([^/]+)\/([^/]+)$/.exec(url.pathname)
			if (bare) {
				const card = side.cards.get(decodeURIComponent(bare[1]))
				if (!card) throw new Error(`no card for ${bare[1]}`)
				const box = {
					x: Number(url.searchParams.get('x') ?? 0),
					y: Number(url.searchParams.get('y') ?? 0),
					width: Number(url.searchParams.get('w') ?? 640),
				}
				res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...headers })
				res.end(barePage(card, decodeURIComponent(bare[2]), box))
				return
			}
			const stream = await renderToReadableStream(<App articles={articles} path={url.pathname} />, {
				// `?chunk=big`: a host that raises React's progressiveChunkSize (React 19 streams a boundary larger than it,
				// the card's included, after the shell, where only a script moves it into place).
				...(url.searchParams.get('chunk') === 'big' ? { progressiveChunkSize: 1_000_000 } : {}),
				nonce,
				bootstrapModules: ['/client.js'],
				bootstrapScriptContent: 'window.__replicaRecoverable=[]',
			})
			res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...headers })
			res.write('<!DOCTYPE html>')
			const reader = stream.getReader()
			for (;;) {
				const { done, value } = await reader.read()
				if (done) break
				res.write(value)
			}
			res.end()
		} catch (error) {
			res.writeHead(500, { 'content-type': 'text/plain' })
			res.end(String(error instanceof Error ? error.stack : error))
		}
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const { port } = server.address() as AddressInfo
	return {
		origin: `http://127.0.0.1:${port}`,
		get csp() {
			return state.csp
		},
		set csp(next: CspOptions) {
			state.csp = next
		},
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	}
}
