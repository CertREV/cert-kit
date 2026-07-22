/** Unit tests for the pure cert-modal view (POR-10102): envelope → dialog HTML. */

import { describe, expect, it } from "vitest";
import {
	type CertModalContent,
	deriveInitials,
	renderCertDialogInner,
	renderExpertDialogInner,
	safeHref,
	signatureName,
	stripProtocol,
} from "./cert-modal-view.js";
import { CERT_SCOPE_LINE, COMPENSATED_EXPERT_CUE } from "./display-strings.js";

const FULL: CertModalContent = {
	expert: {
		displayName: "Dr. Erik Schraga, MD",
		credentials: [
			{ cardLabel: "Board-Certified" },
			{ cardLabel: "Emergency Medicine" },
		],
		profileUrl: "https://certrev.com/expert/abc",
		photoUrl: null,
		bio: "Short bio.",
		background: "Reviews health content for accuracy and responsible framing.",
	},
	certifiedAt: "2026-04-14T00:00:00.000Z",
	verifyUrl: "https://certrev.com/verify/abc123",
	articleTitle: "Spring Cold or Spring Allergies?",
	displayCertId: "CR-2026-0512",
	display: { showExpertPhoto: false, showBio: true },
};

describe("name helpers", () => {
	it("deriveInitials strips honorific AND post-nominal (ES, not EM)", () => {
		expect(deriveInitials("Dr. Erik Schraga, MD")).toBe("ES");
		expect(deriveInitials("Jane Doe")).toBe("JD");
		expect(deriveInitials("Prof. Ada Lovelace, PhD")).toBe("AL");
		expect(deriveInitials("Madonna")).toBe("MA");
		expect(deriveInitials("")).toBe("");
	});
	it("signatureName is the bare given+family name", () => {
		expect(signatureName("Dr. Erik Schraga, MD")).toBe("Erik Schraga");
		expect(signatureName("Jane Doe")).toBe("Jane Doe");
	});
	it("stripProtocol / safeHref", () => {
		expect(stripProtocol("https://certrev.com/verify/x/")).toBe(
			"certrev.com/verify/x",
		);
		expect(safeHref("https://certrev.com/x")).toBe("https://certrev.com/x");
		expect(safeHref("javascript:alert(1)")).toBe("#");
		expect(safeHref("/relative")).toBe("#");
		expect(safeHref(null)).toBe("#");
	});
});

describe("renderCertDialogInner (3a)", () => {
	it("renders the header, name, creds, article title, cert id, signature, stamp, CTA", () => {
		const html = renderCertDialogInner(FULL) ?? "";
		expect(html).toContain("Certificate of Expert Review");
		expect(html).toContain("Dr. Erik Schraga, MD");
		expect(html).toContain("Board-Certified · Emergency Medicine");
		expect(html).toContain("Spring Cold or Spring Allergies?");
		expect(html).toContain("CR-2026-0512");
		expect(html).toContain(">Erik Schraga<"); // Allura signature = core name
		expect(html).toContain("certrev.com/verify/abc123"); // footer url, protocol stripped
		expect(html).toContain("CERTREV VERIFIED · CERTIFIED"); // the stamp textPath
		expect(html).toContain("View full certificate");
		expect(html).toContain('href="https://certrev.com/verify/abc123"');
	});
	it("fails closed with no reviewer name", () => {
		expect(
			renderCertDialogInner({
				...FULL,
				expert: { ...FULL.expert, displayName: "" },
			}),
		).toBeNull();
		expect(renderCertDialogInner({ ...FULL, expert: null })).toBeNull();
	});
	it('drops the "Certifies the article" block when no title', () => {
		const html = renderCertDialogInner({ ...FULL, articleTitle: null }) ?? "";
		expect(html).not.toContain("Certifies the article");
	});
	it("drops the Certificate ID column when no display id", () => {
		const html = renderCertDialogInner({ ...FULL, displayCertId: null }) ?? "";
		expect(html).not.toContain("Certificate ID");
		expect(html).toContain("Issued"); // other meta cols still present
	});
	it("escapes a hostile reviewer name", () => {
		const html =
			renderCertDialogInner({
				...FULL,
				expert: { ...FULL.expert, displayName: "<script>x</script>" },
			}) ?? "";
		expect(html).not.toContain("<script>x</script>");
		expect(html).toContain("&lt;script&gt;");
	});
});

describe("renderExpertDialogInner (4b)", () => {
	it("renders the header, name, verified credential chips, bio, trust, CTA", () => {
		const html = renderExpertDialogInner(FULL) ?? "";
		expect(html).toContain("Verified reviewer");
		expect(html).toContain("Dr. Erik Schraga, MD");
		expect(html).toContain(">Board-Certified<");
		expect(html).toContain(">Emergency Medicine<");
		expect(html).toContain("Reviews health content for accuracy"); // verified background as bio
		expect(html).toContain("Independently reviewed · Certified Apr 14, 2026");
		expect(html).toContain("View full profile on CertREV");
		expect(html).toContain('href="https://certrev.com/expert/abc"');
	});
	it("NEVER renders an affiliation subtitle (omitted — no data source)", () => {
		const html = renderExpertDialogInner(FULL) ?? "";
		expect(html).not.toContain("crm-id__subtitle");
	});
	it("drops the bio when showBio is false", () => {
		const html =
			renderExpertDialogInner({ ...FULL, display: { showBio: false } }) ?? "";
		expect(html).not.toContain("crm-bio");
	});
	it("renders no chips when there are no credentials", () => {
		const html =
			renderExpertDialogInner({
				...FULL,
				expert: { ...FULL.expert, credentials: [] },
			}) ?? "";
		expect(html).not.toContain("crm-chips");
	});
	it("drops a javascript: profile url to #", () => {
		const html =
			renderExpertDialogInner({
				...FULL,
				expert: { ...FULL.expert, profileUrl: "javascript:alert(1)" },
			}) ?? "";
		expect(html).toContain('href="#"');
		expect(html).not.toContain("javascript:");
	});
	it("fails closed with no reviewer name", () => {
		expect(
			renderExpertDialogInner({
				...FULL,
				expert: { ...FULL.expert, displayName: null },
			}),
		).toBeNull();
	});
});

describe("FTC disclosure footer (POR-10496)", () => {
	const COMPENSATED: CertModalContent = {
		...FULL,
		expert: { ...FULL.expert, compensationCue: COMPENSATED_EXPERT_CUE },
	};
	// A pro-bono reviewer carries no cue (FULL omits `compensationCue`).
	const PRO_BONO = FULL;

	for (const [label, render] of [
		["reviewer (4b)", renderExpertDialogInner],
		["certificate (3a)", renderCertDialogInner],
	] as const) {
		it(`${label}: compensated → the cue label + the scope line`, () => {
			const html = render(COMPENSATED) ?? "";
			expect(html).toContain("crm-disclosure");
			expect(html).toContain("crm-disclosure__cue");
			expect(html).toContain(COMPENSATED_EXPERT_CUE);
			expect(html).toContain(CERT_SCOPE_LINE);
		});
		it(`${label}: pro-bono → the scope line ONLY (no cue label)`, () => {
			const html = render(PRO_BONO) ?? "";
			expect(html).toContain("crm-disclosure"); // footer + scope line always render
			expect(html).toContain(CERT_SCOPE_LINE);
			expect(html).not.toContain("crm-disclosure__cue"); // the "Compensated expert" label is dropped
			expect(html).not.toContain(COMPENSATED_EXPERT_CUE);
		});
	}
});
