/**
 * Lint: the checks that decide whether a rig will *hold together*, as opposed to
 * whether it is structurally valid (that is `format.js`).
 *
 * Geometry here is rectangles, not pixels: it is the fast pass an editor can run
 * on every keystroke. The pixel-accurate raster coverage pass lands in M3 and
 * replaces `joint-uncovered`'s approximation without changing the code it emits,
 * so authored content keeps its meaning.
 */

import { ERRORS, LAYER_INDEX, LIMITS, sortSlots } from './format.js'
import { CompileError, compileLook } from './compile.js'
import { boundsContain, boundsContainBounds } from './math.js'
import { loopSeam } from './clip.js'
import { boneWorldPosition, createPose, solvePose } from './pose.js'

/** Lint codes. One test per code lives in `test/lint.test.mjs`. */
export const LINT = {
	JOINT_UNCOVERED: 'joint-uncovered',
	JOINT_DISC_BEHIND_ART: 'joint-disc-behind-art',
	PART_SHORTER_THAN_SEGMENT: 'part-shorter-than-segment',
	LIMIT_MISSING: 'limit-missing',
	BOUNDS_MISSING: 'bounds-missing',
	ATTACHMENT_DOES_NOT_OCCLUDE: 'attachment-does-not-occlude',
	GARMENT_JOINT_UNSPLIT: 'garment-joint-unsplit',
	SLOT_ORDER_COLLISION: 'slot-order-collision',
	GROUP_CONFLICT: 'group-conflict',
	ORPHAN_ATTACHMENT: 'orphan-attachment',
	MIRROR_UNSAFE: 'mirror-unsafe',
	LOOP_SEAM: 'loop-seam',
	CANVAS_OVERFLOW: 'canvas-overflow',
}

const LIMB_ROLE = /^(leg|arm|spine)/i
/** How far two pose values may differ before a loop counts as popping. */
const LOOP_SEAM_LIMIT = 0.5

/** Whether two world-space boxes intersect. */
function boundsOverlap(a, b) {
	return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]
}

function issue(code, severity, message) {
	return { code, severity, message }
}

/** A rig bone by its authored name (attachment bones are namespaced away). */
function rigBone(look, name) {
	return look.bones.find((bone) => bone.attachment == null && bone.name === name)
}

/** The body slot bound to a bone, if any. */
function bodySlot(look, boneId) {
	return look.slots.find((slot) => slot.boneId === boneId && slot.kind === 'body')
}

/**
 * Lint a compiled look.
 *
 * Takes the same input as `compileLook`; returns issues rather than throwing,
 * so an editor can show every problem at once instead of one per fix.
 *
 * @returns `Array<{ code, severity, message }>` — empty means the rig holds.
 */
