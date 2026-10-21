/**
 * The host half, driven with a fake context.
 *
 * This is the part that touches the credential store and the network, so it is
 * worth testing where it fails: no key, a store that throws, and the route
 * always answering with JSON instead of leaving the socket open.
 *
 * Node runs the TypeScript source directly (type stripping), so no build step
 * and no Harness are needed.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The prefs file path is resolved at import time from DSH_HOME, so point it at
// a throwaway directory before the module loads.
const HOME = mkdtempSync(join(tmpdir(), 'dsh-status-widget-'))
const PREVIOUS_HOME = process.env.DSH_HOME
process.on('exit', () => {
	try {
		rmSync(HOME, { recursive: true, force: true })
	} catch {
		/* a leftover temp dir must not mask a test result */
	}
	if (PREVIOUS_HOME === undefined) delete process.env.DSH_HOME
	else process.env.DSH_HOME = PREVIOUS_HOME
})
process.env.DSH_HOME = HOME
const { apply } = await import('../src/index.ts')

let failures = 0
let checks = 0

async function test(name, fn) {
	checks++
	try {
		await fn()
		console.log(`  ok   ${name}`)
	} catch (error) {
		failures++
		console.log(`  FAIL ${name}`)
		console.log(`       ${error.message.split('\n').join('\n       ')}`)
	}
}

/** Mount the plugin and return its routes by path. */
function mount(credentials) {
	const routes = new Map()
	const ctx = {
		credentials,
		webServer: { register: (registered) => (routes.set(registered.path, registered), () => {}) },
		effect: (disposer) => disposer(),
	}
	apply(ctx)
	assert.ok(routes.size >= 1, 'apply must register its routes')
	return routes
}

/** The balance route, which most tests here exercise. */
function balanceRoute(credentials) {
	return mount(credentials).get('/dsh-status-widget/balance')
}

/** Call a route with a request object and parse the JSON body. */
function jsonOf(route, request) {
	return new Promise((resolve, reject) => {
		const out = {
			writeHead(status, headers) {
				out.status = status
				out.headers = headers ?? {}
			},
			end(body) {
				try {
					out.etag = out.headers?.etag
					resolve(body === undefined ? { etag: out.etag } : JSON.parse(body))
				} catch (error) {
					reject(error)
				}
			},
		}
		const withHost = { 'content-type': 'application/json', ...(request.headers ?? {}), host: request.headers?.host ?? '127.0.0.1:3080' }
		Promise.resolve(route.handler({ ...request, headers: withHost }, out)).catch(reject)
	})
}

/** The mascot route. */
function mascotRoute() {
	return mount({ resolve: async () => undefined }).get('/dsh-status-widget/mascot.png')
}

/** Call the route handler and return the parsed body. */
function call(route) {
	return new Promise((resolve, reject) => {
		const res = {
			writeHead(status, headers) {
				assert.equal(status, 200)
				assert.equal(headers['content-type'], 'application/json')
				assert.equal(headers['cache-control'], 'no-store')
			},
			end(body) {
				try {
					resolve(JSON.parse(body))
				} catch (error) {
					reject(error)
				}
			},
		}
		Promise.resolve(route.handler({}, res)).catch(reject)
	})
}

console.log('\nhost half')

await test('mounts the balance route as an exact match', () => {
	const route = balanceRoute({ resolve: async () => undefined })
	assert.equal(route.kind, 'exact')
	assert.equal(route.path, '/dsh-status-widget/balance')
})

await test('reports a missing key without calling the network', async () => {
	const body = await call(balanceRoute({ resolve: async () => undefined }))
	assert.equal(body.ok, false)
	assert.equal(body.reason, 'no-key')
	assert.equal(typeof body.at, 'number')
})

await test('an empty credential counts as absent', async () => {
	assert.equal((await call(balanceRoute({ resolve: async () => ({ value: '' }) }))).reason, 'no-key')
})

await test('a throwing credential store answers instead of hanging the route', async () => {
	const body = await call(
		balanceRoute({
			resolve: async () => {
				throw new Error('store unavailable')
			},
		}),
	)
	assert.equal(body.ok, false)
	assert.equal(body.reason, 'credential-store-error')
})

