# 手机端 UI 差距审计（对照 DSH 桌面端）

审计日期：2026-11-16 · 对照范围：`apps/mobile/app.contract`、`apps/mobile/app.ts`、`bridge/lib/index.js` 对照 `/tmp/dsh-src/packages/client/*`。
方法：只读源码逐项比对，未运行模拟器；下文桌面端路径相对 `packages/client/`，手机端路径相对仓库根 `dsh-exat/`。

## 1. 总体结论

手机端已经覆盖了「翻会话 → 读一轮回答 → 发一句话 → 批一次审批」的主干，但这条主干上有三处是断的：需要人回话的交互（`ask_user_question`、计划审批）在手机上根本渲染不出可点的卡片；审批被 bridge 抢到手机上却只给一行摘要，同时把 Mac 的弹窗压后最多 45 秒；发送侧只能发纯文本，选「下一轮」的消息发出去就消失、不能看也不能撤。渲染层则是「够读但不忠实」：Markdown 表格和行内格式被抹平，一轮多步回答的复制与搜索只覆盖第一段，todo、命令回执、token/耗时统计都只剩示意。因此下一轮不应先追桌面端的便利设施，而应先把「人在环」的三件事补齐，再修渲染忠实度，最后才是 jobs、子代理这类桌面专属能力。

> 2026-11-18 下午更新：又落地三条 P1——新建会话先选 Workspace（`+` 打开工作区列表，`POST /v1/sessions {cwd}`）、模型的两级选择（选中有档位的模型后进 effort 列表，`current.effort` 高亮）、usage 行补了缓存命中（`x in · y out · N% cached`）。
>
> 2026-11-18 更新：第五条 P0 也落地了——`mdNodes` 现在识别 GFM 表格（表头 + 行），app 用「加粗表头 + 分隔线 + 行」渲染；斜杠命令执行后 composer 上方会出一条回执（成功 ✓ / 失败 ✗ + 文案，点一下消失）。
>
> 2026-11-17 更新：P0 已落地四条——问句/计划审批可在手机上回答（`user-questions/request` 拦截 + `POST /v1/questions/:id/answer|skip`）、审批卡补了完整参数与「Always」（并把截留时间从 45s 降到 15s）、队列在 composer 上方可见且可删（`POST /v1/sessions/:id/queue/:itemId/remove`）、复制与查找改用整轮全文（bridge 的 `fullText`）。表格保留原始判定，末尾「下一轮顺序」已更新。

## 2. 差距表

