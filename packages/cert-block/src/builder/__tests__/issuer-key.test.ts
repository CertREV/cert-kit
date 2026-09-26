// @vitest-environment jsdom
/**
 * The Builder card's baked trust root is a COPY of the storefront modal's (the modal entry
 * defines a custom element at import, so the card cannot import it). Pinned equal here so a key
 * rotation that updates one and not the other fails the build instead of shipping a card that
 * suppresses every cert, or trusts a retired key.
 */

import { expect, it } from 'vitest'
import * as modal from '../../modal/certrev-cert.entry.js'
import { CERT_ISSUER_KID, CERT_ISSUER_PUBLIC_KEY_PEM } from '../issuer-key.js'

it('matches the storefront modal trust root', () => {
	const m = modal as unknown as { CERT_ISSUER_KID?: string; CERT_ISSUER_PUBLIC_KEY_PEM?: string }
	expect(m.CERT_ISSUER_KID).toBe('cert-issuer-1')
	expect(CERT_ISSUER_KID).toBe(m.CERT_ISSUER_KID)
	expect(CERT_ISSUER_PUBLIC_KEY_PEM).toBe(m.CERT_ISSUER_PUBLIC_KEY_PEM)
})
