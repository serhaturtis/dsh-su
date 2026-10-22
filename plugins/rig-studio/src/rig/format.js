/**
 * The rig format: bones, slots, skins, animations.
 *
 * A rig is a skeleton plus a set of drawings hung off it. Bones carry no art;
 * slots do. Skins swap which drawing a slot uses, which is how one skeleton
 * wears many outfits. Animations move bones, never artwork, so a walk cycle is
 * authored once and works for every skin on that skeleton.
 *
 * The same schema describes a human, a dog, a bird or something invented: a
 * bone is just a name, a parent, and a transform. Nothing in this file knows
 * what a biped is.
 */

/** Bumped only for breaking changes. A rig declares the version it was made for. */
export const SCHEMA = 1

export const LIMITS = {
	bones: 128,
	slots: 256,
	skins: 32,
	animations: 64,
	tracks: 256,
	keys: 64,
	durationMs: 60_000,
	canvasSide: 4096,
	nameLength: 48,
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,47}$/

export const ERRORS = {
	SCHEMA: 'schema-unsupported',
	ID: 'id-invalid',
	NAME: 'name-invalid',
	BONES: 'bones-invalid',
	BONE_LIST: 'bone-list-empty',
	BONE_NAME: 'bone-name-invalid',
	BONE_DUPLICATE: 'bone-duplicate',
	BONE_PARENT: 'bone-parent-missing',
	BONE_CYCLE: 'bone-cycle',
	SLOTS: 'slots-invalid',
	SLOT_BONE: 'slot-bone-missing',
	SKINS: 'skins-invalid',
	SKIN_ATTACHMENT: 'skin-attachment-unknown-slot',
	ART: 'attachment-art-missing',
	ANIMATIONS: 'animations-invalid',
	TRACK_BONE: 'track-bone-missing',
	TRACK_KEYS: 'track-keys-invalid',
	DURATION: 'duration-invalid',
	CANVAS: 'canvas-invalid',
	DIRECTIONS: 'directions-invalid',
	TOO_MANY: 'too-many',
}

function validName(value) {
	return typeof value === 'string' && NAME.test(value)
}

