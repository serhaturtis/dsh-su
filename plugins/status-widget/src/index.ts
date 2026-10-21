/**
 * dsh-status-widget — host half.
 *
 * Two jobs: resolve the DeepSeek key from the credential store, and hand the
 * browser one cached JSON reading of the account balance. The key never leaves
 * this process — the route returns amounts, never the credential.
 *
 * The two service shapes are declared locally rather than imported, because a
 * plugin that only reads a key and mounts one route should not add two
 * packages to every install for the sake of type annotations.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createBalanceCache, fetchBalance } from './balance.js'
import { LIMITS, posePath, safeAudioPath, safePath, validateManifest, validatePack } from './pack.js'

export const name = 'dsh-status-widget'

/** Both services must exist before the route is mounted. */
export const inject = ['credentials', 'webServer']

const KEY_REF = 'DEEPSEEK_API_KEY'
const ROUTE = '/dsh-status-widget/balance'
const PREFS_ROUTE = '/dsh-status-widget/prefs'
const CHARACTERS_ROUTE = '/dsh-status-widget/characters'
const CHARACTER_ROUTE = '/dsh-status-widget/character.png'
const SHEET_ROUTE = '/dsh-status-widget/character/sheet.png'
const SOUND_ROUTE = '/dsh-status-widget/character/sound'

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const CHARACTERS_DIR = join(DSH_HOME, 'status-widget', 'characters')
const ACTIVE_FILE = join(DSH_HOME, 'status-widget', 'character.json')

/**
 * Whether a request may touch this plugin's state.
 *
 * The webserver leaves request policy to the route owner, and these routes
 * install files and rewrite preferences, so "anyone who can reach the port"
 * is not an acceptable answer: a web page can send a CORS-simple POST to
 * loopback. Same-origin, loopback Host, and an explicit JSON content type for
 * imports.
 */
function trustedRequest(req: { headers?: Record<string, string | string[] | undefined> }, options: { json?: boolean } = {}): boolean {
	const header = (name: string): string | undefined => {
		const value = req.headers?.[name]
		return Array.isArray(value) ? value[0] : value
	}
	const host = header('host')
	if (host === undefined) return false
	const hostname = host.replace(/:\d+$/, '').replace(/^\[/, '').replace(/\]$/, '')
	const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
	if (!loopback) return false
	const site = header('sec-fetch-site')
	// A cross-site fetch is a web page, never the widget.
	if (site === 'cross-site' || site === 'same-site') return false
	const origin = header('origin')
	if (origin !== undefined && origin !== 'null') {
		try {
			if (new URL(origin).host !== host) return false
		} catch {
			return false
		}
	}
	if (options.json === true) {
		const type = (header('content-type') ?? '').toLowerCase()
		if (!type.startsWith('application/json')) return false
	}
	return true
}

/** Requests larger than this are refused before a byte is buffered. */
// The body carries base64, so it is ~4/3 the decoded budget.
const MAX_IMPORT_BYTES = Math.ceil((LIMITS.packBytes * 4) / 3) + 1024 * 1024

/** Read and parse a JSON request body, refusing anything oversized. */
async function readJsonBody(
	req: {
		on(event: string, cb: (chunk?: Uint8Array) => void): void
		removeListener?(event: string, cb: (chunk?: Uint8Array) => void): void
		destroy?(): void
		complete?: boolean
	},
): Promise<unknown> {
	const chunks: Uint8Array[] = []
	let total = 0
	await new Promise<void>((resolve, reject) => {
		let settled = false
		const finish = (error?: Error) => {
			if (settled) return
			settled = true
			req.removeListener?.('data', onData)
			req.removeListener?.('end', onEnd)
			req.removeListener?.('error', onError)
			req.removeListener?.('aborted', onAborted)
			req.removeListener?.('close', onClose)
			if (error !== undefined) reject(error)
			else resolve()
		}
		const onData = (chunk?: Uint8Array) => {
			total += chunk?.byteLength ?? 0
			if (total > MAX_IMPORT_BYTES) {
				// Stop the upload instead of buffering the rest of it.
				finish(new Error('too-large'))
				req.destroy?.()
				return
			}
			if (chunk !== undefined) chunks.push(chunk)
		}
		const onEnd = () => finish()
		const onError = () => finish(new Error('read-failed'))
		// A client that hangs up mid-body emits 'aborted' and 'close', never 'error'.
		const onAborted = () => finish(new Error('aborted'))
		const onClose = () => {
			if (req.complete !== true) finish(new Error('aborted'))
		}
		req.on('data', onData)
		req.on('end', onEnd)
		req.on('error', onError)
		req.on('aborted', onAborted)
		req.on('close', onClose)
	})
	return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'))
}

