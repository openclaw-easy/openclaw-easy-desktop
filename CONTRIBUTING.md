# Contributing to OpenClaw Easy

Thanks for being here. This is a small project and a good bug report genuinely moves it — most of
what breaks is platform-specific and invisible from one machine.

## Ways to help

- **Report a bug.** [Open an issue](https://github.com/openclaw-easy/openclaw-easy-desktop/issues/new/choose)
  with your OS, app version and what you did. The templates ask for what we actually need.
- **Fix something.** Small, focused pull requests are easiest to review and land.
- **Improve the docs.** Including [the architecture notes](docs/ARCHITECTURE.md) — if something
  there was wrong or missing when you needed it, say so.
- **Translate.** The UI ships in six languages under
  `apps/desktop/src/renderer/i18n/locales/`. Adding a locale is a single JSON file.

## Setup

You need **Node 22.22.3+, 24.15+ or 25.9+** — note that Node 23 is explicitly *not* supported —
and **pnpm 12**.

```bash
git clone https://github.com/openclaw-easy/openclaw-easy-desktop.git
cd openclaw-easy-desktop

pnpm install
pnpm dev
```

The first install is large: it pulls the desktop app *and* the vendored OpenClaw core.

## Everyday commands

Run these from the repo root.

| | |
| --- | --- |
| `pnpm dev` | Launch the app with hot reload |
| `pnpm build` | Build the shared package and the desktop app |
| `pnpm test` | Run the unit suite once and exit |
| `pnpm test:e2e` | Playwright end-to-end suite (needs `pnpm build` first) |
| `pnpm lint` | Lint the app and the shared package |
| `pnpm format` | Prettier over both |
| `pnpm package` | Build a macOS installer |

For a watch-mode test run while you work: `pnpm --filter ./apps/desktop test:watch`.

## Where code lives

```
apps/desktop/src/main/       Electron main — privileged: spawning, config, credentials
apps/desktop/src/preload/    the IPC bridge between main and renderer
apps/desktop/src/renderer/   React UI (Zustand stores, Tailwind)
packages/shared/             types shared between the two
openclaw/                    the vendored OpenClaw core — see below
```

**Do not change anything under `openclaw/`.** It is a wholesale copy of
[openclaw/openclaw](https://github.com/openclaw/openclaw) and the next sync overwrites the whole
directory, so a patch there is guaranteed to be lost. Core bugs go to
[the upstream repo](https://github.com/openclaw/openclaw/issues); anything the app needs
differently belongs in `apps/desktop/`.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the pieces fit and why several
non-obvious things in `src/main/` are the way they are. Worth ten minutes before your first
change there.

## Pull requests

1. Branch off `main`.
2. Make the change, and add a test if you fixed a bug — a test that fails before your fix and
   passes after is the most useful thing in the PR.
3. Check it: `pnpm build && pnpm test && pnpm lint`.
4. Open the PR and say what broke, why this fixes it, and how you verified it. Screenshots for
   anything visual.

CI runs the build and unit suite on every PR. It runs **ubuntu only**, so if your change is
macOS- or Windows-specific, please say how you tested it there — green CI does not cover it.

Two things that keep a PR moving:

- **Keep it focused.** One fix per PR. Unrelated cleanup in the same diff makes review slower and
  reverting harder.
- **Explain the "why" in the code.** A comment on a non-obvious invariant — a lifecycle ordering,
  a deliberate fallback, a timeout that has to clear something else — is worth more than a comment
  restating what the line does.

## Code style

- **TypeScript, strict.** Avoid `any`; prefer real types, `unknown`, or a narrow adapter at the
  boundary.
- **Early returns** over deep nesting.
- **Match the file you are in.** Naming and comment density should look like its neighbours.
- Prettier and ESLint decide formatting; run `pnpm format` and `pnpm lint` before pushing.

## Reporting a bug well

The [bug template](.github/ISSUE_TEMPLATE/bug_report.yml) asks for these, and they are what make a
report actionable:

- OS and version, and whether the app is Apple Silicon or Intel
- App version — **Settings → About**
- Exact steps, and what you expected instead of what happened
- Whether it worked in an earlier version
- Any error text from **Settings → Logs**, with your API keys removed

## Security

Please do not open a public issue for a security problem. [SECURITY.md](SECURITY.md) has the
right channel.

## Questions

Open an [issue](https://github.com/openclaw-easy/openclaw-easy-desktop/issues) — for now that is
the place, and a question that turns out to be a documentation gap is useful to us either way.
