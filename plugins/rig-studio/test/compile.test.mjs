import assert from 'node:assert/strict'
import { test, report } from './harness.mjs'
import { CompileError, compileLook, resolveClipName } from '../src/rig/compile.js'
import { humanoidRig, hair, skirt, unsplitTrouser, bodyOnlyPreset } from './fixtures.mjs'

const rig = humanoidRig()

console.log('\nbody only')

test('every rig bone becomes one bone with a stable id', () => {
	const look = compileLook({ rig, attachments: [], preset: bodyOnlyPreset() })
	assert.equal(look.bones.length, rig.skeleton.bones.length)
	look.bones.forEach((bone, index) => assert.equal(bone.id, index))
	assert.equal(look.byKey.get('chest').name, 'chest')
})

test('slots come out in canonical draw order', () => {
	const look = compileLook({ rig, attachments: [], preset: bodyOnlyPreset() })
	const orders = look.slots.map((slot) => slot.order)
	assert.deepEqual(orders, [...orders].sort((a, b) => a - b))
})

test('the body variant may be chosen by the preset', () => {
	const rigWithVariants = structuredClone(rig)
	rigWithVariants.bodyVariants.alternate = structuredClone(rigWithVariants.bodyVariants.default)
	rigWithVariants.bodyVariants.alternate.head = { image: 'parts/head-alt.png', bounds: [-45, -60, 90, 90] }
	const look = compileLook({ rig: rigWithVariants, attachments: [], preset: { bodyVariant: 'alternate', attachments: [] } })
	assert.equal(look.bodyVariant, 'alternate')
	assert.equal(look.slots.find((slot) => slot.name === 'head').art.image, 'parts/head-alt.png')
})

console.log('\nattachments')

test('attachment bones are namespaced and hang off their target', () => {
	const look = compileLook({ rig, attachments: [hair()], preset: { attachments: [{ attachment: 'hair' }] } })
	const swing = look.byKey.get('attach:hair:swing')
	assert.ok(swing !== undefined, 'the bone exists under its namespace')
	assert.equal(look.bones[swing.parentId].name, 'head', 'it attaches to the head bone')
	assert.equal(swing.attachment, 'hair')
})

test('an attachment variant selects its art', () => {
	const look = compileLook({ rig, attachments: [hair()], preset: { attachments: [{ attachment: 'hair', variant: 'red' }] } })
	const slot = look.slots.find((entry) => entry.attachment === 'hair')
	assert.deepEqual(slot.art.tint, [0, 0.4, 1.1])
	assert.deepEqual(look.attachments, [{ id: 'hair', variant: 'red' }])
})

test('two attachments sort identically whatever order they are selected in', () => {
	const forward = compileLook({ rig, attachments: [hair(), skirt()], preset: { attachments: [{ attachment: 'hair' }, { attachment: 'skirt' }] } })
	const backward = compileLook({ rig, attachments: [skirt(), hair()], preset: { attachments: [{ attachment: 'skirt' }, { attachment: 'hair' }] } })
	assert.deepEqual(forward.slots.map((slot) => slot.name), backward.slots.map((slot) => slot.name))
})

test('attachment clips are namespaced and target namespaced bones', () => {
	const look = compileLook({ rig, attachments: [hair()], preset: { attachments: [{ attachment: 'hair' }] } })
	const clip = look.clips.get('hair:sway')
	assert.ok(clip !== undefined)
	const swing = look.byKey.get('attach:hair:swing')
	assert.equal(clip.tracks[0].boneId, swing.id)
})

test('a preset naming a missing attachment is a compile error', () => {
	assert.throws(
		() => compileLook({ rig, attachments: [], preset: { attachments: [{ attachment: 'ghost' }] } }),
		(error) => error instanceof CompileError && error.codes.some((code) => code.startsWith('preset-attachment-missing')),
	)
})

test('two attachments in one group are refused', () => {
	const trouser = unsplitTrouser()
	trouser.group = 'bottom'
	assert.throws(
		() => compileLook({ rig, attachments: [skirt(), trouser], preset: { attachments: [{ attachment: 'skirt' }, { attachment: 'trouser_l' }] } }),
		(error) => error instanceof CompileError && error.codes.some((code) => code.startsWith('group-conflict')),
	)
})

test('a view maps clip names without duplicating the library', () => {
	const look = compileLook({ rig, attachments: [], preset: bodyOnlyPreset(), view: undefined })
	assert.equal(resolveClipName(look, undefined, 'idle'), 'idle')
	const character = { views: { side: { clips: { idle: 'idle_side' } } } }
	const sideLook = { ...look, view: 'side' }
	assert.equal(resolveClipName(sideLook, character, 'idle'), 'idle_side')
	assert.equal(resolveClipName(sideLook, character, 'walk'), 'walk', 'unmapped names pass through')
})

report()
