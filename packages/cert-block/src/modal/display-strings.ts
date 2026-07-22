/**
 * Cert-render display strings + date formatter for the MODAL — a BYTE-FAITHFUL relocation of
 * portal `src/lib/cert-delivery/display-strings.ts` (POR-10721 W2). Kept a SEPARATE module from
 * ftc-disclosure.ts (matching portal) so the bundle's `var` layout is byte-identical to the live asset.
 *
 * ⚠ Deliberately SEPARATE from `../components/render-def.ts`/`format.ts`. `formatCertDisplayDate`
 * uses `toLocaleDateString` (NOT the components' fixed MONTHS array): the live modal formats dates
 * via `toLocaleDateString` at runtime in the browser, so a fixed-array formatter would VISIBLY
 * diverge on any browser whose ICU renders a month abbreviation differently (the "Sep"/"Sept"
 * CLDR-42 case). Byte-parity with the deployed asset requires preserving the exact source.
 */

import { FTC_DISCLOSURE_LINE } from "./ftc-disclosure.js";

/** The compensation cue (guide "line A"), byte-verbatim from portal `COMPENSATED_EXPERT_CUE`. */
export const COMPENSATED_EXPERT_CUE = "Compensated expert";

/** The FTC scope disclaimer, re-exported from the FTC SoT (portal `CERT_SCOPE_LINE = FTC_DISCLOSURE_LINE`). */
export const CERT_SCOPE_LINE = FTC_DISCLOSURE_LINE;

/**
 * Format a timestamp the way every cert byline renders dates ("Jun 14, 2026", en-US short month,
 * UTC-pinned). Byte-faithful to portal `formatCertDisplayDate`. Null for an unparseable input —
 * callers treat that as "no date, no byline".
 */
export function formatCertDisplayDate(
	iso: string | Date | null | undefined,
): string | null {
	if (!iso) return null;
	const date = iso instanceof Date ? iso : new Date(iso);
	if (Number.isNaN(date.getTime())) return null;
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	});
}
