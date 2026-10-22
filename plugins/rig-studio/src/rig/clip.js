/**
 * Clip sampling: keyframes in, a per-bone pose out.
 *
 * Two rules that the rest of the runtime depends on:
 *
 * - a keyframe's `ease` governs the segment that *starts* at it, so a curve is
 *   read left to right and there is no ambiguity about which key owns it;
 * - a looping clip wraps on its duration, and sampling exactly at the duration
 *   yields the first frame — that is what makes a loop seamless when the keys
 *   agree, and what `loop-seam` lint checks.
 */

import { clamp, radians } from './math.js'

const EPSILON = 1e-6

/** Cubic bezier easing, solved for y given x by bisection. */
function cubicBezier(points, t) {
	const [x1, y1, x2, y2] = points
	const bezier = (a, b, time) => {
		const inverse = 1 - time
		return 3 * inverse * inverse * time * a + 3 * inverse * time * time * b + time * time * time
	}
	let low = 0
	let high = 1
	let parameter = t
	// 20 iterations is far below a pixel of visible error and needs no tables.
	for (let i = 0; i < 20; i++) {
		const x = bezier(x1, x2, parameter)
		if (Math.abs(x - t) < 1e-4) break
		if (x < t) low = parameter
		else high = parameter
		parameter = (low + high) / 2
	}
	return bezier(y1, y2, parameter)
}

/** Map a segment's normalised time through its easing. */
export function ease(value, t) {
	if (Array.isArray(value)) return cubicBezier(value, t)
	if (value === 'step') return t < 1 ? 0 : 1
	if (value === 'smooth') return t * t * (3 - 2 * t)
	return t
}

/** Sample one track at a time in milliseconds. */
export function sampleTrack(track, timeMs) {
	const keys = track.keys
	if (keys.length === 1) return keys[0].v
	if (timeMs <= keys[0].t) return keys[0].v
	const last = keys[keys.length - 1]
	if (timeMs >= last.t) return last.v

	let index = 0
	while (index < keys.length - 1 && keys[index + 1].t <= timeMs) index++
	const from = keys[index]
	const to = keys[index + 1]
	const span = to.t - from.t
	const local = span <= EPSILON ? 1 : (timeMs - from.t) / span
	const eased = ease(from.ease, clamp(local, 0, 1))
	return from.v + (to.v - from.v) * eased
}

/**
 * Sample a compiled clip at a time.
 *
 * @returns `{ [boneId]: { property: value } }` — only the properties the clip
 * touches, so unspecified bones keep their rest or previous pose.
 */
export function sampleClip(clip, timeMs) {
	const wrapped = clip.loop === true ? ((timeMs % clip.duration) + clip.duration) % clip.duration : clamp(timeMs, 0, clip.duration)
	const pose = {}
	for (const track of clip.tracks) {
		const value = sampleTrack(track, wrapped)
		pose[track.boneId] = pose[track.boneId] ?? {}
		pose[track.boneId][track.property] = value
	}
	return pose
}

/** Normalise a track value to its base units: degrees are handled by the caller. */
export function toRadians(property, value) {
	return property === 'rotation' ? radians(value) : value
}

/**
 * Markers and events inside a time step.
 *
 * Markers fire every pass (a footfall); events fire once (a landing sound).
 * Both are returned as `{ t, name }` in the step's own coordinates, so a caller
 * stepping 0→16 ms does not see a marker at 400 ms twice.
 */
export function cuesBetween(clip, fromMs, toMs) {
	const collect = (list) => {
		const out = []
		if (!Array.isArray(list) || list.length === 0) return out
		if (clip.loop !== true) {
			for (const cue of list) if (cue.t > fromMs && cue.t <= toMs) out.push(cue)
			return out
		}
		const duration = clip.duration
		// Walk whole passes, so a long step and many short steps agree.
		const firstPass = Math.floor(fromMs / duration)
		const lastPass = Math.floor(toMs / duration)
		for (let pass = firstPass; pass <= lastPass; pass++) {
			const offset = pass * duration
			for (const cue of list) {
				const at = offset + cue.t
				if (at > fromMs && at <= toMs) out.push({ t: at, name: cue.name })
			}
		}
		return out
	}
	return { markers: collect(clip.markers), events: collect(clip.events) }
}

/**
 * The largest pose difference between a looping clip's first and last frame.
 *
 * A clip whose endpoints disagree pops at the wrap; `loop-seam` lint uses this
 * so the pop is found by a test rather than by a user.
 */
export function loopSeam(clip) {
	if (clip.loop !== true) return 0
	let worst = 0
	for (const track of clip.tracks) {
		const first = track.keys[0]
		const last = track.keys[track.keys.length - 1]
		const delta = Math.abs(last.v - first.v)
		// rotation is in degrees here; the others are pixels or scale factors
		if (delta > worst) worst = delta
	}
	return worst
}
