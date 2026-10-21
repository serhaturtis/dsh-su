# Roadmap

Where this repo is, what is worth doing next, and what is deliberately parked. Ordered by value, not by effort. Each item says why it matters and what it costs.

**State:** 3 plugins (`hello`, `rate-hours`, `status-widget`), 9 test suites. `status-widget` is the live one; `hello` is the linked smoke test; `rate-hours` stays as the schedule reference and an optional composer variant.

## Done in this pass

Click dialogue · host-side preferences in `$DSH_HOME` · settings section · ETag on both routes · keyboard access (Shift+F10, Enter to speak) · source-of-truth markers on the schedule · `rate-hours` formally classified as a reference implementation.

What is left is listed below with the reason it is still open.

## Deadlines

| When | What | Why it bites |
| --- | --- | --- |
| **Early Nov 2026** | Replace the provisional 2027 table | The State Council notice lands around then. A forecast table is in place and labelled as such, so the suite stays green; the spans still need replacing when the notice is published |

## Next

Three things, in order.

### 1. Click dialogue (S) — **done**

Clicking her currently collapses the bubble; clicking should also *say something* — the thing that makes a character feel alive.

- Cycle a short script per state: rate line, balance, next boundary, a grumble about peak pricing.
- The bubble already renders arbitrary text; this is a queue plus a click handler, not new UI.
- Do not fight the drag: `CLICK_SLOP` already distinguishes a click from a drag.

### 2. Host-side preferences (M) — **done**

Position and size live in `localStorage`, so the web GUI and the desktop client each keep their own copy — the exact bug the reference widget's users hit.

- Move placement + size behind the existing `readPlacement`/`writePlacement` seam, served by a `GET/PUT /dsh-status-widget/prefs` route and stored in `$DSH_HOME`.
- `localStorage` stays as the offline fallback.
- Prerequisite for any settings UI: two sources of truth would be worse than one.

### 3. Settings section (M) — **done, minimal**

A Settings → Plugins panel for size, sound, and "show balance / show rate".

- The right-click menu is fine for one dimension; it does not scale to six.
- Reuse the same prefs store as #2.
- The locale service exists (`ctx.locale`) and this widget is English-only; a settings panel is the natural moment to add strings.

## Later

### Widget and character

- **Sound cues** (M) — muted by default, per the decision recorded in the character plan. Three or four short cues: turn finished, low balance, error.
- **Custom image upload** (M) — **done**: `.dshchar` import/export, activate, delete and Rescan live in Settings → Status widget → Character and in the right-click Character submenu; the host routes own validation and storage.
- **Keyboard access** (S) — **done**: the widget is focusable, Shift+F10 opens the menu and moves focus to its first row, Enter/Space speak, and arrows/Home/End walk each menu panel (ArrowRight enters a submenu, ArrowLeft returns).
- **Today's spend** (L) — requires session-log accounting. Its own project, not a slice; do not start it casually.
- **Tail/offset tuning** (XS) — the bubble overhangs her at Max size; needs a look on a real screen. Docking now pins her to the edge with the bubble growing inward, which removes the worst of it.

### Data correctness

- **2027 holidays** (S, deadline) — **provisional**: both tables carry the fixed lunar dates and a `PROVISIONAL_YEARS` marker; the tooltip and the coverage test say the State Council notice is still pending. Replace the spans when it lands.
- **ETag on the balance route** (XS) — **done** — it sends `no-store`, so every poll is a full request. Cheap win, same pattern as the mascot route.
- **Schedule changes** (S) — **documented**: both copies cite the pricing page as the source of truth and name the parity test, which now drives 2026-2027.

### Repo and tooling

- **Decide `rate-hours`' fate** (S) — **decided**: keep it as the schedule reference and a re-enablable composer variant; its README says so.
- **Interaction tests** (M) — **done**: drag start/move/release, the four release outcomes, menu navigation and submenu transitions were extracted into pure functions and are driven by `test/interaction.test.mjs`; no jsdom was added.
- **Publish path** (S) — nothing is published; when that changes, `private: true` comes off and the build question returns (a TypeScript client half would need one).

## Parked on purpose

- **A gallery of mascots.** One good character beats a shop.
- **Per-line style/typography authoring.** That is how the reference plugin reached 22k lines; it is configuration UI masquerading as personality.
- **Desktop-specific code paths.** The bundle is shared; only storage differs, and #2 closes that.
- **Docker/devcontainer setup.** `./setup.sh` already takes a bare machine to a working GUI.

## How work lands here

Every item above follows the same shape, and the repo's conventions already enforce it:

1. A test that fails for the reason the feature exists.
2. The smallest change that satisfies it.
3. A README line for anything a user would notice, and a `Limits` entry for anything they might assume wrongly.
