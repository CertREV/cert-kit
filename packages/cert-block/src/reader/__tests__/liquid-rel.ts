/**
 * The one byte the reader face differs from the Shopify Liquid in: the `rel` on its anchors.
 *
 * The Liquid snippets (and so the portal's golden pages and the harness's output) emit `rel="noopener noreferrer"`. The
 * reader face emits the package's own `CERTREV_LINK_REL` on every anchor, as the legacy faces do. The golden and
 * differential tests therefore rewrite the Liquid's rel to the package's BEFORE the byte compare, and nothing else:
 *
 *  - only the `rel` attribute value, only inside an `<a ...>` open tag;
 *  - and only when that value is exactly the Liquid's. Any other value (a snippet that ever changes its rel) throws, so
 *    the rewrite can never hide a second difference.
 *
 * `reader-link-rel.test.ts` pins the whole contract under a name.
 */
import { CERTREV_LINK_REL } from '../../components/rel.js'

/** What the Liquid snippets emit on every reader anchor. */
export const LIQUID_REL = 'noopener noreferrer'

const ANCHOR_TAG = /<a\s[^>]*>/g

export const anchorsOf = (html: string): string[] => html.match(ANCHOR_TAG) ?? []

/** The reader sections on a Liquid page or harness output, in order (a banner page has the card, then the memo card). */
export const readerSections = (page: string): string[] =>
	page.match(/<section class="certrev-reader[^"]*"[\s\S]*?<\/section>/g) ?? []

/** The Liquid's output with each anchor's rel rewritten to the package's. Throws on a rel that is not the Liquid's. */
export function withPackageRel(liquid: string): string {
	return liquid.replace(ANCHOR_TAG, (tag) => {
		const from = ` rel="${LIQUID_REL}"`
		if (!tag.includes(from)) throw new Error(`a Liquid anchor without rel="${LIQUID_REL}": ${tag}`)
		return tag.replace(from, ` rel="${CERTREV_LINK_REL}"`)
	})
}

/** The same markup with every anchor's rel attribute removed: what two renders must agree on, rel aside. */
export const withoutAnchorRel = (html: string): string =>
	html.replace(ANCHOR_TAG, (tag) => tag.replace(/ rel="[^"]*"/, ''))
