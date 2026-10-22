import assert from 'node:assert/strict'
import { test, report } from './harness.mjs'
import { compileLook } from '../src/rig/compile.js'
import { chainEndWorld, segmentLength, solveIKChain, twoBoneAngles } from '../src/rig/ik.js'
import { boneWorldPosition, createPose, solvePose, applySample } from '../src/rig/pose.js'
import { humanoidRig, bodyOnlyPreset } from './fixtures.mjs'

const rig = humanoidRig()
const look = compileLook({ rig, attachments: [], preset: bodyOnlyPreset() })
const bone = (name) => look.byKey.get(name)
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

console.log('\ntwo-bone angles')

test('a target straight down the bone leaves the chain straight', () => {
	// Full extension is the degenerate case: the knee has no side to pick, and
	// the solver clamps a hair short of it so the maths stays finite.
	const angles = twoBoneAngles({ root: [0, 0], target: [0, 100], upperLength: 50, lowerLength: 50 })
	assert.ok(Math.abs(angles.upper) < 0.1, `upper was ${angles.upper}`)
	assert.ok(Math.abs(angles.lower) < 0.1, `lower was ${angles.lower}`)
})

test('a target to the side tilts the chain by the law of cosines', () => {
	// |target| = 80, segments 50/50: beta = acos((50^2+80^2-50^2)/(2*50*80)) = 36.87°
	const angles = twoBoneAngles({ root: [0, 0], target: [80, 0], upperLength: 50, lowerLength: 50 })
	assert.ok(Math.abs(angles.upper + 53.13) < 0.1, `upper was ${angles.upper}`)
})

test('bend flips which side the joint points to', () => {
	const knee = (bend) => {
		const angles = twoBoneAngles({ root: [0, 0], target: [80, 0], upperLength: 50, lowerLength: 50, bend })
		const direction = ((angles.upper + 90) * Math.PI) / 180
		return [50 * Math.cos(direction), 50 * Math.sin(direction)]
	}
	const above = knee(1)
	const below = knee(-1)
	assert.ok(above[1] > 1 && below[1] < -1, `knees at ${above} and ${below}`)
	assert.ok(Math.abs(above[0] - below[0]) < 1e-6, 'both kneel the same distance along the target')
})

test('an unreachable target clamps instead of exploding', () => {
	const angles = twoBoneAngles({ root: [0, 0], target: [0, 1000], upperLength: 50, lowerLength: 50 })
	assert.ok(Number.isFinite(angles.upper) && Number.isFinite(angles.lower))
	assert.ok(Math.abs(angles.upper) < 0.1, 'straight at the clamped reach')
})

console.log('\nchain solving')

test('the segment length is the distance to the next bone', () => {
	assert.equal(segmentLength(look, bone('thigh_l').id), 90)
	assert.equal(segmentLength(look, bone('shin_l').id), 80)
})

test('IK keeps the foot on its target when the hips drop', () => {
	const rest = createPose(look)
	const target = boneWorldPosition(solvePose(look, rest), bone('foot_l').id)

	// Drop the hips 30 px, then ask the chain to reach the foot's OLD position —
	// the whole point of foot planting.
	const dropped = applySample(rest, { [bone('hip').id]: { y: rest[bone('hip').id].y + 30 } })
	const chain = { upperId: bone('thigh_l').id, lowerId: bone('shin_l').id, targetId: bone('foot_l').id, targetWorld: target, bend: -1 }
	const ik = solveIKChain(look, dropped, chain)
	const end = chainEndWorld(look, ik, chain)
	assert.ok(distance(end, target) < 2, `foot ended ${distance(end, target).toFixed(2)}px from its target`)
})

test('the knee bends the way it was told', () => {
	const rest = createPose(look)
	const target = boneWorldPosition(solvePose(look, rest), bone('foot_l').id)
	const dropped = applySample(rest, { [bone('hip').id]: { y: rest[bone('hip').id].y + 30 } })
	const chain = { upperId: bone('thigh_l').id, lowerId: bone('shin_l').id, targetId: bone('foot_l').id, targetWorld: target }
	// One direction is anatomically valid here (shin rotates positive); the other
	// hyperextends and is clamped by the limit. Either way the knee moves.
	const forward = solveIKChain(look, dropped, { ...chain, bend: -1 })
	const backward = solveIKChain(look, dropped, { ...chain, bend: 1 })
	const a = boneWorldPosition(solvePose(look, forward), bone('shin_l').id)
	const b = boneWorldPosition(solvePose(look, backward), bone('shin_l').id)
	assert.ok(distance(a, b) > 5, 'the two bend directions put the knee in different places')
	assert.ok(forward[bone('shin_l').id].rotation > 0, 'the valid direction bends the knee forward')
	assert.ok(backward[bone('shin_l').id].rotation >= -5, 'the invalid direction is clamped to the limit')
})

test('an impossible target leaves the leg straight, not broken', () => {
	const chain = { upperId: bone('thigh_l').id, lowerId: bone('shin_l').id, targetId: bone('foot_l').id, targetWorld: [2000, 2000] }
	const ik = solveIKChain(look, createPose(look), chain)
	const knee = boneWorldPosition(solvePose(look, ik), bone('shin_l').id)
	const hip = boneWorldPosition(solvePose(look, ik), bone('thigh_l').id)
	assert.ok(Number.isFinite(knee[0]) && Number.isFinite(knee[1]))
	// Straight: the knee is exactly one thigh-length from the hip.
	assert.ok(Math.abs(distance(hip, knee) - 90) < 1e-6, 'the thigh kept its length')
})

test('IK never hyperextends a joint, even when the target asks it to', () => {
	// A thigh limited to ±45° cannot swing to a target 100 px to the side.
	const limited = structuredClone(rig)
	limited.skeleton.bones.find((bone) => bone.name === 'thigh_l').limit = { rotation: [-45, 45] }
	const tightLook = compileLook({ rig: limited, attachments: [], preset: bodyOnlyPreset() })
	const tight = (name) => tightLook.byKey.get(name)
	const target = boneWorldPosition(solvePose(tightLook, createPose(tightLook)), tight('foot_l').id)
	const chain = { upperId: tight('thigh_l').id, lowerId: tight('shin_l').id, targetId: tight('foot_l').id, targetWorld: [target[0] + 200, target[1]], bend: 1 }
	const posed = solveIKChain(tightLook, createPose(tightLook), chain)
	assert.ok(Math.abs(posed[tight('thigh_l').id].rotation) <= 45 + 1e-9, `rotation was ${posed[tight('thigh_l').id].rotation}`)
})

report()
