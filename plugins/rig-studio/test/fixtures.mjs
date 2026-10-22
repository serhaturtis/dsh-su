/**
 * Test fixtures: one humanoid rig that passes lint, plus attachments that trip
 * exactly one rule at a time.
 *
 * The geometry is deliberately simple and hand-checked: every joint pivot sits
 * inside both neighbouring parts by more than the 12 px overlap Lint requires,
 * so a test that expects a clean bill of health is testing the lint, not luck.
 */

/** Bones: root, hip, spine, chest, head, two legs, two arms. */
const BONES = [
	{ name: 'root', parent: null, x: 200, y: 560 },
	{ name: 'hip', parent: 'root', x: 0, y: -100, role: 'hip' },
	{ name: 'spine', parent: 'hip', x: 0, y: -10, role: 'spine', limit: { rotation: [-15, 15] } },
	{ name: 'chest', parent: 'spine', x: 0, y: -60, role: 'spine.chest', limit: { rotation: [-10, 10] } },
	{ name: 'head', parent: 'chest', x: 0, y: -60, role: 'head' },
	{ name: 'thigh_l', parent: 'hip', x: -30, y: 0, role: 'leg.upper', limit: { rotation: [-120, 45] } },
	{ name: 'shin_l', parent: 'thigh_l', x: 0, y: 90, role: 'leg.lower', limit: { rotation: [-5, 130] } },
	{ name: 'foot_l', parent: 'shin_l', x: 0, y: 80, role: 'leg.foot', limit: { rotation: [-30, 30] } },
	{ name: 'thigh_r', parent: 'hip', x: 30, y: 0, role: 'leg.upper', limit: { rotation: [-120, 45] } },
	{ name: 'shin_r', parent: 'thigh_r', x: 0, y: 90, role: 'leg.lower', limit: { rotation: [-5, 130] } },
	{ name: 'foot_r', parent: 'shin_r', x: 0, y: 80, role: 'leg.foot', limit: { rotation: [-30, 30] } },
	{ name: 'upperarm_l', parent: 'chest', x: -40, y: -20, role: 'arm.upper', limit: { rotation: [-160, 20] } },
	{ name: 'forearm_l', parent: 'upperarm_l', x: 0, y: 70, role: 'arm.lower', limit: { rotation: [-5, 140] } },
	{ name: 'hand_l', parent: 'forearm_l', x: 0, y: 70, role: 'hand' },
	{ name: 'upperarm_r', parent: 'chest', x: 40, y: -20, role: 'arm.upper', limit: { rotation: [-20, 160] } },
	{ name: 'forearm_r', parent: 'upperarm_r', x: 0, y: 70, role: 'arm.lower', limit: { rotation: [-5, 140] } },
	{ name: 'hand_r', parent: 'forearm_r', x: 0, y: 70, role: 'hand' },
]

/** Body parts, with bounds around each pivot (pivot at 0,0 in the part). */
const BODY = {
	hip: { image: 'parts/hip.png', pivot: [0, 0], bounds: [-60, -40, 120, 80] },
	spine: { image: 'parts/spine.png', pivot: [0, 0], bounds: [-45, -35, 90, 80] },
	chest: { image: 'parts/chest.png', pivot: [0, 0], bounds: [-60, -50, 120, 90] },
	head: { image: 'parts/head.png', pivot: [0, 0], bounds: [-45, -60, 90, 90] },
	thigh_l: { image: 'parts/thigh_l.png', pivot: [0, 0], bounds: [-30, -15, 60, 125] },
	shin_l: { image: 'parts/shin_l.png', pivot: [0, 0], bounds: [-28, -18, 56, 118] },
	foot_l: { image: 'parts/foot_l.png', pivot: [0, 0], bounds: [-25, -12, 50, 45] },
	thigh_r: { image: 'parts/thigh_r.png', pivot: [0, 0], bounds: [-30, -15, 60, 125] },
	shin_r: { image: 'parts/shin_r.png', pivot: [0, 0], bounds: [-28, -18, 56, 118] },
	foot_r: { image: 'parts/foot_r.png', pivot: [0, 0], bounds: [-25, -12, 50, 45] },
	upperarm_l: { image: 'parts/upperarm_l.png', pivot: [0, 0], bounds: [-25, -15, 50, 100] },
	forearm_l: { image: 'parts/forearm_l.png', pivot: [0, 0], bounds: [-22, -12, 44, 95] },
	hand_l: { image: 'parts/hand_l.png', pivot: [0, 0], bounds: [-20, -10, 40, 45] },
	upperarm_r: { image: 'parts/upperarm_r.png', pivot: [0, 0], bounds: [-25, -15, 50, 100] },
	forearm_r: { image: 'parts/forearm_r.png', pivot: [0, 0], bounds: [-22, -12, 44, 95] },
	hand_r: { image: 'parts/hand_r.png', pivot: [0, 0], bounds: [-20, -10, 40, 45] },
}

