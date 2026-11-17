# DSH Mobile：用 Exact 做 DeepSeek Harness 手机端

> 目标：像 Claude iOS 连 Claude Code、ChatGPT 连桌面端那样，用手机远程看/控电脑上正在跑的 DSH 会话。
> 本文只定方案，不写实现。所有标 ⚠️ 的是「已查文档但未在本机跑通」的点，统一放进 M0 验证。

---

## 1. 产品形态（v1 做什么、不做什么）

**做**（对齐 Claude/ChatGPT 手机端的核心闭环）：

- 配对一次，之后随时连上桌面 DSH
- 会话列表：正在跑 / 等待审批 / 空闲，最后一条消息预览
- 会话详情：读完整 transcript，**实时看流式输出**，看工具调用（一行摘要，可展开）
- 发消息（运行中可继续发：排队成下一轮，或 steer 进当前 step）、停止
- **审批卡片**：桌面端弹权限询问时，手机上允许一次 / 拒绝
- 断线重连、后台回前台续上、浅色/深色

**不做**（v1 明确砍掉）：

- 不复刻桌面端完整 UI（文件树、diff 编辑器、多面板、设置中心）
- 不做代码高亮/diff 渲染（先用等宽文本 + 折叠，v2 再说）
- 不做语音、不做推送（审批推送放 v2，见 §7）
- 不做远端新建工作区/换模型（先只切会话、发指令）

**形态选择**：手机端是**独立原生 App**（Exact 编 iOS/Android），不是 webview 套壳。理由：Exact 本来就没有通用 webview；DSH 的 Web GUI 是 React 桌面布局，塞进手机要重写，不如直接用 Exact 的 Contract 写移动端 UI。

---

## 2. 可行性核查结论（这决定了架构）

我把 DSH 的包、文档和一份第三方逆向调研都读了，四条硬事实：

1. **逐 token 流式有官方进程内出口**
   `ctx.on('agent/assistant-stream', ({ agent, frame }) => …, { global: true })`，`frame` 是 `start | chunk{StreamChunk} | end`。
   `StreamChunk` 有 `text-delta / reasoning-delta / tool-call-delta / block-start / block-end / usage / finish`。
   ⚠️ 这是 Cordis 运行时事件，只在该 Host 进程内有效；Host 重启后没有「写了一半」的持久文本（日志只在 turn/step 结算时落 `assistant/message`）。

2. **第三方客户端不要走 DSH 自己的 mux 协议**
   `/api` 的唯一 interceptor 归 `dsh-api-gateway`；`ctx.remote.$on` 的事件白名单是第一方构建期清单，不能运行时扩展；浏览器侧没有无类型 stream opener（自定义 stream endpoint 需要构建期生成的 contribution，仓库外未验证）。
   **正路**：`ctx.connection.fetch.register({ path, methods, requestBody, fetch })` —— 官方给「流式或浏览器原生响应」留的精确 Fetch 路由，SSE/长轮询都行。

3. **审批有官方 seam**
   `ctx.approval` + `approval/request` waterfall。answerer 返回 `'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`，只有 `allowed-once` 放行。
   请求对象带 `agent / toolName / callId / reason / signal` —— 足够在手机上渲染「哪个工具、为什么问」。
   ⚠️ answerer 有归属规则（「UI answerer 只回答它拥有的 agent」），bridge 能否全局代答要 M0 验。

4. **发消息语义天然适合手机**
   `agent.followup(msg)` = 排成它自己的下一轮并唤醒；`agent.steer(msg)` = 在最近 step 边界插入；`agent.cancel(cause, { keepInbox })` = 停止但保留队列。
   「随时发、队列串行消化、发完立刻回显」是 DSH 原生行为，不用我们发明。

**版本注意**：本机装的是 **0.2.2-rc.3**，而我参考的逆向调研钉在 0.1.5-rc.2。上面这些符号名字大概率没变，但**签名必须对着本机 `node_modules/@deepseek-ai/*/lib/types/*.d.ts` 复核**（M0 第一件事）。

---

## 3. 架构

```
┌─────────────────────┐        Tailscale / 局域网         ┌──────────────────────────────┐
│  Exact App (iOS)    │  HTTPS(可选) + Bearer token       │  桌面 DSH (Electron)          │
│  ─────────────────  │ ───────────────────────────────▶ │  ┌────────────────────────┐  │
│  Pair / Sessions    │   GET  /v1/feed?since=N (JSON)     │  │ dsh-mobile-bridge      │  │
│  Chat / Settings    │   POST /v1/prompt                  │  │ (Cordis 插件, 进程内)   │  │
│  (Contract + app.ts)│   POST /v1/approvals/:id           │  │  node:http :8787       │  │
│                     │ ◀───────────────────────────────  │  └───────┬────────────────┘  │
└─────────────────────┘        SSE 可选 (v2)               │          │ ctx.on(global)   │
                                                           │  ┌───────▼────────────────┐  │
                                                           │  │ agents / sessionQuery  │  │
                                                           │  │ approval / sessions    │  │
                                                           │  └────────────────────────┘  │
                                                           └──────────────────────────────┘
```

三件套：

### 3.1 `dsh-mobile-bridge`（桌面侧 Cordis 插件，工作量主体）

- 作为 desktop profile 的一个普通 bundle 依赖安装（`dsh plugin add` 或 profile `package.json`），与 `dsh-context` 同级。
- **必须进程内**：只有进程内才能同时拿到 `agent/assistant-stream`、`agent` 实例、`ctx.approval` answerer。所以不是独立 sidecar 进程。
- **自己开 HTTP 监听**（`node:http`，默认 `127.0.0.1:8787`；配 cloudflared 时只绑 loopback，绝不 `0.0.0.0`），不挂 DSH 的 Web Server。理由：DSH 的 web server 有 Host/Origin/`sec-fetch-site` 围栏 + 启动 token + 30 天 cookie，那套是给「同一浏览器的 owner peer」设计的；手机是另一台设备、另一个客户端，硬套会把配对流程做得很脆（`/connect` 拿 cookie 后还要维持一条 mux socket，socket 一断 HTTP 就失效）。
  ⚠️ **M0 必须验证插件能不能 bind 端口**（Electron 主进程里跑 Cordis，理论上可以；若被沙箱拦，退回 3.2 的 fallback）。
- **fallback（若不能自开端口）**：用 `ctx.connection.fetch.register` 把 `/v1/*` 挂到 DSH web server 上，手机端配对走「一次性 pairing code → 桌面端把 code 换成 DSH 的 `/connect?token=…` 链接 → 手机拿 cookie」。能用，但耦合 DSH 的连接生命周期，作为 Plan B。

### 3.2 Exact App（手机侧）

- `bun scripts/exact.mjs new apps/mobile`，用 `tabs` 或 `list-detail` 起步，聊天页抄 `chat-thread` recipe（`list virtualized scroll-start="end" scrollFollowEnd`、气泡 `column/row` + `text white-space="pre-wrap"`、composer `textarea field-sizing="content"`）。
- `app.ts` 只做三件事：`grants`（`net.fetch http://<tailscale-ip>:8787`、`secrets`）、`answer(source, …)` 调 bridge、把 JSON 映射成 Contract 需要的记录（消息 blocks、会话行、审批卡片）。
- **传输 v1 用轮询，不用 SSE**（**已定**）：`task tick mount` + `every(900ms, pull)`，`?since=<cursor>` 拿增量。两条理由：① Cloudflare Quick Tunnel 官方明确**不支持 SSE**（见 §7）；② Exact 对 fetch 流的行为我也没确认（⚠️）。轮询在 Exact 的 data seam 里是确定能做的。协议层已按「游标 + 增量」设计，将来换 named tunnel + SSE 时，App 侧只改 `pull` 一个函数，UI 不动。
  - 省电细节：`running` 时 900ms，`idle` 时 5s；App 进后台停 tick（Exact 有 clock/mount 语义可配合）。
