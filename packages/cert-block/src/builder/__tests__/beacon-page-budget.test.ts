// @vitest-environment jsdom
/**
 * Final review R1-10 (2026-10-24): the browser's beacon budget (three per page) and the fallback dedupe were kept for the
 * whole session, so after an in-app navigation a new article's fallbacks were dropped. A page is a document address:
 * an in-app navigation to another article starts a new budget and reports its fallbacks again.
 */

import { afterEach, beforeEach, expect, it } from 'vitest'
import { BEACON_MAX_PER_PAGE, setCardBeaconForTests } from '../card-beacon.js'
import { forgetCardReportsForTests, reportCardFallbackInBrowser } from '../card-report.js'

let sent: string[]
let restore: () => void

beforeEach(() => {
	history.replaceState(null, '', '/blogs/the-elf-word/first')
	sent = []
	restore = setCardBeaconForTests({ transport: (_url, body) => sent.push(JSON.parse(body).externalId) })
	forgetCardReportsForTests()
})
afterEach(() => restore())

const fail = (externalId: string) =>
	reportCardFallbackInBrowser({ reason: 'delivery_unreachable', platform: 'builder', externalId })

it('at most three beacons on one page; an in-app navigation starts a new budget', () => {
	for (const id of ['a', 'b', 'c', 'd', 'e']) fail(id)
	expect(sent).toEqual(['a', 'b', 'c'])
	expect(sent).toHaveLength(BEACON_MAX_PER_PAGE)
	history.pushState(null, '', '/blogs/the-elf-word/second')
	for (const id of ['f', 'g', 'h', 'i']) fail(id)
	expect(sent).toEqual(['a', 'b', 'c', 'f', 'g', 'h'])
})

it('the same placement and reason reports once per page, and again after a navigation back to it', () => {
	fail('a')
	fail('a')
	expect(sent).toEqual(['a'])
	history.pushState(null, '', '/blogs/the-elf-word/second')
	fail('a')
	expect(sent).toEqual(['a', 'a'])
})
