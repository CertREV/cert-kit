/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CertDeliveryEnvelope — the signed, platform-agnostic certification credential
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHAT THIS IS
 *   CertREV's durable asset is a portable, forgery-proof "this content was reviewed
 *   by a credentialed expert" credential. The issuer mints + SIGNS one of these per
 *   certified placement; each delivery edge (WordPress plugin, Shopify theme app
 *   extension, headless-React SDK, Web Component) reproduces the canonical bytes,
 *   verifies the signature, and renders the visible UI + JSON-LD from it.
 *   Sign once, deliver everywhere.
 *
 * THE TWO DESIGN INVARIANTS (panel-revised)
 *
 *   1. SIGN FACTS, NOT RENDERED JSON-LD.
 *      `payload.content` holds STRUCTURED FACTS (expert, author, memo, dates, the
 *      verify URL, display config). The schema.org JSON-LD is PROJECTED from these
 *      facts at the edge — it is NOT part of the signed payload. A schema.org change
 *      (new property, vocabulary tweak) therefore never forces re-signing every live
 *      credential; only the projection at the edge changes.
 *
 *   2. THE SIGNATURE IS DETACHED Ed25519 OVER THE RFC-8785 (JCS) CANONICALIZATION
 *      OF `payload`.
 *      Any language (TS, PHP, Go, …) that implements RFC 8785 reproduces byte-for-byte
 *      identical signing input and so can verify the same signature. The signature does
 *      NOT cover `signature` itself (detached). See `canonical.ts` + `vectors.json`.
 *
 * CROSS-LANGUAGE BOUNDARY — keep the payload JSON-clean
 *   No `Date` objects on the wire (ISO-8601 strings only), no functions, no `undefined`,
 *   stable field names. The canonical bytes are `canonicalize(payload)` (RFC 8785) so a
 *   PHP libsodium verifier and a Node WebCrypto verifier hash identical input.
 */

/** Bump on ANY breaking change to the payload shape or signing rules. */
export const CONTRACT_VERSION = 1 as const
export type ContractVersion = typeof CONTRACT_VERSION

/** The canonicalization scheme used for BOTH signing and verification. */
export const CANONICALIZATION = 'RFC8785-JCS' as const

/** The signature algorithm. Ed25519 (PureEdDSA) — verifiable in PHP via libsodium
 *  `sodium_crypto_sign_verify_detached`, in Node via `crypto.verify(null, …)` /
 *  WebCrypto, and matching GCP KMS `EC_SIGN_ED25519`. */
export const SIGNATURE_ALG = 'ed25519' as const
export type SignatureAlg = typeof SIGNATURE_ALG

/**
 * POST-QUANTUM MIGRATION — additive by construction, never a rebuild (v0.2 design note).
 *
 *   The envelope already carries `signature.alg` + `signature.kid`, so migrating to a
 *   post-quantum scheme (e.g. ML-DSA-65 / SLH-DSA, now in GCP KMS preview) is an ADDITIVE
 *   change, NOT a re-mint of the live fleet:
 *     1. Widen `SignatureAlg` with the new alg + add its raw-signature length to
 *        `RAW_SIGNATURE_BYTE_LENGTHS` (signer.ts) — the mint-time length check is already
 *        keyed BY alg, so it stays additive (no assertion rewrite).
 *     2. Publish the new public key under a new `kid`; start signing new mints with it.
 *     3. Edges keep the old `kid` resolvable during the overlap window, so every already-
 *        minted Ed25519 envelope keeps verifying. Retire the old key only after all edges
 *        ship the new one. Nothing re-signs; the switch is per-signature via `kid`.
 *
 * ROTATION ESCAPE HATCH — a publishable trusted-key set (JWKS / did:web), not a hard-coded
 *   map: resolving `kid → public key` from a served, signed key set (rather than a static
 *   `TRUSTED_KMS_KEYS` compiled into every edge) means a key rotation is a publish, not a
 *   code deploy to every render edge. The `kid`-indexed `ResolvePublicKeyByKid` seam
 *   (kernel.ts) is already the injection point for that resolver.
 */

