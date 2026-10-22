/**
 * The rig and attachment formats: structure, and the rules that decide whether
 * a document is one.
 *
 * Structure only. Whether the result *looks* right — joints covered, limits
 * present, clips not popping — is `lint.js`, because those checks need the
 * compiled look and geometry, not just one document.
 *
 * Y-down, degrees, one unit = one pixel, pivots as pixel offsets inside the
 * attachment. Boring on purpose: easy to hand-edit, diff and validate.
 */

export const SCHEMA = 1

export const LIMITS = {
	bones: 128,
	slots: 256,
	attachments: 64,
	variants: 32,
	animations: 64,
	tracks: 256,
	keys: 64,
	durationMs: 60_000,
	canvasSide: 4096,
	minOverlap: 12,
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

export const ERRORS = {
	SCHEMA: 'schema-unsupported',
	ID: 'id-invalid',
	NAME: 'name-invalid',
	CANVAS: 'canvas-invalid',
	BONES: 'bones-invalid',
	BONE_LIST: 'bone-list-empty',
	BONE_NAME: 'bone-name-invalid',
	BONE_DUPLICATE: 'bone-duplicate',
	BONE_PARENT: 'bone-parent-missing',
	BONE_CYCLE: 'bone-cycle',
	SLOTS: 'slots-invalid',
	SLOT_BONE: 'slot-bone-missing',
	SLOT_DUPLICATE: 'slot-duplicate',
	JOINTS: 'joints-invalid',
	VARIANTS: 'body-variants-invalid',
	ART: 'attachment-art-missing',
	ANIMATIONS: 'animations-invalid',
	TRACK_BONE: 'track-bone-missing',
	TRACK_PROPERTY: 'track-property-unknown',
	TRACK_KEYS: 'track-keys-invalid',
	DURATION: 'duration-invalid',
	ATTACHMENT_KIND: 'attachment-kind-unknown',
	ATTACHMENT_ATTACH: 'attachment-attach-missing',
	PRESET: 'preset-invalid',
	PRESET_ATTACHMENT: 'preset-attachment-missing',
	PRESET_GROUP: 'group-conflict',
	VIEW: 'view-invalid',
	TOO_MANY: 'too-many',
}

export const KINDS = ['garment', 'hair', 'tail', 'wing', 'accessory', 'prop']
export const LAYERS = ['back', 'body', 'over', 'front']
export const PROPERTIES = ['rotation', 'x', 'y', 'scaleX', 'scaleY']
export const EASES = ['linear', 'smooth', 'step']

function isObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value) {
	return typeof value === 'number' && Number.isFinite(value)
}

/** Validate a rig document. */
export function validateRig(rig) {
	const errors = []
	const warnings = []
	if (!isObject(rig)) return { ok: false, errors: [ERRORS.SCHEMA], warnings }
	if (rig.schema !== SCHEMA) errors.push(ERRORS.SCHEMA)
	if (typeof rig.id !== 'string' || !ID.test(rig.id)) errors.push(ERRORS.ID)
	if (typeof rig.name !== 'string' || !NAME.test(rig.name)) errors.push(ERRORS.NAME)

	const canvas = rig.canvas
	if (!isObject(canvas) || !isFiniteNumber(canvas.width) || !isFiniteNumber(canvas.height)) errors.push(ERRORS.CANVAS)
	else if (canvas.width <= 0 || canvas.height <= 0 || canvas.width > LIMITS.canvasSide || canvas.height > LIMITS.canvasSide) {
		errors.push(ERRORS.CANVAS)
	}

	const bones = isObject(rig.skeleton) ? rig.skeleton.bones : null
	const boneNames = new Set()
	if (!Array.isArray(bones) || bones.length === 0) errors.push(ERRORS.BONE_LIST)
	else if (bones.length > LIMITS.bones) errors.push(ERRORS.TOO_MANY)
	else {
		for (const bone of bones) {
			if (!isObject(bone) || typeof bone.name !== 'string' || !NAME.test(bone.name)) {
				errors.push(ERRORS.BONE_NAME)
				continue
			}
			if (boneNames.has(bone.name)) errors.push(ERRORS.BONE_DUPLICATE)
			boneNames.add(bone.name)
		}
		const byName = new Map(bones.filter(isObject).map((bone) => [bone.name, bone]))
		for (const bone of bones) {
			if (!isObject(bone) || !byName.has(bone.name)) continue
			const parent = bone.parent
			if (parent !== null && parent !== undefined && !byName.has(parent)) errors.push(ERRORS.BONE_PARENT)
			// Follow the parent chain: a cycle would hang the solver.
			let cursor = parent
			let hops = 0
			while (cursor !== null && cursor !== undefined && hops <= bones.length) {
				const next = byName.get(cursor)
				cursor = next === undefined ? null : next.parent
				hops++
			}
			if (hops > bones.length) {
				errors.push(ERRORS.BONE_CYCLE)
				break
			}
		}
	}

	if (!Array.isArray(rig.slots)) errors.push(ERRORS.SLOTS)
	else {
		const slotNames = new Set()
		for (const slot of rig.slots) {
			if (!isObject(slot) || typeof slot.name !== 'string' || !NAME.test(slot.name)) {
				errors.push(ERRORS.SLOTS)
				continue
			}
			if (slotNames.has(slot.name)) errors.push(ERRORS.SLOT_DUPLICATE)
			slotNames.add(slot.name)
			if (!boneNames.has(slot.bone)) errors.push(ERRORS.SLOT_BONE)
			if (slot.layer !== undefined && !LAYERS.includes(slot.layer)) errors.push(ERRORS.SLOTS)
		}
	}

	if (rig.joints !== undefined) {
		if (!Array.isArray(rig.joints)) errors.push(ERRORS.JOINTS)
		else for (const joint of rig.joints) {
			if (!isObject(joint) || !boneNames.has(joint.bone)) errors.push(ERRORS.JOINTS)
		}
	}

	if (!isObject(rig.bodyVariants)) errors.push(ERRORS.VARIANTS)
	else for (const variant of Object.values(rig.bodyVariants)) {
		if (!isObject(variant)) {
			errors.push(ERRORS.VARIANTS)
			continue
		}
		for (const art of Object.values(variant)) if (!isObject(art)) errors.push(ERRORS.ART)
	}

	errors.push(...validateAnimations(rig.animations, boneNames, 'rig'))
	return { ok: errors.length === 0, errors: [...new Set(errors)], warnings }
}

