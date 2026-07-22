// @vitest-environment jsdom
/**
 * Unit tests for the native FTC disclosure tamper guard (iframe→native parity for the MSA §3
 * anti-stripping kill switch). Pure DOM. The expected text is the single source of truth
 * `FTC_DISCLOSURE_LINE`, so these also pin the guard to the verbatim copy.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { FTC_DISCLOSURE_LINE } from "./ftc-disclosure.js";
import {
	enforceFtcDisclosure,
	FTC_NEUTRALIZED_ATTR,
	installFtcGuard,
	isDisclosureIntact,
	neutralizeMemo,
} from "./ftc-guard.js";

beforeEach(() => {
	document.head.innerHTML = "";
	document.body.innerHTML = "";
});

/** jsdom returns a 0×0 box for everything; stub a non-zero rect so the visibility check passes. */
function makeVisible(el: Element): void {
	(el as HTMLElement).getBoundingClientRect = () =>
		({
			width: 200,
			height: 18,
			top: 0,
			left: 0,
			right: 200,
			bottom: 18,
			x: 0,
			y: 0,
			toJSON() {},
		}) as DOMRect;
}

/** Mount a memo wrap + section carrying the verbatim disclosure line. Returns the line node too. */
function mountMemo(lineText: string = FTC_DISCLOSURE_LINE): {
	wrap: HTMLElement;
	memo: HTMLElement;
	line: HTMLElement;
} {
	const wrap = document.createElement("div");
	wrap.className = "certrev-memo-wrap";
	wrap.innerHTML = `
		<section class="certrev-memo">
			<p class="certrev-memo__ftc" data-ftc-disclosure><span data-ftc-line>${lineText}</span></p>
		</section>`;
	document.body.appendChild(wrap);
	const line = wrap.querySelector<HTMLElement>("[data-ftc-line]")!;
	makeVisible(line);
	return {
		wrap,
		memo: wrap.querySelector<HTMLElement>(".certrev-memo")!,
		line,
	};
}

describe("isDisclosureIntact", () => {
	it("true when the line is present, verbatim, and visible", () => {
		const { memo } = mountMemo();
		expect(isDisclosureIntact(memo)).toBe(true);
	});

	it("false when the disclosure line node is missing (stripped)", () => {
		const { memo, line } = mountMemo();
		line.remove();
		expect(isDisclosureIntact(memo)).toBe(false);
	});

	it("false when the text was altered (a single changed word)", () => {
		const { memo } = mountMemo(
			FTC_DISCLOSURE_LINE.replace("Independent", "Sponsored"),
		);
		expect(isDisclosureIntact(memo)).toBe(false);
	});

	it("false when the line is hidden via display:none", () => {
		const { memo, line } = mountMemo();
		line.style.display = "none";
		expect(isDisclosureIntact(memo)).toBe(false);
	});

	it("false when the line is hidden via visibility:hidden", () => {
		const { memo, line } = mountMemo();
		line.style.visibility = "hidden";
		expect(isDisclosureIntact(memo)).toBe(false);
	});

	it("false when the line is collapsed to a zero box (rect 0×0)", () => {
		const { memo, line } = mountMemo();
		(line as HTMLElement).getBoundingClientRect = () =>
			({ width: 0, height: 0 }) as DOMRect;
		expect(isDisclosureIntact(memo)).toBe(false);
	});
});

describe("neutralizeMemo", () => {
	it("replaces the memo with the marked neutral notice (no attribution survives)", () => {
		const { memo } = mountMemo();
		memo.querySelector("span")!; // sanity: exists pre-neutralize
		neutralizeMemo(memo);
		expect(document.querySelector(".certrev-memo")).toBeNull();
		const notice = document.querySelector(`[${FTC_NEUTRALIZED_ATTR}]`);
		expect(notice).not.toBeNull();
		expect(notice!.textContent).toContain("required disclosure was not shown");
	});
});

describe("enforceFtcDisclosure", () => {
	it("leaves an intact memo untouched and returns true", () => {
		mountMemo();
		expect(enforceFtcDisclosure(document)).toBe(true);
		expect(document.querySelector(".certrev-memo")).not.toBeNull();
		expect(document.querySelector(`[${FTC_NEUTRALIZED_ATTR}]`)).toBeNull();
	});

	it("neutralizes a tampered memo and returns false", () => {
		const { line } = mountMemo();
		line.remove(); // strip the disclosure
		expect(enforceFtcDisclosure(document)).toBe(false);
		expect(document.querySelector(".certrev-memo")).toBeNull();
		expect(document.querySelector(`[${FTC_NEUTRALIZED_ATTR}]`)).not.toBeNull();
	});

	it("NO-OP (no false positive) when there is no memo at all — the no-memo certified path", () => {
		// A certified article without an expert memo renders no .certrev-memo (only the card cue).
		document.body.innerHTML =
			'<section class="certrev-badge certrev-card">card only, no memo</section>';
		expect(enforceFtcDisclosure(document)).toBe(true);
		expect(document.querySelector(`[${FTC_NEUTRALIZED_ATTR}]`)).toBeNull();
		expect(document.querySelector(".certrev-card")).not.toBeNull();
	});
});

describe("installFtcGuard", () => {
	it("enforces on install (document already interactive)", () => {
		const { line } = mountMemo();
		line.remove();
		installFtcGuard(document);
		expect(document.querySelector(`[${FTC_NEUTRALIZED_ATTR}]`)).not.toBeNull();
	});

	it("is idempotent — a second install does not double-bind / re-throw", () => {
		mountMemo();
		installFtcGuard(document);
		expect(() => installFtcGuard(document)).not.toThrow();
		// Still intact (the second call is a no-op; nothing neutralized a valid memo).
		expect(document.querySelector(".certrev-memo")).not.toBeNull();
	});
});
