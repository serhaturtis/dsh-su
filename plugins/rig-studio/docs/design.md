# Rig Studio — design

A 2D skeletal animation runtime for DSH, and the content format behind it.

Status: **design approved, not implemented.** This document is the contract M0–M7 build against.

---

## 1. What this is

A character is data:

```
character = rig + preset + views
look      = the resolved result at runtime
```

- **rig** — skeleton, body parts, body variants, limits, joints. Anatomy only.
- **attachment** — anything layered on: clothing, hair, tail, wings, accessory, held prop.
- **variant** — alternate art for an attachment (colourway, length) or for the body (fur, scales).
- **preset** — a named selection of a body variant plus attachments: `default`, `winter`, `formal`.
- **view** — a named art configuration (optional; a rig may have one).
- **look** — what a preset and a view resolve to at runtime, after variants apply.

The engine never learns what a human is. A bone is a name, a parent and a transform. A dog is a rig with different bones and clips; a skirt is an attachment; a tail is an attachment too.

**Non-goals for v1:** 3D, cloth collision, mesh/vertex deformation, and facing. The engine does not model heading — north, velocity, 4 or 8 compass directions are **application policy**. The format leaves room for mesh as another attachment kind; v1 does not implement it.

---

## 2. Why overlays, and the one decision that matters

| | Baked outfits | **Overlay attachments** | Sub-rig per attachment |
| --- | --- | --- | --- |
| Art per new clothing set | a full character | only the piece | only the piece |
| Clips reused | no | **yes, all** | yes |
| Body variants × clothing | multiplies | **multiplies independently** | multiplies independently |
| Solve / render | simple | **one skeleton, one draw list** | nested transforms, duplicated ordering |
| Failure mode | cost | containment | ordering bugs |

**Decision: overlay attachments.** The decisive argument is that body variants × attachments grows as a *sum* instead of a *product*: fur patterns and clothing become independent choices rather than a matrix of baked drawings.

**And the key mechanism: attachment bones are merged into the rig's skeleton at compile time.**

```
authoring:  rig.bones (names)  +  attachments[].bones (names)
compile:    Look → { bones[] with ids, parents, slots[], springs[], ikChains[] }
runtime:    nothing holds a name; everything holds an id
```

The merge does not happen at load, and it does not mutate authoring data: it is a **compile step** that produces a runtime skeleton with stable numeric handles. A preset change recompiles once. That is more important than cutout-vs-mesh — it means IK, springs, limits and draw order are uniform across body and attachments, and there is no nested-transform arithmetic or duplicated ordering to get wrong, and no stale name reference can survive a recompile.

---

## 3. The rig

```jsonc
{
  "schema": 1,
  "id": "girl-01", "name": "Girl",
  "canvas": { "width": 512, "height": 768 },

  "skeleton": { "bones": [
    { "name": "root", "parent": null, "x": 256, "y": 740 },
    { "name": "hip",  "parent": "root", "x": 0, "y": -180,
      "role": "hip", "limit": { "rotation": [-10, 10] } },
    { "name": "thigh_l", "parent": "hip", "x": -28, "y": 0, "role": "leg.upper",
      "limit": { "rotation": [-120, 40] } }
  ]},

  "slots": [
    { "name": "thigh_l", "bone": "thigh_l", "layer": "body", "order": 20 },
    { "name": "cap_knee_l", "bone": "knee_l", "layer": "body", "order": 21, "cap": true }
  ],

  "joints": [ { "bone": "knee_l", "covered": true } ],

  "bodyVariants": {
    "default": { "thigh_l": { "image": "parts/thigh_l.png", "pivot": [0, 8],
                 "bounds": [-30, -60, 60, 120] } }
  },

  "animations": { "idle": { "duration": 2400, "loop": true, "tracks": [] } }
}
```

