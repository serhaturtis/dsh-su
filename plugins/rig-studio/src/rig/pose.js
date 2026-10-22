/**
 * Pose state and the forward-kinematics solve.
 *
 * A pose is a plain object: `{ [boneId]: { x, y, rotation, scaleX, scaleY } }`.
 * Plain so it can be cloned, diffed, snapshot in a test and blended without a
 * class in the way. The solver turns one pose into world transforms for every
 * bone and every slot.
 *
 * Convention: an attachment's `bounds` are expressed **around its pivot**, with
 * the pivot at (0, 0). That is what makes joint coverage arithmetic: the child's
 * joint is always the origin of its own space.
 */

import { clamp, compose, multiply, rotationOf, transformedBounds } from './math.js'

/** Every bone at its rest transform. */
export function createPose(look) {
	const pose = {}
	for (const bone of look.bones) pose[bone.id] = { ...bone.rest }
	return pose
}

/** Apply a sampled clip on top of a pose, without mutating it. */
export function applySample(pose, sample) {
	const next = {}
	for (const id of Object.keys(pose)) next[id] = { ...pose[id] }
	for (const [id, properties] of Object.entries(sample)) {
		const bone = next[id]
		if (bone === undefined) continue
		for (const [property, value] of Object.entries(properties)) bone[property] = value
	}
	return next
}

/**
 * Clamp a pose to the rig's limits, in place on a copy.
 *
 * Limits are applied *after* sampling and *before* world transforms, so neither
 * a clip nor an IK target can hyperextend a joint.
 */
export function clampLimits(look, pose) {
	const next = {}
	for (const bone of look.bones) {
		const current = pose[bone.id] ?? bone.rest
		const copy = { ...current }
		const limit = bone.limit
		if (limit !== undefined && limit !== null) {
			if (Array.isArray(limit.rotation) && Number.isFinite(copy.rotation)) {
				copy.rotation = clamp(copy.rotation, limit.rotation[0], limit.rotation[1])
			}
			if (Array.isArray(limit.x) && Number.isFinite(copy.x)) copy.x = clamp(copy.x, limit.x[0], limit.x[1])
			if (Array.isArray(limit.y) && Number.isFinite(copy.y)) copy.y = clamp(copy.y, limit.y[0], limit.y[1])
		}
		next[bone.id] = copy
	}
	return next
}

/** The local matrix of one bone in its current pose. */
export function localMatrix(state) {
	return compose(state.x ?? 0, state.y ?? 0, state.rotation ?? 0, state.scaleX ?? 1, state.scaleY ?? 1)
}

/**
 * Solve world transforms.
 *
 * Bones are stored in a parent-before-child order by the compiler, so one pass
 * is enough. Mirroring is applied to the root bones' scale, which flips the
 * whole figure without touching a single pose value.
 *
 * @returns `{ bones: Map<id, matrix>, rotation: Map<id, degrees>, slots: [{ slot, world, bounds }] }`
 */
export function solvePose(look, pose) {
	const bones = new Map()
	const rotations = new Map()
	for (const bone of look.bones) {
		const state = pose[bone.id] ?? bone.rest
		let local = localMatrix(state)
		// Mirror about the canvas centre, not about the root's own position: a
		// flip at the root would move the whole figure off the canvas.
		if (bone.parentId === null && look.mirror === true) local = multiply([-1, 0, 0, 1, look.canvas.width, 0], local)
		const world = bone.parentId === null ? local : multiply(bones.get(bone.parentId), local)
		bones.set(bone.id, world)
		rotations.set(bone.id, rotationOf(world))
	}

	const slots = look.slots.map((slot) => {
		const bone = bones.get(slot.boneId)
		const art = slot.art ?? {}
		const world = multiply(bone, compose(art.x ?? 0, art.y ?? 0, art.rotation ?? 0, art.scaleX ?? 1, art.scaleY ?? 1))
		const bounds = Array.isArray(art.bounds) ? transformedBounds(art.bounds, world) : null
		return { slot, world, bounds }
	})

	return { bones, rotations, slots }
}

/** World position of a bone's origin, for IK targets and tests. */
export function boneWorldPosition(solved, boneId) {
	const matrix = solved.bones.get(boneId)
	return matrix === undefined ? null : [matrix[4], matrix[5]]
}

/** Snapshot a pose as plain numbers, for tests and for recording. */
export function poseValues(look, pose) {
	return look.bones.map((bone) => ({ id: bone.id, name: bone.name, ...pose[bone.id] }))
}
