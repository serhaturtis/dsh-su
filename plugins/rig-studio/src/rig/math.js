/**
 * 2×3 affine transforms, in canvas order: [a, b, c, d, e, f].
 *
 *     x' = a·x + c·y + e
 *     y' = b·x + d·y + f
 *
 * The format speaks degrees and pixels; only this module converts to radians.
 * Keeping one convention removes a whole class of sign errors from the solver.
 */

/** Compose a local transform: translate, rotate, scale — applied in that order. */
export function compose(x, y, rotationDegrees, scaleX = 1, scaleY = 1) {
	const radians = (rotationDegrees * Math.PI) / 180
	const cos = Math.cos(radians)
	const sin = Math.sin(radians)
	return [cos * scaleX, sin * scaleX, -sin * scaleY, cos * scaleY, x, y]
}

export const IDENTITY = [1, 0, 0, 1, 0, 0]

/** `parent ∘ child`: the child's transform expressed in the parent's space. */
export function multiply(parent, child) {
	return [
		parent[0] * child[0] + parent[2] * child[1],
		parent[1] * child[0] + parent[3] * child[1],
		parent[0] * child[2] + parent[2] * child[3],
		parent[1] * child[2] + parent[3] * child[3],
		parent[0] * child[4] + parent[2] * child[5] + parent[4],
		parent[1] * child[4] + parent[3] * child[5] + parent[5],
	]
}

/** Apply a transform to a point. */
export function apply(matrix, x, y) {
	return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]
}

/** Invert a transform, so a world point can be expressed in local space. */
export function invert(matrix) {
	const [a, b, c, d, e, f] = matrix
	const determinant = a * d - b * c
	if (Math.abs(determinant) < 1e-12) throw new Error('matrix is not invertible')
	const inverse = 1 / determinant
	return [
		d * inverse,
		-b * inverse,
		-c * inverse,
		a * inverse,
		(c * f - d * e) * inverse,
		(b * e - a * f) * inverse,
	]
}

/** The rotation baked into a transform, in degrees. */
export function rotationOf(matrix) {
	return (Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI
}

/** The scale magnitudes baked into a transform. */
export function scaleOf(matrix) {
	return [Math.hypot(matrix[0], matrix[1]), Math.hypot(matrix[2], matrix[3])]
}

/**
 * The axis-aligned box around a rectangle after a transform.
 *
 * Used by lint to compare artwork against the canvas and against its neighbours
 * without rasterising anything.
 */
export function transformedBounds(bounds, matrix) {
	const [x, y, width, height] = bounds
	const corners = [
		apply(matrix, x, y),
		apply(matrix, x + width, y),
		apply(matrix, x, y + height),
		apply(matrix, x + width, y + height),
	]
	const xs = corners.map((point) => point[0])
	const ys = corners.map((point) => point[1])
	return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
}

/** Whether `bounds` contains a point, shrunk by `margin` on every side. */
export function boundsContain(bounds, x, y, margin = 0) {
	const [left, top, width, height] = bounds
	return x >= left + margin && x <= left + width - margin && y >= top + margin && y <= top + height - margin
}

/** Whether `outer` fully contains `inner`. */
export function boundsContainBounds(outer, inner) {
	return (
		inner[0] >= outer[0] &&
		inner[1] >= outer[1] &&
		inner[0] + inner[2] <= outer[0] + outer[2] &&
		inner[1] + inner[3] <= outer[1] + outer[3]
	)
}

export function clamp(value, min, max) {
	return Math.min(Math.max(value, min), Math.max(min, max))
}

export function degrees(radians) {
	return (radians * 180) / Math.PI
}

export function radians(degreesValue) {
	return (degreesValue * Math.PI) / 180
}