/** The installed pack ids, whatever the directory holds. */
async function installedIds(): Promise<string[]> {
	try {
		const entries = await readdir(CHARACTERS_DIR, { withFileTypes: true })
		return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
	} catch {
		return []
	}
}

async function readActive(): Promise<string | null> {
	try {
		const parsed = JSON.parse(await readFile(ACTIVE_FILE, 'utf8'))
		return typeof parsed.active === 'string' ? parsed.active : null
	} catch {
		return null
	}
}

async function writeActive(id: string | null): Promise<void> {
	const dir = join(DSH_HOME, 'status-widget')
	await mkdir(dir, { recursive: true })
	const temp = `${ACTIVE_FILE}.${process.pid}.tmp`
	await writeFile(temp, `${JSON.stringify({ active: id }, null, 2)}\n`, 'utf8')
	await rename(temp, ACTIVE_FILE)
}

/** Copy a validated pack's files into its directory. */
async function installPack(pack: { manifest: Record<string, unknown>; files: Record<string, string> }): Promise<string> {
	const id = String(pack.manifest.id)
	await mkdir(CHARACTERS_DIR, { recursive: true })
	// Build beside the target, then swap: a crash mid-write leaves a stale pack
	// or none, never a half-installed one that lists as broken.
	const staging = join(CHARACTERS_DIR, `.staging-${id}-${process.pid}-${Date.now()}`)
	await mkdir(staging, { recursive: true })
	try {
		for (const [path, base64] of Object.entries(pack.files)) {
			const relative = safePath(path) ?? safeAudioPath(path)
			if (relative === null) continue
			const target = join(staging, relative)
			await mkdir(join(target, '..'), { recursive: true })
			await writeFile(target, Buffer.from(base64, 'base64'))
		}
		// Last, so its presence means the pack is complete.
		await writeFile(join(staging, 'pack.json'), `${JSON.stringify(pack.manifest, null, 2)}\n`, 'utf8')
		const final = join(CHARACTERS_DIR, id)
		await rm(final, { recursive: true, force: true })
		await rename(staging, final)
	} catch (error) {
		await rm(staging, { recursive: true, force: true })
		throw error
	}
	return id
}
const MASCOT_ROUTE = '/dsh-status-widget/mascot.png'
/** One drawing per character state, shipped beside the plugin's package root. */
const MASCOT_FILES: Record<string, URL> = {
	sleepy: new URL('../assets/mascot-sleepy.png', import.meta.url),
	wave: new URL('../assets/mascot-wave.png', import.meta.url),
	pat: new URL('../assets/mascot-pat.png', import.meta.url),
	party: new URL('../assets/mascot-party.png', import.meta.url),
	idle: new URL('../assets/mascot-idle.png', import.meta.url),
	happy: new URL('../assets/mascot-happy.png', import.meta.url),
	busy: new URL('../assets/mascot-busy.png', import.meta.url),
	worried: new URL('../assets/mascot-worried.png', import.meta.url),
}
/** The name older pages ask for, and the fallback for an unknown state. */
const MASCOT_DEFAULT = new URL('../assets/mascot.png', import.meta.url)

/**
 * Preferences live in the Harness home rather than the browser, because the web
 * GUI and the desktop client do not share localStorage — the same split that
 * bit the reference widget.
 */
const PREFS_FILE = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'status-widget.json')

const SIZES = ['min', 'small', 'medium', 'max']

/** Keep only the fields the widget understands, with the types it expects. */
function sanitizePrefs(input: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	if (typeof input.size === 'string' && SIZES.includes(input.size)) out.size = input.size
	if (input.mode === 'docked' || input.mode === 'free') out.mode = input.mode
	if (input.side === 'left' || input.side === 'right') out.side = input.side
	if (typeof input.x === 'number' && Number.isFinite(input.x)) out.x = input.x
	if (typeof input.y === 'number' && Number.isFinite(input.y)) out.y = input.y
	if (typeof input.sound === 'boolean') out.sound = input.sound
	if (input.model === 'flash' || input.model === 'pro') out.model = input.model
	if (typeof input.low === 'number' && Number.isFinite(input.low) && input.low >= 0) out.low = input.low
	if (typeof input.roam === 'boolean') out.roam = input.roam
	if (input.lang === 'en' || input.lang === 'zh') out.lang = input.lang
	if (typeof input.bottom === 'number' && Number.isFinite(input.bottom)) out.bottom = input.bottom
	return out
}

