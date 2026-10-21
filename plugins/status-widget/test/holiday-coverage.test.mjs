/**
 * Holiday coverage — a calendar data check, not a behaviour check.
 *
 * The peak/off-peak rule depends on a table of Chinese public holidays that is
 * published yearly, roughly at the start of November for the year ahead. This
 * test does not validate the dates (the schedule tests walk every span); it
 * validates that the *year we are living in* is covered at all.
 *
 * It is deliberately time-dependent: an uncovered current year fails, because
 * the table has to be extended before the year it describes begins. A year
 * whose notice is not out yet may be present as a forecast, but that is called
 * out as a note — presence alone must not look like a published notice.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))

/** Load a client bundle and return its exported schedule. */
async function scheduleOf(pluginDir) {
	const file = join(here, '..', '..', pluginDir, 'src', 'client.js')
	const registrations = []
	globalThis.window = {
		__ModuleLoader__: { load: (spec) => registrations.push(spec) },
		localStorage: { getItem: () => null, setItem: () => {} },
		innerWidth: 1280,
		innerHeight: 800,
	}
	await import(`${file}?v=${Math.random()}`)
	return registrations[0].factory((request) => {
		if (request === 'react') {
			return { createElement: () => null, useState: (initial) => [initial, () => {}], useEffect: () => {} }
		}
		throw new Error(`required "${request}"`)
	}).__schedule
}

/** The Beijing calendar year right now — holidays are Beijing-local. */
function currentBeijingYear() {
	return new Date(Date.now() + 8 * 3600000).getUTCFullYear()
}

const year = currentBeijingYear()
const plugins = [['status-widget', await scheduleOf('status-widget')], ['rate-hours', await scheduleOf('rate-hours')]]

let failures = 0
console.log(`\nholiday coverage (Beijing year ${year})`)

for (const [name, schedule] of plugins) {
	const years = Object.keys(schedule.HOLIDAYS).sort()
	const covered = Object.prototype.hasOwnProperty.call(schedule.HOLIDAYS, String(year))
	const provisional = schedule.PROVISIONAL_YEARS?.[year] === true
	console.log(
		`  ${covered ? 'ok  ' : 'FAIL'} ${name}: table covers ${years.join(', ') || 'nothing'}${covered ? (provisional ? ' (provisional)' : '') : ` — missing ${year}`}`,
	)
	if (covered) {
		if (provisional) {
			console.log(`       ${year} is inferred, not published — replace its spans when the State Council notice lands`)
		}
		continue
	}
	failures++
	console.log(`       add the ${year} State Council notice to HOLIDAYS in plugins/${name}/src/client.js`)
}

// A forecast is not a notice. Say which years are still waiting for one.
for (const [name, schedule] of plugins) {
	for (const y of Object.keys(schedule.HOLIDAYS).sort()) {
		if (schedule.PROVISIONAL_YEARS?.[y] === true) {
			console.log(`  note ${name}: ${y} spans are a forecast — replace them when the State Council notice lands`)
		}
	}
}

// Not a failure yet, but worth saying out loud: next year's notice is usually
// published in early November.
const next = year + 1
for (const [name, schedule] of plugins) {
	if (!Object.prototype.hasOwnProperty.call(schedule.HOLIDAYS, String(next))) {
		console.log(`  note ${name}: ${next} not announced yet — the badge says "no holiday table" until it is`)
	}
}

console.log(failures === 0 ? '\n2/2 checks passed' : '\ncoverage missing')
process.exit(failures === 0 ? 0 : 1)
