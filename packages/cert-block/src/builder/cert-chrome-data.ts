/**
 * ─────────────────────────────────────────────────────────────────────────────
 * `BuilderCertChromeData` — the CANONICAL headless cert-chrome wire type
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The brand-render projection of the cert envelope (portal POR-10091) — the OPTIONS
 * of a brand's native cert component (the registered `CertReviewCard`) on
 * a headless blocks-mode entry (Builder.io). CertREV serves the data + the ready-made
 * strings; the brand renders it within the design-guide ladder (enforced live by the
 * crawl monitor + the MSA anti-stripping teeth).
 *
 * SINGLE SOURCE (POR-10721 W1): this type is HOMED HERE so the portal exporter
 * (`src/lib/builder/cert-chrome.ts`) and the kit component (`CertReviewCard`) +
 * `BUILDER_REGISTRATION.inputs` all reference ONE definition — killing the drift the
 * hand-rolled Hydrogen-replica component suffered (it carried a stale separate
 * `credential`/`credentialVerifiedAt` shape from before the fused-pair projection).
 * Keep byte-for-byte in sync with the portal interface until the portal migrates to
 * import THIS (that migration is gated on publishing the package that carries it).
 *
 * PURITY: types + a pure key tuple only — no runtime deps, tree-shakeable.
 */

/**
 * The baked render-def projection (the Shopify `render_def` metafield shape) the
 * exporter delivers so a brand's Builder face themes byte-identically to its Shopify
 * face. The component maps `{ tokens, version }` onto `renderCertBlock`'s theme +
 * `data-certrev-def-version` stamp. Structurally matches the portal's
 * `ShopifyRenderDefMetafield` (single-sourcing that metafield type too is a follow-up).
 */
export interface CertChromeRenderDef {
	/** Monotonic per-brand def version → the `data-certrev-def-version` stamp. */
	readonly v: number
	readonly preset: string
	readonly rung: string
	/**
	 * The resolved themeable tokens (the baked metafield's `tokens`) — includes the v2
	 * `barInk`/`inkColor`, so this is a superset of the input `CertThemeTokens` (which
	 * predates brand-ink theming). Inlined structurally to match what the exporter bakes.
	 */
	readonly tokens: {
		readonly accentColor?: string
		readonly surface?: string
		readonly cornerRadius?: string
		readonly fontSlot?: string
		readonly barInk?: string
		readonly inkColor?: string
	}
	/** The auto-contrast bar foreground — present only on a barInk-themed face (v2). */
	readonly barInkFg?: '#141414' | '#ffffff'
	/** The subtractive field-visibility hide-set. */
	readonly hidden: readonly string[]
	/** v2 layout axis. Omitted ⇒ 'banner'. */
	readonly layout?: string
	/** Custom-face composition — present only when layout === 'custom'. */
	readonly customFace?: { readonly placedFields: readonly string[] }
}

/**
 * The OPTIONS a brand's native cert component receives. Delivered per certified
 * article; until the brand registers the component the block renders nothing.
 */
export interface BuilderCertChromeData {
	/**
	 * The credentialed byline — credential + dated CertREV verification as ONE
	 * inseparable string. Null when the R1 gate fails (a displayed credential is
	 * unverified / missing `verified_at`); the brand then has only `bylinePlain`.
	 */
	bylineCredentialed: string | null
	/**
	 * The RAW verified credential welded to its dated verification, delivered as ONE
	 * INSEPARABLE PAIR (present together) or `null` (omitted together). The WHOLE
	 * point: the type hands the brand `credential` and `verifiedAt` only as the two
	 * keys of one object, so a bare credential without its dated verification is
	 * UNCONSTRUCTIBLE — the fused-verification invariant enforced by construction, not
	 * a hopeful side rule. Non-null iff `bylineCredentialed` is. The sidebar/banner
	 * faces map this to their `credential` + `credentialVerifiedAt` inputs.
	 */
	credentialVerification: { credential: string; verifiedAt: string } | null
	/** The name-only byline (`Reviewed [date] by [Name].`). Always present. */
	bylinePlain: string
	/** The reviewer's resolved professional name (QA-safe), raw, for a name-only layout. */
	reviewerName: string
	/** Reviewer's short verified bio, or null (verified-only). */
	bio: string | null
	/** Reviewer's longer verified background, or null (verified-only). */
	background: string | null
	/** The QA-SCREENED `verifiedExpertMemo` (never the raw in-flight `expertMemo`), or null. */
	memo: string | null
	/** The compensation cue (`Compensated expert`). Null for a pro-bono reviewer. */
	compensationCue: string | null
	/** The verbatim FTC scope disclaimer. Always present. */
	scopeLine: string
	/** Reviewer photo URL (cert-frozen override ?? live), or null. */
	reviewerPhoto: string | null
	/** The CertREV expert-profile URL (`certrev.com/expert/{id}`) — never LinkedIn. */
	reviewerProfileUrl: string | null
	/** The public certificate-verification URL (`/verify/{id}`). */
	verifyUrl: string
	/** When the article was certified (ISO 8601) — the same date baked into the bylines. */
	certifiedAt: string
	/** The last real content change after certification (ISO 8601), or null. */
	contentModifiedAt: string | null
	/** The article's AUTHOR (a different person from the reviewer; carries no verification claim). */
	authorName: string | null
	authorTitle: string | null
	/** Brand display prefs the rendering component honors. */
	display: {
		showExpertPhoto: boolean
		/** When false the component renders `bylinePlain` even if the credentialed form was delivered. */
		showCredentials: boolean
	}
	/** The brand's ACTIVE resolved render-def projection, or null (⇒ preset default). */
	renderDef: CertChromeRenderDef | null
	/** Version of the delivered string set (`data-certrev-strings-version` for the crawl monitor). */
	stringsVersion: string
}

/**
 * The ordered keys of `BuilderCertChromeData` — the SINGLE SOURCE the Builder
 * `inputs` array and the W3 exporter⇄inputs⇄wire-type parity lock derive from, so
 * the three can never silently drift again (POR-10721 W3). Adding a field to the
 * interface without adding it here (or vice-versa) fails the `keyof` exhaustiveness
 * check in `assertChromeKeysExhaustive` below.
 */
export const BUILDER_CERT_CHROME_KEYS = [
	'bylineCredentialed',
	'credentialVerification',
	'bylinePlain',
	'reviewerName',
	'bio',
	'background',
	'memo',
	'compensationCue',
	'scopeLine',
	'reviewerPhoto',
	'reviewerProfileUrl',
	'verifyUrl',
	'certifiedAt',
	'contentModifiedAt',
	'authorName',
	'authorTitle',
	'display',
	'renderDef',
	'stringsVersion',
] as const

export type BuilderCertChromeKey = (typeof BUILDER_CERT_CHROME_KEYS)[number]

/**
 * Compile-time proof that `BUILDER_CERT_CHROME_KEYS` === `keyof BuilderCertChromeData`
 * exactly (both directions). If a field is added/removed on the interface without the
 * matching key edit, ONE of these two assignments stops type-checking — so the tuple
 * can never drift from the type silently.
 */
const _keysCoverType: Record<keyof BuilderCertChromeData, true> = Object.fromEntries(
	BUILDER_CERT_CHROME_KEYS.map((k) => [k, true]),
) as Record<BuilderCertChromeKey, true>
const _typeCoversKeys: Record<BuilderCertChromeKey, true> = _keysCoverType
void _typeCoversKeys
