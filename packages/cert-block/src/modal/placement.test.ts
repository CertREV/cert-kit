// @vitest-environment jsdom
/**
 * Unit tests for the cert-card placement DOM layer (iframe→native parity): the @graph→<head>
 * relocate, the TWO-wrap reposition — contributors card to the TOP of the article, expert memo to
 * the BOTTOM (before the references list if present) — the tier observability attribute, and
 * idempotency (never move twice / detach the badge).
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	CARD_WRAP_SELECTOR,
	MEMO_WRAP_SELECTOR,
	PLACEMENT_ATTR,
	placeCert,
} from "./placement.js";

/** Stub an element's box so the rail's gutter math is deterministic in jsdom (which does no layout). */
function stubRight(el: Element, right: number): void {
	el.getBoundingClientRect = () =>
		({
			right,
			left: 0,
			top: 0,
			bottom: 0,
			width: right,
			height: 0,
			x: 0,
			y: 0,
			toJSON() {},
		}) as DOMRect;
}
function setInnerWidth(px: number): void {
	Object.defineProperty(window, "innerWidth", {
		configurable: true,
		value: px,
	});
}

beforeEach(() => {
	document.head.innerHTML = "";
	document.body.innerHTML = "";
});

/** Append the @graph script + the two cert wraps at the END of <body> (where a body embed renders). */
function mountEmbed(opts: { graph?: boolean; memo?: boolean } = {}): {
	card: HTMLElement;
	memo: HTMLElement | null;
} {
	if (opts.graph !== false) {
		const s = document.createElement("script");
		s.setAttribute("type", "application/ld+json");
		s.setAttribute("data-certrev-graph", "");
		s.textContent = '{"@context":"https://schema.org","@graph":[]}';
		document.body.appendChild(s);
	}
	const card = document.createElement("div");
	card.className = "certrev-card-wrap";
	card.setAttribute("data-certrev-anchor", "top");
	card.innerHTML =
		'<certrev-badge revalidate><section class="certrev-badge">card</section></certrev-badge>';
	document.body.appendChild(card);

	let memo: HTMLElement | null = null;
	if (opts.memo !== false) {
		memo = document.createElement("div");
		memo.className = "certrev-memo-wrap";
		memo.setAttribute("data-certrev-anchor", "bottom");
		memo.innerHTML = '<section class="certrev-memo">memo</section>';
		document.body.appendChild(memo);
	}
	return { card, memo };
}

describe("placeCert — @graph relocation", () => {
	it("moves the marked @graph script into <head>", () => {
		mountEmbed();
		expect(
			document.head.querySelector("script[data-certrev-graph]"),
		).toBeNull();
		const res = placeCert(document);
		expect(res.graph).toBe(true);
		const inHead = document.head.querySelector(
			'script[type="application/ld+json"][data-certrev-graph]',
		);
		expect(inHead).not.toBeNull();
		expect(inHead!.textContent).toContain("@graph");
	});

	it("leaves an unmarked ld+json script alone (only ours moves)", () => {
		const other = document.createElement("script");
		other.setAttribute("type", "application/ld+json");
		other.textContent = '{"@type":"WebSite"}';
		document.body.appendChild(other);
		mountEmbed({ graph: false });
		placeCert(document);
		expect(document.head.querySelector("script")).toBeNull();
		expect(
			document.body.querySelector('script[type="application/ld+json"]'),
		).toBe(other);
	});
});

describe("placeCert — contributors card → TOP of article", () => {
	it("inserts the card as the first child of a semantic <article> (afterbegin)", () => {
		const article = document.createElement("article");
		article.innerHTML = "<p>body</p>";
		document.body.insertBefore(article, document.body.firstChild);
		const { card } = mountEmbed();

		const res = placeCert(document);
		expect(res.card?.tier).toBe("article");
		expect(res.card?.anchored).toBe(true);
		expect(article.firstElementChild).toBe(card);
		expect(card.getAttribute(PLACEMENT_ATTR)).toBe("article");
	});

	it("prefers the body-content container so the card lands above the article text (theme-class)", () => {
		// Both a post-level <article> and an inner content container exist; the card should go into
		// the CONTENT container (TOP_ANCHORS prefers it) so it sits above the body, not above the title.
		const article = document.createElement("article");
		const content = document.createElement("div");
		content.className = "rte";
		content.innerHTML = "<p>summary</p>";
		article.appendChild(content);
		document.body.insertBefore(article, document.body.firstChild);
		const { card } = mountEmbed();

		const res = placeCert(document);
		expect(res.card?.tier).toBe("theme-class");
		expect(content.firstElementChild).toBe(card);
	});
});

