# What people actually build in a DSH widget

Research note, 2026-10-21. Sources are the shipped READMEs and the code of the three most-installed character widgets in this ecosystem, plus two general-purpose desktop-pet projects. Measured by weekly npm downloads and GitHub stars at the time of writing.

| Project | Reach | What it is |
| --- | --- | --- |
| [`dsh-whale-widget`](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) | 56k/wk, 5.5k★ | Balance whale with a full accounting suite |
| [`dsh-pet`](https://github.com/PC2005-cloud/dsh-pet) | 28k/wk, 3.0k★ | Desktop pet with a generated animation pipeline |
| [`dsh-dafeiyu`](https://github.com/QCYTSN/dsh-dafeiyu) | 15k/wk, 463★ | Native always-on-top window showing task state |
| [VS Code Pets](https://github.com/tonybaloney/vscode-pets) | ~1M installs | The reference for *fun* pets in an editor |
| Shimeji | platform apps | The original desktop-mascot interaction vocabulary |

## What the leaders actually ship

**Whale widget** — the feature-maximalist. Its README documents: 60 s balance refresh with digit-roll animation, **today's spend derived from observed balance drops** (no token maths, no key), **per-turn cost from real session usage events**, peak/off-peak module with countdown and four text styles, a **bubble system** where each bubble is a list of modules (text, link, weighted random phrase, image, random image, balance, bonus, recharge, today's spend, peak state) with **per-module font, size, weight, colour, gradient, background**, drag ordering, a module library, snap zones on **four** edges with mirroring, press-squash physics, four sound events with per-event volume and custom audio clips, a **34-provider balance matrix**, and a Codex local-session mode.

**dsh-pet** — the interaction-maximalist. ~100 transparent animations that blend seamlessly (idle breathing, random acts: dozing, Rubik's cube, hotpot), left/right facing, roaming, click squash, **drag-and-throw with bounce**, right-click to summon animations, session-event-driven work states, balance-tier animations with a bubble overhead, muttering and chat, **system notification when the window loses focus**, multiple pets on one screen, a detached always-on-top desktop window, and a pet-pack format so users can add new species.

**dafeiyu** — the *status* maximalist, and the closest to what we have. Real task states (thinking, searching, editing, executing, verifying, waiting for approval, done, error), project/step/todo progress, balance in the bubble and settings, drag with **head-pat / poke / tail-touch** interactions, size, bubble, sound and reduced-motion settings, and a **lightweight in-page character** that is off by default.

## What recurs — the vocabulary of this category

Across all five projects, the same short list keeps appearing:

1. **React to real agent events** — not decoration, a status display that happens to be cute.
2. **A bubble** that says one thing at a time, with a queue.
3. **Drag + snap + mirror**, with the position remembered.
4. **A right-click menu** as the entire settings surface.
5. **Size and sound** as the two knobs everyone wants.
6. **Something to look at when idle** — breathing, blinking, a random act.
7. **A reaction to clicks** — squash, a line of dialogue, a pat.
8. **A custom character**, because the mascot is personal.

## Features for us, scored

Value is judged by "does this tell the user something true that they would otherwise miss, or make the thing pleasant enough to keep open". Ease is judged against *our* architecture: a client bundle, one host route layer, no build step.

### Cheap and worth doing (S)

| Feature | Value | How |
| --- | --- | --- |
| **Peak-boundary announcement** | high | We already compute the next transition. When it arrives, speak and cue. It is the plugin's whole subject and currently silent |
| **Low-balance warning** | high | Threshold pref; bubble + optional cue at `total < X`. One comparison |
| **Quiet mode** | med | Menu toggles a `hidden` pref; the frame renders nothing. Useful when a screen recording starts |
| **Copy balance on click of the amount** | med | `navigator.clipboard.writeText`; tiny, genuinely used |
| **Four-edge snapping** | med | We snap left/right; top/bottom is the same maths with the axes swapped |
| **Status colour pulse on rate change** | med | One keyframe on the dot; no new art |
| **Per-event sound choice** | low | We have two cues; a pref per event is a table lookup |

### Worth the build (M)

| Feature | Value | How |
| --- | --- | --- |
| **Approval-waiting indicator** | **highest** | The `permissions` projection exists. A corner widget that says "waiting for you" is the one thing you cannot miss — and it is the only feature here that changes behaviour rather than appearance |
| **Per-turn cost** | high | The shipped `tokenUsage` projection exposes the four billing buckets; multiply by our rate table (we already know peak/off-peak). "That turn cost $0.04" is the natural companion to a balance |
| **Custom character upload** | high | Host route + `$DSH_HOME` file, type/size validation. Everyone's mascot is personal; this is the feature that makes it theirs |
| **Idle variety** | med | Random small transform variations on a timer, or 2–3 more generated poses. Cheap in code, needs art |
| **Notification when the tab is hidden** | med | `Notification` API on turn completion or approval wait; permission-gated, off by default |
| **Localisation** | med | `ctx.locale` exists; we are English-only. Cheap once strings are extracted, and this ecosystem is majority Chinese |

### Expensive, and probably not us (L)

| Feature | Why we would skip it |
| --- | --- |
| **Today's spend / accounting ledger** | Needs a durable store, reconciliation, archival. The whale spends most of its code here |
| **Provider matrix (34 balances)** | A configuration product, not a widget; every provider is its own API and auth scheme |
| **Per-module bubble styling** | This is how the whale reached 22k lines. It is a design tool wearing a mascot |
| **Detached desktop window** | A second runtime (Electron/always-on-top), not a plugin |
| **Roaming / throwing physics** | Fun, but needs a physics loop and a sprite set; poor value per line |

## The five I would build, in order

1. **Approval-waiting indicator** — the only feature that changes *behaviour*; uses a projection that already exists; a corner character that visibly says "they are waiting on you" is the reason to keep it open.
2. **Peak-boundary announcement** — cheapest possible use of data we already compute, and the plugin exists to communicate exactly this.
3. **Per-turn cost** — turns the balance into a story ("this turn cost 4¢"), using the usage projection rather than estimation.
4. **Low-balance warning** — one comparison, prevents the one failure mode where the product stops working.
5. **Custom character upload** — the feature that makes the mascot personal; medium effort, no new data.

## What the evidence says to avoid

- **Configuration as a product.** The whale's own README is 500 lines of settings documentation. Its success does not come from that; it comes from the character and the balance.
- **Feature parity with everything.** dsh-pet has a hundred animations and a generation pipeline; competing there means art, not code.
- **Desktop-only paths.** Two of the three leaders ship a native window. That is a different application, and it is where their bugs live (both READMEs document web/desktop state divergence).

## Our position, honestly

We are the smallest of the three and the only one whose status surface is *rate-aware*. Neither competitor treats the peak/off-peak boundary as a first-class event, and one of them still gets Chinese holidays wrong. That is the niche worth deepening rather than broadening: **"the widget that knows what you are being charged, right now, and tells you when it changes."**
