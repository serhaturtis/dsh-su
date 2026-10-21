# Client data sources: what a root-scope plugin can actually read

Research note, 2026-10-21, against `@deepseek-ai/dsh@0.2.1-rc.2`. The question: which signals can a widget living in `shell.overlay` — no session scope, no React session provider — read continuously without polling the Host?

Short answer: **all of the ones we care about**, through three push-based surfaces, and none of them require knowing which session is open up front.

## 1. `ctx.uiSession.sessionStatus` — the one that unlocks approvals

A store combining three facts per session, maintained process-locally and published only on change:

```js
ctx.uiSession.sessionStatus.getSnapshot()   // Map<sessionId, Status>
// Status = {
//   running: boolean | undefined
//   pendingInteraction: unknown      // non-undefined ⇒ something is waiting on the user
//   completionUnread: boolean        // a turn finished and the main view has not acknowledged
// }
ctx.uiSession.sessionStatus.subscribe(listener)  // returns an unsubscribe
```

Confirmed in `dsh-client-ui-session`: `publishStatus()` rebuilds the map from `running`, `pendingSnapshot` and `completionUnread`, and only republishes when one of those facts changes. This is exactly the "is the agent waiting on me?" signal, and it is a subscription — not a poll.

**This settles E03.** `pendingInteraction` is populated by the same domain machinery that `registerPendingInteraction()` publishes into, i.e. the approvals and questions the composer blocks on. A widget can read it without touching approval internals.

## 2. `ctx.sessions.list` — which session is the one on screen

```js
const list = ctx.sessions.list.getSnapshot()
// { phase: 'pending' | 'ready', ids: string[], byId: { [id]: Row } }
// Row.retainedBy.mainView > 0   ← the session the UI is currently showing
```

That predicate is not a guess: `uiSession.isMain(sessionId)` is literally `retainedBy.mainView > 0`, and it is what the service uses to decide whether a completion counts as read. So "the session I am looking at" is available to a root-scope plugin, with the caveat that it is UI state and can be absent (nothing open, or list still `pending`).

## 3. `ctx.sessions.binding(id).session.projections.faceOf(key)` — the per-session projections

A face is a store: `getSnapshot()` and, per the projection service, change notifications. Registered client-visible keys in this build:

| Key | Would give us | Feature |
| --- | --- | --- |
| `tokenUsage` | the four billing buckets (`cacheReadTokens`, `cacheWriteTokens`, `uncachedInputTokens`, `outputTokens`) | **F02 per-turn cost** |
| `context` | context pressure / breakdown | **E12 context pressure** |
| `plan` | the plan/todo list | **E05 plan progress** |
| `inbox` | queued messages | E10 |
| `goal` | active goal | — |
| `permissions` | permission *preset*, not pending approvals | (not E03) |
| `compaction` | compaction state | E09 |

Note the trap we already hit: `permissions` sounds like pending approvals and is not — it is the preset selection. E03 comes from `sessionStatus`, not from this projection.

## Cost model

| Surface | Granularity | Cost |
| --- | --- | --- |
| `sessionStatus` | per running/pending/completion change | one Map rebuild per change, one subscription |
| `sessions.list` | per catalog change | one snapshot read, no subscription needed for a 1 s tick |
| `tokenUsage` | per committed event (fold) | the same store the usage donut reads; coalesce to once per second |

None of these are HTTP. The only network we make stays the 60 s balance read. A widget polling these three at 1 Hz would be cheap; subscribing is cheaper still, and throttling to the existing 1 s clock is the simplest correct choice for `tokenUsage`.

## What each new feature becomes

**E03 — approval waiting (highest value).**
`sessionStatus.pendingInteraction !== undefined` for the main session. Show the `worried` face, a line ("they're waiting on you"), the dot in an attention colour, and speak it once. Clear when it disappears.

**E04 — permission highlight.** Same signal, stronger treatment: glow, pulse, optional cue. No new data.

**E05 — plan progress.** `projections.faceOf('plan')` on the main binding; render `done/total` in the bubble. Needs a shape check at implementation time.

**E12 — context pressure.** `projections.faceOf('context')`; a thin bar under the bubble. Also needs a shape check.

**F02 — per-turn cost.** `tokenUsage` × the rate table we already ship. The projection is cumulative over the session's durable log, so per-turn cost is a delta between two snapshots taken at turn start and turn end — which means we need the turn boundary, and we already have one from `api-session/status`.

**E08 — subagents, approximately.** Count sessions where `running && !isMain`. That is not the same as "subagents of the current session", so label it honestly ("2 sessions running") rather than pretending.

**E15 — disconnected.** `sessions.list.phase === 'pending'` covers "still connecting"; otherwise the connection service reports resets. Cheap to distinguish from "nothing running".

## Risks and gotchas

- **Process-local.** Pending interactions are projections that must be replayed after a browser reconnect — the ui-session README says so explicitly. On reconnect, re-read rather than trusting the last snapshot.
- **`mainView` can be absent.** No open session, or a list still loading, means no main id. Every consumer needs an undefined path.
- **Projection faces can be unmaterialised.** `faceOf(key).getSnapshot()` may be `undefined` until the session binds; treat that as "unknown", not "zero".
- **`context`/`plan` shapes are unverified.** The keys are registered; their view fields are not yet read in our code. Check before designing around them.
- **Two sources for "running".** We already use `remote.$on('api-session/status')`; `sessionStatus` also carries running. Pick one — `sessionStatus` — and drop the other rather than letting them disagree.

## Recommendation

Build **E03** first: it is the highest-value feature in the catalogue, the data is push-based, and it needs only the main-session lookup plus one predicate. It also forces us to solve the "which session" question once, which E05, E12 and F02 all reuse.

After that, **F02** (per-turn cost) because the rate table already exists and the delta is mechanical, then **E05/E12** once their shapes are confirmed.