describe("placeCert — skips hidden drawer/popup anchors (IntelliPure cart-drawer regression)", () => {
	it("does NOT relocate the card into a closed drawer whose empty-cart message uses .rte", () => {
		// A closed cart-drawer (hidden) sits BEFORE the article and carries its own `.rte` (empty-cart
		// message) — exactly the shape that put IntelliPure's card into a `<cart-drawer hidden>` and made
		// it invisible. The card must skip the hidden `.rte` and anchor to the visible article content.
		const article = document.createElement("article");
		const content = document.createElement("div");
		content.className = "rte";
		content.innerHTML = "<p>article body</p>";
		article.appendChild(content);
		document.body.appendChild(article);

		const drawer = document.createElement("div");
		drawer.setAttribute("hidden", ""); // closed drawer → display:none
		drawer.innerHTML = '<div class="rte"><p>Your cart is empty</p></div>';
		document.body.insertBefore(drawer, document.body.firstChild); // drawer is FIRST in document order

		const { card, memo } = mountEmbed();
		const res = placeCert(document);

		expect(drawer.contains(card)).toBe(false); // never in the hidden drawer
		expect(content.contains(card)).toBe(true); // anchored to the VISIBLE article .rte
		expect(res.card?.tier).toBe("theme-class");
		expect(drawer.contains(memo!)).toBe(false); // the shared guard protects the memo too
	});

	it("skips a visibility:hidden anchor in favour of the visible one (card + memo)", () => {
		const hidden = document.createElement("article");
		hidden.style.visibility = "hidden";
		hidden.innerHTML = "<p>hidden</p>";
		document.body.appendChild(hidden);
		const visible = document.createElement("article");
		visible.innerHTML = "<p>visible</p>";
		document.body.appendChild(visible);
		const { card, memo } = mountEmbed();

		placeCert(document);
		expect(hidden.contains(card)).toBe(false);
		expect(visible.firstElementChild).toBe(card);
		expect(hidden.contains(memo!)).toBe(false);
		expect(visible.nextElementSibling).toBe(memo); // memo lands after the VISIBLE article
	});

	it("memo anchors before #references even when a small hero <article> precedes the content article", () => {
		// IntelliPure's theme has TWO <article>s — a small hero banner BEFORE the content article — and
		// #references lives in the CONTENT article. The memo must anchor off #references (bottom), NOT
		// afterend of the first-matched hero (which stranded it at the TOP, above the card).
		const hero = document.createElement("article");
		hero.className = "article banner";
		hero.innerHTML = "<h1>title</h1>";
		document.body.appendChild(hero);
		const content = document.createElement("article");
		content.className = "article page-width";
		// #references lives INSIDE the body .rte (as the html-generator emits it) — the card anchors to
		// the .rte that OWNS #references, the memo to just before #references.
		content.innerHTML =
			'<div class="rte"><p>body</p><div id="references"><p>refs</p></div></div>';
		document.body.appendChild(content);
		const { card, memo } = mountEmbed();

		const res = placeCert(document);
		const refs = content.querySelector("#references")!;
		expect(refs.previousElementSibling).toBe(memo); // memo just before references (bottom of content)
		expect(hero.contains(memo!)).toBe(false); // NOT stranded at the hero (top)
		expect(res.memo?.tier).toBe("references");
		expect(content.querySelector(".rte")!.firstElementChild).toBe(card); // card lands in the .rte that owns #references
	});
});

