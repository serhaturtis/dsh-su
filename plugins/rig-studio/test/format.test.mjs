import assert from 'node:assert/strict'
import { test, report } from './harness.mjs'
import { ERRORS, compareSlots, sortSlots, validateAttachment, validateCharacter, validateRig } from '../src/rig/format.js'
import { humanoidRig, hair } from './fixtures.mjs'

const clone = (value) => structuredClone(value)

console.log('\nvalidation')

test('the fixture rig is valid', () => {
	assert.deepEqual(validateRig(humanoidRig()), { ok: true, errors: [], warnings: [] })
})

test('a future schema is refused, not guessed at', () => {
	assert.ok(validateRig(clone(humanoidRig())).ok)
	const next = humanoidRig()
	next.schema = 2
	assert.deepEqual(validateRig(next).errors, [ERRORS.SCHEMA])
})

test('ids are lowercase and bounded', () => {
	for (const id of ['Bad Id', '', '-leading', 'x'.repeat(65)]) {
		const rig = humanoidRig()
		rig.id = id
		assert.ok(validateRig(rig).errors.includes(ERRORS.ID), JSON.stringify(id))
	}
})

test('a duplicate bone name is refused', () => {
	const rig = humanoidRig()
	rig.skeleton.bones.push({ name: 'hip', parent: 'root' })
	assert.ok(validateRig(rig).errors.includes(ERRORS.BONE_DUPLICATE))
})

test('a bone parent must exist', () => {
	const rig = humanoidRig()
	rig.skeleton.bones[1].parent = 'ghost'
	assert.ok(validateRig(rig).errors.includes(ERRORS.BONE_PARENT))
})

test('a cycle in the skeleton is refused', () => {
	const rig = humanoidRig()
	// hip → spine, and spine → hip: following parents never terminates.
	rig.skeleton.bones.find((bone) => bone.name === 'spine').parent = 'chest'
	rig.skeleton.bones.find((bone) => bone.name === 'chest').parent = 'spine'
	assert.ok(validateRig(rig).errors.includes(ERRORS.BONE_CYCLE))
})

test('a slot must name a real bone', () => {
	const rig = humanoidRig()
	rig.slots[0].bone = 'ghost'
	assert.ok(validateRig(rig).errors.includes(ERRORS.SLOT_BONE))
})

test('a clip may not target a bone that does not exist', () => {
	const rig = humanoidRig()
	rig.animations.idle.tracks[0].bone = 'ghost'
	assert.ok(validateRig(rig).errors.some((code) => code.startsWith(ERRORS.TRACK_BONE)))
})

test('an unknown track property is refused', () => {
	const rig = humanoidRig()
	rig.animations.idle.tracks[0].property = 'opacity'
	assert.ok(validateRig(rig).errors.includes(`${ERRORS.TRACK_PROPERTY}:opacity`))
})

test('out-of-order keys are refused rather than sorted', () => {
	const rig = humanoidRig()
	rig.animations.idle.tracks[0].keys = [{ t: 500, v: 0 }, { t: 100, v: 1 }]
	assert.ok(validateRig(rig).errors.includes(ERRORS.TRACK_KEYS))
})

test('a clip duration must be positive and bounded', () => {
	for (const duration of [0, -10, 120_000]) {
		const rig = humanoidRig()
		rig.animations.idle.duration = duration
		assert.ok(validateRig(rig).errors.includes(ERRORS.DURATION), String(duration))
	}
})

console.log('\nattachments')

test('an attachment must declare a known kind', () => {
	const broken = hair()
	broken.kind = 'hat'
	assert.ok(validateAttachment(broken).errors.includes(ERRORS.ATTACHMENT_KIND))
})

test('an attachment must say what it attaches to', () => {
	const broken = hair()
	delete broken.attach
	assert.ok(validateAttachment(broken).errors.includes(ERRORS.ATTACHMENT_ATTACH))
})

test('every variant needs art or a tint', () => {
	const broken = hair()
	broken.variants.default.hair = {}
	assert.ok(validateAttachment(broken).errors.includes(ERRORS.ART))
})

test('a clean attachment passes', () => {
	assert.deepEqual(validateAttachment(hair()), { ok: true, errors: [], warnings: [] })
})

console.log('\ncharacters')

const character = (preset) => ({
	id: 'girl-01',
	presets: { default: preset },
})

test('a preset naming a missing attachment is refused', () => {
	const rig = humanoidRig()
	const check = validateCharacter(character({ attachments: [{ attachment: 'ghost' }] }), { rig, attachments: new Map() })
	assert.ok(check.errors.some((code) => code.startsWith(ERRORS.PRESET_ATTACHMENT)))
})

test('a preset may not wear two things in one group', () => {
	const rig = humanoidRig()
	const trouser = hair()
	trouser.id = 'trouser'
	trouser.group = 'hair'
	const attachments = new Map([[hair().id, hair()], [trouser.id, trouser]])
	const check = validateCharacter(character({ attachments: [hair().id, trouser.id] }), { rig, attachments })
	assert.ok(check.errors.some((code) => code.startsWith(ERRORS.PRESET_GROUP)))
})

test('a view must name a preset that exists', () => {
	const rig = humanoidRig()
	const doc = character({ attachments: [] })
	doc.views = { side: { preset: 'winter' } }
	const check = validateCharacter(doc, { rig, attachments: new Map() })
	assert.ok(check.errors.some((code) => code.startsWith(ERRORS.VIEW)))
})

console.log('\ndraw order')

test('slots sort by layer, then z, then name', () => {
	const slots = [
		{ name: 'b', layer: 'over', order: 5 },
		{ name: 'a', layer: 'body', order: 99 },
		{ name: 'c', layer: 'over', order: 5 },
		{ name: 'd', layer: 'back', order: 0 },
	]
	assert.deepEqual(sortSlots(slots).map((slot) => slot.name), ['d', 'a', 'b', 'c'])
})

test('the same set sorts the same way whatever the input order', () => {
	const slots = [
		{ name: 'x', layer: 'over', order: 2 },
		{ name: 'y', layer: 'body', order: 1 },
		{ name: 'z', layer: 'front', order: 3 },
	]
	const forward = sortSlots(slots).map((slot) => slot.name)
	const backward = sortSlots([...slots].reverse()).map((slot) => slot.name)
	assert.deepEqual(forward, backward)
	assert.ok(compareSlots(slots[1], slots[0]) < 0)
})

report()