| 优先级 | 桌面端行为（含源码路径:行号） | 手机端现状 | 建议做法 | 成本(S/M/L) |
| --- | --- | --- | --- | --- |
| P0 | 审批卡按 callId 渲染完整详情（命令/补丁）：`ui-approval/src/client/ApprovalCard.tsx:20` 渲染 `conversation.approval.detail`，`:59-77` 有 subject/warning/description，`:83-88` 有 Allow once 与（宿主支持时）Always allow | `bridge/lib/index.js:282-320`：手机 90 秒内读过该会话就把审批截到手机，在手机作答或 45 秒超时前不调用 `next()`，桌面端根本收不到这条审批；卡片（`apps/mobile/app.contract:647-661`）只有工具名 + 160 字摘要（`bridge/lib/index.js:688`）+ 3 行理由，按钮只有 Allow once / Deny。结果：看不到要批什么就得批，且 Mac 端像卡死 | 卡片补完整命令与 diff（tool 卡里已有 `diffs` 数据）、加 Always allow；`PHONE_WAIT_MS` 降到 10–15 秒，或仅在 App 前台且停在该会话时才截走 | M |
| P0 | 问句可选项/多选/自定义/倒计时：`ui-user-questions/src/client/QuestionComposer.tsx:153-243,359-366`；计划审批是同一条 ask：`plan/plan-mode/src/index.ts:305-334`（`exit_plan_mode` 在工具里 await 用户回答） | bridge 用 `name === 'question'` 判断（`bridge/lib/index.js:467`），真实工具名是 `ask_user_question`（`ui-user-questions/src/index.ts:4`），所以 `card.question/options` 永远为空、`apps/mobile/app.contract:608-613` 那句「Answer it on the Mac」是死代码。`ask_user_question` 和 `exit_plan_mode` 都只显示成 running 的 JSON 工具卡，用户看不出 Mac 在等人，会话像卡住 | 先改工具名并保留 `detail`；bridge 把 pending ask 暴露成可回答对象（列表 + 回复两个路由），手机渲染选项/多选/自定义；计划审批复用同一入口 | M |
| P0 | composer 上方常驻队列区，可编辑：`ui-conversation/src/client/queue/QueueDock.tsx:105-165` 队列行与 `{ kind: 'edit' }` 更新，`:183-241` 发送中状态、保存/取消、附件缩略图 | 运行时只有「本轮/下一轮」两个文字按钮（`apps/mobile/app.contract:688-693`）；`mode: 'queue'` 发出后（`apps/mobile/app.ts:217-220`）没有任何队列展示，不能看、改、撤。下一轮会突然带上一条用户以为丢了的旧指令 | 快照带 queue 列表，composer 上方加可折叠队列区；先支持删除，编辑可后置 | M |
| P0 | 消息动作按整条消息复制/分叉：`ui-chat/src/client/chat/MessageIconActions.tsx:1-28` | `bridge/lib/index.js:628` 合并同轮多步 assistant 时 `prev.text = prev.text !== '' ? prev.text : m.text`，只保留第一步文字；`apps/mobile/app.contract:636-641` 复制的就是它，`:253-254` 的会话内查找也只搜它、且只搜已加载的约 80 条。多步回答复制出来像全文，其实只有开头 | bridge 另存一份「整轮全文」供 copy/find（渲染仍用 blocks）；查找改为按需全量或服务端搜索 | S |
| P0 | GFM 表格渲染，宽表横向滚动：`ui-primitives/src/markdown/render.tsx:390-391`（table 分派）与 `:529-556`（`md-table-wide` 滚动容器） | `bridge/lib/index.js:340-408` 只产出 p/h/ul/ol/code/quote/hr/img，表格降级成带竖线的普通段落；`inline()`（`:344-351`）把粗体、行内代码、删除线直接剥掉。带表格或强调的回答在手机上读不出来，还会被当成纯文本引用 | `mdNodes` 增加 table 节点（表头/行/对齐），`apps/mobile/app.contract:543-582` 增加表格渲染与横向滚动；行内至少保留行内代码的等宽样式 | M |
| P1 | 附件条与文件摄入：`ui-attachment/src/AttachmentRail.tsx:56`（可删除/重试）、`ui-conversation/src/client/input/file-intake.ts:2-82`（粘贴/拖拽进当前 composer） | 没有任何附件入口；用户消息只取文本（`bridge/lib/index.js:505-508`），Mac 上发的图在手机上完全消失；bridge 只有 `GET /v1/attachments/:id`，没有上传路由 | 先让历史里的用户附图可见（bridge 把 image part 映射成 image 块，手机已有渲染），再做拍照/相册上传与发送 | L |
| P1 ✅ | 会话级 todo 面板：`ui-conversation/src/client/skeleton/TodoPanel.tsx:52-88`（done/active/pending 计数，`apply.ts:607` 注册在 composer 上方）、`ui-tool/src/client/tool/toolviews/todo-row.tsx:39-44` | `bridge/lib/index.js:459` 判 `name === 'todo'`，真实工具是 `todo_write`（`todo/tool-todo/src/index.ts:137`），`card.todos` 永远为空；手机也没有会话级 todo 投影，只能展开工具卡看 JSON | 改工具名；从 `todo_write` 事件推出当前清单放进 snapshot，composer 上方加可折叠进度 | M |
| P1 | 命令回执：`ui-chat/src/client/chat/CommandNodeView.tsx:10-34`（命令生命周期卡，`/compact` 有专门卡） | `apps/mobile/app.contract:350-354` 的 `executed` mutation（声明于 `:231`）没有任何 UI 消费；执行斜杠命令后无回执、无输出、无错误 | 用返回的 output 在 composer 上方弹一条回执，失败标红；命令节点后续纳入 transcript | S |
| P1 | 模型 + 推理档位两级选择：`ui-model-selection/src/client/ModelSelect.tsx:5-22,45-111`（模型列表下钻 effort 面板，入口同时显示 model 与 effort） | `apps/mobile/app.ts:255-275` 丢掉 `efforts`，`apps/mobile/app.contract:704` 固定传空 effort；bridge 其实已返回 `efforts` 与 `current.effort`（`bridge/lib/index.js:1106,1110`） | 选中有档位的模型后进第二屏选 effort（当前值高亮）再 POST | S |
| P1 | 统计与时间：`ui-chat/src/client/chat/StatsPills.tsx:296-314`（token 总量 + 缓存命中率，可点开详情）、`:108-119`（cacheHitPercent）、`ui-chat/src/client/chat/message-chrome.ts:49-77`（耗时、时间戳） | `bridge/lib/index.js:640` 只拼「x in · y out」，`apps/mobile/app.contract:640-641` 一行 0.69rem 小字；没有缓存命中、上下文占用、耗时、时间 | snapshot 透传 usage 对象（cacheRead/Write、context、duration），footer 做成可点开的详情 | M |
| P1 ✅ | 会话级菜单：`ui-workspace/src/client/session-actions/context-menus.tsx:45-85`（pin/rename/未读/fork/复制 id/archive）、`PinSession.tsx:13-44` | `apps/mobile/app.contract:744-768` 只有 rename/permissions/find/fork；会话列表也没有未读/置顶状态 | 会话行左滑或长按菜单补 pin/archive/未读，snapshot 补 pinned/unread | M |
| P1 | 目标条可编辑：`ui-goal/src/client/GoalBar.tsx:33-167`（改目标、暂停/恢复、清除、阶段标签） | `apps/mobile/app.contract:514-522` 目标只是不可点的文本 + 计划步骤 | 长按目标行出操作单（编辑/暂停/清除），加对应 bridge 路由 | M |
| P1 | 新建会话先选 Workspace：`ui-sidebar/README.md`（使用显式选中的 Workspace）、`ui-workspace/src/client/WorkspacePicker.tsx` | `apps/mobile/app.contract:451` 直接新建，`apps/mobile/app.ts:377` 不带 cwd；bridge 支持 cwd（`bridge/lib/index.js:1166`）却没用上，新会话可能落在 Mac 的默认目录 | 新建前弹最近工作区列表，默认当前会话的 cwd | S |
| P2 | 后台任务列表与终止：`ui-jobs/src/client/JobListAction.tsx:26-180`（live/settled 分区、展开输出、二次确认 kill） | 无后台任务页，只能靠 `job_output` 的工具卡间接看 | 会话菜单加「后台任务」页，先只做列表 + kill | L |
| P2 | 子代理谱系与跳转：`ui-subagent/src/client/SubagentHeaderLineage.tsx:29-57,249-452` | 子会话混在会话列表里，没有谱系和「打开父/子」入口，工具卡只有 description | 工具卡上给子会话 id 一个跳转（会话列表已能按 id 打开） | M |
| P2 ◐ | 消息级动作：`ui-chat/src/client/chat/TurnTailNodeView.tsx:29-72`（从此处分叉、hover 动作、`assistant-actions` 插槽）、`ui-message-feedback/README.md`（点赞/点踩 + 反馈弹窗） | 只有 copy 一个动作 | 长按消息出菜单，先做「从此处分叉」（fork 端点已有，补 seq 即可） | M |
| P2 | 工作细节模式：`ui-chat/README.md` 的 Compact/Verbose 控制推理预览与已完成轮次的过程行 | 过程行只有展开/收起，没有默认模式 | 设置里加「过程行默认展开/紧凑」 | S |
| P2 | 主题与多语言：`ui-theme`、各包的 `locales.ts` | 主题跟随系统，界面文案全英文硬编码 | 先抽到 `strings/`（Exact 已有目录）并出中文，主题保持跟系统 | M |