describe("placeCert — skips VISIBLE site-chrome anchors (IntelliPure announcement-bar regression, POR-9809)", () => {
	it("does NOT land the card in a VISIBLE .rte announcement bar — anchors to the article that owns #references", () => {
		// IntelliPure's announcement bar is `<div class="announcement__content … rte">` — VISIBLE (so the
		// isRenderable guard can't reject it) and FIRST in document order. Before the fix the contributors
		// card was injected there and "wasn't showing". It must anchor to the article `.rte` that owns
		// #references instead.
		const announcement = document.createElement("div");
		announcement.className = "announcement__content flex items-center rte";
		announcement.innerHTML = "<p>Free shipping over $50</p>";
		document.body.appendChild(announcement); // FIRST in document order, visible

		const article = document.createElement("article");
		const content = document.createElement("div");
		content.className = "rte";
		content.innerHTML =
			'<p>article body</p><div id="references"><p>refs</p></div>';
		article.appendChild(content);
		document.body.appendChild(article);

		const { card } = mountEmbed();
		const res = placeCert(document);

		expect(announcement.contains(card)).toBe(false); // never in the announcement bar
		expect(content.firstElementChild).toBe(card); // anchored to the article body that owns #references
		expect(res.card?.tier).toBe("theme-class");
	});

	it("skips a VISIBLE chrome .rte in the fallback scan when no #references exists", () => {
		// Same announcement-bar shape, but the article has NO references list → the card uses the fallback
		// anchor scan. The chrome-exclusion must still skip the announcement `.rte` and land in the article.
		const announcement = document.createElement("div");
		announcement.className = "announcement-bar rte";
		announcement.innerHTML = "<p>promo</p>";
		document.body.appendChild(announcement);

		const article = document.createElement("article");
		const content = document.createElement("div");
		content.className = "rte";
		content.innerHTML = "<p>article body</p>";
		article.appendChild(content);
		document.body.appendChild(article);

		const { card } = mountEmbed({ memo: false });
		const res = placeCert(document);

		expect(announcement.contains(card)).toBe(false);
		expect(content.firstElementChild).toBe(card);
		expect(res.card?.tier).toBe("theme-class");
	});
});

describe("placeCert — expert memo → BOTTOM of article", () => {
	it("inserts the memo just after a semantic <article> when no references list exists", () => {
		const article = document.createElement("article");
		article.innerHTML = "<p>body</p>";
		document.body.insertBefore(article, document.body.firstChild);
		const { memo } = mountEmbed();

		const res = placeCert(document);
		expect(res.memo?.tier).toBe("article");
		expect(article.nextElementSibling).toBe(memo);
		expect(memo!.getAttribute(PLACEMENT_ATTR)).toBe("article");
	});

	it("inserts the memo just BEFORE the references list (legacy memo → references order)", () => {
		const article = document.createElement("article");
		const refs = document.createElement("div");
		refs.id = "references";
		article.appendChild(document.createElement("p"));
		article.appendChild(refs);
		document.body.insertBefore(article, document.body.firstChild);
		const { memo } = mountEmbed();

		placeCert(document);
		expect(refs.previousElementSibling).toBe(memo);
		expect(memo!.parentElement).toBe(article);
	});
});

describe("placeCert — fallbacks + idempotency", () => {
	it("uses the styled body-bottom fallback for both wraps when nothing matches", () => {
		const { card, memo } = mountEmbed();
		const res = placeCert(document);
		expect(res.card?.tier).toBe("body-fallback");
		expect(res.card?.anchored).toBe(false);
		expect(res.memo?.tier).toBe("body-fallback");
		expect(card.getAttribute(PLACEMENT_ATTR)).toBe("body-fallback");
		expect(memo!.getAttribute(PLACEMENT_ATTR)).toBe("body-fallback");
	});

	it("is idempotent — a second pass does not move either wrap again", () => {
		const article = document.createElement("article");
		document.body.insertBefore(article, document.body.firstChild);
		const { card, memo } = mountEmbed();
		placeCert(document);
		const cardParent = card.parentElement;
		const memoNext = memo!.previousElementSibling ?? memo!.nextElementSibling;

		const res2 = placeCert(document);
		expect(res2.card?.tier).toBe("article");
		expect(card.parentElement).toBe(cardParent);
		expect(memo!.previousElementSibling ?? memo!.nextElementSibling).toBe(
			memoNext,
		);
	});

	it("no-ops without throwing when the wraps are absent", () => {
		expect(() => placeCert(document)).not.toThrow();
		expect(document.querySelector(CARD_WRAP_SELECTOR)).toBeNull();
		expect(document.querySelector(MEMO_WRAP_SELECTOR)).toBeNull();
	});

	it("places the card even when the memo wrap is absent (no memo on this article)", () => {
		const article = document.createElement("article");
		document.body.insertBefore(article, document.body.firstChild);
		const { memo } = mountEmbed({ memo: false });
		expect(memo).toBeNull();
		const res = placeCert(document);
		expect(res.card?.tier).toBe("article");
		expect(res.memo).toBeNull();
	});
});