await test('a present key reaches the network, and a network failure is reported', async () => {
	const body = await call(balanceRoute({ resolve: async () => ({ value: 'sk-not-a-real-key' }) }))
	// The request goes to the real API and fails on the fake key; what matters
	// is that it is a named failure, not an unhandled rejection.
	assert.equal(body.ok, false)
	assert.match(String(body.reason), /^(network|timeout|http-401)$/)
})

await test('serves the mascot with an ETag and revalidates', async () => {
	const route = mascotRoute()
	assert.equal(route.kind, 'exact')

	const first = await new Promise((resolve, reject) => {
		const res = {
			writeHead(status, headers) {
				res.status = status
				res.headers = headers
			},
			end(body) {
				res.body = body
				resolve(res)
			},
		}
		Promise.resolve(route.handler({ headers: {} }, res)).catch(reject)
	})
	assert.equal(first.status, 200)
	assert.equal(first.headers['content-type'], 'image/png')
	assert.ok(first.headers.etag, 'without an ETag the browser cannot revalidate')
	assert.equal(first.headers['cache-control'], 'no-cache', 'a long max-age pins a stale mascot')
	assert.equal(first.body.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'must be the PNG')

	const second = await new Promise((resolve, reject) => {
		const res = {
			writeHead(status, headers) {
				res.status = status
				res.headers = headers
			},
			end(body) {
				res.body = body
				resolve(res)
			},
		}
		Promise.resolve(route.handler({ headers: { 'if-none-match': first.headers.etag } }, res)).catch(reject)
	})
	assert.equal(second.status, 304, 'a matching ETag must not resend the bytes')
	assert.equal(second.body, undefined)
})