- token 存 `secrets`（Keychain），不落普通 state。

### 3.3 协议（v1，手写 JSON，不走 Typert）

原则：**只暴露手机需要的、语义稳定的东西**，不转发 DSH 内部事件形状。这样 DSH 升级时只需改 bridge 的适配层。

```
POST /v1/pair          {code, deviceName}            → {token, host:{name, version}}
GET  /v1/sessions?limit=30                            → {sessions:[{id,title,workspace,status,updatedAt,preview}]}
GET  /v1/sessions/:id/snapshot?messages=50            → {session, messages:[Message], run:{state,attemptId?}, pendingApprovals:[Approval]}
GET  /v1/feed?session=:id&since=<cursor>              → {cursor, events:[Event], run:{state}}
POST /v1/sessions/:id/prompt {text, mode:"followup"|"steer"} → {accepted, clientId}
POST /v1/sessions/:id/cancel                          → {ok}
POST /v1/approvals/:approvalId {decision:"allow-once"|"reject"} → {ok, outcome}
GET  /v1/health                                        → {ok, version, capabilities}
```

`Message` 就是「块数组」，跟 DSH 的 `AssistantMessage.content` 同构，手机端不用解析 Markdown：

```jsonc
{ "id":"…", "role":"assistant", "ts":1731…, "streaming":false,
  "blocks":[
    {"kind":"text","text":"…"},
    {"kind":"reasoning","text":"…"},
    {"kind":"tool","callId":"…","name":"bash","summary":"npm test","status":"ok","durationMs":4200}
  ]}
```

`Event` 类型（带单调 `seq`，客户端只认 cursor）：

```
message/user        {message}
message/start       {messageId, role:"assistant"}
block/delta         {messageId, blockIndex, kind:"text"|"reasoning", text}   // 流式增量
block/end           {messageId, blockIndex, block}
message/end         {messageId, interrupted?}
tool/start          {messageId, callId, name, argsPreview}
tool/end            {callId, status, durationMs}
run/state           {state:"idle"|"running"|"waiting-approval"|"error"}
approval/requested  {approvalId, toolName, reason, callId, expiresAt}
approval/resolved   {approvalId, outcome}
session/title       {title}
```

- **cursor 语义**：bridge 内存 ring buffer（每会话最近 ~2000 事件）；客户端带 `since` 超界 → 返回 `410`，App 改拉 `snapshot` 重建。简单、可测、不依赖 DSH 的分页。
- **断线重连**：Exact 侧 `failed` 就退避重试（1s/2s/4s，封顶 10s），成功即 `since=cursor` 续上；超过 30s 没心跳视为断，App 显示「重连中」而不是清屏。
- **审批超时**：answerer 端 120s 超时自动 `cancelled`（fail closed），手机端卡片显示倒计时。

---

## 4. Exact 端页面与 Contract 要点

| 页面 | 关键 Contract |
|---|---|
| Pair | 表单（host/port + 6 位配对码）→ `mutation pair`；失败显示 `failure`，不允许跳过 |
| Sessions | `list` + `for s in sessions`；状态点用 `image "symbol:circle.fill"` + 颜色；下拉刷新 |
| Chat | `list virtualized scrollFollowEnd`；assistant 块用 `for b in m.blocks` 分派 `text` / 代码块（等宽，横向滚动）/ `tool` 折叠行；底部 composer `textarea` + 发送/停止按钮（`run.state=="running"` 时切换成停止） |
| Approvals | Chat 顶部 sticky 卡片（也可做成 sheet）：工具名、reason、允许一次 / 拒绝，`pending` 防重复点 |
| Settings | 服务器地址、断开配对、清 token、显示 bridge 版本 |

渲染分工（重要）：**bridge 负责把 `ContentBlock[]` + 流式 delta 折成 blocks（语义对齐 DSH 的 `BlockAssembler`），App 只负责 block → 视图**。App 里不写 Markdown 解析器；代码块先用 `font` 等宽 + `pre-wrap`，v2 再加横向滚动/语言标签。

---

## 5. 里程碑（每步都能演示）

| # | 内容 | 验收 | 估时 |
|---|---|---|---|
| **M0** ✅ | 三个 spike，一个决策门 | ① 本机 `.d.ts` 复核所有 API 名 ② Exact `new` + iOS 模拟器跑起 hello ③ 插件能 bind 8787 并被手机/curl 访问 ④ 在插件里收到 `assistant-stream` frame 并 print ⑤ `ctx.approval` 注册 answerer 能拦到一次真实的 bash 审批 | 0.5–1d |
| **M1** ✅ | bridge 核心 | curl 全链路：pair → sessions → snapshot → prompt（followup+steer）→ cancel → 看到 feed 里流式事件 | 1.5–2d |
| **M2** ✅ | Exact 骨架 | 配对 + 会话列表 + 只读 transcript（轮询），跑在 iOS 模拟器 | 2–3d |
| **M3** 🟡 | 实时 | 流式气泡（增量 append）、工具行、停止、运行中发消息、滚动跟随 | 2d |
| **M4** ✅ | 审批 | 手机端审批卡片 → 桌面 bash 真的继续执行；超时/拒绝路径正确 | 1–2d |
| **M5** 🟡 | 打磨 | 断线重连、后台回前台、深色、震动反馈、widget/通知入口（可选）、TestFlight/AppDrop 装机 | 2d |

合计约 **9–13 个工作日**（熟悉 Exact 的前提下；第一次原生构建 10–15 分钟，之后 1–2 分钟）。

---

## 6. 为什么不用另外三条路

| 备选 | 为什么不做 |
|---|---|
| 手机 App 直接说 DSH 的 `/api/remote.mux` + `$events` | 那是内部协议：白名单不可扩展、无浏览器侧 opener、接口随版本变；等于把 App 焊死在 DSH 内部实现上 |
| webview 套 DSH Web GUI | Exact 无通用 webview；桌面 React 布局在手机上不可用；且失去原生交互（审批、通知、键盘） |
| 用 `dsh-acp`（第一方 ACP，`@agentclientprotocol/sdk`） | 它是给编辑器用的、以 stdio 起**自己的** agent 进程，拿不到桌面 GUI 里正在跑的会话，也没有审批 UI 的对接点。留作 v2「多客户端接入」的协议参考，不作 v1 主路 |

---

## 7. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Exact 是 pre-1.0，「每天在变」 | 代码可能被上游改动打断 | 每天 `git pull` + `verify`；把 Contract 用法收敛在 4 个页面；不写自定义 native module |
| Exact 的 SSE/fetch 流没确认 | 实时性方案 | v1 用轮询（已验证可行路径），协议已按游标设计，v2 可无痛换 SSE |
| 插件 bind 端口被 Electron 沙箱限制 | 整个 bridge 方案 | M0 先验；失败走 3.2 fallback（挂 DSH fetch 路由 + 一次性 cookie 配对） |
| `ctx.approval` 归属规则导致 bridge 答不了 | 审批功能 | M0 用真实 bash 审批验；退路：手机只读展示「等待桌面审批」，不代答 |
| 手机连不上桌面（NAT/防火墙） | 根本连不上 | **已定：Cloudflare Quick Tunnel**（`cloudflared tunnel --url http://127.0.0.1:8787`，免账号、自动 HTTPS，iOS ATS 无需例外）；bridge 只绑 loopback |
| Quick Tunnel 每次重启换域名 | App 里存的 URL 失效 | 配对页把 URL 做成可粘贴/扫码；bridge 启动时把新 URL 打进日志 + 桌面兜底展示；App 端 `health` 探测失败直接跳「重新配对」而不是静默重试 |
| Quick Tunnel 无访问控制，公网可打 | 被扫到 `/v1/pair` 爆破 | pairing code 6 位 + 5 分钟 TTL + 3 次错误锁 10 分钟 + 全局 rate limit；token 32B 随机只存哈希；`--allowed-mail` 只适合人在浏览器里点，不能给 App 用，所以认证必须自己做 |
| Quick Tunnel 单隧道 200 并发、超出 429 | 轮询密集时被限流 | 单设备轮询 900ms 完全够；多设备/多标签才可能撞到；bridge 端做 429 退避 + 合并请求（一个 feed 覆盖所有会话） |
| Quick Tunnel 不支持 SSE | 实时方案 | 已把 v1 定成轮询；SSE 端点仍实现，等换 named tunnel/Tailscale 再启用 |
| CF 边缘终结 TLS，流量在 CF 可见 | 隐私 | 个人工具可接受；在意就换 named tunnel + Cloudflare Access，或 Tailscale |
| token 泄露 | 任意指令执行 | 32B 随机 token、只存哈希、每设备一枚、可单独吊销；配对码 5 分钟过期 + 3 次错误锁定；bridge 打印连接审计日志 |
| DSH 版本漂移（文档 0.1.5-rc.2 vs 本机 0.2.2-rc.3） | API 对不上 | 所有 DSH 调用集中在 `bridge/dsh-adapter.ts` 一个文件；升级只改这里 |
| 后台无推送 | 审批/完成感知延迟 | v2：APNs 或先用 ntfy/ Bark 自建推送；v1 明说「前台才实时」 |

