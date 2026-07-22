// @vitest-environment jsdom
/**
 * Unit tests for the cert-card interactions layer — accordion contributor bios (POR-9827 chevron
 * model) + the in-page certificate/profile modals. Pure DOM, delegated handlers.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	initCertInteractions,
	modalTargetKind,
	openCertModal,
	openModal,
	swapBrokenAvatar,
	sweepBrokenAvatars,
	toggleAccordion,
} from "./interactions.js";

beforeEach(() => {
	document.head.innerHTML = "";
	document.body.innerHTML = "";
	// Fresh document flag each test isn't possible (same global doc), so the install guard is
	// exercised explicitly in its own test; other tests call initCertInteractions once.
});

/** A contributors card with an accordion reviewer row (name/credentials split + hidden acc-bio)
 *  and the footer "Compensated expert" modal trigger — the POR-9827 chevron-model markup. */
function mountCard(): {
	card: HTMLElement;
	row: HTMLElement;
	bio: HTMLElement;
} {
	const card = document.createElement("section");
	card.className = "certrev-badge certrev-card";
	card.innerHTML = `
		<div class="card-body">
			<div class="contributors">
				<div class="contributor clickable" data-certrev-acc role="button" tabindex="0" aria-expanded="false">
					<div class="person-row"><div class="info">
						<div class="name">Jane Doe <svg class="name-caret"></svg></div>
						<div class="credentials">RDN, PhD</div>
						<div class="label expert">Reviewed by</div>
						<div class="acc-bio">Twenty years in clinical nutrition.</div>
					</div></div>
				</div>
			</div>
			<div class="card-footer"><span class="compensated-cue">Compensated <a class="cert-link" href="https://certrev.com/experts/jane" data-certrev-modal-open="expert">expert</a></span></div>
		</div>`;
	document.body.appendChild(card);
	return {
		card,
		row: card.querySelector("[data-certrev-acc]")!,
		bio: card.querySelector(".acc-bio")!,
	};
}

type StubModal = HTMLElement & { open: ReturnType<typeof vi.fn> };

/** A stand-in `<certrev-cert-modal>` with a controllable `open()` — the interactions layer only
 *  routes to the element's `.open(kind)`; the element itself owns rendering (tested separately). */
function mountModalElement(returns = true): StubModal {
	const el = document.createElement("certrev-cert-modal") as StubModal;
	el.open = vi.fn(() => returns);
	document.body.appendChild(el);
	return el;
}

describe("toggleAccordion (pure)", () => {
	it("toggles the row open and mirrors the state on aria-expanded", () => {
		const { row } = mountCard();
		toggleAccordion(row);
		expect(row.classList.contains("open")).toBe(true);
		expect(row.getAttribute("aria-expanded")).toBe("true");
		toggleAccordion(row);
		expect(row.classList.contains("open")).toBe(false);
		expect(row.getAttribute("aria-expanded")).toBe("false");
	});
});

describe("openCertModal", () => {
	it('routes to the <certrev-cert-modal> element open("cert")', () => {
		const el = mountModalElement(true);
		expect(openCertModal(document)).toBe(true);
		expect(el.open).toHaveBeenCalledWith("cert");
	});

	it("returns false (caller falls back to the link) when no modal element exists", () => {
		expect(openCertModal(document)).toBe(false);
	});

	it("returns whatever the element.open returns — false lets the link href fall back", () => {
		mountModalElement(false);
		expect(openCertModal(document)).toBe(false);
	});
});

describe("modal routing (POR-10102 — unified element)", () => {
	it('modalTargetKind routes "expert" to the reviewer and everything else to the certificate', () => {
		expect(modalTargetKind("expert")).toBe("expert");
		expect(modalTargetKind("cert")).toBe("cert");
		expect(modalTargetKind("")).toBe("cert");
		expect(modalTargetKind(null)).toBe("cert");
	});

	it("openModal opens the reviewer dialog via the element (and returns false when it is absent)", () => {
		expect(openModal(document, "expert")).toBe(false);
		const el = mountModalElement(true);
		expect(openModal(document, "expert")).toBe(true);
		expect(el.open).toHaveBeenCalledWith("expert");
	});

	it('the "Compensated expert" cue opens the reviewer modal and prevents navigation', () => {
		const { card, row } = mountCard();
		const el = mountModalElement(true);
		initCertInteractions(document);
		const link = card.querySelector(
			'[data-certrev-modal-open="expert"]',
		) as HTMLElement;
		const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
		link.dispatchEvent(evt);
		expect(el.open).toHaveBeenCalledWith("expert");
		expect(evt.defaultPrevented).toBe(true);
		// The modal open is NOT an accordion toggle.
		expect(row.classList.contains("open")).toBe(false);
	});
});

