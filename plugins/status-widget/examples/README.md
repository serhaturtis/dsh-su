# Authoring a character pack

A pack is a directory of art plus a `pack.json`, or a single `.dshchar` file with the same manifest and the files inlined as base64. The rules are in [`../docs/character-packs.md`](../docs/character-packs.md); this page is the practical side: what to put in it and how to see it running.

No character art ships with this repository. Whatever you author — drawn, generated, or photographed — stays on your machine. `*.dshchar` is in `.gitignore` on purpose: the format is public, the art is personal.

## The smallest useful pack

```
my-cat/
  pack.json
  poses/idle.png
```

```json
{
  "schema": 1,
  "manifest": {
    "schema": 1,
    "id": "my-cat",
    "name": "My Cat",
    "version": "1.0.0",
    "poses": { "idle": "poses/idle.png" }
  }
}
```

`idle` is the only required pose. Every other state falls back to it, so a one-image pack is valid and is the right place to start.

## Adding motion

Two mechanisms, and the choice belongs to the author:

- **An animated GIF or WebP** used as a pose. It animates itself; there is no descriptor and no timing control.
- **A sprite sheet** with a descriptor. This is the only way to set timing, and the only way a long animation fits inside the 2048 px per-side limit — use a grid, not a wide strip.

```json
"sheets": {
  "idle": { "file": "sheets/idle.webp", "frameWidth": 360, "frameHeight": 657,
            "frames": 6, "fps": 6, "layout": "grid", "columns": 3 }
}
```

## Install it

Importing also activates the pack, so you see it immediately. Either path works:

```sh
curl -X POST localhost:3080/dsh-status-widget/characters \
  -H 'content-type: application/json' \
  --data-binary @my-cat.dshchar
curl -X POST localhost:3080/dsh-status-widget/characters/my-cat/active
```

Or **Settings → Character → Import…**, also reachable from the right-click menu.

## One directory, one file

A `.dshchar` is just JSON: the manifest plus every file as base64 under its pack-relative path.

```js
import { readFileSync, writeFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync('my-cat/pack.json', 'utf8'))
const files = { 'poses/idle.png': readFileSync('my-cat/poses/idle.png').toString('base64') }
writeFileSync('my-cat.dshchar', JSON.stringify({ schema: 1, manifest, files }))
```

Export from the widget does the same in reverse, so a pack can go out and come back without loss.

## Things that bite

- **Do not generate a pose sequence as a grid of cells.** Multi-cell sheets crop tall poses — raised paws, hair, a tail — against the cell boundary, and those pixels cannot be recovered by slicing. Generate one drawing per pose on its own canvas, then derive motion from it.
- **Leave a margin.** Art that touches the canvas edge reads as cut even when it is whole.
- **Derive motion rather than generating it.** A loop built as a rigid transform of one drawing cannot drift; a loop built from six separately generated drawings will, and no alignment fixes a drawing that changed.
- **Share one canvas width, crop heights per pose.** The widget centres on the width and crops the height to the drawing, so the bubble sits on the character's head instead of on blank canvas.
- **Keep the body scale identical across poses.** The canvas is a frame; a pose drawn 20% smaller reads as a different animal.
