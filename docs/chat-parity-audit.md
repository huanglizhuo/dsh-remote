# DSH 桌面端 ↔ 手机端 对话界面差距审计

- 桌面源码: `/tmp/dsh-src/packages/client/`（重点 `ui-chat/src/client/chat/` 及 `ui-conversation` / `ui-tool` / `ui-plan` / `ui-deliverables` / `ui-message-feedback` / `ui-reference`）
- 手机端已实现清单见任务说明，不再重复。本报告只列**缺口**。
- 分级：P0 = 用户每天会踩；P1 = 明显缺失；P2 = 锦上添花。

---

## P0 — 每天会踩

### 1. 运行状态行（活动类别 + 详情 + 计时）
- 桌面：`ui-chat/src/client/chat/RunningStatus.tsx:25-48` — 鲸鱼图标 + TextShimmer「深度思考中 Xs」（`chat.deepDivingFor` + `formatRunDuration`，每秒刷新；断线时冻结计时）。活动详情来自 `process-activity.ts:9-170`：把运行中工具归类为 读取/搜索/编辑/命令/代码/联网/子代理/计划/提问 等，取参数首个可读键（`LIVE_TOOL_DETAIL_KEYS`，`process-activity.ts:28-31`）截 160 字符做单行详情；无工具运行时取最新 reasoning 首行（`process-activity.ts:96-111`）。组头 `ChatGroupSeat.tsx:93-131`（`ProcessGroupHeader`）显示「类别图标 + 类别名 · 详情」shimmer 行，标题 150ms 防抖（`PROCESS_TITLE_MINIMUM_MS`）。
- 手机现状：回合运行中只有合并的步骤计数，看不到"正在干什么、跑了多久"。
- 建议：底部悬浮运行条 = 鲸鱼 + 类别图标 +「深度思考中 Xs」+ 160 字参数摘要（command/file_path/pattern 等键优先），每秒刷新；断线冻结。

### 2. TODO 面板（内联 checklist）
- 桌面：`ui-conversation/src/client/skeleton/TodoPanel.tsx`（119 行，挂 `conversation.input.dock` order 0）— 输入框上方常驻面板，`useProjection('todos')` 实时投影。折叠态：清单图标 +「n 已完成 · n 进行中 · n 待办」（零计数段省略）；展开态：完整 checklist，每项 `StateDot`（done/ongoing/idle 三态）+ 内容 + `data-status`。转写内的工具行 `ui-tool/src/client/tool/toolviews/todo-row.tsx:1-94` 摘要「n/m 已完成 · 当前进行中条目」，展开是 `todo-diff-model.ts:17-79` 的 diff（+新增/更新/移除，未变项折叠为「N 项未变」）。
- 手机现状：只有「Plan · n/m」一行。
- 建议：把 Plan 行升级为可展开 checklist（三态圆点 + 逐项内容 + 分类计数），todo_write 工具卡展开时显示与上次对比的 diff 摘要。

### 3. 队列卡缺编辑 / 立即 steer / 折叠
- 桌面：`ui-conversation/src/client/queue/QueueDock.tsx`（415 行，挂 `conversation.input.dock` order 20）— 单条直接渲染，多条折叠为「队列中 N 条」；每行含附件缩略图（图片 40px thumb / 文件图标+名+大小）+ 文本预览；操作（`conversation.updateQueue`）：`edit` 内联编辑（InlineEditor，仅纯文本行）、`remove`、`steer` 纸飞机=**立即送入当前运行回合**（仅 running 时可用）；本地 echo 行显示「发送中」。
- 手机现状：队列卡只能删除。
- 建议：队列卡加「编辑」（点进编辑态保存回写）与「立即生效」（本轮 steer）两个动作；多条时折叠为计数头；行内显示附件缩略图。

### 4. Thinking/Reasoning 折叠行
- 桌面：`ui-chat/src/client/chat/ReasoningRow.tsx:49-112` —「已深度思考 (Think)」折叠行：收起时预览=首行（流式取最近完成段落首行），展开渲染完整 Markdown；流式时 TextShimmer。呈现策略由 `presentation-policy.ts` 控制。
- 手机现状：已实现清单未提及任何 reasoning 展示（需先确认；若完全缺失则此项最高优先）。
- 建议：回合内「已深度思考」折叠行，收起显首行预览、展开显全文；运行中随 `RunningStatus` 联动。

### 5. 计划模式计划文档（exit_plan_mode 的 plan 全文）
- 桌面：`ui-plan/src/client/plan.ts:33-49`（`submittedPlan()` 解析 `args.plan` markdown，title=首个 `#` 标题）；`ui-plan/src/client/PlanCard.tsx:43-60`（`PlanCards` 挂 turnTail：回合尾渲染计划文档卡，点击 `openPlan` 侧栏看全文）；`PlanCard.tsx:72-83`（`PlanReviewOpen`：审批中自动打开一次 +「查看完整计划」链接）。
- 手机现状：审批卡显示参数+diffs，plan 长文很可能以参数原文出现，不便阅读决策。
- 建议：exit_plan_mode 审批卡内嵌 markdown 渲染的计划全文（折叠展开），批准后回合尾留「计划文档」卡可回看。

