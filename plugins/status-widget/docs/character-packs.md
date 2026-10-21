# Character packs — the format

A character pack is a directory or a single file that replaces the built-in mascot. This document defines the format, the storage layout, the routes, and — most importantly — what a pack may not do.

The rules are implemented in [`src/pack.js`](../src/pack.js) and covered by [`test/pack.test.mjs`](../test/pack.test.mjs). That module has no Node and no DOM imports, so a second implementation can be checked against it rather than against a screenshot.

## Two shapes, one schema

**Directory** — for local authoring, dropped straight into the Harness home:

```
$DSH_HOME/status-widget/characters/sample-cat/
  pack.json
  poses/idle.png
  poses/happy.png
```

**Single file** — `.dshchar`, for sharing. JSON, images embedded as base64:

```json
{
  "schema": 1,
  "manifest": { "schema": 1, "id": "sample-cat", "name": "Sample Character", "poses": { "idle": "poses/idle.png" } },
  "files": { "poses/idle.png": "iVBORw0KGgo..." }
}
```

One format for both would be worse: a directory is what an artist works in, and a single file is what a person can attach to a message. The manifest is identical in both, so a pack can be converted without loss.

## Manifest

| Field | Required | Rules |
| --- | --- | --- |
| `schema` | yes | Must be `1`. Anything else is refused, not guessed at |
| `id` | yes | `^[a-z0-9][a-z0-9-]{0,63}$` — lowercase, path-safe, unique |
| `name` | yes | 1–80 characters, shown in Settings |
| `version` | no | `1.2.3` or `1.2.3-beta.1` |
| `author` | no | `{ name, url }` |
| `license` | no | SPDX identifier, e.g. `MIT` |
| `homepage` | no | URL for attribution |
| `poses` | yes | `idle` required; `happy`, `busy`, `worried` optional |
| `anchor` | no | `feet` (default), `center`, `head` — recorded; not applied yet |
| `scale` | no | 0.5–4 — recorded; not applied yet |
| `lines` | no | Per-state dialogue overrides: `{ "idle": ["..."], "happy": ["..."] }` |
| `sheets` | no | Per-state sprite sheets, for motion — see below |
| `sounds` | no | Per-event audio: `done`, `error`, `alert`, `pat` |

### Poses

| State | Meaning |
| --- | --- |
| `idle` | **required** — nothing running, or no better state known |
| `happy` | a turn just finished |
| `busy` | a turn is running, or an approval is waiting |
| `worried` | the balance read failed |

An unknown pose key is a **warning**, not an error: a pack written for a later build must still load. A missing non-idle pose falls back to `idle` at render time, so a one-image pack is the smallest valid character.

## Animated characters

Two mechanisms, both valid, and the choice is the author's:

**An animated image.** A `webp`, `gif` or animated `webp` pose animates by itself inside the `<img>` that already renders poses. No descriptor, no renderer change, no timing control.

**A sprite sheet.** A grid of frames plus a descriptor, which is the only mechanism that lets you set timing:

```json
"sheets": {
  "idle": { "file": "sheets/idle.png", "frameWidth": 216, "frameHeight": 328, "frames": 6, "fps": 8, "layout": "horizontal" }
}
```

| Field | Rules |
| --- | --- |
| `file` | Pack-relative image path, same rules as poses |
| `frameWidth`, `frameHeight` | Integers, 16–2048 px |
| `frames` | 1–60 |
| `fps` | 0 < fps ≤ 24; default 8 |
| `loop` | Boolean, default `true` |
| `layout` | `horizontal` (default), `vertical`, or `grid` |
| `columns` | Required for `grid`; 1–60. Rows follow from `frames / columns` |

The renderer draws one frame and walks the sheet with generated keyframes; duration is `frames / fps` and each frame holds rather than blending.

Layouts exist for a practical reason: **the 2048 px per-side limit makes long horizontal strips impossible** — 60 frames of 200 px would be 12,000 px wide and refused. A grid is how a long animation fits. `vertical` covers tools that export columns, and `grid` covers the output of most sprite tools and image generators, including the 2×2 sheet this plugin's own art came from.

Geometry is checked against the real image on both axes: `columns × frameWidth` must fit the width and `rows × frameHeight` the height, so a mismatched descriptor is refused at import rather than rendering as a smear.

A state may have both a pose and a sheet. The sheet wins when it renders, and the pose is the fallback if the strip fails to load.

## Sound

A pack may supply its own audio per event:

```json
"sounds": { "done": "sounds/done.wav", "error": "sounds/error.mp3", "pat": "sounds/purr.ogg" }
```

| Event | When |
| --- | --- |
| `done` | a turn finished, or a head pat |
| `error` | a balance read failed, or the balance crossed the warning line |
| `alert` | the rate class flipped, or an approval appeared |
| `pat` | a head pat, if the pack wants a distinct sound |

Formats `wav`, `mp3`, `ogg`, each ≤ 256 KB, each checked against its container signature (`RIFF…WAVE`, not merely `RIFF`; an MP3 may carry an ID3 tag or a bare frame sync). A pack sound wins over the synthesised cue; with no pack sound the built-in tone plays, so a pack never has to ship audio to be complete.

There is no licence metadata on a sound, or on anything else: these packs are personal, not distributed. The `license` field exists for the day that changes.

## What a pack may not do

These are refusals, not preferences. Each has a test.

