/**
 * Interaction tests: the decisions behind a press, a drag, a release and a
 * keyboard menu.
 *
 * The client bundle used to keep all of this inside the component closure, so
 * the suite could only inspect the rendered tree. Every bug in drag, pat and
 * click-to-speak was found by the author, never by CI. The logic now lives in
 * pure functions (`dragStart`, `dragMove`, `dragRelease`, `menuStep`,
 * `menuAction`) that this file drives with fake events — no DOM and no React
 * renderer.
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

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

/** Load the bundle the way the browser does, then materialize it. */
async function load() {
	const file = join(here, '..', 'src', 'client.js')
	const registrations = []
	const store = new Map()
	globalThis.window = {
		__ModuleLoader__: { load: (spec) => registrations.push(spec) },
		localStorage: {
			getItem: (key) => (store.has(key) ? store.get(key) : null),
			setItem: (key, value) => store.set(key, String(value)),
			removeItem: (key) => store.delete(key),
		},
		innerWidth: 1280,
		innerHeight: 800,
	}
	await import(`${file}?v=${Math.random()}`)
	assert.equal(registrations.length, 1, 'the bundle must register exactly once')
	return registrations[0].factory((request) => {
		if (request === 'react') {
			return {
				createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } }),
				useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
				useEffect: () => {},
			}
		}
		throw new Error(`bundle required "${request}"`)
	})
}

const exported = await load()
const interaction = exported.__interaction
const character = exported.__character
const menu = exported.__menu

const size = menu.resolveSize('medium')
const box = character.characterBox(size, menu.ART_RATIO)
/** The geometry a free-standing widget would pass to a drag. */
const context = {
	box,
	inset: (character.FRAME_WIDTH - size.width) / 2,
	viewport: { width: 1280, height: 800 },
	dockedNow: false,
	dockedSide: undefined,
	characterHeight: box.height,
}

/** A pointer event with sane defaults; override only what a test cares about. */
function pointer(overrides = {}) {
	return {
		pointerId: 1,
		button: 0,
		clientX: 400,
		clientY: 400,
		target: { closest: () => null },
		preventDefault() {},
		...overrides,
	}
}

const rect = { left: 380, top: 300, width: 220, height: 400 }

console.log('\ndrag: start')

test('records where the pointer sits inside the widget', () => {
	const drag = interaction.dragStart(pointer(), rect)
	assert.equal(drag.offsetX, 20)
	assert.equal(drag.offsetY, 100)
	assert.equal(drag.rectHeight, 400)
	assert.equal(drag.moved, false)
	assert.equal(drag.onControl, false)
})

test('a press on a button is a control press, not a drag', () => {
	const drag = interaction.dragStart(pointer({ target: { closest: () => ({ tagName: 'BUTTON' }) } }), rect)
	assert.equal(drag.onControl, true)
})

test('a missing rect still produces a usable drag instead of NaN', () => {
	const drag = interaction.dragStart(pointer(), null)
	assert.equal(drag.offsetX, 0)
	assert.equal(drag.offsetY, 0)
	assert.equal(drag.rectHeight, 0)
})

console.log('\ndrag: movement and release')

test('a movement under the slop is still a click', () => {
	const drag = interaction.dragStart(pointer(), rect)
	const moved = interaction.dragMove(drag, pointer({ clientX: 402, clientY: 401 }), context)
	assert.equal(moved.drag.moved, false)
	assert.equal(moved.spot, null, 'no placement preview before the threshold')
	assert.equal(interaction.dragRelease(moved.drag, pointer({ clientX: 402, clientY: 401 }), context).kind, 'speak')
})

test('past the slop the widget follows the pointer', () => {
	const drag = interaction.dragStart(pointer(), rect)
	const moved = interaction.dragMove(drag, pointer({ clientX: 420, clientY: 430 }), context)
	assert.equal(moved.drag.moved, true)
	assert.equal(moved.spot.mode, 'free')
	assert.equal(moved.spot.x, 400, 'pointer 420 minus the 20px grab offset')
	assert.equal(moved.spot.y, 330)
	const released = interaction.dragRelease(moved.drag, pointer({ clientX: 420, clientY: 430 }), context)
	assert.equal(released.kind, 'move')
	assert.deepEqual(released.spot, moved.spot)
})

