/**
 * The rig-studio engine, as one barrel.
 *
 * Deliberately DSH-free: nothing under src/rig imports cordis, the shell or the
 * host. The plugin shell (src/index.ts, src/client.js) is the only place that
 * knows where it is running, which is what would let this module be published
 * on its own later.
 */

export * from './rig/format.js'
export * from './rig/compile.js'
export * from './rig/clip.js'
export * from './rig/pose.js'
export * from './rig/ik.js'
export * from './rig/lint.js'
export * from './rig/math.js'
export * from './rig/render.js'
export * from './rig/editor.js'
