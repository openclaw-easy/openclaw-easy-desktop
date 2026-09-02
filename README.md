<p align="center">
  <img src="docs/images/icon.png" alt="OpenClaw Easy" width="120" />
</p>

<h1 align="center">OpenClaw Easy</h1>

<p align="center">
  <strong>The OpenClaw desktop app. Put an AI assistant on WhatsApp, Telegram, Discord and more —<br />without a terminal, a server, or a config file. Runs a local model for free, or your own API key.</strong>
</p>

<p align="center">
  <a href="https://openclaw-easy.com"><img src="https://img.shields.io/badge/%E2%AC%87%EF%B8%8F_Download_for_macOS_%7C_Windows-00C853?style=for-the-badge&logoColor=white" alt="Download" /></a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" /></a>
  <a href="https://github.com/openclaw-easy/openclaw-easy-desktop/stargazers"><img src="https://img.shields.io/github/stars/openclaw-easy/openclaw-easy-desktop?style=flat&color=yellow" alt="Stars" /></a>
  <a href="https://github.com/openclaw-easy/openclaw-easy-desktop/actions/workflows/ci.yml"><img src="https://github.com/openclaw-easy/openclaw-easy-desktop/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey" alt="Platform" />
  <img src="https://img.shields.io/badge/telemetry-none-success" alt="No telemetry" />
</p>

<p align="center">
  <a href="https://openclaw-easy.com">Download</a> &bull;
  <a href="#60-second-start">Quick start</a> &bull;
  <a href="#build-from-source">Build from source</a> &bull;
  <a href="docs/ARCHITECTURE.md">Architecture</a> &bull;
  <a href="https://docs.openclaw.ai">OpenClaw docs</a>
</p>

---

<p align="center">
  <img src="docs/images/screenshot-dashboard.png" alt="The OpenClaw Easy dashboard" width="820" />
</p>

---

## What this is