// ── Subject — richer identity binding ───────────────────────────────────────────
/**
 * Binds the credential to a STABLE identity, not just one URL or slug. The signature
 * covers all of this, so copying the envelope onto a different article (externalId
 * mismatch) or editing the reviewed content (contentDigest mismatch) is detected at
 * the edge and the badge is suppressed. The extra identity fields let the credential
 * survive slug renames, locale variants, and rebuilds without re-minting.
 */
export interface CertSubject {
	/** Platform the envelope was minted for (defense-in-depth; an edge rejects an
	 *  envelope minted for another platform). e.g. 'shopify', 'wordpress', 'headless'. */
	readonly platform: string
	/** Stable per-placement id on the platform: WordPress numeric post id (as string),
	 *  Shopify Article GID, etc. The edge compares this to the article it is rendering
	 *  on and fails closed on mismatch. This is the primary anti-move / anti-forgery key. */
	readonly externalId: string
	/** CertREV's own stable, platform-independent article identity. Survives a platform
	 *  migration or republish under a new externalId; lets the issuer reconcile a
	 *  credential to its logical article across rebuilds. */
	readonly logicalArticleId: string
	/** Every canonical public URL this credential may legitimately render on (primary +
	 *  locale variants + a known slug-rename). Informational for the edge; lets the issuer
	 *  bind one credential to a stable identity across slug/locale/rebuild churn without
	 *  re-minting on every URL change. */
	readonly canonicalUrls: ReadonlyArray<string>
	/** App/connection install id that placed this credential (which Shopify app install,
	 *  which WP site connection). Scopes the credential to an installation for ownership
	 *  + revocation reasoning. Null when not applicable (e.g. pure delivery-API pull). */
	readonly installationId: string | null
	/** Lowercase hex SHA-256 over the canonicalized reviewed article body — the
	 *  anti-drift + anti-substitution anchor. Null when the issuer chose not to bind
	 *  content (e.g. a placement whose live body it can't observe); the edge then
	 *  SKIPS the drift check rather than failing it. */
	readonly contentDigest: string | null
}

// ── Display — native theming inputs (presentation-free) ─────────────────────────
/**
 * @deprecated v0.2 — PRESENTATION EVICTED FROM THE SIGNED ENVELOPE.
 *
 * Per-brand presentation now lives in the `brand_render_defs` plane (resolved at render
 * from the design guide), NOT in signed facts. `accentColor` — a pure theming token
 * inside signed facts — was the boundary violation this eviction closes. The field is
 * kept, optional, on `CertContent` for an INDEFINITE ACCEPT-ON-READ window: already-minted
 * v0.1.x envelopes still carry `display` and MUST keep verifying byte-identically. The
 * issuer NEVER WRITES it from v0.2 onward (see `assemble-cert-mint-source.ts`), and edges
 * read the def, not this block. New readers must not depend on it.
 */
export interface CertDisplayConfig {
	readonly accentColor?: string | null
	readonly showExpertPhoto?: boolean
	readonly showAuthor?: boolean
	readonly showMemo?: boolean
	readonly badgeStyle?: 'full' | 'compact'
}

// ── Content — the human-facing FACTS, rendered + projected to JSON-LD natively ──
/**
 * Presentation-free certification facts. NO HTML, NO rendered JSON-LD — each edge
 * renders these in its own platform idiom (PHP for WP, Liquid for Shopify, JSX for
 * React), escaping every field, and PROJECTS the schema.org JSON-LD from them. This
 * is the decoupling (invariant #1) that lets schema.org evolve without re-signing.
 */