### 6. 回合错误 / 中断原因行
- 桌面：`ui-chat/src/client/conversation-nodes/turn-error.ts:36-51` — error→错误消息；aborted+`deepseek-account/signed-out`→「Stopped because you signed out of DeepSeek.」(ACCOUNT_SIGNED_OUT)；interrupted→「The DSH process exited before this turn finished.」(INTERRUPTED)。渲染 `MessageItem.tsx:132-148`（`TurnErrorItem`，terminal 错误行+code chip）。另有 `MessageItem.tsx:63-131`（`ModelRetryItem`：模型重试倒计时+可展开 delay/失败原因）与 `MessageItem.tsx:149-178`（`TurnMaxTokensItem`：max-tokens 截断提示）。
- 手机现状：清单未提及错误/中断/重试呈现。
- 建议：回合尾显示终止原因行（失败消息/已停止/进程退出/账号登出）、重试倒计时行、max-tokens 提示；手机断网重连场景下尤其高频。

---

## P1 — 明显缺失

### 7. 回合尾交付物卡（changed-files + presented files）
- 桌面：`ui-deliverables/src/client/Deliverables.tsx:56-130`（`DeliverablesTail` 挂 turnTail：回合结束时匹配 changed-files 公告与 `present` 声明文件；ChangedFiles 卡点击进 diff review；presented>4 折叠「全部 N」；`PresentedFileCard` 预览/打开）；`PresentRow.tsx:31-58`（present 工具行：状态+文件名列表）。
- 建议：回合尾附件区：「变更 N 个文件」卡（点击按文件看 diff）+ 交付文件卡（>4 折叠）。diff 复用审批卡已有的 diff 渲染。

### 8. 消息反馈（👍/👎 + 反馈对话框）
- 桌面：`ui-message-feedback/src/client/MessageFeedbackActions.tsx:26-119` — 每条已结算助手消息动作行内的 Like/Dislike；点击未记录项打开反馈对话框（分类+文字），点击已记录项撤回；`FeedbackDialog.tsx`（128 行）。受 `useAccess('messageFeedback/put')` 门控。
- 建议：回合尾动作区加 👍/👎；点开简单对话框（好/差 + 可选文字）。

### 9. 回合触发归属头（为什么这一轮开始了）
- 桌面：`ui-chat/src/client/chat/TurnTriggerNodeView.tsx:30-57` + `turn-trigger.ts:35-88` — 回合上方可折叠 section：goal 续跑 / agent-message / team-message / subagent-settled（completed/aborted/error/max-tokens/refusal）/ webhook（github 区分）/ schedule / tool-jobs / 插件 runner / request；展开看原始通知；retry 续跑回执为紧凑单行「Continuation requested」。
- 建议：手机端 goal 与定时任务都能触发回合，至少渲染一行触发来源标签（🎯goal / ⏰schedule / 🤖子代理结束 / webhook），可展开看通知内容。

### 10. 会话级统计 pill（Activity + Usage）
- 桌面：`ui-chat/src/client/chat/StatsPills.tsx:251-294`（ActivityPill：`N turns · M steps · X tok/s`，点击 Dialog 看 LLM 时间/工具时间/平均 TTFT/速度）；`:297-348`（UsagePill：全会话总 tokens·缓存命中%，Dialog 分桶 input/cacheRead/cacheWrite/output）。
- 手机现状：只有每轮 usage。
- 建议：对话页顶栏或 ≡ 菜单加一个统计入口：回合数/步骤数/速度/全会话 token 分桶+缓存命中率。

### 11. 每轮用量分解（模型路由 + reasoning tokens）
- 桌面：`ui-chat/src/client/chat/TurnUsagePanel.tsx:31-110` — 每轮「已消耗 N」pill，Dialog 含 model routes（provider/model）、cacheHit%、四桶精确 tokens，output 行附 reasoning tokens 子标注。
- 建议：现有每轮 usage 展开时补模型路由与 reasoning tokens 两行（数据同源）。

### 12. 发送中 echo（乐观 UI）
- 桌面：`MessageItem.tsx:277-331`（`PendingSubmissionBubble`）+ `MessageItem.tsx:244-276`（`PendingSteeringBubble`）— 本地立即渲染用户消息（含附件），被服务端行替代；队列侧另有「发送中」禁用行（QueueDock）。
- 建议：点发送立即上屏（半透明/发送中标记），失败标记可重试；弱网体验差异明显。

### 13. 回合组头部状态与时长
- 桌面：`TurnProcessNodeView.tsx:18-33` — 回合闭合后组头按钮：`Took X`（正常）/ `Worked`（无时长）/ `Stopped`（aborted/interrupted）/ `Failed`（error），可折叠展开步骤明细；`data-turn-process-*` 带 message/tool/subagent 计数。
- 建议：手机「✓ N 步」行扩展为「✓ N 步 · Xs」，停止/失败时换图标与文案，点击展开步骤明细（已有两级展开可复用）。

---

## P2 — 锦上添花