const SLOTS = [
	{ name: 'hip', bone: 'hip', layer: 'body', order: 10 },
	{ name: 'thigh_l', bone: 'thigh_l', layer: 'body', order: 20 },
	{ name: 'shin_l', bone: 'shin_l', layer: 'body', order: 21 },
	{ name: 'foot_l', bone: 'foot_l', layer: 'body', order: 22 },
	{ name: 'thigh_r', bone: 'thigh_r', layer: 'body', order: 20 },
	{ name: 'shin_r', bone: 'shin_r', layer: 'body', order: 21 },
	{ name: 'foot_r', bone: 'foot_r', layer: 'body', order: 22 },
	{ name: 'spine', bone: 'spine', layer: 'body', order: 30 },
	{ name: 'chest', bone: 'chest', layer: 'body', order: 31 },
	{ name: 'upperarm_l', bone: 'upperarm_l', layer: 'body', order: 32 },
	{ name: 'forearm_l', bone: 'forearm_l', layer: 'body', order: 33 },
	{ name: 'hand_l', bone: 'hand_l', layer: 'body', order: 34 },
	{ name: 'upperarm_r', bone: 'upperarm_r', layer: 'body', order: 32 },
	{ name: 'forearm_r', bone: 'forearm_r', layer: 'body', order: 33 },
	{ name: 'hand_r', bone: 'hand_r', layer: 'body', order: 34 },
	{ name: 'head', bone: 'head', layer: 'body', order: 40 },
]

const JOINTS = [
	{ bone: 'thigh_l' },
	{ bone: 'shin_l' },
	{ bone: 'foot_l' },
	{ bone: 'thigh_r' },
	{ bone: 'shin_r' },
	{ bone: 'foot_r' },
	{ bone: 'forearm_l' },
	{ bone: 'forearm_r' },
]

/** A rig whose joints are all covered and whose limb bones all have limits. */
export function humanoidRig() {
	return {
		schema: 1,
		id: 'test-humanoid',
		name: 'Test Humanoid',
		canvas: { width: 400, height: 720 },
		skeleton: { bones: structuredClone(BONES) },
		slots: structuredClone(SLOTS),
		joints: structuredClone(JOINTS),
		bodyVariants: { default: structuredClone(BODY) },
		animations: {
			idle: {
				duration: 2000,
				loop: true,
				tracks: [
					{ bone: 'chest', property: 'rotation', keys: [{ t: 0, v: 0 }, { t: 1000, v: 2 }, { t: 2000, v: 0 }] },
				],
			},
			squat: {
				duration: 1000,
				loop: false,
				tracks: [
					{ bone: 'thigh_l', property: 'rotation', keys: [{ t: 0, v: 0 }, { t: 500, v: -50 }, { t: 1000, v: 0 }] },
					{ bone: 'shin_l', property: 'rotation', keys: [{ t: 0, v: 0 }, { t: 500, v: 80 }, { t: 1000, v: 0 }] },
				],
			},
		},
	}
}

/** A garment that spans the knee as one rigid piece: the unsplit failure. */
export function unsplitTrouser() {
	return {
		id: 'trouser_l',
		kind: 'garment',
		group: 'bottom',
		layer: 'over',
		order: 20,
		attach: 'thigh_l',
		bones: [{ name: 'cloth', parent: null, x: 0, y: 0 }],
		slots: [{ name: 'cloth', bone: 'cloth', layer: 'over', order: 20 }],
		variants: { default: { cloth: { image: 'parts/trouser_l.png', pivot: [0, 0], bounds: [-35, -20, 70, 140] } } },
	}
}

/** A clean knee-length garment that stops above the joint. */
export function splitTrouser() {
	return {
		id: 'trouser_l_upper',
		kind: 'garment',
		group: 'bottom',
		layer: 'over',
		order: 20,
		attach: 'thigh_l',
		bones: [{ name: 'cloth', parent: null, x: 0, y: 0 }],
		slots: [{ name: 'cloth', bone: 'cloth', layer: 'over', order: 20 }],
		variants: { default: { cloth: { image: 'parts/trouser_l.png', pivot: [0, 0], bounds: [-32, -18, 64, 96] } } },
	}
}

/** A skirt that covers the hips and upper thighs. */
export function skirt() {
	return {
		id: 'skirt',
		kind: 'garment',
		group: 'bottom',
		layer: 'over',
		order: 10,
		attach: 'hip',
		bones: [{ name: 'cloth', parent: null, x: 0, y: 0 }],
		slots: [{ name: 'cloth', bone: 'cloth', layer: 'over', order: 10 }],
		variants: { default: { cloth: { image: 'parts/skirt.png', pivot: [0, 0], bounds: [-80, -20, 160, 110] } } },
		occludes: ['hip', 'thigh_l', 'thigh_r'],
	}
}

/** A hair attachment with a tint variant, for colourway tests. */
export function hair() {
	return {
		id: 'hair',
		kind: 'hair',
		group: 'hair',
		layer: 'front',
		order: 10,
		attach: 'head',
		bones: [{ name: 'swing', parent: null, x: 0, y: 20 }],
		slots: [{ name: 'hair', bone: 'swing', layer: 'front', order: 10 }],
		springs: [{ bone: 'swing', stiffness: 0.3, damping: 0.6 }],
		variants: {
			default: { hair: { image: 'parts/hair.png', pivot: [0, 0], bounds: [-50, -40, 100, 120] } },
			red: { hair: { tint: [0, 0.4, 1.1] } },
		},
		clips: {
			sway: { duration: 1200, loop: true, tracks: [{ bone: 'swing', property: 'rotation', keys: [{ t: 0, v: 0 }, { t: 600, v: 4 }, { t: 1200, v: 0 }] }] },
		},
	}
}

/** A preset selecting nothing but the body. */
export function bodyOnlyPreset() {
	return { bodyVariant: 'default', attachments: [] }
}
