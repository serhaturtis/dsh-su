/**
 * The bundle handshake, the slot it registers into, the rendered tree, and the
 * balance line — driven the way the browser drives it, without a Harness.
 */
import { readFileSync } from 'node:fs'
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

/** Enough React for a tree: no scheduling, no effects, no state updates. */
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

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client.js')
const registrations = []
const store = new Map()
globalThis.window = {
	__ModuleLoader__: { load: (spec) => registrations.push(spec) },
	localStorage: {
		getItem: (key) => (store.has(key) ? store.get(key) : null),
		setItem: (key, value) => store.set(key, value),
	},
}
await import(`${file}?v=${Math.random()}`)

assert.equal(registrations.length, 1, 'bundle must register exactly once')
const spec = registrations[0]
const exported = spec.factory((request) => {
	if (request === 'react') return createReactStub()
	throw new Error(`bundle required "${request}", which is not a platform seed module`)
})
const schedule = exported.__schedule
const balance = exported.__balance
const at = (iso) => Date.parse(iso)

console.log('\nbundle handshake')

test('registers under the package name', () => {
	assert.equal(spec.id, 'dsh-status-widget')
})

test('exports apply and inject', () => {
	assert.equal(typeof exported.apply, 'function')
	assert.deepEqual(exported.inject, ['slots'])
})

test('registers into the shell overlay, not the composer', () => {
	const calls = []
	exported.apply({
		slots: {
			inject(name, fn) {
				calls.push(['inject', name])
				return fn()
			},
			register(options, component) {
				calls.push(['register', options, component])
			},
		},
	})
	assert.deepEqual(calls[0], ['inject', 'shell.overlay'])
	assert.equal(calls[1][1].name, 'shell.overlay')
	assert.equal(calls[1][1].id, 'status-widget')
	assert.equal(typeof calls[1][2], 'function')
})

console.log('\nrendering')

/** Render with the clock pinned, then read the tree back as text. */
function render(ms) {
	const realNow = Date.now
	Date.now = () => ms
	try {
		return exported.StatusWidget()
	} finally {
		Date.now = realNow
	}
}

/** Flatten a stub element tree into one string, styles included. */
function flatten(node) {
	if (node === null || node === undefined) return ''
	if (typeof node === 'string') return node
	if (Array.isArray(node)) return node.map(flatten).join(' ')
	return (
		flatten(node.props?.children) +
		' ' +
		JSON.stringify(node.props?.style ?? '') +
		' ' +
		String(node.props?.title ?? '')
	)
}

