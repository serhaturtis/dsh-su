# Rig Studio — design

A 2D skeletal animation runtime for DSH, and the content format behind it.

Status: **design**. No runtime yet. This document is the contract that M0–M7 build against.

## What this is

A character is data:

```
rig (skeleton, slots, limits)  +  skin (art per slot)  +  clips (bone motion)  +  controller (which clip when)
```

The engine knows nothing about humans, cats or aliens. A bone is a name, a parent and a transform. A species is a skeleton and a set of clips. `one humanoid`
and `one quadruped` differ in data, not in code.

Non-goals: 3D, physics beyond spring bones, soft-body mesh deformation (the format leaves room, v1 does not implement it), and authoring an animation in code by hand.

## Why cutout, and what it costs

Art is cut into parts; each part is pinned to a bone and rotated rigidly. It is how Spine and DragonBones characters work, and it is the only technique we can author without a mesh/weighting tool.

The cost is **joints**: two rigid parts rotating about a pivot open a wedge-shaped gap, and a naive rig looks like a disassembled skeleton. Every decision below exists to make that impossible or visible.

## Joint integrity model

Four mechanisms, in order of reliability:

### 1. Overlap (authoring rule, enforced by lint)

Each attachment drawn for a limb must extend **past its own pivot** and the parent must extend **past the joint** by at least `minOverlap` (default 12 px at rig scale).

```
        parent limb
     ┌─────────────┐
     │       ┌─────┴───┐  joint pivot
     │   ╱   │ child   │
     └───────┴─────────┘
      overlap  overlap
```

Lint measures this from the attachment's declared bounds, so it works even before the art exists: an attachment with no bounds fails.

### 2. Joint caps (draw guarantee, engine-enforced)

Every joint may carry a **cap**: a small disc/sprite drawn above both parts, in the body skin, centred on the pivot. With a cap of radius ≥ overlap, no rotation can open a gap — the cap covers the wedge.

Caps are optional per joint, and the rig may declare `joints: [{ bone, cover: true }]`; the engine then checks that a cap slot exists and warns if not. Rule of thumb: caps at shoulders, elbows, hips, knees, neck; overlap alone is enough at wrists and ankles.

### 3. Limits (engine-enforced at solve time)

Each bone may declare `limit: { rotation: [min, max], translation: [dx, dy] }`. Limits are clamped **after** clip sampling and **before** world transforms, so no clip, blend or IK target can hyperextend a joint. Missing limits on a limb bone is a lint warning, not an error: some rigs are meant to be boneless (a blob).

### 4. Validation, at authoring time

`lintRig(rig)` reports, per joint:

| Code | Meaning |
| --- | --- |
| `joint-uncovered` | Neither overlap nor cap covers this pivot |
| `limit-missing` | A limb bone has no rotation limit |
| `art-bounds-missing` | An attachment declares no bounds, so coverage cannot be checked |
| `slot-order-collision` | Two slots share an order value in the same layer |
| `canvas-overflow` | An attachment's bounds exceed the canvas at rest |

The point is that the *engine refuses to be surprised*. A rig that passes lint can still be ugly, but it cannot fall apart.

## The format

Y-down, degrees, one unit = one pixel. Pivots are pixel offsets inside the attachment. Everything is JSON, hand-editable and diffable.

```jsonc
{
  "schema": 1,
  "id": "girl-01",
  "name": "Girl",
  "canvas": { "width": 512, "height": 768 },

  "skeleton": {
    "bones": [
      { "name": "root", "parent": null, "x": 256, "y": 740 },
      { "name": "hip", "parent": "root", "x": 0, "y": -180,
        "role": "hip", "limit": { "rotation": [-10, 10] } },
      { "name": "thigh_l", "parent": "hip", "x": -28, "y": 0, "role": "leg.upper",
        "limit": { "rotation": [-120, 40] } }
    ]
  },

  "slots": [
    { "name": "thigh_l", "bone": "thigh_l", "order": 20, "layer": "body" },
    { "name": "cap_knee_l", "bone": "knee_l", "order": 21, "layer": "body", "cap": true }
  ],

  "joints": [ { "bone": "knee_l", "covered": true } ],

  "skins": {
    "front": { "thigh_l": { "image": "parts/front/thigh_l.png", "pivot": [0, 8], "bounds": [-30, -60, 60, 120] } },
    "side":  { "thigh_l": { "image": "parts/side/thigh_l.png",  "pivot": [0, 8], "bounds": [-24, -60, 48, 120] } }
  },

  "directions": {
    "s": { "skin": "front" }, "e": { "skin": "side" },
    "w": { "skin": "side", "mirror": true }, "n": { "skin": "front" }
  },

  "animations": {
    "idle": { "duration": 2400, "loop": true, "tracks": [
      { "bone": "chest", "property": "rotation",
        "keys": [ { "t": 0, "v": 0, "ease": "smooth" }, { "t": 1200, "v": 2 } ] }
    ]}
  }
}
```

### Field notes

