// @vitest-environment jsdom
/**
 * Unit tests for the Shopify cert-badge Web-Component revalidation DOM layer — the fail-closed
 * (suppress → hide) / fail-open (404|offline → keep SSR) behavior, driven with a mocked verdict
 * (no network), plus the key-sync cross-check guarding the browser-bundled public key against
 * signer.ts drift.
 */

import type { CertVerdict } from "@certrev/cert-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type RevalidateDeps, revalidateBadge } from "./revalidate.js";

// NOTE (POR-10721 W2): the "published key sync" cross-check that lived here — asserting the
// browser-bundled `CERT_ISSUER_*` (certrev-cert.entry.ts) equals portal's signer
// `CERT_ENVELOPE_*` — is a CROSS-REPO guard and cannot run in this package (there is no portal
// signer to compare against). It stays a PORTAL-side test: once portal re-points at the published
// package, portal asserts `@certrev/cert-block/modal`'s exported CERT_ISSUER_* == its own
// signer's CERT_ENVELOPE_*. The package exports CERT_ISSUER_* from the modal barrel for exactly
// that consumer-side assertion.

/** Build a `<certrev-badge revalidate>` host wrapping an SSR `.certrev-badge`. */
function mountHost(attrs: Record<string, string> = {}): Element {
	const host = document.createElement("certrev-badge");
	host.setAttribute("revalidate", "");
	host.setAttribute("data-delivery-api", "https://portal.certrev.com");
	host.setAttribute("data-external-id", "gid://shopify/Article/12345");
	host.setAttribute("data-platform", "shopify");
	for (const [k, v] of Object.entries(attrs)) {
		if (v === "") host.removeAttribute(k);
		else host.setAttribute(k, v);
	}
	host.innerHTML =
		'<section class="certrev-badge">Reviewed by Dr. Jane Doe</section>';
	document.body.appendChild(host);
	return host;
}

function depsReturning(verdict: CertVerdict): {
	deps: RevalidateDeps;
	spy: ReturnType<typeof vi.fn>;
} {
	const spy = vi.fn(async () => verdict);
	return { deps: { verify: spy as RevalidateDeps["verify"] }, spy };
}

beforeEach(() => {
	document.body.innerHTML = "";
});

describe("revalidateBadge", () => {
	it("leaves the SSR badge visible on a `render` verdict", async () => {
		const host = mountHost();
		const { deps } = depsReturning({
			decision: "render",
			payload: {},
		} as unknown as CertVerdict);
		await revalidateBadge(host, deps);
		expect(host.querySelector(".certrev-badge")!.hasAttribute("hidden")).toBe(
			false,
		);
	});

	it("HIDES the SSR badge on a `suppress` verdict (fail-closed)", async () => {
		const host = mountHost();
		const { deps } = depsReturning({ decision: "suppress", reason: "revoked" });
		await revalidateBadge(host, deps);
		const badge = host.querySelector(".certrev-badge")!;
		expect(badge.hasAttribute("hidden")).toBe(true);
		expect(badge.getAttribute("data-certrev-suppressed")).toBe("revoked");
	});

	it("leaves the SSR badge when verify throws (404 / offline → never a new failure mode)", async () => {
		const host = mountHost();
		const deps: RevalidateDeps = {
			verify: vi.fn(async () => {
				throw new Error("cert delivery 404");
			}) as RevalidateDeps["verify"],
		};
		await revalidateBadge(host, deps);
		expect(host.querySelector(".certrev-badge")!.hasAttribute("hidden")).toBe(
			false,
		);
	});

	it("does not call verify when routing attributes are missing", async () => {
		const host = mountHost({ "data-external-id": "" });
		const { deps, spy } = depsReturning({
			decision: "suppress",
			reason: "revoked",
		});
		await revalidateBadge(host, deps);
		expect(spy).not.toHaveBeenCalled();
		expect(host.querySelector(".certrev-badge")!.hasAttribute("hidden")).toBe(
			false,
		);
	});

	it("passes the host routing attributes through to verify", async () => {
		const host = mountHost();
		const { deps, spy } = depsReturning({
			decision: "suppress",
			reason: "expired",
		});
		await revalidateBadge(host, deps);
		expect(spy).toHaveBeenCalledWith({
			baseUrl: "https://portal.certrev.com",
			platform: "shopify",
			externalId: "gid://shopify/Article/12345",
		});
	});
});
