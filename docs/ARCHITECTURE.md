# Architecture

How the app is put together, and why. Read this before changing anything in
`apps/desktop/src/main/` — most of the surprising code there is defending against a specific
failure that has happened.

## The shape of it

OpenClaw Easy is an Electron app that supervises an **OpenClaw gateway** — the same gateway you
would otherwise start from a terminal. The app does not reimplement OpenClaw; it installs it,
configures it, starts it, watches it, and repairs it.

```
┌─────────────────────────────────────────────────────────┐
│  Renderer (React)          apps/desktop/src/renderer/    │
│  dashboard · chat · channel setup · settings             │
└───────────────┬──────────────────────┬──────────────────┘
                │ IPC (preload bridge) │ WebSocket
┌───────────────┴──────────────────────┼──────────────────┐
│  Main process              apps/desktop/src/main/       │
│  managers/ · process-manager-{mac,windows} · config      │
└───────────────┬──────────────────────┼──────────────────┘
                │ spawn / CLI          │
┌───────────────┴──────────────────────┴──────────────────┐
│  OpenClaw gateway                    openclaw/ (bundled) │
│  agents · channels · tools · cron · skills               │
└──────────────────────────────────────────────────────────┘
                                       │
                        WhatsApp · Telegram · Discord · …
```

The renderer never talks to the gateway's process. It talks to the main process over IPC, and to
the running gateway over a WebSocket for live session data. Everything privileged — spawning,
config writes, credential handling — lives in main.

## The three processes

**Main** (`src/main/index.ts`) owns the app lifecycle and every privileged operation. It is the
only writer of `~/.openclaw/openclaw.json` and the only thing that spawns the gateway.

**Preload** (`src/preload/index.ts`) is the bridge. It exposes a narrow, explicit `electronAPI`
surface to the renderer — no `nodeIntegration`, no `remote`. If the renderer needs a new
capability, it gets a new named channel here, not a general escape hatch.

**Renderer** (`src/renderer/`) is a React app with Zustand stores and Tailwind. It is a client:
it renders state and sends intents. It never assumes an operation succeeded because it was
dispatched.

## Where the gateway comes from

The app can run against three different OpenClaw binaries, in this order:

1. **A system `openclaw`** on `PATH`, if one is installed.
2. **The bundled runtime** — a packaged build ships a Node binary plus `openclaw.mjs`, staged
   into `apps/desktop/installer-resources/` by `scripts/prepare-bundle.sh` at package time (the
   directory is generated, not committed) and installed to `~/.openclaw-easy/app/`.
3. **The development tree** — `dev-openclaw-runtime.ts` spawns `node dist/entry.js` from the
   vendored core when you are running `pnpm dev`.

`openclaw-bundle.ts` and `managers/system-openclaw-resolver.ts` decide which. This fallback chain is
deliberate and load-bearing: a bundled runtime that silently failed to ship is invisible on a
developer machine that has `openclaw` on `PATH`, which is exactly how a broken bundle once
shipped four releases in a row. If you touch bundling, test on a machine with no system
`openclaw`.

## Owned vs. external gateways

The app distinguishes a gateway **it started** (owned, a child process it can signal) from one
already running under launchd or systemd (external, someone else's child).

This matters most on restart. For an owned gateway, stop-then-start is fine. For an external one
it is not: stopping unloads the service, and a follow-up start has to re-bootstrap it and can
lose the race, leaving the user with no gateway at all. External gateways therefore restart as a
single `openclaw gateway restart` — see `GATEWAY_RESTART_ACTION` in `process-manager-base.ts`,
which also carries the timeout, because upstream's restart does its own health proof and a
too-short deadline kills a restart that was still working.

`process-manager-mac.ts` and `process-manager-windows.ts` implement this per platform; shared
policy belongs in `process-manager-base.ts`.

## Config is a single-writer resource

`ConfigManager` owns `~/.openclaw/openclaw.json`. Its write lock is what serializes every
read-modify-write — so **there must be exactly one instance**. Two instances mean two locks
guarding one file, which is no mutual exclusion at all: a channel add and a provider switch can
land at the same time and one silently disappears. `OpenClawManager.getConfigManager()` hands out
the single instance; do not construct another.

Two more rules that have each been learned the hard way:

- **Read tolerantly, write canonically.** Upstream renames things — the agent roster moved from
  `agents.list` to the keyed `agents.entries`. Read helpers (`agent-roster.ts`) accept both
  shapes; writes only ever produce the current one. Reading a shape directly is how a repair
  becomes a silent no-op after an upstream rename.
- **Repair on every launch, not on demand.** `gateway-migration.ts` runs idempotently at startup,
  so a user with a config broken by an upgrade recovers without being told to run a CLI command
  they will never run.

## Channel setup

Channels split into two families, declared in
`renderer/components/dashboard/channel-setup-channels.ts`: QR-login (WhatsApp, WeChat) and
token-paste (Telegram, Discord, Slack, Feishu, LINE). That file exists because the vocabulary
drifted once — a channel was wired end-to-end through main, preload and IPC, but the modal had no
render branch for it, so setup opened an empty dialog that looked exactly like "QR generation
failed". `isHandledSetupChannel` turns that class of mistake into a failing unit test.

## The vendored core

`openclaw/` is a wholesale copy of [openclaw/openclaw](https://github.com/openclaw/openclaw),
refreshed periodically. **Do not patch it** — the next refresh overwrites the directory. Fixes go
upstream; anything the app needs differently belongs in `apps/desktop/`.

One consequence of vendoring into a subdirectory: pnpm settings only apply at the workspace root,
so the core's `pnpm-workspace.yaml` settings are mirrored into the root one with the package globs
and patch paths re-rooted under `openclaw/`. And the core does not build in place here — its UI
bundle step resolves dependencies against its own directory while pnpm hoists them to the real
root. Neither the app build nor the test suite needs a core build, so this is a known and accepted
limitation rather than a bug to fix.

## Testing

`pnpm test` runs the unit suite from the repo root. It covers the main process heavily — config
migration, process management, path resolution, channel vocabulary — because that is where the
bugs that reach users live. Tests are colocated with the code they cover.

`pnpm test:e2e` drives the built app with Playwright. It needs a real build first; the Playwright
config does not build for you.

Two platform traps worth knowing when a test passes locally and fails in CI, or the reverse:

- CI runs **ubuntu only**, so macOS- and Windows-specific behavior is not covered there. Scope
  POSIX-only assertions explicitly.
- On macOS, `os.tmpdir()` is a symlink (`/var` → `/private/var`) while production resolvers return
  canonical paths. `fs.realpath` your temp roots in path assertions or they pass on Linux and fail
  on a Mac.