/**
 * PER-FIELD COMPLIANCE VOCABULARY (v0.2) — the "one deliberate crossing" between the
 * signed envelope (facts) and the design guide (law). Its VOCABULARY lives here (the
 * contract is the canonical source that the portal `design-guide/` field-catalog aligns
 * to); its VALUES are stamped into the envelope AT MINT — a projection of the guide's law
 * so a render edge enforces the mint-time floor OFFLINE, without fetching the guide.
 *
 *  - `free`   — the brand may place or (subtractively) hide it; carries no dated/verified
 *               claim on its own (a plain byline, the reviewer photo, the memo).
 *  - `gated`  — never delivered bare; only ever reaches the face fused inside another
 *               field. The reviewer credential is the canonical gated datum: on the face
 *               it exists ONLY inside the credentialed byline, so "show the credential,
 *               drop the verification" is unrepresentable by construction.
 *  - `fused`  — a single pre-composed, inseparable string (the credentialed byline);
 *               rendered verbatim, never re-assembled at a call site.
 *  - `locked` — CertREV owns it: required-and-unremovable when the rung demands it (the
 *               compensation cue, the scope line) or fixed chrome. Never brand-editable,
 *               never in the themeable token allowlist.
 *
 * A guide *tightening* re-classes a field; the crawl monitor then flags faces stamped at
 * the older floor for RE-RENDER (never re-mint) — the stamped class is the mint-time floor.
 */
export type ComplianceClass = 'free' | 'gated' | 'fused' | 'locked'

/**
 * A single VERIFIED expert credential as it appears on the wire (e.g. `RDN`,
 * `Registered Dietitian Nutritionist`). Named (not inline) so every edge — the React
 * SDK, the Web Component, downstream verifiers — imports the SAME credential type from
 * the contract instead of re-declaring it. Purely a naming of the existing inline shape:
 * the canonical bytes are unchanged, so this is additive and forces no re-signing.
 */
export interface CertCredential {
	readonly abbreviation: string
	readonly fullName: string
	/** POR-9738: optional DISPLAY-only byline override; the byline renders
	 *  `cardLabel ?? abbreviation`, but the `abbreviation` stays the stable key. Formalized
	 *  in v0.2 (already stamped on the wire by the portal — additive, byte-neutral). */
	readonly cardLabel?: string | null
	/** v0.2 per-field compliance class (the reviewer credential is the canonical `gated`
	 *  datum). VALUE stamped at mint; vocabulary is guide law. Optional so pre-v0.2
	 *  envelopes (no class stamped) verify unchanged. */
	readonly complianceClass?: ComplianceClass
	/** v0.2: does this field form a pre-click endorsement impression on the article face?
	 *  Any claim-bearing field pulls the compensation cue + scope line on-face (the
	 *  claim-scaled ladder). Optional for pre-v0.2 back-compat. */
	readonly claimBearing?: boolean
}

