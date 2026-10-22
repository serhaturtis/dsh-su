import assert from 'node:assert/strict'
import { test, report } from './harness.mjs'
import { compileLook } from '../src/rig/compile.js'
import { createPose, solvePose } from '../src/rig/pose.js'
import { createRecorder, drawLook, tintStyle } from '../src/rig/render.js'
import { humanoidRig, bodyOnlyPreset, hair } from './fixtures.mjs'

const rig = humanoidRig()
const look = compileLook({ rig, attachments: [], preset: bodyOnlyPreset() })
const solved = solvePose(look, createPose(look))
const drawing = (ctx) => ctx.calls.filter((call) => call.type === 'drawImage' || call.type === 'fillRect')

console.log('\ndrawing order')

test('every slot is drawn once, in the solved order', () => {
	const ctx = createRecorder()
	const images = {}
	for (const slot of look.slots) images[slot.art.image] = { url: slot.art.image, width: 10, height: 10 }
	const result = drawLook(ctx, solved, { images })
	assert.equal(result.drawn, look.slots.length)
	assert.equal(result.missing, 0)
	// The recorded order is the slot order: the renderer must not re-sort.
	const names = solved.slots.map((entry) => entry.slot.art.image)
	const drawn = ctx.calls.filter((call) => call.type === 'drawImage').map((call) => call.image)
	assert.deepEqual(drawn, names)
})

test('each slot is drawn with its own world transform', () => {
	const ctx = createRecorder()
	const images = {}
	for (const slot of look.slots) images[slot.art.image] = { url: slot.art.image, width: 10, height: 10 }
	drawLook(ctx, solved, { images })
	const transforms = ctx.calls.filter((call) => call.type === 'drawImage').map((call) => call.transform)
	solved.slots.forEach((entry, index) => assert.deepEqual(transforms[index], entry.world))
})

test('art is offset so its pivot sits on the slot origin', () => {
	const rigWithPivot = structuredClone(rig)
	rigWithPivot.bodyVariants.default.head.pivot = [12, 34]
	const pivotLook = compileLook({ rig: rigWithPivot, attachments: [], preset: bodyOnlyPreset() })
	const pivotSolved = solvePose(pivotLook, createPose(pivotLook))
	const ctx = createRecorder()
	const images = {}
	for (const slot of pivotLook.slots) images[slot.art.image] = { url: slot.art.image, width: 10, height: 10 }
	drawLook(ctx, pivotSolved, { images })
	const headDraw = ctx.calls.find((call) => call.type === 'drawImage' && call.image === 'parts/head.png')
	assert.deepEqual([headDraw.dx, headDraw.dy], [-12, -34])
})

console.log('\nmissing art')

test('unloaded art is skipped and reported, not thrown at', () => {
	const ctx = createRecorder()
	const result = drawLook(ctx, solved, { images: {} })
	assert.equal(result.drawn, 0)
	assert.equal(result.missing, look.slots.length)
	assert.equal(drawing(ctx).length, 0)
})

test('the missing-image callback names what is missing', () => {
	const seen = []
	drawLook(createRecorder(), solved, { images: {}, onMissing: (url) => seen.push(url) })
	assert.ok(seen.includes('parts/head.png'))
	assert.equal(new Set(seen).size, seen.length, 'each missing art is reported once per draw pass')
})

test('a partly loaded rig draws what it has', () => {
	const ctx = createRecorder()
	const result = drawLook(ctx, solved, { images: { 'parts/head.png': { url: 'parts/head.png', width: 10, height: 10 } } })
	assert.equal(result.drawn, 1)
	assert.equal(result.missing, look.slots.length - 1)
})

console.log('\nshapes and tint')

test('a procedural shape draws without an image', () => {
	const shaped = structuredClone(rig)
	shaped.bodyVariants.default.head = { shape: { type: 'rect', width: 40, height: 40, fill: '#f00' }, bounds: [-20, -20, 40, 40] }
	const shapeLook = compileLook({ rig: shaped, attachments: [], preset: bodyOnlyPreset() })
	const ctx = createRecorder()
	const result = drawLook(ctx, solvePose(shapeLook, createPose(shapeLook)))
	assert.equal(result.drawn, 1, 'only the head is a shape')
	assert.equal(result.missing, look.slots.length - 1, 'the rest are unloaded images')
	const rect = ctx.calls.find((call) => call.type === 'fillRect')
	assert.equal(rect.fill, '#f00')
	assert.deepEqual([rect.x, rect.y, rect.w, rect.h], [-20, -20, 40, 40])
})

test('a tint is an overlay clipped to the art', () => {
	const tinted = hair()
	const tintLook = compileLook({
		rig,
		attachments: [tinted],
		preset: { attachments: [{ attachment: 'hair', variant: 'red' }] },
	})
	const ctx = createRecorder()
	const images = {}
	for (const slot of tintLook.slots) images[slot.art.image] = { url: slot.art.image, width: 20, height: 30 }
	drawLook(ctx, solvePose(tintLook, createPose(tintLook)), { images })
	const overlay = ctx.calls.find((call) => call.type === 'fillRect' && call.fill === tintStyle([0, 0.4, 1.1]))
	assert.ok(overlay !== undefined, 'the tint rect is drawn')
	assert.equal(overlay.w, 20, 'sized to the art')
	assert.equal(overlay.h, 30)
})

report()
