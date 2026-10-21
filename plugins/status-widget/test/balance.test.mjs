/**
 * Balance module: normalization, the request, and the cache.
 *
 * No Harness runtime and no network — the fetch is injected, which is the
 * point of keeping this module free of Cordis.
 */
import assert from 'node:assert/strict'
import { createBalanceCache, fetchBalance, normalizeBalance } from '../src/balance.js'

let failures = 0
let checks = 0

function test(name, fn) {
	checks++
	return Promise.resolve()
		.then(fn)
		.then(() => console.log(`  ok   ${name}`))
		.catch((error) => {
			failures++
			console.log(`  FAIL ${name}`)
			console.log(`       ${error.message.split('\n').join('\n       ')}`)
		})
}

console.log('\nnormalizeBalance')

await test('keeps amounts as the decimal strings the API sent', () => {
	const result = normalizeBalance({
		is_available: true,
		balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }],
	})
	assert.deepEqual(result, {
		ok: true,
		available: true,
		balances: [{ currency: 'CNY', total: '110.00', granted: '10.00', toppedUp: '100.00' }],
	})
})

await test('marks an insufficient account without failing the read', () => {
	const result = normalizeBalance({ is_available: false, balance_infos: [{ currency: 'USD', total_balance: '0.00' }] })
	assert.equal(result.ok, true)
	assert.equal(result.available, false)
})

await test('drops entries that are missing a currency or a total', () => {
	const result = normalizeBalance({
		balance_infos: [{ currency: 'CNY', total_balance: '5.00' }, { currency: 'USD' }, { total_balance: '1.00' }, null],
	})
	assert.equal(result.balances.length, 1)
	assert.equal(result.balances[0].currency, 'CNY')
})

await test('reports malformed bodies and empty balance lists as failures', () => {
	assert.equal(normalizeBalance(null).ok, false)
	assert.equal(normalizeBalance('nope').ok, false)
	assert.equal(normalizeBalance({ balance_infos: [] }).reason, 'no-balance-info')
})

console.log('\nfetchBalance')

await test('sends the key as a bearer token to the documented path', async () => {
	let seen
	const result = await fetchBalance({
		apiKey: 'sk-test',
		fetchImpl: async (url, init) => {
			seen = { url, auth: init.headers.authorization, method: init.method }
			return { ok: true, json: async () => ({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '1.00' }] }) }
		},
	})
	assert.equal(seen.url, 'https://api.deepseek.com/user/balance')
	assert.equal(seen.auth, 'Bearer sk-test')
	assert.equal(seen.method, 'GET')
	assert.equal(result.ok, true)
})

await test('turns an HTTP status into a reason rather than throwing', async () => {
	const result = await fetchBalance({
		apiKey: 'sk-test',
		fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
	})
	assert.deepEqual(result, { ok: false, reason: 'http-401' })
})

await test('distinguishes a timeout from a network failure', async () => {
	const timeout = await fetchBalance({
		apiKey: 'sk-test',
		fetchImpl: async () => {
			const error = new Error('timed out')
			error.name = 'TimeoutError'
			throw error
		},
	})
	assert.equal(timeout.reason, 'timeout')

	const network = await fetchBalance({
		apiKey: 'sk-test',
		fetchImpl: async () => {
			throw new TypeError('fetch failed')
		},
	})
	assert.equal(network.reason, 'network')
})

console.log('\ncreateBalanceCache')

await test('serves a fresh read from cache', async () => {
	let calls = 0
	let clock = 1000
	const read = createBalanceCache({
		ttlMs: 60000,
		now: () => clock,
		read: async () => {
			calls++
			return { ok: true, n: calls }
		},
	})
	assert.equal((await read()).n, 1)
	clock += 1000
	assert.equal((await read()).n, 1)
	assert.equal(calls, 1)
})

await test('re-reads once the TTL expires, including a failed read', async () => {
	let calls = 0
	let clock = 0
	const read = createBalanceCache({
		ttlMs: 1000,
		now: () => clock,
		read: async () => {
			calls++
			return { ok: false, reason: 'network' }
		},
	})
	await read()
	clock += 500
	await read()
	assert.equal(calls, 1)
	clock += 600
	await read()
	assert.equal(calls, 2)
})

await test('collapses concurrent callers into one request', async () => {
	let calls = 0
	const read = createBalanceCache({
		ttlMs: 60000,
		read: async () => {
			calls++
			await new Promise((resolve) => setTimeout(resolve, 5))
			return { ok: true }
		},
	})
	await Promise.all([read(), read(), read(), read()])
	assert.equal(calls, 1)
})

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
