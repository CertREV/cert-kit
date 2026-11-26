/**
 * Tests for scripts/public-hygiene.mjs. Run: node --test scripts/
 *
 * The customer list here is a made-up brand ("Acme Widgets"), hashed exactly as the private
 * generator hashes real ones, so these tests prove the matching without naming anybody.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { customerHits, main, parseDenylist, RULES, scanText, termHash, tokens } from './public-hygiene.mjs'

const SALT = '00112233445566778899aabbccddeeff'
const TERMS = [
	['acme widgets', false],
	['acmewidgets', false],
	['acme', false],
	['ZORP', true], // a styled name that is an ordinary word otherwise: only the styled spelling matches
]
const DENYLIST_TEXT = ['# test list', `salt ${SALT}`, ...TERMS.map(([t, cs]) => termHash(SALT, t, cs)), ''].join('\n')
const denylist = parseDenylist(DENYLIST_TEXT)

const rule = (name) => RULES.find((r) => r.name === name)
/**
 * Planted examples carry a `§` that is stripped before scanning, so this file does not trip the tree check it tests
 * (an exemption for it would be a hole anyone could copy text into).
 */
const P = (s) => s.replaceAll('§', '')
const hits = (name, line) => rule(name).scan(P(line))

const scratch = mkdtempSync(join(tmpdir(), 'public-hygiene-test-'))
after(() => rmSync(scratch, { recursive: true, force: true }))
const listFile = join(scratch, 'denylist.txt')
writeFileSync(listFile, DENYLIST_TEXT)

/** Runs main() and captures its exit code and output. */
function run(args, env = { PUBLIC_HYGIENE_DENYLIST_FILE: listFile }) {
	const out = []
	const code = main(
		args,
		env,
		(s) => out.push(s),
		(s) => out.push(s),
	)
	return { code, out: out.join('\n') }
}

describe('customer names (hashed list)', () => {
	it('matches every spelling of a listed name', () => {
		for (const line of [
			'Acme Widgets ships this',
			"acme-widgets' storefront",
			'const ACME_WIDGETS_DEF = 1',
			'const acmeWidgetsDef = 1',
			'https://www.acmewidgets.com/blog',
			'fixture banner-acme-like.json',
			'A.C.M.E. is a customer',
		]) {
			assert.notEqual(customerHits(line, denylist).length, 0, line)
		}
	})

	it('does not match inside other words or across a partial name', () => {
		for (const line of ['acmeology', 'widgets alone', 'macme', 'the acmewidgetsplus host']) {
			assert.deepEqual(customerHits(line, denylist), [], line)
		}
	})

	it('a case-sensitive entry matches only its styled spelling', () => {
		assert.notEqual(customerHits('ZORP agency', denylist).length, 0)
		assert.deepEqual(customerHits('zorp, Zorp', denylist), [])
	})

	it('tokens: initialisms collapse, camelCase splits, separators separate', () => {
		assert.deepEqual(tokens('A.B.C. brandName my_key-x'), ['ABC', 'brand', 'Name', 'my', 'key', 'x'])
	})

	it('the list file names nobody: only a salt and hex digests', () => {
		assert.doesNotMatch(DENYLIST_TEXT, /acme|zorp/i)
	})
})

describe('parseDenylist', () => {
	it('an empty list or a list without a salt is no list (so it cannot pass as clean)', () => {
		assert.equal(parseDenylist(''), null)
		assert.equal(parseDenylist(`salt ${SALT}\n`), null)
		assert.equal(parseDenylist(`${termHash(SALT, 'x')}\n`), null)
	})
	it('a line that is not a digest is an error, not a skip', () => {
		assert.throws(() => parseDenylist(`salt ${SALT}\nacme widgets\n`))
	})
})

describe('personal-email', () => {
	it('flags a person and any free-mail address', () => {
		assert.deepEqual(hits('personal-email', 'contact jane§@certrev.com'), [P('jane§@certrev.com')])
		assert.deepEqual(hits('personal-email', 'or jane.doe§@gmail.com'), [P('jane.doe§@gmail.com')])
	})
	it('allows role mailboxes, reserved example domains, URL userinfo and package pins', () => {
		for (const line of [
			'email security@certrev.com',
			'support@certrev.com, hello@certrev.com',
			'user@example.com and a@brand.example.test',
			"['credentials', 'https://user:pw@portal.certrev.com/x.js']",
			'"@certrev/cert-block@3.0.0"',
			'Co-Authored-By: Bot <noreply§@example-vendor.com>',
			'Author: Someone <12345+someone§@users.noreply.github.com>',
		]) {
			assert.deepEqual(hits('personal-email', line), [], line)
		}
	})
})

