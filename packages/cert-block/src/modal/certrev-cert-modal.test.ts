// @vitest-environment jsdom
/**
 * Unit tests — the `<certrev-cert-modal>` kill-switch decision (POR-10101 / POR-10684).
 *
 * `isArtifactSuppressed` is the modal-side lifecycle gate: a fetched Delivery-API artifact that is
 * REVOKED (the slim `CertTombstone` OR a legacy envelope with `revokedAt` set) or EXPIRED must NOT
 * render "verified" content. The route-integration + control-plane tests prove the tombstone is
 * SERVED and cryptographically verifies to `suppress:'revoked'`; this pins the modal's consumption
 * of it — including the SLIM tombstone (no payload), which a `payload.lifecycle` read alone would
 * miss so `markSuppressed()` would never fire (POR-10684).
 */

import type {
	CertDeliveryArtifact,
	CertDeliveryEnvelope,
	CertTombstone,
} from "@certrev/cert-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CERT_MODAL_TAG, isArtifactSuppressed } from "./certrev-cert-modal.js";

function envelope(
	lifecycle: Partial<CertDeliveryEnvelope["payload"]["lifecycle"]>,
): CertDeliveryEnvelope {
	// Only `lifecycle` matters to the gate; the rest is filler cast through `unknown`.
	return {
		payload: {
			lifecycle: {
				issuedAt: "2026-01-01T00:00:00.000Z",
				expiresAt: "2099-01-01T00:00:00.000Z",
				revokedAt: null,
				revision: 1,
				...lifecycle,
			},
		},
		signature: {},
	} as unknown as CertDeliveryEnvelope;
}

/** A SLIM revocation tombstone (POR-10481): `kind: 'tombstone'`, subject + revocation facts, NO payload. */
function tombstone(): CertTombstone {
	return {
		kind: "tombstone",
		contractVersion: 1,
		subject: { platform: "shopify", externalId: "gid://shopify/Article/12345" },
		revokedAt: "2026-06-20T00:00:00.000Z",
		revocationReason: "cert_revoked",
		signature: { alg: "ed25519", kid: "cert-issuer-1", value: "x".repeat(86) },
	} as unknown as CertTombstone;
}

describe("isArtifactSuppressed (modal kill-switch)", () => {
	it("a live envelope (not revoked, not expired) → NOT suppressed", () => {
		expect(isArtifactSuppressed(envelope({}))).toBe(false);
	});

	it('a SLIM tombstone (kind: "tombstone", no payload) → suppressed (POR-10684)', () => {
		// The whole point of POR-10684: a slim tombstone has NO `payload.lifecycle`, so the old
		// payload-only read returned false and markSuppressed() never fired. `isTombstone` catches it.
		expect(isArtifactSuppressed(tombstone())).toBe(true);
	});

	it("a REVOKED envelope (legacy: revokedAt set) → suppressed", () => {
		expect(
			isArtifactSuppressed(envelope({ revokedAt: "2026-06-20T00:00:00.000Z" })),
		).toBe(true);
	});

	it("an EXPIRED envelope (expiresAt in the past) → suppressed", () => {
		expect(
			isArtifactSuppressed(envelope({ expiresAt: "2020-01-01T00:00:00.000Z" })),
		).toBe(true);
	});

	it("a missing/malformed artifact → NOT suppressed (fail-open; the 404 path handles absence)", () => {
		expect(isArtifactSuppressed(null)).toBe(false);
		expect(isArtifactSuppressed(undefined)).toBe(false);
		expect(
			isArtifactSuppressed({ payload: {} } as unknown as CertDeliveryArtifact),
		).toBe(false);
	});
});

describe("<certrev-cert-modal> markSuppressed on a fetched slim tombstone (POR-10684)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		document.body.innerHTML = "";
	});

	it("a fetched slim tombstone → marks the host suppressed AND hides the light-DOM triggers", async () => {
		// The Delivery API serves a slim tombstone (200, kind: 'tombstone', no payload). Before
		// POR-10684 the modal read `payload.lifecycle`, missed it, and never called markSuppressed().
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					({ ok: true, json: async () => tombstone() }) as unknown as Response,
			),
		);

		const el = document.createElement(CERT_MODAL_TAG) as HTMLElement & {
			open(kind: "cert" | "expert"): boolean;
		};
		el.setAttribute("data-delivery-api", "https://portal.certrev.com");
		el.setAttribute("data-platform", "shopify");
		el.setAttribute("data-external-id", "gid://shopify/Article/12345");
		el.setAttribute("data-fonts", "host"); // skip document-level font injection in the test
		document.body.appendChild(el);

		const trigger = document.createElement("a");
		trigger.setAttribute("data-certrev-modal-open", "cert");
		document.body.appendChild(trigger);

		const handled = el.open("cert");
		expect(handled).toBe(true); // it has a fetch source, so it takes over the open
		// The open() kicks off an un-awaited fetch; await the private in-flight promise it stored.
		await (el as unknown as { fetchInFlight: Promise<void> | null })
			.fetchInFlight;

		expect(el.hasAttribute("data-certrev-suppressed")).toBe(true);
		expect(trigger.hasAttribute("hidden")).toBe(true);
		expect(trigger.getAttribute("aria-hidden")).toBe("true");
		// A revoked cert never renders a dialog.
		expect(el.shadowRoot?.querySelector("dialog")).toBeNull();
	});
});
