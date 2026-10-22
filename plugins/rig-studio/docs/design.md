# Rig Studio — design

A 2D skeletal animation runtime for DSH, and the content format behind it.

Status: **design approved, not implemented.** This document is the contract M0–M7 build against.

---

## 1. What this is

A character is data:

```
character = rig + preset
look      = the resolved result at runtime
```

- **rig** — skeleton, body parts, body variants, limits, joints. Anatomy only.
- **attachment** — anything layered on: clothing, hair, tail, wings, accessory, held prop.
- **variant** — alternate art for an attachment (colourway, length) or for the body (fur, scales).
- **preset** — a named selection of attachments: `default`, `winter`, `formal`.
- **look** — what the preset resolves to at runtime, after variants apply.

The engine never learns what a human is. A bone is a name, a parent and a transform. A dog is a rig with different bones and clips; a skirt is an attachment; a tail is an attachment too.

**Non-goals for v1:** 3D, cloth collision, and mesh/vertex deformation. The format leaves room for mesh as another attachment kind; v1 does not implement it.

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

**And the key mechanism: attachment bones are merged into the rig's skeleton at load.**

```
load:   bones = rig.skeleton.bones ∪ attachments[].bones   (names namespaced "attach:")
        one parent map, one draw list
solve:  one FK pass → one IK pass → one spring pass
render: one slot list sorted by (layer, order, insertion)
```

This is more important than cutout-vs-mesh. It means IK, springs, limits and draw order are uniform across body and attachments, and there is no nested-transform arithmetic or duplicated ordering to get wrong.

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
| `role` | Retargeting: clips can target `leg.upper` instead of a bone name, so one run cycle drives a human and a dog |
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
  "attach": "hip",                // parent bone on the rig
  "bones": [                      // optional; merged into the rig skeleton
    { "name": "skirt_1", "parent": null, "x": 0, "y": 0 },
    { "name": "skirt_2", "parent": "skirt_1", "x": 0, "y": 60 }
  ],
  "springs": [ { "bone": "skirt_2", "stiffness": 0.35, "damping": 0.5 } ],
  "slots": [ { "name": "skirt", "bone": "skirt_1", "layer": "over", "order": 30 } ],
  "variants": { "default": { "skirt": { "image": "parts/skirt.png", "pivot": [0, -10], "bounds": [-90, 0, 180, 120] } } },
  "occludes": [ "hip", "thigh_l", "thigh_r" ]
}
```

Rules, enforced by the validator:

1. `attach` names a bone that exists — on the rig or on another attachment, acyclically.
2. Attachment bone names are namespaced at load (`attach:skirt_1`) so a merge cannot collide.
3. One attachment per `group` in a preset.
4. Every `occludes` entry is a body part name.
5. Attachment slots participate in the same global draw list as body slots.

**Overdraw is accepted.** The body is always drawn in full beneath its attachments. Correctness first; culling is an optimisation.

---

## 5. Joint integrity

A rigid part rotating about a pivot sweeps a wedge; two parts pinching at a pivot open a gap, and the result reads as a disassembled skeleton. Four mechanisms, in order of how much they can be trusted:

### 5.1 The disc rule (geometric guarantee)

A **circle centred exactly on the pivot is rotation-invariant**. Therefore:

> Every joint must be covered by a disc of radius *r* centred on its pivot, owned by the part that is **behind** in draw order, and the child part's cross-section at the joint must not exceed *r*.

If that holds, **no rotation can open a gap, at any angle** — limits then become a *looks* constraint, not a safety one.

```
pivot ●───────────────  parent part's rounded end = disc, radius r
      │                 child rotates freely; the disc never moves
      └── child part's top, within radius r
