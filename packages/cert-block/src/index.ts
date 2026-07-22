/**
 * @certrev/cert-block — the headless / crypto_verify render edge for CertREV.
 *
 * Public API:
 *   • React components — <CertBadge>, <ExpertBio>, <CertRevBacklink>, <CertJsonLd>,
 *     <CertReview> (composite). SSR-safe, theme-light, accessible, escaping every field.
 *   • JSON-LD projector — deterministic facts → schema.org Article+reviewedBy(Person)
 *     graph, mergeable by @id (won't collide with Yoast).
 *   • Verify layer — `getVerifiedEnvelope` (fetch from metafield OR Delivery API + run
 *     the fail-closed VerdictKernel + cache), kid resolvers, the TTL/single-flight cache.
 *   • Contract types — re-exported from `@certrev/cert-contract` (the binding point in
 *     ./contract/kernel).
 *
 * EDGE-RUNTIME SAFE. This main entry imports NO `node:crypto` and uses NO `Buffer`, so it
 * loads + runs on edge/Workers runtimes (Shopify Oxygen, Cloudflare Workers, Vercel Edge).
 * Two things are deliberately kept OFF this entry:
 *   • the Web Component (`<certrev-badge>`) → './webcomponent' subpath (touches
 *     `customElements`, undefined server-side);
 *   • the Node-only test/dev fixtures (`makeSignedEnvelope`, which signs with `node:crypto`)
 *     → './fixtures' subpath. Importing the main entry must never pull a Node builtin.
 */

// ── React components ──────────────────────────────────────────────────────────────
export { CertBadge, type CertBadgeProps } from './components/CertBadge.js'
export { CertJsonLd, type CertJsonLdProps } from './components/CertJsonLd.js'
export { CertRevBacklink, type CertRevBacklinkProps } from './components/CertRevBacklink.js'
export { CertReview, type CertReviewProps } from './components/CertReview.js'
export { ExpertBio, type ExpertBioProps } from './components/ExpertBio.js'
export { escapeAttribute, escapeHtml, safeCssColor, safeHttpUrl, tidyText } from './components/escape.js'
// ── Presentation helpers (shared with the Web Component) ────────────────────────────
export {
	credentialSuffix,
	DEFAULT_ACCENT,
	expertNameWithCredentials,
	formatDate,
	type ResolvedDisplay,
	resolveDisplay,
} from './components/format.js'
// ── Pre-sales PREVIEW block — static, non-delivery, hard-bounded (POR-10743) ──
export {
	type PreviewBlockOptions,
	previewExpiry,
	renderPreviewBlock,
} from './components/preview-block.js'
// ── Cert-render BLOCK — the LOCKED 3-mode cert design as an SSR-safe HTML string ──
export {
	type CertBlockFace,
	type CertBlockFacts,
	type CertBlockLayout,
	type CertBlockMode,
	type RenderCertBlockInput,
	renderCertBlock,
} from './components/render-cert-block.js'
// ── Design-guide render-def support (WS6: themeable tokens + subtractive visibility) ──
export {
	accentFg,
	type BadgeVisibilityFieldId,
	CERT_SCOPE_LINE,
	CERT_STRINGS_VERSION,
	type CertRenderDef,
	type CertThemeTokens,
	COMPENSATED_EXPERT_CUE,
	CREDENTIAL_VERIFIED_ATTRIBUTION,
	DEFAULT_BLOCK_THEME,
	FONT_SLOTS,
	FONT_STACKS,
	type FontSlot,
	HIDEABLE_FIELDS,
	isCornerRadius,
	isFieldHidden,
	isFontSlot,
	isOpaqueHexColor,
	isRenderBlockFontSlot,
	RENDER_BLOCK_FONT_SLOTS,
	RENDER_BLOCK_FONT_STACKS,
	type RenderBlockFontSlot,
	type ResolvedBlockTheme,
	type ResolvedRenderTheme,
	resolveBlockTheme,
	resolveRenderTheme,
	themeCssVarDeclarations,
} from './components/render-def.js'
// ── Contract surface (types + kernel) — re-export the binding point ────────────────
// NOTE: the test/dev fixtures (makeSignedEnvelope, makeMockPayload, FIXTURE_KID) are
// Node-only (they sign with node:crypto) and ship from the './fixtures' subpath, NOT here.
export {
	CANONICALIZATION,
	type CertContent,
	type CertCredential,
	type CertDeliveryEnvelope,
	type CertDisplayConfig,
	type CertLifecycle,
	type CertPayload,
	type CertSignature,
	type CertSubject,
	type CertSuppressReason,
	type CertVerdict,
	CONTRACT_VERSION,
	type ContractVersion,
	type Ed25519PublicKeyInput,
	type RenderContext,
	type ResolvePublicKeyByKid,
	renderVerdict,
	SIGNATURE_ALG,
	type SignatureAlg,
	type VerdictKernel,
	verifyEnvelope,
	verifySignatureOnly,
} from './contract/kernel.js'
// ── JSON-LD projector ───────────────────────────────────────────────────────────────
export {
	type JsonLdValue,
	type ProjectJsonLdOptions,
	projectCertJsonLd,
	projectCertJsonLdString,
	serializeJsonLdForScript,
} from './jsonld/project.js'
export { TtlCache, type TtlCacheOptions } from './verify/cache.js'
// ── Verify layer ──────────────────────────────────────────────────────────────────
export {
	type EnvelopeSource,
	type GetVerifiedEnvelopeOptions,
	getVerifiedEnvelope,
	invalidateVerdict,
	sharedVerdictCache,
} from './verify/get-verified-envelope.js'
export {
	type FetchingKidResolverOptions,
	fetchingKidResolver,
	type StaticKeySet,
	staticKidResolver,
} from './verify/resolve-kid.js'
// ── Web Component string renderer (the markup shared by SSR + the custom element) ──
export { type RenderBadgeOptions, renderBadgeHtml } from './webcomponent/render-badge-html.js'