---

## 8. 已确认的决策（2026-11-15）

| 议题 | 决定 | 对方案的影响 |
|---|---|---|
| 平台 | **iOS 先行**（Xcode 27.2、iPhone 17 模拟器已就绪），Android 排到 M5 之后 | Contract 代码天然跨平台；M2 起只在 iOS 上验收 |
| 会话范围 | **手机与桌面共享全部会话**（同一批 session，不是独立 agent 进程） | bridge 必须进程内、贴 live Agent；`sessionQuery` 列同一批 session；审批用同一个 answerer 链 |
| 联网 | **Cloudflare Quick Tunnel**（`cloudflared 2026.9.1` 本机已装） | bridge 只绑 `127.0.0.1:8787`；v1 只能轮询（Quick Tunnel 不支持 SSE）；HTTPS 由 CF 提供，iOS 不用 ATS 例外 |

> 上表三条已在 M0 之前锁定。唯一还开放的取舍：**Quick Tunnel 够不够日常用**（域名每次都变、无访问控制、无 uptime 保证）。建议 M0–M3 用它打通，真每天用再升级 named tunnel + Access（需要 CF 账号 + 一个域名，协议与 App 都不用改）。

---

## 9. M0 的具体 checklist（明天就能跑）

```bash
# 0) 本机现状（2026-11-15 实测）
#    rustc 1.97.1 ✓   Xcode 27.2 ✓   cloudflared 2026.9.1 ✓   node 26.8 ✓
#    bun ✗ —— Exact 要求 Bun 1.4.2，先装
curl -fsSL https://bun.com/install | bash && bun --version

# 1) Exact 环境
cd /Users/lizhuo/owork/dsh-exat && bun scripts/exact.mjs setup   # 首次
bun scripts/exact.mjs new apps/mobile && cd apps/mobile && bun scripts/exact.mjs ios --run

# 2) 本机 DSH 版本与 API 复核
ls "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai" | head -50
# 逐个确认：agent/assistant-stream、agent.followup、ctx.approval、connection.fetch.register
# 路径：.../dsh/node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts

# 3) 插件骨架 + 端口 + 事件（一次性验证）
#    插件里 ctx.on('agent/assistant-stream', …, {global:true}) 打一行 log
#    node:http 起 127.0.0.1:8787 返回 {"ok":true}，手机 Safari 打开 /v1/health

# 4) 隧道（每次启动换域名，桥只绑 loopback）
cloudflared tunnel --url http://127.0.0.1:8787
```

M0 的产出是一份 1 页纸的结论：**哪条传输路可行、审批能不能代答、Exact 能不能 30 分钟内跑起 hello**。这三条任一不成立，架构按 §3/§7 的 fallback 调整，再进 M1。


---

### 2026-11-16 下午：M5.1 数据面（Markdown + 工具结果配对）

官方 UI 的会话有 18 类行，我们之前只做了 6 类；这一轮先把"读起来"的地基补上。

- **bridge 输出节点流**：助手文本不再是纯字符串，而是 `nodes[]` —— `p` / `h` / `ul` / `ol` / `code` / `quote` / `hr`，列表项带 `mark`（`•` 或 `1.`）；`inline()` 把粗体、行内 code、链接压平成文字（链接保留 URL），因为 Exact 没有富文本行内流。
- **工具结果配对**：`tool/result` 按 `message.toolCallId` 折进对应的 `tool/call` 块，块上得到 `status: ok|error|unknown`、`result` 前 800 字、`diff`（`meta.diffs`）；`tool/call` 事件不再单独成行（会和助手消息里的 call 块重复）。
- **修掉一个串会话的 bug**：`orphanCalls` 原来是模块级 Map，跨会话累积，导致打开 A 会话会看到 B 会话的工具行（表现为"标题是 Ping、内容却是别的项目"）。现在每次快照前 `orphanCalls.clear()`。
- **app 渲染**：`shape MdNode/MdItem`，契约里按 `n.t` 分派；标题 1.06rem/0.94rem 加粗、列表 `mark + 文本`、代码块等宽 + 语言标签 + 灰底、引用灰底、`hr` 分隔线；工具块变成灰底卡片（名字等宽 + 参数一行 + 结果 4 行 + 状态图标），未支持的块显示"Not shown on the phone yet. Open it on the Mac."。
- **Dynamic Type**：13 处字面量字号改成 rem（`0.69`–`1.06rem`），`verify ios` 从 13 个 finding 回到 **clean**（3 测试通过、最大字号不溢出）。
- 证据：`.exact/md-live.png`（二级标题 + 有序列表 + python 代码块 + 引用一次全渲染）。

### 2026-11-16 傍晚：M5.2 + M5.3 + M5.4（工具卡 / 结构化卡 / Liquid Glass）

一次性把 UI 对齐的三段做完，iOS 与 Android 都验过。

- **工具卡**：每个调用有图标（bash→play、read→document、read_image→photo、write/edit→pencil、apply_patch→layers、grep/glob/web_search→search、web_fetch→link、subagent→people、skill→sparkles）、一行参数摘要、状态（✓ / 红 alert / 橙圆点）、点行展开完整参数 + 结果 + diff。diff 由 bridge 用"掐头去尾 + 中间块"的行级算法产出，新增绿、删除红，卡片头显示 `+1 −1`。
- **失败态**：工具本身成功但输出里带 `[exit code: 7]` 时，卡片显示红字 `exit 7` + 红 alert——之前这种非零退出是绿色 ✓，等于骗人。
- **用量行**：每条 assistant 消息下 `382 in · 184 out`，来自 `assistant/message.usage`。
- **结构化卡**：`todo` 调用解析成 ○/◐/● 清单；`question` 调用渲染问题 + 选项 + “请到电脑端回答”，正好符合「手机上不支持的给源信息 + 提示」的原则。
- **Liquid Glass**：composer 换成 `backgroundMaterial="glass"` 的胶囊 + `buttonStyle="prominent-glass"` 发送键，底下加一行模型名（`deepseek-flash`）；深色模式同步验证。会话列表试过 inset-grouped 卡片，但命中测试被列表容器挡住（点不中第一行），先回退成普通行、保留圆角卡片的思路以后再试。
- **goal / plan 条**：会话的 goal 投影现在渲染成 transcript 顶部一条灰条（`Goal` + 目标文本，最多 3 行）；plan 投影有步骤时渲染 ○/◐/● 步骤条。goal 用真实数据验过（这个会话本身就有 goal 投影）。
- **审批卡带参数摘要**：`approval/request` 的 `callId` 现在会去 transcript 里找对应的工具调用，卡片上多一行等宽摘要（`bash` / `exit 7` / `run a shell command`）——之前只有工具名和 reason。
- **验证**：`verify ios` 3 测试通过、深浅色 + 最大字号无 findings；Android 重建 APK 后同一屏一致（`android-glass.png`、`android-goal.png`）。