test('shows the rate line and the balance placeholder while loading', () => {
	const text = flatten(render(at('2026-10-20T11:21:00Z')))
	assert.match(text, /Off-peak/)
	assert.match(text, /peak in 13h 39m/)
	assert.match(text, /balance …/)
	assert.match(text, /#f5a524/)
})

test('shows the account total with its currency symbol', () => {
	const money = balance.readBalance({
		ok: true,
		available: true,
		at: at('2026-10-20T11:21:00Z'),
		balances: [{ currency: 'CNY', total: '110.00', granted: '10.00', toppedUp: '100.00' }],
	})
	assert.equal(money.text, '¥110.00')
	assert.match(money.title, /110\.00 CNY total/)
	assert.match(money.title, /10\.00 granted/)
	assert.match(money.title, /100\.00 topped up/)
})

test('joins several currencies without converting them', () => {
	assert.equal(
		balance.formatBalances([
			{ currency: 'CNY', total: '8.00' },
			{ currency: 'USD', total: '0.50' },
		]),
		'¥8.00 · $0.50',
	)
	assert.equal(balance.formatBalances([{ currency: 'EUR', total: '3.00' }]), '3.00 EUR')
})

test('names the missing key and the unavailable balance instead of a number', () => {
	assert.equal(balance.readBalance({ ok: false, reason: 'no-key' }).text, 'no API key')
	assert.match(balance.readBalance({ ok: false, reason: 'no-key' }).title, /DEEPSEEK_API_KEY/)
	assert.equal(balance.readBalance({ ok: false, reason: 'http-401' }).text, 'balance ?')
	assert.match(balance.readBalance({ ok: false, reason: 'http-401' }).title, /http-401/)
})

test('the root is a fixed-width frame, so text cannot resize anything', () => {
	const tree = render(at('2026-10-20T11:21:00Z'))
	const style = tree.props.style
	assert.equal(style.width, '220px', 'one frame width in every mode and every size')
	assert.equal(style.right, '32px', 'docked with a margin, not flush to the window edge')
	assert.ok(style.bottom, 'anchored by the bottom')
	assert.equal(style.top, undefined)
})

test('every mode produces its margin explicitly', () => {
	const size = exported.__menu.resolveSize('medium')
	const dockedRight = exported.__character.layoutFor({ mode: 'docked', side: 'right', bottom: 24 }, size)
	assert.equal(dockedRight.root.right, '32px', 'a docked widget keeps a margin from the window edge')
	assert.equal(dockedRight.root.left, undefined, 'no stale left that would win over right')
	// Centring is done by the frame's flex column, never by transforms — the bob
	// animation animates `transform` and would cancel them.
	assert.equal(dockedRight.root.alignItems, 'center', 'the frame centres its children')
	assert.equal(dockedRight.root.flexDirection, 'column')
	assert.equal(dockedRight.character.transform, undefined, 'no transform-based centring')
	assert.equal(dockedRight.character.scale, undefined)
	assert.equal(dockedRight.tail.left, '50%')
	assert.equal(dockedRight.tail.marginLeft, '-5.5px', 'the tail points at her head, always')

	const dockedLeft = exported.__character.layoutFor({ mode: 'docked', side: 'left', bottom: 24 }, size)
	assert.equal(dockedLeft.root.left, '32px')
	assert.equal(dockedLeft.root.right, undefined)
	assert.equal(dockedLeft.character.scale, '-1 1', 'a left-docked widget mirrors her with `scale`, not transform')

	const free = exported.__character.layoutFor({ mode: 'free', x: 300, y: 200 }, size)
	assert.equal(free.root.left, '300px')
	assert.equal(free.root.top, '200px')
	assert.equal(free.root.right, undefined)
	assert.equal(free.root.alignItems, 'center', 'free centres exactly like docked')
	// The whole point of the frame: docking must not change the bubble's shape.
	assert.equal(free.bubble.maxWidth, dockedRight.bubble.maxWidth, 'the bubble cap must not depend on the mode')
	assert.equal(free.character.width, dockedRight.character.width)
	assert.equal(free.tail.left, '50%')
	assert.equal(free.tail.marginLeft, '-5.5px')
})

test('the bubble hangs outside her box and points at her', () => {
	const tree = render(at('2026-10-20T11:21:00Z'))
	const bubble = tree.props.children[0]
	assert.equal(bubble.type, 'div')
	assert.equal(bubble.props.style.marginBottom, '6px', 'it sits directly above her in the column')
	assert.equal(bubble.props.style.maxWidth, '100%')
	assert.equal(bubble.props.style.width, 'max-content')
	assert.equal(bubble.props.style.maxWidth, '100%', 'the bubble wraps at the frame width, which never changes')
	// The tail is centred on her head in every mode.
	const tail = bubble.props.children[bubble.props.children.length - 1]
	assert.equal(tail.props.style.transform, 'rotate(45deg)')
	assert.equal(tail.props.style.left, '50%')
	assert.equal(tail.props.style.marginLeft, '-5.5px')
})

test('the tooltip carries the schedule caveats', () => {
	const tree = flatten(render(at('2026-10-05T02:00:00Z')))
	assert.match(tree, /01:00-04:00 and 06:00-10:00 UTC/)
	assert.match(tree, /Chinese public holidays are not tracked/)
})

console.log('\nbundle hygiene')

test('the bundle defines the component exactly once', () => {
	// A duplicated declaration is valid JavaScript, and the later one silently
	// wins — which is how a stale menu shipped while the new one sat above it.
	const source = readFileSync(file, 'utf8')
	for (const marker of [
		'function StatusWidget(',
		'function renderMenu(',
		'function layoutFor(',
		'function SettingsPanel(',
		'//#region activity',
		'var imageStyle = {',
		'var drag = null',
	]) {
		const count = source.split(marker).length - 1
		assert.equal(count, 1, `${marker} appears ${count} times`)
	}
})

test('with a pack active the artwork comes from the pack, not the mascot', () => {
	// Both branches were dead: `sheet` was computed from a `face` that did not
	// exist yet, and the image src never switched to the pack route, so an
	// installed pack could not render at all.
	const packs = exported.__packs
	packs.setActivePack({ manifest: { poses: { idle: 'poses/idle.png' } } })
	packs.setPacksForTest({ ready: true, active: 'sample', packs: [{ id: 'sample', name: 'Sample', manifest: { poses: { idle: 'poses/idle.png' } } }] })
	try {
		const srcs = []
		;(function walk(node) {
			if (node === null || typeof node !== 'object') return
			if (Array.isArray(node)) return node.forEach(walk)
			if (node.type === 'img') srcs.push(node.props.src)
			walk(node.props?.children)
		})(render(Date.now()))
		assert.equal(srcs.length, 1, 'one image is drawn')
		assert.ok(srcs[0].startsWith('/dsh-status-widget/character.png?state='), srcs[0])
		assert.ok(!srcs[0].includes('mascot.png'), 'the built-in art must not be used while a pack is active')
	} finally {
		packs.setActivePack(null)
		packs.setPacksForTest({ ready: true, active: null, packs: [] })
	}
})

test('an active sheet renders as an animated element, not an img', () => {
	const packs = exported.__packs
	const manifest = { sheets: { idle: { file: 'sheets/idle.webp', frameWidth: 360, frameHeight: 630, frames: 6, fps: 6, layout: 'grid', columns: 3 } } }
	packs.setActivePack({ manifest })
	packs.setPacksForTest({ ready: true, active: 'sample', packs: [{ id: 'sample', name: 'Sample', manifest }] })
	try {
		const tree = render(Date.now())
		const text = flatten(tree)
		assert.ok(text.includes('/character/sheet.png?state=idle'), 'the sheet route must be requested')
		assert.ok(text.includes('dshsw-sheet-3x2-6'), 'the sheet must carry its animation')
	} finally {
		packs.setActivePack(null)
		packs.setPacksForTest({ ready: true, active: null, packs: [] })
	}
})

console.log('\ncharacter packs')

test('a sheet becomes one frame wide with the strip behind it', () => {
	const packs = exported.__packs
	const style = packs.spriteStyle({ url: '/x/strip.png', frameWidth: 200, frameHeight: 300, frames: 6, fps: 8 }, 1)
	assert.equal(style.width, '200px')
	assert.equal(style.height, '300px')
	assert.equal(style.backgroundSize, '600% 100%', 'six frames across')
	assert.equal(style.animation, 'dshsw-sheet-6x1-6f-8 0.75s step-end infinite', 'duration is frames over fps')
})

test('scale multiplies the frame, not the strip', () => {
	const packs = exported.__packs
	const style = packs.spriteStyle({ url: '/x.png', frameWidth: 100, frameHeight: 150, frames: 4, fps: 4 }, 2)
	assert.equal(style.width, '200px')
	assert.equal(style.height, '300px')
	assert.equal(style.backgroundSize, '400% 100%')
})

test('a malformed sheet cannot produce NaN style', () => {
	const packs = exported.__packs
	const style = packs.spriteStyle({ url: '/x.png', frameWidth: 100, frameHeight: 100 }, 1)
	assert.match(style.animation, /^dshsw-sheet-1x1-1f-8 0\.125s step-end infinite$/, 'defaults to one frame at 8fps')
	assert.equal(packs.spriteStyle(null, 1), null)
})

test('a vertical strip writes its positions down the y axis', () => {
	const packs = exported.__packs
	const css = packs.spriteKeyframes('k', { frames: 4, layout: 'vertical', frameWidth: 10, frameHeight: 10 })
	assert.match(css, /^@keyframes k\{/)
	assert.match(css, /0%\{background-position:0% 0%\}/)
	assert.match(css, /50%\{background-position:0% 66\.67%\}/, 'the third of four frames is two thirds down')
})

test('a grid walks rows and columns, not one long axis', () => {
	const packs = exported.__packs
	const grid = packs.sheetGrid({ frames: 6, layout: 'grid', columns: 4 })
	assert.deepEqual(grid, { cols: 4, rows: 2 })
	const style = packs.spriteStyle({ url: '/x.png', frames: 6, layout: 'grid', columns: 4, frameWidth: 100, frameHeight: 100, fps: 6 }, 1)
	assert.equal(style.backgroundSize, '400% 200%', 'four columns, two rows')
	assert.match(style.animation, /dshsw-sheet-4x2-6f-6 1s step-end infinite/)
})

test('a padded last row still holds a valid final position', () => {
	// Five frames in a 2x2 grid: the last cell is empty, so frame 5 must not
	// point outside the sheet.
	const packs = exported.__packs
	const grid = packs.sheetGrid({ frames: 5, layout: 'grid', columns: 2 })
	assert.deepEqual(grid, { cols: 2, rows: 3 })
	const css = packs.spriteKeyframes('k', { frames: 5, layout: 'grid', columns: 2 })
	const positions = [...css.matchAll(/background-position:([0-9.]+)% ([0-9.]+)%/g)].map((match) => `${match[1]},${match[2]}`)
	assert.deepEqual(positions.slice(-1), ['0,100'], 'the last frame sits in the last row')
})

test('a sheet is only used when a pack provides one for the state', () => {
	const packs = exported.__packs
	packs.setActivePack({ manifest: { sheets: { idle: { file: 'sheets/idle.png', frameWidth: 40, frameHeight: 40, frames: 2 } } } })
	try {
		assert.ok(packs.sheetFor('idle') !== null)
		assert.ok(packs.sheetFor('idle').url.includes('/character/sheet.png?state=idle'), 'the sheet gets a route, not a pack path')
		// A sheet is per state. Falling back to the idle sheet here would let an
		// animated idle hide every other pose the pack ships.
		assert.equal(packs.sheetFor('pat'), null, 'a state with no sheet uses its still pose')
	} finally {
		packs.setActivePack(null)
	}
	assert.equal(packs.sheetFor('idle'), null, 'no pack means the built-in art')
})

test('pack sounds are recorded per event and can be removed', () => {
	const packs = exported.__packs
	packs.setPackSound('done', '/sounds/done.wav')
	packs.setPackSound('error', '/sounds/error.mp3')
	assert.deepEqual(packs.packSounds().sort(), ['done', 'error'])
	packs.setPackSound('done', null)
	assert.deepEqual(packs.packSounds(), ['error'])
	packs.setPackSound('error', null)
})

console.log('\nlanguage')

test('English is the default and the fallback', () => {
	const lang = exported.__lang
	lang.applyLang('en')
	assert.equal(lang.t('menu.size'), 'Size')
	assert.equal(lang.t('missing.key'), 'missing.key', 'an unknown key stays visible rather than blank')
})

test('Chinese covers the same keys as English', () => {
	const lang = exported.__lang
	const english = Object.keys(lang.TEXT.en).sort()
	const chinese = Object.keys(lang.TEXT.zh).sort()
	assert.deepEqual(chinese, english, 'a missing translation would silently fall back to English')
	lang.applyLang('zh')
	assert.equal(lang.t('menu.size'), '尺寸')
	lang.applyLang('en')
})

test('a translation can interpolate values', () => {
	const lang = exported.__lang
	lang.applyLang('en')
	assert.equal(lang.t('low', { value: '¥2.50' }), 'Balance is low: ¥2.50')
	lang.applyLang('zh')
	assert.equal(lang.t('low', { value: '¥2.50' }), '余额偏低：¥2.50')
	lang.applyLang('en')
})

console.log('\nwatching')

test('the peak boundary is announced once, on the transition', () => {
	const watch = exported.__watching
	watch.reset()
	assert.equal(watch.peakChangeLine(at('2026-10-13T00:30:00Z')), null, 'the first read only records the state')
	assert.equal(watch.peakChangeLine(at('2026-10-13T01:30:00Z')), 'Peak rates just started. Full price.')
	assert.equal(watch.peakChangeLine(at('2026-10-13T02:30:00Z')), null, 'no repeat while the class is unchanged')
	assert.equal(watch.peakChangeLine(at('2026-10-13T04:30:00Z')), 'Off-peak now — half price until the next peak.')
})

test('low balance warns only under the threshold', () => {
	const watch = exported.__watching
	const payload = { ok: true, balances: [{ currency: 'CNY', total: '3.20' }] }
	assert.match(watch.lowBalanceLine(payload, 5), /3\.20/)
	assert.equal(watch.lowBalanceLine(payload, 1), null)
	assert.equal(watch.lowBalanceLine(payload, 0), null, 'zero disables the warning')
	assert.equal(watch.lowBalanceLine({ ok: false, reason: 'no-key' }, 5), null)
})

test('idle acts need quiet, and cycle', () => {
	const watch = exported.__watching
	watch.reset()
	assert.equal(watch.idleAct(1000, true), null, 'the first read only arms the timer')
	assert.equal(watch.idleAct(5000, true), null, 'not after five seconds')
	assert.equal(watch.idleAct(6000, false), null, 'activity re-arms it')
	const first = watch.idleAct(6000 + 90001, true)
	assert.ok(first.length > 0, 'a long quiet stretch produces an act')
	const second = watch.idleAct(6000 + 180002, true)
	assert.notEqual(second, first, 'acts cycle rather than repeat')
})

console.log('\ncontext pressure')

test('reads the projected figure, and falls back to the last prompt', () => {
	const pressure = exported.__pressure
	const sessionsWith = (value) => ({
		binding: () => ({ session: { projections: { faceOf: () => ({ getSnapshot: () => value }) } } }),
	})
	const projected = pressure.readPressure(sessionsWith({ projectedTokens: 500, pressureTokens: 400, contextWindow: 1000 }), 'a')
	assert.equal(projected.used, 500, 'the next request is the useful number')
	assert.equal(projected.ratio, 0.5)

	const prompt = pressure.readPressure(sessionsWith({ pressureTokens: 250, contextWindow: 1000 }), 'a')
	assert.equal(prompt.used, 250)
})

test('an unknown window yields no ratio rather than a full bar', () => {
	const pressure = exported.__pressure
	const sessionsWith = (value) => ({
		binding: () => ({ session: { projections: { faceOf: () => ({ getSnapshot: () => value }) } } }),
	})
	assert.equal(pressure.readPressure(sessionsWith({ pressureTokens: 100 }), 'a').ratio, null)
	assert.equal(pressure.readPressure(sessionsWith(undefined), 'a'), null)
	assert.equal(pressure.readPressure(undefined, 'a'), null)
})

test('the ratio is clamped, so a bar cannot overfill', () => {
	const pressure = exported.__pressure
	const sessionsWith = (value) => ({
		binding: () => ({ session: { projections: { faceOf: () => ({ getSnapshot: () => value }) } } }),
	})
	assert.equal(pressure.readPressure(sessionsWith({ pressureTokens: 5000, contextWindow: 1000 }), 'a').ratio, 1)
})

console.log('\nper-turn cost')

test('cost is the sum of four buckets at published rates', () => {
	const cost = exported.__cost
	const usage = { cacheReadTokens: 1e6, cacheWriteTokens: 0, uncachedInputTokens: 1e6, outputTokens: 1e6 }
	// flash peak: 0.006 + 0.30 + 1.20
	assert.equal(Number(cost.costOf(usage, true, 'flash').toFixed(4)), 1.506)
})

test('off-peak is exactly half, for both models', () => {
	const cost = exported.__cost
	const usage = { cacheReadTokens: 123456, cacheWriteTokens: 7890, uncachedInputTokens: 4321, outputTokens: 99999 }
	for (const model of cost.MODELS) {
		assert.equal(Number(cost.costOf(usage, false, model).toFixed(10)), Number((cost.costOf(usage, true, model) / 2).toFixed(10)))
	}
})

test('cache writes are billed as ordinary input', () => {
	const cost = exported.__cost
	const writeOnly = cost.costOf({ cacheReadTokens: 0, cacheWriteTokens: 1e6, uncachedInputTokens: 0, outputTokens: 0 }, true, 'flash')
	const inputOnly = cost.costOf({ cacheReadTokens: 0, cacheWriteTokens: 0, uncachedInputTokens: 1e6, outputTokens: 0 }, true, 'flash')
	assert.equal(writeOnly, inputOnly)
})

test('unreadable usage is null, not zero', () => {
	const cost = exported.__cost
	assert.equal(cost.costOf(null, true, 'flash'), null)
	assert.equal(cost.costOf({ cacheReadTokens: -1, cacheWriteTokens: 0, uncachedInputTokens: 0, outputTokens: 0 }, true, 'flash'), null)
	assert.equal(cost.costOf({}, true, 'flash'), null)
})

test('a delta is bucket-wise and never negative', () => {
	const cost = exported.__cost
	const before = { cacheReadTokens: 100, cacheWriteTokens: 10, uncachedInputTokens: 50, outputTokens: 20 }
	const after = { cacheReadTokens: 40, cacheWriteTokens: 25, uncachedInputTokens: 50, outputTokens: 60 }
	assert.deepEqual(cost.usageDelta(before, after), {
		cacheReadTokens: 0,
		cacheWriteTokens: 15,
		uncachedInputTokens: 0,
		outputTokens: 40,
	})
	assert.equal(cost.usageDelta(null, after), null)
})

test('money is formatted to a readable precision', () => {
	const cost = exported.__cost
	assert.equal(cost.formatUsd(0), '$0.0000')
	assert.equal(cost.formatUsd(0.0042), '$0.0042')
	assert.equal(cost.formatUsd(0.4213), '$0.421')
})

test('a finished turn shows its cost in the bubble', () => {
	const cost = exported.__cost
	cost.publishTurnCost(0.0042, { outputTokens: 1000 })
	const tree = render(at('2026-10-20T11:21:00Z'))
	assert.match(flatten(tree), /Last turn \$0\.0042/)
	cost.publishTurnCost(null, null)
})

test('the model choice persists and defaults to flash', () => {
	const cost = exported.__cost
	cost.applyModel('pro')
	assert.equal(cost.readModel(), 'pro')
	cost.applyModel('nonsense')
	assert.equal(cost.readModel(), 'flash')
})

console.log('\napproval waiting')

/** A fake uiSession + sessions pair shaped like the real ones. */
function fakeStatus(rows, mainId) {
	return {
		uiSession: { sessionStatus: { getSnapshot: () => new Map(Object.entries(rows)) } },
		sessions: {
			list: {
				getSnapshot: () => ({
					phase: 'ready',
					ids: Object.keys(rows),
					byId: Object.fromEntries(Object.keys(rows).map((id) => [id, { retainedBy: { mainView: id === mainId ? 1 : 0 } }])),
				}),
			},
		},
	}
}

test('a pending interaction on the session on screen is reported', () => {
	const approvals = exported.__approvals
	const fake = fakeStatus({ a: { running: true, pendingInteraction: { key: 'approve-1' } }, b: { running: false } }, 'a')
	approvals.readPendingFrom(fake.uiSession, fake.sessions)
	assert.deepEqual(approvals.readApproval(), { waiting: true, sessionId: 'a' })
})

test('a pending interaction in a background session still counts', () => {
	const approvals = exported.__approvals
	const fake = fakeStatus({ a: { running: false }, b: { running: true, pendingInteraction: { key: 'q' } } }, 'a')
	approvals.readPendingFrom(fake.uiSession, fake.sessions)
	assert.deepEqual(approvals.readApproval(), { waiting: true, sessionId: 'b' })
})

test('the main session wins when several are waiting', () => {
	const approvals = exported.__approvals
	const fake = fakeStatus(
		{ a: { pendingInteraction: { key: 'x' } }, b: { pendingInteraction: { key: 'y' } } },
		'b',
	)
	approvals.readPendingFrom(fake.uiSession, fake.sessions)
	assert.equal(approvals.readApproval().sessionId, 'b')
})

test('nothing pending clears the state', () => {
	const approvals = exported.__approvals
	const fake = fakeStatus({ a: { running: true }, b: { running: false } }, 'a')
	approvals.readPendingFrom(fake.uiSession, fake.sessions)
	assert.deepEqual(approvals.readApproval(), { waiting: false, sessionId: null })
})

test('an unavailable store is "no main session", not a crash', () => {
	const approvals = exported.__approvals
	assert.equal(approvals.mainSessionId({ list: { getSnapshot: () => { throw new Error('nope') } } }), null)
	assert.doesNotThrow(() =>
		approvals.readPendingFrom({ sessionStatus: { getSnapshot: () => { throw new Error('gone') } } }, undefined),
	)
})

test('waiting shows the busy face and its own line', () => {
	const approvals = exported.__approvals
	approvals.setWaiting(true, 'a')
	const tree = render(at('2026-10-20T11:21:00Z'))
	const text = flatten(tree)
	assert.match(text, /Waiting for your approval/)
	const character = tree.props.children[1]
	assert.equal(character.props['data-state'], 'busy')
	approvals.setWaiting(false, null)
})

test('the dot pulses while waiting', () => {
	const approvals = exported.__approvals
	approvals.setWaiting(true, 'a')
	const tree = render(at('2026-10-20T11:21:00Z'))
	const dots = elements(tree, 'span').filter((node) => node.props['data-waiting'] === 'true')
	assert.equal(dots.length, 1)
	assert.equal(dots[0].props.style.background, '#e5484d')
	approvals.setWaiting(false, null)
})

test('the subscription fires only on a real change', () => {
	const approvals = exported.__approvals
	approvals.setWaiting(false, null)
	let calls = 0
	const off = approvals.subscribeApproval(() => calls++)
	approvals.setWaiting(true, 'a')
	approvals.setWaiting(true, 'a')
	approvals.setWaiting(false, null)
	assert.equal(calls, 2, 'a repeated identical state must not notify')
	off()
})

console.log('\nmenu tree')

/** Collect every element of a given type in a stub tree. */
function elements(tree, type, found = []) {
	if (tree === null || tree === undefined) return found
	if (Array.isArray(tree)) {
		tree.forEach((node) => elements(node, type, found))
		return found
	}
	if (tree.type === type) found.push(tree)
	elements(tree.props?.children, type, found)
	return found
}

const menuView = (overrides = {}) => ({
	at: { x: 10, y: 10 },
	open: false,
	leftward: false,
	settingsOpen: false,
	sizeOpen: false,
	onToggleSize() {},
	characterOpen: false,
	onToggleCharacter() {},
	packs: [],
	packActive: null,
	onChoosePack() {},
	onImportPack() {},
	current: 'medium',
	onChoose() {},
	onToggle() {},
	onReset() {},
	onToggleSettings() {},
	onCycleModel() {},
	onCycleLow() {},
	soundOn: false,
	roamOn: true,
	low: 5,
	model: 'flash',
	onToggleSound() {},
	onToggleRoam() {},
	...overrides,
})

test('collapsed, the menu offers settings and a reset', () => {
	const buttons = elements(exported.renderMenu(menuView()), 'button')
	assert.equal(buttons.length, 2, 'Settings and Reset position')
	assert.equal(buttons[0].props['aria-expanded'], 'false', 'the settings submenu starts closed')
	assert.match(String(buttons[1].props.children), /Reset/)
})

test('the settings submenu carries size, the toggles and the two cycled values', () => {
	const buttons = elements(exported.renderMenu(menuView({ settingsOpen: true })), 'button')
	// Order: Settings, then its five rows, then Reset — size opens separately.
	const sub = buttons.slice(1, 7)
	assert.equal(sub.length, 6, 'Size, Character, Sound, Roaming, Pricing, Low balance')
	assert.equal(sub[0].props['aria-expanded'], 'false')
	assert.match(String(sub[0].props.children), /Medium/, 'the size row shows the current value')
	assert.equal(sub[1].props['aria-expanded'], 'false', 'character submenu starts closed')
	assert.match(String(sub[1].props.children), /Built-in/)
	assert.equal(sub[2].props.role, 'menuitemcheckbox')
	assert.equal(sub[2].props['aria-checked'], 'false', 'sound off')
	assert.equal(sub[3].props['aria-checked'], 'true', 'roaming on')
	assert.match(String(sub[4].props.children), /Flash/)
	assert.match(String(sub[5].props.children), /5/)
	assert.equal(buttons.length, 7 + 1, 'no size rows until the size submenu opens')
})

test('menu actions call through, so the menu and Settings share one state', () => {
	const calls = []
	const tree = exported.renderMenu(
		menuView({
			settingsOpen: true,
			onToggleSound: () => calls.push('sound'),
			onToggleRoam: () => calls.push('roam'),
			onCycleModel: () => calls.push('model'),
			onCycleLow: () => calls.push('low'),
			onToggleSettings: () => calls.push('settings'),
			onToggleSize: () => calls.push('size'),
			onToggleCharacter: () => calls.push('character'),
		}),
	)
	const buttons = elements(tree, 'button')
	buttons[0].props.onClick()
	buttons[1].props.onClick()
	buttons[2].props.onClick()
	buttons[3].props.onClick()
	buttons[4].props.onClick()
	buttons[5].props.onClick()
	buttons[6].props.onClick()
	assert.deepEqual(calls, ['settings', 'size', 'character', 'sound', 'roam', 'model', 'low'])
})

test('opened, the settings submenu lists every size with the current one checked', () => {
	const chosen = []
	const tree = exported.renderMenu(
		menuView({
			settingsOpen: true,
			sizeOpen: true,
			current: 'small',
			onChoose: (id) => chosen.push(id),
		}),
	)
	const items = elements(tree, 'button').filter((node) => node.props.role === 'menuitemradio')
	assert.deepEqual(items.map((node) => node.props['aria-checked']), ['false', 'true', 'false', 'false'])
	items[2].props.onClick()
	assert.deepEqual(chosen, ['medium'], 'clicking an item reports its id')
})

test('no menu panel scrolls, and the size panel overlays its parent', () => {
	// A scroll container turns an absolutely positioned child into scrollable
	// content: the panel widens and grows a scrollbar instead of opening a menu.
	const tree = exported.renderMenu(menuView({ settingsOpen: true, sizeOpen: true }))
	const panel = tree.props.children[1]
	assert.equal(panel.props.style.overflowY, undefined, 'the panel must not scroll')
	assert.equal(panel.props.style.maxHeight, undefined, 'nor cap its own height')
	// Five rows plus the nested menu, as flat siblings.
	assert.equal(panel.props.children.length, 8, 'six rows plus the two nested menus')
	const sizePanel = panel.props.children[7]
	assert.equal(sizePanel.props.role, 'menu')
	assert.equal(sizePanel.props.style.left, '100%')
	assert.equal(sizePanel.props.style.overflowY, undefined, 'the nested panel must not scroll either')
	assert.ok(Number(sizePanel.props.style.zIndex) > Number(panel.props.style.zIndex), 'and it sits above')
})

test('only one nested submenu can be open', () => {
	const next = exported.nextSubmenu
	// Hovering Character while Size is open must close Size; both panels occupy
	// the same slot beside the menu.
	assert.deepEqual(next({ sizeOpen: true, characterOpen: false }, 'character'), { sizeOpen: false, characterOpen: true })
	assert.deepEqual(next({ sizeOpen: false, characterOpen: true }, 'size'), { sizeOpen: true, characterOpen: false })
	// Hovering the open one again closes it.
	assert.deepEqual(next({ sizeOpen: true, characterOpen: false }, 'size'), { sizeOpen: false, characterOpen: false })
	assert.deepEqual(next({ sizeOpen: false, characterOpen: false }, 'character'), { sizeOpen: false, characterOpen: true })
})

test('the character submenu lists installed packs and an import row', () => {
	const tree = exported.renderMenu(
		menuView({
			settingsOpen: true,
			characterOpen: true,
			packs: [
				{ id: 'sample', name: 'Sample Character' },
				{ id: 'plain', name: 'Plain' },
			],
			packActive: 'plain',
		}),
	)
	const panel = tree.props.children[1]
	const characterPanel = panel.props.children[6]
	// The pack list is a mapped array; flatten it before counting rows.
	const rows = characterPanel.props.children.flat(4).filter((node) => node !== null && node.type === 'button')
	assert.equal(rows.length, 4, 'Built-in, two packs, Import')
	assert.deepEqual(rows.map((node) => node.props['aria-checked']), ['false', 'false', 'true', undefined])
	assert.match(String(rows[3].props.children), /Import/)
})

test('importing from the menu reports through the handler', () => {
	let imported = 0
	const tree = exported.renderMenu(menuView({ settingsOpen: true, characterOpen: true, onImportPack: () => imported++ }))
	const panel = tree.props.children[1]
	const characterPanel = panel.props.children[6]
	const importRow = characterPanel.props.children.flat(4).filter((node) => node !== null && node.type === 'button').pop()
	importRow.props.onClick()
	assert.equal(imported, 1)
})

test('the submenu flips left when there is no room on the right', () => {
	const right = exported.renderMenu(menuView({ settingsOpen: true, leftward: false }))
	const left = exported.renderMenu(menuView({ settingsOpen: true, leftward: true }))
	const panelOf = (tree) => elements(tree, 'div').find((node) => node.props.role === 'menu' && node.props.style?.position === 'absolute')
	assert.equal(panelOf(right).props.style.left, '100%')
	assert.equal(panelOf(left).props.style.right, '100%')
})

console.log('\ndialogue')

test('each state has a script and the lines cycle', () => {
	const dialogue = exported.__dialogue
	for (const state of ['idle', 'busy', 'happy', 'worried']) {
		assert.ok(Array.isArray(dialogue.LINES[state]) && dialogue.LINES[state].length > 1, `${state} needs lines`)
	}
	const first = dialogue.nextLine('busy')
	const second = dialogue.nextLine('busy')
	assert.notEqual(first, second, 'a second click must not repeat the first sentence')
	const seen = new Set()
	for (let i = 0; i < exported.__dialogue.LINES.busy.length; i++) seen.add(dialogue.nextLine('busy'))
	assert.equal(seen.size, dialogue.LINES.busy.length, 'the cycle must reach every line')
})

test('an unknown state still has something to say', () => {
	assert.ok(exported.__dialogue.nextLine('nonsense').length > 0)
})

test('a pack can replace the script for a state', () => {
	const packs = exported.__packs
	packs.setActivePack({ manifest: { lines: { idle: ['Pack one', 'Pack two'], busy: ['Pack busy'] } } })
	try {
		const seen = new Set()
		for (let i = 0; i < 4; i++) seen.add(exported.__dialogue.nextLine('idle'))
		assert.deepEqual([...seen].sort(), ['Pack one', 'Pack two'], 'the built-in lines must not leak through')
		assert.equal(exported.__dialogue.nextLine('busy'), 'Pack busy')
	} finally {
		packs.setActivePack(null)
	}
})

test('a malformed pack script falls back to the built-in lines', () => {
	const packs = exported.__packs
	packs.setActivePack({ manifest: { lines: { idle: [] } } })
	try {
		const line = exported.__dialogue.nextLine('idle')
		assert.ok(line.length > 0, 'an empty script must not produce silence')
		assert.ok(exported.__dialogue.LINES.idle.includes(line), 'the fallback is the built-in script')
	} finally {
		packs.setActivePack(null)
	}
})

test('the same line never plays twice in a row', () => {
	const next = exported.__dialogue.nextLine
	let previous = next('idle')
	for (let i = 0; i < 12; i++) {
		const line = next('idle')
		assert.notEqual(line, previous, 'consecutive clicks repeated a line')
		previous = line
	}
})

test('sound is off until switched on, and the choice persists', () => {
	const sound = exported.__sound
	assert.equal(sound.readSound(), false, 'off by default')
	sound.applySound(true)
	assert.equal(sound.readSound(), true)
	sound.applySound(false)
	assert.equal(sound.readSound(), false)
})

test('a cue is silent when sound is off and never throws when unsupported', () => {
	const sound = exported.__sound
	sound.applySound(false)
	assert.doesNotThrow(() => sound.cue('done'))
	sound.applySound(true)
	assert.doesNotThrow(() => sound.cue('error'))
	sound.applySound(false)
})

test('the settings panel exists and offers every size', () => {
	assert.equal(typeof exported.SettingsPanel, 'function')
	const tree = exported.SettingsPanel()
	const labels = []
	const walk = (node) => {
		if (node === null || node === undefined) return
		if (typeof node === 'string') return labels.push(node)
		if (Array.isArray(node)) return node.forEach(walk)
		walk(node.props?.children)
	}
	walk(tree)
	for (const size of exported.__menu.SIZES) assert.ok(labels.includes(size.label), `missing ${size.label}`)
})

console.log('\ncharacter settings')

/** Flatten the text nodes of a stub tree. */
function textOf(tree) {
	const out = []
	const walk = (node) => {
		if (node === null || node === undefined) return
		if (typeof node === 'string') return out.push(node)
		if (Array.isArray(node)) return node.forEach(walk)
		walk(node.props?.children)
	}
	walk(tree)
	return out
}

test('the character section offers import, built-in, rescan and an empty state', () => {
	assert.equal(typeof exported.CharacterSettings, 'function')
	const text = textOf(exported.CharacterSettings())
	assert.ok(text.includes('Import .dshchar'), 'import is the primary control')
	assert.ok(text.includes('Use built-in'), 'a pack must be reversible')
	assert.ok(text.includes('Rescan'), 'a directory dropped into $DSH_HOME needs a refresh')
	assert.ok(text.includes('No packs installed.'), 'an empty list says so instead of rendering nothing')
})

test('export points at the host route and names the download', () => {
	const packs = exported.__packs
	assert.equal(packs.packExportHref('sample-cat'), '/dsh-status-widget/characters/sample-cat/export')
	assert.equal(packs.packDownloadName('sample-cat'), 'sample-cat.dshchar')
	assert.equal(packs.packExportHref('a b'), '/dsh-status-widget/characters/a%20b/export', 'ids are path-encoded')
})

console.log('\nsize menu')

test('offers four sizes, medium by default', () => {
	const menu = exported.__menu
	assert.deepEqual(menu.SIZES.map((s) => s.id), ['min', 'small', 'medium', 'max'])
	assert.equal(menu.DEFAULT_SIZE, 'medium')
	assert.equal(menu.resolveSize(null).id, 'medium')
	assert.equal(menu.resolveSize('nonsense').id, 'medium')
	assert.equal(menu.resolveSize('min').width, 84)
	assert.equal(menu.resolveSize('max').width, 260)
})

test('sizes grow, and heights follow the artwork ratio', () => {
	const menu = exported.__menu
	const widths = menu.SIZES.map((s) => s.width)
	assert.deepEqual(widths, [...widths].sort((a, b) => a - b), 'small -> max must be ascending')
	for (const size of menu.SIZES) {
		const height = Math.round(size.width * menu.ART_RATIO)
		assert.ok(height > size.width, `${size.id} should be a tall standing figure`)
	}
})

test('the widget handles right-click instead of the browser menu', () => {
	const tree = render(at('2026-10-20T11:21:00Z'))
	assert.equal(typeof tree.props.onContextMenu, 'function')
})

test('size is applied to the drawing, not just remembered', () => {
	const tree = render(at('2026-10-20T11:21:00Z'))
	const character = tree.props.children[1]
	const width = parseInt(character.props.style.width, 10)
	assert.equal(width, exported.__menu.resolveSize(null).width, 'the default size must reach the img style')
})

console.log('\nactivity')

test('a running turn wins over everything, a finished one celebrates briefly', () => {
	const offPeak = { peak: false }
	const busy = { busy: true, happyUntil: 0 }
	const celebrating = { busy: false, happyUntil: at('2026-10-20T11:21:05Z') }
	const quiet = { busy: false, happyUntil: 0 }
	assert.equal(exported.__character.resolveFace(offPeak, { ok: true }, busy, at('2026-10-20T11:21:00Z')), 'busy')
	assert.equal(exported.__character.resolveFace(offPeak, { ok: true }, celebrating, at('2026-10-20T11:21:02Z')), 'happy')
	assert.equal(exported.__character.resolveFace(offPeak, { ok: true }, quiet, at('2026-10-20T11:21:02Z')), 'happy')
})

test('the celebration window closes', () => {
	const offPeak = { peak: false }
	const celebrating = { busy: false, happyUntil: at('2026-10-20T11:21:05Z') }
	assert.equal(exported.__character.resolveFace(offPeak, null, celebrating, at('2026-10-20T11:21:09Z')), 'idle')
})

test('a pat, a top-up and a greeting each get their own face', () => {
	const now = 1_000_000
	const base = { busy: false, happyUntil: 0, patUntil: 0, partyUntil: 0, waveUntil: 0, lastSeen: now }
	const offPeak = { peak: false }
	assert.equal(exported.__character.resolveFace(offPeak, { ok: true }, { ...base, patUntil: now + 1 }, now), 'pat')
	assert.equal(exported.__character.resolveFace(offPeak, { ok: true }, { ...base, partyUntil: now + 1 }, now), 'party')
	assert.equal(exported.__character.resolveFace(offPeak, { ok: true }, { ...base, waveUntil: now + 1 }, now), 'wave')
	// A running turn still outranks all three.
	assert.equal(exported.__character.resolveFace(offPeak, { ok: true }, { ...base, busy: true, patUntil: now + 1 }, now), 'busy')
})

test('the React copy of the activity carries every window', () => {
	// The component used to copy only busy and happyUntil, so a pat never
	// reached the face logic even though the module state had it.
	const character = exported.__character
	character.setBusy(true)
	character.setBusy(false)
	const snapshot = character.activitySnapshot()
	for (const key of ['busy', 'happyUntil', 'patUntil', 'partyUntil', 'waveUntil', 'lastSeen']) {
		assert.ok(key in snapshot, `${key} must survive the copy`)
	}
})

test('the pat zone is her head, not the top of the bubble', () => {
	const pat = exported.__pat.isPatZone
	// Root is 400px tall, the drawing is the lower 300px (bubble above it).
	const root = 400
	const character = 300
	assert.equal(pat(0, root, character), false, 'the bubble is not a head')
	assert.equal(pat(60, root, character), false, 'still the bubble')
	assert.equal(pat(120, root, character), true, 'just below the bubble is her head')
	assert.equal(pat(300, root, character), false, 'her legs are not a head')
	assert.equal(pat(10, root, 300), false)
})

test('an unset low-balance threshold defaults to 5, not zero', () => {
	// Number(null) is 0, which silently disabled the warning on a fresh profile.
	const prefs = exported.__prefs2
	const store = new Map()
	const previous = globalThis.window.localStorage
	globalThis.window.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) }
	try {
		assert.equal(prefs.readLow(), 5, 'unset means the default')
		prefs.applyLow(0, false)
		assert.equal(prefs.readLow(), 0, 'an explicit off is respected')
		prefs.applyLow(10, false)
		assert.equal(prefs.readLow(), 10)
	} finally {
		globalThis.window.localStorage = previous
	}
})

