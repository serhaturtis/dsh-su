/**
 * A demo rig built from shapes, so the renderer and the editor can be exercised
 * before any artwork exists.
 *
 * This is not a placeholder to be thrown away: it is the fixture the editor
 * boots into, and every renderer feature has to work on it. Shapes carry the
 * same bounds/pivot contract as images, which is what keeps it honest.
 */

/** A limb rectangle hanging from its joint: the pivot is the shoulder or hip. */
function limb(width, length, fill, extra = {}) {
	// The bounds pad past both ends by half the width plus the overlap, because
	// a limb's art has to reach *past* its child joint, not merely to it.
	const pad = width / 2 + 12
	return {
		shape: { type: 'rect', width, height: length, fill, offset: [0, length / 2] },
		pivot: [0, 0],
		bounds: [-width / 2, -pad, width, length + pad * 2],
		...extra,
	}
}

function joint(fill, radius) {
	return {
		shape: { type: 'ellipse', width: radius * 2, height: radius * 2, fill },
		pivot: [0, 0],
		bounds: [-radius, -radius, radius * 2, radius * 2],
	}
}

/** Bones and limits for a small humanoid; deliberately wrong-proof, not pretty. */
const BONES = [
	{ name: 'root', parent: null, x: 200, y: 640 },
	{ name: 'hip', parent: 'root', x: 0, y: -160, role: 'hip', limit: { rotation: [-8, 8] } },
	{ name: 'spine', parent: 'hip', x: 0, y: -8, role: 'spine', limit: { rotation: [-12, 12] } },
	{ name: 'chest', parent: 'spine', x: 0, y: -70, role: 'spine.chest', limit: { rotation: [-8, 8] } },
	{ name: 'head', parent: 'chest', x: 0, y: -60, role: 'head', limit: { rotation: [-20, 20] } },
	{ name: 'thigh_l', parent: 'hip', x: -26, y: 0, role: 'leg.upper', limit: { rotation: [-110, 40] } },
	{ name: 'shin_l', parent: 'thigh_l', x: 0, y: 95, role: 'leg.lower', limit: { rotation: [-5, 125] } },
	{ name: 'foot_l', parent: 'shin_l', x: 0, y: 90, role: 'leg.foot', limit: { rotation: [-25, 25] } },
	{ name: 'thigh_r', parent: 'hip', x: 26, y: 0, role: 'leg.upper', limit: { rotation: [-110, 40] } },
	{ name: 'shin_r', parent: 'thigh_r', x: 0, y: 95, role: 'leg.lower', limit: { rotation: [-5, 125] } },
	{ name: 'foot_r', parent: 'shin_r', x: 0, y: 90, role: 'leg.foot', limit: { rotation: [-25, 25] } },
	{ name: 'upperarm_l', parent: 'chest', x: -40, y: -16, role: 'arm.upper', limit: { rotation: [-150, 30] } },
	{ name: 'forearm_l', parent: 'upperarm_l', x: 0, y: 78, role: 'arm.lower', limit: { rotation: [-5, 135] } },
	{ name: 'upperarm_r', parent: 'chest', x: 40, y: -16, role: 'arm.upper', limit: { rotation: [-30, 150] } },
	{ name: 'forearm_r', parent: 'upperarm_r', x: 0, y: 78, role: 'arm.lower', limit: { rotation: [-5, 135] } },
]

const SLOTS = [
	{ name: 'thigh_l', bone: 'thigh_l', layer: 'body', order: 10 },
	{ name: 'shin_l', bone: 'shin_l', layer: 'body', order: 11 },
	{ name: 'foot_l', bone: 'foot_l', layer: 'body', order: 12 },
	{ name: 'thigh_r', bone: 'thigh_r', layer: 'body', order: 10 },
	{ name: 'shin_r', bone: 'shin_r', layer: 'body', order: 11 },
	{ name: 'foot_r', bone: 'foot_r', layer: 'body', order: 12 },
	{ name: 'hip', bone: 'hip', layer: 'body', order: 20 },
	{ name: 'spine', bone: 'spine', layer: 'body', order: 21 },
	{ name: 'chest', bone: 'chest', layer: 'body', order: 22 },
	{ name: 'upperarm_l', bone: 'upperarm_l', layer: 'body', order: 23 },
	{ name: 'forearm_l', bone: 'forearm_l', layer: 'body', order: 24 },
	{ name: 'upperarm_r', bone: 'upperarm_r', layer: 'body', order: 23 },
	{ name: 'forearm_r', bone: 'forearm_r', layer: 'body', order: 24 },
	{ name: 'head', bone: 'head', layer: 'body', order: 30 },
]

