/**
 * Compile a look: rig + selected attachments → one runtime skeleton.
 *
 * This is where the design's central decision is implemented. Authoring keeps
 * rig and attachment bones separate and name-based; compiling produces a single
 * flat skeleton with numeric ids, one slot list in canonical draw order, and
 * one clip library. Nothing downstream ever holds a name, so a preset switch —
 * which recompiles — cannot leave a stale reference behind.
 */

import { ERRORS, LAYER_INDEX, sortSlots, validateAttachment, validateRig } from './format.js'

export class CompileError extends Error {
	constructor(codes) {
		super(`rig compile failed: ${codes.join(', ')}`)
		this.name = 'CompileError'
		this.codes = codes
	}
}

function asMap(attachments) {
	if (attachments instanceof Map) return attachments
	const map = new Map()
	for (const attachment of attachments) map.set(attachment.id, attachment)
	return map
}

/**
 * Bones in parent-before-child order.
 *
 * The solver assumes a parent is solved before its child, and a hand-authored
 * rig may list either order. Sorting here means authoring order is a
 * convenience, not a correctness requirement — and it keeps the declaration
 * order among siblings, so slot order stays predictable.
 */
function orderBones(bones) {
	const byName = new Map(bones.map((bone) => [bone.name, bone]))
	const out = []
	const done = new Set()
	const visiting = new Set()
	const visit = (bone) => {
		if (bone === undefined || done.has(bone.name) || visiting.has(bone.name)) return
		visiting.add(bone.name)
		const parent = bone.parent === null || bone.parent === undefined ? undefined : byName.get(bone.parent)
		visit(parent)
		visiting.delete(bone.name)
		if (!done.has(bone.name)) {
			done.add(bone.name)
			out.push(bone)
		}
	}
	for (const bone of bones) visit(bone)
	return out
}

/**
 * The bone an attachment hangs from, as a compiled key.
 *
 * An attachment may attach to a rig bone, or to another attachment. In the
 * second case it hangs from that attachment's root bone, and an attachment with
 * no bones of its own hangs directly from whatever its parent hangs from. This
 * is what lets a bow sit on a hat without either knowing about the other.
 */
function frameKeyFor(attachment, byKey, byId) {
	const target = attachment.attach
	if (typeof target !== 'string') return null
	if (byKey.has(target)) return target
	const parent = byId.get(target)
	if (parent === undefined) return null
	const roots = attachmentRoots(parent)
	if (roots.length > 0) return `attach:${parent.id}:${roots[0].name}`
	return frameKeyFor(parent, byKey, byId)
}

/** The attachment's root bone: the one whose parent is not another bone of its own. */
function attachmentRoots(attachment) {
	const local = new Set((attachment.bones ?? []).map((bone) => bone.name))
	return (attachment.bones ?? []).filter((bone) => bone.parent === null || bone.parent === undefined || !local.has(bone.parent))
}

/**
 * Resolve a preset's attachment choices, refusing anything invalid.
 *
 * Selection is validated here rather than trusted from the document, because a
 * preset can be edited by hand and a missing parent attachment or a group
 * conflict is a silent visual bug otherwise.
 */
function resolveSelection(attachments, preset) {
	const codes = []
	const chosen = []
	const groups = new Map()
	for (const choice of preset.attachments ?? []) {
		const id = typeof choice === 'string' ? choice : choice.attachment
		const variant = typeof choice === 'string' ? undefined : choice.variant
		const attachment = attachments.get(id)
		if (attachment === undefined) {
			codes.push(`${ERRORS.PRESET_ATTACHMENT}:${id}`)
			continue
		}
		const check = validateAttachment(attachment)
		if (!check.ok) codes.push(...check.errors)
		const group = attachment.group
		if (typeof group === 'string') {
			if (groups.has(group) && groups.get(group) !== id) codes.push(`${ERRORS.PRESET_GROUP}:${group}`)
			groups.set(group, id)
		}
		chosen.push({ attachment, variant })
	}
	// An attachment that attaches to another attachment needs its parent present.
	for (const { attachment } of chosen) {
		if (attachments.has(attachment.attach) && !chosen.some((entry) => entry.attachment.id === attachment.attach)) {
			codes.push(`${ERRORS.PRESET_ATTACHMENT}:${attachment.attach}`)
		}
	}
	return { chosen, codes }
}

/** Pick the artwork for a variant, defaulting to `default` then the first one. */
function resolveVariant(variants, requested) {
	if (variants === undefined || variants === null) return undefined
	if (requested !== undefined && variants[requested] !== undefined) return { name: requested, art: variants[requested] }
	if (variants.default !== undefined) return { name: 'default', art: variants.default }
	const first = Object.keys(variants)[0]
	return first === undefined ? undefined : { name: first, art: variants[first] }
}