test('a top-up is detected per currency, and only when it rises', () => {
	const b = exported.__balance
	const before = b.totalsOf({ ok: true, balances: [{ currency: 'CNY', total: '10.00' }, { currency: 'USD', total: '2.00' }] })
	const after = b.totalsOf({ ok: true, balances: [{ currency: 'CNY', total: '12.50' }, { currency: 'USD', total: '2.00' }] })
	assert.equal(b.balanceIncreased(before, after), true)
	assert.equal(b.balanceIncreased(after, before), false, 'spending is not a top-up')
	// A currency appearing is not a top-up; only a rise in a known one is.
	assert.equal(b.balanceIncreased(b.totalsOf({ ok: true, balances: [{ currency: 'CNY', total: '10' }] }), b.totalsOf({ ok: true, balances: [{ currency: 'CNY', total: '10' }, { currency: 'USD', total: '50' }] })), false)
	assert.equal(b.balanceIncreased(before, before), false, 'an unchanged balance is not a top-up')
	assert.equal(b.balanceIncreased(b.totalsOf({ ok: true, balances: [{ currency: 'CNY', total: '10' }] }), b.totalsOf({ ok: true, balances: [{ currency: 'CNY', total: '10.005' }] })), false, 'rounding noise is not money')
	assert.equal(b.balanceIncreased(b.totalsOf({ ok: true, balances: [{ currency: 'CNY', total: '10' }] }), b.totalsOf({ ok: true, balances: [{ currency: 'CNY', total: '10.02' }] })), true)
	// A currency swap must not read as money appearing.
	assert.equal(b.balanceIncreased(b.totalsOf({ ok: true, balances: [{ currency: 'USD', total: '99' }] }), after), false)
	assert.equal(b.balanceIncreased(null, after), false, 'the first read has nothing to compare')
})

