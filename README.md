# Openclaw Easy Desktop

A friendly GUI desktop app built on top of [OpenClaw](https://github.com/openclaw/openclaw), designed to help users set up and use OpenClaw easily — no terminal or technical knowledge required.

**Website:** [openclaw-easy.com](https://openclaw-easy.com)

## What is this?

[OpenClaw](https://github.com/openclaw/openclaw) is a powerful open-source AI assistant that connects to WhatsApp, Telegram, Discord, Slack, and many other platforms. However, setting it up requires command-line skills and technical configuration.

**Openclaw Easy Desktop** solves this by wrapping OpenClaw into a simple desktop app. Just launch it, bring your own API key (or use a local model via Ollama), connect your messaging channels, and start chatting — all through a point-and-click interface.

### Features

- **One-click gateway** — Start/stop the OpenClaw gateway from the dashboard
- **Bring Your Own Key (BYOK)** — Use your API key from OpenAI, Anthropic, Google, Venice, or OpenRouter
- **Local AI** — Run models locally with Ollama (no API key needed)
- **Multi-channel** — Connect WhatsApp, Telegram, Discord, Slack, Feishu, LINE, and more
- **Agent management** — Create, configure, and route multiple AI agents
- **Skills & plugins** — Browse and install skills from ClawHub
- **Cron jobs** — Schedule recurring AI tasks
- **Tools & permissions** — Fine-grained control over what your AI can do
- **Built-in chat** — Chat with your AI directly in the app
- **Cross-platform** — macOS, Windows, and Linux

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 8+
- [Bun](https://bun.sh/) (for running the OpenClaw gateway in dev mode)

### Run in Development

```bash
# Clone the repo
git clone https://github.com/openclaw-easy/openclaw-easy-desktop.git
cd openclaw-easy-desktop

# Install dependencies
pnpm install

# Start the desktop app
pnpm --filter moltbot-easy-desktop dev
```

The app will open and you can configure your AI provider from the dashboard.

### Build for Distribution

```bash
# Build the OpenClaw core first
cd openclaw && pnpm install && pnpm build && cd ..

# Prepare bundled resources (downloads Bun binaries, copies compiled OpenClaw)
cd apps/desktop && ./scripts/prepare-bundle.sh && cd ../..

# Package the app
pnpm --filter moltbot-easy-desktop package
```

Built installers will be in `apps/desktop/dist-installers/`.

## Project Structure

```
openclaw-easy-desktop/
├── apps/
│   └── desktop/              # Electron desktop app
│       ├── src/
│       │   ├── main/         # Electron main process
│       │   ├── preload/      # Preload bridge (IPC)
│       │   └── renderer/     # React UI
│       └── scripts/          # Build scripts
├── openclaw/                 # Core OpenClaw source (MIT/Apache)
│   ├── src/                  # CLI & gateway source
│   ├── extensions/           # Channel plugins
│   └── skills/               # Built-in agent skills
├── packages/
│   └── shared/               # Shared TypeScript types
└── docs/                     # Documentation
```

## How It Works

The desktop app manages an embedded OpenClaw gateway:

1. **Main process** spawns the OpenClaw gateway (Bun + TypeScript in dev, bundled JS in production)
2. **Gateway** handles AI conversations, channel connections, and agent routing
3. **Renderer** (React) communicates with the main process via IPC and with the gateway via WebSocket
4. **Config** is stored at `~/.openclaw/openclaw.json` and `~/.openclaw-easy/config.json`

## Supported AI Providers

| Provider | Mode | API Key Required |
|----------|------|-----------------|
| Google (Gemini) | BYOK | Yes |
| Anthropic (Claude) | BYOK | Yes |
| OpenAI (GPT) | BYOK | Yes |
| Venice | BYOK | Yes |
| OpenRouter | BYOK | Yes |
| Ollama | Local | No |

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](docs/CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Submit a pull request

All PRs require review before merging.

## Tech Stack

- **Electron** — Cross-platform desktop framework
- **React** + **TypeScript** — UI
- **Tailwind CSS** — Styling
- **Zustand** — State management
- **electron-vite** — Build tooling
- **OpenClaw** — AI gateway engine

## Links

- **Website**: [openclaw-easy.com](https://openclaw-easy.com)
- **OpenClaw (upstream)**: [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw)
- **Issues**: [GitHub Issues](https://github.com/openclaw-easy/openclaw-easy-desktop/issues)

## License

This project is open source. The core OpenClaw engine included in `openclaw/` is licensed under [MIT/Apache-2.0](openclaw/LICENSE).