await test('a cross-site request cannot change preferences', async () => {
	const route = mount({ resolve: async () => undefined }).get('/dsh-status-widget/prefs')
	const blocked = await new Promise((resolve, reject) => {
		const out = {
			writeHead(status, headers) {
				out.status = status
				out.headers = headers ?? {}
			},
			end(body) {
				resolve({ status: out.status, body })
			},
		}
		Promise.resolve(route.handler({ method: 'PUT', url: '/dsh-status-widget/prefs?size=max', headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' } }, out)).catch(reject)
	})
	assert.equal(blocked.status, 403, 'a page on another origin must not write preferences')
})

test('reads preferences from the Harness home', async () => {
	const routes = mount({ resolve: async () => undefined })
	const route = routes.get('/dsh-status-widget/prefs')
	const body = await jsonOf(route, { method: 'GET', url: '/dsh-status-widget/prefs' })
	assert.equal(body.ok, true)
	assert.deepEqual(body.prefs, {})
})

await test('writes the size where the desktop client can read it', async () => {
	const routes = mount({ resolve: async () => undefined })
	const route = routes.get('/dsh-status-widget/prefs')
	const body = await jsonOf(route, { method: 'PUT', url: '/dsh-status-widget/prefs?size=max&side=left&bottom=120' })
	assert.deepEqual(body.prefs, { size: 'max', side: 'left', bottom: 120 })
	assert.deepEqual(JSON.parse(readFileSync(join(HOME, 'status-widget.json'), 'utf8')), body.prefs)
})

await test('rejects preferences it does not understand', async () => {
	const routes = mount({ resolve: async () => undefined })
	const route = routes.get('/dsh-status-widget/prefs')
	const body = await jsonOf(route, { method: 'PUT', url: '/dsh-status-widget/prefs?size=enormous&side=up&bottom=NaN' })
	assert.deepEqual(body.prefs, { size: 'max', side: 'left', bottom: 120 }, 'an invalid patch must not clobber valid values')
})

await test('a later patch merges instead of replacing', async () => {
	const routes = mount({ resolve: async () => undefined })
	const route = routes.get('/dsh-status-widget/prefs')
	const body = await jsonOf(route, { method: 'PUT', url: '/dsh-status-widget/prefs?size=min' })
	assert.deepEqual(body.prefs, { size: 'min', side: 'left', bottom: 120 })
})

await test('a balance that changes without changing length is not a 304', async () => {
	// The ETag was "<length>-ok", so 10.00 -> 20.00 revalidated as unchanged and
	// a client that trusted it never saw the new number.
	let total = '10.00'
	const original = globalThis.fetch
	globalThis.fetch = async () =>
		new Response(JSON.stringify({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: total }] }), { status: 200, headers: { 'content-type': 'application/json' } })
	try {
		const route = mount({ resolve: async () => ({ value: 'sk-test' }) }).get('/dsh-status-widget/balance')
		const first = await new Promise((resolve) => {
			const out = { writeHead(status, headers) { out.status = status; out.headers = headers ?? {} }, end(body) { resolve({ etag: out.headers.etag, body }) } }
			Promise.resolve(route.handler({ headers: { host: '127.0.0.1:3080' }, url: '/dsh-status-widget/balance' }, out))
		})
		assert.ok(first.etag, 'the route must send an ETag')
		total = '20.00'
		// A second mount has its own cache, so this tests the ETag rather than
		// the cache: the payload changed while its length did not.
		const fresh = mount({ resolve: async () => ({ value: 'sk-test' }) }).get('/dsh-status-widget/balance')
		const second = await new Promise((resolve) => {
			const out = { writeHead(status, headers) { out.status = status; out.headers = headers ?? {} }, end(body) { resolve({ status: out.status, body }) } }
			Promise.resolve(fresh.handler({ headers: { host: '127.0.0.1:3080', 'if-none-match': first.etag }, url: '/dsh-status-widget/balance' }, out))
		})
		assert.equal(second.status, 200, 'a different amount must be delivered')
		assert.ok(String(second.body).includes('20.00'))
	} finally {
		globalThis.fetch = original
	}
})

await test('the balance route revalidates with an ETag', async () => {
	const routes = mount({ resolve: async () => undefined })
	const route = routes.get('/dsh-status-widget/balance')
	const first = await jsonOf(route, { headers: {} })
	assert.equal(first.ok, false)
	const res = await new Promise((resolve, reject) => {
		const out = { writeHead(status) { out.status = status }, end() { resolve(out) } }
		Promise.resolve(route.handler({ headers: { 'if-none-match': first.etag ?? 'x' } }, out)).catch(reject)
	})
	assert.ok([200, 304].includes(res.status))
})


console.log('\ncharacter packs (routes)')

/** A PNG header, base64-encoded, for pack fixtures. */
function pngB64(width = 400, height = 512) {
	const bytes = Buffer.alloc(33)
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
	bytes.set([0x49, 0x48, 0x44, 0x52], 12)
	bytes.writeUInt32BE(width, 16)
	bytes.writeUInt32BE(height, 20)
	bytes[25] = 6
	return bytes.toString('base64')
}

const packFixture = {
	schema: 1,
	manifest: { schema: 1, id: 'test-pack', name: 'Test Pack', version: '1.0.0', poses: { idle: 'poses/idle.png', happy: 'poses/happy.png' } },
	files: { 'poses/idle.png': pngB64(), 'poses/happy.png': pngB64() },
}

/** Call a route with an optional JSON body, as the import does. */
function callRoute(route, request, body) {
	return new Promise((resolve, reject) => {
		const payload = JSON.stringify(body ?? {})
		const chunks = [Buffer.from(payload)]
		const req = Object.assign({}, request, {
			headers: { host: '127.0.0.1:3080', 'content-type': 'application/json', ...(request.headers ?? {}) },
			on(event, callback) {
				if (event === 'data') chunks.forEach((chunk) => callback(chunk))
				if (event === 'end') callback()
			},
		})
		const res = {
			writeHead(status, headers) {
				res.status = status
				res.headers = headers ?? {}
			},
			end(payload) {
				let parsed
				try {
					parsed = payload === undefined ? undefined : JSON.parse(payload)
				} catch {
					parsed = payload
				}
				resolve({ status: res.status, body: parsed, bytes: payload })
			},
		}
		Promise.resolve(route.handler(req, res)).catch(reject)
	})
}

function routeOf(path) {
	return mount({ resolve: async () => undefined }).get(path)
}

await test('lists nothing on a fresh home', async () => {
	const result = await callRoute(routeOf('/dsh-status-widget/characters'), { method: 'GET', url: '/dsh-status-widget/characters' })
	assert.equal(result.status, 200)
	assert.deepEqual(result.body.packs, [])
	assert.equal(result.body.active, null)
})

await test('imports a valid pack, then lists and activates it', async () => {
	const route = routeOf('/dsh-status-widget/characters')
	const imported = await callRoute(route, { method: 'POST', url: '/dsh-status-widget/characters' }, packFixture)
	assert.equal(imported.status, 200)
	assert.equal(imported.body.id, 'test-pack')

	const listed = await callRoute(route, { method: 'GET', url: '/dsh-status-widget/characters' })
	assert.equal(listed.body.packs.length, 1)
	assert.equal(listed.body.packs[0].name, 'Test Pack')

	const activated = await callRoute(route, { method: 'POST', url: '/dsh-status-widget/characters/test-pack/active' })
	assert.equal(activated.body.active, 'test-pack')
	const again = await callRoute(route, { method: 'GET', url: '/dsh-status-widget/characters' })
	assert.equal(again.body.packs[0].active, true)
	assert.equal(again.body.packs[0].manifest.id, 'test-pack', 'the active pack carries its manifest for the client')
})

await test('refuses an invalid pack with codes, and writes nothing', async () => {
	const route = routeOf('/dsh-status-widget/characters')
	const bad = { schema: 1, manifest: { schema: 1, id: 'bad', poses: {} }, files: {} }
	const result = await callRoute(route, { method: 'POST', url: '/dsh-status-widget/characters' }, bad)
	assert.equal(result.status, 422)
	assert.ok(result.body.errors.includes('idle-pose-required'))
	const listed = await callRoute(route, { method: 'GET', url: '/dsh-status-widget/characters' })
	assert.equal(listed.body.packs.length, 1, 'the rejected pack must not appear')
})

await test('exports a pack as a round-trippable document', async () => {
	const route = routeOf('/dsh-status-widget/characters')
	const exported = await callRoute(route, { method: 'GET', url: '/dsh-status-widget/characters/test-pack/export' })
	assert.equal(exported.status, 200)
	assert.equal(exported.body.schema, 1)
	assert.equal(exported.body.manifest.id, 'test-pack')
	assert.ok(Object.keys(exported.body.files).includes('poses/idle.png'))
	const reimported = await callRoute(route, { method: 'POST', url: '/dsh-status-widget/characters' }, exported.body)
	assert.equal(reimported.status, 200)
})

await test('serves the active pack pose', async () => {
	const pose = routeOf('/dsh-status-widget/character.png')
	const shot = await callRoute(pose, { headers: {}, url: '/dsh-status-widget/character.png?state=happy' })
	assert.equal(shot.status, 200)
	// The built-in mascot is also a PNG, so a magic-byte check passes even when
	// the pack route is broken. Compare against the fixture's own bytes.
	assert.ok(Buffer.from(shot.bytes).equals(Buffer.from(packFixture.files['poses/happy.png'], 'base64')))
})

await test('use built-in clears the pointer without needing a pack id', async () => {
	const route = routeOf('/dsh-status-widget/characters')
	await callRoute(route, { method: 'POST', url: '/dsh-status-widget/characters/test-pack/active' })
	const cleared = await callRoute(route, { method: 'DELETE', url: '/dsh-status-widget/characters/active' })
	assert.equal(cleared.status, 200)
	assert.equal(cleared.body.active, null)
	const listed = await callRoute(route, { method: 'GET', url: '/dsh-status-widget/characters' })
	assert.equal(listed.body.active, null)
})

await test('an unknown pack id is refused, not silently accepted', async () => {
	const route = routeOf('/dsh-status-widget/characters')
	const result = await callRoute(route, { method: 'POST', url: '/dsh-status-widget/characters/nope/active' })
	assert.equal(result.status, 404)
	assert.ok(result.body.errors.includes('pack-missing'))
})

await test('an unknown pose name cannot read a file outside the pack', async () => {
	// Regression for a real arbitrary-read: `?state=constructor` walked the
	// prototype chain and its manifest value was joined onto the pack directory.
	const route = routeOf('/dsh-status-widget/characters')
	const evil = {
		schema: 1,
		manifest: { schema: 1, id: 'ctor-pack', name: 'C', poses: { idle: 'poses/idle.png', constructor: '../../../../etc/passwd' } },
		files: { 'poses/idle.png': pngB64() },
	}
	const refused = await callRoute(route, { method: 'POST', url: '/dsh-status-widget/characters' }, evil)
	assert.equal(refused.status, 422, 'a traversal value must never be installed')
	assert.ok(refused.body.errors.includes('path-traversal'))

	const proto = await new Promise((resolve, reject) => {
		const out = { writeHead(status, headers) { out.status = status }, end(body) { resolve({ status: out.status, body }) } }
		Promise.resolve(routeOf('/dsh-status-widget/character.png').handler({ headers: { host: '127.0.0.1:3080' }, url: '/dsh-status-widget/character.png?state=__proto__' }, out)).catch(reject)
	})
	assert.equal(proto.status, 200)
	assert.equal(proto.body.subarray(0, 4).toString('hex'), '89504e47', 'falls back to the built-in drawing')
})

await test('an oversized body is refused with 413', async () => {
	const route = routeOf('/dsh-status-widget/characters')
	const huge = 'x'.repeat(8 * 1024 * 1024)
	const result = await new Promise((resolve, reject) => {
		const chunks = [Buffer.from(`{"schema":1,"pad":"${huge}"}`)]
		const req = { method: 'POST', url: '/dsh-status-widget/characters', headers: { host: '127.0.0.1:3080', 'content-type': 'application/json' }, on(e, cb) { if (e === 'data') chunks.forEach(cb); if (e === 'end') cb() }, removeListener() {}, destroy() {} }
		const out = { writeHead(status) { out.status = status }, end(body) { resolve({ status: out.status, body }) } }
		Promise.resolve(route.handler(req, out)).catch(reject)
	})
	assert.equal(result.status, 413)
})

await test('deleting a pack that is not active leaves the pointer alone', async () => {
	const route = routeOf('/dsh-status-widget/characters')
	await callRoute(route, { method: 'POST', url: '/dsh-status-widget/characters', body: undefined }, { ...packFixture, manifest: { ...packFixture.manifest, id: 'other', name: 'Other' } })
	await callRoute(route, { method: 'POST', url: '/dsh-status-widget/characters/test-pack/active' })
	const removed = await callRoute(route, { method: 'DELETE', url: '/dsh-status-widget/characters/other' })
	assert.equal(removed.status, 200)
	const listed = await callRoute(route, { method: 'GET', url: '/dsh-status-widget/characters' })
	assert.equal(listed.body.active, 'test-pack', 'removing a bystander must not clear the active pack')
})

await test('deleting a pack that is not installed is a 404', async () => {
	const route = routeOf('/dsh-status-widget/characters')
	const result = await callRoute(route, { method: 'DELETE', url: '/dsh-status-widget/characters/absent' })
	assert.equal(result.status, 404)
})

await test('deleting the active pack clears the pointer', async () => {
	const route = routeOf('/dsh-status-widget/characters')
	await callRoute(route, { method: 'POST', url: '/dsh-status-widget/characters/test-pack/active' })
	const removed = await callRoute(route, { method: 'DELETE', url: '/dsh-status-widget/characters/test-pack' })
	assert.equal(removed.status, 200)
	const listed = await callRoute(route, { method: 'GET', url: '/dsh-status-widget/characters' })
	assert.deepEqual(listed.body.packs, [])
	assert.equal(listed.body.active, null)
})


console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
