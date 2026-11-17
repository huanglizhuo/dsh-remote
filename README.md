# dsh-remote

Remote control your Mac's [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) from a phone — the same sessions as the desktop app, in your pocket. Built with [Exact](https://github.com/expo/exact) (Expo's native platform), shipping iOS and Android from one source.

```
手机 dsh-remote App ──(Tailscale 直连 / Cloudflare Quick Tunnel 回退)── Mac 上的 dsh-remote 插件 ── DSH 本体
```

## What's inside

| Path | What it is |
|---|---|
| `apps/mobile/` | The phone app (Exact Contract + TypeScript sources, `bun exact.mjs ios` / `android` to build) |
| `bridge/` | The DSH host plugin: REST + poll API on port 8787 (sessions, prompts, approvals, questions, queue, attachments, OTA-adjacent device management) |
| `docs/` | UI-parity audits against the desktop client |
| `PLAN.md` | The build log — every design decision and verification |

## Features

- Live sessions: create/rename/fork, steer or queue messages (editable), send photos
- Answer approvals and `ask_user_question` from the phone before the Mac's timeout
- Markdown rendering incl. tables, diff fences and inline images; merged turns with per-turn usage (`408k in · 34M cached`)
- Running status (current tool + elapsed), todos, goals, background jobs, balance
- Pairing: 6-digit code via QR / manual / `dshm://` deep link; device list with remote revoke
- Networking: Tailscale direct first, Quick Tunnel fallback, auto-swap on failure
- OTA updates: signed streams on AppDrop (`bun exact.mjs push` ships an edit in seconds)

## Setup

```sh
git clone --recurse-submodules https://github.com/huanglizhuo/dsh-remote
cd dsh-remote/apps/mobile
bun install
bun exact.mjs ios --run        # or: android / mac / web
```

The Mac side installs the `bridge/` plugin into DSH (`~/.dsh/profiles/desktop/`); see `bridge/README.md` for the full walkthrough.