/** Shared clip validation: tracks, properties, keys, duration. */
export function validateAnimations(animations, boneNames, prefix) {
	const errors = []
	if (animations === undefined) return errors
	if (!isObject(animations)) return [ERRORS.ANIMATIONS]
	if (Object.keys(animations).length > LIMITS.animations) errors.push(ERRORS.TOO_MANY)
	for (const clip of Object.values(animations)) {
		if (!isObject(clip)) {
			errors.push(ERRORS.ANIMATIONS)
			continue
		}
		if (!isFiniteNumber(clip.duration) || clip.duration <= 0 || clip.duration > LIMITS.durationMs) errors.push(ERRORS.DURATION)
		if (!Array.isArray(clip.tracks)) {
			errors.push(ERRORS.ANIMATIONS)
			continue
		}
		if (clip.tracks.length > LIMITS.tracks) errors.push(ERRORS.TOO_MANY)
		for (const track of clip.tracks) {
			if (!isObject(track) || typeof track.bone !== 'string' || !boneNames.has(track.bone)) {
				errors.push(`${ERRORS.TRACK_BONE}:${prefix}:${track && track.bone}`)
				continue
			}
			if (!PROPERTIES.includes(track.property)) {
				errors.push(`${ERRORS.TRACK_PROPERTY}:${track.property}`)
				continue
			}
			if (!Array.isArray(track.keys) || track.keys.length === 0) {
				errors.push(ERRORS.TRACK_KEYS)
				continue
			}
			if (track.keys.length > LIMITS.keys) errors.push(ERRORS.TOO_MANY)
			let previous = -Infinity
			for (const key of track.keys) {
				// Out-of-order keys are refused rather than sorted: a clip that
				// relies on sorting is a clip whose author was surprised.
				if (!isObject(key) || !isFiniteNumber(key.t) || key.t < 0 || key.t < previous) {
					errors.push(ERRORS.TRACK_KEYS)
					break
				}
				if (key.ease !== undefined && !EASES.includes(key.ease) && !Array.isArray(key.ease)) {
					errors.push(ERRORS.TRACK_KEYS)
					break
				}
				previous = key.t
			}
		}
	}
	return errors
}

/** Validate an attachment document. */
export function validateAttachment(attachment) {
	const errors = []
	if (!isObject(attachment)) return { ok: false, errors: [ERRORS.SCHEMA], warnings: [] }
	if (typeof attachment.id !== 'string' || !ID.test(attachment.id)) errors.push(ERRORS.ID)
	if (attachment.schema !== undefined && attachment.schema !== SCHEMA) errors.push(ERRORS.SCHEMA)
	if (attachment.kind !== undefined && !KINDS.includes(attachment.kind)) errors.push(ERRORS.ATTACHMENT_KIND)
	if (typeof attachment.attach !== 'string' || attachment.attach.length === 0) errors.push(ERRORS.ATTACHMENT_ATTACH)
	if (attachment.layer !== undefined && !LAYERS.includes(attachment.layer)) errors.push(ERRORS.SLOTS)

	const boneNames = new Set()
	if (attachment.bones !== undefined) {
		if (!Array.isArray(attachment.bones)) errors.push(ERRORS.BONES)
		else for (const bone of attachment.bones) {
			if (!isObject(bone) || typeof bone.name !== 'string' || !NAME.test(bone.name)) {
				errors.push(ERRORS.BONE_NAME)
				continue
			}
			if (boneNames.has(bone.name)) errors.push(ERRORS.BONE_DUPLICATE)
			boneNames.add(bone.name)
		}
	}

	if (!Array.isArray(attachment.slots)) errors.push(ERRORS.SLOTS)
	else for (const slot of attachment.slots) {
		if (!isObject(slot) || typeof slot.name !== 'string' || !NAME.test(slot.name)) errors.push(ERRORS.SLOTS)
		else if (slot.bone !== undefined && !boneNames.has(slot.bone)) errors.push(ERRORS.SLOT_BONE)
	}

	if (!isObject(attachment.variants)) errors.push(ERRORS.ART)
	else for (const variant of Object.values(attachment.variants)) {
		if (!isObject(variant)) {
			errors.push(ERRORS.ART)
			continue
		}
		for (const art of Object.values(variant)) {
			if (!isObject(art)) errors.push(ERRORS.ART)
			else if (typeof art.image !== 'string' && !isObject(art.tint) && !Array.isArray(art.tint)) errors.push(ERRORS.ART)
		}
	}

	if (attachment.clips !== undefined) errors.push(...validateAnimations(attachment.clips, boneNames, `attach:${attachment.id}`))
	return { ok: errors.length === 0, errors: [...new Set(errors)], warnings: [] }
}

