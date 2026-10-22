/**
 * rig-studio — client half (the body of the generated bundle).
 *
 * This file is concatenated into `dist/client.js` by `scripts/build-client.mjs`,
 * which is why it may use `RIG_STUDIO` (the bundled engine) but must not use
 * `import`: a client-module bundle cannot require relative files.
 *
 * M1 scope: mount a canvas, play the demo rig, and let a human grab it — select a
 * bone, rotate it within its limits, drag a pivot, scrub the clip. The editor is
 * the point: the pivot bet is answered by hands, not by assertions.
 */

const { compile, clip, pose: poseModule, render, editor, demo, lint, format } = RIG_STUDIO

const SCALE = 0.72
const IDLE_COLOR = '#c9d4e6'
const OVERLAY = '#7cc7ff'
const SELECT = '#f5a524'

function rigStudioClient(ctx, require) {
	const React = require('react')

	function Editor() {
		const canvasRef = React.useRef(null)
		const stateRef = React.useRef(null)

		React.useEffect(() => {
			const rig = demo.createDemoRig()
			const look = compile.compileLook({ rig, attachments: [], preset: { attachments: [] } })
			const issues = lint.lintLook({ rig })
			const state = {
				rig,
				look,
				time: 0,
				playing: true,
				clipName: 'idle',
				overlay: true,
				selected: null,
				scrub: null,
				edits: {},
				drag: null,
				issues,
				last: 0,
				raf: 0,
			}
			stateRef.current = state

			const canvas = canvasRef.current
			const context = canvas && canvas.getContext ? canvas.getContext('2d') : null
			if (canvas !== null && canvas !== undefined) {
				canvas.width = look.canvas.width * SCALE
				canvas.height = look.canvas.height * SCALE
			}

			const draw = () => {
				const current = stateRef.current
				if (context === null) return
				const clipNow = current.look.clips.get(current.clipName)
				const sampled = current.scrub === null ? clip.sampleClip(clipNow, current.time) : clip.sampleClip(clipNow, current.scrub)
				let posed = poseModule.applySample(poseModule.createPose(current.look), sampled)
				for (const id of Object.keys(current.edits)) {
					posed[id] = { ...posed[id], ...current.edits[id] }
				}
				posed = poseModule.clampLimits(current.look, posed)
				const solved = poseModule.solvePose(current.look, posed)
				current.solved = solved
				current.posed = posed

				context.setTransform(1, 0, 0, 1, 0, 0)
				context.clearRect(0, 0, current.look.canvas.width * SCALE, current.look.canvas.height * SCALE)
				context.setTransform(SCALE, 0, 0, SCALE, 0, 0)
				render.drawLook(context, solved, {})

				if (current.overlay) drawOverlay(context, current, solved)
				drawTimeline(context, current)
			}

			const loop = (now) => {
				const current = stateRef.current
				if (current.playing && current.scrub === null) {
					const delta = current.last === 0 ? 16 : now - current.last
					current.time += delta
				}
				current.last = now
				draw()
				current.raf = window.requestAnimationFrame(loop)
			}

			const toLocal = (event) => {
				const rect = canvasRef.current.getBoundingClientRect()
				return [(event.clientX - rect.left) / SCALE, (event.clientY - rect.top) / SCALE]
			}

			const onPointerDown = (event) => {
				const current = stateRef.current
				const point = toLocal(event)
				const solved = current.solved
				if (solved === undefined) return

				// The timeline is the bottom strip: clicking it scrubs.
				if (point[1] > current.look.canvas.height - 24) {
					current.scrub = Math.min(1, Math.max(0, point[0] / current.look.canvas.width)) * current.look.clips.get(current.clipName).duration
					current.playing = false
					return
				}

				const hit = editor.hitTest(current.look, solved, point)
				if (hit === null) {
					current.selected = null
					return
				}
				current.selected = hit
				const bone = current.look.bones[hit.boneId]

				if (event.shiftKey) {
					current.drag = { kind: 'pivot', slot: bodySlotFor(current.look, hit.boneId), start: point }
					return
				}
				const parentWorld = bone.parentId === null ? null : solved.bones.get(bone.parentId)
				const centre = parentWorld === null ? [solved.bones.get(bone.id)[4], solved.bones.get(bone.id)[5]] : [parentWorld[4], parentWorld[5]]
				const rotation = (current.posed[bone.id] ?? bone.rest).rotation ?? 0
				current.drag = { kind: 'rotate', bone, centre, startAngle: editor.angleFrom(centre, point), startRotation: rotation }
			}

			const onPointerMove = (event) => {
				const current = stateRef.current
				if (current.drag === null) return
				const point = toLocal(event)
				if (current.drag.kind === 'rotate') {
					const delta = editor.angleFrom(current.drag.centre, point) - current.drag.startAngle
					const next = editor.rotateBone(current.posed, current.drag.bone, current.drag.startRotation + delta)
					current.edits[current.drag.bone.id] = { rotation: next[current.drag.bone.id].rotation }
					return
				}
				// Pivot drag: the delta is in rig units, applied incrementally.
				const dx = point[0] - current.drag.start[0]
				const dy = point[1] - current.drag.start[1]
				current.drag.start = point
				if (current.drag.slot !== null) {
					editor.movePivot(current.look, current.drag.slot, [dx, dy])
					stateRef.current.issues = lint.lintLook({ rig: current.rig })
				}
			}

			const onPointerUp = () => {
				stateRef.current.drag = null
			}

			const onKey = (event) => {
				const current = stateRef.current
				if (event.key === 'e' || event.key === 'E') current.overlay = !current.overlay
				if (event.key === ' ') {
					current.playing = !current.playing
					current.last = 0
					event.preventDefault()
				}
				if (event.key === 'c' || event.key === 'C') {
					const names = [...current.look.clips.keys()]
					const index = names.indexOf(current.clipName)
					current.clipName = names[(index + 1) % names.length]
					current.time = 0
					current.scrub = null
					current.edits = {}
				}
			}

			canvas.addEventListener('pointerdown', onPointerDown)
			canvas.addEventListener('pointermove', onPointerMove)
			window.addEventListener('pointerup', onPointerUp)
			window.addEventListener('keydown', onKey)
			if (window.requestAnimationFrame) state.raf = window.requestAnimationFrame(loop)
			else draw()

			return () => {
				window.removeEventListener('pointerup', onPointerUp)
				window.removeEventListener('keydown', onKey)
				window.cancelAnimationFrame(state.raf)
			}
		}, [])

		return React.createElement('canvas', {
			ref: canvasRef,
			style: {
				position: 'fixed',
				left: '16px',
				bottom: '16px',
				zIndex: 62,
				touchAction: 'none',
				borderRadius: '10px',
				background: 'rgba(20,22,28,0.55)',
				boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
				cursor: 'crosshair',
			},
		})
	}

	/** The body slot bound to a bone: what a pivot drag edits. */
	function bodySlotFor(look, boneId) {
		const slot = look.slots.find((entry) => entry.boneId === boneId && entry.kind === 'body')
		return slot === undefined ? null : slot.name
	}

	function drawOverlay(context, state, solved) {
		const overlap = Number.isFinite(state.rig.minOverlap) ? state.rig.minOverlap : format.LIMITS.minOverlap
		context.lineWidth = 1
		context.strokeStyle = OVERLAY
		for (const bone of state.look.bones) {
			const world = solved.bones.get(bone.id)
			const child = state.look.bones.find((candidate) => candidate.parentId === bone.id)
			if (child !== undefined) {
				const childWorld = solved.bones.get(child.id)
				context.beginPath()
				context.moveTo(world[4], world[5])
				context.lineTo(childWorld[4], childWorld[5])
				context.stroke()
			}
			context.beginPath()
			context.arc(world[4], world[5], 3.5, 0, Math.PI * 2)
			context.stroke()

			// Limits and the coverage disc: what the author needs to see.
			const arc = editor.limitArc(state.look, solved, bone)
			if (arc !== null) {
				context.beginPath()
				context.arc(arc.center[0], arc.center[1], 16, (arc.from * Math.PI) / 180, (arc.to * Math.PI) / 180)
				context.stroke()
			}
			const disc = editor.coverageDisc(state.look, solved, bone, overlap)
			context.beginPath()
			context.arc(disc.center[0], disc.center[1], disc.radius, 0, Math.PI * 2)
			context.stroke()
		}

		if (state.selected !== null) {
			const world = solved.bones.get(state.selected.boneId)
			context.strokeStyle = SELECT
			context.beginPath()
			context.arc(world[4], world[5], 6, 0, Math.PI * 2)
			context.stroke()
		}
	}

	function drawTimeline(context, state) {
		const clipNow = state.look.clips.get(state.clipName)
		const width = state.look.canvas.width
		const height = state.look.canvas.height
		const fraction = state.scrub === null ? (state.time % clipNow.duration) / clipNow.duration : state.scrub / clipNow.duration
		context.strokeStyle = '#3a4356'
		context.lineWidth = 6
		context.beginPath()
		context.moveTo(8, height - 10)
		context.lineTo(width - 8, height - 10)
		context.stroke()
		context.strokeStyle = OVERLAY
		context.lineWidth = 6
		context.beginPath()
		context.moveTo(8, height - 10)
		context.lineTo(8 + (width - 16) * fraction, height - 10)
		context.stroke()
	}

	ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'rig-studio' }, Editor))
}

if (typeof window !== 'undefined' && window.__ModuleLoader__ !== undefined) {
	window.__ModuleLoader__.load({
		id: 'dsh-rig-studio',
		factory: function (require) {
			return { apply: function (ctx) { return rigStudioClient(ctx, require) }, inject: ['slots'] }
		},
	})
}
