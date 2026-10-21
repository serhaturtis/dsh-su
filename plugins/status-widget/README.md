# dsh-status-widget

A speech bubble in the bottom-right corner, in which the **account balance** and the **DeepSeek rate class** appear as her dialogue — with a tail that points down at the character speaking them.

```
● ¥110.00 · Off-peak · peak in 13h 39m
```

She also **drifts slowly along a docked edge when left alone**, does something occasionally while quiet (stretches, taps the fuselage), **announces the peak boundary** the moment it flips, warns once an hour when the balance falls under your threshold, and **purrs if you pat her head** — press the top third rather than the body. Menu and dialogue text follow the browser language (English or Chinese); rate labels are still English.

While a turn runs, a thin bar under the bubble shows how full the context window is — green, amber at 70%, red at 90% — from the `contextPressure` projection. It hides itself when no provider has reported capacity, because an unknown window is not an empty one.

When a turn finishes, the bubble adds a third line: **`Last turn $0.0042`**. That is the delta between two readings of the `tokenUsage` projection — the four provider-reported buckets — priced with the published list rates at whatever rate class was in force. Off-peak is exactly half, and a test holds that relationship rather than hard-coding both columns.

Each finished turn also feeds **`Today $0.123`**, a running estimate for your local day kept in this browser's storage. It resets at local midnight. This is not account spend: it counts model tokens for turns this page watched, priced the same way as `Last turn`.

When a turn is blocked waiting for your approval, she leans in, the line becomes **"Waiting for your approval"**, the dot turns red and pulses, and a cue plays if sound is on. That signal comes from `uiSession.sessionStatus.pendingInteraction` — a push-based store, so it costs one subscription and no polling.

A black Norwegian Forest cat with a white mask stands under it, in one of eight drawings: **idle**, **happy** (a turn just finished), **busy** (a turn is running), **worried** (the balance read failed), **sleepy** (ten quiet minutes), **wave** (first sighting), **pat** (a head pat) and **party** (the balance went up). She bobs while idle, hops when happy and leans in while busy. **Drag her anywhere (the bubble comes along)** — she snaps to the nearer edge and flips to face into the page. Click her to collapse the card to the balance alone.

The art is raster, one PNG per state. There is no vector fallback: a second drawing of the same character drifts away from the generated one, and a missing image is better reported than silently replaced by a different animal.

Hover for the full picture: the schedule and its next boundary, the granted/topped-up split, and how fresh the reading is.

This is the feature set of the popular whale widget, built as an ordinary DSH plugin rather than a 22,000-line script injected into the page.

## Behaviour

