/**
 * Tests for dsh-rate-hours. No Harness runtime needed.
 *
 * Three things are checked here:
 *   1. The bundle speaks the client-module loader protocol and registers into
 *      the right slot — the handshake that silently produces a blank screen
 *      when it is wrong.
 *   2. The schedule: both peak blocks and their four edges, the gap between
 *      them, weekends, Chinese public holidays, and the weekday after one.
 *   3. The component builds a sane element tree against a React stub. Real
 *      React lives in the browser shell bundle, not on disk, so the render
 *      check cannot be an SSR render.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

let failures = 0
let checks = 0

function test(name, fn) {
	checks++
	try {
		fn()
		console.log(`  ok   ${name}`)
	} catch (error) {
		failures++
		console.log(`  FAIL ${name}`)
		console.log(`       ${error.message.split('\n').join('\n       ')}`)
	}
}

/** Load the bundle the way the browser would: register, then materialize. */
async function loadBundle(requireImpl) {
	const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client.js')
	const registrations = []
	globalThis.window = {
		__ModuleLoader__: {
			load(spec) {
				registrations.push(spec)
			},
		},
	}
	await import(`${file}?v=${Math.random()}`)
	assert.equal(registrations.length, 1, 'bundle must call __ModuleLoader__.load exactly once')
	const spec = registrations[0]
	const exported = spec.factory(requireImpl ?? {})
	return { spec, exported }
}

/** Enough React for the component to build a tree: no scheduling, no effects. */
function createReactStub() {
	return {
		createElement(type, props, ...children) {
			const flat = children.length <= 1 ? children[0] : children
			return { type, props: { ...(props ?? {}), children: flat } }
		},
		useState(initial) {
			return [typeof initial === 'function' ? initial() : initial, () => {}]
		},
		useEffect() {},
	}
}

// Anything the bundle requires must be a platform seed (react) — an undeclared
// external would resolve to an empty module in the browser, so fail loudly here.
const { spec, exported } = await loadBundle((name) => {
	if (name === 'react') return createReactStub()
	throw new Error(`bundle required "${name}", which is not a platform seed module`)
})
const schedule = exported.__schedule

console.log('\nbundle handshake')

test('registers under the package name the boot graph will look up', () => {
	assert.equal(spec.id, 'dsh-rate-hours')
	assert.equal(typeof spec.factory, 'function')
})

test('exports apply and inject, not a factory', () => {
	assert.equal(typeof exported.apply, 'function')
	assert.deepEqual(exported.inject, ['slots'])
})

test('apply registers one entry in the composer row', () => {
	const calls = []
	const ctx = {
		slots: {
			inject(name, fn) {
				calls.push(['inject', name])
				return fn()
			},
			register(options, component) {
				calls.push(['register', options, component])
			},
		},
	}
	exported.apply(ctx)
	assert.deepEqual(calls[0], ['inject', 'conversation.input.left'])
	assert.equal(calls[1][1].name, 'conversation.input.left')
	assert.equal(calls[1][1].id, 'rate-hours')
	assert.equal(typeof calls[1][2], 'function')
})

console.log('\nschedule: peak block edges (Tue 2026-10-13, an ordinary weekday)')

const at = (iso) => Date.parse(iso)
const tue = '2026-10-13T'

for (const [time, peak, why] of [
	['00:59', false, 'one minute before the first block'],
	['01:00', true, 'first block opens'],
	['03:59', true, 'first block, last minute'],
	['04:00', false, 'first block closes'],
	['05:59', false, 'in the gap between blocks'],
	['06:00', true, 'second block opens'],
	['09:59', true, 'second block, last minute'],
	['10:00', false, 'second block closes'],
]) {
	test(`${time}Z is ${peak ? 'peak' : 'off-peak'} (${why})`, () => {
		assert.equal(schedule.isPeak(at(`${tue}${time}:00Z`)), peak)
	})
}

console.log('\nschedule: weekends and holidays')

