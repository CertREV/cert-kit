/** Unit tests for the pure cert-modal view: envelope → dialog HTML. */

import { describe, expect, it } from "vitest";
import {
	CERTREV_MODAL_LINK_REL,
	type CertModalContent,
	deriveInitials,
	renderCertDialogInner,
	renderExpertDialogInner,
	safeHref,
	signatureName,
	stripProtocol,
} from "./cert-modal-view.js";
import { CERT_SCOPE_LINE, COMPENSATED_EXPERT_CUE } from "./display-strings.js";
import { escapeHtml } from "./escape.js";

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

describe("FTC disclosure footer", () => {
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

/** Feed the renderers a payload the TYPES forbid — exactly what a signed-but-unshaped envelope does. */
const hostile = (content: unknown) => content as CertModalContent;
/** Same, one level down: `escapeHtml`'s declared input is text, its real input is whatever parsed. */
const escapeAnything = (input: unknown) => escapeHtml(input as string);

describe("modal escapeHtml", () => {
	// The BYTES are frozen: this module is a relocation of portal's `html.ts`, which encodes the
	// apostrophe as `&#039;` where `../components/escape.ts` encodes it as `&#39;`. A guard may not
	// move a single character of a well-formed string's output — that is the file's whole purpose.
	it("is byte-identical for a well-formed string, apostrophe as &#039;", () => {
		expect(escapeHtml(`Tom & Jerry's <b>"big"</b> day`)).toBe(
			"Tom &amp; Jerry&#039;s &lt;b&gt;&quot;big&quot;&lt;/b&gt; day",
		);
		expect(escapeHtml("'")).toBe("&#039;"); // NOT the components copy's `&#39;`
		expect(escapeHtml("'")).not.toContain("&#39;s"); // guards against a stray shortening
		expect(escapeHtml("")).toBe("");
		expect(escapeHtml("plain text")).toBe("plain text");
		// `&` runs first, so an entity the later passes introduce is never double-escaped.
		expect(escapeHtml("&amp;")).toBe("&amp;amp;");
	});

	// The TYPES are hostile: the modal escapes values off a JSON.parse'd envelope whose signature
	// was checked, never its shape. A TypeError here takes the whole dialog down in the browser.
	it("never throws on a value that is not text", () => {
		expect(escapeAnything(undefined)).toBe("");
		expect(escapeAnything(null)).toBe("");
		expect(escapeAnything({ toString: () => "<script>" })).toBe("");
		expect(escapeAnything(["<a>", "<b>"])).toBe("");
		expect(escapeAnything(true)).toBe("");
		expect(escapeAnything(Object.create(null))).toBe("");
	});

	it("renders a finite number as its digits (a stray count is at least legible copy)", () => {
		expect(escapeAnything(42)).toBe("42");
		expect(escapeAnything(0)).toBe("0");
		expect(escapeAnything(Number.NaN)).toBe("");
		expect(escapeAnything(Number.POSITIVE_INFINITY)).toBe("");
	});
});

describe("CertREV link qualification (E11)", () => {
	// Both modal CTAs point at a CertREV property from a customer's page — a vendor-placed link,
	// which Google's link-spam policy requires be qualified. `noreferrer` stays: these are
	// `target="_blank"`, where it still earns its place.
	it("the constant carries nofollow + sponsored alongside the window hardening", () => {
		expect(CERTREV_MODAL_LINK_REL.split(" ").sort()).toEqual([
			"nofollow",
			"noopener",
			"noreferrer",
			"sponsored",
		]);
	});

	for (const [label, render] of [
		["certificate (3a) → verifyUrl", renderCertDialogInner],
		["reviewer (4b) → profileUrl", renderExpertDialogInner],
	] as const) {
		it(`${label} is qualified nofollow + sponsored`, () => {
			const html = render(FULL) ?? "";
			expect(html).toContain(`rel="${CERTREV_MODAL_LINK_REL}"`);
			expect(html).not.toContain('rel="noopener noreferrer"'); // the unqualified shape is gone
			expect(html).toContain('target="_blank"');
		});
	}
});

describe("shape + type tolerance (signed ≠ shaped)", () => {
	for (const [label, render] of [
		["certificate (3a)", renderCertDialogInner],
		["reviewer (4b)", renderExpertDialogInner],
	] as const) {
		it(`${label}: every structural field individually missing`, () => {
			// The renderers fail CLOSED without a name (null), but must never THROW.
			expect(() => render(hostile({}))).not.toThrow();
			expect(() => render(hostile({ ...FULL, expert: undefined }))).not.toThrow();
			expect(() => render(hostile({ ...FULL, display: undefined }))).not.toThrow();
			expect(() =>
				render(hostile({ ...FULL, expert: { ...FULL.expert, credentials: undefined } })),
			).not.toThrow();
			// `author` is the envelope's OTHER person block; the modal never reads it, and an
			// absent one must not change a byte of the dialog.
			expect(render(hostile({ ...FULL, author: undefined }))).toBe(render(FULL));
		});

		it(`${label}: a non-string where the contract promised a string`, () => {
			expect(() =>
				render(hostile({ ...FULL, expert: { ...FULL.expert, displayName: 42 } })),
			).not.toThrow();
			expect(() => render(hostile({ ...FULL, articleTitle: { t: 1 } }))).not.toThrow();
			expect(() => render(hostile({ ...FULL, displayCertId: ["CR"] }))).not.toThrow();
			expect(() => render(hostile({ ...FULL, verifyUrl: 7 }))).not.toThrow();
			expect(() =>
				render(hostile({ ...FULL, expert: { ...FULL.expert, photoUrl: 3, bio: 1, background: {} } })),
			).not.toThrow();
			expect(() =>
				render(hostile({ ...FULL, expert: { ...FULL.expert, compensationCue: 5 } })),
			).not.toThrow();
			// A credentials array carrying holes, and a `credentials` that is not an array at all —
			// `for…of` over a bare object is itself a TypeError.
			expect(() =>
				render(hostile({ ...FULL, expert: { ...FULL.expert, credentials: [null, { cardLabel: 9 }] } })),
			).not.toThrow();
			expect(() =>
				render(hostile({ ...FULL, expert: { ...FULL.expert, credentials: { a: 1 } } })),
			).not.toThrow();
			// The expert block itself replaced by a scalar — `expert?.x` is fine, the reads below it are not.
			expect(() => render(hostile({ ...FULL, expert: "Dr. Erik" }))).not.toThrow();
		});
	}

	it("a non-string url does not throw through safeHref / stripProtocol", () => {
		expect(safeHref(7 as unknown as string)).toBe("#");
		expect(safeHref({} as unknown as string)).toBe("#");
		expect(stripProtocol(7 as unknown as string)).toBe("7");
		expect(deriveInitials(7 as unknown as string)).toBe("7");
		expect(signatureName(null as unknown as string)).toBe("");
	});
});
