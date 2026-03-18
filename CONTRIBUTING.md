# Contributing to OpenClaw Easy

Thank you for your interest in contributing! Here's how to get started.

## Ways to Contribute

- **Bug reports** — Open an [issue](https://github.com/openclaw-easy/openclaw-easy-desktop/issues) with steps to reproduce
- **Feature requests** — Open an issue describing the use case
- **Code contributions** — Fork, branch, and submit a pull request
- **Documentation** — Fix typos, improve examples, translate

## Development Setup

```bash
# Prerequisites: Node 22+, pnpm

git clone https://github.com/openclaw-easy/openclaw-easy-desktop.git
cd openclaw-easy-desktop

pnpm install

# Start in dev mode
pnpm --filter moltbot-easy-desktop dev
```

## Pull Request Guidelines

1. Fork the repo and create a feature branch: `git checkout -b feature/my-feature`
2. Make your changes with clear commit messages
3. Run `pnpm --filter moltbot-easy-desktop build` to verify no build errors
4. Submit a PR with a clear description of what changed and why

## Code Style

- TypeScript — no `any`, strict types preferred
- React components in `apps/desktop/src/renderer/`
- Electron main process in `apps/desktop/src/main/`

## Reporting Bugs

Please include:
- OS and version (macOS/Windows)
- App version (Help → About)
- Steps to reproduce
- Expected vs actual behavior

## Questions?

Open a [GitHub Discussion](https://github.com/openclaw-easy/openclaw-easy-desktop/discussions) or visit [openclaw-easy.com](https://openclaw-easy.com).
