# DSH Mobile UI 差距审计

日期：2026-11-16 · 对照对象：DSH 官方 Web UI（安装包内 `@deepseek-ai/dsh-client-ui-*`）
结论先行：**现在手机端只呈现了 DSH 会话里大约三分之一的可见信息**，而且视觉语言完全是 iOS 原生范式。两件事都能做到"完全一致"，但需要把 bridge 从"文本块"升级成"节点流"，并在 app 里补四类组件。

---

## 1. DSH 官方会话里到底有什么

来源：`dsh-client-ui-chat/README.md`、`dsh-client-ui-tool/README.md`、`dsh-client-ui-conversation/README.md`。

| 类别 | 官方 UI 的呈现 | 数据来源 | 手机现在 |
|---|---|---|---|
| 用户消息 | 气泡 + 图片/文件/附件/引用 chips | `user/message.data.content` | 只有纯文本，附件丢失 |
| 助手消息 | **Markdown**（标题/列表/表格/引用/行内 code/链接/数学/引用块） | `assistant/message.message.content[].text` | 纯文本 `pre-wrap`，`**`、`#`、`-` 原样显示 |
| 代码块 | 语言标签、等宽、复制；`diff`/`patch` 走统一 diff 层；`math` 流式时显示源码 | 同上 | 无 |
| 图片 | 用户图与工具输出图两个槽位，共享 lightbox | `content[]` 的 `image` 块 | 无（bridge 直接跳过） |
| 工具调用 | **每种工具一张专用卡**（见 §1.1） | `tool/call` + `tool/result` | 一行 `name + 参数前 240 字`，无展开、无状态色 |
| 工具结果 | 可展开、可折叠（diff 9 行、终端输出、搜索结果分组） | `tool/result.message.content` + `meta` | 前 800 字，6 行截断 |
| 审批 | 卡片带工具名/参数摘要/允许一次/拒绝 | `approval` 投影 | ✅ 已有（但无参数摘要） |
| 计划 / 目标 / TODO | 结构化卡片，随会话状态更新 | `plan` / `goal` / todo 工具 | 无 |
| 子代理 | 卡片列出子代理、状态、耗时；可点开 | `subagent*` 投影 | 无 |
| 问题卡片 | 模型提问 + 选项，可直接回答，事后只读回看 | `userQuestions` 投影 | 无 |
| 上下文注入 | 灰行（时间、技能目录、系统提示）可折叠 | `user/message.source.kind != user` | **被丢弃** |
| 命令回执 / 隐藏行 | `/` 命令回执、`/team on` 等不显示 | `command` 事件 | 无 |
| 失败 / 中断 | 红点胶囊 + 退出码/信号 + 错误行 | `turn/end.reason`、`tool/result.error` | 只有 `failed` 布尔 |
| 每轮用量 | 回合尾部 token 用量行（需 `turn/start` + exact usage） | `usage` | 无 |
| 回合折叠 | Concise / Verbose 两种详细度，过程可一键折叠 | 会话设置 | 无 |
| 回合尾操作 | 复制、重新分支（branch from here） | 本地 | 无 |

### 1.1 官方已实现的工具卡（`dsh-client-ui-tool`）

通用兜底卡；shell/pwsh；`read`；`read_image`；`write`/`edit`（共用组件，显示 `NKB` 与 diff 统计）；`apply_patch`（文件级 summary + 每个文件一行，hunk 来自 `meta.diffs`）；`str_replace_editor`；`grep`/`glob`；`web_fetch`/`web_search`（折叠行带 URL）；`todo`；`question`；`office_render`/`office_convert`/`office_recalculate`；PTC 分发（递归 `subCalls`）；`subagent`/`subagent_fork`；`list_subagent_models`；`skill`；goal/schedule；Cordis 检查；workflow/Ralph；session event/search/trace；agent/team 控制；后台 job；持久终端 + `terminal_send`；LSP 跳转；团队任务卡。
所有卡共享一套 model：失败/中断必须显式（红点 + 退出码），运行中行有左→右高亮，diff 卡默认 9 行后折叠。

---

## 2. 我们现在的渲染面

> 2026-11-16 更新：M5.1 已落地。助手文本现在是 `kind:'md'` 的 `nodes[]`，工具块带 `callId`/`status`/`result`/`diff`，`tool/result` 折进对应调用；`verify ios` clean。下面这段是 M5.1 之前的旧状态，留作对照。

**Bridge**（`bridge/lib/index.js`）把会话折叠成 4 种块：

```js
user      → { text: 前 4000 字 }
assistant → blocks: text(全量) | reasoning(前 1200 字) | tool(name + 参数前 240 字)
result    → { text: 前 800 字, failed: bool }
```

丢掉的东西：`image` / `file` 块、`tool-call` 的 `id` 与结果关联、`meta.diffs`、`usage`、`turn/end.reason`、`plan`/`goal`/`todo`/`subagent`/`userQuestions` 投影、`compaction` 事件、`request/context`（注入的上下文）、`session/title` 之外的元信息。

**App**（`apps/mobile/app.contract`）：用户气泡（AccentColor 白字）、助手纯文本、推理 3 行灰字、工具一行、结果 6 行灰字、审批卡、composer（textarea + 发送箭头）、会话列表（inset grouped）、设置页、扫码页。

---

## 3. 差距清单

### P0 —— 不做就不像 DSH（"能读"底线）

