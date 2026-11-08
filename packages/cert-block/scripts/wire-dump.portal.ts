/**
 * Generates cert-block 2.0's real-wire fixtures from the lead's server core (`wire-builder-delivery.json`,
 * `wire-keyset.json` in `src/builder/__tests__/__fixtures__/contract-v1/`): one Builder Delivery 200 whose envelope the
 * REAL placer minted (`placeBuilderCertEnvelope`, a brand holding `cert_card_contract_v1`, a saved design that hides the
 * reviewer photo), the published key set as `signCertKeySet` builds and signs it (the root kid, a test root key standing
 * in for KMS), the same delivery signed by the set's rotated test key, and the real `TRUSTED_KMS_KEYS` set, unsigned, so
 * cert-kit checks its baked root against it.
 *
 * It imports the PORTAL's modules (`@/...`) and its integration database, so it runs inside a CertREV/portal checkout
 * that has the core (lead mission certrev-0a99cc1c5bef), never here: copy it to
 * `src/server/routes/public/__tests__/<name>.integration.test.ts` and run
 *   S1_WIRE_OUT=<file> npx vitest run --project integration <that file>
 * then split `<file>` into the two fixtures (`delivery` into wire-builder-delivery.json, the rest into wire-keyset.json).
 * Every key is generated per run; no private key is written out.
 */

import { generateKeyPairSync } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { localEd25519Signer, signPayloadEd25519 } from '@certrev/cert-contract/signer'
import { Hono } from 'hono'
import { expect, it, vi } from 'vitest'
import type { AssembleCertMintSourceInput } from '@/lib/cert-delivery/assemble-cert-mint-source'
import { buildCertKeySet, KEYSET_ISSUED_AT, signCertKeySet } from '@/lib/cert-delivery/keyset'
import { placeBuilderCertEnvelope } from '@/lib/cert-delivery/place-envelope'
import { CERT_ENVELOPE_KID, CERT_ROOT_KID } from '@/lib/cert-delivery/signer'
import { TRUSTED_KMS_KEYS } from '@/lib/cert-delivery/trusted-keys'
import { Feature } from '@/lib/entitlements/features'
import type { AppEnv } from '@/server/types'
import { setBrandEntitlement } from '@/services/brands/entitlements'
import { setBrandRenderDef } from '@/services/brands/render-defs'
import { seedBrandProfile } from '@/test/integration/factories'

