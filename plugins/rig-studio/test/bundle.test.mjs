/**
 * The client bundle is generated, so it gets its own test: a bundler that
 * silently drops a module or mangles an export would produce a plugin that loads
 * and then does nothing.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { test, report } from './harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

console.log('\nbundling')

test('the bundler refuses an import form it cannot bundle', async () => {
	const { transformModule } = await import(join(root, 'scripts', 'build-client.mjs'))
	assert.throws(() => transformModule("import React from 'react'", 'x.js'), /unsupported import form/)
})

test('the bundler rewrites named imports into registry lookups', async () => {
	const { transformModule } = await import(join(root, 'scripts', 'build-client.mjs'))
	const out = transformModule("import { a, b } from './m.js'\nexport const C = a + b\n", 'x.js')
	assert.match(out, /const \{ a, b \} = __require\('\.\/m\.js'\)/)
	assert.match(out, /exports\.C = C/)
	assert.doesNotMatch(out, /^import /m)
})

test('a bundle can be built and it parses', () => {
	mkdirSync(join(root, 'dist'), { recursive: true })
	execFileSync(process.execPath, [join(root, 'scripts', 'build-client.mjs')], { stdio: 'pipe' })
	const code = readFileSync(join(root, 'dist', 'client.js'), 'utf8')
	assert.ok(code.length > 10_000, 'the engine is inlined, not stubbed')
	// A syntax error here is the difference between a plugin and a blank canvas.
	execFileSync(process.execPath, ['--check', join(root, 'dist', 'client.js')], { stdio: 'pipe' })
})

test('the bundle exposes the engine the client body expects', () => {
	const code = readFileSync(join(root, 'dist', 'client.js'), 'utf8')
	for (const module of ['math', 'format', 'compile', 'clip', 'pose', 'ik', 'lint', 'render', 'editor', 'demo']) {
		assert.ok(code.includes(`"${module}": __require('./${module}.js')`), `${module} is exposed to the client body`)
	}
})

test('the bundle registers itself with the module loader', () => {
	const code = readFileSync(join(root, 'dist', 'client.js'), 'utf8')
	assert.match(code, /__ModuleLoader__\.load/)
	assert.match(code, /id: 'dsh-rig-studio'/)
})

test('the registered factory can be materialized and applied', () => {
	const code = readFileSync(join(root, 'dist', 'client.js'), 'utf8')
	let registration
	runInNewContext(code, {
		window: { __ModuleLoader__: { load: (value) => { registration = value } } },
	})
	const exports = registration.factory((id) => {
		assert.equal(id, 'react')
		return { useRef: () => ({}), useEffect: () => {} }
	})
	assert.equal(typeof exports.apply, 'function')
	assert.equal(exports.inject.length, 1)
	assert.equal(exports.inject[0], 'slots')
	exports.apply({ slots: { inject: () => {} } })
})

report()