export function lintLook({ rig, attachments = [], preset = { attachments: [] }, mirror = false }) {
	let look
	try {
		look = compileLook({ rig, attachments, preset, mirror })
	} catch (error) {
		if (error instanceof CompileError) {
			return error.codes.map((code) => {
				const base = code.split(':')[0]
				return issue(base, 'error', `compile refused: ${code}`)
			})
		}
		throw error
	}

	const issues = []
	const minOverlap = LIMITS.minOverlap

	// --- joints: is the pivot covered by the parent, the child, or a cap?
	for (const joint of rig.joints ?? []) {
		const jointBone = rigBone(look, joint.bone)
		if (jointBone === undefined || jointBone.parentId === null) continue
		const parentSlot = bodySlot(look, jointBone.parentId)
		const childSlot = bodySlot(look, jointBone.id)
		if (parentSlot === undefined || childSlot === undefined) continue

		const pivot = [jointBone.rest.x, jointBone.rest.y]
		const parentBounds = parentSlot.art.bounds
		const childBounds = childSlot.art.bounds
		const parentHasBounds = Array.isArray(parentBounds)
		const childHasBounds = Array.isArray(childBounds)

		if (!parentHasBounds || !childHasBounds) {
			issues.push(issue(LINT.BOUNDS_MISSING, 'warning', `joint ${joint.bone}: one side has no bounds, so coverage cannot be checked`))
			continue
		}

		// The parent must reach the pivot at all; short is a different failure
		// from thin, and the author needs to know which.
		if (!boundsContain(parentBounds, pivot[0], pivot[1], 0)) {
			issues.push(issue(LINT.PART_SHORTER_THAN_SEGMENT, 'error', `joint ${joint.bone}: the parent part stops short of the joint`))
			continue
		}

		const parentOk = boundsContain(parentBounds, pivot[0], pivot[1], minOverlap)
		const childOk = boundsContain(childBounds, 0, 0, minOverlap)
		const cap = look.slots.find((slot) => slot.cap && slot.boneId === jointBone.id && Array.isArray(slot.art.bounds))
		const capOk = cap !== undefined && boundsContain(cap.art.bounds, 0, 0, minOverlap)

		if (!((parentOk && childOk) || capOk)) {
			const side = parentOk ? 'child part' : 'parent part'
			issues.push(issue(LINT.JOINT_UNCOVERED, 'error', `joint ${joint.bone}: the ${side} does not cover the pivot by ${minOverlap}px`))
		}

		// A disc drawn in front of the part it should hide covers nothing, even
		// when the joint happens to be covered by its parts: it would show as a
		// visible cap sliding over the child.
		if (joint.disc !== undefined) {
			const disc = look.slots.find((slot) => slot.name === joint.disc)
			if (disc !== undefined) {
				const discBand = LAYER_INDEX[disc.layer] ?? 1
				const childBand = LAYER_INDEX[childSlot.layer] ?? 1
				const inFront = discBand > childBand || (discBand === childBand && (disc.order ?? 0) > (childSlot.order ?? 0))
				if (inFront) {
					issues.push(issue(LINT.JOINT_DISC_BEHIND_ART, 'error', `joint ${joint.bone}: its disc "${joint.disc}" draws in front of the child part`))
				}
			}
		}
	}

	// --- limits on limb bones
	for (const bone of look.bones) {
		if (bone.attachment != null) continue
		if (LIMB_ROLE.test(bone.role ?? '') && !Array.isArray(bone.limit?.rotation)) {
			issues.push(issue(LINT.LIMIT_MISSING, 'warning', `bone ${bone.name} has a limb role but no rotation limit`))
		}
	}

	// --- occlusions: the garment must actually hide what it claims to
	const pose = createPose(look)
	const solved = solvePose(look, pose)

	// --- garments that span a joint as one rigid piece.
	// The check is geometric and in world space: the garment's slot must reach
	// past the joint it hangs above, which means it will tear there.
	const sourceDocs = Array.isArray(attachments) ? attachments : [...attachments.values()]
	for (const source of sourceDocs) {
		if ((source.kind ?? 'garment') !== 'garment') continue
		const attachBone = rigBone(look, source.attach)
		if (attachBone === undefined) continue
		for (const joint of rig.joints ?? []) {
			const jointBone = rigBone(look, joint.bone)
			if (jointBone === undefined || jointBone.parentId !== attachBone.id) continue
			const jointWorld = boneWorldPosition(solved, jointBone.id)
			for (const entry of solved.slots) {
				if (entry.slot.attachment !== source.id || entry.bounds === null) continue
				const [x, y, w, h] = entry.bounds
				const inside = jointWorld[0] >= x + minOverlap && jointWorld[0] <= x + w - minOverlap && jointWorld[1] >= y + minOverlap && jointWorld[1] <= y + h - minOverlap
				if (inside) {
					issues.push(issue(LINT.GARMENT_JOINT_UNSPLIT, 'warning', `${source.id} covers the joint at ${joint.bone} as one piece; split it there`))
				}
			}
		}
	}
	for (const attachmentId of look.attachments.map((entry) => entry.id)) {
		const source = (Array.isArray(attachments) ? attachments : [...attachments.values()]).find((entry) => entry.id === attachmentId)
		if (source === undefined || !Array.isArray(source.occludes)) continue
		const garmentSlots = solved.slots.filter((entry) => entry.slot.attachment === attachmentId && entry.bounds !== null)
		if (garmentSlots.length === 0) continue
		for (const occludedName of source.occludes) {
			const bone = rigBone(look, occludedName)
			if (bone === undefined) continue
			const hidden = solved.slots.find((entry) => entry.slot.boneId === bone.id && entry.slot.kind === 'body' && entry.bounds !== null)
			if (hidden === undefined) continue
			const covered = garmentSlots.some((garment) => boundsContainBounds(garment.bounds, hidden.bounds))
			if (!covered) {
				issues.push(issue(LINT.ATTACHMENT_DOES_NOT_OCCLUDE, 'warning', `${attachmentId} does not enclose ${occludedName} at rest`))
			}
		}
	}

	// --- draw order: two slots at the same place in the list are ambiguous only
	// when they overlap; left and right limbs share an order and never touch.
	for (let i = 1; i < solved.slots.length; i++) {
		const a = solved.slots[i - 1]
		const b = solved.slots[i]
		if ((LAYER_INDEX[a.slot.layer] ?? 1) !== (LAYER_INDEX[b.slot.layer] ?? 1)) continue
		if ((a.slot.order ?? 0) !== (b.slot.order ?? 0)) continue
		if (a.slot.name === b.slot.name) continue
		if (a.bounds === null || b.bounds === null) continue
		if (boundsOverlap(a.bounds, b.bounds)) {
			issues.push(issue(LINT.SLOT_ORDER_COLLISION, 'error', `slots ${a.slot.name} and ${b.slot.name} share layer ${a.slot.layer} and order ${a.slot.order ?? 0} while overlapping`))
		}
	}

	// --- mirroring asymmetric art is wrong art; compile cannot know, lint can
	const selected = new Set((preset.attachments ?? []).map((choice) => (typeof choice === 'string' ? choice : choice.attachment)))
	const source = Array.isArray(attachments) ? attachments : [...attachments.values()]
	for (const entry of source) {
		if (!selected.has(entry.id)) continue
		if (mirror === true && entry.asymmetric === true) {
			issues.push(issue(LINT.MIRROR_UNSAFE, 'warning', `${entry.id} is asymmetric, so a mirrored look is wrong art`))
		}
	}

	// --- looping clips that pop at the wrap
	for (const clip of look.clips.values()) {
		const seam = loopSeam(clip)
		if (seam > LOOP_SEAM_LIMIT) {
			issues.push(issue(LINT.LOOP_SEAM, 'warning', `clip ${clip.name} ends ${seam.toFixed(1)} away from its first frame`))
		}
	}

	// --- artwork that leaves the canvas at rest
	const { width, height } = look.canvas
	for (const entry of solved.slots) {
		if (entry.bounds === null) continue
		const [x, y, w, h] = entry.bounds
		if (x < 0 || y < 0 || x + w > width || y + h > height) {
			issues.push(issue(LINT.CANVAS_OVERFLOW, 'warning', `${entry.slot.name} leaves the canvas at rest`))
		}
	}

	return issues
}

/** Convenience: only the errors, for a CI gate. */
export function lintErrors(issues) {
	return issues.filter((entry) => entry.severity === 'error')
}