const SKIN = {
	thigh_l: limb(30, 100, '#5b6b8c'),
	shin_l: limb(26, 95, '#6b7c9e'),
	foot_l: limb(30, 26, '#3a4356'),
	thigh_r: limb(30, 100, '#5b6b8c'),
	shin_r: limb(26, 95, '#6b7c9e'),
	foot_r: limb(30, 26, '#3a4356'),
	hip: { shape: { type: 'rect', width: 72, height: 34, fill: '#4a5670' }, bounds: [-48, -20, 96, 44] },
	spine: { shape: { type: 'rect', width: 52, height: 70, fill: '#53617f' }, bounds: [-26, -35, 52, 70] },
	chest: { shape: { type: 'rect', width: 84, height: 64, fill: '#5b6b8c' }, bounds: [-60, -40, 120, 80] },
	upperarm_l: limb(24, 78, '#6b7c9e'),
	forearm_l: limb(28, 80, '#6b7c9e'),
	upperarm_r: limb(24, 78, '#6b7c9e'),
	forearm_r: limb(28, 80, '#6b7c9e'),
	head: joint('#e8d8c8', 30),
}

export function createDemoRig() {
	return {
		schema: 1,
		id: 'demo-humanoid',
		name: 'Demo Humanoid',
		canvas: { width: 400, height: 720 },
		skeleton: { bones: structuredClone(BONES) },
		slots: structuredClone(SLOTS),
		joints: ['thigh_l', 'shin_l', 'foot_l', 'thigh_r', 'shin_r', 'foot_r', 'forearm_l', 'forearm_r'].map((bone) => ({ bone })),
		bodyVariants: { default: structuredClone(SKIN) },
		ik: [{ chain: ['thigh_l', 'shin_l'], target: 'foot_l', bend: -1 }],
		animations: {
			idle: {
				duration: 2600,
				loop: true,
				tracks: [
					{ bone: 'chest', property: 'rotation', keys: [{ t: 0, v: 0, ease: 'smooth' }, { t: 1300, v: 2.4 }, { t: 2600, v: 0 }] },
					{ bone: 'head', property: 'rotation', keys: [{ t: 0, v: 0, ease: 'smooth' }, { t: 1300, v: -1.6 }, { t: 2600, v: 0 }] },
					{ bone: 'spine', property: 'rotation', keys: [{ t: 0, v: 0, ease: 'smooth' }, { t: 1300, v: 1.2 }, { t: 2600, v: 0 }] },
				],
			},
			wave: {
				duration: 1600,
				loop: false,
				tracks: [
					{ bone: 'upperarm_r', property: 'rotation', keys: [{ t: 0, v: 0, ease: 'smooth' }, { t: 300, v: 130 }, { t: 1200, v: 130 }, { t: 1600, v: 0 }] },
					{ bone: 'forearm_r', property: 'rotation', keys: [{ t: 0, v: 0, ease: 'smooth' }, { t: 300, v: -40 }, { t: 700, v: 20 }, { t: 1100, v: -40 }, { t: 1600, v: 0 }] },
				],
			},
			squat: {
				duration: 2000,
				loop: false,
				tracks: [
					{ bone: 'hip', property: 'y', keys: [{ t: 0, v: -160, ease: 'smooth' }, { t: 900, v: -110 }, { t: 1400, v: -110 }, { t: 2000, v: -160 }] },
					{ bone: 'thigh_l', property: 'rotation', keys: [{ t: 0, v: 0, ease: 'smooth' }, { t: 900, v: -70 }, { t: 1400, v: -70 }, { t: 2000, v: 0 }] },
					{ bone: 'shin_l', property: 'rotation', keys: [{ t: 0, v: 0, ease: 'smooth' }, { t: 900, v: 90 }, { t: 1400, v: 90 }, { t: 2000, v: 0 }] },
					{ bone: 'thigh_r', property: 'rotation', keys: [{ t: 0, v: 0, ease: 'smooth' }, { t: 900, v: -70 }, { t: 1400, v: -70 }, { t: 2000, v: 0 }] },
					{ bone: 'shin_r', property: 'rotation', keys: [{ t: 0, v: 0, ease: 'smooth' }, { t: 900, v: 90 }, { t: 1400, v: 90 }, { t: 2000, v: 0 }] },
				],
			},
		},
	}
}