## 3. 手机端不该抄的

- 三栏 AppFrame（`ui-layout`）：手机宽度下中栏会被两侧挤没，单栏 push 导航已经够。
- 右侧 dockkit 分屏/标签（`ui-sidebar-right`、`ui-dockkit`）：要大面积和鼠标拖拽才能用，等于把桌面塞进 6 寸屏。
- 终端（`ui-sidebar-terminal`）：软键盘没有 Ctrl/Esc，交互式命令基本没法用；看输出用工具卡更稳。
- 文件树与文档预览（`ui-sidebar-files`）：深层路径点击成本高，文件交给系统预览/分享更合适。
- trajectory 事件账本与记录检查器（`ui-trajectory`）：调试用的信息密度，手机上读不动。
- 悬停才出现的动作条、右键菜单、拖拽上传（`TurnTailNodeView.tsx:61`、`file-intake.ts`）：手机没有 hover 和右键，应改成左滑/长按。

## 4. 建议的下一轮顺序

1. ✅ **修 bridge 的工具名判断，并让手机能回答问句与计划审批**（`bridge/lib/index.js:467` → `ask_user_question`；pending ask 走新路由，plan review 复用同一入口）。
   验收：Mac 上让 agent 提问 → 手机点选项 → Mac 继续跑；`exit_plan_mode` 的审批也能在手机上点「Approve」。