### 14. 回合刻度轨（TurnNavigator）
- 桌面：`TurnNavigator.tsx:233-295` + `turn-rail-items.ts:63-89` — 右侧竖排每回合一刻度（virtualized），hover/focus 出 prompt/response 预览，点击跳转（未加载先分页）。
- 建议：手机右缘细刻度条或底部长按呼出「跳到第 N 轮」；优先级低（已有查找）。

### 15. 上下文压缩标记行
- 桌面：`CompactionItem.tsx:31-76` —「上下文压缩 · 已折叠 N 项 · M tokens」折叠行，可展开压缩摘要 markdown；手动 `/compact` 由 `CompactionCommandCard.tsx:13-26` 融合命令卡与标记。
- 建议：压缩发生后对话内插入一条可展开的分隔行（数量+tokens+摘要）。

### 16. 上下文注入行 / 系统提示行
- 桌面：`ContextInjectionRow.tsx:31-94` —「已注入上下文 · 生产者」折叠行（skill 目录/workspace 指令/召回会话），工具增减单独摘要「+N 工具」；`SystemPromptRow.tsx:25-50` — 完整系统提示折叠行。
- 建议：verbose 模式下显示这些折叠行；默认可隐藏。

### 17. 命令回执卡
- 桌面：`GenericCommandCard.tsx:29-75` — 命令名 + 结算文本摘要（running/ok/error 三态）+ 多行输出可展开 `<pre>`；`CommandNodeView.tsx:13-24` 按 command name 分发特化卡。
- 建议：斜杠命令执行后在对话内留一行回执（名称+结果，可展开输出）。

### 18. 用户消息引用 chip / 技能标签
- 桌面：`MessageItem.tsx:179-243`（`UserStyleBubble`：`referenceLabels` @session 引用、`skillNames` 技能名标签、`previewAttachments` 附件预览）；`ui-reference/src/client/FileReference.tsx:28-71`（文件/目录 chip，点击打开）。
- 建议：用户消息内 @引用 与技能名渲染成 chip 而非裸文本。

### 19. Fork 继承历史分隔
- 桌面：`MessageItem.tsx:383-396`（`InheritedHistoryNodeView`）— fork 会话顶部「继承历史」分隔行。
- 建议：fork 会话顶部一条「⟲ 继承自原会话」分隔线即可。

### 20. 数学公式 / diff fence 渲染
- 桌面：`fence/FenceLayers.tsx:21-33` — `math` fence 结算后渲染 TeX（流式期间显示源码），`diff`/`patch` fence 渲染 unified-diff 行。
- 建议：确认手机 markdown 管线支持 KaTeX 与 diff 高亮；不支持则补。

### 21. 文本选择浮动操作条
- 桌面：`text-selection.ts:1-180` + `text-interaction.ts:1-40` — 划选可见文本出浮动操作条（复制等），带跨块/表格投影文本算法。
- 建议：手机已有系统长按选择，可低优先适配「引用到输入框」动作；P2。

### 22. 限额 Toast
- 桌面：`QuotaNoticeHost.tsx:14-27` — shell.overlay 级 quota toast（可被插件替换）。
- 建议：手机端加同款一次性 toast 即可。

### 23. 审批卡命令行解析
- 桌面：`ApprovalCommand.tsx:17-41` — 从关联 Tool call 提取 shell `command` 或 `terminal_send` 的 `text`，在审批详情显示。
- 建议：手机审批卡把 bash 命令参数置顶显示（若已是"参数"展示的一部分则忽略）。

---

## 可忽略（依赖桌面系统能力）

原生通知、多窗口、拖拽（ui-file-drag）、终端面板（ui-sidebar-terminal）、文件树侧栏（ui-sidebar-files）、浏览器侧栏（ui-sidebar-browser）、快捷键（shortcuts）、hover 触发的动作显隐与 tooltip 预览、右侧栏 diff review / 计划全文侧栏（手机用全屏 sheet 等价替代即可）。

---

## 建议实现顺序

1. **P0-1 运行状态行**（活动类别+计时）— 每次运行都看，纯前端投影，`process-activity.ts` 逻辑可直接移植。
2. **P0-2 TODO checklist** — 已有 Plan · n/m 数据源，升级渲染即可。
3. **P0-3 队列编辑/立即 steer** — 已有队列卡与 updateQueue 通道，加两个动作。
4. **P0-6 回合错误/中断/重试行** — 断网与后台被杀是手机常态，先兜住失败呈现。
5. **P0-4 Reasoning 折叠行**（先确认手机是否已有；无则补）。
6. **P0-5 计划文档卡**（exit_plan_mode 全文渲染）。
7. **P1-7 回合尾交付物卡**（changed-files + presented）。
8. **P1-13 回合组头 Took Xs / Stopped / Failed**。
9. **P1-12 发送中 echo**；**P1-10/11 统计与用量分解**；**P1-9 触发归属头**；**P1-8 消息反馈**（依赖服务端 `messageFeedback/put` 权限）。
10. P2 按需求热度排：15 压缩标记 → 18 引用 chip → 20 math/diff → 17 命令回执 → 16 注入行 → 19 继承分隔 → 22/23/21/14。
