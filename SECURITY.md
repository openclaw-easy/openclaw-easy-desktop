# Security Policy

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private reporting instead:

**[Report a vulnerability →](https://github.com/openclaw-easy/openclaw-easy-desktop/security/advisories/new)**

That opens a private advisory only the maintainers can see, and it is the fastest way to reach us.

Useful things to include, as far as you have them:

- What an attacker can do, and what they need in order to do it
- Steps or a proof of concept
- Affected version, and your OS
- Whether it needs local access, a malicious config, or a hostile message from a channel

We will acknowledge your report, keep you updated as we work on it, and credit you in the release
notes unless you would rather we didn't.

## Scope

This repository is the desktop app: `apps/desktop/`, `packages/shared/`, and the packaging
configuration.

**The vendored core under `openclaw/` is not ours.** It is a copy of
[openclaw/openclaw](https://github.com/openclaw/openclaw); vulnerabilities in it should go to
[that project's security process](https://github.com/openclaw/openclaw/security), and we will pick
up the fix on the next sync. If you are unsure which side a problem lives on, report it here and
we will route it.

The hosted service at `openclaw-easy.com` is outside this repository. Report issues with it to the
same private advisory link and we will forward them.

## What we consider a vulnerability

Things we want to hear about:

- Code execution from a message, a channel payload, or a config file
- Escaping the renderer sandbox, or reaching privileged main-process operations from it
- Leaking API keys, channel credentials, or conversation content off the machine
- Anything that makes the app talk to a host it should not

Things that are known and not vulnerabilities:

- **Installers built from this repository are unsigned.** `electron-builder.yml` ships
  `identity: null` and `notarize: false`, so Gatekeeper and SmartScreen will warn. This is a
  documented property of self-built installers, not a flaw to report.
- **Your AI provider sees your conversations.** That is what choosing a hosted provider means. Use
  a local model if you do not want that.
- **Anyone with your unlocked machine can read `~/.openclaw/`.** Credentials are protected by your
  OS user account, not by an additional passphrase.

## Supported versions

Fixes land on `main` and go out in the next release. There are no long-term support branches —
please test against `main` or the latest release before reporting.
