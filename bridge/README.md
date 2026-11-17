# dsh-remote (host bridge)

Desktop-side half of dsh-remote. A Cordis plugin that runs **inside the DeepSeek
Harness desktop process** and exposes one small HTTP API on `127.0.0.1:8787` so a
phone can read and drive the sessions the Mac already shows.

It is not a second agent. It calls the same `sessionController` the desktop web UI
calls, so a phone prompt is a normal `user-rpc` message in the same session, and a
Mac prompt shows up on the phone.

## Install (desktop profile)

```sh
# the profile keeps plugins as npm dependencies; a symlink is enough for local work
ln -s /Users/lizhuo/owork/dsh-exat/bridge ~/.dsh/profiles/desktop/node_modules/dsh-remote
```

Then enable the bundle once — in the app, the `plugin_manager` tool:

```
plugin_manager action=set_bundle target=dsh-remote enabled=true
```

`cordis.patch.yml` inserts `dsh-remote`; the plugin has no client half and no
build step (plain ESM, Node built-ins only).

**Reload after editing**: `set_bundle enabled=false`, then `enabled=true`. The old
instance's `ctx.effect` disposer closes the HTTP server, so the port is free.

## Pair a phone

1. On the Mac open <http://127.0.0.1:8787/pair>. It shows a 6-digit code (5 minutes,
   3 attempts) and is refused through a tunnel on purpose (`cf-connecting-ip` /
   `cf-ray` present → 403).
2. Expose the bridge: `cloudflared tunnel --url http://127.0.0.1:8787`.
3. In the app: Settings → paste the `https://….trycloudflare.com` origin, type the
   code, Pair. The app stores the bearer token; the Mac stores only token hashes'
   source of truth (`~/.dsh/mobile-bridge.json`, mode 0600) and accepts up to 6
   devices.

A token issued once keeps working after restarts and after new devices pair.
There is no unpair endpoint yet: delete the entry in `~/.dsh/mobile-bridge.json`
and reload the plugin.

## API

### Balance / devices / hardening (2026-11 round)
- `/v1/live` carries a top-level `balance` (from the DSH `deepseekAccount` service, cached 5 min): `{signedOut, failed, wallets:[{currency,balance}], bonusWallets}` — the first poll after start returns `null`, the next one has data.
- `/v1/devices` (GET, token): `{you: <masked id of the caller>, devices:[{id (8-char token prefix), name, at}]}`. `DELETE /v1/devices/:id` revokes by that prefix; revoking the calling device is refused (400).
- `/v1/pair` accepts `body.name` (≤40 chars, stored with the token) and is rate-limited per IP: 8 bad codes within 15 min → `429 ip_locked`.
- `/v1/file` serves only paths under the session's cwd or `os.tmpdir()`; anything else is a 403 `outside workspace`.

Everything except `/v1/health`, `/v1/pairing`, `/v1/pair` and `/pair` needs
`Authorization: Bearer <token>`.

| Route | Purpose |
|---|---|
| `GET /v1/health` | `{ok, name, instanceId, paired, sessions}` — cheap reachability probe |
| `GET /v1/pairing` | the code, loopback only |
| `POST /v1/pair {code}` | `{token, instanceId}` |
| `GET /v1/live?session=<id>&take=&listRev=` | the small poll: running/queue/approvals/questions/todos/jobs/streaming, no message rows, plus `rowsRev`/`listRev`; pass the last `listRev` and the session list is omitted when unchanged (~1.9 KB warm) |
| `GET /v1/transcript?session=<id>&take=` | the message rows; fetch only when `rowsRev` moved (idle sessions stop re-carrying history) |
| `GET /v1/sessions` | session list alone |
| `GET /v1/sessions/:id/events?limit=&before=` | durable transcript page (`sessionController.events`) |
| `GET /v1/sessions/:id/state` | `sessionController.state` (`running`, `queue`, `pendingInput`) |
| `GET /v1/sessions/:id/live` | per-attempt streaming buffers |
| `POST /v1/sessions/:id/prompt {text, mode?}` | `mode:"steer"` steers, otherwise `followup`; initialises a model first |
| `POST /v1/sessions/:id/cancel` | stop the running turn |
| `GET /` or `GET /pair` | the QR page the Mac shows (loopback only) |
| `POST /v1/approvals/:id {decision:'allow'\|'deny'}` | answer a tool approval from the phone |
| `GET /v1/feed?after=<eid>&wait=<ms>` | long-poll event feed, one cursor across all sessions |
| `POST /v1/_try {method, args}` | dev escape hatch: call any `sessionController` method (loopback only) |

Rendering stays honest to DSH's own model: an `assistant/message` arrives as
`blocks` (`text` / `reasoning` / `tool` with the raw arguments), not as markdown to
re-parse. Runtime-context user messages (`source.kind !== 'user'`) are dropped.
Every row also carries precomputed `tools` / `running` / `thought` counts so the
phone's process line (`✓ N 步`) never rescans the blocks array per render.