- **Balance** comes from [`GET /user/balance`](https://api-docs.deepseek.com/api/get-user-balance), read by the host half with the key from the credential store and served to the browser as amounts only. The key never reaches the page. Amounts pass through as the decimal strings the API returns — no float arithmetic on money.
- **The reading is cached for 60 seconds** in the host, so a page left open for an hour costs one request per minute, and concurrent tabs share one read.
- **Failures are named, not blank**: `no API key`, or `balance ?` for a rejected key or a network problem, each explained in the tooltip. Polling continues once a minute, so a fixed key recovers without a reload.
- **The rate line** follows the same rule as [`rate-hours`](../rate-hours/README.md): peak `01:00–04:00` and `06:00–10:00` UTC, Monday–Friday. Chinese public holidays are **not tracked**; DeepSeek bills them off-peak, so a holiday weekday shows as peak here. The tooltip states that limitation.

The mascot — a cat in the corner that reacts to turns, rate changes and a low balance — is replaceable; the format is in [`docs/character-packs.md`](docs/character-packs.md).

## Install

```sh
node scripts/bootstrap.mjs      # links every plugin in the repo
```

or this plugin alone:

```sh
dsh plugin --profile web add ./plugins/status-widget
```

Needs `DEEPSEEK_API_KEY` in the credential store — Settings → Models, or the environment when the Host starts.

### The artwork

Four drawings, one per state: `assets/mascot-{idle,happy,busy,worried}.png`, all 432×788. They come from a single generated 2×2 expression sheet, cut apart with **one shared canvas, one scale, and alignment on her stance** — the horizontal centroid of the lowest 12% of each figure. Centring on the bounding box was wrong: a raised arm moves the box centre, which left two poses looking off-centre by up to 25px.

`assets/mascot.png` is a byte copy of the idle drawing: it is the URL an already-cached page asks for, and the fallback for an unknown state.

The design is deliberately alluring — harness-style crop top, fishnets, thigh-highs, peace sign — and deliberately clothed. Nudity and see-through fabric are out of scope for this artwork, whatever the prompt. The host serves them at `/dsh-status-widget/mascot.png?state=<state>`, because a client bundle cannot require a relative asset and inlining ~300 KB of base64 would ride in every page load. Responses carry an ETag and revalidate, so a redrawn face is not pinned by a stale cache.

An inline SVG is the fallback: if the route 404s or the file is missing, the corner still has a character in four expressions instead of a hole. `test/character.test.mjs` pins the properties that matter — PNG signature, alpha channel, at least 2× display size, under 400 KB.

### Preferences

Size and position are stored in `$DSH_HOME/status-widget.json`, written by a `PUT /dsh-status-widget/prefs` route and read back on load. That is deliberate: the web GUI and the desktop client do not share `localStorage`, so browser-only state would disagree between them. `localStorage` remains the offline fallback.

The same choice is available in **Settings → Status widget**, which shares the widget's live size store rather than keeping a copy — pick a size there and the mascot changes immediately.

### Placement modes

| Mode | Anchor | Bubble |
| --- | --- | --- |
| **Docked** | side edge + 32px margin, moving the whole frame | identical shape in every mode |
| **Free** | left/top where you dropped her | identical shape in every mode |

**Two invariants.**

1. She is always centred in the bubble.
2. The widget is one fixed-width frame (**220px, equal to the bubble's cap**). The character is centred in it, the bubble is centred on her, and docking *moves the frame*. Nothing inside reflows because of docking, so the bubble keeps one shape and she keeps one place in it. Because the frame equals the cap, the bubble can never stick out past the frame.

The frame is a constant rather than derived from the bubble's text on purpose: a layout that adapts to its content is what made her drift in the first place.

**Centring is done by the flow, never by transforms.** The frame is a flex column with `alignItems: center`, so the bubble and the character are centred by layout. This matters: the idle animation animates `transform`, and CSS animations outrank inline styles — centring with `translateX(-50%)` was being cancelled by the bob animation, which is what made her sit off-centre. The left-edge flip uses the standalone `scale` property for the same reason.

Dragging within 48px of a side docks; anywhere else is free. Both modes are persisted (host-side preferences, `localStorage` as the fallback) and both are repaired on resize rather than stranded off-screen.

The root element is exactly the character's box — the bubble is absolutely positioned around it. That is what makes the text unable to move her: the layout no longer depends on the bubble's width at all.

### Sound

Synthesised with WebAudio — two short tones, no audio files to ship or license. A chime when a turn finishes, a lower tone when the balance read fails. **Off until switched on**, in Settings or by preference; the choice is stored host-side with the rest.

### Cost, honestly

The figure covers **model tokens only**, priced at list rates for the model chosen in Settings (Flash by default). It cannot see account credits, negotiated discounts, retries billed elsewhere, or a mid-turn model switch. Cache writes are priced as ordinary input, because DeepSeek publishes a cache read discount but no separate write premium. A delta that goes negative — possible if compaction resets the fold — is clamped to zero rather than reported as a refund. `Today` is the sum of these same estimates, so it inherits every one of those limits.

## Limits

- **The balance is the account's, not the session's.** It says what is left, not what this conversation has cost.
- **No usage history beyond today.** The `Today` estimate keeps only the current local day; the whale derives full spend from session logs, which is a much larger claim than this widget makes.
- **One product assumption:** the credential is the DeepSeek API key. A profile signed in through the DeepSeek *account* provider has no `DEEPSEEK_API_KEY`, so the card says so instead of reading nothing.
- **The art is generated, not drawn to the grid.** Judge it at 180 px wide — the size it actually ships. The four states are one generation, so continuity between poses is only as good as the sheet was.
- **Chinese public holidays are not tracked.** The badge runs the weekday peak rule year-round. DeepSeek bills holidays off-peak, so a holiday weekday is shown as peak; the tooltip says so rather than shipping a table that needs a State Council notice every November.
- **`Today` is an estimate, not a bill.** It lives in this browser's storage, counts only turns the page watched, resets at local midnight, and two tabs watching one turn can each add it. It cannot see account credits, discounts, or turns that happened while the page was closed.
- **The schedule is duplicated** from `rate-hours` rather than imported: client bundles cannot require each other without a cross-plugin dependency, and either plugin should work alone. [`test/schedule-parity.test.mjs`](test/schedule-parity.test.mjs) drives both copies over every 15-minute sample of 2026-2027 and fails if they diverge.

## Feature catalogue

[`docs/feature-catalogue.md`](docs/feature-catalogue.md) lists **166 candidate features** with effort and value, drawn from the three DSH widgets plus Shimeji, Desktop Goose, Tamagotchi-style pets and VS Code Pets. 26 are shipped; the rest are scored and IDed (`E03`, `F07`, …) so commits and issues can reference them.

## Character packs

A standard for replacing the mascot: a directory (`pack.json` + images) or a single shareable `.dshchar` file, with the same manifest in both. Nobody's character art ships with this repository: the format is public, the art is personal. [`examples/README.md`](examples/README.md) walks through authoring one — the smallest valid pack, motion, and the mistakes that produce drifting or cropped frames.

Import, export, activate, delete and **Rescan** are live in Settings → Status widget → Character and over the host routes; the right-click Character submenu offers the same switch and import. The format, its refusals, the storage layout, routes, import/export and versioning rules are specified in [`docs/character-packs.md`](docs/character-packs.md); the rules themselves live in [`src/pack.js`](../src/pack.js) with 16 tests, deliberately free of Node and DOM so the format can be checked without a running Harness.

Packs may carry **animated characters** — an animated GIF/WebP, or a sprite sheet with `frames`/`fps` in horizontal, vertical or grid layout — and **their own sounds** per event (`done`, `error`, `alert`, `pat`), which win over the built-in cues. The renderer, the per-state routes and the Settings controls are implemented and tested end to end.

## Research

Which client-side signals a root-scope widget can read, and what they unlock: [`docs/client-data-sources.md`](docs/client-data-sources.md) — including the finding that pending approvals come from `sessionStatus.pendingInteraction`, not from the `permissions` projection.


What the three most-installed character widgets in this ecosystem actually ship, which of their features are worth copying, and which ones are a configuration product wearing a mascot: [`docs/widget-research.md`](docs/widget-research.md).

## Todo

Every known gap in this plugin — layout, dialogue, a11y, tests, packaging — is listed in [`TODO.md`](TODO.md), with the shipped items marked.

## Tests

```sh
node test/balance.test.mjs          # normalization, the request, the cache
node test/host.test.mjs             # route, missing key, throwing store
node test/client.test.mjs           # bundle handshake, slot, rendered tree
node test/interaction.test.mjs      # drag, click/pat, menu focus and submenus
node test/character.test.mjs        # four state drawings, placement maths
node test/pack.test.mjs             # character-pack format and refusals
node test/schedule-parity.test.mjs  # this widget's schedule == rate-hours'
```

No Harness runtime and no network: the balance fetch is injected, and the component renders against a React stub — the browser shell ships its own React, so there is none on disk here.
