# rig-studio

A 2D skeletal animation runtime for DSH: characters as data — a rig (skeleton and anatomy), attachments (clothing, hair, tails, props), variants, and presets that select them.

Design: [`docs/design.md`](docs/design.md).

**Status:** M0 done, M1 core done — the pure engine plus the renderer (with a recording context) and the editor operations, 105 tests. Not yet wired into a canvas: client bundles cannot require relative modules, so that needs a small build step.

The whole design turns on two decisions that are easy to miss:

- **Attachments are overlays on one compiled skeleton.** Clothing is never baked into the body; attachment bones are merged at compile time, so FK, IK, springs and draw order are uniform, and a new piece of clothing costs one drawing, not a whole character. Facing is not the engine's business: an app maps its headings to views, and mirroring is one boolean.
- **Joints are covered by a disc centred on the pivot.** A circle is rotation-invariant, so a joint built this way cannot open a gap at any angle. Limits then become a style choice rather than a safety net.

Not in v1: mesh deformation, cloth collision, 8-direction art.

## Planned milestones

| # | Deliverable |
| --- | --- |
| M0 ✅ | format, compile, solver, clip sampling, IK, lint — every lint code has a test |
| M1 | canvas renderer and editor (bones, pivots, discs, scrub) |
| M2 | controller, blending, preset switching |
| M3 | two-bone IK and foot planting |
| M4 | spring bones for hair, tails, cloth |
| M5 | first character: humanoid, idle/walk/wave/squat |
| M6 | second preset, 8-direction data |
| M7 | quadruped sharing clips through bone roles |