/**
 * Compile a look.
 *
 * @param input.rig - the rig document.
 * @param input.attachments - attachment documents, array or Map.
 * @param input.preset - `{ bodyVariant?, attachments: [{ attachment, variant? }] }`.
 * @param input.mirror - render the whole skeleton flipped; applied at the root.
 * @returns a compiled look: bones with ids, sorted slots, clips keyed by id.
 */
export function compileLook({ rig, attachments = [], preset = { attachments: [] }, mirror = false }) {
	const codes = []
	const rigCheck = validateRig(rig)
	if (!rigCheck.ok) codes.push(...rigCheck.errors)

	const byId = asMap(attachments)
	const { chosen, codes: selectionCodes } = resolveSelection(byId, preset)
	codes.push(...selectionCodes)
	if (codes.length > 0) throw new CompileError([...new Set(codes)])

	/** @type {Array<{id:number,key:string,name:string,parentId:number|null,rest:object,limit?:object,role?:string,joint?:object,attachment?:string}>} */
	const bones = []
	const byKey = new Map()

	const addBone = (bone) => {
		const id = bones.length
		const entry = {
			id,
			key: bone.key,
			name: bone.name,
			parentId: bone.parentId,
			rest: {
				x: Number.isFinite(bone.x) ? bone.x : 0,
				y: Number.isFinite(bone.y) ? bone.y : 0,
				rotation: Number.isFinite(bone.rotation) ? bone.rotation : 0,
				scaleX: Number.isFinite(bone.scaleX) ? bone.scaleX : 1,
				scaleY: Number.isFinite(bone.scaleY) ? bone.scaleY : 1,
			},
			limit: bone.limit,
			role: bone.role,
			joint: bone.joint,
			attachment: bone.attachment,
		}
		bones.push(entry)
		byKey.set(bone.key, entry)
		return entry
	}

	// --- rig bones, in declaration order
	const joints = new Map()
	for (const joint of rig.joints ?? []) joints.set(joint.bone, joint)
	for (const bone of orderBones(rig.skeleton.bones)) {
		addBone({
			key: bone.name,
			name: bone.name,
			parentId: bone.parent == null ? null : byKey.get(bone.parent).id,
			x: bone.x,
			y: bone.y,
			rotation: bone.rotation,
			scaleX: bone.scaleX,
			scaleY: bone.scaleY,
			limit: bone.limit,
			role: bone.role,
			joint: joints.get(bone.name),
		})
	}

	// --- attachment bones, namespaced, in a deterministic order
	const grid = chosen
		.map(({ attachment, variant }) => ({ attachment, variant }))
		.sort((a, b) => a.attachment.id.localeCompare(b.attachment.id))

	for (const { attachment } of grid) {
		const local = new Map()
		for (const bone of orderBones(attachment.bones ?? [])) {
			const parent = bone.parent
			let parentId
			if (parent === null || parent === undefined) {
				// The attachment's root bone hangs off whatever it attaches to.
				const key = frameKeyFor(attachment, byKey, byId)
				if (key === null || !byKey.has(key)) {
					codes.push(`${ERRORS.ATTACHMENT_ATTACH}:${attachment.id}`)
					continue
				}
				parentId = byKey.get(key).id
			} else {
				const parentKey = `attach:${attachment.id}:${parent}`
				if (!byKey.has(parentKey) && !local.has(parent)) {
					codes.push(`${ERRORS.BONE_PARENT}:${attachment.id}:${parent}`)
					continue
				}
				parentId = local.has(parent) ? local.get(parent).id : byKey.get(parentKey).id
			}
			const entry = addBone({
				key: `attach:${attachment.id}:${bone.name}`,
				name: bone.name,
				parentId,
				x: bone.x,
				y: bone.y,
				rotation: bone.rotation,
				scaleX: bone.scaleX,
				scaleY: bone.scaleY,
				limit: bone.limit,
				role: bone.role,
				attachment: attachment.id,
			})
			local.set(bone.name, { id: entry.id })
		}
	}
	if (codes.length > 0) throw new CompileError([...new Set(codes)])

	// --- body artwork
	const bodyVariant = resolveVariant(rig.bodyVariants, preset.bodyVariant)
	if (bodyVariant === undefined) throw new CompileError([ERRORS.VARIANTS])
	const art = bodyVariant.art

	const slots = []
	for (const slot of rig.slots) {
		const piece = art[slot.name]
		if (piece === undefined) throw new CompileError([`${ERRORS.ART}:${slot.name}`])
		slots.push({
			name: slot.name,
			boneId: byKey.get(slot.bone).id,
			layer: slot.layer ?? 'body',
			order: slot.order ?? 0,
			cap: slot.cap === true,
			kind: 'body',
			art: piece,
			attachment: null,
		})
	}

	// --- attachment artwork, resolved per variant
	for (const { attachment, variant } of grid) {
		const resolved = resolveVariant(attachment.variants, variant)
		if (resolved === undefined) throw new CompileError([`${ERRORS.ART}:${attachment.id}`])
		for (const slot of attachment.slots ?? []) {
			const piece = resolved.art[slot.name]
			if (piece === undefined) throw new CompileError([`${ERRORS.ART}:${attachment.id}:${slot.name}`])
			const boneKey = slot.bone === undefined ? frameKeyFor(attachment, byKey, byId) : `attach:${attachment.id}:${slot.bone}`
			const bone = byKey.get(boneKey)
			if (bone === undefined) throw new CompileError([`${ERRORS.SLOT_BONE}:${attachment.id}:${slot.name}`])
			slots.push({
				name: `${attachment.id}:${slot.name}`,
				boneId: bone.id,
				layer: slot.layer ?? attachment.layer ?? 'over',
				order: slot.order ?? attachment.order ?? 0,
				cap: slot.cap === true,
				kind: attachment.kind ?? 'garment',
				art: piece,
				attachment: attachment.id,
			})
		}
	}
	if (codes.length > 0) throw new CompileError([...new Set(codes)])

	// --- clips: rig clips target rig bone names, attachment clips their own
	const clips = new Map()
	const addClip = (name, clip, boneKeyOf) => {
		const tracks = []
		for (const track of clip.tracks) {
			const key = boneKeyOf(track.bone)
			const bone = byKey.get(key)
			if (bone === undefined) throw new CompileError([`${ERRORS.TRACK_BONE}:${name}:${track.bone}`])
			tracks.push({
				boneId: bone.id,
				property: track.property,
				keys: track.keys.map((keyframe) => ({
					t: keyframe.t,
					v: keyframe.v,
					ease: keyframe.ease,
				})),
			})
		}
		clips.set(name, {
			name,
			duration: clip.duration,
			loop: clip.loop === true,
			tracks,
			markers: Array.isArray(clip.markers) ? clip.markers.map((marker) => ({ ...marker })) : [],
			events: Array.isArray(clip.events) ? clip.events.map((event) => ({ ...event })) : [],
		})
	}

	for (const [name, clip] of Object.entries(rig.animations ?? {})) addClip(name, clip, (bone) => bone)
	for (const { attachment } of grid) {
		for (const [name, clip] of Object.entries(attachment.clips ?? {})) {
			// Namespaced per attachment so two hair styles cannot collide.
			addClip(`${attachment.id}:${name}`, clip, (bone) => `attach:${attachment.id}:${bone}`)
		}
	}

	// --- springs and IK, remapped to ids
	const springs = []
	for (const { attachment } of grid) {
		for (const spring of attachment.springs ?? []) {
			const bone = byKey.get(`attach:${attachment.id}:${spring.bone}`)
			if (bone === undefined) throw new CompileError([`${ERRORS.TRACK_BONE}:${attachment.id}:${spring.bone}`])
			springs.push({
				boneId: bone.id,
				stiffness: spring.stiffness ?? 0.4,
				damping: spring.damping ?? 0.5,
				length: spring.length,
			})
		}
	}
	const ik = []
	for (const chain of rig.ik ?? []) {
		const upper = byKey.get(chain.chain[0])
		const lower = byKey.get(chain.chain[1])
		const target = byKey.get(chain.target)
		if (upper === undefined || lower === undefined || target === undefined) throw new CompileError([ERRORS.JOINTS])
		ik.push({
			upperId: upper.id,
			lowerId: lower.id,
			targetId: target.id,
			bend: chain.bend === -1 ? -1 : 1,
		})
	}

	return {
		rig,
		preset,
		view: preset.view,
		mirror: mirror === true,
		canvas: { width: rig.canvas.width, height: rig.canvas.height },
		bones,
		byKey,
		slots: sortSlots(slots),
		clips,
		springs,
		ik,
		bodyVariant: bodyVariant.name,
		attachments: grid.map(({ attachment, variant }) => ({ id: attachment.id, variant: resolveVariant(attachment.variants, variant).name })),
		layerIndex: LAYER_INDEX,
	}
}

/** The clip a view maps a name to, so an app can ask for `walk` in any view. */
export function resolveClipName(look, character, name) {
	const view = look.view ?? ''
	const viewClips = character?.views?.[view]?.clips
	if (viewClips !== undefined && typeof viewClips[name] === 'string') return viewClips[name]
	return name
}