vi.mock('@/server/middleware/rate-limit', () => ({
	rateLimit: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))

import { certDeliveryRoutes } from '../cert-delivery'

const app = new Hono<AppEnv>().route('/', certDeliveryRoutes)

const envelopeKey = generateKeyPairSync('ed25519')
const rotatedKey = generateKeyPairSync('ed25519')
const pem = (k: ReturnType<typeof generateKeyPairSync>) =>
	k.publicKey.export({ type: 'spki', format: 'pem' }).toString()

const SPACE = 'space_s1_wire'

function sourceInput(externalId: string, certId: string): AssembleCertMintSourceInput {
	return {
		certId,
		platform: 'builder',
		logicalArticleId: `art_${externalId}`,
		externalId,
		canonicalUrl: 'https://brand.example/blogs/news/post',
		installationRef: SPACE,
		contentDigest: 'a'.repeat(64),
		submissionId: `sub_${externalId}`,
		articleTitle: 'Integration Test Article',
		expert: {
			displayName: 'Dr. Jane Doe',
			expertCredentials: [
				{
					verificationStatus: 'verified',
					physicianDegree: null,
					degreeConfirmedAt: null,
					customType: null,
					credentialNew: { name: 'Doctor of Medicine', abbreviation: 'MD' },
				},
			],
			profileUrl: null,
			photoUrl: 'https://assets.certrev.com/experts/jane-doe.jpg',
		},
		author: { name: 'Author', title: null },
		memo: 'The article states retinol is best started two or three evenings a week; that matches the cited reviews.',
		certifiedAt: '2026-06-20T00:00:00.000Z',
		contentModifiedAt: null,
		expiresAt: null,
		revision: 1,
	} as AssembleCertMintSourceInput
}

it('S1 wire dump at 66ff75e4e1: a real placer-minted Builder 200 and the signed key set', async () => {
	const brand = await seedBrandProfile()
	const def = await setBrandRenderDef(
		brand.id,
		{
			tokenOverrides: { accentColor: '#123456' },
			fieldVisibility: { hidden: ['reviewerPhoto'] },
			custom_layout: null,
		} as never,
		{ source: 'admin', actorEmail: 'owen@certrev.com' },
	)
	expect((def as { violations?: unknown }).violations ?? []).toEqual([])
	await setBrandEntitlement({
		brandId: brand.id,
		feature: Feature.CERT_CARD_CONTRACT_V1,
		granted: true,
		actor: 'owen@certrev.com',
		reason: 'S1 wire dump (scratch)',
	} as never)
	const externalId = `entry${crypto.randomUUID().replaceAll('-', '')}`
	const certId = `cert_${externalId}`
	const placed = await placeBuilderCertEnvelope(
		{
			certificationId: certId,
			sourceInput: sourceInput(externalId, certId),
			brandProfileId: brand.id,
			externalSiteId: SPACE,
		},
		{ signer: localEd25519Signer(envelopeKey.privateKey) },
	)
	expect(placed).toEqual({ ok: true })
	const res = await app.request(`/v1/delivery/builder/${encodeURIComponent(externalId)}`)
	expect(res.status).toBe(200)
	const body = Buffer.from(await res.arrayBuffer()).toString('utf8')
	const parsed = JSON.parse(body) as {
		payload: { content: { faceDigest?: Record<string, unknown> } }
		signature: Record<string, unknown>
		card: unknown
	}
	expect(parsed.payload.content.faceDigest).toMatchObject({ v: 1, contract: 1 })
	expect(parsed.card).not.toBeNull()

	const keys = { [CERT_ROOT_KID]: pem(envelopeKey), 'cert-issuer-2': pem(rotatedKey) }
	const signedSet = await signCertKeySet(buildCertKeySet(keys, KEYSET_ISSUED_AT), {
		signer: localEd25519Signer(envelopeKey.privateKey),
		kid: CERT_ROOT_KID,
	})
	const realSet = buildCertKeySet()
	// The same delivery as a client meets it after a rotation: the payload the placer minted, signed by the rotated key
	// the published set lists (the signature covers the payload only).
	const rotatedBody = JSON.stringify({
		...parsed,
		signature: {
			...parsed.signature,
			kid: 'cert-issuer-2',
			sig: signPayloadEd25519(parsed.payload as never, rotatedKey.privateKey),
		},
	})

	const out = process.env.S1_WIRE_OUT
	if (!out) throw new Error('S1_WIRE_OUT')
	writeFileSync(
		out,
		`${JSON.stringify(
			{
				source:
					'CertREV/portal 66ff75e4e118628cf25c58ba2f3fb8d2c70cef08 (lead mission certrev-0a99cc1c5bef): placeBuilderCertEnvelope with cert_card_contract_v1 granted, GET /api/cert/v1/delivery/builder/<entry>; signCertKeySet(buildCertKeySet(test keys)) under the root kid; buildCertKeySet() over TRUSTED_KMS_KEYS',
				delivery: {
					externalId,
					kid: CERT_ENVELOPE_KID,
					publicKeyPem: pem(envelopeKey),
					etag: res.headers.get('ETag'),
					body,
				},
				keySet: {
					body: signedSet,
					rootKid: CERT_ROOT_KID,
					rootPublicKeyPem: pem(envelopeKey),
					rotatedKid: 'cert-issuer-2',
					rotatedDeliveryBody: rotatedBody,
				},
				trustedKeySet: realSet,
				trustedRootPem: TRUSTED_KMS_KEYS[CERT_ROOT_KID],
			},
			null,
			'\t',
		)}\n`,
	)
})