describe('internal-host', () => {
	it('flags private infrastructure and unlisted certrev.com hosts', () => {
		for (const [line, host] of [
			['https://wp-test.cert§rev.com/', 'wp-test.cert§rev.com'],
			['db at ep-cool-tree-123.us-east-2.aws.neon§.tech', 'ep-cool-tree-123.us-east-2.aws.neon§.tech'],
			['preview https://portal-git-x.vercel§.app', 'portal-git-x.vercel§.app'],
			['shop.myshop§ify.com', 'shop.myshop§ify.com'],
			['ssh box.inter§nal', 'box.inter§nal'],
			['https://verify.cert§rev.dev/x', 'verify.cert§rev.dev'],
			['ping 10.0§.3.7', '10.0§.3.7'],
		]) {
			assert.deepEqual(hits('internal-host', line), [P(host)], line)
		}
	})
	it('allows the public CertREV hosts and example hosts', () => {
		assert.deepEqual(
			hits(
				'internal-host',
				'https://assets.certrev.com/a https://staging.portal.certrev.com cdn.example.test certrev.com',
			),
			[],
		)
	})
})

describe('internal-id', () => {
	it('flags mission, room and decision ids, tickets and private repo pointers', () => {
		for (const line of [
			'lead mission cert§rev-0123456789ab',
			'ro§om 9f3a77c2d1e0 decided',
			'(owner deci§sion 1a2b3c4d)',
			'// PO§R-1234: fix',
			'Cert§REV/portal 0123456789abcdef0123',
			'see por§tal#8352',
			'at /Use§rs/someone/dev/x',
		]) {
			assert.notEqual(hits('internal-id', line).length, 0, line)
		}
	})
	it("does not flag the product's own ids or standards ids", () => {
		assert.deepEqual(hits('internal-id', '"displayCertId": "CR-2026-0001", RFC-8785, SHA-256'), [])
	})
})

describe('personal-attribution', () => {
	it('flags the owner by name and a named, dated call', () => {
		assert.equal(hits('personal-attribution', 'the memo at the end (Ow§en: reviewer up top)').length, 1)
		assert.equal(hits('personal-attribution', 'left-justified (Da§na 2026-10-17: looks off)').length, 1)
	})
})

describe('secret', () => {
	it('flags secret-shaped strings', () => {
		const fakeGh = `ghp_${'a1B2'.repeat(9)}`
		for (const line of [
			'-----BEGIN RSA PRIVATE§ KEY-----',
			'-----BEGIN PRIVATE§ KEY-----',
			'AKIA§ABCDEFGHIJKLMNOP',
			`token: ${fakeGh}`,
			`npm_${'x'.repeat(36)}`,
			`sk_live_${'9'.repeat(24)}`,
			`Authorization: Bearer ${'abc123'.repeat(5)}`,
			'https§://deploy:hunter2secret@host.example.test/',
			`apiKey: "${'Zq8'.repeat(8)}"`,
		]) {
			assert.notEqual(hits('secret', line).length, 0, line)
		}
	})
	it('allows public keys, placeholders and obvious test values', () => {
		for (const line of [
			'-----BEGIN PUBLIC KEY-----',
			'https://user:pw@portal.certrev.com',
			'apiKey: "<your-key>"',
			`password: "${'x'.repeat(24)}"`,
			'sk_test_abc',
		]) {
			assert.deepEqual(hits('secret', line), [], line)
		}
	})
})

describe('allowlist', () => {
	it('suppresses one rule for one exact text in one file, and records the use', () => {
		const entry = { rule: 'personal-email', file: 'a.md', text: P('jane§@certrev.com'), why: 'test' }
		const used = new Set()
		assert.deepEqual(scanText('a.md', P('jane§@certrev.com'), denylist, [entry], used), [])
		assert.ok(used.has(entry))
		assert.equal(scanText('b.md', P('jane§@certrev.com'), denylist, [entry]).length, 1)
	})
})

