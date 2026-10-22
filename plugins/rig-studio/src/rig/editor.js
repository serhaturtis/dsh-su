/**
 * Editor operations, as pure functions.
 *
 * The editor is where the pivot bet is won or lost, so its behaviour lives here
 * rather than inside a component: hit-testing a bone, dragging a pivot, rotating
 * within limits, and the two overlays that make a rig legible (limit arcs and the
 * coverage disc). All of it is arithmetic on a solved pose, so all of it can be
 * tested without a browser.
 */

import { boundsContain, degrees, radians } from './math.js'
import { solvePose } from './pose.js'

/** How close a pointer must be to a bone's line before it counts as a hit. */
export const HIT_RADIUS = 10

function distanceToSegment(point, a, b) {
	const dx = b[0] - a[0]
	const dy = b[1] - a[1]
	const lengthSquared = dx * dx + dy * dy
	if (lengthSquared === 0) return Math.hypot(point[0] - a[0], point[1] - a[1])
	let t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared
	t = Math.min(1, Math.max(0, t))
	return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy))
}

/** The world position of a bone's joint, and of its far end. */
function boneEnds(look, solved, bone) {
	const origin = solved.bones.get(bone.id)
	const start = [origin[4], origin[5]]
	const child = look.bones.find((candidate) => candidate.parentId === bone.id)
	if (child === undefined) return { start, end: start }
	const childWorld = solved.bones.get(child.id)
	return { start, end: [childWorld[4], childWorld[5]] }
}

/**
 * What is under the pointer: a joint, a bone, or nothing.
 *
 * Joints win over bones — they are smaller targets and the one thing an author
 * must be able to grab precisely.
 */
export function hitTest(look, solved, point, radius = HIT_RADIUS) {
	let best = null
	for (const bone of look.bones) {
		const origin = solved.bones.get(bone.id)
		const jointDistance = Math.hypot(point[0] - origin[4], point[1] - origin[5])
		if (jointDistance <= radius && (best === null || jointDistance < best.distance)) {
			best = { kind: 'joint', boneId: bone.id, distance: jointDistance }
		}
	}
	if (best !== null) return best
	for (const bone of look.bones) {
		const { start, end } = boneEnds(look, solved, bone)
		const distance = distanceToSegment(point, start, end)
		if (distance <= radius && (best === null || distance < best.distance)) {
			best = { kind: 'bone', boneId: bone.id, distance }
		}
	}
	return best
}

/**
 * Move a slot's pivot, in the slot's own space.
 *
 * Pivot editing is the reason the editor exists: a pivot two pixels off is a
 * joint that tears. The value is clamped to the artwork's bounds, because a
 * pivot outside its own drawing cannot be meaningful.
 */
export function movePivot(look, slotName, delta, { bounds = true } = {}) {
	const slot = look.slots.find((entry) => entry.name === slotName)
	if (slot === undefined) return { ok: false, reason: 'slot-missing' }
	const art = slot.art
	const pivot = Array.isArray(art.pivot) ? [...art.pivot] : [0, 0]
	let next = [pivot[0] + delta[0], pivot[1] + delta[1]]
	if (bounds && Array.isArray(art.bounds)) {
		// Bounds are pivot-relative, so shifting the pivot by d shifts the bounds
		// by -d in drawing space; keep the drawing around the pivot.
		const [x, y, w, h] = art.bounds
		if (!boundsContain([x - next[0], y - next[1], w, h], 0, 0, 0)) next = pivot
	}
	art.pivot = next
	return { ok: true, pivot: next }
}

/** Rotate a bone, clamped to its limits — the same clamp the solver applies. */
export function rotateBone(pose, bone, value) {
	const limit = bone.limit
	const rotation = Array.isArray(limit?.rotation) ? Math.min(Math.max(value, limit.rotation[0]), limit.rotation[1]) : value
	return { ...pose, [bone.id]: { ...(pose[bone.id] ?? bone.rest), rotation } }
}

/**
 * The arc a bone may rotate through, in world degrees, for drawing its limits.
 *
 * Returned in the bone's parent space so an overlay can stroke it without
 * inverting anything: the arc starts at the parent's world rotation plus the
 * bone's minimum, and ends at that plus its maximum.
 */
export function limitArc(look, solved, bone) {
	const limit = bone.limit
	if (!Array.isArray(limit?.rotation)) return null
	const parentRotation = bone.parentId === null ? 0 : rotationOfMatrix(solved.bones.get(bone.parentId))
	return {
		center: [solved.bones.get(bone.id)[4], solved.bones.get(bone.id)[5]],
		from: parentRotation + limit.rotation[0],
		to: parentRotation + limit.rotation[1],
	}
}

function rotationOfMatrix(matrix) {
	return degrees(Math.atan2(matrix[1], matrix[0]))
}

/**
 * The coverage disc a joint needs, as geometry the overlay can stroke.
 *
 * This draws the design's disc rule: a circle centred on the pivot, sized by the
 * rig's overlap requirement, so the author can see whether the art covers it.
 */
export function coverageDisc(look, solved, bone, overlap) {
	const world = solved.bones.get(bone.id)
	return { center: [world[4], world[5]], radius: overlap }
}

/**
 * Where a clip is at a scrub position, and what a scrubbed playhead implies.
 *
 * Kept here rather than in the renderer so a test can assert the mapping without
 * drawing: the editor's scrubber must agree with playback, or authoring feels
 * haunted.
 */
export function scrub(clip, fraction) {
	const t = Math.min(1, Math.max(0, fraction)) * clip.duration
	return { t, loop: clip.loop === true, name: clip.name }
}

/** Convert a pointer delta into an angle about a centre, for drag-rotate. */
export function angleFrom(centre, point) {
	return degrees(Math.atan2(point[1] - centre[1], point[0] - centre[0]))
}

/** Solve once, for callers that only have a look and a pose. */
export function solveForEditor(look, pose) {
	return solvePose(look, pose)
}

export { radians }