| Field | Why it exists |
| --- | --- |
| `role` | A **tag**, not a targeting mechanism. Validation uses it (`limit-missing`); retargeting uses it as a hint, never as a track target |
| `limit.rotation` | Clamped after sampling, before world transforms; no clip or IK target can hyperextend |
| `cap` | Marks a slot as a joint cover, drawn last inside its layer |
| `bounds` | `[x, y, w, h]` in attachment space; required for coverage lint and culling |
| `joints` | Declares which pivots need covering, so lint knows what to check |

---

## 4. Attachments

```jsonc
{
  "id": "skirt_pleated",
  "kind": "garment",              // garment | hair | tail | wing | accessory | prop | mod
  "group": "bottom",              // one attachment per group in a preset
  "layer": "over", "order": 30,   // back | body | over | front
  "attach": "hip",                // parent bone: on the rig, or on another attachment
  "asymmetric": false,            // mirroring this attachment produces wrong art
  "bones": [                      // optional; merged into the rig skeleton
    { "name": "skirt_1", "parent": null, "x": 0, "y": 0 },
    { "name": "skirt_2", "parent": "skirt_1", "x": 0, "y": 60 }
  ],
  "springs": [ { "bone": "skirt_2", "stiffness": 0.35, "damping": 0.5 } ],
  "slots": [ { "name": "skirt", "bone": "skirt_1", "layer": "over", "order": 30 } ],
  "variants": { "default": { "skirt": { "image": "parts/skirt.png", "pivot": [0, -10], "bounds": [-90, 0, 180, 120] } } },
  "occludes": [ "hip", "thigh_l", "thigh_r" ],
  "clips": { "sway": { "duration": 1200, "loop": true, "tracks": [] } }
}
```

Rules, enforced by the validator:

1. `attach` names a bone that exists — on the rig or on another attachment, acyclically.
2. An attachment attached to **another attachment** exists only while its parent exists: removing the hat removes the bow. Validation rejects a preset that selects a child without its parent.
3. Attachment bone names are namespaced at compile time (`attach:skirt_1`) so a merge cannot collide.
4. One attachment per `group` in a preset.
5. Every `occludes` entry is a body part name.
6. Attachment slots participate in the same global draw list as body slots.
7. Attachment `clips` animate attachment bones only, and are compiled into the same clip library.

**Overdraw is accepted.** The body is always drawn in full beneath its attachments. Correctness first; culling is an optimisation.

---

## 5. Views and mirroring

Facing is not a fundamental variable of the engine. Three separate things:

| Concept | Example | Whose job |
| --- | --- | --- |
| **Heading** — where the thing is going in the world | `north`, velocity, "walking away" | **Application** |
| **View** — which art set is drawn | `front`, `side`, `back` | **Character data** |
| **Mirror** — a horizontal flip | `scaleX: -1` | **Engine transform**, one boolean |

The engine never hears "north". It exposes `compile({ view, mirror })` and `play(clip)`. The application owns the mapping — screen-space vs world-space, 4 or 8 or 16 directions, y-up or y-down. A tree rig has one view and no mirroring, and nothing about the engine cares.

```jsonc
// character file — the author's art, not the world's geometry
{
  "id": "girl-01",
  "rig": "rigs/girl-01.json",
  "preset": "default",
  "views": {
    "front": { "preset": "default" },
    "side":  { "preset": "default",
               "clips": { "walk": "walk_side", "idle": "idle_side" } }
  }
}
```

- **Views are optional.** A rig may declare none, or one.
- **`mirror` is a compile option**, not a view property. Author one side view, call it twice with `mirror: true` for the other direction. Whether you need it depends on how many facings you authored, which the engine cannot know.
- **`clips` inside a view is an alias map**, not a second library. `{ walk: "walk_side" }` means "when the app asks for `walk`, play `walk_side` here". Without it, names pass through unchanged.
- **A view is not a preset.** A preset is what she wears; a view is which art set. They stay separate fields, so one preset can be worn in every view.