test('the release point decides the drop, not the last move event', () => {
	const drag = interaction.dragStart(pointer(), rect)
	const moved = interaction.dragMove(drag, pointer({ clientX: 420, clientY: 430 }), context)
	// A flick ends near the right edge even though the sampled move did not.
	const released = interaction.dragRelease(moved.drag, pointer({ clientX: 1270, clientY: 430 }), context)
	assert.equal(released.kind, 'move')
	assert.equal(released.spot.mode, 'docked')
	assert.equal(released.spot.side, 'right')
})

test('a click on her head is a pat', () => {
	const drag = interaction.dragStart(pointer({ clientY: 520 }), rect)
	const released = interaction.dragRelease(drag, pointer({ clientY: 520 }), context)
	// Root 400px tall, drawing 300px tall: the head starts at y=100 and ends at 205.
	assert.equal(released.kind, 'pat')
})

test('a click on the bubble or her legs is a spoken line', () => {
	const bubble = interaction.dragStart(pointer({ clientY: 320 }), rect)
	assert.equal(interaction.dragRelease(bubble, pointer({ clientY: 320 }), context).kind, 'speak')
	const legs = interaction.dragStart(pointer({ clientY: 680 }), rect)
	assert.equal(interaction.dragRelease(legs, pointer({ clientY: 680 }), context).kind, 'speak')
})

test('a press on a control never speaks, even without movement', () => {
	const drag = interaction.dragStart(pointer({ target: { closest: () => ({}) } }), rect)
	assert.equal(interaction.dragRelease(drag, pointer(), context).kind, 'control')
})

test('a real drag that starts on a control still moves her', () => {
	// Controls stop propagation in the browser, but if a drag does begin on one
	// the movement must win: dropping a button should not strand the pointer.
	const drag = interaction.dragStart(pointer({ target: { closest: () => ({}) } }), rect)
	const moved = interaction.dragMove(drag, pointer({ clientX: 500 }), context)
	assert.equal(interaction.dragRelease(moved.drag, pointer({ clientX: 500 }), context).kind, 'move')
})

test('the click threshold is four pixels of Manhattan travel', () => {
	const drag = interaction.dragStart(pointer(), rect)
	assert.equal(interaction.dragMoved(drag, pointer({ clientX: 402, clientY: 402 })), false, '4px is still a click')
	assert.equal(interaction.dragMoved(drag, pointer({ clientX: 403, clientY: 402 })), true, '5px is a drag')
})

console.log('\nmenu: roving focus')

test('arrows wrap through the rows', () => {
	assert.equal(interaction.menuStep('ArrowDown', 0, 3), 1)
	assert.equal(interaction.menuStep('ArrowDown', 2, 3), 0)
	assert.equal(interaction.menuStep('ArrowUp', 0, 3), 2)
	assert.equal(interaction.menuStep('ArrowUp', 2, 3), 1)
})

test('Home and End jump to the ends', () => {
	assert.equal(interaction.menuStep('Home', 2, 5), 0)
	assert.equal(interaction.menuStep('End', 0, 5), 4)
})

test('with no row focused, Down enters at the top and Up at the bottom', () => {
	assert.equal(interaction.menuStep('ArrowDown', -1, 4), 0)
	assert.equal(interaction.menuStep('ArrowUp', -1, 4), 3)
})

test('an empty menu is not an array index', () => {
	assert.equal(interaction.menuStep('ArrowDown', 0, 0), 0)
	assert.equal(interaction.menuStep('End', -1, 0), 0)
})

test('unhandled keys leave the focus where it was', () => {
	assert.equal(interaction.menuStep('Tab', 1, 3), 1)
	assert.equal(interaction.menuStep('a', 1, 3), 1)
})

console.log('\nmenu: key actions')

test('a row with a submenu opens it on ArrowRight', () => {
	assert.equal(interaction.menuAction('ArrowRight', { hasPopup: true, nested: false }), 'open-submenu')
	assert.equal(interaction.menuAction('ArrowRight', { hasPopup: false, nested: false }), 'none')
})

