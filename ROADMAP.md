# Roadmap

Where this repo is, what is worth doing next, and what is deliberately parked. Ordered by value, not by effort.

**Deployment:** one person, one local web Host. This is not a product: accessibility, publishing, browser-test infrastructure, remote-route auth and multi-tab coordination are deliberately out of scope and listed under [Parked on purpose](#parked-on-purpose).

**State:** `status-widget` is the live plugin; `hello` is the linked smoke test; `rate-hours` is kept as the schedule reference and excluded from the `web` profile. 8 test suites.

## Done in this pass

Click dialogue · host-side preferences in `$DSH_HOME` · settings section · ETag on both routes · keyboard access (Shift+F10, arrows/Home/End, submenu entry and return) · character packs with import/export/activate/delete/rescan · interaction tests for drag, release and menu keys · annual holiday table removed rather than maintained · `Today` estimate for the local day · Max-size dock margin accounts for the character overhang.

## Next

Only things a single user would notice:

- **Sound controls** (S) — the cues are fixed on/off today. Add a volume slider and per-event choice, and a cue for a rate boundary if it earns its noise.
- **Dialogue controls** (S) — timed lines (she says something on her own) and a quiet mode; clicking the bubble already advances the line.
- **Drag preview** (XS) — the docked preview switches modes mid-drag, which can read as a flicker.
- **State preview** (XS) — `worried` is only reachable through a balance failure, and there is no expression for "the rate just changed"; a menu action to preview a state would make the art testable by eye.
- **Verify mode through reload** (XS) — placement is written and host-persisted, but the end-to-end reload has not been checked.
- **Provider/key visibility** (S) — a wrong credential currently looks like a network error; say which key resolved.
- **1s tick and subscription cleanup** (S) — the whole widget re-renders every second, and the activity subscription has no cleanup test.

### Blocked

- **Plan/todo progress** — `plan` is only `{active, pending}`; todos are tool events, a separate feature.

## Parked on purpose

- **An annual Chinese-holiday table.** Dropped deliberately: it needs a State Council notice every November, a forecast mis-prices days when the notice is late, and a wrong holiday is invisible in the UI. Both badges run the weekday rule and say in the tooltip that public holidays are not tracked.
- **Accessibility work.** A personal, sighted single-user setup; the remaining items are recorded in [`TODO.md`](plugins/status-widget/TODO.md) rather than planned.
- **Publishing.** No package, no CHANGELOG, no README screenshot, `private: true`.
- **Browser-test infrastructure and CI.** Visual bugs are found by the user; the pure-function suite is the regression net.
- **Multi-tab coordination and remote-route auth.** One user, one tab, local Host.
- **A gallery of mascots.** One good character beats a shop.
- **Per-line style/typography authoring.** That is how the reference plugin reached 22k lines; it is configuration UI masquerading as personality.
- **Desktop-specific code paths.** The bundle is shared; only storage differs.
- **Docker/devcontainer setup.** `./setup.sh` already takes a bare machine to a working GUI.

## How work lands here

Every item above follows the same shape, and the repo's conventions already enforce it:

1. A test that fails for the reason the feature exists.
2. The smallest change that satisfies it.
3. A README line for anything a user would notice, and a `Limits` entry for anything they might assume wrongly.
