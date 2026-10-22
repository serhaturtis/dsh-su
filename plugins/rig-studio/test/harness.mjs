/**
 * A four-line test harness, so every file in this suite reads the same and needs
 * no dependency. Tests are synchronous on purpose: the runtime is pure, and a
 * test that needs a timer is testing the wrong thing.
 */
let failures = 0
let checks = 0

export function test(name, fn) {
	checks++
	try {
		fn()
		console.log(`  ok   ${name}`)
	} catch (error) {
		failures++
		console.log(`  FAIL ${name}`)
		console.log(`       ${String(error.message).split('\n').join('\n       ')}`)
	}
}

export function report() {
	console.log(`\n${checks - failures}/${checks} checks passed`)
	process.exit(failures === 0 ? 0 : 1)
}