/** Serialises preference writes: read-modify-write is not safe concurrently. */
let prefsQueue: Promise<unknown> = Promise.resolve()

function serializePrefs(task: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
	const run = prefsQueue.then(task, task)
	prefsQueue = run.catch(() => undefined)
	return run
}

async function readPrefs(): Promise<Record<string, unknown>> {
	try {
		return sanitizePrefs(JSON.parse(await readFile(PREFS_FILE, 'utf8')))
	} catch {
		return {}
	}
}

/** The content type for a pack file, by extension. */
function typeFor(file: string): string {
	if (file.endsWith('.webp')) return 'image/webp'
	if (file.endsWith('.gif')) return 'image/gif'
	if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg'
	if (file.endsWith('.wav')) return 'audio/wav'
	if (file.endsWith('.ogg')) return 'audio/ogg'
	if (file.endsWith('.mp3')) return 'audio/mpeg'
	return 'image/png'
}

/** Send a file with ETag revalidation; 404 when it is not there. */
async function sendFile(
	req: { headers?: Record<string, string | string[] | undefined> },
	res: { writeHead(status: number, headers: Record<string, string>): void; end(body?: string | Uint8Array): void },
	file: string | URL,
	type: string,
): Promise<void> {
	try {
		const bytes = await readFile(file)
		const etag = `W/"${createHash('sha1').update(bytes).digest('hex').slice(0, 16)}"`
		if (req.headers?.['if-none-match'] === etag) {
			res.writeHead(304, { etag, 'cache-control': 'no-cache' })
			res.end()
			return
		}
		res.writeHead(200, { 'content-type': type, 'content-length': String(bytes.byteLength), etag, 'cache-control': 'no-cache' })
		res.end(bytes)
	} catch {
		res.writeHead(404, { 'content-type': 'text/plain' })
		res.end('not found')
	}
}

/**
 * The active pack: its installed id and its validated manifest.
 *
 * The manifest is validated on the way out as well as on the way in, because a
 * pack.json can be edited by hand or restored from an older build — and these
 * routes turn its paths into file reads.
 */
async function activePack(): Promise<{ id: string; manifest: Record<string, any> } | null> {
	const id = await readActive()
	if (id === null || !/^[a-z0-9-]+$/.test(id)) return null
	try {
		const manifest = JSON.parse(await readFile(join(CHARACTERS_DIR, id, 'pack.json'), 'utf8'))
		const check = validateManifest(manifest)
		if (!check.ok) return null
		return { id, manifest }
	} catch {
		return null
	}
}

/**
 * Join a pack-relative path onto an installed pack, refusing anything that
 * escapes it. Defence in depth: every path should already have passed safePath.
 */
function safeJoin(id: string, relative: string): string | null {
	if (!/^[a-z0-9-]+$/.test(id)) return null
	if (safePath(relative) === null && safeAudioPath(relative) === null) return null
	const base = join(CHARACTERS_DIR, id)
	const target = join(base, relative)
	return target.startsWith(base + sep) ? target : null
}

/** The state named in the request, or `idle`. */
function requestedState(url: string | undefined): string {
	try {
		const state = new URL(url ?? '', 'http://dsh.invalid').searchParams.get('state')
		if (state !== null && Object.hasOwn(MASCOT_FILES, state)) return state as string
		// Every state the widget can draw has its own file; anything else is idle.
		return 'idle'
	} catch {
		return 'idle'
	}
}

/** The slice of the host context this plugin actually uses. */
type HostContext = {
	credentials: {
		// `CredentialRef` is a branded string; the store keys on the plain value,
		// so the literal is accepted without importing the branding helper.
		resolve(ref: string): Promise<{ value: string } | undefined>
	}
	webServer: {
		register(route: {
			kind: 'exact'
			path: string
			handler(
				req: unknown,
				res: {
					writeHead(status: number, headers: Record<string, string>): void
					end(body?: string | Uint8Array): void
				},
			): void
		}): () => void
	}
	effect(disposer: () => () => void, label: string): void
}

