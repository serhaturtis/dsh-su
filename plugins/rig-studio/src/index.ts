/**
 * rig-studio — host half.
 *
 * M0 is the engine and its tests: no renderer, no routes, nothing mounted. This
 * entry exists so the package is a loadable plugin the moment the profile links
 * it, and so M1 has somewhere to hang the canvas and the editor without moving
 * the engine.
 *
 * The engine itself lives in `src/index.js` and imports nothing from DSH. This
 * file is the only part that knows it is running inside a harness.
 */

export const name = 'dsh-rig-studio'

/** No services are needed until the renderer arrives in M1. */
export const inject = []

export function apply(): void {
	// Intentionally empty: M0 ships the pure core (format, compile, pose, clip,
	// IK, lint) and its tests. Mounting the overlay is M1.
}
