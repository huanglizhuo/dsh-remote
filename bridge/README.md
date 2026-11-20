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

`cordis.patch.yml` inserts `dsh-remote`; there is no build step (plain ESM, Node built-ins
only). The package also ships a browser half (`lib/client.js`, injected into the DSH
desktop UI): the sidebar pairing panel, and the desktop mirror that lets the phone share
the Mac's own approval / question cards (see **Approvals, questions and plan reviews**).

**Reload after editing**: `set_bundle enabled=false`, then `enabled=true`. The old
instance's `ctx.effect` disposer closes the HTTP server, so the port is free.

## Pair a phone

1. On the Mac open <http://127.0.0.1:8787/pair>. It shows a 6-digit code (5 minutes,
   3 attempts) and is refused anywhere but the Mac on purpose (a peer that is not the
   loopback, a `Host` that is not `127.0.0.1` / `localhost` / `[::1]`, or a proxy header such as
   `cf-connecting-ip` / `cf-ray` / `x-forwarded-for` → 403).
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
- `/v1/devices` (GET; a token, or no token from the Mac itself — the sidebar panel): `{you: <masked id of the caller>, devices:[{id (8-char token prefix), name, at, seen, online}]}`. `DELETE /v1/devices/:id` revokes by that prefix; revoking the calling device is refused (400).
- `/v1/pair` accepts `body.name` (≤40 chars, stored with the token) and is rate-limited per IP: 8 bad codes within 15 min → `429 ip_blocked`.
- `/v1/file` serves only paths under the session's cwd or `os.tmpdir()`; anything else is a 403 `outside workspace`.

Everything except `/v1/health`, `/v1/pair`, `/v1/devices` (see above), `/v1/pairing*`, `/pair` and `/v1/desktop/*` needs
`Authorization: Bearer <token>` (or `?t=<token>` where an `<img>` cannot send headers). `/v1/pairing*`, `/pair`, `/v1/devices` without a token and
`/v1/desktop/*` answer on the Mac only: a loopback peer whose `Host` names the loopback (`127.0.0.1`, `localhost`, `[::1]`: a web page of another
site whose DNS name was rebound to 127.0.0.1 arrives with its own `Host`) and that carries no proxy header (`cf-connecting-ip`, `cf-ray`,
`x-forwarded-for`, `x-forwarded-host`, `forwarded`, `x-real-ip`: the tunnel, or any local reverse proxy). A bridge bound to the tailnet / LAN
(Tailscale up, or `config.bind:'all'`) therefore never hands out the pairing token to another machine. `/v1/desktop/*` also refuses a page of
another site (`Origin` must be loopback or a non-http scheme). The dev routes `/v1/_try`, `/v1/_ask`, `/v1/_svc` need the token **and** the Mac.

