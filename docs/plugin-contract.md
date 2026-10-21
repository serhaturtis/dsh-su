# The plugin contract

What the Harness requires of a plugin package, and the sharp edges that fail silently. Everything here was read off `@deepseek-ai/dsh@0.2.1-rc.2` (global install, no checkout). It is a developer preview — re-verify against the version you upgrade to.

## A plugin is a Cordis row plus two optional halves

`package.json` declares `dsh.bundle.patch`, a patch file that inserts one row into the Host composition. That row imports the package's **host half** (`main`). If the package also declares `dsh.client`, the **client half** is served to the browser and the row gets a browser entry too.

```
plugins/<name>/
  package.json        dsh.bundle.patch, dsh.client, exports
  cordis.patch.yml    one insert row: { id: <name>, name: dsh-<name> }
  src/index.ts        host half: export name, inject, apply(ctx)
  src/client.js       client half: a client-module bundle
  test/               node tests, no harness runtime
```

The row's `id` is local to the patch; its `name` is the module specifier. The **package name is the browser module id** — a mismatch between `dsh.client` and the bundle's registered id produces a blank surface, not an error.

## The client half is a bundle, not a module

The Host serves `exports["./client"]` as a plain script. It must call the loader exactly once:

```js
window.__ModuleLoader__.load({
  id: 'dsh-my-plugin', // must equal the package name
  factory: (require) => {
    const module = { exports: {} }
    // ... everything else, inside this closure
    module.exports.apply = apply
    module.exports.inject = ['slots']
    return module.exports
  },
})
```

Rules that follow from that shape:

- **Only `load()` runs at script time.** Every side effect — CSS injection included — belongs inside the factory, which runs when the plugin is first materialized.
- **`require` only answers platform seeds** (`react`, `react-dom`, …) and rows already in the boot graph. Relative requires do not resolve: no `require('./util.js')`. Inline the code, or put the shared part in the host half.
- **Export `apply` and `inject`, not a factory.** Exporting the authored factory leaves the plugin "loaded but rendering nothing" — the Loader calls `apply(ctx)`, so a factory in that slot constructs an object and throws it away.
- **`dsh.client.external` is for non-baseline modules only.** React is a seed word: require it, do not declare it.
- **No build step is required** for plain JavaScript. Point `exports["./client"]` at `src/client.js` directly. TypeScript client halves do need a build; the shipped packages use tsdown and emit `lib/client.js`.

## Slots

A client plugin renders by registering into a named slot:

```js
const inject = ['slots']
function apply(ctx) {
  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register({ name: 'conversation.input.left', id: 'my-plugin', order: 10 }, Widget))
}
```

List slots render every registration sorted by `order` (default `0`); single slots render one. The composer row's seats, as of this version:

| Slot | Kind | Where |
| --- | --- | --- |
| `conversation.input.left` | list | left of the model selector |
| `conversation.input.right` | list | right group, beside activity |
| `conversation.input.model` | single | the model selector itself |
| `conversation.input.permission` | single | the mode switch |
| `conversation.input.plan` | single | plan indicator |
| `conversation.input.dock` | single | above the input bar |
| `conversation.input.activity` | single | the activity area |
| `conversation.input.overlay` | list | over the composer |

Discover others by grepping the installed packages' `lib/client.js` for `renderSlot(` or the slot-name table near the end of `@deepseek-ai/dsh-client-ui-conversation/lib/client.js`.

## Restart, not reload

The client module graph is composed at boot and snapshotted per artifact revision. In this repo the Harness is a **global npm install**, not a checkout, so there is no `dev:web` watcher and no client HMR: **restart the Host** after changing `src/client.js`, then reload the page. A plugin added to a running Host does not appear until that restart.

## Verifying without booting

- `dsh --profile dev --dump-config` — composed tree, no boot. Confirms the row and its config.
- `node scripts/test-all.mjs` — drives each bundle through registration and materialization, then exercises its logic.
- Isolated boot: `DSH_HOME=$PWD/.dsh-dev dsh plugin --profile dev add ./plugins/<name>` keeps a throwaway profile inside the workspace (gitignored) instead of mutating `~/.dsh`. Useful when the real profiles live outside the sandbox.

## What we build against

A plugin repo that tracks a developer-preview host accumulates debt wherever it reaches *into* the host. The rule that keeps this repo cheap to maintain:

> **Build only on seams that survive an upgrade:** list slots we add to, our own host routes, our own files under `$DSH_HOME`.

| Seam | Safe | Why |
| --- | --- | --- |
| List slots (`shell.overlay`, `settings.section`) | yes | Adding an entry cannot displace anyone; removing ours is a no-op for the rest |
| Our own routes under `/dsh-<name>/…` | yes | The route table is a composition contract, and we own the prefix |
| Files under `$DSH_HOME` | yes | Ours to write, and the reason prefs work in both clients |
| **Single slots** (`settings.launcher`, `settings.trigger`) | **no** | Registering *replaces* the owner. We would inherit its UI duties and its churn in every upgrade |
| Another package's props or internal services | **no** | Not a published surface; it moves without notice |
| DOM selectors into the shell | **no** | Breaks silently on any markup change, and the breakage looks like our bug |

If a feature needs something the surface does not offer, the answer is **not to shim it in our repo** — a shim is a fork of someone else's component with none of the credit. Write it up for upstream and do without in the meantime. Concretely: this is why the widget's own control surface lives in `shell.overlay` rather than driving the application's Settings dialog.

## Sharp edges that fail quietly

Each of these was a real bug in a published plugin:

- **A hook after an early `return`.** React error #310: the hook count changes between renders. Run every hook before any conditional return.
- **A fresh object from a `useSyncExternalStore` snapshot.** Compared by reference, so it re-renders forever (error #185). Cache the snapshot and return a primitive key.
- **A `catch` around a Host call.** Logging and setting `null` turns a crash into a permanent "loading…" with no retry and no error. Render an explicit failure state.
- **A silent scan direction.** Countdowns that scan the wrong way collapse to `0m` for the whole off-peak run; assert the target is strictly in the future in a test.
- **Centring with a `transform`.** CSS animations outrank inline styles, so an idle `animation` that animates `transform` silently discards the inline `translateX(-50%)` — the element sits off-centre on every frame, and no amount of tuning the offset fixes it. Centre with layout (`flex` + `alignItems`), and use the standalone `scale` property for mirroring.
- **A duplicated declaration in a hand-written bundle.** Two `function Widget()` definitions are valid JavaScript: the later one wins, so a stale copy silently replaces the new one. A test that counts top-level declarations is the only thing that catches it.
- **An absolutely positioned menu inside a scroll container.** `overflow: auto` makes an absolutely positioned child part of the scrollable area, so a submenu widens its parent and produces a scrollbar instead of overlaying it. Scroll an inner wrapper, never the panel, or do not scroll at all.
- **Borrowing a single slot as an integration point.** It looks like a way to reach a host feature; it is a way to take ownership of someone else's component. See [What we build against](#what-we-build-against).