### 2026-11-16 夜：长会话翻页 + 审批倒计时

- **会话历史不再只有最近 80 条**。`GET /v1/snapshot?take=N` 接受窗口大小（默认 80，上限 400），返回 `hasMore`；app 里 `state take`（打开会话重置成 80）+ `Load earlier messages` 行（点击 `take + 120`，重新取窗口），这条行是 transcript 的第一行，随之滚动。
- **goal / plan 从悬浮块改成列表行**。之前把 goal 条和 plan 条放在 list 同级，结果 iOS 上被 list 盖住、Android 上把第一条消息压掉——因为 `position=absolute` 的列里兄弟节点会互相覆盖。现在 goal/plan 合成一个 `role="goal"` 的合成行放进 `for` 里（虚拟化列表只允许一个 `for`，之前踩过这个坑），两个平台都不再重叠。
- **审批倒计时**：`approvals[]` 多带 `expiresIn`，卡片显示 `Hands back to the Mac in 32s`——手机上接管只有 45 秒，用户需要知道还剩多久。
- 验证：`verify ios` 3 测试通过、0 findings；Android 重建后同一屏干净（`android-paging2.png`）。

### 2026-11-17 凌晨：会话搜索 + 按工作区分组

- **搜索**：会话页多了一个搜索框（`input` + `state query`），实时过滤标题和工作区路径；无结果时显示 "No session matches that."。过滤是**本地**的——`sessionController.search` 存在，但这个部署把 session-query 索引配成了 `openAt: "never"`，调用直接报 `session search is disabled`；在索引打开之前，客户端过滤是唯一可用的做法。
- **按工作区分组**：`/v1/sessions` 与 `/v1/snapshot` 返回的每行多三个字段——`group`（cwd 的末段，空则为 `No workspace`）、`first`（该工作区的第一行）、`when`（`4m` / `2h` / `14h` / `29d` 这样的相对时间，服务端算好）。列表按 cwd 排序，每个工作区打一个小标题，右侧显示相对时间。
- 排序列是**工作区优先、组内按更新时间倒序**，所以同一工作区的会话不会散落在列表两端。
- 两端验证：iOS `.exact/search-2.png`（分组）、`search-5.png`（输入 `ping` 只剩两条）、`search-6.png`（无结果）；Android `.exact/android-search.png`；`verify ios` 3 测试通过、0 findings。

### 2026-11-17 上午：复制 / 斜杠命令 / 会话内查找 / 切换模型

- **复制**：每条助手消息右下角一个复制图标，`copyText(m.text)`（Exact 的宿主命令），复制的是 Markdown 源文。
- **切换模型**：composer 上的模型名现在是按钮，点开是新路由 `models`——列出 `modelCatalog` 的全部模型（DeepSeek 官方 / DeepSeek 账号 / zai GLM 三个 provider），当前项打勾。选中调用 `sessionController.selectModel`。
  - 关键语义：**模型选择是"下一轮"生效**。`modelSelection.next` 才是新选择，`contextTimeline` 和 `modelSelection.lastUsed` 还停留在上一轮；第一版读错了投影，看起来"切了没反应"。
- **斜杠命令**：draft 以 `/` 开头时，composer 上方弹出命令面板（来自 `commands.list`），点无参数的命令直接执行（`commands.execute`），有参数的命令把名字填进输入框。
- **会话内查找**：聊天菜单新增 "Find in this session"，搜索框实时过滤**已加载到手机的消息**，并标明 `N matches in the M messages loaded here`——因为 DSH 的全文索引在这个部署里是关的（见上一节），这不是"整个会话"的搜索，界面上如实写了。
- 三处布局/校验修正：模型页原来把说明文字放在 list 下方（`lower-list-beside-fixed` 警告），改成 list 内的注释行；`1 messages` 的复数用三元修掉；`inset-grouped` 的模型列表会把行点击吃掉（`UIListContentView covers its middle`），改回 `appearance="none"`。

### 附件：查清了，但按决策不做

2026-11-17：用户决定「先不加手机端上传附件的能力」。调研结论留档，将来要做时不用重查：

- `sessionController.attachment()` 是**读回**接口（`packages/api/session-controller/src/commands.ts:428`，参数是一个已存在的 `ImageAttachmentRef`），不是上传。
- 上传不需要单独的 upload 接口：`prompt` 的 content 直接接受 `{type:'image', mediaType, data(base64), name?}`，`admitPromptContent()` 在落消息前把它存成 content-addressed 引用（`packages/attachment/attachment/src/types.ts:100`）。
- Exact 侧没有系统选择器：只有 `@exact/photos`（`photoAssets` + `copyPhotoAsset`，拿到的是沙盒里的文件路径）和 `@exact/camera`（`takePhoto`）；没有 files/document-picker，PDF 拿不到。
- 若要做：相册自绘网格（最多 3 张）→ `copyPhotoAsset` → `storage.fs.readFile` → base64 → `prompt`。
- 因此手机端目前只能发文字；历史里的图片消息显示为占位（`[图片]`）。

### 2026-11-17 下午：steer + 权限设置页

- **steer（本轮 / 下一轮）**：DSH 的 `prompt` 请求带 `mode: 'queue' | 'steer'`；`steer` 把消息塞进**当前这一轮**的下一步，`queue` 排成新的一轮。手机上运行时 composer 底部出现「本轮 / 下一轮」两个小按钮，默认「本轮」。
  - 实测：先发 `用 bash 运行 sleep 45…`，运行中再发「补一句：最终回复里请带上 STEERED」，模型在 `sleep` 结束后把两次输入一起读进去，回了 `DONE STEERED`（`.exact/steer-2.png`）。
  - 顺带：发送按钮在 `pending(sent)` 期间变半透明——之前连点第二下会被静默丢掉，看起来像"没发出去"。
- **权限设置页**：会话菜单 → Permissions → `read-only / workspace-write / danger-full-access` 三选一，打勾的是当前值。bridge 侧读 `permissions` 投影的 `currentValue`，写入调 `ctx.get('permissionPresets').set(session, value)`（`permission/preset` + `sandbox/mode` + `approval/policy` 三个事件由 DSH 自己写）。
  - 实测：手机上点 workspace-write → 点 danger-full-access → Mac 侧快照立刻变成 `danger-full-access`。
- **踩到并绕过的一个 Exact 布局坑**：`header` 后面紧跟一个 `appearance="none"` 的 `list` 时，list 会盖住 header（标题不可见，节点树里有）；中间塞一行 `row height="1px"` 就恢复。find 页当初"碰巧"正常，是因为中间有一行搜索框。模型页也补了同样的 1px 行。

### 2026-11-17 傍晚：主题钉成中性色（真机粉色问题）

- 现象：小米 HyperOS 用壁纸取色（Material You）给系统表面染色，`header` 是**平台导航栏**、`input` 是平台控件，它们的底色跟着系统走，于是真机上顶栏/搜索框发粉，而列表是白的。
- 解法（不是改系统，是拿回控制权）：
  - 新建 `apps/mobile/app.tamber`：`page / card / card-strong / ink / ink-soft / brand / on-brand` 七个 token，`brand = #3d6df2 scheme=fixed`，`AccentColor = brand`。行里直接写 token 名（和写角色一样）。
  - 所有路由改成 `navigationBar="none"`，`header` 换成自己的 `row`（`background-color="page"`），返回按钮自己画（`action leave { nav = back(nav) }`，`testId="back"`）。这样顶栏就是我们的颜色，不再是平台材质。
  - 气泡从 `AccentColor` 改成 `brand` + `on-brand`（HyperOS 动态取色会把它染成棕色）。
  - 搜索框/配对链接框改成 `background-color="card"` + `border-radius=10` + `min-height=44`；`flex=1 min-width=0` 避免最大字号时溢出。
  - 设置页的"扫码配对"行在 grouped list 里点不动、且裸按钮文本用 accent 色在深色下只有 3.7:1；把它挪到会话列表标题栏做成图标按钮（`scan-now`），测试相应改成从首页直接点。