| Route | Purpose |
|---|---|
| `GET /v1/health` | `{ok, name, instanceId, paired, sessions, publicUrl, desktopAttached, api}` — cheap reachability probe; `desktopAttached` says whether a desktop window's mirror (`client.js`) is alive; `api` is the bridge's wire revision (**11**). With a token (or from loopback) it also carries `dsh` (the host's version, read from its package manifest, `""` when unknown) and `caps` — **Version and capabilities** |
| `GET /v1/pairing` / `POST /v1/pairing/refresh` / `GET /v1/pairing.svg` | the pairing view (code, link, token, `desktopAttached`) / issue a new code / the QR as an SVG — the sidebar panel's; loopback only |
| `GET /v1/devices` / `DELETE /v1/devices/:id` | paired devices / revoke one (above) |
| `POST /v1/pair {code}` | `{token, instanceId}` |
| `GET /v1/live?session=<id>&take=&listRev=&lang=` | the small poll: running/queue/approvals/question/todos/jobs/streaming, no message rows, plus `rowsRev`/`listRev`; pass the last `listRev` and the session list is omitted when unchanged (~1.9 KB warm). List rows carry `attention` (below), `unread` and `subs` (**Session list: unread dots and running subagents**), and `listRev` (it starts with the language) changes when any of them does. Top-level `prefs` carries the Mac's presentation settings (**The Mac's presentation settings**); `session.streaming.blocks` and `session.runActivity` carry the live process (**Live process detail and streaming**). `lang` is described under **Language of bridge-worded rows**. Top-level `limits` and the composer's `session` fields (`continueSeq`, `planMode`, `goalInfo`, `context` parts, `queue` rows): **The composer**. Top-level `bridge: {api, open}`: the wire revision and whether the Mac can open files (**Version and capabilities**). `session.subagents` (a tree), `subagentProgress`, `parentTitle`, `agentLabel`, `cwd` and the jobs' `state`: **Subagents, the environment and jobs** |
| `GET /v1/transcript?session=<id>&take=&since=&lang=` | the message rows; fetch only when `rowsRev` moved (idle sessions stop re-carrying history). `take` (turns) is 4–120. `rowsRev` is `<last event seq>:<take>:<projection version>:<lang>` (projection version **11**); the version moves whenever the row *projection* changes shape and the language is part of it, so clients drop caches keyed by it (the phone keys its transcript cache on everything after the second colon, and on the requested `lang`). Also `turns:[n…]`, every turn number of the session (**The turn rail**). Assistant rows of a turn that changed files carry `changedCount`, `changedFiles`, `changedAdded`, `changedRemoved` and `changesSeq` (**Turn tail: feedback, changed files, open on the Mac**) |
| `GET /v1/sessions?lang=` / `POST /v1/sessions {cwd?}` | the session list alone / create a session (`{id}`) |
| `POST /v1/sessions/:id/{rename {title}, fork {atSeq?}, pin {on?}, archive {on?}}` | rename / fork (`{id}` of the branch) / pin / archive (`on:false` undoes) |
| `POST /v1/sessions/:id/queue/:itemId[/steer\|/edit {text}]` | the queue dock: remove (default) / steer the item into the running turn / rewrite its text (`updateQueue`) |
| `POST /v1/sessions/:id/jobs/:jobId/kill` | stop a background job (`jobs.kill`) |
| `GET /v1/sessions/:id/events?limit=&before=` | durable transcript page (`sessionController.events`) |
| `GET /v1/sessions/:id/state` | `sessionController.state` (`running`, `queue`, `pendingInput`) |
| `GET /v1/sessions/:id/live` | per-attempt streaming buffers |
| `POST /v1/sessions/:id/prompt {text, mode?, images?, files?, continue?, failureSeq?}` | `mode:"steer"` steers, otherwise `followup`; initialises a model first. `images` / `files` are ids from `/v1/attach`; an empty prompt is accepted only as 继续生成 (`continue:true`) — **The composer**. A subagent child is not an ordinary session: a continuable one takes the message through the subagent runtime, a one-shot one refuses it (**Subagents, the environment and jobs**) |
| `POST /v1/attach?name=&media=` / `?kind=file&session=&name=` | a picture (kept encoded for the prompt) or a file (staged through the host's `fileUploads`): raw body in, `{id, name, bytes, kind}` out — **The composer** |
| `GET /v1/sessions/:id/refs?q=&quoted=&lang=` | the `@` menu: files and folders, this session's subagents, other sessions — **The composer** |
| `GET /v1/sessions/:id/commands` / `POST /v1/sessions/:id/command {name, input?}` | the slash menu (commands and skills) / run a host command (`commands.execute(agent, line, [], signal)`) — **The composer** |
| `POST /v1/sessions/:id/goal {action, objective?}` | `pause` / `resume` / `clear` / `edit` (the goal strip) |
| `POST /v1/sessions/:id/cancel` | stop the running turn; a subagent child is stopped through the subagent runtime (`subagents.interruptByUser`) |
| `GET /v1/sessions/:id/feedback` / `POST …/feedback {id, rating, note?, category?}` / `POST …/feedback/clear {id}` | the session's message ratings / record one / retract one — **Turn tail** |
| `GET /v1/sessions/:id/changes?seq=&i=&turn=&path=&lang=` | one changed file's comparison for a turn (the host's own diff, else the turn's tool diffs) — **Turn tail** |
| `POST /v1/sessions/:id/open {path, action:'open'\|'reveal'}` | open a workspace file or folder on the Mac, or show it in Finder — **Turn tail** |
| `GET /v1/sessions/:id/job?jobId=` | the tail of a background job's output — **Subagents, the environment and jobs** |
| `GET /v1/schedules?lang=` / `POST /v1/schedules {title, prompt, when}` / `POST /v1/schedules/:id/{edit,run,delete}` | the task manager — **Scheduled tasks** |
| `GET /` or `GET /pair` | the QR page the Mac shows (loopback only) |
| `GET /v1/sessions/:id/call?callId=&lang=` | one tool card's full detail: `args` and `result` up to 64 KB each, with `argsChars` / `resultChars` (the untruncated lengths), plus `diffs` (+ `diffHidden`), `todos`, `files`, `question`, `options`, the localized `title` and **`view`**, the card the phone opens (**Tool cards**); `lang` as on `/v1/live` |
| `POST /v1/approvals/:id {decision:'allow'\|'deny'\|'always'}` | answer an approval card (a tool approval, or a question-intent approval). `always` is **allow once** for a tool approval (there is no persistent tool grant); it is the asker's own `always` option only for a question-intent approval that offers one. Replies after the Mac's UI confirmed it |
| `POST /v1/questions/:id/answer {answers:[{id,selected,custom?}]}` | answer a question or plan review (one item per question; a missing one is a skip: `selected:[]`, no `custom`) |
| `POST /v1/questions/:id/dismiss` (alias `/skip`) | close the card: cancel the whole set (`ASK_CANCELLED`; for a plan review this is 要求修改) or, for a timed question, only collapse it |
| `POST /v1/questions/:id/hold {mode:'take'\|'engage'}` | stop the Mac's countdown (慢慢回答 = `takeTime`, the first edit = `engage`) |
| `POST /v1/sessions/:id/questions/:callId/reveal` | put a collapsed question back (the tool row's 回答) |
| `GET/POST /v1/desktop/{commands,state,ack,detach}` | the desktop renderer's half (loopback only, no token) — see below |
| `GET /v1/feed?after=<eid>&wait=<ms>` | long-poll event feed, one cursor across all sessions |
| `POST /v1/_try {method, args}` | dev escape hatch: call any `sessionController` method (loopback only) |

Rendering stays honest to DSH's own model: an `assistant/message` arrives as
`blocks` (`text` / `reasoning` / `tool` with the raw arguments), not as markdown to
re-parse. Every other message, command, compaction, retry and failure is a *note row* the bridge
titles itself (see **Transcript rows**). Every row also carries precomputed `tools` / `running` /
`thought` counts so the phone's process line (`✓ N 步`) never rescans the blocks array per render.

## Transcript rows

Rows follow the official ui-chat conversation nodes (`conversation-nodes/{message,inbox,event-projection,command,compaction,retry,turn-error,turn-max-tokens}.ts`, rc.3); every event field read here exists in rc.3 and a missing one degrades to a plainer row.

### Turns, steering and the active turn

- A phone "turn" opens with a **user** row (a human message) or a **trigger** row (the notification that woke it: a goal round, a schedule, a subagent settling…). The turn rail counts exactly those, load-earlier counts segments of them, and `took` runs from the opener of the same turn.
- **Steering is not a turn.** The bridge replays the `agent/inbox/spliced` splices (a claim = a splice that removes messages, outcome not `canceled`). A human `user/message` whose id is in the current **next-step** claim is steering; one claimed at Step 1 is an *idle steer* and is the turn's own opening user row. A steering message becomes a block `{kind:'steer', text, summary:'插话'|'Steer', images}` of the turn's assistant row, in order between the steps; it never starts a segment and never splits the assistant group. A steering message with no assistant row before it in its turn opens that group (row id `s<seq>`) and later steps merge into it. The group row's `seq` advances with every block it takes, so `since=` patches carry it.
- A window whose head is a steering message (its claim cut off) would read as an opener; when older history exists the head segment is dropped, so a turn's row ids stay stable as `take` grows.
- The assistant row of the turn that has **no `turn/end` yet** carries `active: true`; the phone expands that row alone while the session runs (a new turn's first poll never opens the previous turn's row).
- `failed: true` marks the assistant rows of a turn that ended with `reason.kind:'error'`; `interrupted: true` those of a turn that ended `aborted` or `interrupted` (the phone reads 已停止 / Stopped).
- When a turn ends, every assistant row of it takes the `turn/end` seq as its `seq` (the control, the usage and the fold flags below appear then, so a phone holding the open row must get the closed one in its `since=` patch). It is also the seq the phone's 从这里分叉 sends, which is where the official branch action cuts.

### Process groups, the turn control and the answer

An assistant row is one whole turn (its steps merged). Inside it, `blocks` follow the official ui-chat flow (`conversation-nodes/{process-groups,turn-process,turn-process-presentation}.ts`, `chat/step-process.ts`; rc.3):

- A step's own parts come first, its tool calls after (the tool-call nodes follow their message). **Consecutive non-reply members** (non-blank `reasoning`, `tool`, and the `ctx` blocks of the turn) form a *group*: a block `{kind:'group', id:'g<turn>.<n>', status:'done'|'running', text, icon, summary, detail}` placed before its members, each member carrying `grp:<id>`. A reply (`md` with text, `image`) or a steering block ends the group and stands outside it; a retry row between two assistant rows of the turn ends it too (group numbers keep counting across the turn's rows). A blank text block is no reply.
- `text` is the closed title (`processTitle`: the top three categories of the group's distinct tool calls joined by 并 / ，/ 等, `Read files and edited files`, `…, etc.` in English; a group of only contexts reads 已注入上下文, of only reasoning 已完成分析). Categories are the official `activity()` ones (read, readImage, search, write, edit, commands, code, webSearch, webFetch, subagents, plan, questions, tools); `icon` is the top category's `symbol:`.
- A group is `running` only while it is the last block of the row of the turn still open (nothing follows it); then `summary` / `detail` are its settled-log live title (正在… + the running call's first readable argument, 正在分析请求 while only reasoning). The phone refines it from `session.runActivity`.
- The reply blocks of the **final answer step** (the last step of a closed turn, with reply content and no tool call) carry `answer: true`.
- Flags on every assistant row of a turn: `steered` (a steering message is in it), `foldAll` / `foldFinal`: whether its process has anything to fold when folded replies are `all` / `final` (reasoning of the answer step, or any member outside it; with `final` also the earlier replies). A turn that was steered, failed or stopped is never folded.
- **The turn control** rides the turn's *first* row once the turn is closed: `title` 已完成，用时 1分23秒 (turn/start → turn/end, at least 1 s) · 已完成 (no start in the window) · 处理失败 (`reason.kind:'error'`) · 已停止 (`aborted` / `interrupted`), `state` `done` / `failed` / `stopped`, and `summary` the counts line `4 次工具调用 · 1 条消息 · 2 个 subagent · 已思考` (non-zero parts only: non-subagent tool calls, reply-bearing messages before the answer, subagent delegations, any reasoning); `took` is the elapsed seconds. An open turn carries none.
- **Turn usage** rides the turn's *last* row (the panel, **Turn usage**).
- Past 240 blocks a row keeps every reply and steering block and, newest first, each group with as many of its newest members as fit (the answer is never dropped); block `step` tags never reach the wire.

### Note rows

A note row has `role`, a bridge-worded header — `title`, `summary`, `icon` (a `symbol:<role>`), `state` — and its expandable body in `text`. Bodies are secret-masked and cut at about 4000 characters (3900 plus the mark) with the official `… 已截断，共 N 字符` mark; rows older than the newest dozen keep 2400.

| `role` | what it is | `title` / `summary` / `state` |
|---|---|---|
| `trigger` | a **non-user** `user/message` that woke a turn: it is in the current next-turn claim, or is an idle steer's notice (Step 1, a next-step claim of this turn holding no human message), or a `retry`-source message with empty content | `title` by source (`chat/turn-trigger.ts`): goal 继续执行目标 · agent-message 收到任务消息 · team-message 收到团队消息 · subagent-settled 子任务状态更新 / 子智能体已完成任务 · 已停止 · 执行失败 · 已达 token 上限 · 拒绝执行 · 异常结束 (by `stopReason`) · webhook 收到外部事件 / `provider:'github'` 收到 GitHub 事件 · schedule 自动化任务 · tool-jobs 后台任务状态更新 · cordis-host-runner 插件状态更新 · else 收到执行请求; empty retry = 已请求继续生成 with `state:'compact'` and no body. `text` = the explanation line, then the notification. `icon` per source |
| `context` | any other non-user `user/message`, and every `developer/message` | `title` 上下文注入, or 跨会话召回 for a `session-reference`; `summary` = the producer (a skill name, the instruction file paths, the recalled session labels, else the durable `kind`) plus a `notice`'s own one-line `summary`; `text` = the body for the declared `form` (`instructions` files + 已载入/已新增/已更新/已移除, `catalog` entries, `snapshot` sections, `relay` sender, `recall` labels with 保留 N 条 · 省略 M 条) then the model-facing text. Content made only of `tool-addition` / `tool-removal` blocks is 工具已更新 (`summary` 新增 N 个 / 移除 N 个 / 新增 N 个，移除 M 个, the names in `text`), or 已添加工具：X / 已移除工具：X with `state:'static'` (no body) for a single block |
| `compact` | a compaction checkpoint (a replacement `user/message` with `source.kind:'compact-checkpoint'`) with the `compaction/summary` before it | `title` 上下文已压缩 (a manual `/compact`: `compact`); `summary` 已压缩 N 条历史记录（约 X tokens）, else the command's text, else 点击查看压缩摘要 / 压缩摘要不可用; `text` = the summary Markdown (expandable only when there is one) |
| `command` | `command/run` + `command/done` | `title` = the command name (指令 when only the `done` is in the window); `summary` = 执行中… / the handler's text (first line; the whole text is `text` when it is long or multi-line) / 指令失败 / 已完成; `state` `running` / `ok` / `error`. A running `/compact` reads 正在压缩…; a finished one folds with its compaction into one `compact` row |
| `retry` | one row per `retryId` chain (`llm/retry`, `llm/retry-started`; the fields are `delayMs`, `failure`, `maxRetries`, `mode`) | `title` = `{label}（{retry}/{maximum}） · {seconds}s`; `state` `active` 正在重试模型请求 (the step and turn still open; `seconds` is the time left, computed bridge-side) · `started` 已重试模型请求 · `cancelled` 模型请求重试已取消 (the step or turn closed first). The official 等待重试模型请求 label is its fall-through for a scheduled retry that is not active, which its own view never produces (a scheduled retry in an open turn reads as active), so no row carries it. `maximum` is `∞` in `mode:'always'`; `text` = 重试延迟：N毫秒 and 失败原因：… |
| `error` | a failure at a turn's end | `title` 本轮运行失败, or 任务已停止 for ACCOUNT_SIGNED_OUT / INTERRUPTED; `text` = AUTH → API 密钥无效 (the provider's message is never echoed) · QUOTA / ACCOUNT_QUOTA → 当前请求的额度已用尽 · ACCOUNT_SIGN_IN_REQUIRED → 请先登录 DeepSeek，… · INTERRUPTED → the official restart text · else the (masked, 300-char) message; `summary` = the code badge (empty for INTERRUPTED); `state` `error` / `stopped` / `warning`. A `max-tokens` end is the warning row 已达到输出 token 上限 with the 发送“继续”hint. A user's stop has no row |

Only `user/message` events whose `surfaceOp` is `append` (or absent on an older log) become rows. Replacement surfaces are model-only and are not rows; a compaction checkpoint is one of them, and is where the `compact` row lands. (The official context body also dumps the source's other fields as a key / value list; the phone's body leaves that out.)

**Inline contexts.** A `context` row logged between two assistant steps of the *same turn* joins that turn's assistant row as a block `{kind:'ctx', text:title, summary, detail:body, icon, status:state}` (so it does not split the group); one logged before the turn's first assistant message stays a row.

### User rows

`role:'user'` rows carry `refs:[{path, kind}]` with `kind` `session` (an `@[label](dsh-session:…)` mention, and the labels of the `session-reference` context that follows the message directly), `skill` (the names of the `skill-invocation` injections of the same step) or `file` (an `@path`), and `blocks:[{kind:'image', att, media, w, h, text}]` for the message's image blocks. Image attachment refs are registered like the assistant's, so the phone loads them from `GET /v1/attachments/<id>?t=<token>`. Skill and recall chips ride the opening bubble only.

### Markdown nodes

An `md` block carries `nodes` (the text of a reply, a plan review's plan, a streaming reply). The bridge splits the source into blocks the way CommonMark / GFM do for LLM answers; the phone's `text markup="markdown"` reader paints the inline marks (bold, italic, strike, code, links, autolinks, footnotes, escapes), so what the bridge rewrites is only what that reader lacks. Node kinds:

| `t` | fields |
|---|---|
| `p` / `h` / `quote` | `v` the Markdown source of the block (`lvl` 1–6 for `h`; setext headings are `h`; a quote keeps its body as Markdown, the reader draws the list inside it) |
| `ul` / `ol` | `items:[{id, v, mark, d, sign}]`: `d` the nesting depth (0–5), `mark` the bullet by depth (`•` `◦` `▪`), the source's own number counting up per depth (`3.`, `4.`; a list opens at its first item's number), or the task box (`☐` / `☑`, `sign` `o` / `x`; `' '` otherwise). Continuation lines join their item; loose lists stay one list; bullets after numbers (or the reverse) at the top level start another list; a code fence inside an item splits the list |
| `table` | `cols`, `align` (one of `l` `c` `r` `-` per column), `head` and every `rows[].v`: the cells **joined with U+001F**, each already inline-processed; a short row is padded, a long one cut |
| `code` | `lang`, `v`; `runs:[[mark, text], …]` colours it for js / ts / jsx / tsx, py, sh / bash / zsh, json, go, rust, swift, java / kotlin, c / c++ (marks `k` keyword, `s` string, `n` number, `c` comment, `f` call, `t` type, `l` literal, `p` JSON key, `v` shell variable; at most 6000 characters / 150 lines, never while streaming). A one-line (minified) `json` fence is re-indented; a fence of any length closes on a fence at least as long; an unclosed fence runs to the end; 4-space indented code after a blank line is `code` too |
| `math` | `v` the TeX source: `$$ … $$` (one line or several), `\[ … \]`, a ` ```math ` fence. No typesetting (the phone shows the source); inline `$x^2$` / `\(x\)` become a code span in the text (`$5 and $10` is left alone: no white space inside the dollars, no digit or letter glued outside) |
| `diff` | `items:[{id, sign, v}]` for a `diff` / `patch` fence |
| `img` / `gallery` | an image-only line, consecutive ones a gallery (`items`), with `w`/`h` read from the workspace file |
| `hr` | — |

Inline rewrites (outside code spans): a Markdown **file link** `[a](src/a.ts:12)` / `[a](./b.md#L3)` / `[a](/abs/c)` (file-link.ts `parseFileLink`: explicit paths win over URLs; anchors, queries and URLs are not files) points at the phone's `/file?p=<path>` route — the viewer opens over the chat — while `https:` / `mailto:` links stay and leave the app; a `**` that CommonMark's flanking rules refuse beside CJK punctuation gets a hair space (what the official `cjkFriendlyStrong` fixes); a backslash hard break drops the backslash.

Not aligned with the official micromark pipeline (gaps): reference-style links and definitions, raw HTML, a list item's second paragraph or fenced code (the list splits instead), alerts (`> [!NOTE]`), entity references, KaTeX typesetting.

### Failure toast

`session.quota` / `session.quotaId` are set when the **newest** turn ended with an error whose **code** is `QUOTA` or `ACCOUNT_QUOTA` and nothing has begun since (never by matching the wording); `quotaId` is the failure row's id, so the phone toasts each failure once.

### Language of bridge-worded rows

`lang=zh-Hans` (default, also for an absent or unknown value) or `lang=en` on `/v1/live` and `/v1/transcript` picks the language of every string the bridge words in this section (steering marker, trigger / context titles and summaries, tool updates, compaction, command and retry rows, failure rows, the live retry countdown) and, since projection 9, the run label (`深度求索中，用时 …` / `Deep diving for …`), the live activity titles (正在… / 准备… / 已…), group titles, the turn control and counts, the usage panel and the day labels. The tables are the official ui-chat zh / en dictionaries. The phone sends its effective locale (the language chosen in Settings, else the table the system picked). Since projection 10 also the tool rows and cards (titles, summaries, exit labels, todo comparison, the card copy of `GET …/call?lang=`; official `tool.title.*`, `terminal.*`, `read.*`, `search.*`, `web.*`, `row.*`, `todo.diff.*`, `detail.*` dictionaries). Since wave 6 nothing the bridge words is zh-only: relative session / job ages (the official `time.*` words: 刚刚 / 4分钟 / 2小时 / 3天 / 2个月 / 1年, `now` / `4min` / `2h` / `3d` / `2mo` / `1y`), schedule timing and states, the workflow card, subagent modes / activity / progress, job states, and the refusals of subagent messaging and open-on-the-Mac are in the tables; a secret mask is stars (the official mask character) and carries no words; the pairing page the Mac shows follows the browser's `Accept-Language`; the desktop panel (`client.js`) follows `navigator.language`. List rows are worded in the request's `lang` and `listRev` starts with it, so a language switch resends the list.

### Retry countdown

A retry waiting out its delay has no open stream, so `/v1/live` words it in `session.runActivity` with a live countdown: `{kind:'retry', label:'正在重试模型请求（1/3） · 5s', detail:''}`; the row's own `seconds` is frozen at projection time.

### Live process detail and streaming

`session.runActivity` is `{kind:'tool'|'thinking'|'retry', label, detail}` or null: the title of the open group, as the official group header words it. A tool call still streaming its arguments reads **准备**读取文件 (`step.prepare.*`), a dispatched one **正在**读取文件; `detail` is the first readable argument in the official key order (`title, description, … command, …, file_path, path, …`), for incomplete JSON the text so far (a string array joins with commas); complete arguments with none readable fall back to the tool's name. While only reasoning streams it is 正在分析请求 with the latest non-empty paragraph as `detail`. It is null when a reply is streaming (the reply ended the group), when no group is open, or when the turn is closed — a closed turn is no longer labelled by its newest settled call.

`session.streaming` is `{blocks:[…]}` or null: the attempt that is streaming right now, as phone blocks that **continue the open turn's groups** (the settled projection remembers where they stand): `reasoning` (`status:'running'`, `text`, and `summary` = the first line of its latest completed paragraph — a settled reasoning block carries no `summary`, the first line of its text is its preview), `md` (`nodes` of the text so far, parsed once per poll; no raw copy; a reply past 120 blocks shows its newest 120, so the tail never stalls), `tool` (`status:'running'`, `summary` = the one-line detail above, not raw JSON), and `group` headers it starts. Reasoning and tool calls join the open group (or start `g<turn>.<n>`), a text reply closes it, a step's tool calls follow its text. The phone appends these blocks to the open turn's row (or shows them as the turn's first assistant row while it has none); when the step settles the rows revision moves and they are replaced by the real blocks with the same group ids.

### The Mac's presentation settings

`/v1/live` carries `prefs: {transcriptView, collapseTiming, foldedReplies, performanceUsage, busyEnter}` so the phone presents a transcript the way the desktop does (`chat/presentation-policy.ts`): `transcriptView` `compact|standard|detailed|verbose` (legacy `normal` / `expanded` read as `detailed`; a desktop that saved none reads `standard`), `collapseTiming` `completion|next-input`, `foldedReplies` `all|final`, `performanceUsage` `compact|detailed`, and `busyEnter` `queue|steer` (the composer's default for a message sent while a turn runs). They come from the host's `settings` service (`describe()` of the `ui-chat` and `ui-conversation` entries, secrets redacted, resolved over the profile patch; cached 10 s and dropped on `settings/document-updated`); an entry the service does not describe is read, read-only, from the profile patch file (`profileContext.patchPath`, else `~/.dsh/profiles/desktop/cordis.patch.yml`: the `config:` scalars of the entry with that `id`). Nothing is ever written, and a failing service or a missing file reads as the official defaults (`standard`, `completion`, `all`, `detailed`, `queue`).

### Turn usage

The usage of a closed turn is `deriveTurnTokenUsage` (llm/token-meter `turn-usage.ts`) over the turn's own lifecycle (`turn/start`, `step/start`, `assistant/attempt`, `assistant/message`, `llm/retry`, `llm/retry-started`, `step/end`, `turn/end`): exact, summed over every billed attempt, and **unavailable** (no `usage`) when a boundary is missing, an attempt reports no usage, a count is unsafe or an exact total contradicts its parts. The last assistant row of the turn then carries `usage` (`用量 10.7K tok`, `Usage 10.7K tok`) and `usageRows:[{id, label, value}]` in the official panel order: `model` (distinct provider/model of the attempts, when every one has them), `hit` (cache read / prompt, tenth precision, never rounding a partial hit up to 100), `in` (未缓存输入), `cr` (缓存读取) and `cw` (缓存写入) when every attempt reported them, `out` (输出, with （其中推理 N） when reported) and `tps` (输出速度: output tokens over first token → message of the steps that report both). Figures are exact with `,` grouping; the line uses 517 / 12.2K / 1.2M.

`session.stats` adds the stats sheet's timing figures from the `sessionStats` projection (whole log): `llmMs`, `toolMs`, `ttftMs` with `ttftSteps` (average first-token latency = `ttftMs / ttftSteps`) and `decodeMs` with `decodeTokens` (speed = tokens / seconds); all 0 when the host serves none.

### The turn rail

`/v1/transcript` (and every `since=` patch) carries `turns:[n…]`: every turn number of the session, ascending, from the `turnOutline` projection (`[]` when the host does not serve it; the live poll never carries it). Rows of a turn carry `turn: n` (an opening user / trigger row and its assistant rows), so the phone maps rail chips to loaded rows; a chip whose turn is not loaded raises `take` (up to 120 turns, bounded by the row budget) and scrolls to the opener once it arrives.

## Turn tail: feedback, changed files, open on the Mac

**Message feedback** (ui-message-feedback; the host's `messageFeedback` service). The target is the DSH message id the assistant row carries (`msgId`, the last step of the turn, as the official tail action).

- `GET /v1/sessions/:id/feedback` → `{items:[{messageId, rating:'positive'|'negative', note, category, version}]}` (the host's `{ok, value}` result unwrapped; a `{ok:false}` is answered with the host's code).
- `POST …/feedback {id, rating, note?, category?}` records exactly that item (like the official dialog: an entry without a note or category replaces what was stored). The host compares versions per item (`ifVersion`), so the bridge reads the item's current version first and sends it (`null` for a new one); a race the host still catches is **409 `version-conflict`** with `item` = the item as it stands. `category` is one of the seven official ids (`task-result`, `instruction-following`, `product-interaction`, `service-stability`, `resource-cost`, `security-privacy-permission`, `other`); anything else is dropped. A blank note is dropped; a note over the host's byte limit is **413 `note-too-large`**; an unknown message **404 `target-not-found`**.
- `POST …/feedback/clear {id}` retracts the item (`delete` with the observed version; an absent item is ok).
- No service → 409 `feedback unavailable`. The phone words the codes (the official `error.conflict`, `error.noteTooLarge`, `error.generic`) and shows the official dialog (title 提交反馈, the seven categories, details, the hint that the conversation log goes with it) for **either** thumb, as the desktop does; a recorded thumb retracts on a tap.

**Changed files** (ui-deliverables). The official card is driven by the `workspace/changes` Session event (`{turn}`; the latest per turn wins) and the host's `workspaceChanges` service (`summary(sessionId, seq)` / `diff(sessionId, seq, index, signal)`: git snapshots of the turn start and end, so shell edits count and each file has real hunks; a summary lives only while the Session lives in this Host process). The bridge scans the event; on the turn's **last** assistant row it carries (and moves that row's `seq` to the event's, so a phone holding the row gets it in its patch):

- `changedCount` = the summary's `total`, `changedAdded` / `changedRemoved` its totals, `changesSeq` the event's seq, and `changedFiles:[{path, name, added, removed, i, note}]` (at most 20; `name` is the summary's `display`, `path` its durable path, `i` its index in `summary.files`, `note` `binary` / `oversized`).
- Without a summary (a session reopened after a restart, an older host) the row falls back to the files its write-class tool calls touched (`i:-1`, `name` = the path, no `changesSeq`) — the count is then unique files, not calls.
- `GET …/changes?seq=&i=&turn=&path=` is the file's comparison page: the host's `diff()` when `seq`/`i` name one (hunks become card lines: `#` header `@@ -a,b +c,d @@`, ` `, `-`, `+`, `n` the new file's line number; `kind:'binary'|'oversized'` carry no lines; `created`, `deleted`, `coarse` as the host says; at most 1500 lines, `cut` says more); else the turn's `write` / `edit` / `apply_patch` diffs from the per-session call index (the call index remembers each block's turn). 404 `missing` when there is nothing to show. Line text is secret-masked.
- **Presented files** stay `deliverables:[{path, text}]` (the `present` tool's files); the phone shows them as cards that open the viewer.

**Open on the Mac** (`sessionController.canOpenWorkspacePath()` / `openWorkspacePath({path, action?:'reveal'}, signal)`; the host verifies the path against its composed filesystem). `POST …/open {path, action}` resolves `path` against the session's cwd and, like the viewer, serves only the workspace and the temp dir (`403 outside workspace`); a file the system would *run* when opened (`.command`, `.tool`, `.app`, `.pkg`, `.dmg`, `.scpt`, `.workflow`, shell scripts, `.bat`, `.exe`, `.jar` …) is only ever revealed (`403`, `open.notAllowed`). No desktop → 409 `open.unavailable`; any host failure is answered in words (`open.failed`), never echoed. `"."` is the workspace folder itself. `bridge.open` on `/v1/live` says whether to offer it.

## Session list: unread dots and running subagents

List rows carry `unread` (`''` | `'done'` | `'failed'`) and `subs` (direct subagents running now, from the catalog projection). The unread flag is the official one (ui-session-status): the host's `sessionStatus` records `{completedTurn, failed, readTurn, manualUnread}` — unread = `manualUnread || completedTurn > readTurn`, failed = unread and the last completion ended in an error — read from the service's record map when it has one, else from the bridge's own (fed by the `turn/end` events it sees, which is all the host's service knows too). A request for `/v1/live?session=<id>` is the phone *viewing* that session: the bridge shows it as read and marks it read through the service's own `mark(id, {type:'read', throughTurn})` (so the Mac's sidebar dot clears too), once, when it was unread.

## Subagents, the environment and jobs

- `session.subagents` is the session's **tree** (ui-subagent `SubagentHeaderLineage`): direct children from its `subagentCatalog`, each followed by its own children (three levels, forty rows). A row: `{id, sessionId ('' for an external task), label (the catalog label, else the child's title, else its name), sub (the name when it differs), mode (worded), modeCode, activity ('running'|'completed'|'inactive'|''), state (worded), meta ('3.5K tok · 1m 5s': the four `tokenUsage` buckets summed and `subagentTiming`'s settled + active time), depth}`. `session.subagentProgress` is the direct children's counts line (`1 已完成 · 2 进行中 · 1 未运行 · 1 外部任务`, the official `progress.*`).
- A child's own `/v1/live` carries `parentId`, `parentTitle` and `agentLabel` (the breadcrumb) beside `origin:'subagent'` and `subagentMode`.
- **Messaging.** The host's generic `sessionController.prompt` refuses a child (`session/agent-busy`: "owned by subagent routing"). The official composer sends through the subagent runtime (`remote.subagents.prompt` / `interruptByUser`), so the bridge does the same: for a child whose mode is `continuable`, `POST …/prompt` calls `subagents.prompt({requestId, childSessionId, delivery:'queue'|'steer', content}, signal)` (pictures ride, files are refused, an empty prompt is no 继续生成); a one-shot or unknown child is refused in words (`subagent.notResumable`); the host's `subagent/not-resumable` and `subagent/delivery-unavailable` are worded too. `POST …/cancel` for a child is `subagents.interruptByUser(id)`. The phone's composer stays for a continuable child only (files hidden), and the stop button works.
- `session.cwd` is the environment's working directory (the phone's 环境 section, with **Open on the Mac**).
- Jobs rows carry `state` (the job list's words: 运行中 / 正在停止 / 已完成 / 已取消 / 已失败) beside `status` (the code), and `when` in the language. `GET …/job?jobId=` reads the job's output with `jobs.get(id, session)` + `jobs.readAt(id, max(earliest, total − 40000), session)` (non-consuming): `{id, status, total, text (ANSI stripped, secrets masked, at most 24000 characters, the tail), more}`; 404 for an unknown or foreign job, 409 without the service.

## Scheduled tasks

A host task (`schedule` service; rc.3 `ScheduleCatalogEntry`) is a *flat* record by kind: `at` / `after` (`scheduledAt`), `every` (`everySeconds`), `daily` (`time`, `timeZone`), `weekly` (+ `weekdays` 1–7), `cron` (`expression`, `timeZone`) or `rrule` (DTSTART + RRULE lines), plus `status` `active|paused|ended`, `updatedAt`, `executionActive`. `GET /v1/schedules?lang=` answers `{items, total, zone, tomorrow}` (`zone` the Mac's time zone, `tomorrow` the date there): each item is `{id, title, prompt (≤ 4000), status, state (已开启 / 已暂停 / 已结束; 已到期，等待会话恢复 for an enabled task whose run time passed more than a minute ago and that is not delivering now, flagged by `overdue`), kind, timing (worded: 每天 09:00（Asia/Shanghai）, 每周 周一、周三 18:30（UTC）, 每 2 小时, 单次 · date, Cron …, an RRULE read as 每周 / 每月 / 自定义), nextAt (the later of `scheduledAt` and the delivery floor's end, as the official `taskNextRunAt`), next (worded, enabled and not overdue only), updatedAt, targetSessionId, running (`executionActive`), overdue, mode, date, time, zone, interval, unit, days}` — the last seven are the phone's editor fields (`mode` `once|every|daily|weekly|custom`; a cron or an unusual RRULE is `custom` and is kept as it is on save).

Create / edit take the timing as a structure, never JSON: `when:{mode, date?, time?, zone?, interval?, unit?:'minutes'|'hours', days?}` → `once` = `{kind:'at', at:{date, time:'HH:mm:00', time_zone}}`, `every` = `{kind:'every', every_seconds}`, `daily` / `weekly` = typed `daily` / `weekly` with the time and zone (weekdays sorted, unique). A malformed `when` or an unknown zone is `400 invalid_rule` before the host sees it (the old raw `timing` object is still accepted). Edit carries the phone's `updatedAt` (else the bridge looks it up) as `expectedUpdatedAt`. Every refusal is a stable code the phone words with the official task-manager copy: the host's input codes (`invalid_prompt`, `invalid_selector`, `invalid_rule`, `invalid_time_zone`, `not_future`, `time_out_of_range`, `frequency_too_high`, `subagent_session`) are 400, `schedule_conflict` and `schedule_execution_pending` (a run that was not admitted: it is no longer reported as success) are 409, `schedule_not_found` 404.

## Version and capabilities

`BRIDGE_API` (**11**) is the bridge's wire revision: a change the phone depends on moves it. `/v1/health` carries it as `api` (public) and, with a token, `dsh` and `caps`; `/v1/live` carries `bridge:{api, open}`. The phone shows a hint when the bridge it reaches sends no revision or an older one than it needs ("reload the plugin on the Mac"). `caps` is what *this process can actually do now*: `open` (the controller's `canOpenWorkspacePath()`), `feedback` (`messageFeedback.put`), `schedules` (`schedule.list`), `changes` (`workspaceChanges.diff`), `readMarks` (the host's `sessionStatus` records), `subagentSend` (`subagents.prompt`), `jobOutput` (`jobs.readAt`), `files` (`fileUploads.uploadStream`), `commands` (`commands.execute`), `settings` (`settings.describe`). Every feature that needs a host service or projection checks for it and degrades to "not offered" (a 409 with a reason, or the older fallback), so a host older or leaner than rc.3 never makes the bridge throw. `dsh` comes from `pluginPackages.packageOf('@deepseek-ai/dsh-app-boot', import.meta.url).version` (then the session controller's package) — `""` when the service cannot say; it is informational only, nothing branches on it.

## Push notifications

Not implemented, and what is missing is exact. Exact (the phone's framework) *has* the pieces — `@exact/notifications` (local notifications, badge, tap-to-navigate), `@exact/background` (periodic sync wakes, at best every 15 minutes, when the platform chooses) and `@exact/push` (a visible push from the app's own server through APNs / FCM) — but this repository cannot use them as it stands: (1) `apps/mobile/package.json` lists none of them, and adding one (`bun exact.mjs add notifications`) is a dependency change plus the grant `device.notifications purpose.notifications` (and `device.push` / `device.periodic-background-sync`) in `app.ts` and a `purpose.notifications` strings key; (2) a local notification can only be posted by the app while its JS runs, which iOS suspends seconds after the app leaves the foreground, so local notifications cannot alert a backgrounded phone — the foreground 本轮已完成 toast is what they would add; (3) alerting a backgrounded or closed app is `@exact/push`: it needs Push Notifications in the iOS provisioning profile (`aps-environment`), an APNs key (and, on Android, Firebase's `google-services.json`), and a sender — this bridge is plain Node with no dependencies, runs inside the DSH process, and has no APNs / FCM client or relay, so there is nothing to send the push. The bridge side is ready for a sender: `GET /v1/feed?after=&wait=` is a long-poll event feed across all sessions (`approval/request`, `question/request`, `live/end`, `turn/end` …) a notifier can follow.

## The tunnel and the QR code

`cloudflared` is optional but assumed: on load the bridge spawns
`cloudflared tunnel --url http://127.0.0.1:8787`, reads the `trycloudflare.com`
hostname out of its log, keeps it in memory and restarts it 5 s after an exit.
`config.tunnel === false` turns this off; without `cloudflared` on PATH the
bridge logs the failure and stays loopback-only.

`GET /` and `GET /pair` (loopback only — see **API**; a request from anywhere else gets 403) render the QR: it encodes
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
- Uploads from the phone (several pictures and files per message) are described under **The composer**;
  a queued message's pictures are served by this same route.

## A file from the transcript

`GET /v1/file?p=<path>&s=<session>&t=<token>` serves a file the Mac's transcript referenced by
path (a Markdown image in an answer). Relative paths resolve against the session's cwd, only
regular files under 24 MB are served, and the same token rules apply as the attachment route.
`GET /v1/file` and `GET /v1/sessions/:id/file` are both scoped to the session's cwd and the system temp dir (judged on the real path, so `..` and symlinks cannot walk out); anything else is a `403 outside workspace`.

## Approvals, questions and plan reviews

The desktop UI keeps every pending interaction in `ctx.uiSession.pendingInteractions`: one object per
session — a `PendingApproval`, or a `PendingQuestion` (a question set, or a plan review) — each with its own
`answer()` / `dismiss()`. The phone shows and answers **those same objects**; whoever answers first wins.

### Who answers a request

The host raises `approval/request` / `user-questions/request` waterfalls; the bridge registers a `prepend`
listener for both and decides **per request**:

1. **A desktop client is attached** (the renderer half, `client.js`, is alive: an open long poll or a state post
   within the last 6 s) → `next()` at once. The desktop's own approval / question UI owns the request exactly as
   officially (no timer, no hand-off). The client mirrors the objects to the bridge and applies the phone's decisions.
2. **No desktop client, but a paired phone was seen recently** (any authorized request within 5 minutes; `config.phoneRecentMs`)
   → the bridge answers: the request is **held until the phone answers or the host aborts it** (`request.signal`:
   the turn stopped, or a timed question's own wait ended). There is no 15 s / 45 s / 120 s hand-off to the Mac, and an
   abort always drops the item. For every session, not only the one the phone has open.
3. **Neither** → `next()` at once: the official fail-closed path (`unavailable`).

A fallback hold ends with the plugin: reloading it fails held requests closed (`unavailable` / `ASK_ABORTED`). A request
held in mode 2 never reaches a desktop window opened later (a Cordis waterfall fixes its listener chain when it
starts); it stays answerable on the phone.

### The desktop mirror (`client.js` ↔ `/v1/desktop/*`)

Loopback only, no token (same trust as `/v1/pairing`). The client has a random id per renderer.

| Route | Purpose |
|---|---|
| `POST /v1/desktop/state {client, items}` | full replacement of this renderer's pending objects; sent on change and every 5 s. Item: `{key, kind:'approval'\|'question'\|'plan-review', sessionId, callId, …}`; an approval adds `toolName, reason, displayReason`, a question adds `questions, dismissal:'hide'\|'cancel', card:{state:'open'\|'continued', waitState, countdown:{remainingMs, running}}` |
| `GET /v1/desktop/commands?client=&wait=` | the long poll (≤ 25 s) for phone decisions: `{commands:[{id, op:'answer'\|'dismiss'\|'hold'\|'reveal', key, …}]}`. An open poll is the liveness signal (it needs no timer, so a throttled background window stays attached) |
| `POST /v1/desktop/ack {client, id, ok, error?, value?}` | the result of applying one command |
| `POST /v1/desktop/detach {client}` | sent on `pagehide` / plugin teardown (`sendBeacon`) |

A phone answer (`POST /v1/approvals/:id`, `/v1/questions/:id/…`) is queued for the owning client and the route replies **only after
the client's ack** (up to 8 s): `200 {ok:true}`; `404 {error:'expired'}` when the object is gone or already settled (the Mac
answered first); `409 {error:'undelivered'}` when no ack arrived (the phone shows 未送达，请重试 and keeps the card). Each
command carries a unique id and the client remembers what it applied, so a re-delivery is acked, never applied twice.
`id` on the wire is a stable alias of (client, key) — keys repeat across renderers.

The client applies an `answer` by calling the object's own `answer()` (an approval takes `'allowed-once'` / `'rejected'`, a question
`{answers:[…]}`), `dismiss()`, and for `hold` `takeTime()` / `engage()`; `reveal` goes through `ctx.get('userQuestionPanels')`. It
only ever calls those methods; it adds no UI to the desktop. Several renderers can be attached; each decision goes to the one that owns the key.

### What `/v1/live` carries

`session.approvals[]` (oldest first; the phone shows the last, as the desktop shows the last published) and `session.question` (one: plan review > question):

- approval: `{id, toolName, reason, callId, command, summary, args, subject, detail, approveLabel, alwaysLabel}`. `reason` is a **string**
  (`displayReason` resolved: Chinese, then English, then the plain reason; the phone falls back to 工具 {toolName} 请求越权执行).
  `command` is the correlated call's shell command / terminal text — for `bash`/`shell`/`pwsh` the card's `args` already *is* the command.
  A question whose only item has `intent.kind === 'approval'` is an approval card too: `subject` (name), `detail`, the asker's
  `approveLabel`, and `alwaysLabel` when it offers a persistent grant (the one legitimate "始终允许").
- question: `{id, callId, kind:'question'\|'plan-review', state:'open'\|'continued', dismissal:'hide'\|'cancel', countdown, running, held,
  questions:[{id, header, question, detail, multiSelect, options:[{id, label, text, recommended, description}]}], plan}`.
  `countdown` is the Mac's own seconds left (`-1` = none; computed from the client's `remainingMs` at response time), `running:false` is a
  paused one, `held` is 慢慢回答, `state:'continued'` is "已继续工作，仍可回答". `recommended` = the label ends in `(Recommended)` /
  `（推荐）`; `label` is the answer value, `text` the display. `dismissal:'hide'` (a card keyed by tool call) only collapses; `'cancel'`
  ends the request. `plan` (plan review) = `{title, description, nodes, chars, approve}`: first line, first paragraph, the full plan as
  Markdown nodes, and the approve option's label — answer with `selected:[approve]`; 要求修改 is `dismiss` (`ASK_CANCELLED`: plan mode ends the turn without spending a model request and stays active, and the person types the feedback as an ordinary prompt — the composer comes back as soon as the card is gone).
- list rows: `attention: 'approval' | 'question' | 'plan-review' | ''` (what waits on that session, plan review > question > approval;
  a subagent child's request marks its parent row too). It is part of the `listRev` fingerprint.

### Timed questions and late answers

A timed `ask_user_question` (`mode: 'timed'`) lets the agent continue when the wait ends; the question stays answerable
(`continued`) and a late answer is steered in as a `user-question-reply` message. With a desktop client the Mac's card stays
up (or collapsed, reopened from the tool row) and the phone uses it. Without one the bridge rebuilds the card from the session's
`userQuestions` projection and answers through `userQuestions.answer(agent, callId, …)`.

### Question rows in the transcript

An `ask_user_question` tool block carries `ask: {state, answered, total, answerable, callId, items:[{id, header, question, answers, skipped}]}`,
`state` ∈ `waiting` (等待回答) · `pending` (已继续工作，仍可回答) · `answered` (n/m 已回答) · `closed` (已结束) · `cancelled` (已取消) ·
`interrupted` (已中断), read off the recorded result and the `userQuestions` projection (the official AskQuestionRow rules).
`answerable` offers the row's 回答 (`reveal`). A `user-question-reply` user message becomes a `qreply` row
(`blocks:[{kind:'qa', ask}]`, the 问题与回答 view: the question, then 回答： the answers or 已跳过) instead of an injection row.

### Failure modes

- Phone answer after the Mac answered → `404 expired`; after the renderer vanished → `409 undelivered` (no ack in 8 s).
- Plugin reload while the phone holds a request (mode 2) → the request fails closed.
- The desktop client is *attached* but its UI never shows an object (a renderer without the approval plugin) → the host's own
  waterfall behaves as without the bridge.

## Paging is by turns

`take` on `GET /v1/transcript` (and `/v1/live`) counts **turns**, not messages. A turn can carry 20–40 step messages, so a message window made "load earlier" add one row and look broken. The bridge asks for `N*96+40` messages (at most 6000), merges steps into turns, then keeps the newest `N` and reports `hasMore` when older turns were dropped.

## Payload size

`GET /v1/live` ships a **slim** session row (id, title, cwd, status, running, timestamps, goal/permission/pinned flags, group). The heavy `meta` blob (projections) stays server-side — shipping it made every poll ~230 KB with 24 sessions, which on a phone caused overlapping requests and a flickering "re-link" banner. Keep new fields small; the phone polls this every 700 ms while a turn runs.

## The sidebar panel

The same bundle ships a browser half (`lib/client.js`, declared by
`dsh.client` in `package.json`). It puts a **远程配对** (English window: **Remote pairing**) row in the DSH sidebar;
selecting it opens a panel with:

- the QR code (`/v1/pairing.svg`) and a live countdown on the six-digit code
- **刷新二维码** and **在浏览器打开** (`/pair`)
- 服务器地址 (the tunnel URL while cloudflared is up, else the loopback URL)
- 配对链接 (`dshm://pair?u=…&c=…`, the payload the phone's scan screen reads)
- 设备 token (masked, with 显示 / 复制) — and a warning that it can write to
  every session on this Mac
- one line saying whether this window's approval / question cards are mirrored to the phone
  (`desktopAttached` in `/v1/pairing`); if it says not, refresh the window or reload the plugin

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

- `POST /v1/_ask {sessionId}` is a dev route (loopback only) that fires a synthetic approval
  inside a running turn; the phone answers it through the normal card.
- Session list has create/rename/fork; no delete yet.
- No push notification when a turn ends or an approval is asked: see **Push notifications** (what is missing, exactly).
- A window holds the newest `take` turns (at most 6000 records); older history is paged by raising `take` (up to 120) or read raw through
  `GET /v1/sessions/:id/events`.

## Steering and permissions

- `POST /v1/sessions/:id/prompt {text, mode}` — `mode: "steer"` puts the message into the **current** turn (consumed at the next step boundary); `"queue"` (default) is a new turn.
- `GET /v1/live` → `session.permission` (current preset) and `session.permissionOptions {options:[{value,name,description}], default}`.
- `POST /v1/sessions/:id/permission {value}` → `permissionPresets.set(session, value)`, which appends `permission/preset` and updates the sandbox + approval knobs.

## Models and slash commands

- `GET /v1/sessions/:id/models` → `{current:{provider,model,effort}, groups:[{id,name,models:[{id,name,efforts}]}]}`.
  `current` is `modelSelection.next`, i.e. the model the **next turn** will use.
- `POST /v1/sessions/:id/model {provider, model, effort?}` → `{ok, selected}`.
- `GET /v1/sessions/:id/commands` and `POST /v1/sessions/:id/command {name, input?}`: see **The composer** (commands and skills, the rc.3 `commands.execute` signature, plan and goal).

A command's lifecycle is logged (`command/run` + `command/done`), so its card shows in the transcript (**Note rows**); the handler's text also comes back in the route's answer.

## The composer

Everything the phone's composer does that is not "send text": the primary button, plan mode, the goal strip, the slash and `@` menus,
attachments, the queue dock and the context meter. Every host call below was checked against the rc.3 source; a service or projection a
host does not have makes only its own control disappear (nothing here throws out of a route).

### `/v1/live` additions

Top-level `limits` `{images, files, fileBytes}`: `images` is the host's `maxImagesPerMessage` (20), `files` says whether `ctx.get('fileUploads').uploadStream`
exists (the phone offers non-image files only then), `fileBytes` is this bridge's per-file cap (32 MB; the host stores a file verbatim and limits nothing).
`session` gains:

| field | meaning |
|---|---|
| `continueSeq` | the failed `turn/end` seq a **继续生成** would address: the `conversationContinuation` projection's `ending` (a `RATE_LIMIT` / `SERVER` / `TIMEOUT` / `TRANSPORT` / `EMPTY_RESPONSE` / `STREAM_CLOSED` failure of an admitted turn), offered only while the session is idle, ordinary (not a subagent child) and nothing is queued or steering (`state.queue` holds no `queued` / `steering` item). `null` otherwise, and on a host without the projection |
| `planMode` | from the `plan` projection `{active, pending}`: `off`, `on`, `entering` (pending on) or `leaving` (pending off); absent where plan-mode is not composed. The phone treats `on`/`entering` as the effective target (ui-plan's chip) |
| `goal` / `goalId` / `goalPhase` | now read from the `goal` projection (`goal.objective` / `id` / `phase`), the list summary only as a fallback |
| `goalInfo` | `{rounds, max, reason, activation}`: `roundsStarted` of `maxGoalRounds`, the blocker's message while `blocked`, and the process-local `activation` (`armed` / `disarmed`, from `goals.get(agent)` of a live agent; `''` for a cold session). GoalBar's labels: active 进行中的目标 (**待继续的目标** when `disarmed`), paused, blocked; a `complete` goal shows nothing |
| `context` | `{used, total}` plus `{system, tools, messages}` from the `contextBreakdown` projection (the meter's panel: 系统提示词 / 工具定义 / 对话消息) when the host serves it |
| `queue[]` | `{id, text, images[{id,att,media,w,h,text}], files[{id,path,text}], editable}`: only the **next-turn** (`placement:'queued'`) items, as QueueDock lists them (a steering message is not in the dock); `text` joins the text blocks, `editable` is false when any block is not text (the host refuses such an edit: `queue.edit.unsupported`), images are served through `/v1/attachments/<id>` |

(Wave 5 changed no row projection; the transcript `PROJ` is **11** since wave 6.)

### 继续生成: the empty prompt

`POST /v1/sessions/:id/prompt {text:'', continue:true, failureSeq}` (`?lang=`) sends `content: []`, `mode:'queue'` (the host logs it as a `retry` message, which the
transcript words 已请求继续生成). The route accepts an empty prompt **only** for this: `continue:true`, `failureSeq` equal to the projection's current `ending` (a stale
button is refused, the official `retry(failureSeq)` guard), the session idle and nothing queued or steering; otherwise `409` with the "nothing to continue" copy, and an
empty text without `continue` is still `400 empty_text`. A host refusal (`session/agent-busy`, `NO_CONTINUABLE_FAILURE_OR_PENDING_INPUT`) reads the same.

### Prompts with attachments

- `POST /v1/attach?name=&media=` (raw body, a picture) keeps the bytes encoded for the prompt (the host admits, validates and normalizes them then).
- `POST /v1/attach?kind=file&session=<id>&name=` (raw body, any file) streams into `ctx.get('fileUploads').uploadStream({sessionId, data, name})`, which stages it under a
  receipt owned by that session's agent (it resumes a cold session through the registered resolver); a body over 32 MB is cut off (`413`, connection closed). Both answer
  `{id, name, bytes, kind}`. `?lang=` words refusals.
- `POST /v1/sessions/:id/prompt {text, mode, images:[id], files:[id]}` builds `content` as `[text?, …images, …files]`: an image part `{type:'image', mediaType, data, name}`, a file part
  `{type:'file', receiptId}` (`resolvePromptFileReceipts`). A message with attachments and no text sends no text block. An attachment id is spent only when the host accepts the
  prompt (a refused send keeps them for the retry); an expired one (the bridge keeps them 30 min) refuses the prompt (`409`), a file staged for another session answers FILE_NOT_STAGED.
- Host refusals reach the phone in the official copy (`attachmentErrorText`, zh/en by `lang`): model without image input 当前模型不支持图片，请切换支持图片的模型, too many images,
  too large, unsupported type, resolution/dimension, not staged, subagent files.

### Commands, plan and goal

- `GET /v1/sessions/:id/commands` → `{commands:[{name, description, hint}], skills:[{name, description, userOnly}]}`. Commands come from `commands.list(agent)` (the live agent's scope
  view; a cold session is **not** woken for this, it lists the global commands), without `export` (a ZIP download the phone cannot take); skills from
  `sessionSkillCatalog.list({sessionId})` (user-invocable ones, `userOnly` = not model-invocable).
- `POST /v1/sessions/:id/command {name, input?}` runs the command the way the official composer does: `commands.execute(agent, '/name input', [], signal)` (rc.3 signature; the
  agent is the live one or the host's `agent` lookup's, which resumes a cold session). Read against rc.3, the earlier call passed a request object where the host expects the Agent and a signal where it
  expects the command line (so `parseCommand` matched nothing and the route answered an empty receipt); the live Mac has to confirm the fix. Answers: `200 {ok:true, message}` (the handler's text), `404` unknown, `409 {error}` for an
  error result or a thrown handler, `400` for a malformed name. A handler still running after 6 s (a long `/compact`) answers `{ok:true, message:''}` and finishes on the Mac (its command card follows in the transcript).
- **`/plan`**: the input is `[off|message]`. A bare `/plan` turns plan mode on with no message; `/plan off` turns it off; **any other text turns it on and steers that text into the
  turn**, so `/plan on` would send the word "on" to the model. The phone's chip therefore sends an empty input to enter and `off` to leave (ui-plan's chip only leaves, with `/plan off`).
- **`/goal`**: `[<objective>|clear|edit <objective>|pause|resume]`, a bare `/goal` only prints the goal (one of those words as an objective is a control). The phone creates a goal with
  the typed `/goal <objective>`; the goal strip's controls use `POST /v1/sessions/:id/goal {action:'pause'|'resume'|'clear'}` and **`{action:'edit', objective}`** → `goals.edit(agent, ref, {objective})`,
  the compare-and-set calls GoalBar itself makes (no `/goal` command line, so no command card).
- The slash menu's sections, labels and descriptions are the phone's (ui-commands' copy; `file` and `model` are client-side entries as in the official menu): bare `/permission` and `/model`
  open the phone's own pages (the official popups), the others run.

### The `@` menu

`GET /v1/sessions/:id/refs?q=&quoted=0|1&lang=` → `{items:[{id, kind, name, detail, text, done, wire, section, first}]}`:

- files and folders from `ctx.get('fileReferences').list(agent, query, signal)` (≤ 20; an empty query lists the workspace root, a query with `/` lists that directory, otherwise a fuzzy search).
  `text` is `formatFileMention`: `@path`, `@"path with spaces"`; a folder keeps its trailing slash and, when quoted, its open quote (`@"my docs/`) so the menu can drill; `done` is the settled
  form (`@"my docs/"`). The host does not parse these: they are plain prompt text the model reads (`FILE_REFERENCE_PROMPT`). Discovery stays inside the session's workspace
  (the provider refuses `..`, paths outside it and symlinked directories), so the route lists no more than the desktop's own `@` menu does;
- this session's subagents (`subagentCatalog` entries) and other sessions (`kind` `subagent` / `session`; matches by title, cwd or id; same-workspace first): `text` is the readable `@label`, `wire` the canonical
  `@[label](dsh-session:<base64url(JSON id)>)` the host resolves into cross-session recall. Labels are escaped like the official `escapeLabel` (`\` and `]`), made one line and cut at 200 characters;
  the phone swaps `text` for `wire` on send (a `dsh-session:` URI written by hand is still canonicalized by the prompt and queue-edit routes);
- headings (`section`, `first` on the first row of each): 文件与文件夹 / 子智能体 / 对话 (Files & folders / Subagents / Sessions).

**Skills are not `@` entries.** The official `@` source lists files and sessions only; a skill is a slash entry whose pick lands the plain `/name ` and the host's pre-step
(`dsh-tool-skill`) loads it for any whitespace-bounded `/name` token of a user message that names a user-invocable skill (a command of the same name wins on the client). The phone lists skills in its `/` menu after the commands.

## Session rows carry a workspace group

Each row in `GET /v1/sessions` and in `snapshot.sessions` carries display fields the app does not have to compute:

- `group` — the workspace's title (else the last path segment of its path) in the desktop sidebar's order (the workspace registry's, pinned sessions first, then `updatedAt` descending); `''` for a session no workspace owns (the phone titles that bucket itself);
- `first` — true on the first row of its group, in the order returned;
- `when` — a relative age in the official words (`刚刚`, `4分钟`, `2小时`, `29天`, `3个月`, `1年`; `now`, `4min`, `2h`, `29d`, `3mo`, `1y`), computed on the host in the request's `lang`;
- `unread` / `subs` — the sidebar's dots and running subagents (see **Session list: unread dots and running subagents**).

`sessionController.search` exists but this deployment configures the session-query index with `openAt: "never"`, so it answers
`session search is disabled`; the app filters the session list locally instead.

## Paging the transcript

`GET /v1/transcript?session=<id>&take=<n>&since=<seq>` — `take` counts **turns** (default 8, 4–120); `since` returns only rows with `seq > since` plus the full id order (incremental refresh).
The response sets `session.hasMore` when the session has older messages than the window, which the app shows as
a "Load earlier messages" row at the top of the transcript; tapping it raises `take` by 8 (up to 120) and re-fetches.

## What the snapshot carries per tool call

`session.messages[].blocks[]` of kind `tool` (`ui-tool` `tool-call-model.ts` rows; rc.3):

| field | meaning |
|---|---|
| `callId` | the provider's call id, so a result can find its call |
| `name` | wire tool name (`bash`, `edit`, …); the phone shows it as small mono text beside the title |
| `title` | the localized row title (`tool.title.*`: 运行命令 / 读取 / 搜索文件内容 / 网页搜索 / 编辑 / 更新任务清单 / 创建子智能体 …; an `lsp` call by its operation; `wait_agent` by its outcome once settled) |
| `icon` | a cross-platform `symbol:` role the phone draws |
| `summary` | the official one-liner: a file tool's path (workspace-relative, `~` for the home directory), a shell call's `description` (else the command), the queries / pattern / URL, a patch's files (`a → b` for a move), a delegation's description, a todo's `n/m 已完成 · <the task in progress>`, a generic tool's first readable argument. Once settled, an **error** replaces it with the first line of the output (or the localized reason: `Auto review 已拒绝`, the web fetch failure class, `已停止`) |
| `suffix` | the collapsed row's right-hand text: a write / edit's content size (`3KB`, `tool.preparing.content`), `+n` for the other tasks running beside a todo's active one |
| `added` / `removed` | lines a settled `write` / `edit` / `apply_patch` changed (from `meta.diffs`) |
| `args` | pretty arguments, capped at 2400 chars (the row ships none: `lazy`; the full text, up to 64 KB, is `GET …/call`) |
| `status` | `preparing` (streaming blocks while the arguments still stream: 正在准备调用), `running`, `ok`, `error`, `stopped` (`interrupted`), `unknown` (a call the model never got back to) |
| `badge` | the localized exit status of a shell call (`退出码 N` / `信号 X` / `未正常退出`; also any other call whose output ends in the `[exit code: N]` footer, read off the **whole** result, not the 800-char row text); `失败` for a call that errored without one |
| `result` | result text, 800 chars in a row; `GET …/call` returns up to 64 KB with `resultChars` |
| `todos` | for `todo` / `todo_write`: `[{id, text, state, change, label, prev}]`; `change` is `added` / `updated` (status or position) / `removed` / `same` (unchanged since the previous list; omitted when the comparison is unavailable), `label` its wording (新增 / 状态变化 / 顺序调整 / 移除), `prev` the status it had before |
| `detail` / `todoSummary` | on a todo: the comparison caption (首次记录 / 与上次清单相比 / 旧清单不可用: no earlier list in the window while older history is not loaded) and its summary (新增 N · 更新 N · 移除 N, else 清单没有变化) |
| `question` / `options` | for `question` / `ask_user_question` calls: the first question and its choices |
| `ask` | for `ask_user_question` calls: the row state above |

A diff is no longer in a row at all: `diffs` (hunks, `sign` `' '`, `+`, `-`, `'@'` for a hunk header, `…` for a truncation) and `diffHidden` (files past 8) come from `GET …/call`, and the raw `diff` (every changed file's full old / new text) never leaves the bridge.

A turn's usage rides its last assistant row as the `用量 X` line and panel rows (**Turn usage**). Beyond the message rows:

| field | meaning |
|---|---|
| `session.goal` | the session's goal objective (rendered as a grey strip above the transcript) |
| `session.plan` | `{title, steps:[{text, state}]}` from the plan projection, when the session has one |
| `session.approvals[].summary` | one line of the call the approval is about, so the phone shows `bash · exit 7`, not just `bash` |
| `session.origin` / `subagentMode` / `parentId` | `origin:'subagent'` marks a child session (read through its parent's address); `subagentMode` is `one-shot` / `continuable` / `external` (`''` unknown); `parentId` the direct creator (with `parentTitle`, `agentLabel`: **Subagents, the environment and jobs**). Child sessions are read-only on the phone unless continuable; a continuable one is messaged through the subagent runtime |
| `session.stats` | session-level (the `tokenUsage` / `sessionStats` projections: turns, steps, in/out/cache tokens), not just the loaded window |
| `session.context` | `{used, total}` from the `contextPressure` projection (`projectedTokens ?? pressureTokens` over the route's window); absent when the host does not serve it (there is no `contextTimeline`) |
| assistant row `changedCount` / `changedFiles` / `changedAdded` / `changedRemoved` / `changesSeq` | the turn's changed files: the host's `workspace/changes` summary when it has one, else the **unique files** its successful `write` / `edit` / `apply_patch` calls changed (cwd-relative where possible); `changedFiles:[{path, name, added, removed, i, note}]` — **Turn tail: feedback, changed files, open on the Mac** |

## Payload budget and the call detail route

The snapshot is polled every 700 ms (2.8 s when idle), so it is budgeted, not complete:

- **a reply arrives whole.** Markdown nodes are no longer cut to a few hundred characters: a node is bounded only against a pathological source (16 000 characters, 300 list items, 120 table rows, 300 nodes per block);
- the newest rows are *whole* while they fit 150 KB, at most 12 of them (the newest row always is); older rows are *slim*: a turn's final answer keeps whole nodes up to ~6000 characters, its other replies a few slimmed nodes, reasoning 240 characters, `fullText` (what copy and find read) 6000 characters, so a long session still shows its history;
- a whole row over 96 KB gives up detail in this order: reasoning, then tool cards and groups (the answer blocks stay), then — past 1.5× that size — the colours of its code blocks. The answer's text is never what a row gives up;
- tool cards keep `lazy: true` and ship no `args`/`result`; tapping one calls `GET /v1/sessions/<id>/call?callId=<id>&lang=`, which returns `{callId, name, title, args, argsChars, result, resultChars, diffs, diffHidden, todos, files, question, options, view}` from that session's call index (the tool blocks of every window computed for it; `args` / `result` up to 64 KB, the `*Chars` are the real lengths);
- a 240 KB ceiling trims the oldest rows and sets `hasMore`.

### Tool cards

`view` (built at request time from the call index — a poll never pays for it) is `{kind, head, tone, more, parts[]}`; `kind` is `terminal`, `read`, `search`, `web`, `diff`, `image`, `details` or `io`. A part is `{id, kind, label, badge, tone, text, link, md, fold, lines[], items[]}`:

- `cmd` — a shell command: `label` the working directory's last segment (`~` for the home), `text` the whole command, `badge` the status (`运行中` while it runs, `退出码 N` / `信号 X` / `未正常退出`), `tone:'error'`. Only `bash` / `pwsh` / `shell` calls with a description and no error get it (and `terminal_send`: the text sent or （发送输入）, no exit status; its row summary is 终端 <id>); a persistent shell (no `description`), a failed call and any other tool use the **`io`** card (`输入` / `输出`, a `run_code` call's program as the input).
- `lines` — `lines:[{id, n, sign, text, runs?}]`: `n` the gutter number (read line, match line), `sign` `' '` / `+` / `-` / `@` (hunk header) / `#` (a search file header) / `…` (a marker that says how many lines were left out), `runs` colour runs; capped at 400 lines (the 401st is the marker). `fold` (40) is how many the phone shows before `… 其余 N 行` opens the rest. ANSI escapes and carriage-return progress are stripped; secrets masked.
  - `read`: `label` the path, `badge` `显示 X / Y 行` when the window is not the whole file, `link` the absolute path (opens the viewer), `runs` from `meta.lang` (js / ts / py / sh / json / go / rust / swift / java / c; blocks over 150 lines or 6000 characters stay plain). Needs `meta.{path, offset, lines, totalLines}`; otherwise the `io` card.
  - `search`: `head` `N 处匹配 · M 个文件` / `显示 X / 共 N 处匹配 …` / `N 个路径`, file headers + numbered matches or a path list; `无结果`; a truncated search appends the result text (its full-result locator).
  - `diff`: one part per file (≤ 8, `more` counts the rest) with `badge` `+a −r` and `link`; from `meta.diffs`, or — while the call runs — what its own arguments intend (a write's whole file, an edit's old / new text).
- `text` — a block of text: a fetch's URL (`label` `HTTP 200`, `link`), a search's provider answer (`md:true`), a read_image's path and each image's size (`{w}x{h}px，{bytes} 字节`, with `（由 …px 缩小）` when downscaled).
- `note` — a small caption (`无输出`, `来源列表已截断`, `内容已截断`, `未找到结果`, the todo-less detail captions).
- `items` — entities `{id, title, subtitle, badge, tone, text, link, group, md, fields:[{label, value}], lines}`: web sources (title or hostname, snippet, date; only `http(s)` links), and the **details** cards of `create_goal` / `get_goal` / `update_goal`, `schedule_*`, `list_agents`, `job_list` / `job_output` / `job_kill`, `terminal_open` / `read` / `list` / `signal` / `close`, `spawn_teammate`, `team_task_*`, `send_message`, `interrupt_agent`, `wait_agent`, `list_subagent_models` and the `subagent` / `subagent_fork` delegation receipt (field labels, statuses and receipts from the official `detail.*` copy). `cordis_*`, `workflow` / `ralph`, `session_*` search / trace and `lsp` keep the `io` card.

The call index keeps each result's metadata bounded (a read's window to 400 lines, search matches / paths to 400 rows, 40 web sources, a search answer to 4000 characters), so a long session of large reads does not hold them all in memory; the card shows what is kept.

A failed call shows what it can: the auto-review rejection is `工具未执行。原因：…` (`io`, `tone:'error'`).

`take` is a **turn count** (default 8, clamp 4–120), not a message count, and the oldest partial turn is dropped so a turn's row id stays stable while the window grows — the phone anchors scroll restoration on that id.
