/**
 * The schedule is duplicated between plugins/rate-hours and
 * plugins/status-widget: client bundles cannot require each other without a
 * cross-plugin dependency, and either plugin alone should work.
 *
 * Duplication is only safe if drift fails loudly. This test loads both bundles,
 * drives their schedules over all of 2026, and fails if they ever disagree —
 * so the next person to fix a peak block in one file is told about the other.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const sibling = join(here, '..', '..', 'rate-hours')

/** Load a client bundle the way the browser does and return its exports. */
async function load(pluginDir) {
	const file = join(here, '..', '..', pluginDir, 'src', 'client.js')
	const registrations = []
	globalThis.window = {
		__ModuleLoader__: { load: (spec) => registrations.push(spec) },
		localStorage: { getItem: () => null, setItem: () => {} },
	}
	await import(`${file}?v=${Math.random()}`)
	assert.equal(registrations.length, 1, `${pluginDir} must register exactly once`)
	return registrations[0].factory((request) => {
		if (request === 'react') {
			return {
				createElement: (type, props, ...children) => ({ type, props, children }),
				useState: (initial) => [initial, () => {}],
				useEffect: () => {},
			}
		}
		throw new Error(`${pluginDir} required "${request}"`)
	})
}

const ours = (await load('status-widget')).__schedule
const theirs = (await load('rate-hours')).__schedule

console.log('\nschedule parity: status-widget vs rate-hours')

let mismatches = 0
const examples = []

const start = Date.UTC(2026, 0, 1)
const end = Date.UTC(2027, 0, 1)
for (let t = start; t < end; t += 15 * 60 * 1000) {
	if (ours.isPeak(t) !== theirs.isPeak(t)) {
		mismatches++
		if (examples.length < 5) examples.push(new Date(t).toISOString())
	}
}

assert.equal(
	mismatches,
	0,
	`isPeak disagrees at ${mismatches} sample(s) across 2026, e.g. ${examples.join(', ')}`,
)
console.log('  ok   isPeak agrees on every 15-minute sample of 2026')

assert.deepEqual(ours.HOLIDAYS, theirs.HOLIDAYS)
console.log('  ok   holiday tables are identical')

for (const iso of ['2026-03-07T02:00:00Z', '2026-10-05T02:00:00Z', '2026-10-13T02:30:00Z', '2026-12-25T09:00:00Z']) {
	const t = Date.parse(iso)
	assert.equal(ours.describe(t).text, theirs.describe(t).text, `descriptions differ at ${iso}`)
	assert.equal(ours.nextTransition(t)?.at, theirs.nextTransition(t)?.at, `next transition differs at ${iso}`)
}
console.log('  ok   descriptions and transitions agree at sample instants')

console.log('\n3/3 checks passed')