- `verify ios`：3 测试通过、0 findings；Android 真机与模拟器同屏一致。
- 仍然跟随系统的：状态栏文字颜色、键盘、以及设备自己的护眼/夜览色温（真机上整屏偏暖是手机设置，不是 App 配色）。

### 2026-11-17 夜：五处 UI 修正（用户提的）

1. **模型选择改成弹出 sheet**：models 路由加 `navigationPresentation="modal"`，iOS 是半屏卡片（可以下拉关掉），Android 是带拖拽条的底部弹层，不再整页替换。
2. **输入框**：composer 收成一颗圆角矩形（`background-color="card"`、`border-radius=24`），右边是 36×36 的发送圆钮（有内容时变品牌蓝）。
3. **过程默认折叠**：一条助手消息的所有工具调用收成一行 `✓ N steps · Show`；运行中的那条显示 `assets/whale.svg`（小鲸鱼）+ `Working…`，点这一行才展开具体工具卡。鲸鱼是我们自己的 SVG（`assets/whale.svg`），`color="brand"` 上色，跨 iOS/Android。
4. **`Load earlier messages` 闪烁 + 打不开的 bug**：两个原因——(a) 标签写成 `pending(snap) ? "Loading…" : …`，而 `snap` 每 700ms 重新拉一次，`pending` 就跟着来回翻，于是文案不断切换；(b) 列表是 `scrollFollowEnd=true`，每次轮询都把你拽回底部，看起来像"没加载"。改为标签固定，并引入 `state stick`：默认 `true`，点 `Load earlier` 置 `false`（列表不再被拉回底部），重新打开会话时复位。`take` 从 80 起、每次 +120，最多 400。
5. **会话头**：标题改成单行（`line-clamp=1`）、`1.06rem`、`font-weight=600`，不再是大标题。

### 2026-11-17 夜：手机端显示图片

之前手机看不到图，不是平台限制：DSH 把图片存成 content-addressed attachment，桌面 UI 直接读本地附件文件，而 bridge 在 M5.1 时把 image 块换成了占位文字。

现在：

- assistant 消息里的 `image` 块 → `kind:"image"` + `att/media/w/h`；`tool/result` 里的图片（`read_image` 等）抽成 `images[]` 挂到对应工具卡上。
- `GET /v1/attachments/<sha256:…>?t=<token>` 把字节读回（`sessionController.attachment`），`<img>` 不能带请求头所以允许 query token；缓存 1 天。
- App 按原图比例渲染：助手图宽 240、工具图宽 220，点开工具卡就能看到。

验证：真机（小米）上让模型 `read_image` 读了一张截图，工具卡展开后图片正常显示（`.exact/phone-img4.png`）；`verify ios` clean。

顺带记录一个坑：DSH 插件热重载会卡在 `HMR transactions cannot be nested`，原因是当时**同时开了两个 DSH 实例**，旧实例占着 8787 且事务未结束。全部退出重开后恢复正常。

### 2026-11-17 夜：过程默认折叠（对齐桌面）

用户反馈"手机上会显示全部的执行内容，应该默认折叠"。改法：

- 助手消息的思考（reasoning）不再直接铺在正文里，和工具调用一起收进同一行：有工具时是 `✓ N steps · Show`，只有思考时是 `✓ Thought · Show`。
- 点这一行展开：先看到思考块（灰底小字），下面是这次的全部工具卡；再点某张卡看参数/结果/图片。
- 顺带清掉两处编译器警告：`width="100%"` + padding 会超出父容器（改成 `flex=1 min-width=0`）；审批的 Allow/Deny 与扫码配对按钮从平台 `buttonStyle="filled"` 改成自绘 pressable（`tamber-unreachable` 警告消失，禁用态自己控制透明度）。
- `verify ios`：3 测试通过，0 findings，0 编译器警告。

### 2026-11-17 深夜：回合合并、图内联、定位最新一轮

用户提了三条：

1. **进入老会话定位到最新一轮开头**：新增 `state pinned` + `derive anchor`（最后一条 user 消息的 id），第一次拿到快照时 `scrollIntoView("transcript", anchor, block="start", behavior="instant")`，离开会话时清空 `pinned`，下次再进来重新定位。
2. **同一轮的多个 step 合并成一行**：一条助手回复在日志里是「每个 step 一条 assistant/message」，之前手机按消息渲染，于是一个回合刷出十几行 `✓ 1 step`。bridge 现在按 `turn` 合并：blocks 拼接、usage 求和、seq 取最后一条，合并后是一个 `✓ N steps`（实测一个 45 步的回合只占一行）。
3. **回复里的图片默认显示**：桥接新增 `GET /v1/file?p=<路径>&s=<session>&t=<token>`，按会话 cwd 解析相对路径读原文件；`mdNodes` 把独占一段的 `![alt](path)` 变成 `img` 节点并带上像素尺寸（PNG/JPEG 头解析），app 直接渲染成图片而不是 `[image: alt]`。

`verify ios`：3 测试通过、0 findings、0 编译器警告。

### 2026-11-17 晚：向上加载（P1/P2/P4 落地）

用户提的两条：点了之后跳到最早（像没加载）、滑到顶不能继续加载。计划见 `docs/plan-load-earlier.md`，按 TanStack Virtual 的 chat 契约（end-anchored + 稳定 key + follow-on-append）实现：

- **锚定补偿**：`moved` 事件记 `firstVisibleKey/firstVisibleOffset`，`loadEarlier` 先记锚再扩窗口，`poll` 发现行数变了就 `scrollIntoView("transcript", anchor, offset=<px>, behavior="instant")` 还原。实测同一行 y 坐标 `-778.33 → -778.33`，新行插在上方，视线不动。
- **`Load earlier` 移出列表**：它原本也是列表行，会成为 `firstVisibleKey`，锚在它身上等于没锚；现在是列表上方一条 36pt 的固定条，只在接近顶部时出现（`nearTop`）。
- **到顶自动加载**：`scrollTop < 80` + `hasMore` + 未在加载 + `pinned == selected`（打开会话时的初始定位不算）+ 一次性的 `topArmed` 迟滞（滚过 200px 才重新武装），避免打开会话时误触发。
- **跟随底部不再是个开关**：`stick` 由滚动位置推导（`scrollHeight - scrollTop - clientHeight <= 24`）；之前它只在 `loadEarlier` 里被置 false，用户自己上滑会被每 700ms 的轮询拽回底部。
- **`Latest ›` 胶囊**：`stick == false` 时出现在输入框上方，点它滚回最后一条并恢复跟随。
- 顺带把窗口上限从 400 抬到 1200（bridge 与 app 同步）。真正的 `before=<seq>` 分页（P3）仍待做，超过 1200 条才需要。
- `verify ios`：3 测试通过、0 findings、0 编译器警告（两处 `analyze-read-after-assign` 用 `let` 绑定事件值后清掉）。

### 2026-11-17 深夜：会话列表对齐桌面

- **排序/分组与桌面一致**：原来按 cwd 字典序分组，现在读 `ctx.get('workspaceRegistry').list()`（桌面侧边栏用的同一份注册表，durable order），按注册表顺序出组、组内按 `updatedAt` 倒序、不被任何 workspace 记账的会话落到最后的 `Ungrouped`——和桌面端一模一样（dsh-exat → e-asr → monDigital → default-workspace → Ungrouped）。
- **运行状态**：`mergeStatus()` 之前只写了 `status`、漏了 `running`（`/v1/sessions` 全是 null）；补上 `running: Boolean(r.running || live?.status === 'running')` 后，列表行左侧出现状态点：运行中是品牌蓝 + `pulse` 呼吸动画 + 第二行 `Working…`，空闲是灰点。语义对齐桌面的 `StateDot`（ongoing / idle）。

