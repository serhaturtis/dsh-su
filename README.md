# dsh-su

A monorepo of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugins. The Harness itself is installed globally; this repo holds plugin sources only, and links them into a profile.

## Getting started

```sh
git clone https://github.com/serhaturtis/dsh-su && cd dsh-su
./setup.sh                             # Node, then the Harness, then the plugins
dsh --profile web web                  # boot the GUI
```

`./setup.sh` is a shell script for one reason: it may need to run *before Node
exists*, and `bootstrap.mjs` is a Node program. It uses an existing nvm to
provision Node 24 (see [`.nvmrc`](.nvmrc)) if Node is missing, and
installs nvm — `curl … | bash`, a bigger decision than installing a CLI — only
when passed `--install-node`. Its one limitation is shell-shaped: a script
cannot change the PATH of the shell you are standing in, so if it installs nvm
it prints the two lines to add to your shell rc.

With Node already on PATH, `./setup.sh`, `pnpm setup`, and
`node scripts/bootstrap.mjs` are the same thing. `bootstrap` takes it from
there:

1. **installs the Harness** globally at the version pinned in `package.json`, if `dsh` is missing (`--no-harness-install` refuses and prints the command instead);
2. checks pnpm, which `dsh plugin` forwards to;
3. installs workspace dependencies;
4. **creates the profile from the shipped `web` template** if it doesn't exist;
5. links every plugin in the repo into it.

It never *upgrades* an installed Harness — a version mismatch is reported with the exact command, because a global upgrade mid-project is your call. Re-running is safe: it is the repair command as much as the setup one.

Flags: `--dry-run` reports without changing anything, `--profile <name>` targets another profile, `--no-install` skips workspace deps, `--no-harness-install` leaves the global Harness alone.

## Plugins

| Plugin | Shows up as | What it does |
| --- | --- | --- |
| [`status-widget`](plugins/status-widget/README.md) | bottom-right card | Account balance and rate class cached 60s, eight-state cat mascot, [character packs](plugins/status-widget/docs/character-packs.md) |
| [`rate-hours`](plugins/rate-hours/README.md) | composer row | Peak/off-peak rate badge with a countdown; weekday schedule, public holidays not tracked |
| [`hello`](plugins/hello/README.md) | boot log | Smoke test that a linked plugin loads at all |

Add a row when you add a plugin. The table is the index; each plugin's README is the detail.

What is next, and what is deliberately parked, is in [ROADMAP.md](ROADMAP.md).

## Layout

```
setup.sh                 shell entry point: provisions Node, then runs bootstrap
.nvmrc                   the Node version this repo is developed on
plugins/<name>/          one bundle per directory; <name> is the short name
  package.json           dsh.bundle.patch, dsh.client, exports
  cordis.patch.yml       the row this bundle inserts
  src/index.ts           host half: export name / inject / apply(ctx)
  src/client.js          client half (optional): a client-module bundle
  test/*.test.mjs        node tests, no Harness runtime
  README.md              behaviour, install, limits, tests
scripts/                 workspace tooling: bootstrap, sync, scaffold, test runner
docs/plugin-contract.md  what the Harness requires, and its sharp edges
ROADMAP.md               what is next, with effort and reasoning
```

## Conventions

- **Directory name is the short name; package name is `dsh-<short>`.** One plugin, one directory, one package, one row.
- **The exported Cordis `name` equals the package name**, so boot logs and the composed tree agree with the directory.
- **Every plugin has a README** with four sections, in order: behaviour, install, limits, tests. The limits section is not optional — it is where a plugin admits what it cannot know.
- **Tests are plain `node`,** no framework, no dependencies. `node scripts/test-all.mjs` (also `pnpm test`) finds `plugins/*/test/*.test.mjs` and runs each in its own process.
- **No build step** while plugins are plain JavaScript. A TypeScript client half would need one; nothing here has that yet.
- **`private: true` and `0.x`** until a plugin is worth publishing.
- **Two-space JSON/YAML/Markdown, tabs in source.**

Start a plugin with the scaffold rather than copying a neighbour:

```sh
pnpm new <name>            # host-only
pnpm new <name> --client   # host + browser half
```

## Dev loop

```sh
node scripts/new-plugin.mjs <name> --client   # scaffold a conforming plugin
node scripts/sync-profile.mjs --profile dev   # link + enable it
pnpm dev                                      # boot the Web UI on the dev profile
```

`sync-profile` is the only step that touches a profile. It is idempotent — it links what's missing, adds the bundle row, and reports stale links left by deleted plugins (`--prune` removes them) — so run it after adding, renaming, or deleting a plugin instead of remembering `dsh plugin add` per package:

```sh
node scripts/sync-profile.mjs --profile web --dry-run   # report, change nothing
node scripts/sync-profile.mjs --profile web             # apply
node scripts/sync-profile.mjs --profile web --except rate-hours  # keep one out for good
```

- `bootstrap` is `sync-profile` plus the version checks and workspace install, i.e. the same thing for a machine that has never run this repo.
- A profile that doesn't exist yet is **seeded from the shipped `web` template** (`--template` changes that), so a fresh machine needs no manual profile creation. An existing profile that lacks `@deepseek-ai/dsh-web-app` gets a warning with the repair command instead of being rewritten — seeding replaces profile-local settings, so that stays your call.
- Profiles live at `$DSH_HOME/profiles/<name>` (`~/.dsh` by default); `dsh --profile <name> --dump-config` prints the composed tree without booting. `pnpm dev` uses the default port, so stop the running GUI first or pass `--port` to `dsh` directly.
- **Client code is composed at boot**: restart the Host after editing `src/client.js`. The Harness is a global install here, not a checkout, so there is no client HMR.
- Plugins are linked, so source edits need only a restart. Published plugins should ship built JS instead of raw `src/*.ts`.
- Bump the Harness with `npm i -g @deepseek-ai/dsh@<version>`, update `dsh.harness.version` in `package.json`, and re-read [`docs/plugin-contract.md`](docs/plugin-contract.md) — the bundle contract is version-sensitive.

## Verifying

```sh
node scripts/test-all.mjs                  # every plugin's suite; no install needed
dsh --profile dev --dump-config            # composition, no boot
pnpm sync --profile dev --dry-run          # what the profile is missing
```

`pnpm test` runs the same script, but pnpm re-checks the workspace install first — reach for the direct command when `node_modules` is stale or absent.

A throwaway Harness home keeps experiments out of `~/.dsh`:

```sh
DSH_HOME=$PWD/.dsh-dev dsh plugin --profile dev add ./plugins/<name>
```

`.dsh-dev/` is gitignored.