## The tunnel and the QR code

`cloudflared` is optional but assumed: on load the bridge spawns
`cloudflared tunnel --url http://127.0.0.1:8787`, reads the `trycloudflare.com`
hostname out of its log, keeps it in memory and restarts it 5 s after an exit.
`config.tunnel === false` turns this off; without `cloudflared` on PATH the
bridge logs the failure and stays loopback-only.

`GET /` and `GET /pair` (loopback only — any request carrying
`cf-connecting-ip`/`cf-ray` gets 403) render the QR: it encodes
`dshm://pair?u=<origin>&c=<six digits>`, so one scan replaces typing an address
and a code. The page also shows the address and the digits for when the camera
cannot open.

## Images

Assistant and tool images are content-addressed attachments in DSH, so the bridge hands the
phone a URL instead of base64:

- `GET /v1/attachments/<sha256:…>?t=<token>` — the token may also travel as
  `Authorization: Bearer …`; `<img>` cannot send headers, hence the query form.
- While rendering a snapshot the bridge records every image it sees in `imageRefs`
  (message blocks and `tool/result` parts); the route serves those bytes with the original
  `content-type` and `cache-control: private, max-age=86400`.
- Snapshot blocks carry `kind:"image"` with `att`/`media`/`w`/`h`, and expanded tool cards carry
  `images:[{id,att,media,w,h,text}]`.
- Uploads from the phone are intentionally not implemented (Exact has no system file picker);
  the phone only displays images produced on the Mac.

## A file from the transcript

`GET /v1/file?p=<path>&s=<session>&t=<token>` serves a file the Mac's transcript referenced by
path (a Markdown image in an answer). Relative paths resolve against the session's cwd, only
regular files under 24 MB are served, and the same token rules apply as the attachment route.
The token holder can read files the Mac user can read — treat it like shell access.

## Approvals

`ctx.approval.request()` needs an open turn, and its answerers are `approval/request`
waterfall listeners. The bridge registers one with `prepend` so it can be the
answerer — but only while the phone is actually looking:

- every `/v1/live?session=<id>` (or `/v1/transcript`) marks that session as seen for 90 s;
- a request for a seen session is pushed to the snapshot as
  `session.approvals[]` and held for 45 s waiting for the phone;
- no answer → `next()`, so the desktop's own approval UI takes over;
- no recent snapshot → `next()` immediately (desk-first use is unchanged).

`allowed-once` is the only granting outcome; anything else is `rejected`, and the
service fails closed if the listener throws or times out. The tradeoff is explicit:
while the phone holds the request, the desktop card has not appeared yet, so a
desktop user waits up to 45 s before their own prompt shows.

## Paging is by turns

`GET /v1/snapshot?take=N` counts **turns**, not messages. A turn can carry 20–40 step messages, so a message window made "load earlier" add one row and look broken. The bridge asks for `N*96+96` messages, merges steps into turns, then keeps the newest `N` and reports `hasMore` when older turns were dropped.

## Payload size

`GET /v1/live` ships a **slim** session row (id, title, cwd, status, running, timestamps, goal/permission/pinned flags, group). The heavy `meta` blob (projections) stays server-side — shipping it made every poll ~230 KB with 24 sessions, which on a phone caused overlapping requests and a flickering "re-link" banner. Keep new fields small; the phone polls this every 700 ms while a turn runs.

## The sidebar panel

The same bundle ships a browser half (`lib/client.js`, declared by
`dsh.client` in `package.json`). It puts a **手机配对** row in the DSH sidebar;
selecting it opens a panel with:

