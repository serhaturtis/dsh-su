# dsh-rate-hours

> **Status: reference implementation, linked by the suite.** `status-widget` also shows the rate in the corner, so this composer-row badge is optional; keep it out of a profile with `sync-profile --except rate-hours`. It stays because it is the schedule implementation the parity test drives, and because a composer-row variant is a reasonable thing to re-enable with `--include rate-hours`.

A DeepSeek Harness plugin that shows whether DeepSeek is billing you at **peak** or **off-peak** rates right now, and when that changes.

```
● Peak pricing · off-peak in 2h 30m
● Off-peak · peak in 13h 39m
● Weekend off-peak · peak in 1d 22h
```

It sits in the composer row (`conversation.input.left`), just before the model selector. Only the dot carries colour — the text inherits the theme — so it reads as part of the row rather than a widget on top of it.

| Dot | Meaning |
| --- | --- |
| 🔴 Red | Peak — full rate |
| 🟡 Amber | Weekday off-peak — half rate |
| 🟢 Green | Off-peak all day (weekend) |

Hover for the schedule, the next boundary in UTC, and the caveats.

## The schedule

Peak is **01:00–04:00** and **06:00–10:00 UTC, Monday to Friday**. Everything else is off-peak — including weekends, and Chinese public holidays, which DeepSeek bills off-peak in full (this badge does not track those; see below). Off-peak is billed at half the peak rate.

Source: [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing).

Older write-ups describe a single `16:30–00:30 UTC` off-peak window. That is out of date; DeepSeek split peak into the two weekday blocks above.

### Chinese public holidays are not tracked

The badge runs the weekday rule year-round. DeepSeek's official holiday spans are republished by the State Council every year, and carrying that table was yearly maintenance with a bad failure mode: a late or forecast year could silently mis-price days. The table has been removed, so a holiday weekday shows as **peak** here even though the API bills it off-peak. The tooltip says so. On a holiday, check the pricing page before relying on the badge.

## Install

```sh
dsh plugin --profile dev add ./plugins/rate-hours   # from the repo root
```

That links the package into the profile and adds the `dsh-rate-hours` bundle. Restart the Host afterwards: the client-module graph is composed at boot, so a running page will not pick the plugin up.

The bundle is plain JavaScript served straight from `exports["./client"]`, so there is **no build step** — edit `src/client.js`, restart, reload.

## How it works

- **Host half** (`src/index.ts`) exists only to give the Loader a row: client bundles are discovered by scanning enabled Loader entries for a `dsh.client` declaration. It registers no service, no route, and no RPC.
- **Client half** (`src/client.js`) is a client-module bundle in the required shape: it calls `window.__ModuleLoader__.load({ id, factory })` once and does everything else inside the factory closure. It requires only `react`, which is a platform seed module, so it declares no externals.
- **The clock is the browser's.** Computing locally avoids a Host round-trip, an RPC surface, and a route registration. The cost is that a badly skewed browser clock gives a wrong answer; the tooltip says the figure is browser-derived rather than presenting it as authoritative.

## Limits

- **An indicator, not a bill.** It reports the published schedule. It cannot know about account credits, negotiated discounts, or a schedule change DeepSeek makes without updating this file.
- **Chinese public holidays are not tracked.** A holiday weekday is shown as peak. The tooltip states the limitation; the table was removed rather than maintained by hand every year.
- **No cost estimate.** Deliberately out of scope; the session usage projection is a separate concern and a harder claim to make honestly.

## Tests

```sh
node test/schedule.test.mjs
```

The tests need no dependencies, so they run straight from a checkout. (`pnpm --filter dsh-rate-hours test` also works once the workspace has been installed; the plugin's only dependency is a `cordis` devDependency for editor typings, and `import type` is erased at runtime.)

22 checks, no Harness runtime needed: the loader handshake (bundle registers under the right id, exports `apply`/`inject` rather than a factory, registers into `conversation.input.left`), every peak edge, the gap between blocks, weekends, the public-holiday limitation, transition correctness across a full week, and the component's element tree.

The component is rendered against a React stub, not real React: the browser shell ships its own React bundle, so there is no React on disk for an SSR render in this workspace.
