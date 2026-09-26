/**
 * The CertREV issuer PUBLIC key the envelope-backed Builder card verifies against (1.1.0).
 *
 * A copy of `CERT_ISSUER_KID` / `CERT_ISSUER_PUBLIC_KEY_PEM` in `modal/certrev-cert.entry.ts`, not
 * an import of it: that entry registers a custom element and starts the storefront DOM passes at
 * import, which a React server render must not do, and moving the constant out of it would change
 * the storefront bundle the Shopify extension ships byte-for-byte. The two copies are pinned equal by
 * `builder/__tests__/issuer-key.test.ts`, so a rotation that updates one and not the other fails.
 */
export const CERT_ISSUER_KID = 'cert-issuer-1'
export const CERT_ISSUER_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAMWN956IOPjpAq900dL428VzA28TO/pVXnq3brwqUmwM=
-----END PUBLIC KEY-----`
