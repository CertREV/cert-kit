// ⚠ VENDORED, BYTE-FAITHFUL copy of portal `src/lib/design-guide/logo.ts` `LOGO_PATHS`
// (POR-10721 W2). Byte-identical to `../components/render-cert-block.ts`'s private copy;
// kept modal-local so the browser bundle never pulls in the SSR renderer. Unifying the
// package's two copies onto one shared leaf module is a post-publish follow-up.
/**
 * The CertREV 4-chevron logo mark — the canonical SVG path data (the four `d`
 * attributes, drawn in a `0 0 375 375` viewBox). This is the SINGLE SOURCE for
 * the mark across every cert-render surface (the standalone /embed renderers,
 * the <certrev-cert-modal> web component, the Shopify Liquid snippets, the
 * WordPress PHP renderer, and @certrev/cert-block).
 *
 * The paths were previously hand-copied into ~13 files; each of those should
 * import THIS instead of re-declaring them. The codegen
 * (`scripts/build-cert-design-artifacts.ts`) stamps these into
 * `generated/design-tokens.json` + the WordPress `class-certrev-design-tokens.php`
 * so the Liquid/PHP twins can never drift from this array.
 */
export const LOGO_PATHS = [
	"M67.59 221.77L138.77 292.95C145.8 299.98 145.8 311.44 138.77 318.47L123.02 334.22C116 341.25 104.54 341.25 97.5 334.22L26.32 263.04C19.29 256.01 19.29 244.55 26.32 237.52L42.07 221.77C49.1 214.74 60.56 214.74 67.59 221.77Z",
	"M96.79 335.08L81.12 319.42C73.8 312.1 73.8 300.23 81.12 292.92L315.88 58.16C323.2 50.85 335.06 50.85 342.38 58.16L358.04 73.83C365.36 81.14 365.36 93.01 358.04 100.33L123.29 335.08C115.97 342.4 104.1 342.4 96.79 335.08Z",
	"M203.5 335.14L187.83 319.48C180.52 312.16 180.52 300.29 187.83 292.98L315.88 164.93C323.2 157.62 335.06 157.62 342.38 164.93L358.04 180.6C365.36 187.92 365.36 199.78 358.04 207.1L230 335.14C222.68 342.46 210.82 342.46 203.5 335.14Z",
	"M310.21 335.2L294.54 319.54C287.23 312.22 287.23 300.36 294.54 293.04L315.88 271.71C323.2 264.39 335.06 264.39 342.38 271.71L358.04 287.37C365.36 294.69 365.36 306.55 358.04 313.87L336.71 335.2C329.39 342.52 317.53 342.52 310.21 335.2Z",
] as const;
