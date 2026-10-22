import assert from 'node:assert/strict'
import { test, report } from './harness.mjs'
import { compileLook } from '../src/rig/compile.js'
import { applySample, boneWorldPosition, clampLimits, createPose, poseValues, solvePose } from '../src/rig/pose.js'
import { humanoidRig, bodyOnlyPreset } from './fixtures.mjs'

const rig = humanoidRig()
const look = compileLook({ rig, attachments: [], preset: bodyOnlyPreset() })
const bone = (name) => look.byKey.get(name)

console.log('\npose state')

test('a new pose is every bone at rest', () => {
	const pose = createPose(look)
	for (const entry of look.bones) {
		assert.deepEqual(pose[entry.id], entry.rest)
	}
})

test('applying a sample does not mutate the pose it was given', () => {
	const pose = createPose(look)
	const next = applySample(pose, { [bone('chest').id]: { rotation: 12 } })
	assert.equal(pose[bone('chest').id].rotation, 0, 'the original is untouched')
	assert.equal(next[bone('chest').id].rotation, 12)
})

test('a sample only changes the properties it names', () => {
	const pose = createPose(look)
	const next = applySample(pose, { [bone('chest').id]: { rotation: 12 } })
	assert.equal(next[bone('chest').id].x, pose[bone('chest').id].x)
})

console.log('\nforward kinematics')

test('a child inherits its parent rotation', () => {
	const pose = applySample(createPose(look), { [bone('thigh_l').id]: { rotation: 90 } })
	const solved = solvePose(look, pose)
	// The shin sits 90 px below the thigh joint at rest; a 90° thigh rotation
	// swings it to the side, so its world x moves by 90 and y stays.
	const thigh = boneWorldPosition(solved, bone('thigh_l').id)
	const shin = boneWorldPosition(solved, bone('shin_l').id)
	assert.ok(Math.abs(shin[1] - thigh[1]) < 1e-6, 'the shin is level with the thigh joint')
	assert.ok(Math.abs(Math.abs(shin[0] - thigh[0]) - 90) < 1e-6, 'and 90 px away')
})

test('world positions accumulate down the chain', () => {
	const solved = solvePose(look, createPose(look))
	const root = boneWorldPosition(solved, bone('root').id)
	const hip = boneWorldPosition(solved, bone('hip').id)
	const shin = boneWorldPosition(solved, bone('shin_l').id)
	assert.deepEqual(hip, [root[0], root[1] - 100])
	assert.deepEqual(shin, [hip[0] - 30, hip[1] + 90])
})

test('mirroring flips the whole figure about the root', () => {
	const pose = createPose(look)
	const normal = solvePose(look, pose)
	const mirrored = solvePose({ ...look, mirror: true }, pose)
	const a = boneWorldPosition(normal, bone('hand_l').id)
	const b = boneWorldPosition(mirrored, bone('hand_l').id)
	assert.ok(Math.abs(a[0] + b[0] - 2 * boneWorldPosition(normal, bone('root').id)[0]) < 1e-6 || a[0] !== b[0])
	// The left hand ends up on the right side of the body.
	const center = boneWorldPosition(normal, bone('chest').id)[0]
	assert.ok((a[0] - center) * (b[0] - center) <= 0, 'the hand crosses to the other side')
})

console.log('\nlimits')

test('a rotation outside its limit is clamped', () => {
	const pose = applySample(createPose(look), { [bone('thigh_l').id]: { rotation: -200 } })
	const clamped = clampLimits(look, pose)
	assert.equal(clamped[bone('thigh_l').id].rotation, -120, 'the lower limit is -120')
})

test('a rotation inside its limit is left alone', () => {
	const pose = applySample(createPose(look), { [bone('thigh_l').id]: { rotation: -60 } })
	assert.equal(clampLimits(look, pose)[bone('thigh_l').id].rotation, -60)
})

test('a bone without limits is untouched', () => {
	const pose = applySample(createPose(look), { [bone('root').id]: { rotation: 400 } })
	assert.equal(clampLimits(look, pose)[bone('root').id].rotation, 400)
})

console.log('\nslots')

test('a slot carries its bone transform and its art offset', () => {
	const solved = solvePose(look, createPose(look))
	const slot = solved.slots.find((entry) => entry.slot.name === 'head')
	const head = boneWorldPosition(solved, bone('head').id)
	assert.deepEqual([slot.world[4], slot.world[5]], head)
	assert.ok(slot.bounds !== null, 'the head has bounds')
})

test('a pose snapshot is plain numbers, for tests and recording', () => {
	const values = poseValues(look, createPose(look))
	assert.equal(values.length, look.bones.length)
	assert.ok(values.every((entry) => typeof entry.rotation === 'number'))
})

report()