export interface CertContent {
	readonly expert: {
		readonly displayName: string
		/** VERIFIED credentials only (unverified are never delivered). */
		readonly credentials: ReadonlyArray<CertCredential>
		readonly profileUrl: string | null
		readonly photoUrl: string | null
		/** v0.2 (POR-9731): the reviewer's QA-VERIFIED short bio (inline on the contributors
		 *  card). Formalized from the portal-side extension it already rode as — additive +
		 *  byte-neutral (`expert` is copied by reference into the signed content). */
		readonly bio?: string | null
		/** v0.2 (POR-9731): the reviewer's QA-VERIFIED long background (the profile modal
		 *  body copy). Same verified-only + wire-safe rules as `bio`. */
		readonly background?: string | null
		/** v0.2 (POR-10496 / POR-9731) — THE COMPENSATION FACT, first-class.
		 *  A FINISHED, pre-composed material-connection cue (`Compensated expert`), derived
		 *  from the FROZEN `certifications.compensated` flag; `null` for a pro-bono reviewer
		 *  (the edge omits the cue). Never re-assembled brand-side. Already stamped untyped by
		 *  the portal (`assemble-cert-mint-source.ts`) — typing it here is BYTE-NEUTRAL. */
		readonly compensationCue?: string | null
	}
	readonly author: {
		readonly name: string
		readonly title: string | null
		/** v0.2 (POR-9731): author headshot URL — formalized from the portal-side extension
		 *  it already rode as (additive, byte-neutral). */
		readonly photoUrl?: string | null
		/** v0.2 (POR-9731): author short bio (verified-only, rendered on the contributors card). */
		readonly bio?: string | null
	}
	/** Expert first-person memo as plain text/markdown (edge sanitizes/escapes).
	 *  Null when the review carried no memo. */
	readonly memo: string | null
	/** ISO-8601 — when the expert signed off (drives "Certified {date}"). */
	readonly certifiedAt: string
	/** ISO-8601 or null — latest content-version date (drives "Last updated {date}"). */
	readonly contentModifiedAt: string | null
	/** Canonical public certificate/verification URL. ALWAYS the real-time source of
	 *  truth — the local badge is a bounded-stale snapshot; this link is live. */
	readonly verifyUrl: string
	/**
	 * v0.4 (POR-10102 / POR-10481) — the certified article's TITLE (the certificate modal's
	 * "Certifies the article" block). A TOP-LEVEL content fact the portal's `assembleCertFacts`
	 * already targets (`assemble-cert-mint-source.ts`); formalized here so the contract type
	 * declares it. Optional + byte-neutral: pre-v0.4 envelopes omit it and verify unchanged.
	 *
	 * v0.5 (POR-10481) — WIRED onto the signed wire. Unlike the nested `expert.*` / `author.*`
	 * extensions (which reach the signed bytes for free because `buildPayload` copies those objects
	 * wholesale), a top-level `content` extension only rides once `buildPayload` (signer.ts) enumerates
	 * it — which it now does (omit-when-undefined, mirroring `display`). So a mint that supplies
	 * `articleTitle` carries it on the signed bytes; a mint that omits it stays byte-identical to a
	 * pre-v0.5 envelope. Declared as a type in v0.4; threaded onto the wire in v0.5.
	 */
	readonly articleTitle?: string | null
	/**
	 * v0.4 (POR-10102 / POR-10481) — a pretty DISPLAY-ONLY certificate id (`CR-YYYY-NNNN`) for the
	 * modal meta row: a deterministic derivation of `certId` + the certified year, NOT a second
	 * identity (the real verifiable link is always `verifyUrl`). Same TOP-LEVEL placement,
	 * byte-neutrality, and `buildPayload` thread-through caveat as `articleTitle` above.
	 */
	readonly displayCertId?: string | null
	/**
	 * @deprecated v0.2 — evicted to `brand_render_defs` (accept-on-read / never-write).
	 * OPTIONAL from v0.2: the issuer no longer stamps it, so new envelopes omit it entirely
	 * and their canonical bytes carry no `display` key. Already-minted v0.1.x envelopes still
	 * carry it and verify unchanged (edges ignore it). Do not read this in new code — resolve
	 * presentation from the render def instead.
	 */
	readonly display?: CertDisplayConfig
}

// ── Lifecycle — validity window driving fail-closed + reconciliation ────────────
export interface CertLifecycle {
	/** ISO-8601 issue time. */
	readonly issuedAt: string
	/** ISO-8601 hard stop. After this the edge renders NOTHING until the issuer pushes
	 *  a fresh envelope — bounds staleness on a site we don't control. Choose a window
	 *  comfortably longer than the reconciliation interval. */
	readonly expiresAt: string
	/** ISO-8601 when revoked, else null. Non-null → edge renders nothing (fail-closed). */
	readonly revokedAt: string | null
	/** Monotonic per-placement revision. Last-writer-wins on the edge; lets a
	 *  reconciliation read ignore an out-of-order older push. */
	readonly revision: number
}

// ── The unsigned payload (THIS is what gets canonicalized + signed) ─────────────
export interface CertPayload {
	readonly contractVersion: ContractVersion
	/** Stable CertREV certification id — idempotency key across pushes/reconciliations. */
	readonly certId: string
	readonly subject: CertSubject
	readonly content: CertContent
	readonly lifecycle: CertLifecycle
}

// ── Detached signature over canonicalize(payload) ───────────────────────────────
export interface CertSignature {
	readonly alg: SignatureAlg
	/** Key id — selects which issuer public key the verifier uses. Enables rotation:
	 *  ship N+1 public keys to the edge, start signing with the new kid, retire the old
	 *  after all edges have updated. For the live signing root this is the GCP KMS
	 *  cryptoKeyVersion resource name. */
	readonly kid: string
	/** base64url-encoded detached Ed25519 signature over the RFC-8785 canonical bytes
	 *  of `payload` (the raw 64-byte signature, base64url with no padding). */
	readonly sig: string
	/** ISO-8601 signing time. */
	readonly signedAt: string
}

