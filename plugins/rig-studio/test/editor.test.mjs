import assert from 'node:assert/strict'
import { test, report } from './harness.mjs'
import { compileLook } from '../src/rig/compile.js'
import { createPose, solvePose, boneWorldPosition } from '../src/rig/pose.js'
import { HIT_RADIUS, angleFrom, coverageDisc, hitTest, limitArc, movePivot, rotateBone, scrub } from '../src/rig/editor.js'
import { humanoidRig, bodyOnlyPreset } from './fixtures.mjs'

const rig = humanoidRig()
const look = compileLook({ rig, attachments: [], preset: bodyOnlyPreset() })
const pose = createPose(look)
const solved = solvePose(look, pose)
const bone = (name) => look.byKey.get(name)
const at = (pos) => [pos[0], pos[1]]

console.log('\nhit testing')

test('a click on a joint reports the joint, not the bone', () => {
	const knee = at(boneWorldPosition(solved, bone('shin_l').id))
	const hit = hitTest(look, solved, knee)
	assert.equal(hit.kind, 'joint')
	assert.equal(hit.boneId, bone('shin_l').id)
})

test('a click along a bone reports the bone', () => {
	const hip = at(boneWorldPosition(solved, bone('thigh_l').id))
	const knee = at(boneWorldPosition(solved, bone('shin_l').id))
	const middle = [(hip[0] + knee[0]) / 2, (hip[1] + knee[1]) / 2]
	const hit = hitTest(look, solved, middle)
	assert.equal(hit.kind, 'bone')
	assert.equal(hit.boneId, bone('thigh_l').id)
})

test('a click in empty space hits nothing', () => {
	assert.equal(hitTest(look, solved, [5, 5]), null)
})

test('the hit radius is a threshold, not a suggestion', () => {
	const knee = at(boneWorldPosition(solved, bone('shin_l').id))
	const near = [knee[0] + HIT_RADIUS + 1, knee[1]]
	assert.equal(hitTest(look, solved, near), null)
})

console.log('\npivots')

test('a pivot drag moves the pivot by the delta', () => {
	const editable = compileLook({ rig: structuredClone(rig), attachments: [], preset: bodyOnlyPreset() })
	const result = movePivot(editable, 'head', [3, -2])
	assert.equal(result.ok, true)
	assert.deepEqual(editable.slots.find((slot) => slot.name === 'head').art.pivot, [3, -2])
})

test('a pivot cannot be dragged outside its own drawing', () => {
	const editable = compileLook({ rig: structuredClone(rig), attachments: [], preset: bodyOnlyPreset() })
	const before = [...editable.slots.find((slot) => slot.name === 'head').art.pivot]
	const result = movePivot(editable, 'head', [10_000, 0])
	assert.equal(result.ok, true)
	assert.deepEqual(result.pivot, before, 'the drag is refused and the pivot stays')
})

test('a pivot on an unknown slot is a reported failure', () => {
	assert.deepEqual(movePivot(look, 'ghost', [1, 1]), { ok: false, reason: 'slot-missing' })
})

console.log('\nrotation')

test('rotating a bone respects its limit', () => {
	const next = rotateBone(pose, bone('thigh_l'), -400)
	assert.equal(next[bone('thigh_l').id].rotation, -120)
})

test('rotating within limits keeps the value', () => {
	assert.equal(rotateBone(pose, bone('thigh_l'), -30)[bone('thigh_l').id].rotation, -30)
})

test('a bone without limits rotates freely', () => {
	assert.equal(rotateBone(pose, bone('root'), 720)[bone('root').id].rotation, 720)
})

console.log('\noverlays')

test('a limit arc spans exactly the bone’s allowed range', () => {
	const arc = limitArc(look, solved, bone('thigh_l'))
	assert.equal(arc.from, -120)
	assert.equal(arc.to, 45)
	const kneeArc = limitArc(look, solved, bone('shin_l'))
	assert.equal(kneeArc.from, -5)
	assert.equal(kneeArc.to, 130)
})

test('a bone without a limit has no arc to draw', () => {
	assert.equal(limitArc(look, solved, bone('root')), null)
})

test('the coverage disc sits on the pivot and is sized by the overlap', () => {
	const knee = at(boneWorldPosition(solved, bone('shin_l').id))
	const disc = coverageDisc(look, solved, bone('shin_l'), 12)
	assert.deepEqual(disc.center, knee)
	assert.equal(disc.radius, 12)
})

test('a drag angle is measured from the joint', () => {
	// Straight to the right is 0°, straight down is 90° in screen coordinates.
	assert.equal(angleFrom([0, 0], [10, 0]), 0)
	assert.equal(Math.round(angleFrom([0, 0], [0, 10])), 90)
})

console.log('\nscrubbing')

test('the scrubber maps a fraction to clip time', () => {
	const clip = look.clips.get('idle')
	assert.equal(scrub(clip, 0).t, 0)
	assert.equal(scrub(clip, 0.5).t, clip.duration / 2)
	assert.equal(scrub(clip, 1).t, clip.duration)
	assert.equal(scrub(clip, 2).t, clip.duration, 'past the end is clamped')
})

report()
