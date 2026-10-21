#!/usr/bin/env node
/**
 * Scaffold a plugin that already matches this repo's conventions, so a new
 * plugin never starts life as a copy of a slightly different one.
 *
 *   pnpm new rate-hours              host-only plugin
 *   pnpm new rate-hours --client     host + browser half (the common case here)
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

const argv = process.argv.slice(2)
const wantClient = argv.includes('--client')
const name = argv.find((arg) => !arg.startsWith('-'))

function fail(message) {
	console.error(`new-plugin: ${message}`)
	process.exit(1)
}

if (name === undefined) fail('usage: pnpm new <plugin-name> [--client]')
if (!KEBAB.test(name)) fail(`"${name}" is not kebab-case (lowercase letters, digits, single hyphens)`)

const packageName = `dsh-${name}`
const dir = join(root, 'plugins', name)
if (existsSync(dir)) fail(`plugins/${name} already exists`)

/** Every file the scaffold writes, keyed by path relative to the plugin dir. */
const files = {
	'package.json': packageJson(),
	'cordis.patch.yml': patchYml(),
	'src/index.ts': hostEntry(),
	'README.md': readme(),
}

if (wantClient) {
	files['src/client.js'] = clientBundle()
	files['test/client.test.mjs'] = clientTest()
}

for (const [relative, contents] of Object.entries(files)) {
	const target = join(dir, relative)
	mkdirSync(dirname(target), { recursive: true })
	writeFileSync(target, contents)
	console.log(`  created plugins/${name}/${relative}`)
}

const steps = [
	['pnpm install', 'register the workspace package'],
	[`dsh plugin --profile dev add ./plugins/${name}`, 'link it into the dev profile'],
	['pnpm dev', 'then restart to pick up client code'],
]
const width = Math.max(...steps.map(([command]) => command.length))

console.log(`
Next:

${steps.map(([command, note]) => `  ${command.padEnd(width)}  # ${note}`).join('\n')}

Then fill in plugins/${name}/README.md and, if it renders, add a test that
drives the bundle the way the browser does. See docs/plugin-contract.md.`)

function packageJson() {
	return `${JSON.stringify(
		{
			name: packageName,
			version: '0.1.0',
			private: true,
			type: 'module',
			main: 'src/index.ts',
			exports: {
				'.': './src/index.ts',
				...(wantClient ? { './client': './src/client.js' } : {}),
				'./package.json': './package.json',
			},
			dsh: {
				bundle: { patch: './cordis.patch.yml' },
				...(wantClient ? { client: { platform: 'web' } } : {}),
			},
			// A test script only exists when the scaffold writes a test; a host-only
			// plugin has none until it grows logic worth testing.
			...wantClient ? { scripts: { test: 'node test/client.test.mjs' } } : {},
		},
		null,
		2,
	)}\n`
}

function patchYml() {
	return `# Composition patch for ${packageName}: one row mounts the package.
${wantClient ? '# The dsh.client declaration in package.json is what makes the browser half appear.\n' : ''}- insert:
    - id: ${name}
      name: ${packageName}
`
}

function hostEntry() {
	return `/**
 * ${packageName} — host half.
 *
 * ${wantClient ? 'The visible half lives in src/client.js; this row exists so client-modules\n * can find the package\'s dsh.client declaration.' : 'Add services, routes, and tools here.'}
 */
export const name = '${packageName}'

export function apply(): void {}
`
}

function readme() {
	return `# ${packageName}

What it does, in one sentence.

${wantClient ? '```\n● Off-peak · peak in 13h 39m\n```\n\nWhere it appears: which slot, and whether it shows conditionally.\n' : ''}## Behaviour

- The rule it implements, with a link to whatever it is derived from.
- What it does at the edges: first run, empty state, failure.

## Install

\`\`\`sh
dsh plugin --profile dev add ./plugins/${name}
\`\`\`

Restart the Host afterwards — client code is composed at boot.

## Limits

What it deliberately does not do, and where its numbers come from.

## Tests

\`\`\`sh
node test/${wantClient ? 'client' : '<topic>'}.test.mjs
\`\`\`
`
}

function clientBundle() {
	return `/**
 * ${packageName} — client half.
 *
 * A client-module bundle, not a module: this script must call
 * window.__ModuleLoader__.load exactly once with a factory, and everything
 * else lives inside the factory closure because it runs at materialization.
 * Relative requires do not resolve here; inline what you need, or require a
 * platform seed module such as 'react'.
 */
;(function () {
	'use strict'
	if (typeof window === 'undefined' || window.__ModuleLoader__ === undefined) return

	window.__ModuleLoader__.load({
		id: '${packageName}',
		factory: function (require) {
			var React = require('react')
			var module = { exports: {} }
			var exports = module.exports

			function Widget() {
				return React.createElement('span', { role: 'status' }, '${name}')
			}

			var inject = ['slots']

			function apply(ctx) {
				ctx.slots.inject('conversation.input.left', function () {
					return ctx.slots.register({ name: 'conversation.input.left', id: '${name}' }, Widget)
				})
			}

			exports.apply = apply
			exports.inject = inject
			exports.Widget = Widget
			return module.exports
		},
	})
})()
`
}

function clientTest() {
	return `/**
 * Drives ${packageName}'s bundle the way the browser does: register, then
 * materialize. Catches the failure modes that produce a blank screen rather
 * than an error — wrong id, a factory exported as apply, a slot nobody renders.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client.js')
const registrations = []
globalThis.window = { __ModuleLoader__: { load: (spec) => registrations.push(spec) } }
await import(\`\${file}?v=\${Math.random()}\`)

assert.equal(registrations.length, 1, 'bundle must register exactly once')
const spec = registrations[0]
assert.equal(spec.id, '${packageName}')

const exported = spec.factory((request) => {
	if (request === 'react') {
		return {
			createElement: (type, props, ...children) => ({ type, props, children }),
			useState: (initial) => [initial, () => {}],
			useEffect: () => {},
		}
	}
	throw new Error(\`bundle required "\${request}", which is not a platform seed module\`)
})

assert.equal(typeof exported.apply, 'function')
assert.equal(typeof spec.factory, 'function')

const calls = []
exported.apply({
	slots: {
		inject: (name, fn) => (calls.push(name), fn()),
		register: (options, component) => calls.push([options.name, options.id, component]),
	},
})
assert.equal(calls[0], 'conversation.input.left')
assert.equal(calls[1][0], 'conversation.input.left')
assert.equal(typeof calls[1][2], 'function')

console.log('client bundle: ok')
`
}
