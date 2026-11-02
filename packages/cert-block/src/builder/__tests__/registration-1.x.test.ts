/**
 * 2.0.0 installs as a drop-in for 1.x: the same registered component (name, description, inputs, the Builder props it
 * asks for, the component itself), no new prop, and every 1.x export still there. The frozen copy
 * (`__golden__/registration-1.3.1.json`) was dumped from cert-block 1.3.1's own build (cert-kit 599d9ce) before any
 * 2.0.0 change; it is compared, not regenerated.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILDER_CERT_CHROME_KEYS } from '../cert-chrome-data.js'
import * as builder from '../index.js'

interface Frozen {
	readonly CERT_COMPONENT_NAME: string
	readonly certRevCertComponent: Record<string, unknown>
	readonly BUILDER_REGISTRATION: Record<string, unknown>
	readonly componentIsCertReviewCard: boolean
	readonly builderExports: string[]
	readonly BUILDER_CERT_CHROME_KEYS: string[]
	readonly packageExports: string[]
}

const frozen = JSON.parse(
	readFileSync(join(process.cwd(), 'src/builder/__tests__/__golden__/registration-1.3.1.json'), 'utf8'),
) as Frozen

const registration = (r: {
	name: string
	description?: string
	inputs: readonly unknown[]
	shouldReceiveBuilderProps: unknown
}) =>
	JSON.parse(
		JSON.stringify({
			name: r.name,
			...(r.description ? { description: r.description } : {}),
			inputs: r.inputs,
			shouldReceiveBuilderProps: r.shouldReceiveBuilderProps,
		}),
	)

describe('the registered component is 1.3.1’s', () => {
	it('the same name: CertREV Cert', () => {
		expect(builder.CERT_COMPONENT_NAME).toBe('CertREV Cert')
		expect(builder.CERT_COMPONENT_NAME).toBe(frozen.CERT_COMPONENT_NAME)
		expect(builder.certRevCertComponent.name).toBe(frozen.CERT_COMPONENT_NAME)
		expect(builder.BUILDER_REGISTRATION.name).toBe(frozen.CERT_COMPONENT_NAME)
	})

	it('the same registration, input for input (no input added, removed or changed)', () => {
		expect(registration(builder.certRevCertComponent)).toEqual(frozen.certRevCertComponent)
		expect(registration(builder.BUILDER_REGISTRATION)).toEqual(frozen.BUILDER_REGISTRATION)
		expect(builder.certRevCertComponent.component).toBe(builder.CertReviewCard)
		expect(frozen.componentIsCertReviewCard).toBe(true)
	})

	it('the same wire keys the exporter writes', () => {
		expect([...BUILDER_CERT_CHROME_KEYS]).toEqual(frozen.BUILDER_CERT_CHROME_KEYS)
	})

	it('every 1.3.1 export of the builder entry is still exported', () => {
		const now = Object.keys(builder)
		for (const name of frozen.builderExports) expect(now).toContain(name)
	})

	it('every 1.3.1 package export path is still in the exports map', () => {
		const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
			exports: Record<string, unknown>
		}
		for (const path of frozen.packageExports) expect(Object.keys(pkg.exports)).toContain(path)
	})
})

describe('no new prop', () => {
	// The compile-time half is `registration-props.test-d.ts` (vitest typecheck: `keyof CertReviewCardProps` is 1.3.1's).
	it('every Builder input is a prop the component reads (the registration adds none of its own)', () => {
		const props: readonly string[] = [
			...frozen.BUILDER_CERT_CHROME_KEYS,
			'mode',
			'part',
			'builderContext',
			'clientRead',
		]
		for (const input of builder.certRevCertComponent.inputs) expect(props).toContain(input.name)
	})
})