export function apply(ctx: Context) {
	const host = ctx as unknown as HostContext

	const balance = createBalanceCache({
		read: async () => {
			let hit
			try {
				hit = await host.credentials.resolve(KEY_REF)
			} catch {
				return { ok: false, reason: 'credential-store-error' }
			}
			// A store can answer with an object whose value is missing; a Bearer
			// header of "undefined" would go to the API and look like a bad key.
			if (hit === undefined || typeof hit.value !== 'string' || hit.value.trim() === '') return { ok: false, reason: 'no-key' }
			return fetchBalance({ apiKey: hit.value })
		},
	})

	host.effect(
		() =>
			host.webServer.register({
				kind: 'prefix',
				path: CHARACTERS_ROUTE,
				handler: async (req, res) => {
					if (!trustedRequest(req as never)) {
						res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' })
						res.end(JSON.stringify({ ok: false, errors: ['forbidden'] }))
						return
					}
					const url = new URL((req as { url?: string }).url ?? '', 'http://dsh.invalid')
					const suffix = url.pathname.slice(CHARACTERS_ROUTE.length)
					const method = (req as { method?: string }).method ?? 'GET'
					const json = (status: number, body: unknown) => {
						res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
						res.end(JSON.stringify(body))
					}
					try {
						// list — GET only, or a POST would be swallowed here
						if (method === 'GET' && (suffix === '' || suffix === '/')) {
							const ids = await installedIds()
							const packs = []
							const activeNow = await readActive()
							for (const id of ids) {
								try {
									const manifest = JSON.parse(await readFile(join(CHARACTERS_DIR, id, 'pack.json'), 'utf8'))
									packs.push({
										id,
										name: manifest.name,
										version: manifest.version ?? null,
										poses: Object.keys(manifest.poses ?? {}).length,
										sheets: Object.keys(manifest.sheets ?? {}).length,
										sounds: Object.keys(manifest.sounds ?? {}).length,
										// Only the active pack needs its manifest in the client.
										...(id === activeNow ? { active: true, manifest } : {}),
									})
								} catch {
									packs.push({ id, name: id, broken: true })
								}
							}
							json(200, { ok: true, active: activeNow, packs })
							return
						}

						// import
						if (method === 'POST' && (suffix === '' || suffix === '/')) {
							if (!trustedRequest(req as never, { json: true })) {
								json(415, { ok: false, errors: ['content-type-required'] })
								return
							}
							const body = await readJsonBody(req as never)
							const check = validatePack(body as never, (value: string) => new Uint8Array(Buffer.from(value, 'base64')))
							if (!check.ok) {
								json(422, { ok: false, errors: check.errors, warnings: check.warnings })
								return
							}
							const id = await installPack(body as never)
							json(200, { ok: true, id, warnings: check.warnings })
							return
						}

						// active: clear the pointer so the built-in art is used
						if (method === 'DELETE' && /^\/active$/.test(suffix)) {
							await writeActive(null)
							json(200, { ok: true, active: null })
							return
						}

						// <id>/active
						const activeMatch = /^\/([a-z0-9-]+)\/active$/.exec(suffix)
						if (method === 'POST' && activeMatch !== null) {
							const id = activeMatch[1]
							if (!(await installedIds()).includes(id)) {
								json(404, { ok: false, errors: ['pack-missing'] })
								return
							}
							await writeActive(id)
							json(200, { ok: true, active: id })
							return
						}

						// <id>/export
						const exportMatch = /^\/([a-z0-9-]+)\/export$/.exec(suffix)
						if (method === 'GET' && exportMatch !== null) {
							const id = exportMatch[1]
							if (!(await installedIds()).includes(id)) {
								json(404, { ok: false, errors: ['pack-missing'] })
								return
							}
							const dir = join(CHARACTERS_DIR, id)
							const manifest = JSON.parse(await readFile(join(dir, 'pack.json'), 'utf8'))
							const files: Record<string, string> = {}
							const declared = [...Object.values(manifest.poses ?? {}), ...Object.values(manifest.sheets ?? {}).map((sheet: any) => sheet?.file), ...Object.values(manifest.sounds ?? {})]
							for (const relative of declared) {
								if (typeof relative !== 'string') continue
								// Bound to the pack directory even if pack.json was edited by hand.
								if (safePath(relative) === null && safeAudioPath(relative) === null) continue
								const resolved = join(dir, relative)
								if (!resolved.startsWith(dir + sep)) continue
								files[relative] = (await readFile(resolved)).toString('base64')
							}
							json(200, { schema: 1, manifest, files })
							return
						}

						// delete
						const deleteMatch = /^\/([a-z0-9-]+)$/.exec(suffix)
						if (method === 'DELETE' && deleteMatch !== null) {
							const id = deleteMatch[1]
							if (!(await installedIds()).includes(id)) {
								json(404, { ok: false, errors: ['pack-missing'] })
								return
							}
							await rm(join(CHARACTERS_DIR, id), { recursive: true, force: true })
							if ((await readActive()) === id) await writeActive(null)
							json(200, { ok: true })
							return
						}

						json(404, { ok: false, errors: ['route-unknown'] })
					} catch (error) {
						// A failed import must say why, not hang the settings page.
						const message = String((error as Error).message ?? 'request-failed')
						// Never echo a filesystem message: it leaks $DSH_HOME and the user.
						const known = ['too-large', 'aborted', 'read-failed', 'json-invalid'].includes(message)
						const code = message === 'too-large' ? 413 : message === 'aborted' ? 400 : 400
						json(code, { ok: false, errors: [known ? message : 'import-failed'] })
					}
				},
			}),
		'status-widget: character packs',
	)

	host.effect(
		() =>
			host.webServer.register({
				kind: 'exact',
				path: CHARACTER_ROUTE,
				handler: async (req, res) => {
					const active = await activePack()
					const state = requestedState((req as { url?: string }).url)
					const relative = active === null ? null : posePath(active.manifest as never, state)
					if (active === null || relative === null || safePath(relative) === null) {
						await sendFile(req, res, MASCOT_FILES[state] ?? MASCOT_DEFAULT, 'image/png')
						return
					}
					const file = safeJoin(active.id, relative)
					if (file === null) {
						await sendFile(req, res, MASCOT_FILES[state] ?? MASCOT_DEFAULT, 'image/png')
						return
					}
					await sendFile(req, res, file, typeFor(file))
				},
			}),
		'status-widget: character pose',
	)

	host.effect(
		() =>
			host.webServer.register({
				kind: 'exact',
				path: SHEET_ROUTE,
				handler: async (req, res) => {
					const active = await activePack()
					const state = requestedState((req as { url?: string }).url)
					// A sheet is per state; the idle sheet does not stand in for others.
					const sheet = active?.manifest?.sheets?.[state]
					const file = active === null || typeof sheet?.file !== 'string' ? null : safeJoin(active.id, sheet.file)
					if (file === null) {
						res.writeHead(404, { 'content-type': 'text/plain' })
						res.end('no sheet')
						return
					}
					await sendFile(req, res, file, typeFor(file))
				},
			}),
		'status-widget: character sheet',
	)

	host.effect(
		() =>
			host.webServer.register({
				kind: 'exact',
				path: SOUND_ROUTE,
				handler: async (req, res) => {
					const url = new URL((req as { url?: string }).url ?? '', 'http://dsh.invalid')
					const event = url.searchParams.get('event') ?? ''
					const active = await activePack()
					const declared = active === null || !Object.hasOwn(active.manifest.sounds ?? {}, event) ? undefined : active.manifest.sounds[event]
					const resolved = typeof declared === 'string' && active !== null ? safeJoin(active.id, declared) : null
					if (resolved === null) {
						res.writeHead(404, { 'content-type': 'text/plain' })
						res.end('no sound')
						return
					}
					await sendFile(req, res, resolved, typeFor(resolved))
				},
			}),
		'status-widget: character sound',
	)

	host.effect(
		() =>
			host.webServer.register({
				kind: 'exact',
				path: PREFS_ROUTE,
				handler: async (req, res) => {
					if (!trustedRequest(req as never)) {
						res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' })
						res.end(JSON.stringify({ ok: false, reason: 'forbidden' }))
						return
					}
					let payload: Record<string, unknown>
					try {
						const method = (req as { method?: string }).method ?? 'GET'
						if (method !== 'GET' && method !== 'PUT') {
							res.writeHead(405, { 'content-type': 'application/json', 'cache-control': 'no-store', allow: 'GET, PUT' })
							res.end(JSON.stringify({ ok: false, reason: 'method-not-allowed' }))
							return
						}
						if (method === 'PUT') {
							const query = new URL((req as { url?: string }).url ?? '', 'http://dsh.invalid').searchParams
							const patch: Record<string, unknown> = {}
							if (query.has('size')) patch.size = query.get('size')
							if (query.has('mode')) patch.mode = query.get('mode')
							if (query.has('side')) patch.side = query.get('side')
							if (query.has('x')) patch.x = Number(query.get('x'))
							if (query.has('y')) patch.y = Number(query.get('y'))
							if (query.has('sound')) patch.sound = query.get('sound') === 'true'
							if (query.has('model')) patch.model = query.get('model')
							if (query.has('low')) patch.low = Number(query.get('low'))
							if (query.has('roam')) patch.roam = query.get('roam') === 'true'
							if (query.has('lang')) patch.lang = query.get('lang')
							if (query.has('bottom')) patch.bottom = Number(query.get('bottom'))
							const merged = await serializePrefs(async () => {
								const next = { ...(await readPrefs()), ...sanitizePrefs(patch) }
								await mkdir(join(DSH_HOME, 'status-widget'), { recursive: true })
								const temp = `${PREFS_FILE}.${process.pid}.tmp`
								await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
								await rename(temp, PREFS_FILE)
								return next
							})
							payload = { ok: true, prefs: merged, writable: true }
						} else {
							payload = { ok: true, prefs: await readPrefs(), writable: true }
						}
					} catch (error) {
						payload = { ok: false, reason: 'prefs-unavailable', prefs: {} }
					}
					const status = payload.ok === false ? 500 : 200
					res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
					res.end(JSON.stringify({ ...payload, at: Date.now() }))
				},
			}),
		'status-widget: prefs route',
	)

	// The art is a binary file, so it needs a route: a client bundle cannot
	// require a relative asset, and inlining ~100 KB of PNG as base64 would put
	// it in every plugin's combo script.
	host.effect(
		() =>
			host.webServer.register({
				kind: 'exact',
				path: MASCOT_ROUTE,
				handler: async (req, res) => {
					try {
						// Revalidate instead of trusting a long max-age: a pinned image
						// survived redraws for every tab that had already loaded it. An
						// ETag costs one 304 per load and makes a new drawing appear on
						// the next refresh.
						const file = MASCOT_FILES[requestedState((req as { url?: string }).url)] ?? MASCOT_DEFAULT
						const bytes = await readFile(file)
						const etag = `W/"${createHash('sha1').update(bytes).digest('hex').slice(0, 16)}"`
						const headers = (req as { headers?: Record<string, string | string[] | undefined> } | undefined)?.headers ?? {}
						if (headers['if-none-match'] === etag) {
							res.writeHead(304, { etag, 'cache-control': 'no-cache' })
							res.end()
							return
						}
						res.writeHead(200, {
							'content-type': 'image/png',
							'content-length': String(bytes.byteLength),
							etag,
							'cache-control': 'no-cache',
						})
						res.end(bytes)
					} catch {
						res.writeHead(404, { 'content-type': 'text/plain' })
						res.end('mascot unavailable')
					}
				},
			}),
		'status-widget: mascot route',
	)

	host.effect(
		() =>
			host.webServer.register({
				kind: 'exact',
				path: ROUTE,
				handler: async (req, res) => {
					// A throwing handler would leave the socket open and the widget
					// polling a dead route, so every outcome answers.
					let payload
					try {
						payload = { ...(await balance()), at: Date.now() }
					} catch {
						payload = { ok: false, reason: 'internal', at: Date.now() }
					}
					const body = JSON.stringify(payload)
					// Revalidating costs one 304 on an idle poll — but only when the
					// payload is genuinely identical, not merely the same length.
					const etag = `W/"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`
					const sent = (req as { headers?: Record<string, string | string[] | undefined> }).headers?.['if-none-match']
					if (sent === etag) {
						res.writeHead(304, { etag, 'cache-control': 'no-store' })
						res.end()
						return
					}
					res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', etag })
					res.end(body)
				},
			}),
		'status-widget: balance route',
	)
}