test('the sheet contract is per state at both layers', () => {
	// The widget refuses to substitute the idle sheet for another state; the
	// host must not either, or the two disagree about what ?state=busy serves.
	const packs = exported.__packs
	packs.setActivePack({ manifest: { sheets: { idle: { file: 'sheets/idle.webp', frameWidth: 10, frameHeight: 10, frames: 2 } } } })
	try {
		assert.equal(packs.sheetFor('busy'), null, 'no sheet means the still pose is used')
	} finally {
		packs.setActivePack(null)
	}
})

test('she dozes off after ten quiet minutes, but not before', () => {
	const now = 1_000_000
	const asleep = { busy: false, happyUntil: 0, patUntil: 0, partyUntil: 0, waveUntil: 0, lastSeen: now - 11 * 60 * 1000 }
	const awake = { ...asleep, lastSeen: now - 9 * 60 * 1000 }
	assert.equal(exported.__character.resolveFace({ peak: false }, { ok: true }, asleep, now), 'sleepy')
	assert.equal(exported.__character.resolveFace({ peak: false }, { ok: true }, awake, now), 'happy', 'off-peak with nothing running is still the happy face')
	// A failed read is worried, not asleep, even after a long silence.
	assert.equal(exported.__character.resolveFace({ peak: false }, { ok: false }, asleep, now), 'worried')
})

