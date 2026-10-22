/**
 * Two-bone IK: put the end of a chain on a target.
 *
 * The reason this exists at all: foot planting. A squat moves the hips down, and
 * without IK the feet move with them. With it, the hips move and the feet stay.
 *
 * The maths is the law of cosines in the *parent's* space, so the answer does
 * not depend on how the root is currently posed. `bend` picks which way the
 * knee or elbow points, because both solutions are geometrically valid and only
 * one is anatomically right.
 */

import { apply, degrees, invert, multiply, compose } from './math.js'
import { solvePose } from './pose.js'

/**
 * Angles for a chain of two segments reaching a point.
 *
 * @param root - chain root in the parent's space.
 * @param target - where the chain's end should land, in the parent's space.
 * @param upperLength - length of the first segment.
 * @param lowerLength - length of the second segment.
 * @param bend - +1 or -1: which side the joint bends towards.
 * @returns `{ upper, lower }` rotations in degrees, relative to the parent.
 */
export function twoBoneAngles({ root, target, upperLength, lowerLength, bend = 1 }) {
	const dx = target[0] - root[0]
	const dy = target[1] - root[1]
	const distance = Math.hypot(dx, dy)
	// A chain cannot stretch: clamp the reach, so an impossible target leaves the
	// limb straight rather than exploding the rotation.
	const reach = Math.min(Math.max(distance, Math.abs(upperLength - lowerLength) + 1e-6), upperLength + lowerLength - 1e-6)
	const cosUpper = (upperLength * upperLength + reach * reach - lowerLength * lowerLength) / (2 * upperLength * reach)
	const cosInner = (upperLength * upperLength + lowerLength * lowerLength - reach * reach) / (2 * upperLength * lowerLength)
	const upperOffset = Math.acos(Math.min(1, Math.max(-1, cosUpper)))
	const inner = Math.acos(Math.min(1, Math.max(-1, cosInner)))
	const toTarget = Math.atan2(dy, dx)
	// A bone's child sits along +y (y-down, a limb hangs downward), and a
	// rotation of θ points it at θ+90°. So the segment angle minus 90° is the
	// bone's own rotation.
	return {
		upper: degrees(toTarget + bend * upperOffset) - 90,
		// The elbow angle is relative to the upper segment, signed so the chain
		// bends *towards* the target: a straight chain is 0.
		lower: degrees(bend * (inner - Math.PI)),
	}
}

/**
 * Length of the segment a bone spans, from the bone to its child.
 *
 * In the format a bone's position is its joint; the next bone's position is the
 * far end. That is the segment art is drawn between, so it is the segment IK
 * must bend.
 */
export function segmentLength(look, boneId) {
	const bone = look.bones[boneId]
	if (bone === undefined) return 0
	const child = look.bones.find((candidate) => candidate.parentId === boneId)
	if (child === undefined) return 0
	return Math.hypot(child.rest.x, child.rest.y)
}

/**
 * Solve one IK chain into a pose.
 *
 * Two passes: solve forward to know the parent's world matrix, compute angles in
 * that space, write them into the chain, then the caller solves again.
 */
export function solveIKChain(look, pose, chain) {
	const solved = solvePose(look, pose)
	const upper = look.bones[chain.upperId]
	const lower = look.bones[chain.lowerId]
	if (upper === undefined || lower === undefined) return pose

	const parentId = upper.parentId
	const parentWorld = parentId === null ? [1, 0, 0, 1, 0, 0] : solved.bones.get(parentId)
	const inverse = invert(parentWorld)
	const root = apply(inverse, solved.bones.get(upper.id)[4], solved.bones.get(upper.id)[5])
	const targetMatrix = solved.bones.get(chain.targetId)
	const targetWorld = chain.targetWorld ?? [targetMatrix[4], targetMatrix[5]]
	const targetLocal = apply(inverse, targetWorld[0], targetWorld[1])

	const angles = twoBoneAngles({
		root,
		target: targetLocal,
		upperLength: chain.upperLength ?? segmentLength(look, upper.id),
		lowerLength: chain.lowerLength ?? segmentLength(look, lower.id),
		bend: chain.bend ?? 1,
	})

	const next = { ...pose }
	next[upper.id] = { ...(pose[upper.id] ?? upper.rest), rotation: angles.upper }
	next[lower.id] = { ...(pose[lower.id] ?? lower.rest), rotation: angles.lower }
	return next
}

/** Where a chain's end currently is, in world space — the IK error, for tests. */
export function chainEndWorld(look, pose, chain) {
	const solved = solvePose(look, pose)
	const lower = look.bones[chain.lowerId]
	const world = solved.bones.get(chain.lowerId)
	const length = chain.lowerLength ?? segmentLength(look, lower.id)
	if (length === 0) return [world[4], world[5]]
	const tip = apply(multiply(world, compose(0, 0, 0)), 0, length)
	return tip
}
