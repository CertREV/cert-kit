/**
 * End-to-end test of the Web Component's Delivery-API verifier with REAL crypto: mint a signed
 * artifact (local Ed25519), stub `fetch` to serve it, and assert createDeliveryVerifier runs the
 * canonical `verifyArtifact` kernel correctly — render on a good envelope, suppress on a subject
 * mismatch, `suppress:'revoked'` on the SLIM `CertTombstone` (POR-10684 / POR-10481), throw on a
 * 404 (→ the DOM layer keeps the SSR badge). Proves the fetch + URL + verify wiring the
 * unit-mocked revalidate.test.ts stubs out.
 */

import { generateKeyPairSync } from "node:crypto";
import type {
	CertSubject,
	ResolvePublicKeyByKid,
} from "@certrev/cert-contract";
import {
	localEd25519Signer,
	signTombstone,
} from "@certrev/cert-contract/signer";
import { describe, expect, it, vi } from "vitest";
// Relocated from portal (POR-10721 W2): mint a valid signed envelope with the package's
// own fixture (cert-contract-native) instead of portal's `mintCertEnvelope` — the modal
// package must not depend on portal for its tests.
import { makeSignedEnvelope } from "../contract/fixtures.js";
import { createDeliveryVerifier } from "./verify-client.js";

const KID = "test-issuer";
const ARTICLE_GID = "gid://shopify/Article/12345";

function signerFor() {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const pem = publicKey.export({ type: "spki", format: "pem" }) as string;
	const resolveKid: ResolvePublicKeyByKid = (k) =>
		k === KID ? { format: "pem", pem } : null;
	return { resolveKid, sign: localEd25519Signer(privateKey) };
}

function subjectFor(externalId = ARTICLE_GID): CertSubject {
	return {
		platform: "shopify",
		externalId,
		logicalArticleId: "art_wc_test",
		canonicalUrls: ["https://brand.example.com/blogs/news/post"],
		installationId: null,
		contentDigest: "a".repeat(64),
	};
}

function stubFetch(envelopeJson: unknown, ok = true, status = 200) {
	return vi.fn(
		async () =>
			({ ok, status, json: async () => envelopeJson }) as unknown as Response,
	);
}

describe("createDeliveryVerifier", () => {
	it("fetches the Delivery API URL and returns `render` for a valid served envelope", async () => {
		// Envelope bound to ARTICLE_GID — the article we ask to verify → render.
		const { envelope, resolveKid } = makeSignedEnvelope({
			subject: subjectFor(),
		});
		const fetchImpl = stubFetch(envelope);
		const verify = createDeliveryVerifier(
			resolveKid,
			fetchImpl as unknown as typeof fetch,
		);

		const verdict = await verify({
			baseUrl: "https://portal.certrev.com/",
			platform: "shopify",
			externalId: ARTICLE_GID,
		});

		expect(verdict.decision).toBe("render");
		expect(fetchImpl).toHaveBeenCalledWith(
			`https://portal.certrev.com/api/cert/v1/delivery/shopify/${encodeURIComponent(ARTICLE_GID)}`,
			expect.objectContaining({ headers: { accept: "application/json" } }),
		);
	});

	it("returns a `suppress` verdict when the served envelope is bound to a different article", async () => {
		// Envelope minted for a DIFFERENT article than the one we ask to verify.
		const { envelope, resolveKid } = makeSignedEnvelope({
			subject: subjectFor("gid://shopify/Article/99999"),
		});
		const verify = createDeliveryVerifier(
			resolveKid,
			stubFetch(envelope) as unknown as typeof fetch,
		);

		const verdict = await verify({
			baseUrl: "https://portal.certrev.com",
			platform: "shopify",
			externalId: ARTICLE_GID,
		});

		expect(verdict.decision).toBe("suppress");
	});

	it('resolves the SLIM tombstone the control plane serves to `suppress:"revoked"` (POR-10684)', async () => {
		const { resolveKid, sign } = signerFor();
		// The revoked-placement Delivery response: a slim `CertTombstone` (kind: 'tombstone', NO
		// payload) — what verifyEnvelope used to mis-suppress as 'unsupported_contract_version'.
		const artifact = await signTombstone(
			{
				subject: subjectFor(),
				revokedAt: "2026-06-20T00:00:00.000Z",
				revocationReason: "cert_revoked",
			},
			{ kid: KID, sign },
		);
		const verify = createDeliveryVerifier(
			resolveKid,
			stubFetch(artifact) as unknown as typeof fetch,
		);

		const verdict = await verify({
			baseUrl: "https://portal.certrev.com",
			platform: "shopify",
			externalId: ARTICLE_GID,
		});

		expect(verdict.decision).toBe("suppress");
		expect(verdict.decision === "suppress" && verdict.reason).toBe("revoked");
	});

	it("suppresses a tombstone minted for a DIFFERENT article (subject binding enforced)", async () => {
		const { resolveKid, sign } = signerFor();
		const artifact = await signTombstone(
			{
				subject: subjectFor("gid://shopify/Article/99999"),
				revokedAt: "2026-06-20T00:00:00.000Z",
				revocationReason: "cert_revoked",
			},
			{ kid: KID, sign },
		);
		const verify = createDeliveryVerifier(
			resolveKid,
			stubFetch(artifact) as unknown as typeof fetch,
		);

		const verdict = await verify({
			baseUrl: "https://portal.certrev.com",
			platform: "shopify",
			externalId: ARTICLE_GID,
		});

		expect(verdict.decision).toBe("suppress");
	});

	it("throws on a non-2xx Delivery API response (404 → caller keeps the SSR badge)", async () => {
		const { resolveKid } = signerFor();
		const verify = createDeliveryVerifier(
			resolveKid,
			stubFetch(null, false, 404) as unknown as typeof fetch,
		);
		await expect(
			verify({
				baseUrl: "https://portal.certrev.com",
				platform: "shopify",
				externalId: ARTICLE_GID,
			}),
		).rejects.toThrow();
	});
});