- the QR code (`/v1/pairing.svg`) and a live countdown on the six-digit code
- **刷新二维码** and **在浏览器打开** (`/pair`)
- 服务器地址 (the tunnel URL while cloudflared is up, else the loopback URL)
- 配对链接 (`dshm://pair?u=…&c=…`, the payload the phone's scan screen reads)
- 设备 TOKEN (masked, with 显示 / 复制) — and a warning that it can write to
  every session on this Mac

Each row has a 复制 button. The panel re-reads `/v1/pairing` every 5 s, so a
restarted tunnel shows its new hostname without reopening.

Install and reload it the same way as the host half — the browser picks the new
client bundle up without a refresh:

```sh
ln -sfn <repo>/bridge ~/.dsh/profiles/desktop/node_modules/dsh-remote
# then: plugin_manager action=set_bundle target=dsh-remote enabled=true
```

## Why polling

Cloudflare Quick Tunnels do not support SSE and cap a tunnel at 200 in-flight
requests; the phone also spends most of its life backgrounded. So the app polls
`/v1/live` every 0.7–2.8 s (adaptive) while a screen is open. A named tunnel + Cloudflare
Access (or Tailscale) removes both limits, and only the base URL changes.

## Known gaps

- `POST /v1/_ask {sessionId}` is a dev route that fires a synthetic approval
  inside a running turn; the phone answers it through the normal card.
- Session list has create/rename/fork; no delete yet.
- No push notification when a turn ends or an approval is asked.
- The snapshot always re-reads the last 80 records; older history needs the
  paging route.

## Steering and permissions

- `POST /v1/sessions/:id/prompt {text, mode}` — `mode: "steer"` puts the message into the **current** turn (consumed at the next step boundary); `"queue"` (default) is a new turn.
- `GET /v1/snapshot` → `session.permission` (current preset) and `session.permissionOptions {options:[{value,name,description}], default}`.
- `POST /v1/sessions/:id/permission {value}` → `permissionPresets.set(session, value)`, which appends `permission/preset` and updates the sandbox + approval knobs.

## Models and slash commands

- `GET /v1/sessions/:id/models` → `{current:{provider,model,effort}, groups:[{id,name,models:[{id,name,efforts}]}]}`.
  `current` is `modelSelection.next`, i.e. the model the **next turn** will use — `contextTimeline` still describes the last turn.
- `POST /v1/sessions/:id/model {provider, model, effort?}` → `{ok, selected}`.
- `GET /v1/sessions/:id/commands` → `{commands:[{name, description, hint}]}` from `ctx.get('commands').list`.
- `POST /v1/sessions/:id/command {name, input?}` → runs it.

Commands print into the desktop UI, not the session log, so the phone can run them but cannot show their output yet.

## Session rows carry a workspace group

Each row in `GET /v1/sessions` and in `snapshot.sessions` carries three display fields the app does not have to compute:

- `group` — the last path segment of `cwd` (`No workspace` when there is none);
- `first` — true on the first row of its workspace, in the order returned (rows are sorted by `cwd`, then `updatedAt` descending);
- `when` — a relative age such as `4m`, `2h`, `14h`, `29d`, computed on the host.

`sessionController.search` exists but this deployment configures the session-query index with `openAt: "never"`, so it answers
`session search is disabled`; the app filters the session list locally instead.

## Paging the transcript

`GET /v1/transcript?session=<id>&take=<n>&since=<seq>` — `take` counts **turns** (default 8, capped 60); `since` returns only rows with `seq > since` plus the full id order (incremental refresh).
The response sets `session.hasMore` when the session has older messages than the window, which the app shows as
a "Load earlier messages" row at the top of the transcript; tapping it raises `take` by 120 and re-fetches.

## What the snapshot carries per tool call

`session.messages[].blocks[]` of kind `tool`:

| field | meaning |
|---|---|
| `callId` | the provider's call id, so a result can find its call |
| `name` | wire tool name (`bash`, `edit`, …) |
| `icon` | a cross-platform `symbol:` role the phone draws |
| `summary` | one line taken from the arguments (`command`, `file_path`, `pattern`, `url`, …) |
| `args` | pretty arguments, capped at 2400 chars |
| `status` | `running` / `ok` / `error` / `unknown` (a call the model never got back to) |
| `badge` | `exit 7`, `failed` — a non-zero shell exit counts as a failure |
| `result` | result text, 800 chars |
| `diffs` | `[{path, added, removed, lines:[{sign, text}]}]` from `meta.diffs` |
| `todos` | for `todo` calls: `[{text, state}]` |
| `question` / `options` | for `question` calls: the question and its choices |

Assistant messages also carry `usage` (`"382 in · 184 out"`). Beyond the message rows:

| field | meaning |
|---|---|
| `session.goal` | the session's goal objective (rendered as a grey strip above the transcript) |
| `session.plan` | `{title, steps:[{text, state}]}` from the plan projection, when the session has one |
| `session.approvals[].summary` | one line of the call the approval is about, so the phone shows `bash · exit 7`, not just `bash` |

## Payload budget and the call detail route

The snapshot is polled every 700 ms (2.8 s when idle), so it is budgeted, not complete:

- the newest 3 turns keep full detail (Markdown nodes, tool summaries, images);
- older turns are text-only (~1200 chars), which is what makes `take` turn-counting able to grow the window;
- tool cards keep `lazy: true` and ship no `args`/`result`; expanding one calls
  `GET /v1/sessions/<id>/call?callId=<id>`, which returns `{name, args, result, diffs, todos, question, options}` from the last fold;
- a 90 KB ceiling trims the oldest rows and sets `hasMore`.

`take` is a **turn count** (default 8, clamp 4–60), not a message count, and the oldest partial turn is dropped so a turn's row id stays stable while the window grows — the phone anchors scroll restoration on that id.