test('the built-in drawing is the only thing the CSS animation targets', () => {
	// A stylesheet rule on the shared class fought a pack's sprite animation.
	const packs = exported.__packs
	const sheet = { file: 'sheets/idle.webp', frameWidth: 360, frameHeight: 657, frames: 6, fps: 6, layout: 'grid', columns: 3 }
	// One sheet per state, so the current face cannot fall back to the still image.
	const manifest = { sheets: { idle: sheet, happy: sheet, busy: sheet, worried: sheet, sleepy: sheet, wave: sheet, pat: sheet, party: sheet } }
	packs.setActivePack({ manifest })
	packs.setPacksForTest({ ready: true, active: 'sample', packs: [{ id: 'sample', name: 'Sample', manifest }] })
	try {
		const tree = render(Date.now())
		const bodies = []
		;(function walk(node) {
			if (node === null || typeof node !== 'object') return
			if (Array.isArray(node)) return node.forEach(walk)
			if (typeof node.props?.className === 'string' && node.props.className.includes('dshsw-body')) bodies.push(node.props.className)
			walk(node.props?.children)
		})(tree)
		assert.ok(bodies.length === 1, 'one body element')
		assert.ok(!bodies[0].includes('dshsw-still'), 'a sheet must not inherit the built-in animation')
	} finally {
		packs.setActivePack(null)
		packs.setPacksForTest({ ready: true, active: null, packs: [] })
	}
})

test('the character carries its state for the CSS animation', () => {
	const tree = render(at('2026-10-20T11:21:00Z'))
	const character = tree.props.children[1]
	assert.ok(character.props['data-state'], 'the body needs a state attribute to animate')
})

console.log('\nschedule')

test('a public holiday follows the weekday rule — the known limitation', () => {
	assert.equal(schedule.isPeak(at('2026-10-05T02:00:00Z')), true, 'National Day is a Monday and is reported as peak')
	assert.match(schedule.describe(at('2026-10-05T02:00:00Z')).title, /Chinese public holidays are not tracked/)
})

test('peak edges hold', () => {
	assert.equal(schedule.isPeak(at('2026-10-13T00:59:00Z')), false)
	assert.equal(schedule.isPeak(at('2026-10-13T01:00:00Z')), true)
	assert.equal(schedule.isPeak(at('2026-10-13T04:00:00Z')), false)
	assert.equal(schedule.isPeak(at('2026-10-13T06:00:00Z')), true)
	assert.equal(schedule.isPeak(at('2026-10-13T10:00:00Z')), false)
})

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