test('Saturday is off-peak all day', () => {
	assert.equal(schedule.isPeak(at('2026-03-07T02:00:00Z')), false)
})
test('Sunday is off-peak all day', () => {
	assert.equal(schedule.isPeak(at('2026-03-08T02:00:00Z')), false)
})
test('a holiday weekday is off-peak (Mon 2026-10-05, National Day)', () => {
	assert.equal(schedule.isPeak(at('2026-10-05T02:00:00Z')), false)
})
test('the weekday after the holiday is peak again (Thu 2026-10-08)', () => {
	assert.equal(schedule.isPeak(at('2026-10-08T02:00:00Z')), true)
})
test('every holiday span covers a weekday that would otherwise be peak', () => {
	for (const [year, spans] of Object.entries(schedule.HOLIDAYS)) {
		for (const [start, end] of spans) {
			let t = at(`${start}T02:00:00Z`)
			const stop = at(`${end}T02:00:00Z`)
			for (; t <= stop; t += 86400000) {
				if ([0, 6].includes(new Date(t).getUTCDay())) continue
				assert.equal(schedule.isPeak(t), false, `${new Date(t).toISOString().slice(0, 10)} in ${year} should be holiday-off-peak`)
			}
		}
	}
})
test('Beijing dates roll at 16:00 UTC', () => {
	assert.equal(schedule.beijingDate(at('2026-09-30T17:00:00Z')), '2026-10-01')
	assert.equal(schedule.beijingDate(at('2026-10-31T16:00:00Z')), '2026-11-01')
})
test('an unknown year falls back to the weekday rule and says so', () => {
	assert.equal(schedule.holidayDataKnown('2027-10-05'), false)
	const status = schedule.describe(at('2027-10-05T02:00:00Z'))
	assert.equal(status.holiday, false)
	assert.equal(status.holidayKnown, false)
	assert.match(status.title, /No holiday table for 2027/)
})

console.log('\nschedule: transitions')

test('off-peak points at the next peak', () => {
	const next = schedule.nextTransition(at('2026-10-20T11:21:00Z'))
	assert.equal(next.toPeak, true)
	assert.equal(new Date(next.at).toISOString(), '2026-10-21T01:00:00.000Z')
})
test('peak points at the next off-peak', () => {
	const next = schedule.nextTransition(at('2026-10-21T02:00:00Z'))
	assert.equal(next.toPeak, false)
	assert.equal(new Date(next.at).toISOString(), '2026-10-21T04:00:00.000Z')
})
test('Friday afternoon points across the weekend to Monday', () => {
	const next = schedule.nextTransition(at('2026-10-23T11:00:00Z'))
	assert.equal(next.toPeak, true)
	assert.equal(new Date(next.at).toISOString(), '2026-10-26T01:00:00.000Z')
})
test('a transition is always strictly in the future and always flips', () => {
	for (let t = at('2026-10-19T00:00:00Z'); t < at('2026-10-26T00:00:00Z'); t += 7 * 60000) {
		const next = schedule.nextTransition(t)
		assert.ok(next !== null, `no transition found from ${new Date(t).toISOString()}`)
		assert.ok(next.at > t, 'transition must be in the future')
		assert.equal(schedule.isPeak(next.at), next.toPeak)
		assert.equal(schedule.isPeak(next.at - 60000), !next.toPeak)
	}
})
test('the run start is the last minute of the previous run', () => {
	const start = schedule.runStart(at('2026-10-21T02:00:00Z'))
	assert.equal(new Date(start).toISOString(), '2026-10-21T01:00:00.000Z')
})
test('formatDuration', () => {
	assert.equal(schedule.formatDuration(30 * 1000), '<1m')
	assert.equal(schedule.formatDuration(2 * 60000), '2m')
	assert.equal(schedule.formatDuration(8 * 3600000 + 36 * 60000), '8h 36m')
	assert.equal(schedule.formatDuration(46 * 3600000), '1d 22h')
})

console.log('\ncomponent')

test('builds a dot and a rate line for each rate class', () => {
	const markup = (ms) => {
		// The component reads Date.now(); drive it by pinning the clock.
		const realNow = Date.now
		Date.now = () => ms
		try {
			return JSON.stringify(exported.RateHours())
		} finally {
			Date.now = realNow
		}
	}

	const peak = markup(at('2026-10-21T02:00:00Z'))
	assert.match(peak, /Peak pricing/)
	assert.match(peak, /off-peak in 2h 0m/)
	assert.match(peak, /#e5484d/)

	const offpeak = markup(at('2026-10-20T11:21:00Z'))
	assert.match(offpeak, /Off-peak/)
	assert.match(offpeak, /peak in 13h 39m/)
	assert.match(offpeak, /#f5a524/)

	const holiday = markup(at('2026-10-05T02:00:00Z'))
	assert.match(holiday, /Holiday off-peak/)
	assert.match(holiday, /#3fb950/)

	const weekend = markup(at('2026-10-24T02:00:00Z'))
	assert.match(weekend, /Weekend off-peak/)
	assert.match(weekend, /#3fb950/)
})

test('the tooltip states the schedule and its own uncertainty', () => {
	const status = schedule.describe(at('2026-10-20T11:21:00Z'))
	assert.match(status.title, /01:00-04:00 and 06:00-10:00 UTC/)
	assert.match(status.title, /excluding Chinese public holidays/)
	assert.match(status.title, /browser clock, not the Host/)
})

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