```

Two forms:

| Form | How | When |
| --- | --- | --- |
| **Inline disc** (default) | the parent limb's end *is* the disc | bare limbs, most cases; invisible |
| **Cap part** | an extra slot pinned to the child bone, drawn above both | armour, knee pads, bends past ~120° |

No separate kneecap is needed by default for a bare leg: the thigh's rounded end is the disc.

### 5.2 Limits

`limit.rotation: [min, max]` per bone, clamped after sampling. Missing limits on a bone with a `role` of `leg.*`, `arm.*` or `spine` is a lint **warning** (a blob rig may be intentional).

### 5.3 Splitting across a joint

**This is an attachment rule, not a body rule.** Anything crossing a joint is split into segments, each with its own disc: trousers at the knee, sleeves at the elbow, boots at the ankle, a fishnet at the knee. A single rigid trouser leg tearing at the knee is the same bug as a bare leg tearing.

### 5.4 Lint

| Code | Meaning |
| --- | --- |
| `joint-uncovered` | Neither overlap nor a cap covers this pivot |
| `joint-disc-behind-art` | The disc belongs to the part drawn in front, so it cannot cover |
| `part-shorter-than-segment` | A limb part stops short of its child joint |
| `limit-missing` | A limb bone has no rotation limit |
| `bounds-missing` | An attachment declares no bounds, so coverage cannot be checked |
| `attachment-does-not-occlude` | A declared `occludes` target is not actually enclosed at extreme poses |
| `garment-joint-unsplit` | A garment crosses a joint as one rigid piece |
| `slot-order-collision` | Two slots share layer + order |
| `group-conflict` | A preset selects two attachments in one group |
| `canvas-overflow` | Attachment bounds exceed the canvas at rest |

A rig that passes lint can still be ugly. It cannot fall apart.

---

## 6. Presets and looks

```jsonc
// character.json
{
  "id": "girl-01",
  "rig": "rigs/girl-01.json",
  "preset": "default",
  "presets": {
    "default": [ { "attachment": "top_harness" }, { "attachment": "skirt_pleated" },
                 { "attachment": "hair_bob", "variant": "black" } ]
  }
}
```

- A preset is a **list of attachments**, not a single "skin" — that is what makes fur, tails, whiskers and skirts the same mechanism.
- Selecting a preset produces a **look**: the merged skeleton plus resolved slots.
- v1 presets are explicit lists. Mixing rules ("trousers replace skirt") are a later feature and are why `group` exists now.

---

## 7. Runtime

```
clip sampling → cross-fade → clamp limits → IK → springs → world transforms → render
```

Every stage is a pure function over plain objects, so the runtime is testable without a browser.

| Module | Responsibility |
| --- | --- |
| `format.js` | Schema, validation, draw order, view/skin resolution |
| `clip.js` | Sample tracks at `t`, easing, loop wrap, events in range |
| `blend.js` | Cross-fade two samples by weight |
| `pose.js` | Create pose, apply sample, clamp limits, solve world transforms |
| `ik.js` | Two-bone IK with bend direction and reach clamping |
| `spring.js` | Verlet chains for hair, tails, cloth |
| `render.js` | Canvas 2D draw of the solved slots in global order |
| `look.js` | Merge rig + attachments into one skeleton and one slot list |

### Rendering

`ctx.setTransform` per slot with the solved world matrix; one draw per slot; sorted once per look change. `ImageBitmap` for parts. Redraw when the state machine, clips or springs change.

### Controller

A small state machine with priorities and cross-fades (default 120 ms):

```
idle → wave (override, first-in last-out)
idle → squat (explicit, exits to idle)
```

A snap is what makes cheap rigs look cheap; the fade is not optional.

---

## 8. Authoring

The engine is the cheap half. A character is:

1. **Skeleton** from a template (`humanoid`, `quadruped`, `bird`) with limits.
2. **Part contract** — `parts.json`: for each body part, its pivot, its segment (parent joint → child joint), and its cross-section radius. Both art generation and lint read it, so they cannot disagree.
3. **Art**, one drawing per part per facing, generated individually. A part is defined by the **segment between joints**, never by its visible silhouette: the thigh is drawn from the hip socket to past the knee, including the skin hidden under the skirt.
4. **Attachments** with their own slots, variants, springs and `occludes`.
5. **Lint** must pass.
6. **Clips**, authored against roles and bone names, reviewed in the debug viewer.

### Part generation rules (for imagegen prompts)

- Span in **joint terms**: "from the hip socket, down past the knee joint" — never "the visible part below the hem".
- One part per image, transparent, margin on all four sides, nothing touching an edge.
- Same palette, same light direction (top-left), same line weight across parts.
- Ends at joints are **rounded caps centred on the pivot**.
- Front and side facings share proportions, not outlines.

### Debug viewer

Bone handles, pivots, joint discs, limit arcs, slot order, clip scrubber. Without it, authoring is blind — and this project lives or dies on authoring ergonomics.

---

## 9. Import and export

The same standard as the existing character packs, because those rules are already written and tested: a directory (`rig.json`, `parts/…`) for authoring; a single `.dshrig` for sharing; validation before write; path confinement; magic-byte checks; size caps; atomic install; `schema` checked at load; unknown fields ignored.

---

## 10. Testing

- **Solver**: hierarchy math, limit clamping, mirroring, draw order, look merging.
- **Clips**: easing endpoints, loop wrap, out-of-order keys rejected, events in range.
- **IK**: reachable, unreachable (clamped), bend direction.
- **Springs**: convergence and stability over a fixed timestep.
- **Lint**: one test per code, with a fixture that trips exactly that rule.
- **Render**: a recorder that captures draw calls instead of drawing, so order and transforms are assertable without a canvas.
- No image diffing in v1.

---

## 11. Milestones

| # | Deliverable | Acceptance |
| --- | --- | --- |
| **M0** | `format.js`, `pose.js`, `clip.js`, `ik.js`, `look.js`, tests | a hand-written rig solves to expected world transforms; every lint code has a test |
| **M1** | Canvas renderer + debug overlay | a rig of coloured shapes animates, with bones, pivots and discs visible |
| **M2** | Controller, blending, look/preset switching | idle→wave→idle cross-fades; switching preset swaps attachments live |
| **M3** | Two-bone IK, foot planting | hips move, feet do not slide |
| **M4** | Spring bones | a tail and hair follow the root and settle |
| **M5** | First character: humanoid, front + side, idle/walk/wave/squat | lint passes; no joint gaps at limit angles |
| **M6** | Second preset (different garments) and 8-direction data | look swap without clip changes; 5 unique views mirrored to 8 |
| **M7** | Quadruped from templates sharing clips through roles | a humanoid walk retargets to a dog's front-leg chain |

---

## 12. Risks

- **Art authoring is the real cost**, not the engine. Each character is a project; the engine is a few sessions.
- **Overlays do not conform.** A lifted knee passes through a rigid skirt. Mitigations: skirt chains with springs, longer hems, `occludes` lint. Real cloth needs mesh, which is not v1.
- **8 directions is 5× the art.** The data model supports it from day one; shipping art for all of it is deferred.
- **Cutout has a realism ceiling.** We promise *expressive and clean*, not photoreal.
- **Scope.** This is larger than everything built so far combined. It gets its own docs, tests and roadmap, and it does not delay the existing plugins.

---

## 13. Glossary

| Term | Meaning | Not to be confused with |
| --- | --- | --- |
| rig | skeleton + body parts + body variants | "body" — that is also a draw layer |
| body part | one anatomy piece bound to a bone | "part" alone |
| attachment | anything layered on | "item", "prop" (a prop is a `kind`) |
| variant | alternate art | "skin" — that means a whole surface elsewhere |
| preset | named selection of attachments | "outfit" — excludes fur, tails, whiskers |
| look | runtime resolved result | preset (that is data) |
| group | exclusivity | "slot" (that is a draw slot) |
| layer | draw band | group |
| occludes | anatomy an attachment must hide | "contains" |
