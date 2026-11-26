#!/usr/bin/env node
/**
 * PUBLIC HYGIENE: nothing private reaches the public repo or the npm registry.
 *
 * Everything in this repository is public, and everything in a package's `npm pack` tarball is
 * public forever (npm never re-issues a name@version). This check fails closed on five classes of
 * leak, in the git tree AND in the tarballs:
 *
 *   customer-name    a customer's or agency's name, brand key or domain. The list is generated
 *                    from production brand records and is held PRIVATELY, as salted SHA-256
 *                    hashes of normalised token sequences, so neither this file nor the list
 *                    names anyone. It reaches this script through PUBLIC_HYGIENE_DENYLIST (the
 *                    list's text, a CI secret) or PUBLIC_HYGIENE_DENYLIST_FILE (a path). Without
 *                    it the check FAILS: a check that cannot see customer names must not pass.
 *   personal-email   any address except a role address at certrev.com (security@, support@ ...)
 *                    and the reserved example domains.
 *   internal-host    hosts that are private infrastructure: *.internal, *.local, preview and
 *                    tunnel hosts, store admin domains, private IP ranges, and any certrev.com
 *                    host that is not one of the public ones listed below.
 *   internal-id      orchestration mission and room ids, internal decision ids, ticket ids, and
 *                    pointers into CertREV's private repositories.
 *   personal-attribution  the owner by name, or anyone's name and date in parentheses on a decision.
 *   secret           secret-shaped strings: private keys, cloud and VCS tokens, live payment
 *                    keys, bearer credentials, credentials in URLs, secret assignments.
 *
 * USAGE
 *   node scripts/public-hygiene.mjs tree [dir]          every git-tracked file under dir (default .)
 *   node scripts/public-hygiene.mjs pack <pkgDir>...    every file in each package's npm pack tarball
 *   node scripts/public-hygiene.mjs files <path>...     the given files and directories
 *   node scripts/public-hygiene.mjs history [gitdir]    every blob reachable from ANY ref (branches, tags, pull
 *                                                       request refs), every commit message, author and committer,
 *                                                       and every ref name: the check a history rewrite must pass
 *
 * Exit 0 clean, 1 findings, 2 cannot check (no denylist, a pack failed). Nothing is printed from
 * the denylist; a customer-name finding prints its location and the matched text only.
 *
 * WHAT TO DO ON A FAILURE
 *   Rewrite the text with a neutral stand-in: "a headless storefront customer", brand-a,
 *   brand-a.example.test, security@certrev.com. Rename a fixture rather than allowlisting it. An
 *   allowlist entry suppresses one rule for one exact text in one file, with a reason; an entry
 *   that no longer matches anything fails the tree check, so the list cannot quietly rot.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Longest token sequence a denylist entry may span. The generator refuses longer terms. */
export const MAX_TERM_TOKENS = 4

/** certrev.com hosts that are public on purpose: documented to consumers or printed by the card. */
const PUBLIC_CERTREV_HOSTS = new Set([
	'certrev.com',
	'www.certrev.com',
	'assets.certrev.com',
	'staging-assets.certrev.com',
	'cdn.certrev.com',
	'portal.certrev.com',
	'staging.portal.certrev.com',
	'staging.certrev.com',
	// The JSON Schema `$id` namespace cert-contract publishes its schemas under.
	'contracts.certrev.com',
])

/** Role mailboxes at certrev.com that may be published. Anyone's own address may not. */
const ROLE_MAILBOXES = new Set([
	'security',
	'support',
	'hello',
	'help',
	'info',
	'privacy',
	'legal',
	'press',
	'noreply',
	'no-reply',
])

/** RFC 2606 / RFC 6761 names: never anyone's real address or host. */
const RESERVED_DOMAIN = /(?:^|\.)(?:example\.(?:com|org|net)|example|test|invalid|localhost)$/i

