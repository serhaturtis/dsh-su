#!/usr/bin/env node
/**
 * Keep a DSH profile in sync with the plugins in this repo.
 *
 * Adding a plugin is two facts that must agree: the package is linked into the
 * profile, and its name is listed in `dsh.profile.bundles`. Doing that by hand
 * for every plugin is where a profile drifts, so this script derives both from
 * the directory listing and lets `dsh plugin add` do the linking.
 *
 *   node scripts/sync-profile.mjs --dry-run         # report, change nothing
 *   node scripts/sync-profile.mjs                   # link + enable everything
 *   node scripts/sync-profile.mjs --profile web     # a specific profile
 *   node scripts/sync-profile.mjs --prune           # also drop deleted plugins
 *
 * Idempotent: a profile already in sync is left untouched, and nothing is
 * removed unless --prune is passed.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

/** Read `--flag value` from argv. */
function option(flag) {
	const index = argv.indexOf(flag)
	if (index === -1) return undefined
	const value = argv[index + 1]
	return value === undefined || value.startsWith('--') ? undefined : value
}

/** Collect every `--flag value` occurrence from argv. */
function options(flag) {
	const values = []
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] !== flag) continue
		const value = argv[i + 1]
		if (value !== undefined && !value.startsWith('--')) values.push(value)
	}
	return values
}

const profile = option('--profile') ?? 'dev'
const template = option('--template') ?? 'web'
const dryRun = argv.includes('--dry-run')
const prune = argv.includes('--prune')
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profile)
const profileManifest = join(profileDir, 'package.json')
// Kept beside the profile, not in the repo: which plugins a profile skips is a
// property of *that machine's* profile. Stored outside package.json so the
// Harness's own manifest schema is never taught a foreign key.
const exceptFile = join(profileDir, '.sync-except.json')

function fail(message) {
	console.error(`sync-profile: ${message}`)
	process.exit(1)
}

/** Package names this profile keeps out of its bundles. */
function readExclusions() {
	try {
		const parsed = JSON.parse(readFileSync(exceptFile, 'utf8'))
		return new Set(Array.isArray(parsed.except) ? parsed.except : [])
	} catch {
		return new Set()
	}
}

function writeExclusions(names) {
	writeFileSync(exceptFile, `${JSON.stringify({ except: [...names].sort() }, null, 2)}\n`)
}

if (!existsSync(profileManifest)) {
	// A first run: seed the profile from a shipped template without booting it,
	// which is what makes "clone, sync, run" work on a machine that has never
	// seen DSH. The template is named explicitly because a profile's own name
	// is not a template name — "dev" seeds from "web", not from a "dev" that
	// does not exist.
	console.log(`profile ${profile} does not exist yet — seeding it from the ${template} template\n`)
	if (!dryRun) {
		const created = spawnSync('dsh', ['--profile', profile, '--from-default-profile', template, '--dump-config'], {
			cwd: root,
			stdio: ['ignore', 'ignore', 'inherit'],
		})
		if (created.status !== 0) fail(`could not create profile "${profile}" from template "${template}"`)
	}
}

/** Every plugin directory that declares a package name. */
function localPlugins() {
	const dir = join(root, 'plugins')
	return readdirSync(dir)
		.filter((name) => statSync(join(dir, name)).isDirectory())
		.filter((name) => existsSync(join(dir, name, 'package.json')))
		.map((name) => {
			const manifest = JSON.parse(readFileSync(join(dir, name, 'package.json'), 'utf8'))
			return { dir: name, packageName: manifest.name }
		})
		.sort((a, b) => a.dir.localeCompare(b.dir))
}

// A dry run against a machine with no profile still reports what it would do.
const manifest = existsSync(profileManifest)
	? JSON.parse(readFileSync(profileManifest, 'utf8'))
	: { dependencies: {}, dsh: { profile: { bundles: [] } } }
const bundles = manifest.dsh?.profile?.bundles ?? []
const plugins = localPlugins()
// A profile without the web app boots no GUI, so every plugin in this repo is
// invisible in it. Seeding replaces the whole profile, so this warns instead of
// acting — the repair is a deliberate choice, not a side effect.
const servesWeb = bundles.includes('@deepseek-ai/dsh-web-app')

// `--except` records a plugin that this profile simply does not want, so the
// next plain sync does not silently put it back.
const excluded = readExclusions()
for (const name of options('--except')) excluded.add(name)
for (const name of options('--include')) excluded.delete(name)
if (!dryRun && (options('--except').length > 0 || options('--include').length > 0)) writeExclusions(excluded)

const missing = plugins.filter((plugin) => !bundles.includes(plugin.packageName) && !excluded.has(plugin.packageName))
const unlink = plugins.filter((plugin) => excluded.has(plugin.packageName) && bundles.includes(plugin.packageName))

console.log(`profile ${profile}  (${profileDir})`)
console.log(`${plugins.length} plugin${plugins.length === 1 ? '' : 's'} in this repo, ${bundles.length} bundle rows\n`)

if (missing.length === 0) {
	console.log('  everything already linked')
} else {
	for (const plugin of missing) {
		console.log(`  ${dryRun ? 'would add ' : 'adding    '} plugins/${plugin.dir}  (${plugin.packageName})`)
		if (dryRun) continue
		execFileSync('dsh', ['plugin', '--profile', profile, 'add', `./plugins/${plugin.dir}`], {
			cwd: root,
			stdio: 'inherit',
		})
	}
}

for (const plugin of unlink) {
	console.log(`  ${dryRun ? 'would drop' : 'dropping  '} plugins/${plugin.dir}  (excluded by --except)`)
	if (dryRun) continue
	execFileSync('dsh', ['plugin', '--profile', profile, 'remove', plugin.packageName], { cwd: root, stdio: 'inherit' })
}

// A bundle naming a plugin whose directory is gone keeps booting against a
// stale package if the link was never cleaned up.
const linked = Object.entries(manifest.dependencies ?? {})
	.filter(([, spec]) => typeof spec === 'string' && spec.startsWith('link:'))
	.map(([name, spec]) => ({ name, target: resolve(profileDir, spec.slice('link:'.length)) }))

const stale = linked.filter(
	(entry) => entry.target.startsWith(join(root, 'plugins')) && !existsSync(join(entry.target, 'package.json')),
)

if (stale.length > 0) {
	console.log('')
	for (const entry of stale) {
		const label = `  stale     ${entry.name}  (link target is gone)`
		if (!prune) {
			console.log(`${label} — pass --prune to remove`)
			continue
		}
		console.log(`${dryRun ? 'would drop' : 'removing  '} ${entry.name}`)
		if (dryRun) continue
		execFileSync('dsh', ['plugin', '--profile', profile, 'remove', entry.name], { cwd: root, stdio: 'inherit' })
	}
}

const changed = missing.length > 0 || unlink.length > 0 || (prune && stale.length > 0)

if (changed) {
	console.log(`\n${dryRun ? 'dry run: nothing was changed' : 'done — restart the Host to load the new graph'}`)
} else if (stale.length === 0) {
	console.log('\nnothing to do')
}

if (!servesWeb) {
	console.log(`
warning: this profile has no @deepseek-ai/dsh-web-app bundle, so no GUI boots
         from it and these plugins will not appear. Seed it, then re-run:

           dsh --profile ${profile} --from-default-profile web   # replaces profile-local settings
           node scripts/sync-profile.mjs --profile ${profile}
`)
}