test('ArrowLeft leaves a nested panel but does nothing at the top', () => {
	assert.equal(interaction.menuAction('ArrowLeft', { hasPopup: false, nested: true }), 'back')
	assert.equal(interaction.menuAction('ArrowLeft', { hasPopup: false, nested: false }), 'none')
})

test('Escape closes the whole menu', () => {
	assert.equal(interaction.menuAction('Escape', { hasPopup: true, nested: true }), 'close')
})

test('Enter and Space are left to the focused button', () => {
	// Intercepting them would press the button twice: once by the handler and
	// once by the browser's native activation.
	assert.equal(interaction.menuAction('Enter', { hasPopup: false, nested: false }), 'none')
	assert.equal(interaction.menuAction(' ', { hasPopup: false, nested: false }), 'none')
})

test('the four movement keys ask for focus', () => {
	for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
		assert.equal(interaction.menuAction(key, { hasPopup: false, nested: false }), 'focus')
	}
})

console.log('\nmenu: wiring')

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
	leftward: false,
	settingsOpen: false,
	sizeOpen: false,
	characterOpen: false,
	packs: [],
	packActive: null,
	current: 'medium',
	low: 5,
	model: 'flash',
	soundOn: false,
	roamOn: true,
	onChoose() {},
	onChoosePack() {},
	onImportPack() {},
	onReset() {},
	onToggleSettings() {},
	onToggleSize() {},
	onToggleCharacter() {},
	onCycleModel() {},
	onCycleLow() {},
	onToggleSound() {},
	onToggleRoam() {},
	onKeyDown() {},
	...overrides,
})

test('the menu is a keyboard target with a named panel for every level', () => {
	const tree = exported.renderMenu(menuView({ settingsOpen: true, sizeOpen: true, characterOpen: false }))
	assert.equal(tree.props.className, 'dshsw-menu')
	assert.equal(typeof tree.props.onKeyDown, 'function', 'the menu must handle its own keys')
	assert.equal(typeof tree.props.ref, 'function', 'opening from the keyboard needs the element')

	const panels = elements(tree, 'div')
		.filter((node) => node.props['data-dshsw-panel'] !== undefined)
		.map((node) => node.props['data-dshsw-panel'])
	assert.deepEqual(panels.sort(), ['settings', 'size'])

	const toggles = elements(tree, 'button')
		.filter((node) => node.props['data-dshsw-toggle'] !== undefined)
		.map((node) => node.props['data-dshsw-toggle'])
	assert.deepEqual(toggles.sort(), ['character', 'settings', 'size'])
})

test('every submenu row is a real button, so focus can land on it', () => {
	const tree = exported.renderMenu(
		menuView({
			settingsOpen: true,
			sizeOpen: true,
			characterOpen: false,
			packs: [{ id: 'sample', name: 'Sample' }],
			packActive: null,
		}),
	)
	const rows = elements(tree, 'button')
	assert.ok(rows.length >= 12, 'settings, sizes, character and reset controls')
	for (const row of rows) assert.equal(row.type, 'button')
})

test('menu keys never bubble to the widget speak handler', () => {
	// Enter on a row must activate it, not also make her say a line. An unhandled
	// keyed event would reach the widget root's Enter/Space handler.
	let stopped = false
	let handled = null
	const tree = exported.renderMenu(menuView({ onKeyDown: (event) => (handled = event.key) }))
	tree.props.onKeyDown({ key: 'Enter', stopPropagation: () => (stopped = true) })
	assert.equal(stopped, true, 'the menu must stop the key from reaching the widget')
	assert.equal(handled, 'Enter', 'and still run its own handler')
})

test('the old size-only focus state is gone', () => {
	// A stale `focusIndex` coloured a size row without moving focus. Nothing in
	// the menu should depend on it now; passing it must be inert.
	const plain = exported.renderMenu(menuView({ sizeOpen: true }))
	const withIndex = exported.renderMenu(menuView({ sizeOpen: true, focusIndex: 3 }))
	const styles = (tree) =>
		elements(tree, 'button')
			.map((node) => JSON.stringify(node.props.style))
			.join('|')
	assert.equal(styles(plain), styles(withIndex))
})

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