### 2026-11-18 凌晨：人不在 Mac 前也能办成事（审计 P0）

对照 `/tmp/dsh-src/packages/client/*` 逐项审计后落地的四件事（完整差距表见 `docs/ui-gap-audit.md`）：

- **问句与计划审批**：bridge 注册 `user-questions/request` 的 prepend 监听，手机在场时把请求留在手机上（`POST /v1/questions/:id/answer|skip`），否则 `next()` 交给桌面。App 在 composer 上方渲染题干、选项、说明，单选点一下即答、多选勾选后 Answer，另有「Answer on the Mac instead」。实测：Mac 端 `ask_user_question` 提问 → 手机点「走 A」→ Mac 继续跑并回复。
- **审批卡补全**：卡片现在有完整参数（等宽、5 行）、摘要、理由、倒计时，按钮 Allow once / Deny / Always；Always 会把该会话的审批策略置为 `never`（后续不再问）。截留窗口从 45s 降到 15s，桌面端最多等 15 秒就能看到弹窗。
- **队列可见可删**：snapshot 带 `queue`（`state.queue` 的 id + 文本），composer 上方一条可折叠区（`Queued for the next turn · N`），每行右侧 ✕ 调 `POST /v1/sessions/:id/queue/:itemId/remove`。实测排队一条 → 删除 → Mac 侧队列为空、下一轮不再带它。
- **复制与查找覆盖整轮**：同轮多步合并时额外维护 `fullText`（所有 step 的文本），复制与 find 都用它，不再只拿到第一步。
- **工具名修正**：`ask_user_question` / `todo_write` / `exit_plan_mode` 之前没被识别（真实 wire 名与旧判断不一致），现在有独立图标与结构化卡片。

### 2026-11-18 上午：表格与命令回执（P0 收尾）

- **Markdown 表格**：`mdNodes` 识别 GFM 表头 + `|---|` 分隔行，产出 `{t:'table', head, rows:[{id,v}]}`；app 渲染成「加粗表头 + hr 分隔 + 每行一条」，表格不再是带竖线的段落。行内代码/粗体仍被压平（Exact 没有行内样式流），留作已知差距。
- **命令回执**：`POST /v1/sessions/:id/command` 现在把 `commands.execute` 的返回值带回来（字符串 / `message` / `text`），app 用 `afterExecuted` 写进 `receipt`，在 composer 上方显示 `✓ …` 或 `✗ …`，点一下消失。
- `verify ios`：3 测试通过、0 findings、最大字号不溢出。

### 2026-11-18 下午：工作区选择、推理档位、缓存命中

- **新建会话选 Workspace**：`+` 不再直接建会话，先列出快照里出现过的工作区（去重），点一个带 cwd 建会话；底部另有「Default workspace」。实测新建的会话 cwd 是 `/Users/lizhuo/owork/dsh-exat`（`session-2a8138d7…`，blank）。
- **模型两级选择**：`ModelRow` 带上 `efforts`；选中有档位的模型不再直接提交，而是进第二屏列 `off/low/high/max`，当前档位打勾。实测选 deepseek-flash + high 后 Mac 侧 `current` 变成 `{provider:'deepseek-official', model:'deepseek-flash', effort:'high'}`。
- **usage 行补缓存**：`assistant/message.usage` 的 `cacheReadTokens` 现在参与展示（`176.4k in · 11.9k out · 99% cached`），合并同轮多步时按步累加后重算。
- `verify ios`：3 测试通过、0 findings、最大字号不溢出。

### 2026-11-18 深夜：后台任务、子代理入口、中文化

- **后台任务页**：bridge 的 snapshot 带 `jobs`（`ctx.get('jobs').list(sessionId)`，按 `startedAt` 倒序、最多 12 条），新路由页 `后台任务`，运行中的作业右侧有终止键（`POST /v1/sessions/:id/jobs/:jobId/kill`）。实测在手机上终止 `sleep 120`，Mac 侧变成 `killed · signal: SIGTERM; stopped from the phone`。
- **子代理入口**：会话菜单列出 `subagentCatalog` 里的子代理，点开直接进子会话（`sub-1.png`、`sub-2.png`）。之前失败是因为用 `agents.get(id)?.session?.id` 反查——可延续子代理的 session id 就是 catalog 里的 `id`。catalog 从列表行的 projections 里取，5 秒缓存。
- **中文化**：会话列表、聊天、模型 sheet、查找、权限、会话菜单、设置、后台任务、空状态全部改成中文；`verify ios` 仍 clean。宿主返回的枚举（`workspace-write`、`killed`）和模型正文保持原样。

### 2026-11-18 深夜：修「每次打开都显示 Re-link、一直在刷新」

根因是快照太大 + 轮询太快，两者叠在一起：

1. **`/v1/snapshot` 每条会话都带了 `meta`（整块 projections），24 条 = 234 KB**。手机每次轮询都要拉 234 KB，LTE 上墙钟 670–790 ms，而轮询间隔是 700 ms——请求永远接不上，前一个还没回来就被下一次 `refresh` 打断，界面表现成「一直在刷新」，偶发失败又让 `failure(snap)` 有值，于是横幅反复出现。
2. 现在只在服务端保留 `meta`（子代理 catalog 要用），发给手机的行去掉了它：**234 KB → 11 KB**，本地 8 ms，手机首屏 528 ms。
3. 轮询改成自适应：运行中 700 ms，空闲约 2.8 s（`idlePolls` 计数）。
4. 横幅加了两连败门槛：`derive linkStale = failsSinceOk >= 2`，单次超时不再闪一下。

验收：连续两次冷启动（每次 1.5 s 截屏）都直接出列表、无横幅；`verify ios` 仍 clean。

### 2026-11-18 深夜：修「上滑载入更早的消息不生效」

两个独立的 bug 叠在一起，表现都是「划到顶了但没反应」：

1. **触发开关被反复重置**：`moved` 里 `topArmed = e.scrollTop > 200` 每个滚动事件都重算一次。用户慢慢往上滑，越过 200 之后 `armed` 就变 false，到了顶部自然不触发——只有「一次甩到顶」（或程序 `scrollIntoView`）才碰巧能用。改成：一旦武装就保持，**只有真正加载过才清除**（`if willLoad { loadFrom(); topArmed = false } else { topArmed = armed or armAgain }`）。
2. **窗口按"消息"而不是"轮"计数**：`take` 是 `maxMessages`，而这个会话一个回合有 20–40 条消息，`take=80` 只等于 8 个回合、`take=200` 也只有 10 行——点一次「载入更早」只多一两行，加上锚定还原，看起来就像什么都没发生。改成按回合：bridge `take` = 回合数（`maxMessages = take*40+40`，取回后再裁到最新 `take` 个回合，`hasMore` 也把裁剪算进去），app 默认 8 回合、每次 +8、上限 60。

验收（Android 真机）：打开会话 `take=8` → 划到顶自动变 16 → 点「载入更早」24 → 再点 32，每一步旧消息都真的出现在上方且视口不跳；`verify ios` clean。

### 2026-11-16 晚：反向无限滚动（标准模式）

用户贴了标准流程（上滑接近顶部自动加载 → prepend → **保持可见位置不跳动** → 继续上滑直到最早）。落地时发现三个独立的问题，逐个修掉：

