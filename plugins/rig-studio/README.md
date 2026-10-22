# rig-studio

A 2D skeletal animation runtime for DSH: characters as data — a skeleton, art per slot, and clips that move bones.

Design and the joint-integrity model: [`docs/design.md`](docs/design.md).

**Status:** design only. The runtime is not implemented yet. `src/rig/format.js` holds the first draft of the schema validator and is not wired into a plugin.

The engine exists to solve one problem well: a cutout rig comes apart at the joints unless the format, the engine and the lint all make gaps impossible. See the design doc for the four mechanisms.