| Field | Why it exists |
| --- | --- |
| `role` | Retargeting. A clip can target `role:leg.upper` instead of a bone name, so a run cycle drives a human and a dog |
| `layer` | Draw groups: `back`, `body`, `clothes`, `front`. Sorted within layer by `order` |
| `cap` | Marks a slot as a joint cover, drawn last inside its layer |
| `bounds` | `[x, y, w, h]` in attachment space; needed for coverage lint and for culling |
| `direction.mirror` | One art set serves both facings; negative x scale at solve time |
| `ease` | `linear`, `smooth`, `step`, or a cubic-bezier array |
| `events` | `[{ t, name }]` on a clip, so a footstep can trigger a sound |

### What is deliberately absent

- **No IK targets in the format, only in clips as constraints**: `{ "ik": { "chain": ["thigh_l","shin_l"], "target": "foot_l" } }` at rig level, so clips can move the hip freely while feet stay planted.
- **No sprite sheets, no atlas**: parts are individual files; packing is a shipping concern, not an authoring one.
- **No blending curves in the format**; the controller owns transitions.

## Runtime

```
clip sampling → blend → clamp limits → IK solve → world transforms → springs → render
```

Each stage is a pure function over plain objects, which is why the runtime is testable without a browser:

| Module | Responsibility |
| --- | --- |
| `format.js` | Schema, validation, draw order, skin/view resolution |
| `clip.js` | Sample tracks at `t`, easing, loop wrap, events in range |
| `blend.js` | Cross-fade two samples by weight; additive overlays later |
| `pose.js` | `createPose`, apply sample, clamp limits, solve world transforms |
| `ik.js` | Two-bone IK with bend direction and reach clamping |
| `spring.js` | Verlet chains for hair, tail, cloth |
| `render.js` | Canvas 2D draw of solved slots, in layer/order |

### Rendering

Canvas 2D with `save/restore` per bone is too slow at depth; solved world matrices are applied with `setTransform`, one draw per slot, sorted once per skin change. `ImageBitmap` for parts. Redraw only when the state machine or springs change (not every frame when idle and still).

### Controller

A small state machine with priorities and transitions:

```
states: idle, walk, wave, squat, jump
rules:  wave  overrides idle, first in / last out
        squat entered on demand, exits to idle
```

Transitions cross-fade over `transitionMs` (default 120), because a snap is what makes cheap rigs look cheap.

## Authoring pipeline

The engine is the cheap half. Character authoring is:

1. **Skeleton**: author bones and limits from a template (`humanoid`, `quadruped`, `bird`). Templates are data in `templates/`.
2. **Part list**: the slots the rig needs, with pivots and expected bounds. This is the contract art must satisfy.
3. **Art**: one drawing per part per facing. Generated with imagegen from a **part sheet prompt** that fixes style, palette, lighting direction and part naming. Each part is generated individually so it arrives separated; a full-body drawing would have to be cut, and cutting is where pivots go wrong.
4. **Lint**: `lintRig` must pass; the report names the joint and the missing overlap.
5. **Clips**: keyframe bones; the debug viewer scrubs and shows limits.

Authoring rules that the engine cannot enforce and the docs must state:

- parts overlap by ≥ 12 px across every joint;
- caps at shoulder, elbow, hip, knee, neck;
- front and side facings share proportions, not outlines;
- shading implies one light direction, top-left;
- no baked-in background, no antialiased halo (it shows against dark themes).

## Import and export

Same shape as the character-pack standard already in this repo, because the rules are already written and tested:

- a **directory** (`rig.json`, `parts/…`) for authoring;
- a single `.dshrig` file (JSON with base64 parts) for sharing;
- validation before write, path confinement, magic bytes, size caps, atomic install;
- `schema` version checked at load; unknown fields ignored.

## Testing

- **Solver**: hierarchy math, limits clamping, mirroring, draw order, view resolution.
- **Clips**: easing endpoints, loop wrap, out-of-order keys rejected, events in range.
- **IK**: reachable, unreachable (clamped), bend direction, knee pole.
- **Lint**: one test per code, with a rig fixture that trips exactly that rule.
- **Render**: a `renderFrame` that records draw calls instead of drawing, so order and transforms are assertable without a canvas.
- No image diffs in v1: they are slow and brittle without a headless canvas.

## Milestones

| # | Deliverable | Acceptance |
| --- | --- | --- |
| M0 | `format.js`, `pose.js`, `clip.js`, tests | A hand-written rig solves to expected world transforms; every lint code has a test |
| M1 | Canvas renderer + debug overlay | A rig of coloured shapes animates in the shell, with bone handles and pivots visible |
| M2 | Controller, blending, skin/view switching | idle→wave→idle cross-fades; switching facing mirrors correctly |
| M3 | Two-bone IK, foot planting | hips move, feet do not slide |
| M4 | Spring bones | a tail and hair follow the root and settle |
| M5 | First real character: humanoid, front+side art, idle/walk/wave/squat | lint passes; no joint gaps at extreme angles |
| M6 | Second skin (outfit) and 8-direction data | outfit swap without clip changes; 4 unique views mirrored to 8 |
| M7 | Quadruped from templates, sharing clips through roles | a humanoid walk retargets to a dog front-leg chain |

## Open questions

1. Should the first character reuse the current goth-girl design, or start from a simpler shape that is easier to cut correctly?
2. Are clips authored by hand (JSON) with the debug viewer, or should the viewer get keyframe recording? Hand-authored first is my recommendation; recording is a project of its own.
3. Does `status-widget` eventually host this, or is this always its own overlay? Standalone first, decided later.