describe("broken avatar → initials fallback", () => {
	it("swapBrokenAvatar replaces a broken img with the matching initials span", () => {
		const img = document.createElement("img");
		img.className = "avatar";
		img.setAttribute("data-certrev-initials", "JS");
		img.src = "https://broken.example/x.jfif";
		document.body.appendChild(img);
		swapBrokenAvatar(img);
		const span = document.body.querySelector("span.avatar.avatar--initials");
		expect(span).not.toBeNull();
		expect(span!.textContent).toBe("JS");
		expect(span!.getAttribute("aria-hidden")).toBe("true");
		expect(document.body.querySelector("img")).toBeNull();
	});

	it("uses the memo base class when that is what the img carries", () => {
		const memoImg = document.createElement("img");
		memoImg.className = "certrev-memo__avatar";
		memoImg.setAttribute("data-certrev-initials", "CY");
		document.body.appendChild(memoImg);
		swapBrokenAvatar(memoImg);
		expect(
			document.body.querySelector(
				"span.certrev-memo__avatar.certrev-memo__avatar--initials",
			)?.textContent,
		).toBe("CY");
	});

	it("does nothing for an img without the initials attribute", () => {
		const img = document.createElement("img");
		img.className = "avatar";
		document.body.appendChild(img);
		swapBrokenAvatar(img);
		expect(document.body.querySelector("img")).not.toBeNull();
	});

	it("sweepBrokenAvatars swaps an avatar that already failed before init (no error event re-fires)", () => {
		const img = document.createElement("img");
		img.className = "avatar";
		img.setAttribute("data-certrev-initials", "ZZ");
		// Simulate an image that 404'd during parse: complete=true, naturalWidth=0, no future error.
		Object.defineProperty(img, "complete", { value: true });
		Object.defineProperty(img, "naturalWidth", { value: 0 });
		document.body.appendChild(img);
		sweepBrokenAvatars(document);
		expect(
			document.body.querySelector("span.avatar--initials")?.textContent,
		).toBe("ZZ");
	});

	it("sweepBrokenAvatars leaves a successfully-loaded avatar alone", () => {
		const img = document.createElement("img");
		img.className = "avatar";
		img.setAttribute("data-certrev-initials", "OK");
		Object.defineProperty(img, "complete", { value: true });
		Object.defineProperty(img, "naturalWidth", { value: 56 }); // loaded
		document.body.appendChild(img);
		sweepBrokenAvatars(document);
		expect(
			document.body.querySelector("img[data-certrev-initials]"),
		).not.toBeNull();
		expect(document.body.querySelector("span.avatar--initials")).toBeNull();
	});

	it("the capture-phase error listener swaps a broken avatar on its error event", () => {
		const img = document.createElement("img");
		img.className = "avatar";
		img.setAttribute("data-certrev-initials", "AB");
		document.body.appendChild(img);
		initCertInteractions(document);
		img.dispatchEvent(new Event("error")); // error doesn't bubble → handler is capture-phase
		expect(
			document.body.querySelector("span.avatar--initials")?.textContent,
		).toBe("AB");
	});
});

describe("initCertInteractions — delegated accordion + modal", () => {
	it("a row click opens the accordion; a second click closes it", () => {
		const { row } = mountCard();
		initCertInteractions(document);
		row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(row.classList.contains("open")).toBe(true);
		expect(row.getAttribute("aria-expanded")).toBe("true");
		row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(row.classList.contains("open")).toBe(false);
		expect(row.getAttribute("aria-expanded")).toBe("false");
	});

	it("a click on a LINK inside the card does not toggle the accordion (the link has its own action)", () => {
		const { card, row } = mountCard();
		// Give the row an inner link to prove the guard (e.g. a future inline control).
		const a = document.createElement("a");
		a.href = "https://certrev.com/x";
		a.textContent = "link";
		row.querySelector(".info")!.appendChild(a);
		initCertInteractions(document);
		a.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(row.classList.contains("open")).toBe(false);
		expect(card.querySelector("[data-certrev-acc].open")).toBeNull();
	});

	it("Enter on the role=button row toggles the accordion (a div fires no native click)", () => {
		const { row } = mountCard();
		initCertInteractions(document);
		row.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		expect(row.classList.contains("open")).toBe(true);
		row.dispatchEvent(
			new KeyboardEvent("keydown", { key: " ", bubbles: true }),
		);
		expect(row.classList.contains("open")).toBe(false);
	});

	it("install is idempotent (second call does not double-bind — one click toggles exactly once)", () => {
		const { row } = mountCard();
		initCertInteractions(document);
		initCertInteractions(document); // no-op second install
		row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		// A double-bound handler would toggle twice (open → closed); one binding leaves it open.
		expect(row.classList.contains("open")).toBe(true);
	});
});