| Rule | Why |
| --- | --- |
| No absolute paths, no `..`, no backslashes, no `.` segments | The only thing between a shared pack and writing outside its directory |
| Extensions limited to `png`, `webp`, `jpeg` | **SVG is excluded**: it can carry script and external references. A mascot is not a document |
| Bytes must match the extension's signature | A `.png` that is really a zip is not an image, and `imageSize` needs a real header |
| ≤ 512 KB per image, ≤ 256 KB per sound, ≤ 4 MB per pack, ≤ 2048 px per side | These are drawn at 84–260 px wide; anything larger is a download, not a character |
| ≤ 24 files | A character pack is art, not a file dump |
| Image bytes must be decodable headers | Dimensions are read from the header; a truncated file is refused rather than half-drawn |

Not enforced today, and worth knowing: **alpha is not required**. Both competitors ship characters with opaque backgrounds, and refusing them would be a rule about taste. The UI warns instead, because an opaque character looks wrong on a dark theme.

## Storage

```
$DSH_HOME/status-widget/
  characters/<id>/pack.json + poses/...   installed packs
  character.json                          { "active": "<id>" } or { "active": null }
  status-widget.json                      the widget's other preferences
```

The active pack is a single field, not a copy: switching characters is a write of one string, and an uninstalled pack leaves the field pointing at nothing, which renders the built-in art.

## Routes

All under the plugin's existing prefix, all `no-store`, all validating before writing.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/dsh-status-widget/characters` | Installed packs: id, name, version, pose count, bytes |
| `POST` | `/dsh-status-widget/characters` | Body is a `.dshchar`; validate, then write and report the error codes if refused |
| `DELETE` | `/dsh-status-widget/characters/<id>` | Remove; clears `active` if it pointed here |
| `POST` | `/dsh-status-widget/characters/<id>/active` | Switch to this pack |
| `DELETE` | `/dsh-status-widget/characters/active` | Switch back to the built-in character |
| `GET` | `/dsh-status-widget/characters/<id>/export` | Produce a `.dshchar` from an installed pack |
| `GET` | `/dsh-status-widget/character.png?state=busy` | Serve the pose for the active pack; falls back to the built-in art |
| `GET` | `/dsh-status-widget/character/sheet.png?state=busy` | Serve a sprite strip for that state |
| `GET` | `/dsh-status-widget/character/sound?event=done` | Serve a pack sound |

The pose route is the hot path and keeps the existing ETag revalidation, so a redrawn pose is not pinned by a stale cache.

## A worked example

[`examples/README.md`](../examples/README.md) walks through authoring a pack: the smallest valid one, adding motion, and the failure modes worth knowing. No art ships in this repository — packs are personal, and `*.dshchar` is ignored by git.

## Import and export

Both are implemented. Settings → Status widget → Character has **Import .dshchar**, **Use built-in**, **Rescan**, and a per-pack **Use** / **Export** / **Delete**; the host routes do the work, so `curl` is an equally valid client:

```sh
curl -X POST localhost:3080/dsh-status-widget/characters \
  -H 'content-type: application/json' \
  --data-binary @my-character.dshchar

curl -X POST localhost:3080/dsh-status-widget/characters/sample-cat/active
curl localhost:3080/dsh-status-widget/characters
```


**Import** — three ways, one validator:

1. **Settings → Character → Import**, picking a `.dshchar` file. The browser reads it and `POST`s the JSON.
2. **Drop a directory** into `$DSH_HOME/status-widget/characters/` and press *Rescan*. No upload, no size limits beyond the rules above.
3. **URL** (later) — deliberately not first: fetching a remote pack means the host makes an outbound request chosen by a page, which is an SSRF decision, not a convenience.

**Export** — `GET .../export` returns the installed pack as a `.dshchar`, byte-identical rules, so export → edit → import is a round trip. A test asserts the round trip.

## Failure behaviour

| Situation | What happens |
| --- | --- |
| Pack refuses validation | Nothing is written; the error codes are shown next to the import control |
| Active pack removed by hand | Falls back to the built-in art; `character.json` is left alone so re-installing the same id restores it |
| A pose file goes missing | That state falls back to `idle`; the rest of the pack still works |
| Art is the wrong size | Rendered to fit the frame; `scale` is a hint, not a promise |
| Opaque background | Warned, not refused |

## Versioning

`schema` is the only compatibility switch. Within a schema:

- Unknown manifest fields are ignored.
- Unknown pose keys are ignored with a warning.
- New optional fields may be added without a bump.

A breaking change — a renamed field, a changed meaning for `anchor` — bumps `schema`, and old builds refuse the pack rather than rendering it wrongly, which is the failure mode a user can actually diagnose.

## Why this shape

- **Manifest plus files, not one JSON blob**, because art is binary and base64 in a working file is painful for a human.
- **A single-file variant anyway**, because sharing is the point of a standard.
- **Ids, not names**, as keys: a display name changes, a directory must not.
- **Refusal by code, not by exception**, so the UI can say which rule failed instead of "invalid file".
- **Validation in one portable module**, so the rules can be read, tested and re-implemented without a running Harness.

## Not in this version

- Per-pack dialogue translations. `lines` overrides are applied as written, but there is no translation layer: the author's language is the language.
- Pack-level `anchor`/`scale` are recorded but not yet applied; the renderer uses the stance-centred crop at the widget's size.
- Remote packs by URL, for the SSRF reason above.
