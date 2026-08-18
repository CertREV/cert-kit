/** Unit tests for the modal's display strings + date formatter. */

import { describe, expect, it } from "vitest";
import {
	CERT_SCOPE_LINE,
	COMPENSATED_EXPERT_CUE,
	formatCertDisplayDate,
} from "./display-strings.js";
import { FTC_DISCLOSURE_LINE } from "./ftc-disclosure.js";

describe("the two locked strings", () => {
	it("are byte-verbatim portal copy", () => {
		expect(COMPENSATED_EXPERT_CUE).toBe("Compensated expert");
		// Re-exported from the FTC source of truth, never re-typed: a reword lands in one place.
		expect(CERT_SCOPE_LINE).toBe(FTC_DISCLOSURE_LINE);
		// The curly apostrophe (U+2019) is part of the verbatim disclosure the guard compares against.
		expect(CERT_SCOPE_LINE).toContain("’");
		expect(CERT_SCOPE_LINE).not.toContain("'");
	});
});

describe("formatCertDisplayDate — the well-formed path is pinned", () => {
	// This is the "Issued" row of a compliance-facing certificate. The output below is the exact
	// string the deployed modal renders; if a change here moves it, the change is wrong.
	it("renders an ISO instant as en-US short month, UTC-pinned", () => {
		expect(formatCertDisplayDate("2026-06-14T00:00:00.000Z")).toBe("Jun 14, 2026");
		expect(formatCertDisplayDate("2026-04-14T00:00:00.000Z")).toBe("Apr 14, 2026");
	});

	it("stays on the UTC day for an instant that is a different day locally", () => {
		// 23:30Z would be Jun 15 in Sydney and Jun 14 in Los Angeles; the card says Jun 14 everywhere.
		expect(formatCertDisplayDate("2026-06-14T23:30:00.000Z")).toBe("Jun 14, 2026");
		expect(formatCertDisplayDate("2026-06-14T00:30:00.000Z")).toBe("Jun 14, 2026");
	});

	it("accepts a Date instance, valid or not", () => {
		expect(formatCertDisplayDate(new Date("2026-06-14T00:00:00.000Z"))).toBe("Jun 14, 2026");
		expect(formatCertDisplayDate(new Date("nope"))).toBeNull();
	});
});

describe("formatCertDisplayDate — a malformed value renders NOTHING, never a wrong date", () => {
	// `certifiedAt` reaches this helper off a `JSON.parse(...) as` cast that checked the signature
	// and never the shape, so every one of these can actually arrive. The Date constructor coerces
	// all of them; the helper must not.
	it.each([
		["undefined", undefined],
		["null", null],
		["an empty string", ""],
		["an unparseable string", "not-a-date"],
		["a number (epoch-ms-shaped)", 1750000000000],
		["a small number", 42],
		["a boolean", true],
		["an object", { certifiedAt: "2026-06-14" }],
		["an empty array", []],
		["a one-element array that stringifies to a year", [2026]],
	])("%s → null", (_label, input) => {
		expect(formatCertDisplayDate(input as never)).toBeNull();
	});

	it("does not invent 1970 from a number", () => {
		// The defect this guard closes: `new Date(42)` is 42ms after the epoch, so the certificate's
		// "Issued" row read "Jan 1, 1970" — a confident, wrong, compliance-facing date.
		const rendered = formatCertDisplayDate(42 as never) ?? "";
		expect(rendered).not.toContain("1970");
		expect(rendered).toBe("");
	});

	// The guard is on the TYPE, not the value — deliberately, and identically to
	// `../components/format.ts`'s `formatDate`: both hand string parsing to the engine, so a
	// numeric STRING still parses as a year. Pinned so the shared limitation is visible rather
	// than surprising.
	it("a numeric string still parses as a year, exactly as formatDate does", () => {
		expect(formatCertDisplayDate("42")).toBe("Jan 1, 2042");
	});
});
