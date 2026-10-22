/**
 * Build every plugin that has a client bundle.
 *
 * Client bundles cannot require relative modules, so a plugin with more than one
 * client module needs a build step. This finds them by convention
 * (`plugins/<name>/scripts/build-client.mjs`) instead of hard-coding a list, and
 * fails loudly rather than leaving a stale bundle behind.
 */
import { execFileSync } from 'node:child_process'
import { globSync } from 'node:fs'
import { join } from 'node:path'

const scripts = globSync('plugins/*/scripts/build-client.mjs', { cwd: process.cwd() })
if (scripts.length === 0) {
	console.log('no client bundles to build')
	process.exit(0)
}
for (const script of scripts) {
	execFileSync(process.execPath, [join(process.cwd(), script)], { stdio: 'inherit' })
}
