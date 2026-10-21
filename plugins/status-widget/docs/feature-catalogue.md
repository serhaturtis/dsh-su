# Feature catalogue

Every feature worth considering for this widget, drawn from the shipped DSH character widgets ([whale](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget), [dsh-pet](https://github.com/PC2005-cloud/dsh-pet), [dafeiyu](https://github.com/QCYTSN/dafeiyu)) and from the wider desktop-pet canon: [Shimeji](https://github.com/gil/shimeji-ee) (climbing, throwing, ceiling hangs), [Desktop Goose](https://sourceforge.net/app/desktop-goose/) (dragging windows, leaving notes), Tamagotchi-style virtual pets (needs that decay), [VS Code Pets](https://github.com/tonybaloney/vscode-pets) (play, themes), and oneko/neko (screen roaming).

**Legend** — effort: `S` ≤ half a day, `M` a day or two, `L` a project. Value: `★★★` do it next, `★★` worth it, `★` nice-to-have. `✓` already shipped. `[P]` needs a host route or filesystem access, `[A]` needs new artwork.

IDs are stable so they can be referenced in commits and issues.

## A. Presence and locomotion (14)

| ID | Feature | E | V | Notes |
| --- | --- | --- | --- | --- |
| A01 | Dock left/right | ✓ | ★★★ | shipped |
| A02 | Dock top/bottom | S | ★★ | same maths, axes swapped |
| A03 | Corner docking | S | ★★ | two axes at once |
| A04 | Snap hysteresis | ✓ | ★★ | 24px band |
| A05 | Free placement | ✓ | ★★★ | shipped |
| A06 | Roam along the docked edge | ✓ | ★★★ | drifts 8px every 3s while docked and idle |
| A07 | Roam across the whole viewport | M | ★★ | needs pathing that respects the composer |
| A08 | Throw with inertia and bounce | M | ★★★ | Shimeji's signature; velocity from the last pointer samples |
| A09 | Gravity after a drop | M | ★★ | falls to the floor line, lands with squash |
| A10 | Cling to the window edge | L | ★ | Shimeji's ceiling hang; needs art and a state machine |
| A11 | Peek in from off-screen | M | ★★ | half-hidden until clicked |
| A12 | Sleep after inactivity | S | ★★★ | one timer, one pose |
| A13 | Wake on agent activity | S | ★★★ | pairs with A12 |
| A14 | Walk to the active session | L | ★ | requires knowing which session has focus |

## B. Idle behaviour and animation (13)

| ID | Feature | E | V | Notes |
| --- | --- | --- | --- | --- |
| B01 | Idle bob | ✓ | ★★★ | shipped |
| B02 | Random idle acts | ✓ | ★★★ | a line every ~90s of quiet, cycling |
| B03 | Blink | M | ★★★ | `[A]` needs eyelids or a blink frame |
| B04 | Look toward the cursor | S | ★★ | cheap transform toward pointer |
| B05 | Time-of-day pose | S | ★★ | night pose after 23:00 |
| B06 | Seasonal outfit | M | ★★ | `[A]` |
| B07 | Follow the page theme | S | ★★ | `prefers-color-scheme` swap |
| B08 | Stretch and yawn | M | ★ | `[A]` |
| B09 | Read a book while busy | M | ★★ | `[A]`, matches "busy" |
| B10 | Celebration dance | M | ★★ | on milestone or long task done |
| B11 | Shiver when balance is low | S | ★★ | reuses worried pose with a shake |
| B12 | Reduced-motion still pose | ✓ | ★★★ | shipped via media query |
| B13 | Idle pose variety from time | S | ★ | rotate between the four existing poses |

## C. Direct interaction (15)

| ID | Feature | E | V | Notes |
| --- | --- | --- | --- | --- |
| C01 | Click to speak | ✓ | ★★★ | shipped |
| C02 | Head pat | ✓ | ★★★ | press the top third; draws from a pat script |
| C03 | Poke the body | S | ★★ | squash on click |
| C04 | Ticklish spots | S | ★★ | different reactions per region |
| C05 | Drag | ✓ | ★★★ | shipped |
| C06 | Double-click to collapse | S | ★★ | alternative to the chevron |
| C07 | Right-click menu | ✓ | ★★★ | shipped |
| C08 | Hover peek | ✓ | ★★ | via `title` today; a styled tooltip is better |
| C09 | Keyboard speak | ✓ | ★★ | Enter/Space |
| C10 | Petting streak counter | S | ★ | "you have patted her 47 times" |
| C11 | Feed her | M | ★ | animation + a treat counter; pure theatre |
| C12 | Play fetch | M | ★★ | a ball that falls and bounces |
| C13 | Shake to wobble | M | ★★ | pointer velocity drives a spring |
| C14 | Long-idle remark | S | ★★ | speaks unprompted after N minutes idle |
| C15 | Reaction to rapid clicks | S | ★★ | dizzy pose after five clicks in two seconds |

## D. Speech and bubbles (11)

| ID | Feature | E | V | Notes |
| --- | --- | --- | --- | --- |
| D01 | Bubble queue | ✓ | ★★★ | shipped |
| D02 | Multiple lines per state | ✓ | ★★★ | shipped |
| D03 | No repeated line | ✓ | ★★ | shipped |
| D04 | Lines that know what happened | M | ★★★ | "that turn cost 4¢" needs F02 |
| D05 | Links in bubbles | S | ★★ | render markdown links safely |
| D06 | Images in bubbles | M | ★ | `[P]` asset route |
| D07 | Auto-hide after N seconds | ✓ | ★★ | 5s today, make it a pref |
| D08 | Bubble avoids screen edges | S | ★★ | currently clipped at the top |
| D09 | Whisper mode | S | ★ | smaller text, less intrusive |
| D10 | Localisation | ~ | ★★★ | authored text (dialogue, acts, menu) is en/zh; rate labels still English |
| D11 | User-editable lines | M | ★★ | `[P]` prefs |

## E. Agent status (15)

| ID | Feature | E | V | Notes |
| --- | --- | --- | --- | --- |
| E01 | Turn running | ✓ | ★★★ | `api-session/status` |
| E02 | Turn finished celebration | ✓ | ★★★ | shipped |
| E03 | **Approval waiting** | ✓ | ★★★ | shipped via `uiSession.sessionStatus.pendingInteraction` |
| E04 | Permission prompt highlight | ~ | ★★★ | dot pulse and cue shipped; a stronger visual is still open |
| E05 | Plan / todo progress | — | — | **not available**: the `plan` projection is only `{active, pending}` (plan *mode*), not a todo list. Todo items arrive as tool-call events; showing them means reading the event stream — a different feature |
| E06 | Current tool line | M | ★★ | "reading foo.ts" in the bubble |
| E07 | Error state | ✓ | ★★★ | shipped via balance failure |
| E08 | Subagent activity | M | ★★ | count and label running children |
| E09 | Compaction / paused state | S | ★★ | cheap signal |
| E10 | Queued message count | M | ★ | inbox projection |
| E11 | Long-turn timer | S | ★★ | "running 4m" |
| E12 | Context pressure | ✓ | ★★ | shipped from `contextPressure`, colour-coded bar |
| E13 | Rate-limit warning | S | ★★ | on 429 from the balance route |
| E14 | Session title in the tooltip | S | ★ | cheap context |
| E15 | Idle with no session | S | ★★ | distinguish "nothing running" from "disconnected" |

## F. Money and rate (14)

| ID | Feature | E | V | Notes |
| --- | --- | --- | --- | --- |
| F01 | Balance | ✓ | ★★★ | shipped |
| F02 | **Per-turn cost** | ✓ | ★★★ | shipped: `tokenUsage` delta × list rates, model pref |
| F03 | Today's spend | L | ★★ | needs a durable ledger; the whale's largest subsystem |
| F04 | Seven-day sparkline | M | ★★ | needs F03 |
| F05 | Daily budget + alert | M | ★★ | needs F03 |
| F06 | Low-balance threshold | ✓ | ★★★ | pref threshold, warns once an hour |
| F07 | **Peak-boundary announcement** | ✓ | ★★★ | edge-detected on the clock tick, spoken once |
| F08 | Countdown to the boundary | ✓ | ★★★ | shipped |
| F09 | Next-turn cost estimate | M | ★★ | input tokens × rate |
| F10 | Rate-class history strip | M | ★★ | last 24h at a glance |
| F11 | Currency preference | S | ★★ | show USD, CNY, or both |
| F12 | Balance delta this hour | S | ★★ | from the cache |
| F13 | Holiday-aware rate | ✓ | ★★★ | shipped, and neither competitor has it |
| F14 | Monthly invoice view | L | ★ | a spreadsheet, not a mascot |

## G. Sound (8)

| ID | Feature | E | V | Notes |
| --- | --- | --- | --- | --- |
| G01 | Turn-end cue | ✓ | ★★ | synthesised |
| G02 | Error cue | ✓ | ★★ | synthesised |
| G03 | Click / pat cue | S | ★★ | one more oscillator |
| G04 | Ambient idle loop | M | ★ | `[P]` audio asset, and most people mute it |
| G05 | Volume control | S | ★★ | gain node |
| G06 | Per-event toggles | S | ★★ | table lookup |
| G07 | Custom clips | ~ | ★★ | pack sounds shipped: per-event files, validated, supersede the synth cues |
| G08 | Quiet hours | S | ★★ | time window |

## H. Notifications and integrations (9)

| ID | Feature | E | V | Notes |
| --- | --- | --- | --- | --- |
| H01 | Desktop notification on completion | M | ★★ | `Notification` API, permission-gated |
| H02 | Notify only when the tab is hidden | M | ★★★ | the case that matters |
| H03 | Webhook on completion | M | ★★ | `[P]` |
| H04 | Terminal bell | S | ★ | niche |
| H05 | Tray / menu-bar presence | L | ★ | desktop app territory |
| H06 | IM bridge | L | ★ | other plugins own this |
| H07 | Copy status to clipboard | S | ★★ | balance, rate, next boundary |
| H08 | Share a status image | M | ★ | screenshot without a canvas dependency |
| H09 | Windows/macOS toast via host | L | ★ | `[P]` native |

## I. Appearance (12)

| ID | Feature | E | V | Notes |
| --- | --- | --- | --- | --- |
| I01 | Four pose drawings | ✓ | ★★★ | shipped |
| I02 | Custom character upload | ✓ | ★★★ | format, validator, routes, Settings panel, import/export |
| I03 | Character packs | ~ | ★★ | format shipped with poses, sheets and sounds; import surface outstanding |
| I04 | Size presets | ✓ | ★★★ | shipped |
| I05 | Continuous size slider | S | ★★ | replaces four buttons |
| I06 | Mirror on left dock | ✓ | ★ | shipped via `scale` |
| I07 | Shadow / glow control | S | ★ | one style value |
| I08 | Theme-aware palette | ~ | ★★ | art is fixed-colour; needs a tint or a second set |
| I09 | Seasonal skins | M | ★★ | `[A]` |
| I10 | Bubble style variants | S | ★★ | rounded / square / tail-less |
| I11 | Bubble font size | S | ★★ | one pref |
| I12 | Hide character, keep bubble | S | ★★ | "just the numbers" mode |

## J. Settings and control (10)

| ID | Feature | E | V | Notes |
| --- | --- | --- | --- | --- |
| J01 | Right-click menu | ✓ | ★★★ | shipped: size, sound, roaming, reset — same stores as Settings |
| J02 | Settings section | ✓ | ★★★ | shipped |
| J03 | Reset position | ✓ | ★★ | shipped |
| J04 | Export / import preferences | S | ★★ | JSON round-trip |
| J05 | Presets (compact / normal / loud) | S | ★★★ | one click instead of six |
| J06 | Quiet mode | S | ★★★ | hide everything until asked |
| J07 | Hide for this session | S | ★★ | auto-restores next boot |
| J08 | Per-profile settings | S | ★ | the prefs file is already per home |
| J09 | Debug panel | S | ★★ | shows the resolved placement, size, prefs source |
| J10 | Feature flags | S | ★ | overkill until features outnumber toggles |

## K. Accessibility (8)

| ID | Feature | E | V | Notes |
| --- | --- | --- | --- | --- |
| K01 | Keyboard access | ✓ | ★★★ | shipped |
| K02 | Arrow-key menu navigation | ✓ | ★★★ | arrows move the highlight, Enter picks |
| K03 | Screen-reader live region | S | ★★★ | announce rate changes and approvals |
| K04 | Reduced motion | ✓ | ★★★ | shipped |
| K05 | Visible focus ring | S | ★★ | currently browser default |
| K06 | High-contrast mode | S | ★★ | `forced-colors` |
| K07 | Colour-blind-safe status | S | ★★ | dot colour + shape, not colour alone |
| K08 | Art has text alternative | S | ★★ | `aria-hidden` now; a label would be better |

## L. Persistence and sync (7)

| ID | Feature | E | V | Notes |
| --- | --- | --- | --- | --- |
| L01 | Position persisted | ✓ | ★★★ | host-side |
| L02 | Preferences host-side | ✓ | ★★★ | shipped |
| L03 | Live sync across tabs | ✓ | ★★★ | `storage` event re-reads every preference |
| L04 | Sync across devices | M | ★ | needs a remote store |
| L05 | Per-workspace override | M | ★ | different sizes per project |
| L06 | Migration of old formats | ✓ | ★★ | shipped twice already |
| L07 | Prefs file version field | S | ★ | future-proofing |

## M. Performance and reliability (9)

| ID | Feature | E | V | Notes |
| --- | --- | --- | --- | --- |
| M01 | Cached balance | ✓ | ★★★ | shipped, 60s |
| M02 | Visibility-aware polling | ✓ | ★★★ | shipped |
| M03 | Error backoff | S | ★★ | stop hammering a broken key |
| M04 | Render throttle for the clock | S | ★★ | 1s tick re-renders everything |
| M05 | Duplicate-declaration guard | ✓ | ★★★ | shipped after two outages |
| M06 | Subscription leak guard | S | ★★★ | apply twice must not double-subscribe |
| M07 | Route auth beyond the Host cookie | S | ★ | document the exposure, don't fix locally |
| M08 | Offline state | S | ★★ | "no network" is not "no key" |
| M09 | Request timeout surfacing | ✓ | ★★ | shipped |

## N. Testing and tooling (9)

| ID | Feature | E | V | Notes |
| --- | --- | --- | --- | --- |
| N01 | Schedule parity | ✓ | ★★★ | shipped |
| N02 | Layout maths | ✓ | ★★★ | shipped |
| N03 | Menu tree | ✓ | ★★★ | shipped |
| N04 | State-machine tests | M | ★★★ | drive heads without a DOM |
| N05 | Browser smoke test | L | ★★★ | the gap that produced every visual bug |
| N06 | Art regression (dimensions, alpha) | ✓ | ★★ | shipped |
| N07 | Art pipeline script | M | ★★ | slicing is currently manual |
| N08 | Catalogue tracking | S | ★★ | this file, kept current |
| N09 | CI on every push | ✓ | ★★★ | shipped |

## O. Delight (10)

| ID | Feature | E | V | Notes |
| --- | --- | --- | --- | --- |
| O01 | Fortune on click | S | ★★ | a rotating quote pool |
| O02 | Pomodoro mode | M | ★★ | 25-minute focus with a break pose |
| O03 | Pet streak counter | S | ★ | persisted count |
| O04 | Achievements | M | ★★ | "first 100 turns", "patted 1000 times" |
| O05 | Anniversary message | S | ★ | on install date |
| O06 | Weather-aware lines | M | ★ | `[P]` external API, not worth the dependency |
| O07 | Mood system | M | ★★ | decay and recovery, Tamagotchi-style |
| O08 | Name her | S | ★★ | one string, used in bubbles |
| O09 | Hidden animation on rapid clicks | S | ★★ | C15 |
| O10 | Confetti on a milestone | S | ★★ | canvas-free: a few divs |

## Counts

166 entries: 14 + 13 + 15 + 11 + 15 + 14 + 8 + 9 + 12 + 10 + 8 + 7 + 9 + 9 + 10.

Shipped: 27. Open: 139.

## Data-source status

Verified in `docs/client-data-sources.md`:

- **E03, E04** — `ctx.uiSession.sessionStatus.pendingInteraction` (push). Ready to build.
- **E01, E08, E15** — same store plus `sessions.list` (`retainedBy.mainView`, `phase`).
- **F02** — `tokenUsage` projection: four billing buckets, session-cumulative, so cost per turn is a delta.
- **E05, E12** — `plan` and `context` projections exist; view shapes still unverified.
- **F03, F04, F05** — still need a durable ledger; no projection can give history.

## If you only do ten

1. **E03 Approval waiting** — behaviour, not decoration.
2. **F07 Peak boundary announcement** — our unique subject, already computed.
3. **F02 Per-turn cost** — makes the balance a story.
4. **F06 Low-balance threshold** — prevents the only fatal failure.
5. **C02 Head pat** — the cheapest thing that makes her feel alive.
6. **A06 Dock-edge roaming** — presence without a physics engine.
7. **B02 Random idle acts** — she stops looking like a sticker.
8. **D10 Localisation** — this ecosystem is majority Chinese.
9. **L03 Live sync across tabs** — one fewer stale-state surprise.
10. **K02 Arrow-key menu navigation** — the last accessibility hole.