/**
 * THE artifact written to the platform's native store (WordPress post-meta /
 * Shopify app-owned metafield) or served by the delivery API and consumed by the
 * render edge. The shared seam — edges depend on this type, not on each other.
 */
export interface CertDeliveryEnvelope {
	readonly payload: CertPayload
	readonly signature: CertSignature
}

// ── Tombstone — the slim revocation artifact (POR-10481) ─────────────────────────
/**
 * POR-10481 — the SLIM revocation artifact. A revoked placement's Delivery response
 * should prove "this subject is revoked" and nothing more — it must NOT ship the certified
 * facts (expert identity, credentials, memo, author) that a blanked badge has no business
 * carrying (an avoidable privacy + payload-size leak). So instead of re-minting a full
 * `CertDeliveryEnvelope` with `lifecycle.revokedAt` set, the issuer mints THIS: the SUBJECT
 * (so the edge's platform/externalId match still works), the revocation facts, and a
 * detached Ed25519 signature over the RFC-8785 canonicalization of the signable fields —
 * signed by the SAME trust root as an envelope, so the kernel never trusts an unsigned
 * tombstone.
 *
 * `kind: 'tombstone'` is the discriminator: a `CertDeliveryEnvelope` carries no top-level
 * `kind`, so an edge tells the two apart without shape-sniffing. An OLD kernel (pre-0.3.0)
 * that receives a tombstone fails its envelope shape-check (`!payload`) and SUPPRESSES —
 * fail-closed, the correct blank-badge outcome for a revoked cert — so serving a tombstone
 * to an un-upgraded edge is safe.
 */
export interface CertTombstoneSignable {
	readonly kind: 'tombstone'
	readonly contractVersion: ContractVersion
	/** Reused VERBATIM from the envelope so the edge's platform + externalId match is
	 *  unchanged — a tombstone for another article must not blank this one. */
	readonly subject: CertSubject
	/** ISO-8601 — the moment of revocation. */
	readonly revokedAt: string
	/** WHY it was revoked (issuer-domain string: `cert_revoked` | `superseded` | `held` | …).
	 *  A signed fact the Delivery response may surface; the kernel maps ANY valid tombstone to
	 *  `suppress: 'revoked'` regardless of this value. */
	readonly revocationReason: string
}

/** The signed slim tombstone: the `CertTombstoneSignable` fields + a detached signature over
 *  their RFC-8785 canonical bytes (see `canonicalTombstoneBytes` in `canonical.ts`). */
export interface CertTombstone extends CertTombstoneSignable {
	readonly signature: CertSignature
}

/** A Delivery response is EITHER the full facts-signed envelope OR the slim tombstone,
 *  distinguished by the tombstone's `kind: 'tombstone'` discriminator. */
export type CertDeliveryArtifact = CertDeliveryEnvelope | CertTombstone

// ── Verdict — the verification + freshness ALGORITHM result ──────────────────────
/**
 * The result of running the VerdictKernel over an envelope. `render` carries the
 * verified payload so the edge can project JSON-LD + render the badge from facts it
 * has cryptographically confirmed. Everything else is fail-closed: render NOTHING.
 */
export type CertVerdict =
	| { readonly decision: 'render'; readonly payload: CertPayload }
	| { readonly decision: 'suppress'; readonly reason: CertSuppressReason }

export type CertSuppressReason =
	/** Envelope shape / contractVersion couldn't be parsed or isn't understood. */
	| 'unsupported_contract_version'
	/** signature.alg is not 'ed25519'. */
	| 'unsupported_alg'
	/** signature.kid resolved to no public key. */
	| 'unknown_key'
	/** Ed25519 verification over canonicalize(payload) failed (tamper / wrong key). */
	| 'invalid_signature'
	/** subject.platform did not match the rendering platform. */
	| 'platform_mismatch'
	/** subject.externalId did not match the article being rendered. */
	| 'subject_mismatch'
	/** lifecycle.revokedAt is non-null. */
	| 'revoked'
	/** now >= lifecycle.expiresAt. */
	| 'expired'
	/** live content hash present and != subject.contentDigest. */
	| 'content_drift'