function finite(value, fallback = 0) {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Validate a rig document.
 *
 * Checks structure, not taste: it cannot tell a good walk from a bad one, but it
 * can refuse a cycle in the skeleton, a slot pointing at a bone that does not
 * exist, or a keyframe out of order.
 *
 * @returns `{ ok, errors: string[], warnings: string[] }`.
 */
export function validateRig(rig) {
	const errors = []
	const warnings = []
	if (rig === null || typeof rig !== 'object' || Array.isArray(rig)) {
		return { ok: false, errors: [ERRORS.SCHEMA], warnings }
	}
	if (rig.schema !== SCHEMA) errors.push(ERRORS.SCHEMA)
	if (!validName(rig.id)) errors.push(ERRORS.ID)
	if (!validName(rig.name)) errors.push(ERRORS.NAME)

	const canvas = rig.canvas
	if (canvas === null || typeof canvas !== 'object') errors.push(ERRORS.CANVAS)
	else {
		const width = finite(canvas.width, -1)
		const height = finite(canvas.height, -1)
		if (width <= 0 || height <= 0 || width > LIMITS.canvasSide || height > LIMITS.canvasSide) errors.push(ERRORS.CANVAS)
	}

	// --- skeleton
	const bones = rig.skeleton === null || typeof rig.skeleton !== 'object' ? null : rig.skeleton.bones
	const byName = new Map()
	if (!Array.isArray(bones) || bones.length === 0) errors.push(ERRORS.BONE_LIST)
	else if (bones.length > LIMITS.bones) errors.push(ERRORS.TOO_MANY)
	else {
		for (const bone of bones) {
			if (bone === null || typeof bone !== 'object' || !validName(bone.name)) {
				errors.push(ERRORS.BONE_NAME)
				continue
			}
			if (byName.has(bone.name)) errors.push(ERRORS.BONE_DUPLICATE)
			byName.set(bone.name, bone)
		}
		// A parent must exist, and following parents must terminate.
		for (const bone of bones) {
			if (!byName.has(bone.name)) continue
			const parent = bone.parent
			if (parent !== null && parent !== undefined && !byName.has(parent)) errors.push(ERRORS.BONE_PARENT)
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

	// --- slots
	const slots = Array.isArray(rig.slots) ? rig.slots : null
	const slotNames = new Set()
	if (slots === null) errors.push(ERRORS.SLOTS)
	else if (slots.length > LIMITS.slots) errors.push(ERRORS.TOO_MANY)
	else {
		for (const slot of slots) {
			if (slot === null || typeof slot !== 'object' || typeof slot.name !== 'string' || !validName(slot.name)) {
				errors.push(ERRORS.SLOTS)
				continue
			}
			if (slotNames.has(slot.name)) errors.push(ERRORS.SLOTS)
			slotNames.add(slot.name)
			if (!byName.has(slot.bone)) errors.push(ERRORS.SLOT_BONE)
		}
	}

	// --- skins: a skin maps slot name -> attachment
	const skins = rig.skins
	if (skins === null || typeof skins !== 'object' || Array.isArray(skins)) errors.push(ERRORS.SKINS)
	else {
		const names = Object.keys(skins)
		if (names.length > LIMITS.skins) errors.push(ERRORS.TOO_MANY)
		for (const skinName of names) {
			const attachments = skins[skinName]
			if (attachments === null || typeof attachments !== 'object' || Array.isArray(attachments)) {
				errors.push(ERRORS.SKINS)
				continue
			}
			for (const slotName of Object.keys(attachments)) {
				if (!slotNames.has(slotName)) errors.push(ERRORS.SKIN_ATTACHMENT)
				const art = attachments[slotName]
				if (art === null || typeof art !== 'object') {
					errors.push(ERRORS.ART)
					continue
				}
				// Either a bitmap or a procedural shape. A shape keeps a rig
				// usable before any art exists, which is how the engine is tested.
				const hasImage = typeof art.image === 'string' && art.image.length > 0
				const hasShape = art.shape !== null && typeof art.shape === 'object'
				if (!hasImage && !hasShape) errors.push(ERRORS.ART)
			}
		}
	}

	// --- animations
	const animations = rig.animations
	if (animations !== null && typeof animations === 'object') {
		const names = Object.keys(animations)
		if (names.length > LIMITS.animations) errors.push(ERRORS.TOO_MANY)
		for (const clipName of names) {
			const clip = animations[clipName]
			if (clip === null || typeof clip !== 'object') {
				errors.push(ERRORS.ANIMATIONS)
				continue
			}
			const duration = finite(clip.duration, -1)
			if (duration <= 0 || duration > LIMITS.durationMs) errors.push(ERRORS.DURATION)
			const tracks = Array.isArray(clip.tracks) ? clip.tracks : null
			if (tracks === null) {
				errors.push(ERRORS.ANIMATIONS)
				continue
			}
			if (tracks.length > LIMITS.tracks) errors.push(ERRORS.TOO_MANY)
			for (const track of tracks) {
				if (track === null || typeof track !== 'object' || !byName.has(track.bone)) {
					errors.push(ERRORS.TRACK_BONE)
					continue
				}
				const keys = Array.isArray(track.keys) ? track.keys : null
				if (keys === null || keys.length === 0) {
					errors.push(ERRORS.TRACK_KEYS)
					continue
				}
				if (keys.length > LIMITS.keys) errors.push(ERRORS.TOO_MANY)
				let previous = -Infinity
				for (const key of keys) {
					if (key === null || typeof key !== 'object' || !Number.isFinite(key.t) || key.t < 0) {
						errors.push(ERRORS.TRACK_KEYS)
						break
					}
					if (key.t < previous) {
						errors.push(ERRORS.TRACK_KEYS)
						break
					}
					previous = key.t
				}
			}
		}
	} else if (animations !== undefined) {
		errors.push(ERRORS.ANIMATIONS)
	}

	// --- directions: named views that optionally mirror and swap a skin
	if (rig.directions !== undefined) {
		if (rig.directions === null || typeof rig.directions !== 'object' || Array.isArray(rig.directions)) {
			errors.push(ERRORS.DIRECTIONS)
		} else {
			for (const [name, view] of Object.entries(rig.directions)) {
				if (!validName(name) || view === null || typeof view !== 'object') {
					errors.push(ERRORS.DIRECTIONS)
					continue
				}
				if (view.skin !== undefined && !Object.prototype.hasOwnProperty.call(rig.skins ?? {}, view.skin)) {
					errors.push(ERRORS.SKINS)
				}
			}
		}
	}

	return { ok: errors.length === 0, errors: [...new Set(errors)], warnings }
}

/**
 * The drawing order: lowest `order` first. Ties keep document order, so a rig
 * author can control layering precisely without inventing z indexes.
 */
export function drawOrder(slots) {
	return slots
		.map((slot, index) => ({ slot, index }))
		.sort((a, b) => {
			const za = Number.isFinite(a.slot.order) ? a.slot.order : 0
			const zb = Number.isFinite(b.slot.order) ? b.slot.order : 0
			return za === zb ? a.index - b.index : za - zb
		})
		.map((entry) => entry.slot)
}

/** The skin a view uses, falling back to the rig's default. */
export function skinFor(rig, { direction, skin } = {}) {
	const view = direction !== undefined && rig.directions !== undefined ? rig.directions[direction] : undefined
	if (view !== undefined && typeof view.skin === 'string') return view.skin
	if (typeof skin === 'string' && rig.skins[skin] !== undefined) return skin
	return Object.keys(rig.skins)[0]
}

/** Whether a direction mirrors the rig horizontally. */
export function mirrorsFor(rig, direction) {
	const view = direction !== undefined && rig.directions !== undefined ? rig.directions[direction] : undefined
	return view !== undefined && view.mirror === true
}