2. ✅ **审批卡补全，且不再压住桌面弹窗**（详情/参数已补、`Always` 已加、15s 超时）（详情 + diff + Always allow；前台/会话判定 + 超时降到 10–15 秒）。
   验收：手机停在聊天页时 Mac 也能立刻看到弹窗；手机上能看到完整命令后再 Allow once；Always allow 生效。
3. ✅ **队列可见可删**（snapshot 带 queue，composer 上方折叠区）。
   验收：运行中从手机发两条「下一轮」→ 区域里出现两条 → 删一条 → 下一轮只跑剩下的那条。
4. ✅ **复制与查找覆盖整轮**（bridge 合成全文，find 用同一份文本）。
   验收：三步回答复制到剪贴板与屏幕一致；查找能命中第二个工具调用之后出现的词。
5. ✅ **Markdown 表格**（行内代码仍被抹平，见「还差」）（`mdNodes` 加 table，contract 加渲染）。
   验收：让 agent 输出一张 3×3 表格，手机能横向滚动读全；行内代码有等宽底色，粗体不再显示成裸星号。

> 顺序理由：1–2 是「人不在 Mac 前就办不成」的阻塞项；3 是会把用户指令静默带进下一轮的误导项；4–5 才是阅读忠实度。

## 5. 2026-11-18 落地记录

| 项 | 状态 | 证据 |
| --- | --- | --- |
| 问句（ask_user_question）可回答 | ✅ | `q-1.png`、`q-2.png`、`q-3.png`：手机上点「走 A」，Mac 回「你选择了走 A」 |
| 审批详情 + Always + 15s 窗口 | ✅ | `approvals` 卡片带等宽参数块与 Always |
| 队列可见可删 | ✅ | `queue-1.png`：`Queued for the next turn · 1` + ✕ |
| 整轮文本（copy/find） | ✅ | `fullText` 合并 |
| Markdown 表格 | ✅ | `table-2.png` |
| 命令回执 | ✅ | 输入框上方 `receipt` 行 |
| 新建会话选工作区 | ✅ | `ws-1.png`、`ws-2.png` |
| 模型 + 推理档位 | ✅ | `effort-1.png`、`effort-2.png` |
| usage 缓存命中 | ✅ | `usage-1.png` |
| 会话级 todo 面板 | ✅ | `todo-1.png`、`todo-2.png` |
| pin / archive | ✅ | `pin-2.png`（pin 图标 + 置顶排序） |
| 目标暂停/恢复/清除 | ✅ 路由 + 菜单 | `POST /v1/sessions/:id/goal`，curl `paused`→`active` |
| 过程行默认模式 | ✅ | 设置里「Expand steps by default」（`verbose-1.png`） |
| 消息级「从此处分叉」 | ✅（不自动跳转） | `fork-8.png`：创建副本并给回执「Forked from here — the copy is at the top of the list.」 |

| 后台任务列表 + 终止 | ✅ | `jobs-1.png`、`jobs-2.png`：手机上终止 `sleep 120`，Mac 侧 `status: killed · signal: SIGTERM; stopped from the phone` |
| 子代理谱系 | ✅ | 菜单末尾出现 `Subagent · Audit DSH desktop vs mobile UI`，点开即进子会话（`sub-1.png`、`sub-2.png`）。关键发现：可延续子代理的 **session id 就是 `subagentCatalog[].id`**，不需要 `agents.get()` |
| 界面中文化 | ✅ | `zh-1.png`（列表）、`zh-3.png` / `zh-4.png`（会话菜单）；仍为英文的只有宿主枚举（permission preset 名、job status）与模型正文 |