describe('placeCert — sidebar rail (layout "sidebar")', () => {
	/** Mount an article that owns #references + a lone rail wrap (the sidebar render's single wrap). */
	function mountRail(): { wrap: HTMLElement; content: HTMLElement } {
		const article = document.createElement("article");
		const content = document.createElement("div");
		content.className = "rte";
		content.innerHTML = '<p>body</p><div id="references"><p>refs</p></div>';
		article.appendChild(content);
		document.body.appendChild(article);
		const wrap = document.createElement("div");
		wrap.className = "certrev-memo-wrap certrev-sidebar-wrap";
		wrap.setAttribute("data-certrev-anchor", "rail");
		wrap.innerHTML =
			'<section class="certrev-badge certrev-memo certrev-sidebar">rail</section>';
		document.body.appendChild(wrap);
		return { wrap, content };
	}

	it("pins the rail (fixed) + sets --certrev-rail-left when the right gutter is wide enough", () => {
		const { wrap, content } = mountRail();
		stubRight(content, 600);
		setInnerWidth(1200); // gutter = 600 ≥ 384

		const res = placeCert(document);
		expect(res.memo?.tier).toBe("rail");
		expect(res.memo?.anchored).toBe(true);
		expect(wrap.getAttribute(PLACEMENT_ATTR)).toBe("rail");
		expect(wrap.style.getPropertyValue("--certrev-rail-left")).toBe("624px"); // rect.right + RAIL_GAP
		// The rail is FIXED at the embed point — never moved into the article content.
		expect(content.contains(wrap)).toBe(false);
	});

	it("falls back to the in-flow banner-style TOP placement when the gutter is too narrow", () => {
		const { wrap, content } = mountRail();
		stubRight(content, 1100);
		setInnerWidth(1200); // gutter = 100 < 384

		const res = placeCert(document);
		expect(res.memo?.tier).toBe("theme-class"); // the .rte content container
		expect(content.firstElementChild).toBe(wrap); // afterbegin, like the banner card
		expect(wrap.style.getPropertyValue("--certrev-rail-left")).toBe(""); // never pinned
	});

	it("body-fallback when no article owner exists for the rail", () => {
		const wrap = document.createElement("div");
		wrap.className = "certrev-memo-wrap certrev-sidebar-wrap";
		wrap.setAttribute("data-certrev-anchor", "rail");
		wrap.innerHTML =
			'<section class="certrev-badge certrev-memo certrev-sidebar">rail</section>';
		document.body.appendChild(wrap);

		const res = placeCert(document);
		expect(res.memo?.tier).toBe("body-fallback");
		expect(res.memo?.anchored).toBe(false);
	});
});

describe('placeCert — floating pill (layout "floating")', () => {
	it('stamps the pill wrap "pill-fixed" (CSS owns the placement) with no card/memo', () => {
		const wrap = document.createElement("div");
		wrap.className = "certrev-pill-wrap";
		wrap.setAttribute("data-certrev-anchor", "pill");
		wrap.innerHTML =
			'<section class="certrev-badge certrev-pill">pill</section>';
		document.body.appendChild(wrap);

		const res = placeCert(document);
		expect(wrap.getAttribute(PLACEMENT_ATTR)).toBe("pill-fixed");
		// A floating render carries neither the card nor the memo wrap.
		expect(res.card).toBeNull();
		expect(res.memo).toBeNull();
	});
});