**Mirroring is a transform, so asymmetric art can be wrong.** Mirror the goth girl and her hairclip lands on the wrong side, her jacket hangs off the wrong shoulder — that is a different silhouette, not a mirrored one. So an attachment may declare `asymmetric: true`, and lint warns (`mirror-unsafe`) when a caller mirrors a look containing one. The fix is a second view, which the author chooses.

---

## 6. Presets and looks

```jsonc
// character.json
{
  "id": "girl-01",
  "rig": "rigs/girl-01.json",
  "preset": "default",
  "presets": {
    "default": { "bodyVariant": "default", "attachments": [
      { "attachment": "top_harness" }, { "attachment": "skirt_pleated" },
      { "attachment": "hair_bob", "variant": "black" }
    ]},
    "tabby":   { "bodyVariant": "tabby",  "attachments": [ { "attachment": "tail_fluffy" } ] }
  }
}
```

- A preset selects the **body variant and the attachments** together. The naming was chosen precisely because a cat's fur and a cat's tail are the same mechanism as a skirt — so a preset must be able to say *tabby cat with a fluffy tail*.
- Selecting a preset produces a **look**: the compiled skeleton plus resolved slots.
- v1 presets are explicit lists. Mixing rules ("trousers replace skirt") are a later feature and are why `group` exists now.

---

## 7. Runtime

```
clip sampling → cross-fade → clamp limits → IK → springs → world transforms → render
```

Every stage is a pure function over plain objects, so the runtime is testable without a browser.

| Module | Responsibility |
| --- | --- |
| `format.js` | Schema, validation, draw order, view/preset resolution |
| `compile.js` | Merge rig + attachments into one skeleton with ids, one slot list, one clip library |
| `clip.js` | Sample tracks at `t`, easing, loop wrap, **events** in range |
| `blend.js` | Cross-fade two samples by weight |
| `pose.js` | Create pose, apply sample, clamp limits, solve world transforms |
| `ik.js` | Two-bone IK with bend direction and reach clamping |
| `spring.js` | Verlet chains for hair, tails, cloth |
| `render.js` | Canvas 2D draw of the solved slots in global order |
| `retarget.js` | Explicit bone-name mapping table between two rigs (M7) |

### Clips

- Clips target **bone names** on the compiled skeleton — the rig's, or an attachment's (`attach:skirt_2`).
- A clip carries `events: [{ t, name }]`, delivered once per pass, so a footstep can trigger a sound.
- `role` is a tag for validation and a hint for retargeting. It is never a track target: two bones sharing a role, or a quadruped with two front legs, make role-targeting ambiguous.
- **Retargeting is an explicit mapping table** (`{ "thigh_l": "front_leg_l" }`) applied at load — inspectable, and it cannot silently do the wrong thing.

### Springs

Verlet chains over a **fixed timestep** (60 Hz, sub-stepped as needed). Springs reset on recompile, so a preset switch never carries a stale tail position. Determinism by construction: the same input sequence produces the same output, which is what makes spring tests stable.

### Rendering

`ctx.setTransform` per slot with the solved world matrix; one draw per slot; sorted once per compile. `ImageBitmap` for parts. Redraw when the state machine, clips or springs change.

### Controller

A small state machine with priorities and cross-fades (default 120 ms):

```
idle → wave (override, first-in last-out)
idle → squat (explicit, exits to idle)
```

A snap is what makes cheap rigs look cheap; the fade is not optional.

---

## 8. Joint integrity

A rigid part rotating about a pivot sweeps a wedge; two parts pinching at a pivot open a gap, and the result reads as a disassembled skeleton. Four mechanisms, in order of how much they can be trusted:

### 8.1 The disc rule (recommended technique)

A **circle centred exactly on the pivot is rotation-invariant**. Therefore:

> Cover every joint with a disc of radius *r* centred on its pivot, owned by the part that is **behind** in draw order, and keep the child part's cross-section at the joint within *r*.

