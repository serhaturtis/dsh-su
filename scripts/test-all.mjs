#!/usr/bin/env node
/**
 * Run every plugin's tests.
 *
 * Discovery is filesystem-based, not pnpm-based: `plugins/<name>/test/*.test.mjs`
 * runs with plain `node`, so a plugin with no runtime dependencies needs no
 * install before it can be tested. Adding a test file is the whole contract.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = join(root, 'plugins')

/** @returns {string[]} directories under `dir`, sorted, or [] when dir is missing. */
function subdirectories(dir) {
	try {
		return readdirSync(dir)
			.filter((name) => statSync(join(dir, name)).isDirectory())
			.sort()
	} catch {
		return []
	}
}

/** @returns {string[]} `*.test.mjs` files under the plugin's test directory. */
function testFiles(pluginDir) {
	const testDir = join(pluginDir, 'test')
	try {
		return readdirSync(testDir)
			.filter((name) => name.endsWith('.test.mjs'))
			.sort()
			.map((name) => join(testDir, name))
	} catch {
		return []
	}
}

const suites = subdirectories(pluginsDir)
	.map((name) => ({ name, files: testFiles(join(pluginsDir, name)) }))
	.filter((suite) => suite.files.length > 0)

if (suites.length === 0) {
	console.log('No plugin tests found (looked for plugins/*/test/*.test.mjs).')
	process.exit(0)
}

const suiteCount = suites.length
let files = 0
let failed = 0
const failures = []

for (const suite of suites) {
	console.log(`\n=== ${suite.name}`)
	for (const file of suite.files) {
		files++
		const label = file.slice(root.length + 1)
		const result = spawnSync(process.execPath, [file], { stdio: 'inherit' })
		if (result.status !== 0) {
			failed++
			failures.push(label)
		}
	}
}

console.log(`\n${suiteCount} plugin${suiteCount === 1 ? '' : 's'} · ${files - failed}/${files} test files passed`)
if (failed > 0) {
	for (const label of failures) console.log(`  failed: ${label}`)
	process.exit(1)
}
