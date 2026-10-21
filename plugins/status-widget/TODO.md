# status-widget — exhaustive todo

Every known gap in this plugin, in one place. Grouped by area, not by priority. `[x]` shipped, `[ ]` open, `[~]` partially done or deliberately deferred (reason given).

**Layout**

- [x] Character box is the root; bubble absolutely positioned so text cannot move her
- [x] Docked mode: side + bottom, bubble grows inward from her edge
- [x] Free mode: left + top, bubble centred above her
- [x] Docking judged by where *she* lands, not the pointer
- [x] Release re-decides the drop (fast flicks)
- [x] Docked margin from the window edge (`DOCK_MARGIN`, 32px)
- [x] **She is centred in the bubble, always** — the invariant
- [x] **One fixed frame (220px)** — docking moves the frame; nothing inside reflows, so the bubble has one shape in every mode
- [x] **Centring by flow, not transform** — the bob animation animates `transform` and cancels inline transforms; the flip uses `scale` for the same reason
- [ ] Verify the docked margin on a real screen
- [ ] Bubble should not touch the window edge when she is at Max and docked
- [x] Poses aligned on the stance rather than the bounding box
- [ ] Tail alignment when the bubble is narrower than her (point at head centre, not edge)
- [ ] Persist mode through reload — written, not verified end-to-end
- [x] Snap hysteresis: docked until clearly clear of the zone (24px band)
- [ ] Drag preview while docked: currently the preview switches modes mid-drag, which may read as a flicker

**Bubble and dialogue**

- [x] Speech-bubble shape with a tail
- [x] Line per state, cycling (idle / busy / happy / worried)
- [x] Speech survives a collapsed bubble and expands it
- [x] Dialogue never repeats the previous line
- [ ] Clicking the bubble itself (not her) should advance the line
- [ ] Timed lines: she says nothing on her own, only when clicked
- [~] Localisation — authored text is en/zh; rate labels still English

**From the catalogue** — 166 scored features live in `docs/feature-catalogue.md`; the ten highest-value are listed there. The list below is the short form.

**From the research** (see `docs/widget-research.md`)

- [x] Approval-waiting indicator — `sessionStatus.pendingInteraction`, main session preferred, background sessions counted
- [x] Context pressure bar — `contextPressure`, amber at 70%, red at 90%
- [x] One source for "running" — `sessionStatus` drives busy, turn boundaries and cost
- [ ] Plan/todo progress — **blocked**: `plan` is only `{active, pending}`; todos are tool events, a separate feature
- [x] Peak-boundary announcement — edge-detected, spoken once per flip
- [x] Per-turn cost from the `tokenUsage` projection — turn-start baseline, delta at turn end, priced at the current rate class
- [x] Low-balance warning — threshold pref, once an hour
- [x] Custom character upload — import/export/activate/delete/rescan in Settings and the Character submenu
- [x] Head pat, edge roaming, idle acts, cross-tab sync, arrow-key menu nav
- [ ] Quiet mode, copy-balance-on-click, four-edge snapping, notification when the tab is hidden
- [~] Today's spend, provider matrix, per-module styling, detached desktop window — deliberately out of scope, with reasons in the research note

**Sound**

- [x] Synthesised cues (no assets): a chime when a turn finishes, a lower tone on a balance failure
- [x] Off by default; persisted in `$DSH_HOME` and `localStorage`
- [x] Toggle in Settings → Status widget
- [ ] No volume control, no per-event choice
- [ ] No cue for a rate boundary crossing

**Character states and animation**

- [x] Four drawings, one per state, shared canvas and scale
- [x] Busy on `api-session/status`, happy for 2.5s after a turn
- [x] Worried on balance failure
- [x] CSS bob, faster while busy, hop when happy
- [x] `prefers-reduced-motion` disables all of it
- [ ] Worried is only reachable through a balance error; no way to preview a state
- [ ] No expression for "rate just changed" (peak boundary crossed), which is the plugin's whole subject

**Data**

- [x] Balance from the credential store, host-side, amounts as strings
- [x] 60s cache, collapsed concurrent reads
- [x] Named failures: no-key, http-401, timeout, network, credential-store-error
- [ ] Today's spend — needs session-log accounting (own project)
- [ ] Balance route has no auth beyond the Host cookie; fine locally, worth a note if ever exposed
- [ ] Nothing shows *which* provider/key resolved, so a wrong key looks like a network error

**Preferences and settings**

- [x] Size in `$DSH_HOME/status-widget.json`, host route, validated
- [x] Same choice in Settings → Status widget, live
- [x] `localStorage` fallback
- [ ] Prefs are written but a concurrent second tab's change is not picked up until reload
- [x] Reset position restores the default dock and size
- [ ] No way to see which store answered (file vs localStorage)

**Menu**

- [x] Right-click menu, Size submenu, four sizes
- [x] Closes on outside click and Escape
- [x] Submenu flips left near the right edge
- [x] Keyboard: Shift+F10 opens, Enter speaks
- [x] **Arrow-key navigation inside the menu** — arrows/Home/End walk each panel, ArrowRight enters, ArrowLeft returns
- [x] Menu extracted to `renderMenu(view)`, walked by tests
- [x] Menu has Size and Reset position; sound lives in Settings

**Accessibility**

- [x] Focusable widget, aria-label, roles on menu items
- [x] `prefers-reduced-motion`
- [ ] Status is visual only — a screen reader gets the aria-label, not the live rate
- [ ] Focus ring is browser default against a `Canvas` background
- [ ] Contrast of the 0.7-opacity hint line is unverified

**Performance and lifecycle**

- [x] 1s clock tick, 60s balance poll, refetch on tab visible
- [ ] The 1s tick re-renders the whole widget; fine now, wasteful later
- [ ] No cleanup test for the activity subscription (leaks if apply runs twice)

**Tests**

- [x] Schedule, parity with rate-hours, and the public-holiday limitation pinned by a test
- [x] Balance normalisation, request, cache
- [x] Host routes: balance, mascot, prefs, ETag, validation
- [x] Placement maths, drop decision, mascot states
- [x] Bundle hygiene (duplicate declarations)
- [x] Drag, release outcomes, menu navigation and submenus are driven by `test/interaction.test.mjs` through extracted pure functions
- [ ] No browser test at all; every visual bug so far was found by you, not CI

**Packaging and docs**

- [x] README with behaviour, install, limits, tests
- [x] Roadmap and this file
- [ ] Not published; `private: true`
- [ ] No screenshot in the README
- [ ] No CHANGELOG