If that holds, no rotation can open a gap at any angle — limits become a *looks* constraint, not a safety one. Two forms: the **inline disc** (the parent limb's rounded end is the disc — the default, and no separate kneecap is needed for a bare leg) and the **cap part** (an extra slot pinned to the child bone, drawn above both — armour, knee pads, bends past ~120°).

The rule is a technique, **not a mandate**: hips, shoulders and boot cuffs are legitimately non-circular, and forcing a disc on them distorts art.

### 8.2 Coverage verification (the actual lint)

What must be verified is that a joint cannot open, whatever shape the parts have. Lint therefore **samples each joint across its permitted range** (and the range actually used by its clips), rasterises the two parts into masks, and checks for holes. Fast geometric checks in the editor; full raster coverage in CI for the milestone rigs.

### 8.3 Limits

`limit.rotation: [min, max]` per bone, clamped after sampling. Missing limits on a bone with a `role` of `leg.*`, `arm.*` or `spine` is a lint **warning** (a blob rig may be intentional).

### 8.4 Splitting across a joint

**This is an attachment rule, not a body rule.** Anything crossing a joint is split into segments, each with its own covering: trousers at the knee, sleeves at the elbow, boots at the ankle, a fishnet at the knee. A single rigid trouser leg tearing at the knee is the same bug as a bare leg tearing.

### 8.5 Lint codes

| Code | Meaning |
| --- | --- |
| `joint-uncovered` | Coverage sampling found a hole at a joint within its range |
| `joint-disc-behind-art` | A declared disc belongs to the part drawn in front, so it cannot cover |
| `part-shorter-than-segment` | A limb part stops short of its child joint |
| `limit-missing` | A limb bone has no rotation limit (warning) |
| `bounds-missing` | An attachment declares no bounds, so coverage cannot be checked |
| `attachment-does-not-occlude` | A declared `occludes` target is not actually enclosed at extreme poses |
| `garment-joint-unsplit` | A garment crosses a joint as one rigid piece |
| `slot-order-collision` | Two slots share layer + order |
| `group-conflict` | A preset selects two attachments in one group |
| `orphan-attachment` | A preset selects an attachment whose parent attachment is absent |
| `mirror-unsafe` | A mirrored look contains an attachment declared `asymmetric` |
| `canvas-overflow` | Attachment bounds exceed the canvas at rest |

A rig that passes lint can still be ugly. It cannot fall apart.

---

## 9. Authoring

The engine is the cheap half. A character is:

1. **Skeleton** from a template (`humanoid`, `quadruped`, `bird`) with limits.
2. **Part contract** — `parts.json`: for each body part, its pivot, its segment (parent joint → child joint), and its cross-section radius. Both art generation and lint read it, so they cannot disagree.
3. **Art**, one drawing per part per view, generated individually. A part is defined by the **segment between joints**, never by its visible silhouette: the thigh is drawn from the hip socket to past the knee, including the skin hidden under the skirt.
4. **Attachments** with their own slots, variants, springs, clips and `occludes`.
5. **Lint** must pass.
6. **Clips**, authored against bone names, reviewed in the editor.

### Editor, not just a viewer

Bone handles, pivots, limit arcs, joint coverage preview, slot order, clip scrubber — **and editable pivots, limits and keys**. Hand-editing JSON pivots is the single most painful authoring step and the one that breaks joints; the editor exists to make it a drag instead of a text edit. Without it, authoring is blind; this project lives or dies on authoring ergonomics.

### Part generation rules (for imagegen prompts)

- Span in **joint terms**: "from the hip socket, down past the knee joint" — never "the visible part below the hem".
- One part per image, transparent, margin on all four sides, nothing touching an edge.
- Same palette, same light direction (top-left), same line weight across parts — enforced by generating each part against the same reference image and a style sheet.
- Ends at joints are **rounded caps centred on the pivot** where the disc technique applies.
- Front and side views share proportions, not outlines.

---

## 10. Import, export, and migration

The same standard as the existing character packs, because those rules are already written and tested: a directory (`rig.json`, `parts/…`) for authoring; a single `.dshrig` for sharing; validation before write; path confinement; magic-byte checks; size caps; atomic install; `schema` checked at load; unknown fields ignored.

**Migration policy:** a rig declaring an older `schema` than the runtime knows is upgraded through the documented chain of migrations, never guessed at; a newer schema is refused. A format that silently rewrites old data is how author files rot.

---

## 11. Testing

- **Solver**: hierarchy math, limit clamping, mirroring, draw order, compile (look merging).
- **Clips**: easing endpoints, loop wrap, out-of-order keys rejected, events in range, view alias resolution.
- **IK**: reachable, unreachable (clamped), bend direction.
- **Springs**: convergence and stability over the fixed timestep.
- **Lint**: one test per code, with a fixture that trips exactly that rule.
- **Coverage**: raster coverage of joint regions at limit extremes, for the milestone rigs in CI.
- **Render**: a recorder that captures draw calls instead of drawing, so order and transforms are assertable without a canvas.
- No image diffing in v1.

---

## 12. Milestones

The editor moves earlier, because authoring is the risk, not the engine:

| # | Deliverable | Acceptance |
| --- | --- | --- |
| **M0** | `format.js`, `compile.js`, `pose.js`, `clip.js`, `ik.js`, tests | a hand-written rig compiles and solves to expected world transforms; every lint code has a test |
| **M1** | Canvas renderer + **editor** (pivots, limits, scrub, coverage preview) | a rig of coloured shapes animates; pivots are editable by drag, not by JSON |
| **M2** | Controller, blending, preset/body-variant/view switching | idle→wave→idle cross-fades; switching preset swaps attachments live |
| **M3** | Two-bone IK, foot planting; coverage sampling in CI | hips move, feet do not slide; joint coverage verified in CI |
| **M4** | Spring bones; attachment clips | a tail and hair follow the root and settle; a skirt sway clip plays |
| **M5** | First character: humanoid, front + side views, idle/walk/wave/squat | lint passes; no joint gaps at limit angles |
| **M6** | Second preset, view/mirror data with `asymmetric` | look swap without clip changes; a side view mirrored without lint warnings |
| **M7** | Quadruped from templates, retarget map | a humanoid walk retargets to a dog's front-leg chain |

---

## 13. Risks

- **Art authoring is the real cost**, not the engine. Each character is a project; the engine is a few sessions.
- **Cutout has a realism ceiling.** Mesh deformation is where smooth bends come from — the format leaves room (`kind: mesh`) and this is deliberately deferred. Cutout promises *expressive and clean*, not photoreal.
- **Overlays do not conform.** A lifted knee passes through a rigid skirt. Mitigations: skirt chains with springs, longer hems, `occludes` lint. Real cloth needs mesh.
- **Mirroring asymmetric art is wrong art.** The engine cannot know; `asymmetric` + lint makes the author decide.
- **Generation drift across parts.** Separate generations can disagree on line weight and palette. Mitigation: a style-locked reference and a normalisation pass, not hope.
- **No atlasing plan.** 40 parts are 40 requests; acceptable now, needs an answer before M6.
- **Scope.** This is larger than everything built so far combined. It gets its own docs, tests and roadmap, and it does not delay the existing plugins.

---

## 14. Glossary

| Term | Meaning | Not to be confused with |
| --- | --- | --- |
| rig | skeleton + body parts + body variants | "body" — that is also a draw layer |
| body part | one anatomy piece bound to a bone | "part" alone |
| attachment | anything layered on | "item", "prop" (a prop is a `kind`) |
| variant | alternate art | "skin" — that means a whole surface elsewhere |
| preset | named selection of body variant + attachments | "outfit" — excludes fur, tails, whiskers |
| view | named art configuration | heading — that is application policy |
| mirror | horizontal flip at compile time | a view — you may mirror any view |
| look | runtime resolved result | preset (that is data) |
| group | exclusivity | "slot" (that is a draw slot) |
| layer | draw band | group |
| occludes | anatomy an attachment must hide | "contains" |
| role | validation tag, retargeting hint | a track target |
