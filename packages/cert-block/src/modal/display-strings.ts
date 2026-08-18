/**
 * Cert-render display strings + date formatter for the MODAL — a BYTE-FAITHFUL relocation of the
 * portal's own display-strings module. Kept a SEPARATE module from ftc-disclosure.ts (matching the
 * portal's file split) so the bundle's `var` layout is byte-identical to the live deployed asset.
 *
 * ⚠ Deliberately SEPARATE from `../components/render-def.ts`/`format.ts`. `formatCertDisplayDate`
 * uses `toLocaleDateString` (NOT the components' fixed MONTHS array): the live modal formats dates
 * via `toLocaleDateString` at runtime in the browser, so a fixed-array formatter would VISIBLY
 * diverge on any browser whose ICU renders a month abbreviation differently (the "Sep"/"Sept"
 * CLDR-42 case). Byte-parity with the deployed asset requires preserving the exact source.
 *
 * Byte-frozen about OUTPUT, type-guarded about INPUT — the same split `escape.ts` makes here:
 * every well-formed value renders the exact string portal renders, and a value the wire could
 * never legitimately carry renders nothing (see `formatCertDisplayDate`).
 */

import { FTC_DISCLOSURE_LINE } from "./ftc-disclosure.js";

/** The compensation cue (guide "line A"), byte-verbatim from portal `COMPENSATED_EXPERT_CUE`. */
export const COMPENSATED_EXPERT_CUE = "Compensated expert";

/** The FTC scope disclaimer, re-exported from the FTC SoT (portal `CERT_SCOPE_LINE = FTC_DISCLOSURE_LINE`). */
export const CERT_SCOPE_LINE = FTC_DISCLOSURE_LINE;

/**
 * Format a timestamp the way every cert byline renders dates ("Jun 14, 2026", en-US short month,
 * UTC-pinned). Null for an unparseable input — callers treat that as "no date, no byline".
 * Byte-faithful to portal `formatCertDisplayDate` for every value the wire can legitimately carry.
 *
 * STRINGS AND `Date`s ONLY — any other type is null, the same rule `../components/format.ts`'s
 * `formatDate` settled on. `certifiedAt` reaches here off a `JSON.parse(...) as` cast whose
 * SIGNATURE was checked and whose SHAPE never was, and the `Date` constructor coerces whatever it
 * is handed: `certifiedAt: 42` put "Jan 1, 1970" in the certificate's Issued row, and `[2026]`
 * put "Jan 1, 2026" there. There is no reading to rescue — the wire types this field as an
 * ISO-8601 string, so a number is always a malformed payload, and epoch seconds vs milliseconds
 * is not decidable from the value anyway. A compliance-facing card that prints a confident wrong
 * certification date is worse than one that prints none.
 *
 * The guard is on the TYPE, not the value: the string "42" still parses as the year 2042, exactly
 * as `formatDate` does with it. Both helpers hand string parsing to the engine.
 *
 * One behaviour narrows: a `Date` from another realm fails `instanceof` and is now null instead of
 * being coerced through `new Date(obj)`. Nothing passes a `Date` here at all — both call sites in
 * `cert-modal-view.ts` pass `content.certifiedAt` straight off the parsed envelope.
 */
export function formatCertDisplayDate(
	iso: string | Date | null | undefined,
): string | null {
	if (!iso) return null;
	if (typeof iso !== "string" && !(iso instanceof Date)) return null;
	const date = iso instanceof Date ? iso : new Date(iso);
	if (Number.isNaN(date.getTime())) return null;
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	});
}
