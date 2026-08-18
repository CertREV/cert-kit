/**
 * The verbatim FTC material-connection + scope disclosure line — a BYTE-FAITHFUL relocation of
 * the (tree-shaken) `FTC_DISCLOSURE_LINE` from the portal's embed disclosure
 * module. Legally load-bearing: the curly apostrophe (U+2019) in "article’s"
 * is byte-exact; a reword is a contract divergence.
 *
 * Kept as its OWN module (imported by both ftc-guard + display-strings, exactly as in portal) so
 * the browser bundle emits the same `var` structure as the deployed certrev-cert.js — do not merge
 * it into display-strings.ts (that consolidation drops one `var` and breaks byte-parity).
 */

export const FTC_DISCLOSURE_LINE =
	"Independent editorial review of this article’s text and sources. Not a product endorsement, nor medical advice." as const;
