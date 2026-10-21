# dsh-rate-hours

> **Status: kept as a reference, not linked by default.** `status-widget` now shows the rate in the corner, so this composer-row badge was redundant and is excluded from the `web` profile (`sync-profile --except rate-hours`). It stays because it is the schedule implementation the parity test drives, and because a composer-row variant is a reasonable thing to re-enable with `--include rate-hours`.

A DeepSeek Harness plugin that shows whether DeepSeek is billing you at **peak** or **off-peak** rates right now, and when that changes.

```
● Peak pricing · off-peak in 2h 30m
● Off-peak · peak in 13h 39m
● Weekend off-peak · peak in 1d 22h
● Holiday off-peak · peak in 3d 2h
```

It sits in the composer row (`conversation.input.left`), just before the model selector. Only the dot carries colour — the text inherits the theme — so it reads as part of the row rather than a widget on top of it.

| Dot | Meaning |
| --- | --- |
| 🔴 Red | Peak — full rate |
| 🟡 Amber | Weekday off-peak — half rate |
| 🟢 Green | Off-peak all day (weekend or Chinese public holiday) |

Hover for the schedule, the next boundary in UTC, and the caveats.

## The schedule

Peak is **01:00–04:00** and **06:00–10:00 UTC, Monday to Friday, excluding Chinese public holidays**. Everything else is off-peak — including weekends and those holidays in full. Off-peak is billed at half the peak rate.

Source: [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing).

Older write-ups describe a single `16:30–00:30 UTC` off-peak window. That is out of date; DeepSeek split peak into the two weekday blocks above.

### Chinese public holidays

The holiday spans live in `HOLIDAYS` in `src/client.js`, keyed by year, in **Beijing calendar dates**. 2026 comes from the State Council notice [国办发明电〔2025〕7号](https://www.gov.cn/zhengce/content/202511/content_7047090.htm):

| Holiday | 2026 (published) | 2027 (provisional) |
| --- | --- | --- |
| New Year | 01-01 – 01-03 | 01-01 – 01-03 |
| Spring Festival | 02-15 – 02-23 | 02-05 – 02-13 |
| Qingming | 04-04 – 04-06 | 04-03 – 04-05 |
| Labour Day | 05-01 – 05-05 | 05-01 – 05-05 |
| Dragon Boat | 06-19 – 06-21 | 06-09 |
| Mid-Autumn | 09-25 – 09-27 | 09-15 |
| National Day | 10-01 – 10-07 | 10-01 – 10-07 |

The 调休 makeup workdays (Jan 4, Feb 14, Feb 28, May 9, Sep 20, Oct 10 in 2026) are deliberately **not** listed: they are Saturdays and Sundays, which are off-peak regardless.

**2027 is a forecast, not a notice.** The State Council publishes the next year's arrangement in early November; until the 2027 notice lands, the table follows the fixed lunar dates and the 2025 regulation. The tooltip says the dates are provisional, and `PROVISIONAL_YEARS` marks the year so the coverage test reports it as a forecast instead of a published notice. Replace its spans when the notice arrives.

A year with no entry is not guessed at. The badge keeps working on the weekday rule and says `No holiday table for <year> — weekday rule only` in its tooltip. The tests walk every span and check that each weekday inside it prices as off-peak, so a typo fails loudly instead of quietly mis-pricing a day.

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
- **Holiday years are a table, not a computation.** Chinese public holidays are announced annually, so the table must be extended by hand once a year.
- **No cost estimate.** Deliberately out of scope; the session usage projection is a separate concern and a harder claim to make honestly.

## Tests

```sh
node test/schedule.test.mjs
```

The tests need no dependencies, so they run straight from a checkout. (`pnpm --filter dsh-rate-hours test` also works once the workspace has been installed; the plugin's only dependency is a `cordis` devDependency for editor typings, and `import type` is erased at runtime.)

27 checks, no Harness runtime needed: the loader handshake (bundle registers under the right id, exports `apply`/`inject` rather than a factory, registers into `conversation.input.left`), every peak edge, the gap between blocks, weekends, holidays, the weekday after a holiday, Beijing-date rollover at 16:00 UTC, a provisional 2027, an unknown year, transition correctness across a full week, and the component's element tree.

The component is rendered against a React stub, not real React: the browser shell ships its own React bundle, so there is no React on disk for an SSR render in this workspace.
