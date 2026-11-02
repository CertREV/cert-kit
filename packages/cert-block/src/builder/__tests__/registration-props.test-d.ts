/**
 * 2.0.0 adds no prop: `CertReviewCardProps` has exactly 1.3.1's keys (the 20 wire keys of `BuilderCertChromeData`,
 * whose runtime list `registration-1.x.test.ts` holds to 1.3.1's, and `mode`, `part`, `builderContext`, `clientRead`).
 * Checked by the compiler (`vitest --typecheck`, the package's `test` script), both ways.
 */

import { expectTypeOf, test } from 'vitest'
import type { BuilderCertChromeData } from '../cert-chrome-data.js'
import type { CertReviewCardProps } from '../cert-review-card.js'

type Props131 = keyof BuilderCertChromeData | 'mode' | 'part' | 'builderContext' | 'clientRead'

test('the props are exactly 1.3.1’s', () => {
	expectTypeOf<keyof CertReviewCardProps>().toEqualTypeOf<Props131>()
	expectTypeOf<Exclude<keyof CertReviewCardProps, Props131>>().toEqualTypeOf<never>()
	expectTypeOf<Exclude<Props131, keyof CertReviewCardProps>>().toEqualTypeOf<never>()
	// The wire type is still 20 keys (a key added to it would be a prop added here).
	expectTypeOf<keyof BuilderCertChromeData>().toEqualTypeOf<
		| 'bylineCredentialed'
		| 'credentialVerification'
		| 'bylinePlain'
		| 'reviewerName'
		| 'bio'
		| 'background'
		| 'memo'
		| 'compensationCue'
		| 'scopeLine'
		| 'reviewerPhoto'
		| 'reviewerProfileUrl'
		| 'verifyUrl'
		| 'certifiedAt'
		| 'contentModifiedAt'
		| 'authorName'
		| 'authorTitle'
		| 'display'
		| 'renderDef'
		| 'stringsVersion'
		| 'delivery'
	>()
})
