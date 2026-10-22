/**
 * One test per lint code. Each starts from the clean fixture and breaks exactly
 * one thing, so a code that stops firing is as visible as one that fires wrongly.
 */
import assert from 'node:assert/strict'
import { test, report } from './harness.mjs'
import { LINT, lintErrors, lintLook } from '../src/rig/lint.js'
import { humanoidRig, hair, skirt, splitTrouser, unsplitTrouser, bodyOnlyPreset } from './fixtures.mjs'

const codes = (issues) => issues.map((entry) => entry.code)
const run = (rig, attachments = [], preset = bodyOnlyPreset(), mirror = false) => lintLook({ rig, attachments, preset, mirror })

console.log('\nbaseline')

test('the fixture rig holds together', () => {
	assert.deepEqual(lintErrors(run(humanoidRig())), [])
})

console.log('\njoints')

test('a part that stops short of the joint is caught', () => {
	const rig = humanoidRig()
	// The thigh now ends above the knee pivot, so the joint has nothing behind it.
	rig.bodyVariants.default.thigh_l.bounds = [-30, -15, 60, 95]
	const issues = run(rig)
	assert.ok(codes(issues).includes(LINT.PART_SHORTER_THAN_SEGMENT), codes(issues).join(','))
})

test('a part that reaches the joint but not far enough past it is caught', () => {
	const rig = humanoidRig()
	rig.bodyVariants.default.thigh_l.bounds = [-30, -15, 60, 105]
	const issues = run(rig)
	assert.ok(codes(issues).includes(LINT.JOINT_UNCOVERED), codes(issues).join(','))
})

test('a joint disc drawn in front of the child cannot cover it', () => {
	const rig = humanoidRig()
	rig.bodyVariants.default.thigh_l.bounds = [-30, -15, 60, 105]
	rig.slots.push({ name: 'cap_knee', bone: 'shin_l', layer: 'front', order: 1, cap: true })
	rig.bodyVariants.default.cap_knee = { image: 'parts/cap.png', bounds: [-20, -20, 40, 40] }
	rig.joints.find((joint) => joint.bone === 'shin_l').disc = 'cap_knee'
	const issues = run(rig)
	assert.ok(codes(issues).includes(LINT.JOINT_DISC_BEHIND_ART), codes(issues).join(','))
})

console.log('\nlimits and bounds')

test('a limb bone without a limit is flagged', () => {
	const rig = humanoidRig()
	delete rig.skeleton.bones.find((bone) => bone.name === 'thigh_l').limit
	assert.ok(codes(run(rig)).includes(LINT.LIMIT_MISSING))
})

test('a joint side without bounds cannot be checked', () => {
	const rig = humanoidRig()
	delete rig.bodyVariants.default.shin_l.bounds
	assert.ok(codes(run(rig)).includes(LINT.BOUNDS_MISSING))
})

console.log('\nattachments')

test('a garment must actually enclose what it claims to hide', () => {
	const small = skirt()
	small.variants.default.cloth.bounds = [-20, -20, 40, 40]
	const issues = run(humanoidRig(), [small], { attachments: ['skirt'] })
	assert.ok(codes(issues).includes(LINT.ATTACHMENT_DOES_NOT_OCCLUDE), codes(issues).join(','))
})

test('a garment spanning a joint as one piece is flagged', () => {
	const issues = run(humanoidRig(), [unsplitTrouser()], { attachments: ['trouser_l'] })
	assert.ok(codes(issues).includes(LINT.GARMENT_JOINT_UNSPLIT), codes(issues).join(','))
})

test('a garment that stops above the joint is fine', () => {
	const issues = run(humanoidRig(), [splitTrouser()], { attachments: ['trouser_l_upper'] })
	assert.ok(!codes(issues).includes(LINT.GARMENT_JOINT_UNSPLIT), codes(issues).join(','))
})

console.log('\nordering and presets')

test('two overlapping slots at the same order are ambiguous', () => {
	const rig = humanoidRig()
	rig.slots.push({ name: 'chest_decal', bone: 'chest', layer: 'body', order: 31 })
	rig.bodyVariants.default.chest_decal = { image: 'parts/decal.png', bounds: [-30, -20, 60, 40] }
	assert.ok(codes(run(rig)).includes(LINT.SLOT_ORDER_COLLISION))
})

test('two attachments in one group are refused before lint', () => {
	const trouser = splitTrouser()
	trouser.group = 'bottom'
	const issues = run(humanoidRig(), [skirt(), trouser], { attachments: ['skirt', 'trouser_l_upper'] })
	assert.ok(codes(issues).includes('group-conflict'), codes(issues).join(','))
})

test('a child attachment selected without its parent is refused', () => {
	const bow = splitTrouser()
	bow.id = 'bow'
	bow.attach = 'hair'
	bow.group = 'headwear'
	const issues = run(humanoidRig(), [hair(), bow], { attachments: ['bow'] })
	assert.ok(codes(issues).includes('preset-attachment-missing'), codes(issues).join(','))
})

console.log('\nmirroring')

test('mirroring asymmetric art is called out', () => {
	const asymmetric = hair()
	asymmetric.asymmetric = true
	const issues = run(humanoidRig(), [asymmetric], { attachments: ['hair'] }, true)
	assert.ok(codes(issues).includes(LINT.MIRROR_UNSAFE))
	assert.ok(!codes(run(humanoidRig(), [asymmetric], { attachments: ['hair'] }, false)).includes(LINT.MIRROR_UNSAFE))
})

console.log('\nclips and canvas')

test('a looping clip that does not return to its start is flagged', () => {
	const rig = humanoidRig()
	rig.animations.idle.tracks[0].keys = [{ t: 0, v: 0 }, { t: 1000, v: 6 }]
	assert.ok(codes(run(rig)).includes(LINT.LOOP_SEAM))
})

test('artwork outside the canvas is reported', () => {
	const rig = humanoidRig()
	rig.bodyVariants.default.head.bounds = [-300, -300, 600, 600]
	assert.ok(codes(run(rig)).includes(LINT.CANVAS_OVERFLOW))
})

report()