| # | 项 | 做法 | 依赖 |
|---|---|---|---|
| 1 | Markdown 结构渲染 | bridge 侧把 `text` 解析成块节点（段落/标题/列表/引用/代码块/分隔线 + 行内 `code`/`bold`/`link`），app 按节点渲染 | 无（自写 ~200 行解析器，零依赖） |
| 2 | 代码块 | 等宽 + 语言标签 + 横向滚动 + 复制 | 无 |
| 3 | 工具卡解剖 | 图标 + 标题 + 一行摘要 + 状态点 + 点击展开（参数/结果/diff） | 需要 `tool/call.id` 与结果配对 |
| 4 | 工具结果与 diff | `meta.diffs` 着色的 `+/-/ ` 行；结果可折叠 | bridge 传 `callId`、`meta` |
| 5 | 错误/中断行 | 红/黄胶囊：退出码、信号、`turn/end.reason`、`failed` | `tool/result.error`、`turn/end` |
| 6 | 回合分组与用量 | 按 `turn` 分组；尾部 `1.2k in / 800 out · ¥0.03` | `usage`、`turn/start` |
| 7 | 上下文注入行 | 灰行、默认折叠、标 `context` | `user/message.source.kind` |
| 8 | Composer 对齐官方 | 16 圆角容器；左 `+`、权限胶囊、模型胶囊；右 发送/停止 | 需要 `modelCatalog`、权限策略读写 |
| 9 | 深色主题 + 品牌色 | 见 §4 token 表 | 无 |

### P1 —— 用起来才完整

图片（用户附件与 `read_image` 输出，lightbox）· todo/plan/goal 卡 · question 卡（可回答）· subagent 卡 · 审批卡带参数摘要 · 回合折叠（Concise/Verbose）· 复制/分支 · 会话搜索 · 附件上传（相册/文件）· 新建会话选目录。

### P2 —— 桌面特有，手机可暂缓

终端卡、office 卡、团队/job 卡、LSP、workflow 报告、文件侧栏与预览、trajectory/context 面板、插件市场与全套设置。

---

## 4. 视觉对齐规范

从 `@deepseek-ai/dsh-client-ui-theme` 提取（`--dsw-*` 变量）：

| Token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `bg-base` | `#ffffff` | `#0f1115` | 页面底 |
| `bg-layer-1/2/3` | `#fafafa` / `#f5f5f5` / … | 同族深灰 | 卡片分层 |
| `label-primary` | `#0f1115` | `#f5f7fa` | 正文 |
| `label-secondary` | `#61666b` | `#a8adb3` | 次要文字 |
| `border-l1` | `rgba(0,0,0,0.04)` | `rgba(255,255,255,0.08)` | 分隔线 |
| `brand` (`deepseek-500`) | `#4176e6` | `#4176e6` | 主按钮、链接、选中 |
| `radius-md` / `lg` | 12 / 16 | 同 | 卡片 / 气泡 |
| 字体 | `dsh-font-family-text-default`；品牌字 Montserrat | | 标题用品牌字，正文系统字 |

**Composer 解剖**（官方顺序）：外框 16 圆角 → textarea（无边框，placeholder `Message or run a task, / commands, @ files or sessions`）→ 底部一行：左 `+` 圆形、`Full access` 胶囊（盾牌图标）、`DeepSeek-V4.1-Flash High` 胶囊（chevron）；右 `↑` 圆形品牌色按钮（运行时变 `■`）。

**消息解剖**：用户 = 右对齐气泡（`brand @ 12%` 底或纯 `brand`，白字，18 圆角）；助手 = 左对齐**无气泡**，Markdown 正文 15px/1.65；工具 = 一行（16px 图标 + 名称 + 灰摘要 + 右侧状态），点开是卡片。
**列表**：inset grouped，分组标题 13px 灰大写，行高 ≥44，右侧 chevron。

---

## 5. 实施路线

| 里程碑 | 内容 | 状态 |
|---|---|---|
| **M5.1 数据面** | Markdown 节点（p/h/ul/ol/code/quote/hr）、工具结果按 `callId` 配对（`status`/`result`/`diff`）、未支持块占位提示 | ✅ 已通：`.exact/md-live.png`、`.exact/android-md.png`；`verify ios` clean |
| **M5.2 工具卡** | 通用卡 + 图标/摘要（bash→play、read→document、edit→pencil、search、link、people、sparkles…）、点行展开参数+结果+diff、失败显示红字 `exit N` | ✅ 已通：`.exact/tools-5.png`、`.exact/tool-diff.png`、Android `android-glass.png` |
| **M5.3 结构化卡** | todo 卡（○/◐/●）、question 卡（问题+选项+“请到电脑端回答”）、goal 条 + plan 步骤条、每轮 `N in · M out`、审批卡带调用摘要 | ✅ 已通：`.exact/goal-plan.png`（真实 goal 投影）、`approval-args.png`（`bash / exit 7 / run a shell command`）、`android-goal.png`；todo/question 解析已单测、等真实调用 |
| **M5.4 视觉** | composer 改 `backgroundMaterial="glass"` 胶囊 + `prominent-glass` 发送 + 模型行；会话列表 inset 卡片；深色验证 | ✅ 已通：`.exact/glass-chat.png`、`glass-dark.png`；列表卡片因命中测试问题先回退成普通行 |

**做不到/代价高的**：Exact 无 webview、无第三方 UI 库，Markdown 与语法高亮都得自己写；语法高亮建议先不做（等宽 + diff 着色已够读）。图片需要 bridge 以 base64 回传（单张限 2 MB）。文件链接在手机上无法打开桌面侧栏——建议显示路径 + 复制。