describe('main: fails closed', () => {
	it('exits 2 without a customer list, whatever it scans', () => {
		const clean = join(scratch, 'clean.txt')
		writeFileSync(clean, 'nothing here\n')
		const r = run(['files', clean], {})
		assert.equal(r.code, 2)
		assert.match(r.out, /fails closed/)
	})
	it('exits 2 when the list is empty (a blank CI secret)', () => {
		const clean = join(scratch, 'clean2.txt')
		writeFileSync(clean, 'nothing here\n')
		assert.equal(run(['files', clean], { PUBLIC_HYGIENE_DENYLIST: '\n' }).code, 2)
	})
	it('exits 1 on a finding and 0 when clean', () => {
		const dirty = join(scratch, 'dirty.md')
		writeFileSync(dirty, '## 2.0.1: Acme Widgets one install\n')
		const r = run(['files', dirty])
		assert.equal(r.code, 1)
		assert.match(r.out, /customer-name/)
		const clean = join(scratch, 'clean3.md')
		writeFileSync(clean, '## 2.0.1: one install for a headless storefront\n')
		assert.equal(run(['files', clean]).code, 0)
	})
	it('reads the list from the PUBLIC_HYGIENE_DENYLIST secret as text', () => {
		const dirty = join(scratch, 'dirty2.md')
		writeFileSync(dirty, 'acme-widgets\n')
		assert.equal(run(['files', dirty], { PUBLIC_HYGIENE_DENYLIST: DENYLIST_TEXT }).code, 1)
	})
})

describe('main: tree and pack', () => {
	it('tree scans tracked and untracked-unignored files, not ignored ones', () => {
		const repo = join(scratch, 'repo')
		mkdirSync(repo)
		execFileSync('git', ['init', '-q'], { cwd: repo })
		writeFileSync(join(repo, '.gitignore'), 'dist/\n')
		mkdirSync(join(repo, 'dist'))
		writeFileSync(join(repo, 'dist', 'x.js'), P('// jane§@certrev.com\n'))
		writeFileSync(join(repo, 'README.md'), 'clean\n')
		assert.equal(run(['tree', repo]).code, 0)
		writeFileSync(join(repo, 'NEW.md'), P('mission cert§rev-0123456789ab\n'))
		const r = run(['tree', repo])
		assert.equal(r.code, 1)
		assert.match(r.out, /NEW\.md:1/)
	})
	it('history scans every ref: blobs no longer at the tip, commit messages, author addresses and ref names', () => {
		const repo = join(scratch, 'hist')
		mkdirSync(repo)
		const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' })
		git('init', '-q')
		git('config', 'user.name', 'Jane Doe')
		git('config', 'user.email', P('jane§@certrev.com'))
		writeFileSync(join(repo, 'old.md'), 'Acme Widgets one install\n')
		git('add', '.')
		git('commit', '-q', '-m', P('as mission cert§rev-0123456789ab lays it out'))
		git('rm', '-q', 'old.md')
		writeFileSync(join(repo, 'README.md'), 'clean\n')
		git('add', '.')
		git('commit', '-q', '-m', 'clean')
		git('branch', P('native/cert§rev-0123456789ab'))
		// The tip is clean; the history is not.
		assert.equal(run(['tree', repo]).code, 0)
		const r = run(['history', repo])
		assert.equal(r.code, 1)
		assert.match(r.out, /old\.md@[0-9a-f]{10}:1 {2}acme widgets/i)
		assert.match(r.out, /commit [0-9a-f]{10} message:1/)
		assert.match(r.out, /commit [0-9a-f]{10} identity:1/)
		assert.match(r.out, /ref refs\/heads\/native/)
		assert.doesNotMatch(r.out, /personal-attribution/)
	})
	it('pack scans what the tarball ships (dist included), not the source tree', () => {
		const pkg = join(scratch, 'pkg')
		mkdirSync(join(pkg, 'dist'), { recursive: true })
		mkdirSync(join(pkg, 'notshipped'))
		writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@x/pkg', version: '1.0.0', files: ['dist'] }))
		writeFileSync(join(pkg, 'notshipped', 'n.md'), P('jane§@certrev.com\n'))
		writeFileSync(join(pkg, 'dist', 'index.js'), 'export const ok = 1\n')
		assert.equal(run(['pack', pkg]).code, 0)
		writeFileSync(join(pkg, 'dist', 'index.js'), "export const def = 'ACME_WIDGETS'\n")
		const r = run(['pack', pkg])
		assert.equal(r.code, 1)
		assert.match(r.out, /pkg\/dist\/index\.js:1/)
	})
})