/** One rule per class of leak. Each `scan` returns the offending substrings of one line. */
export const RULES = [
	{
		name: 'personal-email',
		why: "a person's address is not ours to publish; use security@certrev.com or a role address, or user@example.com",
		scan(line) {
			const out = []
			for (const m of line.matchAll(
				/(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g,
			)) {
				const [text, local, domain] = m
				// `//user:pw@host` is URL userinfo, which the `secret` rule judges.
				const before = line.slice(Math.max(0, m.index - 64), m.index)
				if (/\/\/[^\s/@]*$/.test(before)) continue
				if (RESERVED_DOMAIN.test(domain)) continue
				// npm-style package paths (`@scope/pkg@1.2.3`) and version pins are not addresses.
				if (/^\d/.test(domain)) continue
				if (domain.toLowerCase() === 'certrev.com' && ROLE_MAILBOXES.has(local.toLowerCase())) continue
				// A no-reply address (a bot, or a service's commit identity) is nobody's mailbox.
				if (/^no-?reply$/i.test(local) || /(?:^|\.)noreply\.github\.com$/i.test(domain)) continue
				out.push(text)
			}
			return out
		},
	},
	{
		name: 'internal-host',
		why: 'private infrastructure has no business in a public artifact; use a host under example.test',
		scan(line) {
			const out = []
			for (const m of line.matchAll(/(?<![A-Za-z0-9.-])((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?![A-Za-z0-9-])/g)) {
				const host = m[1].toLowerCase()
				if (
					/\.(?:internal|local|lan|corp|intranet|home\.arpa)$/.test(host) ||
					/\.(?:vercel\.app|run\.app|ngrok\.io|ngrok-free\.app|ngrok\.app|trycloudflare\.com|ts\.net|neon\.tech|fly\.dev|onrender\.com|herokuapp\.com)$/.test(
						host,
					) ||
					/\.myshopify\.com$/.test(host) ||
					((host.endsWith('.certrev.com') || host === 'certrev.com') && !PUBLIC_CERTREV_HOSTS.has(host)) ||
					/(?:^|\.)certrev\.(?:dev|io|net|app|co)$/.test(host)
				) {
					out.push(m[1])
				}
			}
			for (const m of line.matchAll(
				/(?<![\d.])(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})(?![\d.])/g,
			)) {
				out.push(m[1])
			}
			return out
		},
	},
	{
		name: 'internal-id',
		why: 'an id from the private tracker, orchestration or repos means nothing outside and points at what is private; state the constraint instead',
		scan(line) {
			const patterns = [
				// Orchestration missions and rooms: `<project>-<12 hex>`, `mission <hex>`, `room <hex>`.
				/\b(?:certrev|paros|native|op|op-ops|room|mission)[-_][0-9a-f]{12}\b/gi,
				/\b(?:missions?|rooms?|decisions?|asks?|briefs?|sessions?)\s+(?:id\s+)?[0-9a-f]{8,}\b/gi,
				// Tracker ids and links.
				/\b(?:POR|AGO|ENG|OPS)-\d{2,6}\b/g,
				/linear\.app\/\S+/g,
				// Pointers into private repositories (by slug, PR number or commit).
				/\bCertREV\/(?:portal|contracts|agos|site|paros|plugins|infra|ops)\b(?:[#@ ]\s*[0-9a-f]{7,40}|#\d+)?/g,
				/\b(?:portal|contracts|agos)#\d+\b/g,
				// Absolute paths on somebody's machine or an agent's scratch space.
				/(?:^|[\s([<'"`=])(?:~\/|\/Users\/|\/home\/|\/private\/tmp\/|\/work\/)[^\s'"`)]*/g,
			]
			const out = []
			for (const re of patterns) for (const m of line.matchAll(re)) out.push(m[0].trim())
			return out
		},
	},
	{
		name: 'personal-attribution',
		why: 'who decided, and when, is internal bookkeeping; keep the reason and drop the person',
		scan(line) {
			const out = []
			// The owner by name, and the "(Name YYYY-MM-DD" shape of anyone's dated call.
			for (const m of line.matchAll(/\bOwen\b/g)) out.push(m[0])
			for (const m of line.matchAll(/\(\s*[A-Z][a-z]+,?\s+\d{4}-\d{2}-\d{2}\s*[:,)]/g)) out.push(m[0])
			return out
		},
	},
	{
		name: 'secret',
		why: 'secret-shaped text in a public artifact is either a leak or will be reported as one; use an obviously fake value',
		scan(line) {
			const patterns = [
				/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g,
				/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
				/\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
				/\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
				/\bnpm_[A-Za-z0-9]{36}\b/g,
				/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
				/\bAIza[0-9A-Za-z_-]{35}\b/g,
				/\b(?:sk|rk)_live_[A-Za-z0-9]{10,}\b/g,
				/\bwhsec_[A-Za-z0-9]{16,}\b/g,
				/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/g,
				/\bshp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}\b/g,
				/\b[Bb]earer\s+[A-Za-z0-9._~+/-]{24,}=*/g,
				/"type"\s*:\s*"service_account"/g,
				/"private_key"\s*:\s*"-----BEGIN/g,
			]
			const out = []
			for (const re of patterns) for (const m of line.matchAll(re)) out.push(m[0])
			// Credentials in a URL. Obvious placeholders (`user:pw@`, `user:pass@`) are test data.
			for (const m of line.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/([^\s/:@'"`]+):([^\s/@'"`]+)@/gi)) {
				if (!/^(?:pw|pass|password|secret|x+|\*+|p)$/i.test(m[2])) out.push(m[0])
			}
			// A secret-named key assigned a long literal value.
			for (const m of line.matchAll(
				/\b(?:api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|private[_-]?key|password|passwd)\b["']?\s*[:=]\s*["']([^"'\s]{20,})["']/gi,
			)) {
				if (!/^(?:x+|\*+|<[^>]*>|\$\{[^}]*\}|(?:fake|test|dummy|example|placeholder)[\w-]*)$/i.test(m[1]))
					out.push(m[0])
			}
			return out
		},
	},
]

/**
 * Legitimate matches. Each suppresses ONE rule for ONE exact text in ONE file (repo-relative, or
 * tarball-relative as `<package>/<path>`), and says why. A stale entry fails the tree check.
 */
export const ALLOWLIST = []

// ---- customer names: tokenising and hashing ---------------------------------------------------

/**
 * The token stream a text is matched on. Dotted initialisms collapse (`A.B.C.` reads `ABC`),
 * camelCase splits (`brandName` reads `brand Name`), and everything else that is not a letter or
 * a digit separates. A denylist entry is a sequence of these tokens, so `Brand Name`, `brand-name`,
 * `BRAND_NAME` and `brandName` are one entry; the generator also adds the joined form (`brandname`)
 * for domains and keys written without a separator.
 */
export function tokens(text) {
	const collapsed = text.replace(/(?<![A-Za-z0-9])((?:[A-Za-z]\.){2,}[A-Za-z]?)(?![A-Za-z0-9])/g, (s) =>
		s.replace(/\./g, ''),
	)
	const split = collapsed.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
	return split.match(/[A-Za-z0-9]+/g) ?? []
}

/** The salted hash a denylist entry stores. Case-sensitive entries keep their case under `cs:`. */
export function termHash(salt, canonical, caseSensitive = false) {
	return createHash('sha256')
		.update(`${salt}\u0000${caseSensitive ? `cs:${canonical}` : canonical.toLowerCase()}`)
		.digest('hex')
}

/**
 * Denylist text: `#` comments, one `salt <hex>` line, then one `<sha256-hex>` per line. Returns
 * null when the text holds no salt or no entries, so an empty secret cannot pass as a clean list.
 */
export function parseDenylist(text) {
	let salt = null
	const hashes = new Set()
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim()
		if (!line || line.startsWith('#')) continue
		const s = /^salt\s+([0-9a-f]{32,})$/.exec(line)
		if (s) {
			salt = s[1]
			continue
		}
		if (!/^[0-9a-f]{64}$/.test(line))
			throw new Error('denylist: a line is neither a comment, the salt, nor a sha256 hex digest')
		hashes.add(line)
	}
	if (!salt || hashes.size === 0) return null
	return { salt, hashes }
}

/** Customer-name hits on one line: every window of up to MAX_TERM_TOKENS tokens, both case modes. */
export function customerHits(line, denylist) {
	const toks = tokens(line)
	const out = []
	// The same windows recur thousands of times in fixtures; hash each distinct one once.
	const memo = (denylist.memo ??= new Map())
	const hit = (canonical) => {
		let v = memo.get(canonical)
		if (v === undefined) {
			v =
				denylist.hashes.has(termHash(denylist.salt, canonical)) ||
				denylist.hashes.has(termHash(denylist.salt, canonical, true))
			if (memo.size < 2_000_000) memo.set(canonical, v)
		}
		return v
	}
	for (let i = 0; i < toks.length; i++) {
		for (let n = 1; n <= MAX_TERM_TOKENS && i + n <= toks.length; n++) {
			const canonical = toks.slice(i, i + n).join(' ')
			if (hit(canonical)) out.push(canonical)
		}
	}
	return out
}

// ---- scanning ---------------------------------------------------------------------------------

/** Scan one file's text. `file` is the display path the allowlist matches on. */
export function scanText(file, text, denylist, allowlist = ALLOWLIST, used = new Set()) {
	const findings = []
	const lines = text.split('\n')
	const record = (rule, line, hit) => {
		const entry = allowlist.find((e) => e.rule === rule && e.file === file && e.text === hit)
		if (entry) {
			used.add(entry)
			return
		}
		findings.push({ rule, file, line, text: hit })
	}
	lines.forEach((content, i) => {
		// Minified bundles are one enormous line; scanning them is fine, printing them is not.
		for (const rule of RULES) for (const hit of rule.scan(content)) record(rule.name, i + 1, hit)
		for (const hit of customerHits(content, denylist)) record('customer-name', i + 1, hit)
	})
	return findings
}

function walk(dir) {
	const out = []
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const abs = join(dir, entry.name)
		if (entry.isDirectory()) out.push(...walk(abs))
		else if (entry.isFile()) out.push(abs)
	}
	return out
}

const posix = (p) => p.split(sep).join('/')

/** Every file git tracks under `dir`, plus untracked files that are not ignored (they ship next). */
export function treeFiles(dir) {
	const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
		cwd: dir,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	})
	return out
		.split('\0')
		.filter(Boolean)
		.filter((f) => {
			try {
				return statSync(join(dir, f)).isFile()
			} catch {
				return false // deleted in the working tree
			}
		})
		.map((f) => ({ abs: join(dir, f), display: f }))
}

/** Every file in the tarball `npm pack` builds for `pkgDir`, extracted to a scratch directory. */
export function packFiles(pkgDir) {
	const scratch = mkdtempSync(join(tmpdir(), 'public-hygiene-'))
	// Run from a publish hook, npm hands its own flags down as npm_config_*; under `npm publish --dry-run` the
	// inherited dry_run would make this pack write no tarball. Packing is local, so it always runs for real.
	const env = { ...process.env }
	delete env.npm_config_dry_run
	const json = execFileSync('npm', ['pack', '--json', '--pack-destination', scratch], {
		cwd: pkgDir,
		env,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
		maxBuffer: 64 * 1024 * 1024,
	})
	const [info] = JSON.parse(json.slice(json.indexOf('[')))
	const out = join(scratch, 'x')
	execFileSync('mkdir', ['-p', out])
	execFileSync('tar', ['-xzf', join(scratch, info.filename), '-C', out])
	const name = info.name.replace(/^@[^/]+\//, '')
	const files = walk(out).map((abs) => ({ abs, display: `${name}/${posix(relative(join(out, 'package'), abs))}` }))
	if (!files.length) throw new Error(`npm pack produced an empty tarball for ${pkgDir}`)
	return { files, scratch, tarball: info.filename, entryCount: info.entryCount }
}

/**
 * Everything a clone of the repository can show, across every ref: each distinct blob (with the first path it was
 * seen at), each commit's message and author/committer identities, and each ref's name. `gitDir` may be a bare
 * mirror clone.
 */
export function historyItems(gitDir) {
	const git = (args, input) => {
		const r = spawnSync('git', ['--git-dir', gitDir, ...args], { input, maxBuffer: 1024 * 1024 * 1024 })
		if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`)
		return r.stdout
	}
	const items = []
	const refs = git(['for-each-ref', '--format=%(refname)']).toString('utf8').split('\n').filter(Boolean)
	for (const ref of refs) items.push({ display: `ref ${ref}`, text: ref })
	const firstPath = new Map()
	for (const line of git(['rev-list', '--all', '--objects']).toString('utf8').split('\n')) {
		const [sha, ...rest] = line.split(' ')
		if (sha && !firstPath.has(sha)) firstPath.set(sha, rest.join(' '))
	}
	const shas = [...firstPath.keys()]
	const types = git(['cat-file', '--batch-check=%(objectname) %(objecttype)'], `${shas.join('\n')}\n`)
		.toString('utf8')
		.split('\n')
	const blobs = types.filter((l) => l.endsWith(' blob')).map((l) => l.split(' ')[0])
	const out = git(['cat-file', '--batch'], `${blobs.join('\n')}\n`)
	let at = 0
	while (at < out.length) {
		const nl = out.indexOf(10, at)
		const [sha, , size] = out.subarray(at, nl).toString('utf8').split(' ')
		const body = out.subarray(nl + 1, nl + 1 + Number(size))
		at = nl + 1 + Number(size) + 1
		items.push({ display: `${firstPath.get(sha) || '(no path)'}@${sha.slice(0, 10)}`, text: body.toString('utf8') })
	}
	const log = git(['log', '--all', '--format=%x01%H%x00%an <%ae>%x00%cn <%ce>%x00%B']).toString('utf8')
	for (const rec of log.split('\x01').filter(Boolean)) {
		const [sha, author, committer, message] = rec.split('\x00')
		items.push({ display: `commit ${sha.slice(0, 10)} message`, text: message })
		items.push({ display: `commit ${sha.slice(0, 10)} identity`, text: `${author}\n${committer}` })
	}
	return items
}

/** The denylist this run checks customer names against, or a reason it has none. */
export function loadDenylist(env = process.env, argPath = null) {
	let text = null
	let from = null
	if (argPath) {
		text = readFileSync(argPath, 'utf8')
		from = argPath
	} else if (env.PUBLIC_HYGIENE_DENYLIST) {
		text = env.PUBLIC_HYGIENE_DENYLIST
		from = 'PUBLIC_HYGIENE_DENYLIST'
	} else if (env.PUBLIC_HYGIENE_DENYLIST_FILE) {
		text = readFileSync(env.PUBLIC_HYGIENE_DENYLIST_FILE, 'utf8')
		from = env.PUBLIC_HYGIENE_DENYLIST_FILE
	}
	if (text === null)
		return { error: 'no customer denylist: set PUBLIC_HYGIENE_DENYLIST (CI secret) or PUBLIC_HYGIENE_DENYLIST_FILE' }
	const parsed = parseDenylist(text)
	if (!parsed) return { error: `the customer denylist from ${from} has no salt or no entries` }
	return { denylist: parsed, from }
}

export function main(argv, env = process.env, log = console.log, err = console.error) {
	const args = [...argv]
	let denylistPath = null
	const di = args.indexOf('--denylist')
	if (di !== -1) {
		denylistPath = args[di + 1]
		args.splice(di, 2)
	}
	const [mode, ...targets] = args
	if (
		!['tree', 'pack', 'files', 'history'].includes(mode) ||
		(!['tree', 'history'].includes(mode) && !targets.length)
	) {
		err(
			'usage: public-hygiene.mjs tree [dir] | pack <pkgDir>... | files <path>... | history [gitdir]  [--denylist <file>]',
		)
		return 2
	}
	const loaded = loadDenylist(env, denylistPath)
	if (loaded.error) {
		err(`FAIL (cannot check): ${loaded.error}. This check fails closed: it never passes without the customer list.`)
		return 2
	}
	const { denylist } = loaded

	const used = new Set()
	const findings = []
	let count = 0
	const scratches = []
	try {
		if (mode === 'tree') {
			const dir = resolve(targets[0] ?? '.')
			for (const f of treeFiles(dir)) {
				findings.push(...scanText(f.display, readFileSync(f.abs, 'utf8'), denylist, ALLOWLIST, used))
				count++
			}
		} else if (mode === 'pack') {
			for (const pkgDir of targets) {
				let packed
				try {
					packed = packFiles(resolve(pkgDir))
				} catch (e) {
					err(`FAIL (cannot check): npm pack failed in ${pkgDir}: ${e.message}`)
					return 2
				}
				scratches.push(packed.scratch)
				log(`packed ${packed.tarball}: ${packed.entryCount} files`)
				for (const f of packed.files) {
					findings.push(...scanText(f.display, readFileSync(f.abs, 'utf8'), denylist, ALLOWLIST, used))
					count++
				}
			}
		} else if (mode === 'history') {
			const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
				cwd: resolve(targets[0] ?? '.'),
				encoding: 'utf8',
			}).trim()
			for (const item of historyItems(gitDir)) {
				const found = scanText(item.display, item.text, denylist, ALLOWLIST, used)
				// An identity line is a name and an address: only the address rule applies to it. A person's own
				// public name as a commit author is not an attribution in the text.
				findings.push(
					...(item.display.endsWith(' identity') ? found.filter((f) => f.rule === 'personal-email') : found),
				)
				count++
			}
		} else {
			for (const target of targets) {
				const abs = resolve(target)
				const list = statSync(abs).isDirectory() ? walk(abs) : [abs]
				for (const f of list) {
					findings.push(
						...scanText(posix(relative(process.cwd(), f)), readFileSync(f, 'utf8'), denylist, ALLOWLIST, used),
					)
					count++
				}
			}
		}
	} finally {
		for (const s of scratches) rmSync(s, { recursive: true, force: true })
	}

	if (mode === 'tree') {
		for (const entry of ALLOWLIST) {
			if (!used.has(entry))
				findings.push({ rule: 'stale-allowlist', file: entry.file, line: 0, text: `${entry.rule}: ${entry.text}` })
		}
	}

	log(
		`public hygiene (${mode}): scanned ${count} ${mode === 'history' ? 'objects' : 'files'} against ${denylist.hashes.size} customer-name hashes`,
	)
	if (!findings.length) {
		log('clean: no customer names, personal emails, internal hosts or ids, or secret-shaped text.')
		return 0
	}
	const whys = Object.fromEntries(RULES.map((r) => [r.name, r.why]))
	whys['customer-name'] =
		'a customer is never named in public without a signed contract and the owner\'s yes; use "a headless storefront customer", brand-a'
	whys['stale-allowlist'] = 'this allowlist entry no longer matches anything; delete it'
	err(`\n${findings.length} finding(s) in what is public:\n`)
	for (const name of Object.keys(whys)) {
		const hits = findings.filter((f) => f.rule === name)
		if (!hits.length) continue
		err(`  ${name}: ${whys[name]}`)
		for (const h of hits) {
			const text = h.text.length > 120 ? `${h.text.slice(0, 120)}...` : h.text
			err(`    ${h.file}:${h.line}  ${text}`)
		}
		err('')
	}
	return 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv.slice(2))
}