[OpenClaw](https://github.com/openclaw/openclaw) is an open-source AI agent platform that connects
a model to your messaging apps. It is excellent, and it expects you to be comfortable with a
terminal, a config file and a long-running gateway process.

**OpenClaw Easy** is that same engine wrapped in a desktop app. You install it like any other
program, pick a model — a local one that runs on your machine, or a provider key you already have
— scan a QR code, and your messaging apps have an AI assistant. The OpenClaw core ships inside the
app; there is nothing else to install.

This repository is the source of that app, and it is the build you can read: no accounts, no
subscription, no telemetry. See [What's in this repo](#whats-in-this-repo) for how it relates to
the installers on the website.

## 60-second start

1. **[Download](https://openclaw-easy.com)** the macOS `.dmg` / `.pkg` or the Windows `.exe`.
2. **Open it** and press **Launch Assistant** on the dashboard.
3. **Pick your AI** under *AI Configuration* — either a **local model** (the default; the app
   installs Ollama for you and runs the model on your machine, no key and no bill) or **your own
   API key** for Google, OpenAI, Venice AI or OpenRouter.
4. **Connect a channel.** WhatsApp and WeChat pair by scanning a QR from your phone; Telegram,
   Discord, Slack, Feishu and LINE take a bot token you paste in.

That's it. Message your own number and the assistant answers.

## Channels

Set up from inside the app, no webhooks or servers:

<p>
  <img src="https://img.shields.io/badge/WhatsApp-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" alt="WhatsApp" />
  <img src="https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram" />
  <img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord" />
  <img src="https://img.shields.io/badge/Slack-4A154B?style=for-the-badge&logo=slack&logoColor=white" alt="Slack" />
  <img src="https://img.shields.io/badge/WeChat-07C160?style=for-the-badge&logo=wechat&logoColor=white" alt="WeChat" />
  <img src="https://img.shields.io/badge/Feishu-3370FF?style=for-the-badge&logo=bytedance&logoColor=white" alt="Feishu" />
  <img src="https://img.shields.io/badge/LINE-00C300?style=for-the-badge&logo=line&logoColor=white" alt="LINE" />
</p>

The bundled OpenClaw core supports many more channels than the app has a setup screen for. Those
are reachable by editing `~/.openclaw/openclaw.json` directly — see the
[OpenClaw docs](https://docs.openclaw.ai).

## AI models

Two ways to run, chosen in *AI Configuration*.

### Local — free, offline, no key

The default. The app checks for [Ollama](https://ollama.com), offers to install the official app
if it is missing, and manages models for you from the dashboard. `llama3.2:3b` is the starting
default; Llama 3.x, Mistral, Phi, Gemma, Qwen and DeepSeek builds all work. Nothing leaves your
machine, and there is nothing to pay.

### Bring your own key

Use an account you already have. You pay the provider directly — this build has no billing of its
own and takes no cut.

| Provider | Models you can pick |
| --- | --- |
| **Google** | Gemini 3.5 Flash, 3.1 Pro, 3.1 Flash Lite |
| **OpenAI** | GPT-5.5 Pro / 5.5 / 5.4 / 5.4 Mini, GPT-5.3 Codex, o4-mini |
| **Venice AI** | GLM 5.2 / 5.1 / 5, Qwen 3.7 Plus, DeepSeek V4 Pro & Flash, Grok 4.3, Kimi K2.7 Code, and more |
| **OpenRouter** | Claude Opus 4.8 / Sonnet 4.6 / Fable 5 / Haiku 4.5, GPT-5.x, Gemini 3.x, Grok 4.3, DeepSeek V4 Pro, Qwen 3.7 Max |

**Claude, Grok and DeepSeek reach you through OpenRouter** — one key, every model above.

## What you get

| | | |
|---|---|---|
| :zap: | **No setup** | No terminal, no config file, no separate OpenClaw install. The engine is bundled. |
| :house: | **Local models** | Run Llama, Mistral, Phi or Qwen on your own machine via Ollama — free, offline, no API key. |
| :iphone: | **WhatsApp by QR** | Scan once from your phone. No bot token, no webhook, no public URL. |
| :robot: | **Multiple agents** | Create agents with their own models and route channels to them. |
| :jigsaw: | **Skills & plugins** | Browse and install skills from ClawHub inside the app. |
| :alarm_clock: | **Cron jobs** | Schedule recurring AI tasks. |
| :shield: | **Tools & permissions** | Decide exactly which tools your assistant may use. |
| :speech_balloon: | **Built-in chat** | Talk to your assistant in the app, without any channel. |
| :microphone: | **Voice input** | Speech-to-text locally with Whisper, or via OpenAI / Google. |
| :globe_with_meridians: | **6 languages** | English, Deutsch, Español, 日本語, Português, 中文. |
| :stethoscope: | **Doctor** | Diagnoses and repairs a broken config from the dashboard. |

## Privacy

This is the part worth being precise about, so here is exactly what the app does and does not do.

- **No account.** There is no sign-up and no login. Nothing identifies you to us.
- **No telemetry.** [`telemetry-manager.ts`](apps/desktop/src/main/managers/telemetry-manager.ts)
  is a no-op in this build — the collection code is not disabled by a flag, it is absent.
- **Your keys stay local.** Configuration lives in `~/.openclaw/` and `~/.openclaw-easy/` on your
  own machine.
- **On a local model, your conversations never leave the machine at all.** That is the default
  mode, and it is the reason it is the default.
- **On a hosted model, they go to the provider you chose and nowhere else.** There is no server
  of ours in the path.
- **The only other outbound call** is a check against this repository's GitHub Releases for a
  newer version. It is a notification — it tells you a version exists and opens the download
  page; it does not install anything behind your back, and you can switch it off in Settings.

## What's in this repo

```
openclaw-easy-desktop/
├── apps/desktop/        # the Electron app — main, preload, React renderer
├── packages/shared/     # shared TypeScript types
├── openclaw/            # the OpenClaw core, vendored (MIT, OpenClaw Foundation)
└── docs/                # architecture notes and images
```

Two things to know before you dig in:

**`openclaw/` is upstream code.** It is a vendored copy of
[openclaw/openclaw](https://github.com/openclaw/openclaw), refreshed wholesale when we sync. Fixes
belong upstream, not here — a patch to `openclaw/` is overwritten by the next sync.

**Installers come from elsewhere.** This repo builds and tests the app, but the release
pipeline that publishes to [openclaw-easy.com](https://openclaw-easy.com) lives in a private
repository, along with the optional hosted-AI tier. That tier is why a few surfaces here are
thinner than in the downloadable build: this is the bring-your-own-key app, complete and working,
with the commercial parts removed rather than stubbed.

Architecture in more depth: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Build from source

Requires **Node 22.22.3+, 24.15+ or 25.9+** (Node 23 is not supported) and **pnpm 12**.

```bash
git clone https://github.com/openclaw-easy/openclaw-easy-desktop.git
cd openclaw-easy-desktop

pnpm install     # installs the app and the vendored core
pnpm dev         # launch the app in development mode
```

Other commands, all from the repo root:

```bash
pnpm build       # build the shared package and the desktop app
pnpm test        # run the unit suite (575 tests) once and exit
pnpm test:e2e    # Playwright end-to-end suite
pnpm lint        # lint the app and shared package
pnpm package     # build a macOS installer into apps/desktop/dist-installers/
```

`pnpm package` targets macOS. For Windows, run
`pnpm --filter ./apps/desktop exec electron-builder --win` on a Windows machine.

An installer you build here is **not code-signed** — `apps/desktop/electron-builder.yml` ships
`identity: null` and `notarize: false`, and there is no Windows certificate configured. Expect
macOS Gatekeeper to ask for confirmation and Windows SmartScreen to show a "more info" prompt on
first launch. Set your own signing identity there if you need signed builds.

> **One known rough edge:** `pnpm build` *inside* `openclaw/` does not work in this layout. The
> vendored core resolves its UI dependencies against its own directory, while pnpm hoists them to
> the repository root, so the core's bundle step cannot find them. It does not affect the app —
> the desktop build and the test suite do not need it — but do not be surprised by it. Building
> the core is not a step in any workflow here.

## Tech stack

<p>
  <img src="https://img.shields.io/badge/Electron_33-9feaf9?style=flat-square&logo=electron&logoColor=black" alt="Electron" />
  <img src="https://img.shields.io/badge/React_18-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript_5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_3-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Zustand_5-443E38?style=flat-square" alt="Zustand" />
  <img src="https://img.shields.io/badge/Vite_5-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white" alt="Vitest" />
  <img src="https://img.shields.io/badge/Playwright-2EAD33?style=flat-square&logo=playwright&logoColor=white" alt="Playwright" />
  <img src="https://img.shields.io/badge/pnpm_12-F69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm" />
</p>

## Contributing

Issues and pull requests are welcome — bug reports with reproduction steps are especially
valuable, since most of what breaks here is platform-specific and hard to see from one machine.
**[CONTRIBUTING.md](CONTRIBUTING.md)** covers the setup, where each kind of code lives, and what a
reviewable PR looks like.

Found a security issue? Please read **[SECURITY.md](SECURITY.md)** first — don't open a public
issue for it.

## License

Apache-2.0 — see [LICENSE](LICENSE). The vendored OpenClaw core under `openclaw/` is MIT,
copyright the OpenClaw Foundation; its notice is at [`openclaw/LICENSE`](openclaw/LICENSE).

---

<p align="center">
  <a href="https://star-history.com/#openclaw-easy/openclaw-easy-desktop&Date"><img src="https://api.star-history.com/svg?repos=openclaw-easy/openclaw-easy-desktop&type=Date" alt="Star history" width="600" /></a>
</p>

<p align="center">
  <sub>Built on <a href="https://github.com/openclaw/openclaw">OpenClaw</a> by the <a href="https://github.com/openclaw-easy">OpenClaw Easy</a> team.</sub>
</p>
