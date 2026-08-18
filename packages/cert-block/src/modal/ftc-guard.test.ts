// @vitest-environment jsdom
/**
 * Unit tests for the native FTC disclosure tamper guard (iframe→native parity for the MSA §3
 * anti-stripping kill switch). Pure DOM. The expected text is the single source of truth
 * `FTC_DISCLOSURE_LINE`, so these also pin the guard to the verbatim copy.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
// Test-only import across the modal↔components line (the SOURCE never crosses it — see
// NOTICE_LINK_REL): the notice anchor's rel must stay a superset of the package-wide constant,
// and asserting that here is what keeps the modal-local copy from drifting silently.
import { CERTREV_LINK_REL } from "../components/rel.js";
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
function mountMemo(
	lineText: string = FTC_DISCLOSURE_LINE,
	doc: Document = document,
): {
	wrap: HTMLElement;
	memo: HTMLElement;
	line: HTMLElement;
} {
	const wrap = doc.createElement("div");
	wrap.className = "certrev-memo-wrap";
	wrap.innerHTML = `
		<section class="certrev-memo">
			<p class="certrev-memo__ftc" data-ftc-disclosure><span data-ftc-line>${lineText}</span></p>
		</section>`;
	doc.body.appendChild(wrap);
	const line = wrap.querySelector<HTMLElement>("[data-ftc-line]")!;
	makeVisible(line);
	return {
		wrap,
		memo: wrap.querySelector<HTMLElement>(".certrev-memo")!,
		line,
	};
}

/**
 * A FRESH document that still has a real `defaultView` (so it has a MutationObserver): an iframe,
 * because `installFtcGuard` is idempotent PER DOCUMENT — the shared `document` can only ever be
 * guarded once per file, and `createHTMLDocument()` has no view at all.
 */
function freshDoc(): { doc: Document; win: Window & typeof globalThis } {
	const frame = document.createElement("iframe");
	document.body.appendChild(frame);
	const doc = frame.contentDocument!;
	return { doc, win: doc.defaultView as Window & typeof globalThis };
}

/** MutationObserver callbacks are delivered on a microtask; let the queue drain. */
function flushMutations(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Records every `observe()` target on a window's MutationObserver while still observing for real. */
function spyOnObserve(win: Window & typeof globalThis) {
	return vi.spyOn(win.MutationObserver.prototype, "observe");
}

/** The badge markup `<CertBadge>` / `render-badge-html.ts` emit: the `[data-ftc-line]` hook, no memo. */
const BADGE_HTML =
	'<section class="certrev-badge certrev-badge--full">' +
	`<div class="certrev-badge__disclosure"><p class="certrev-badge__ftc" data-ftc-disclosure><span data-ftc-line>${FTC_DISCLOSURE_LINE}</span></p></div>` +
	"</section>";

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

	it("qualifies its CertREV anchor — every token of CERTREV_LINK_REL, plus noreferrer", () => {
		const { memo } = mountMemo();
		neutralizeMemo(memo);
		const link = document.querySelector<HTMLAnchorElement>(
			`[${FTC_NEUTRALIZED_ATTR}] a`,
		)!;
		expect(link.getAttribute("href")).toBe("https://certrev.com");
		const tokens = (link.getAttribute("rel") || "").split(/\s+/);
		// A CertREV link the brand did not author, placed on their page: it carries the same
		// qualification as every other anchor the package emits (rel.ts), never a bare noopener.
		for (const token of CERTREV_LINK_REL.split(/\s+/)) {
			expect(tokens).toContain(token);
		}
		// …and `noreferrer` on top, which this anchor alone needs: it is the only target=_blank one.
		expect(link.getAttribute("target")).toBe("_blank");
		expect(tokens).toContain("noreferrer");
	});
});

describe("enforceFtcDisclosure", () => {
	it("leaves an intact memo untouched and reports 'intact'", () => {
		mountMemo();
		expect(enforceFtcDisclosure(document)).toBe("intact");
		expect(document.querySelector(".certrev-memo")).not.toBeNull();
		expect(document.querySelector(`[${FTC_NEUTRALIZED_ATTR}]`)).toBeNull();
	});

	it("neutralizes a tampered memo and reports 'tampered'", () => {
		const { line } = mountMemo();
		line.remove(); // strip the disclosure
		expect(enforceFtcDisclosure(document)).toBe("tampered");
		expect(document.querySelector(".certrev-memo")).toBeNull();
		expect(document.querySelector(`[${FTC_NEUTRALIZED_ATTR}]`)).not.toBeNull();
	});

	it("NO-OP (no false positive) when there is no memo at all — the no-memo certified path", () => {
		// A certified article without an expert memo renders no .certrev-memo (only the card cue).
		document.body.innerHTML =
			'<section class="certrev-badge certrev-card">card only, no memo</section>';
		expect(enforceFtcDisclosure(document)).toBe("unguarded");
		expect(document.querySelector(`[${FTC_NEUTRALIZED_ATTR}]`)).toBeNull();
		expect(document.querySelector(".certrev-card")).not.toBeNull();
	});

	it("reports 'unguarded' — NOT success — on a badge surface whose disclosure it cannot see", () => {
		// `<CertBadge>` / `<certrev-badge>` emit the [data-ftc-line] hook but no `.certrev-memo`,
		// so the pass checks NOTHING here. Answering `true`/'intact' would be the guard claiming to
		// have verified a disclosure it never looked at — the whole point of the third state.
		document.body.innerHTML = BADGE_HTML;
		expect(enforceFtcDisclosure(document)).toBe("unguarded");
		expect(document.querySelector("[data-ftc-line]")).not.toBeNull();
		expect(document.querySelector(`[${FTC_NEUTRALIZED_ATTR}]`)).toBeNull();
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

	it("installs NO observer when neither guarded selector is in the document", () => {
		// The React / Web Component / renderCertBlock reality: a badge, no Liquid memo markup.
		// The old `<body>` fallback pinned a subtree+attributes+characterData observer on the host's
		// whole page to re-run a pass that can never match anything.
		const { doc, win } = freshDoc();
		doc.body.innerHTML = BADGE_HTML;
		const observe = spyOnObserve(win);
		installFtcGuard(doc);
		expect(observe).not.toHaveBeenCalled();
	});

	it("observes the memo WRAP (never <body>) and re-enforces on a post-install mutation", async () => {
		const { doc, win } = freshDoc();
		const { wrap, line } = mountMemo(FTC_DISCLOSURE_LINE, doc);
		const observe = spyOnObserve(win);
		installFtcGuard(doc);
		expect(observe).toHaveBeenCalledTimes(1);
		expect(observe.mock.calls[0][0]).toBe(wrap);
		// A host script strips the disclosure AFTER load — the kill switch must still fire.
		line.remove();
		await flushMutations();
		expect(doc.querySelector(".certrev-memo")).toBeNull();
		expect(doc.querySelector(`[${FTC_NEUTRALIZED_ATTR}]`)).not.toBeNull();
	});

	it("observes a bare memo when the Liquid wrap is absent — still never <body>", () => {
		const { doc, win } = freshDoc();
		doc.body.innerHTML = `<section class="certrev-memo"><p data-ftc-disclosure><span data-ftc-line>${FTC_DISCLOSURE_LINE}</span></p></section>`;
		const memo = doc.querySelector(".certrev-memo")!;
		makeVisible(doc.querySelector("[data-ftc-line]")!);
		const observe = spyOnObserve(win);
		installFtcGuard(doc);
		expect(observe.mock.calls.map((call) => call[0])).toEqual([memo]);
	});
});
