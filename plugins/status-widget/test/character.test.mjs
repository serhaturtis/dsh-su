/**
 * The mascot and the placement maths.
 *
 * Both are pure functions pulled out of the component precisely so they can be
 * checked without a DOM: the drawing is a string, and where the widget lands is
 * arithmetic on a viewport. Drag behaviour itself is pointer events and belongs
 * in a browser; this pins the parts that fail silently.
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

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client.js')
const registrations = []
globalThis.window = {
	__ModuleLoader__: { load: (spec) => registrations.push(spec) },
	innerWidth: 1280,
	innerHeight: 800,
	localStorage: { getItem: () => null, setItem: () => {} },
}
await import(`${file}?v=${Math.random()}`)
const exported = registrations[0].factory((request) => {
	if (request === 'react') {
		return { createElement: () => null, useState: (initial) => [initial, () => {}], useEffect: () => {} }
	}
	throw new Error(`required "${request}"`)
})
const character = exported.__character

console.log('\nmascot')

test('there is no vector fallback left to drift from the art', () => {
	// The SVG was a second drawing of the same character and could not stay in
	// step with generated PNG. The built-in mascot is raster only.
	assert.equal(character.mascotSvg, undefined, 'the SVG fallback must be gone')
})

test('every state ships a real PNG at one shared width', () => {
	const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
	const heights = []
	for (const state of character.CHARACTER_STATES) {
		const png = readFileSync(join(assets, `mascot-${state}.png`))
		assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${state} PNG signature`)
		const width = png.readUInt32BE(16)
		heights.push(png.readUInt32BE(20))
		assert.equal(png[25], 6, `${state} must keep an alpha channel, or the corner goes solid`)
		assert.ok(png.byteLength < 400_000, `${state} is ${png.byteLength} bytes`)
		// One canvas width is what centres her; the height is cropped per pose so
		// the bubble sits on that pose's head instead of on empty canvas.
		assert.equal(width, 432, `${state} must share the 432px canvas width`)
	}
	const tallest = Math.max(...heights)
	const shortest = Math.min(...heights)
	assert.ok(tallest / shortest < 2, 'a state should not be wildly taller than another')
	// The default ratio is only used before the image reports its own size.
	assert.equal(exported.__menu.ART_RATIO, 528 / 432)
})

test('the plain fallback name still resolves to the idle drawing', () => {
	const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
	const plain = readFileSync(join(assets, 'mascot.png'))
	const idle = readFileSync(join(assets, 'mascot-idle.png'))
	assert.ok(plain.equals(idle), 'a cached page asking for mascot.png must get the same art')
})

console.log('\nstate selection')

test('a balance error is worried, a healthy off-peak reading is happy', () => {
	const offPeak = { peak: false, holiday: false, weekend: false }
	const peak = { peak: true, holiday: false, weekend: false }
	assert.equal(character.characterState(offPeak, { ok: false, reason: 'no-key' }), 'worried')
	assert.equal(character.characterState(offPeak, { ok: true }), 'happy')
	assert.equal(character.characterState(peak, { ok: true }), 'idle')
	assert.equal(character.characterState(offPeak, null), 'idle')
})

console.log('\nplacement')

const BOX = { width: 180, height: 367 }

test('the box follows the art, so the pat zone does too', () => {
	// A pack's poses are 432x788; the built-in cat is 432x620. One constant
	// cannot describe both, and the hit zone must move with the drawing.
	const cat = character.characterBox({ width: 180, height: 0 }, 528 / 432)
	const pack = character.characterBox({ width: 180, height: 0 }, 788 / 432)
	assert.equal(cat.height, 220)
	assert.equal(pack.height, 328)
	assert.ok(pack.height > cat.height, 'taller art must produce a taller box')
	// The default is only a starting guess before the image reports its size.
	assert.equal(character.characterBox({ width: 180, height: 0 }).height, Math.round(180 * 528 / 432))
})

test('docking is judged by where she lands, not where the pointer is', () => {
	const viewport = { width: 1280, height: 800 }
	// Grabbed by the middle: the pointer is 90px inboard of her left edge. Pushing
	// her flush to the edge puts the pointer at 106 — outside any pointer-based
	// zone, which is exactly why docking used to never fire.
	const flush = character.dropTarget({ pointerX: 106, pointerY: 500, offsetX: 90, offsetY: 100, box: BOX, viewport })
	assert.equal(flush.mode, 'docked')
	assert.equal(flush.side, 'left')

	const away = character.dropTarget({ pointerX: 300, pointerY: 500, offsetX: 90, offsetY: 100, box: BOX, viewport })
	assert.equal(away.mode, 'free', 'she must only dock when she is close to an edge')
})

test('dropping near either edge docks, anywhere else floats', () => {
	const viewport = { width: 1280, height: 800 }
	const anchor = { offsetX: 90, offsetY: 100 }
	const left = character.dropTarget({ pointerX: 20, pointerY: 600, ...anchor, box: BOX, viewport })
	assert.equal(left.mode, 'docked')
	assert.equal(left.side, 'left')

	const right = character.dropTarget({ pointerX: 1270, pointerY: 600, ...anchor, box: BOX, viewport })
	assert.equal(right.mode, 'docked')
	assert.equal(right.side, 'right')

	const middle = character.dropTarget({ pointerX: 640, pointerY: 400, ...anchor, box: BOX, viewport })
	assert.equal(middle.mode, 'free')
	assert.equal(middle.x, 550, 'the drop point keeps the pointer at the same spot on her body')
	assert.equal(middle.y, 300)
})

test('a drop near the edge keeps her feet under the pointer', () => {
	const viewport = { width: 1280, height: 800 }
	const drop = character.dropTarget({ pointerX: 10, pointerY: 450, offsetX: 90, offsetY: 100, box: BOX, viewport })
	assert.equal(drop.mode, 'docked')
	// top = 450 - 100 = 350, which fits; bottom = 800 - 350 - 367.
	assert.equal(drop.bottom, 800 - 350 - BOX.height)
})

test('a drop outside the viewport is clamped, not lost', () => {
	const viewport = { width: 1280, height: 800 }
	const drop = character.dropTarget({ pointerX: 640, pointerY: -100, offsetX: 90, offsetY: 50, box: BOX, viewport })
	assert.equal(drop.mode, 'free')
	assert.equal(drop.y, 16)
})

test('hysteresis keeps her docked until she is clearly away', () => {
	const viewport = { width: 1280, height: 800 }
	const anchor = { offsetX: 90, offsetY: 100 }
	// Her left edge is 60px from the side: outside the 48px zone, inside 48+24.
	const nearEdge = character.dropTarget({ pointerX: 150, pointerY: 400, ...anchor, box: BOX, viewport, dockedNow: true, dockedSide: 'left' })
	assert.equal(nearEdge.mode, 'docked', 'a docked widget must not detach inside the hysteresis band')
	const farAway = character.dropTarget({ pointerX: 400, pointerY: 400, ...anchor, box: BOX, viewport, dockedNow: true, dockedSide: 'left' })
	assert.equal(farAway.mode, 'free', 'past the band she detaches')
})

test('a first run docks bottom-right', () => {
	assert.deepEqual(character.resolvePlacement(null, { width: 1280, height: 800 }, BOX), { mode: 'docked', side: 'right', bottom: 24 })
})

test('a docked placement is honoured and clamped', () => {
	assert.deepEqual(character.resolvePlacement({ mode: 'docked', side: 'left', bottom: 120 }, { width: 1280, height: 800 }, BOX), {
		mode: 'docked',
		side: 'left',
		bottom: 120,
	})
	const repaired = character.resolvePlacement({ mode: 'docked', side: 'left', bottom: 5000 }, { width: 1280, height: 800 }, BOX)
	assert.equal(repaired.bottom, 800 - BOX.height - 16)
})

test('a free placement is honoured and kept inside the viewport', () => {
	assert.deepEqual(character.resolvePlacement({ mode: 'free', x: 300, y: 200 }, { width: 1280, height: 800 }, BOX), {
		mode: 'free',
		x: 300,
		y: 200,
	})
	const repaired = character.resolvePlacement({ mode: 'free', x: 5000, y: -40 }, { width: 1280, height: 800 }, BOX)
	assert.equal(repaired.x, 1280 - BOX.width - 16)
	assert.equal(repaired.y, 16)
})

test('an old side+bottom save still docks where it was', () => {
	const placement = character.resolvePlacement({ side: 'left', bottom: 120 }, { width: 1280, height: 800 }, BOX)
	assert.deepEqual(placement, { mode: 'docked', side: 'left', bottom: 120 })
})

test('an old top-based save is migrated, not reset', () => {
	const placement = character.resolvePlacement({ side: 'left', top: 100 }, { width: 1280, height: 800 }, BOX)
	assert.equal(placement.mode, 'docked')
	assert.equal(placement.side, 'left')
	assert.equal(placement.bottom, 800 - 100 - BOX.height)
})

test('garbage in storage falls back to the default dock', () => {
	for (const stored of [null, 'nope', 42, {}, { side: 'up', bottom: 'x' }, { mode: 'free', x: 'a' }, []]) {
		const placement = character.resolvePlacement(stored, { width: 1280, height: 800 }, BOX)
		assert.equal(placement.mode, 'docked', `mode for ${JSON.stringify(stored)}`)
		assert.equal(placement.side, 'right')
	}
})

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