1. **窗口单位错了**：`take` 原本是「消息条数」，而一个回合有 20–40 条消息——`take=80` 只有 8 个回合、`take=200` 也才 10 行，点一次「载入更早」只多一两行。现在 `take` **是回合数**（默认 8、每次 +8、上限 60），bridge 先取 `take*40+40` 条消息，按 `role == 'user'` 切段，保留最新 `take` 段。
2. **锚点会失效**：窗口边界原本可能切在回合中间（最旧的那段没有 user 开头），窗口变大时这一段的 id 会变，`scrollIntoView` 报 `no row keyed …`，还原直接失败 → 表现为「一加载就跳到最老」。现在**丢掉最旧的不完整段**（`segments[0][0].role !== 'user'` 时 shift），同一回合的 id 在窗口变大的过程中保持稳定（已用 take=8/16 的 id 集合做过包含性验证）。数据到位的那一拍与下一拍各还原一次（虚拟列表晚一帧布局），`anchorPending` 计数；`loadFrom` 不把合成行（Goal / 载入更早）当锚点。
3. **载荷太大**：一个 40 步的回合带完整工具卡就是 300 KB，8 个回合 1.6 MB——轮询每 700 ms 打一次，既拖慢也造成「不断刷新」。现在：
   - 最新 3 个回合保留完整细节（Markdown 节点 24 个 × 700 字、工具卡摘要/状态/图片）；
   - 更早的回合只留 1200 字正文（纯文本行），所以「载入更早」真的能增加行数；
   - 总的字节预算 90 KB，超出就裁最旧的行并保持 `hasMore`；
   - **工具卡的参数/结果不再随快照下发**（默认折叠用不到），展开时按 `callId` 调 `GET /v1/sessions/:id/call?callId=…` 现取。
   实测：`take=8` 14 行 95 KB、`take=16` 20 行 111 KB、`take=24` 31 行 135 KB（同一会话改前 8 回合 566 KB）。

顺带修好的基础设施问题：插件 disposer 现在 `server.closeAllConnections()` 再 `close()`，keep-alive 连接不会再让 disable 事务挂死（之前 `HMR transactions cannot be nested` 就是它造成的，只能重启 DSH）。

验收（iOS 模拟器，真实拖拽）：打开 take=8 → 连续上滑 take 16 → 24 → 32，内容逐段出现在上方，视线停在原处；`verify ios` 3 通过 0 finding。

## 10. 2026-11-15 夜：跑通记录（M0 全过，M1/M2 提前完成）

一晚之内从空目录到「iPhone 模拟器上配对 → 看到 Mac 的真实会话 → 打开 transcript → 发一句话 → 收到模型回复」，全程没重启桌面 App（插件用 `plugin_manager set_bundle` 热重载）。

| 验证项 | 结果 | 证据 |
|---|---|---|
| Exact `setup` + `new` + iOS hello | ✅ 首次原生构建约 10 分钟 | `apps/mobile`，iPhone 17 模拟器 |
| 插件能 bind 端口、读到全局事件 | ✅ 8787 只绑 loopback，`ctx.on('agent/assistant-stream', {global:true})` 收到 start/chunk/end | `/v1/health`、`/v1/sessions/:id/live` |
| 会话同源 | ✅ 列表里就是桌面那批 session（标题、cwd、running 一致），手机 prompt 走 `sessionController.prompt` 生成 `user-rpc` 消息 | `.exact/02-paired.png`、`06-reply.png` |
| 手机发消息 → 桌面执行 → 回复 | ✅ 桌面 transcript 里同样出现该轮对话 | `ios-05-reply.png` |
| Cloudflare Quick Tunnel | ✅ `https://juice-integrity-copyrights-detective.trycloudflare.com`，`/v1/snapshot` 0.32s，未带 token 401 | curl 实测 |
| App 走 HTTPS 隧道配对 | ✅ iOS 直接填隧道地址即可（ATS 无需例外） | `ios-06-tunnel.png` |
| 手机代答审批 | ✅ 手机上出现「Allow once / Deny」卡片，点 Allow 后 `approval.request()` 真的返回 `allowed-once`，点 Deny 返回 `rejected` | `approval-card.png`、`approval-allowed.png` |
| 停止按钮 | ✅ 运行中标题栏出现停止方块，点掉后 `state.running` 变 false | `stop.png` |
| 长文本渲染 | ✅ 500 字中文散文按段渲染，`pre-wrap` 保留换行 | `streaming.png` |

### 实现时踩到并已修掉的四件事

1. **空会话拒收 prompt**：`sessionController.prompt` 返回 `prompt rejected`，必须先 `initializeDefaultModel({sessionId})`。bridge 的 prompt 端点已自动补这一步。
2. **注入上下文混进聊天气泡**：`user/message` 里 `source.kind` 为 `runtime-context` / `skill-catalog` / `time-context` 的消息（那堆 `<system-reminder>`）不是人说的话，bridge 只透传 `source.kind === 'user'`。
3. **重新配对把老设备踢掉**：token 从单值改成列表（最多 6 个），配对只追加不替换。
4. **错误不可读**：prompt 失败原来返回 `{"error":"internal"}`，现在 409 + 原始 message，App 直接显示。

### 与计划的偏差（更好的那条）

- **协议从 SSE 改成 `/v1/snapshot` 单次快照轮询**：一次请求同时带回「会话列表 + 当前会话 transcript + 正在流式的 attempt」。Quick Tunnel 本来就不支持 SSE，而且这样断线重连、后台回前台、切会话全部退化成"再拉一次"，没有状态机。
- **渲染模型直接用 DSH 的 `ContentBlock[]`**：bridge 把 `assistant/message` 和流式 delta 折成 `text` / `reasoning` / `tool` 三类 block，App 不做 Markdown 解析——和 DSH 自己的 `BlockAssembler` 语义对齐，后续加代码块高亮只需改 bridge 的 block 化。
- **审批不是「只读镜像」，是接管**：`approval/request` 是 waterfall，bridge 用 `prepend` 抢在桌面 UI 前，但只在「手机 90s 内读过这个会话」时接管；接管后最多等 45s，没人答就 `next()` 交回桌面。代价明确：手机接管的那 45s 桌面卡片还没出现，桌面用户会等；没人看手机时行为完全不变。

### 审批这一块的已知代价

合成审批请求（`POST /v1/_ask`）验证了完整链路：waterfall 拦截 → 手机卡片 → `allowed-once` / `rejected`。**真实 bash 提权审批没有触发**，因为当前是 `danger-full-access` + `never` 策略（bash 根本不会问）。要验真场景：把某个会话策略切回 `ask`，再跑一条越权命令。另外手机接管的那 45 秒里桌面卡片还没出现，桌面用户会等——这是"手机优先"换来的代价，产品上可以加倒计时或"桌面接管"按钮。

### 2026-11-15 深夜：隧道二维码（M5 的一部分）

- bridge 自己拉起 `cloudflared tunnel --url http://127.0.0.1:8787`，从它的日志里读回 `https://*.trycloudflare.com`，`/v1/health` 的 `publicUrl` 就是它；进程退出 5s 后自动重启，插件卸载时 kill。
- `GET /pair`（仅 loopback，带 `cf-connecting-ip` 一律 403）现在是一张二维码：内容是 `dshm://pair?u=<origin>&c=<六位码>`，下面还有地址和六位数字兜底。
- **二维码本身验过**：qlmanage 把页面渲成 PNG，再用 Apple Vision（`VNDetectBarcodesRequest`）解出来是 `dshm://pair?u=https%3A%2F%2Fhighways-…trycloudflare.com&c=082255`，真机摄像头能读。
- App 加了 `/scan` 页：`getUserMedia(video, facingMode=environment)` + `exact-camera` 取景 + `detectedBarcodes(formats=["qr_code"])`；识别到就出「Pair with this Mac」。没有相机的地方（模拟器）可以粘同一个链接手动配对。
- 端到端验过的是「链接 → 配对 → 切到隧道 → 会话列表」这一段（`.exact/scan-paired.png`、`scan-sessions.png`）；**摄像头那一段没验**，因为 iOS 模拟器没有摄像头，取景框停在「Opening the camera…」。真机第一次跑要重点看这个。
- `verify ios`：3 个测试通过，深/浅色、两宽度、最大字号无溢出。

### 2026-11-16 白天：Android 跑通

