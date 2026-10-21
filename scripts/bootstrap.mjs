#!/usr/bin/env node
/**
 * Set up this repo on a machine with only Node installed.
 *
 *   node scripts/bootstrap.mjs                     # web profile, the default
 *   node scripts/bootstrap.mjs --profile dev       # a development profile
 *   node scripts/bootstrap.mjs --dry-run           # report, change nothing
 *   node scripts/bootstrap.mjs --no-harness-install  # manage `dsh` yourself
 *
 * Idempotent: running it twice is the same as running it once, so it doubles
 * as the repair command when a profile drifts.
 *
 * It installs the Harness globally when `dsh` is missing, at the version pinned
 * in package.json — the only mutation outside this repo, and the reason the
 * pin lives in one place. Pass --no-harness-install to refuse that and get the
 * command instead. It never *upgrades* an installed Harness: a mismatched
 * version is reported, because a global upgrade mid-project is your call.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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

const profile = option('--profile') ?? 'web'
const dryRun = argv.includes('--dry-run')
const skipInstall = argv.includes('--no-install')
const noHarnessInstall = argv.includes('--no-harness-install')

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const expected = pkg.dsh?.harness?.version
const harnessPackage = pkg.dsh?.harness?.package ?? '@deepseek-ai/dsh'

function fail(message) {
	console.error(`\nbootstrap: ${message}`)
	process.exit(1)
}

/** Run a command in the repo root, inheriting stdio. */
function run(command, args) {
	return spawnSync(command, args, { cwd: root, stdio: 'inherit' })
}

/** Run a command and return trimmed stdout, or undefined if it fails. */
function capture(command, args) {
	try {
		return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
	} catch {
		return undefined
	}
}

const steps = []
function step(name, fn) {
	steps.push(name)
	console.log(`\n[${steps.length}] ${name}`)
	fn()
}

const spec = expected === undefined ? harnessPackage : `${harnessPackage}@${expected}`

/** The global bin directory, for the "installed but not on PATH" case. */
function globalBinDir() {
	const prefix = capture('npm', ['prefix', '--global'])
	return prefix === undefined ? undefined : join(prefix, 'bin')
}

step('Harness', () => {
	const version = capture('dsh', ['--version'])

	if (version !== undefined) {
		if (expected !== undefined && version !== expected) {
			console.log(`  warning: dsh ${version} is installed, this repo pins ${expected}`)
			console.log('  the client-bundle contract is version-sensitive — see docs/plugin-contract.md')
			console.log(`  to move: npm i -g ${spec}`)
		} else {
			console.log(`  dsh ${version}`)
		}
		return
	}

	console.log('  dsh is not installed')
	if (noHarnessInstall) {
		fail(`--no-harness-install was passed and \`dsh\` is missing.

  npm i -g ${spec}
`)
	}
	const npm = capture('npm', ['--version'])
	if (npm === undefined) {
		fail('`npm` is not on PATH either; install Node.js (npm ships with it) and re-run.')
	}
	if (dryRun) {
		console.log(`  would run: npm i -g ${spec}  (npm ${npm})`)
		return
	}

	console.log(`  npm i -g ${spec}  (npm ${npm})`)
	const installed = run('npm', ['install', '--global', spec])
	if (installed.status !== 0) {
		fail(`npm could not install ${spec}.

  If it failed on permissions, a user-owned prefix avoids sudo:
    npm config set prefix ~/.npm-global
    export PATH="$HOME/.npm-global/bin:$PATH"
    npm i -g ${spec}
`)
	}

	const after = capture('dsh', ['--version'])
	if (after === undefined) {
		const bin = globalBinDir()
		fail(`installed ${spec}, but \`dsh\` is still not on PATH.
${bin === undefined ? '' : `  its global bin directory is ${bin} — add it to PATH and re-run.\n`}`)
	}
	console.log(`  dsh ${after}`)
})

step('Package manager', () => {
	const version = capture('pnpm', ['--version'])
	if (version === undefined) {
		fail('`pnpm` is not on PATH; `dsh plugin` forwards to it, so it is required.\n  corepack enable pnpm')
	}
	console.log(`  pnpm ${version}`)
})

step('Workspace dependencies', () => {
	if (skipInstall) {
		console.log('  skipped (--no-install)')
		return
	}
	if (dryRun) {
		console.log('  would run: pnpm install --frozen-lockfile')
		return
	}
	const result = run('pnpm', ['install', '--frozen-lockfile'])
	if (result.status !== 0) fail('pnpm install failed; fix the workspace before syncing a profile')
})

step(`Profile "${profile}"`, () => {
	const args = ['scripts/sync-profile.mjs', '--profile', profile]
	if (dryRun) args.push('--dry-run')
	const result = run(process.execPath, args)
	if (result.status !== 0) fail(`could not sync profile "${profile}"`)
})

const next = [
	[`dsh --profile ${profile} web`, 'boot it'],
	['node scripts/test-all.mjs', "every plugin's tests"],
	['node scripts/new-plugin.mjs <name> --client', 'scaffold the next one'],
]
const width = Math.max(...next.map(([command]) => command.length))

console.log(`
${dryRun ? 'Dry run complete — nothing was changed.' : 'Ready.'}

${next.map(([command, note]) => `  ${command.padEnd(width)}  # ${note}`).join('\n')}
`)
