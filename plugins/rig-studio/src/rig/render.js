/**
 * Drawing a solved look.
 *
 * The renderer talks to a *narrow* API — `setTransform`, `drawImage`, `fillRect`,
 * a few state properties — which is what lets a recorder stand in for a canvas in
 * tests. Ordering and transforms are the two things that go wrong in a rig
 * renderer, and both are assertable against recorded calls without a DOM.
 *
 * Coordinates are the rig's: y-down, one unit per pixel. The world matrix of a
 * slot is applied as-is; the artwork is drawn so its pivot lands on the slot's
 * origin, which is the whole point of a pivot.
 */

/** A context that records calls instead of drawing; the test double for a canvas. */
export function createRecorder() {
	const calls = []
	const state = {
		transform: [1, 0, 0, 1, 0, 0],
		fillStyle: '#000',
		globalAlpha: 1,
		globalCompositeOperation: 'source-over',
	}
	const ctx = {
		calls,
		setTransform(a, b, c, d, e, f) {
			state.transform = [a, b, c, d, e, f]
			calls.push({ type: 'setTransform', value: [a, b, c, d, e, f] })
		},
		drawImage(image, dx, dy, width, height) {
			calls.push({ type: 'drawImage', image: image.url ?? image, dx, dy, width, height, transform: state.transform })
		},
		fillRect(x, y, w, h) {
			calls.push({ type: 'fillRect', x, y, w, h, fill: state.fillStyle, transform: state.transform })
		},
		beginPath() {
			calls.push({ type: 'beginPath' })
		},
		arc(x, y, radius, from, to) {
			calls.push({ type: 'arc', x, y, radius, from, to, transform: state.transform })
		},
		stroke() {
			calls.push({ type: 'stroke' })
		},
		save() {
			calls.push({ type: 'save' })
		},
		restore() {
			calls.push({ type: 'restore' })
		},
		get fillStyle() {
			return state.fillStyle
		},
		set fillStyle(value) {
			state.fillStyle = value
		},
		get globalAlpha() {
			return state.globalAlpha
		},
		set globalAlpha(value) {
			state.globalAlpha = value
		},
		get globalCompositeOperation() {
			return state.globalCompositeOperation
		},
		set globalCompositeOperation(value) {
			state.globalCompositeOperation = value
		},
	}
	return ctx
}

/** The image size a slot's artwork needs, if it is known. */
export function artSize(art, images) {
	if (art === undefined || art === null) return null
	if (typeof art.image === 'string' && images[art.image] !== undefined) {
		const image = images[art.image]
		return [image.width ?? image.naturalWidth ?? 0, image.height ?? image.naturalHeight ?? 0]
	}
	if (Array.isArray(art.bounds)) return [art.bounds[2], art.bounds[3]]
	return null
}

/**
 * Draw a solved look.
 *
 * @param ctx - a canvas 2d context, or `createRecorder()`.
 * @param solved - the output of `solvePose`.
 * @param options.images - map of image url → image (anything `drawImage` accepts).
 * @param options.onMissing - called with the url when art has no loaded image.
 * @returns `{ drawn, missing }` counts, so a caller can tell "nothing loaded yet"
 * from "the rig is empty".
 */
export function drawLook(ctx, solved, { images = {}, onMissing } = {}) {
	let drawn = 0
	let missing = 0

	for (const entry of solved.slots) {
		const art = entry.slot.art ?? {}
		const image = typeof art.image === 'string' ? images[art.image] : undefined
		const pivot = Array.isArray(art.pivot) ? art.pivot : [0, 0]

		ctx.setTransform(...entry.world)

		if (image !== undefined && image !== null) {
			ctx.drawImage(image, -pivot[0], -pivot[1], image.width ?? image.naturalWidth, image.height ?? image.naturalHeight)
			drawn++
			if (Array.isArray(art.tint) || typeof art.tint === 'string') {
				// A tint is a colour laid over the drawing and clipped to it. Cheap,
				// and it means five boot colours cost one drawing.
				ctx.globalCompositeOperation = 'source-atop'
				ctx.fillStyle = tintStyle(art.tint)
				const size = artSize(art, images) ?? [0, 0]
				ctx.fillRect(-pivot[0], -pivot[1], size[0], size[1])
				ctx.globalCompositeOperation = 'source-over'
			}
			continue
		}

		if (art.shape !== undefined && art.shape !== null) {
			const shape = art.shape
			ctx.fillStyle = shape.fill ?? '#888'
			if (shape.type === 'ellipse') {
				ctx.beginPath()
				ctx.arc(0, 0, (shape.width ?? 10) / 2, 0, Math.PI * 2)
				ctx.fill()
			} else {
				ctx.fillRect(-(shape.width ?? 10) / 2, -(shape.height ?? 10) / 2, shape.width ?? 10, shape.height ?? 10)
			}
			drawn++
			continue
		}

		missing++
		if (typeof art.image === 'string' && typeof onMissing === 'function') onMissing(art.image)
	}

	return { drawn, missing }
}

/** A tint may be an array of hue/saturation/lightness shifts or a CSS colour. */
export function tintStyle(tint) {
	if (typeof tint === 'string') return tint
	const [hue, saturation, lightness] = Array.isArray(tint) ? tint : [0, 0, 0]
	return `hsl(${hue} ${Math.round(Math.min(1, Math.max(0, saturation)) * 100)}% ${Math.round(Math.min(1, Math.max(0.2, 0.5 + lightness * 0.2))) * 100}%)`
}