- 补装 Android SDK `platforms;android-37.2` + `build-tools;37.0.0`（Exact 要求的版本，之前缺这两个），`bun exact.mjs android --write-locks` 写 Gradle 锁文件（第一次要下 CameraX 1.6.2 与 ML Kit barcode-scanning 17.3.0），再 `android --run` 出 `app-release.apk`（38 MB）。
- 在 Pixel_9_Pro 模拟器（arm64）上跑通：配对（贴链接）→ 会话列表 → 聊天 → 发消息 → 模型回复，全部正常；`agent android` 驱动（tree/tap/type/screenshot）可用，注意它每次调用会重启 App 回到根路由。
- 真机是 Xiaomi HyperOS（`24129PN74C` / Android 16），`adb install` 被拒（`INSTALL_FAILED_USER_RESTRICTED`），需要开启「USB 安装」或手动点安装；已把 APK push 到 `/sdcard/Download/dsh-mobile.apk`。
- 顺手修了 Android 边到边（edge-to-edge）下内容顶到状态栏的问题：chat 路由的 column 加 `padding-top="var(--exact-safe-area-inset-top)"`。

### 2026-11-16 白天：DSH 侧边栏面板（配对入口）

- bridge 现在两半：`lib/index.js`（宿主，8787 端口）+ `lib/client.js`（浏览器端），`package.json` 里用 `dsh.client` 声明，`plugin_manager set_bundle` 热重载即生效，不用重开桌面端。
- 侧边栏多出「手机配对」一行（`sidebar.panellist`），点开是一个 `main` 面板：二维码（`/v1/pairing.svg`）、六位数倒计时、刷新二维码、在浏览器打开、服务器地址 / 配对链接 / 设备 token 三行各自可复制。
- 宿主端新增 `pairingView()`，`/v1/pairing` 返回 `{code, expiresAt, ttlMinutes, publicUrl, localUrl, deepLink, token, paired, tunnelRunning}`，`/v1/pairing.svg` 直接吐 SVG，两个都只允许本机访问（带 `cf-connecting-ip` 的请求 403）。
- 验证：面板渲染和 `selectPanel` 走通（临时探针调用同一个 `layout.selectPanel`，面板正常出现，标题变成产品名）；本机合成鼠标点击在 macOS 上打不进 DSH 窗口，所以「点这一下」没法自动验，逻辑与探针同一路径。

### 2026-11-16 凌晨：会话管理 + 断链兜底

- bridge 加了 `POST /v1/sessions`（新建，同一个 `sessionController`，桌面立刻可见）、`POST /v1/sessions/:id/rename`、`POST /v1/sessions/:id/fork`。
- App：会话列表标题栏 `＋` 新建并直接进入；聊天标题栏 `⋯` 进「会话菜单」，里面有改名输入框和「Fork from here」。
- 验过：手机上新建会话 → 桌面列表里出现「Untitled session」→ 发一条消息 → DSH 自动起名 → 手机上改名成「手机建的会话」（Mac 端 API 读回来就是这个字符串）→ fork 出新会话（`session-43b62541-…`）并跳进去。
- 顺手补了断链兜底：bridge 重启会让 Quick Tunnel 换域名，App 存的旧地址会 530；列表页现在识别 `failure(snap)` 并显示「Can't reach your Mac…」+ 一键 Re-link（扫码/贴链接）。
- 轮询从 1200ms 提到 700ms，实测能截到「半句话」：`stream-1.png` 是回答写到「他偶尔」时截的，`stream-2.png` 是 1.5s 后写完整段并自动跟随到底部。
- 为了避开另一个会话在同一台模拟器上抢前台，给本项目单独建了一台模拟器（`DSH Mobile`，`xcrun simctl create`），之后 `bun exact.mjs ios --run --sim <udid>` 和 `verify ios --sim <udid>` 都用它。
- 待办：真机摄像头扫码仍需在 iPhone 上验一次（模拟器无相机）；新建会话用的 cwd 是 DSH 默认工作区，之后可以让手机选目录；标题栏在 iOS 26 的玻璃导航栏下会透出滚动内容（观感问题，未处理）。

### 2026-11-16 晚：轮询分流（live / transcript）

- `/v1/live`（约 12 KB，大头是 24 条会话列表）每拍拉；`/v1/transcript` 只在 bridge 给的 `rowsRev`（最后事件 seq + take）变化时拉。空闲会话从「每 2.8 s 重传 90+ KB 历史」变成「只传 live」；运行中的会话按事件粒度拉，不按时钟。
- app 侧 `resource live` + `resource rows = loadRows(server, token, selected, take, live.rowsRev)`（rev 是资源参数，变了自动重读），`derive snap = Snapshot(live, messages=rows.rows, hasMore=rows.hasMore)` 合并，其余代码不变；所有 mutation 的 `refreshes snap` 改成 `refreshes live`。
- Android 真机实测：同样 8 秒窗口 14 次 live + 2 次 transcript（开屏一次、回复落地一次）；发送→回复 OK 正常。iOS `verify` 3 测试 0 findings。
- 单回合 12 KB 上限（ROW_CAP）与 FULL_ROWS=6 继续有效。
- 追加：live 里的会话列表也按需了——bridge 给 `listRev`（id:updatedAt:running:pinned:title 指纹），客户端带上自己的 rev，匹配时响应省掉 sessions。app 用 `state listRows` 缓存列表、`derive snap` 从缓存取 sessions。空闲心跳从 12 KB 降到 **1.9 KB**；冷启动（列表变了）仍是 13 KB。Android/iOS 实测一致，`verify ios` 3 测试 0 findings。

### 2026-11-16 深夜：双通道配对（Tailscale + Quick Tunnel）

- bridge 用 `/sbin/ifconfig` 找 utun 上的 CGNAT 地址（100.64/10）做 Tailscale IP —— **不能** spawn App Store 版 Tailscale 的 CLI（它是 GUI 包装，在 DSH/Electron 进程里报 `Tailscale.CLIError 3`），从接口表读最稳。检测到 IP 时 8787 绑 `0.0.0.0`（token 仍把关全部路由），否则 127.0.0.1。
- 配对链接升级为 `dshm://pair?u=<tunnel>&d=<direct>&c=<code>`，`/v1/pairing` 多 `directUrl` 字段，QR 页同链接。
- app `pairFromLink` 按 `[direct, tunnel]` 顺序尝试：任一路径收到 HTTP 应答就直接采信（错误码不会因为换路径变好），网络错误才落到下一个；全失败时报 lastError。
- Mac 侧验证：`curl http://100.102.127.63:8787/v1/health` 直连 200；deep link 带 `d=`。
- 手机侧实测（用户登录后）：重配对一次，app 日志显示全部 14 个请求都打 `http://100.102.127.63:8787`；发送→回复 OK。
- **关键验证**：`pkill cloudflared` 后（隧道完全死掉），直连路径不受影响——手机继续收发，「隧道已关：请只回复 STILL。」→ `STILL` 正常往返，Mac 侧 snapshot 确认。`/v1/live` 直连 200。
- 结论：Tailscale 连接时配对 = 永不再重配；隧道只作为 tailnet 外的回落。
- `verify ios` 3 测试 0 findings。

### 还差什么（下一步顺序）

1. **M3 收尾**：流式跟手现在 700ms 一轮、已能截到半句话；还差「切会话时保留滚动位置」和真机手感。
2. ~~M4 审批~~ ✅ 已通（见上），但要补：45s 超时倒计时显示、多设备时谁接管、桌面卡片与手机卡片互斥的产品文案。
3. **会话管理**：新建、重命名、fork（`sessionController` 已有这些方法，只差接口和 UI）。
4. ~~每次启动的隧道地址~~ ✅ bridge 自己管 cloudflared 并出二维码；剩「真机摄像头扫描」没验（模拟器无相机）。
5. **真机 + TestFlight**：模拟器已验证，真机只差签名；`bun exact.mjs share` 可先发 AppDrop 链接。
6. **推送**：后台没有实时性，v1 明说「前台才实时」；要通知就接 APNs 或先用 Bark/ntfy 自建。
