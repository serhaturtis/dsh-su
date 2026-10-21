# dsh-hello

The smallest possible bundle: one row, no client half, no services, no state.

## Behaviour

Logs `[dsh-hello] loaded` once at boot and does nothing else.

Its job is to answer one question — *does this Harness installation load a linked local plugin at all?* — before you debug a real plugin. A host-only plugin exercises the patch row, the Loader import, and TypeScript source loading, and nothing more, so when it works the remaining variables are your plugin's.

## Install

```sh
dsh plugin --profile dev add ./plugins/hello
```

If boot prints nothing, the row never mounted: start with `dsh --profile dev --dump-config` and check that `hello` is in the composed tree.

## Limits

It proves loading, not rendering. A client half is a different path — the bundle protocol, the slot registry, and the boot graph can all fail while this plugin stays quiet. For that, use a client plugin with a test that drives its bundle.

## Tests

None, by design. There is no logic to drive; the only assertion is the log line, which you read at boot.