/** Validate a character document against its rig and attachments. */
export function validateCharacter(character, { rig, attachments = new Map() }) {
	const errors = []
	if (!isObject(character)) return { ok: false, errors: [ERRORS.SCHEMA], warnings: [] }
	if (typeof character.id !== 'string' || !ID.test(character.id)) errors.push(ERRORS.ID)
	if (!isObject(rig)) errors.push(ERRORS.SCHEMA)
	if (!isObject(character.presets) || Object.keys(character.presets).length === 0) errors.push(ERRORS.PRESET)

	const rigBoneNames = new Set(isObject(rig) && isObject(rig.skeleton) ? rig.skeleton.bones.map((bone) => bone.name) : [])
	const presets = isObject(character.presets) ? character.presets : {}
	for (const [presetName, preset] of Object.entries(presets)) {
		if (!isObject(preset) || !Array.isArray(preset.attachments)) {
			errors.push(`${ERRORS.PRESET}:${presetName}`)
			continue
		}
		const groups = new Map()
		const selected = new Set()
		for (const choice of preset.attachments) {
			const id = isObject(choice) ? choice.attachment : choice
			if (typeof id !== 'string' || !attachments.has(id)) {
				errors.push(`${ERRORS.PRESET_ATTACHMENT}:${id}`)
				continue
			}
			const attachment = attachments.get(id)
			selected.add(id)
			const group = attachment.group
			if (typeof group === 'string') {
				if (groups.has(group) && groups.get(group) !== id) errors.push(`${ERRORS.PRESET_GROUP}:${group}`)
				groups.set(group, id)
			}
		}
		// An attachment attached to another attachment needs its parent present.
		for (const id of selected) {
			const target = attachments.get(id).attach
			if (typeof target === 'string' && attachments.has(target) && !selected.has(target)) {
				errors.push(`${ERRORS.PRESET_ATTACHMENT}:${target}`)
			}
		}
	}

	if (character.views !== undefined) {
		if (!isObject(character.views)) errors.push(ERRORS.VIEW)
		else for (const [viewName, view] of Object.entries(character.views)) {
			if (!isObject(view)) {
				errors.push(`${ERRORS.VIEW}:${viewName}`)
				continue
			}
			if (view.preset !== undefined && !Object.prototype.hasOwnProperty.call(presets, view.preset)) {
				errors.push(`${ERRORS.VIEW}:${viewName}`)
			}
			if (view.clips !== undefined && !isObject(view.clips)) errors.push(`${ERRORS.VIEW}:${viewName}`)
		}
	}

	for (const [id, attachment] of attachments) {
		const target = attachment.attach
		if (typeof target !== 'string') continue
		if (!rigBoneNames.has(target) && !attachments.has(target)) errors.push(`${ERRORS.ATTACHMENT_ATTACH}:${id}`)
	}

	return { ok: errors.length === 0, errors: [...new Set(errors)], warnings: [] }
}

/** Layer bands, in draw order. */
export const LAYER_INDEX = { back: 0, body: 1, over: 2, front: 3 }

/**
 * The one draw order: layer band, then z, then name.
 *
 * Never insertion order — that changes with preset load order, and a rendering
 * difference that depends on load order is a bug, not a preference.
 */
export function compareSlots(a, b) {
	const bandA = LAYER_INDEX[a.layer] ?? 1
	const bandB = LAYER_INDEX[b.layer] ?? 1
	if (bandA !== bandB) return bandA - bandB
	const zA = isFiniteNumber(a.order) ? a.order : 0
	const zB = isFiniteNumber(b.order) ? b.order : 0
	if (zA !== zB) return zA - zB
	return String(a.name).localeCompare(String(b.name))
}

/** Sort slots into the canonical draw order. */
export function sortSlots(slots) {
	return [...slots].sort(compareSlots)
}
