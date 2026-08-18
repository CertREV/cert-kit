/**
 * Link qualification for every anchor this package emits to a CertREV-owned host.
 *
 * The package renders links the consumer did not author and cannot edit: `CertBadgeProps`
 * has no `rel` input, and the string renderers build their anchors internally. That makes
 * qualification the PACKAGE's job — a consumer who wanted to qualify them has no seam to
 * do it through.
 *
 * Google's link-spam policy treats a link a vendor requires on a customer's page as
 * paid/placed unless it is qualified, and names the remedy explicitly: it is not a
 * violation "as long as they are qualified with rel='nofollow' or rel='sponsored'".
 * `sponsored` is the accurate token for a commercial placement; `nofollow` is carried
 * alongside it because it is the token every downstream tool actually reads. `noopener`
 * is unrelated to ranking and is kept for the window-handle hardening it always gave.
 *
 * There is NO override seam, deliberately: every anchor this package emits points at a
 * CertREV-owned host (a profile URL or a verify URL, both carried on the signed payload —
 * a brand cannot author either), so no consumer has a link of their own here to widen, and
 * an opt-out would only be a way to un-qualify the placement the policy is about. The
 * constant is exported so a consumer can READ the value and reason about it; the anchors
 * themselves are not configurable.
 */
export const CERTREV_LINK_REL = 'nofollow sponsored noopener'
