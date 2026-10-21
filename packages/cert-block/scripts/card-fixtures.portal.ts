/**
 * Generates cert-block 2.0's contract-1 card-document fixtures from the lead's server core (portal branch v1-core),
 * so cert-kit's tests run on the server's real bytes rather than a hand-built stand-in.
 *
 * Run from a portal checkout of v1-core (node_modules present):
 *   npx tsx <this file> <out-dir>
 * Writes one JSON per case: { source, case, certId, subject, content, lifecycle, renderDef, card, doc }.
 * `content` is the facts the card was painted from (no faceDigest); the cert-kit test signs a payload with this content
 * plus the Builder binding `{ v: 1, defVersion, html, css, contract: 1, doc }` under a fixture key.
 */
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildPayload } from '@certrev/cert-contract/signer'
import { buildCardDocument, cardDocumentDigest } from '@/lib/cert-delivery/card-document'
import { projectRenderDef } from '@/lib/cert-delivery/render-def-projection'
import { assembleCertFacts } from '@/lib/cert-delivery/signer'
import { SAVED_DEFS } from '@/lib/cert-render/card/__fixtures__/saved-defs'
import { maskedBrand, maskedSource } from '@/lib/cert-render/parity/__fixtures__/masked-brands'
import { readerDef } from '@/lib/cert-render/reader/reader-test-kit'
import { assertCompliantRender } from '@/lib/design-guide'

const out = process.argv[2]
if (!out) throw new Error('usage: gen-card-fixtures.ts <out-dir>')
mkdirSync(out, { recursive: true })

const ENTRY_ID = 'entry-fixture-1'
const NOW = new Date('2026-06-22T00:00:00.000Z')
const source = execSync('git rev-parse HEAD').toString().trim()

const s = maskedSource(maskedBrand('yise'))
const payload = buildPayload({
	certId: s.certId,
	subject: { ...s.subject, platform: 'builder', externalId: ENTRY_ID },
	facts: assembleCertFacts(s),
	lifecycle: s.lifecycle,
})
// Production photos are all on CertREV's asset host (prod read 2026-10-21: 76 of 76 expert photo_url values on
// https://assets.certrev.com); the masked fixture's example.test host is replaced so the documents fetch what production does.
const realHosts = {
	...payload.content,
	expert: { ...payload.content.expert, photoUrl: 'https://assets.certrev.com/fixtures/masked-reviewer.jpg' },
	author: { ...(payload.content.author as object), photoUrl: 'https://assets.certrev.com/fixtures/masked-author.jpg' },
} as typeof payload.content
const { faceDigest: _none, ...content } = realHosts as typeof payload.content & { faceDigest?: unknown }

function savedDef(label: string, v: number) {
	const def = SAVED_DEFS.find((d) => d.label === label)
	if (!def) throw new Error(`no saved def ${label}`)
	const { label: _l, ...rest } = def
	const verdict = assertCompliantRender(rest)
	if (!verdict.ok || !verdict.resolved) throw new Error(`saved def ${label} is not compliant`)
	return projectRenderDef(rest, verdict.resolved, v)
}

const cases: { name: string; renderDef: ReturnType<typeof readerDef> | null }[] = [
	{
		name: 'banner-elf-like',
		renderDef: { ...readerDef({ accentColor: '#000000' }, ['reviewerPhoto'], 'banner'), v: 7 },
	},
	{
		name: 'sidebar-elf-like',
		renderDef: { ...readerDef({ accentColor: '#000000' }, ['reviewerPhoto'], 'sidebar'), v: 7 },
	},
	{
		name: 'floating-elf-like',
		renderDef: { ...readerDef({ accentColor: '#000000' }, ['reviewerPhoto'], 'floating'), v: 7 },
	},
	{ name: 'sidebar-saved-3-toned', renderDef: savedDef('saved-3', 3) },
	{ name: 'banner-no-def', renderDef: null },
]

for (const c of cases) {
	const card = buildCardDocument({
		certId: payload.certId,
		subject: { platform: 'builder', externalId: ENTRY_ID },
		content: realHosts,
		lifecycle: payload.lifecycle,
		renderDef: c.renderDef,
		now: NOW,
	})
	if (!card) throw new Error(`case ${c.name}: the face paints nothing`)
	const body = {
		source: `CertREV/portal v1-core ${source} (lead mission certrev-0a99cc1c5bef), buildCardDocument`,
		case: c.name,
		now: NOW.toISOString(),
		certId: payload.certId,
		subject: payload.subject,
		content,
		lifecycle: payload.lifecycle,
		renderDef: c.renderDef,
		card,
		doc: cardDocumentDigest(card),
	}
	const file = path.join(out, `${c.name}.json`)
	writeFileSync(file, `${JSON.stringify(body, null, '\t')}\n`)
	console.log(
		file,
		JSON.stringify(body).length,
		'bytes',
		Object.keys(card.parts).join('+'),
		Object.keys(card.dialogs).join('+'),
	)
}
