/**
 * Legacy-face ORACLE: regenerates `src/builder/__tests__/__golden__/envelope-face-1.1.1.json` from the source of
 * @certrev/cert-block 1.1.1 itself (tag `cert-block@1.1.1`, commit 816b288), NOT from this tree, so the golden answers
 * "what did 1.1.1 paint for this def?" however this tree changes. Run it only to add cases; the golden's own test
 * (`src/builder/__tests__/legacy-face-1.1.1.test.tsx`) never calls it.
 *
 *   git -C <cert-kit repo> archive 816b288 packages/cert-block/src | tar -x -C <dir>
 *   ln -s <this package>/node_modules <dir>/packages/cert-block/node_modules
 *   CERT_BLOCK_111=<dir>/packages/cert-block node node_modules/vitest/vitest.mjs run \
 *     --config scripts/legacy-golden/vitest.config.ts
 *
 * For each case in `legacy-face-cases.ts` it runs 1.1.1's `parseRenderDef` -> `envelopeCardInput` -> `renderCertBlock`
 * and records the parsed def (what 1.1.1 kept of the raw def) and the card HTML with its sha256 and byte count.
 */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { CONTENTS, LEGACY_CASES, OPTION_SETS, RAW_DEFS } from '../../src/builder/__tests__/legacy-face-cases.js'

const ROOT = process.env.CERT_BLOCK_111
const OUT = fileURLToPath(new URL('../../src/builder/__tests__/__golden__/envelope-face-1.1.1.json', import.meta.url))

it('writes what cert-block 1.1.1 paints for every legacy case', async () => {
	expect(ROOT, 'CERT_BLOCK_111 must name an extracted cert-block@1.1.1 package dir').toBeTruthy()
	const { parseRenderDef } = await import(`${ROOT}/src/verify/get-verified-delivery.ts`)
	const { envelopeCardInput } = await import(`${ROOT}/src/builder/envelope-face.ts`)
	const { renderCertBlock } = await import(`${ROOT}/src/components/render-cert-block.ts`)
	const parsed: Record<string, unknown> = {}
	for (const [name, raw] of Object.entries(RAW_DEFS)) parsed[name] = parseRenderDef(raw)
	const cases: Record<string, { bytes: number; sha256: string; html: string }> = {}
	for (const c of LEGACY_CASES) {
		const input = envelopeCardInput(CONTENTS[c.content], parsed[c.def], OPTION_SETS[c.options])
		const html = input ? renderCertBlock(input) : ''
		cases[c.id] = { bytes: Buffer.byteLength(html), sha256: createHash('sha256').update(html).digest('hex'), html }
	}
	writeFileSync(
		OUT,
		`${JSON.stringify({ generatedFrom: '@certrev/cert-block@1.1.1 (tag cert-block@1.1.1, commit 816b288)', parsed, cases }, null, '\t')}\n`,
	)
})
