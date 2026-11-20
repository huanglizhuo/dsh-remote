# DSH 会话 UI/UX 对齐审计（2026-11-17，对照官方仓库 39163dd / dsh-0.2.2-rc.3）

- 桌面源码：`/tmp/dsh-repo`（github.com/deepseek-ai/deepseek-harness，shallow clone，commit `39163dd3`，2026-11-13）。路径相对 `packages/client/`。
- 手机端：`apps/mobile/app.contract`（1575 行视图）+ `apps/mobile/app.ts`（743 行数据）+ `bridge/lib/index.js`（2105 行 Mac 侧投影）。
- 本报告取代 `docs/chat-parity-audit.md` / `docs/ui-gap-audit.md`（旧审计针对的多数 P0 已落地）。
- 实验性包（voice-input、cot-translation、stats、forge、cua 等）默认关闭、需在插件管理器显式开启，**不纳入对齐范围**。

---

## A. 已对齐（手机端已实现，行为基本一致）

| 桌面能力（路径） | 手机端实现 |
|---|---|
| RunningStatus 鲸鱼+计时+活动类别（`ui-chat/.../RunningStatus.tsx`、`process-activity.ts` 160 字详情） | app.contract:1206-1217；bridge 侧已做活动归类 zh 文案 + runLabel 计时 |
| TodoPanel 计数+清单（`ui-conversation/.../TodoPanel.tsx`） | app.contract:1260-1269（Plan · n/m 可展开 checklist，三态圆点）；todo_write 工具卡 todos |
| QueueDock 编辑/立即 steer/删除（`QueueDock.tsx` L126-138） | app.contract:1238-1259（inline edit / steer 纸飞机 / X）；app.ts:635-636 |
| 计划审批全文（`ui-plan/.../PlanCard.tsx` `submittedPlan`） | 审批卡 exit_plan_mode 显示 plan 文本（app.contract:1270-1290） |
| 回合错误/中断行（`turn-error.ts`、`TurnErrorItem`） | app.contract:1010-1011 错误行、1189-1194 interrupted+resend |
| 上下文压缩行（`CompactionItem.tsx`） | app.contract:1003-1009「折叠 N 项 / +M tokens」 |
| Fork 继承分隔（`InheritedHistoryNodeView`） | app.contract:998-1002 seed 分隔行 |
| 发送 echo（`PendingSubmissionBubble`） | app.contract:1198-1202（半透明 sending） |
| 问句作曲器（`QuestionComposer.tsx` 单选/多选/description） | app.contract:1220-1237；app.ts:622-628 answer/skip |
| 审批卡 Allow once / Deny / Always + 倒计时（`ApprovalCard.tsx`） | app.contract:1270-1290（含「N 秒后回到 Mac」倒计时） |
| 会话统计（`StatsPills.tsx`） | more sheet app.contract:1411-1417（turns/steps/in/out/cache%） |
| 每轮 usage 行（`TurnUsagePanel` 摘要） | app.contract:1187-1188 |
| 命令回执（`GenericCommandCard`/`CommandNodeView`） | app.contract:1300-1302 ✓/✗ 回实行 |
| 斜杠命令建议 | app.contract:1291-1299 |
| 附件上传（`AttachmentRail` 等价） | app.contract:1310-1330 拍照/相册→压缩→/v1/attach |
| 模型+effort 两级（`ModelSelect.tsx`） | app.contract:1341-1369；app.ts:548-578 |
| 权限预设（`ui-permission-presets`） | app.contract:1388-1403 |
| 后台任务列表+kill（`ui-jobs/JobListAction`） | app.contract:1458-1482 |
| 子代理跳转（`SubagentHeaderLineage` 等价） | app.contract:1113-1116（工具卡 openSubagent + more sheet 列表） |
| 会话内查找 / 复制 / 从此分叉（`MessageIconActions`、`TurnTailNodeView`） | app.contract:1371-1387 find；1181-1186 copy+forkFrom(seq) |
| 新建会话选 Workspace、pin/archive、goal 暂停/恢复/清除 | app.contract:929-939、1433-1443 |
| GFM 表格、代码块语言标签、diff fence 着色、图片/画廊 | app.contract:1080-1109（含 scroll-snap 画廊） |
| Markdown 块级渲染（标题/列表/引用/表格/fence） | bridge mdNodes + MdNode 渲染 |
| 流式（text + tools 行） | streaming 合成行 app.contract:441-456 |
| 加载更早分页（take 8→60） | app.contract:984-994；docs/plan-load-earlier.md |

## B. 缺口（按优先级）

### P0 — 忠实度：读到的不等于桌面读到的

1. **Reasoning 折叠行不完整**。桌面 `ReasoningRow.tsx`：每回合「已深度思考」折叠行，收起显首行预览、展开完整 Markdown、流式 shimmer。手机：reasoning 只在 verbose/回合展开时显示，且 bridge 截 1200 字符（bridge index.js）。→ 补：回合内常驻「已深度思考 (Xs)」折叠行（预览=最近完成段落首行），bridge 提高/移除截断。
2. **历史回合富渲染丢失**。bridge 只保留最新 ~6 行完整 detail，旧行降级纯文本 1200 字符（`FULL_ROWS` 分级），工具 args/result/diffs 剥离（`lazy:true` 需按 callId 回捞，14/18 行钳制）。桌面全部富渲染。→ bridge 提高保真窗口 + lazy 回捞结果按节点渲染而非钳制纯文本。
3. **行内 Markdown 被抹平**。bridge `inline()`（index.js:344-351 附近）剥掉粗体/斜体/行内 code/删除线，链接只留 URL。桌面 `ui-primitives/markdown/render.tsx` 全支持。→ bridge 产出行内节点（至少行内 code + 粗体 + 链接），或手机端自行解析行内格式。
4. **问句只支持 questions[0]、无自定义作答、无倒计时**。桌面 `QuestionComposer.tsx`（multiSelect L58 / custom L74 / countdown L27）。手机 app.ts:377-393 只取第一问；无 custom 文本输入。→ 多问分页 + 自定义答案输入 + 倒计时显示。
5. **回合组头状态不全**。桌面 `TurnProcessNodeView.tsx` L21-30：Took X / Worked / Stopped / Failed 四态 + 步骤明细。手机只有「✓ N 步」与 interrupted 文案，无 Failed/Took Xs 秒数。→ 组头补耗时与失败态。
6. **ModelRetry / MaxTokens 行缺失**。桌面 `MessageItem.tsx` `ModelRetryItem` L63（重试倒计时+可展开原因）、`TurnMaxTokensItem` L149。手机无。弱网/限额场景高频。

### P1 — 明显缺失

7. 回合尾交付物卡：桌面 `ui-deliverables/Deliverables.tsx`（changed-files 公告 + present 文件卡，>4 折叠）。手机仅工具卡内 files 列表。
8. 消息反馈 👍/👎 + 反馈对话框（`ui-message-feedback`，受 `messageFeedback/put` 权限门控）。
9. 回合触发归属头（`TurnTriggerNodeView.tsx` + `turn-trigger.ts`：goal/schedule/subagent-settled/webhook 等）。
10. 每轮用量分解（`TurnUsagePanel.tsx`：模型路由、四桶 tokens、reasoning 子标注、cacheHit%）。
11. 引用 chip：@session 引用与技能名标签（`ui-reference/FileReference.tsx`、`ui-skill/SkillReference.tsx` + `user-text-rules.ts`）。
12. math fence（KaTeX）渲染（`fence/FenceLayers.tsx`；桌面流式期间显源码）。
13. SecretText 凭据自动遮罩（`ui-secret-mask`：credential-scanner/formats）。
14. ContextMeter 上下文占用表（`ui-conversation/skeleton/ContextMeter.tsx` + `context-occupancy.ts`）。
15. 工具卡退出码徽记（`ui-tool/models/control-details-model.ts` L84：exit code + status tone）。手机 status 只有 ok/error/unknown/running。
16. 上下文注入行 / 系统提示行（`ContextInjectionRow.tsx`、`SystemPromptRow.tsx`，verbose 下折叠行）。
17. 文本选择浮动操作条（`text-selection.ts`；手机可用「引用到输入框」等价）。
18. Quota toast（`QuotaNoticeHost.tsx`）。
19. Verbose/Compact 呈现策略（`presentation-policy.ts`）：手机已有 verbose 开关，但未按回合结算态自动切换。

### P2 — 锦上添花

20. TurnNavigator 回合刻度轨（`TurnNavigator.tsx`；手机可做「跳到第 N 轮」）。
21. todo 工具卡 diff 视图（`todo-diff-model.ts` + `todo-history.ts`：+新增/更新/移除、未变折叠）。
22. approval 的 ApprovalCommand 命令行置顶（`ui-chat/.../ApprovalCommand.tsx`）。
23. 日期分隔（`use-calendar-day.ts`）。
24. 流式动效对齐（TextShimmer、`flow-motion.ts`）。

### 不对齐（有意，手机范式）

三栏 AppFrame、右侧 dockkit 分屏、终端面板、文件树/文档预览侧栏、浏览器侧栏、trajectory 调试视图、hover 动作条、右键菜单、拖拽上传、快捷键体系 — 按 docs/ui-gap-audit.md §3 维持不抄，用单栏 push / sheet / 长按菜单等手机范式等价替代。

### 桥接层已知限制（影响所有 UI）

- 审批/问句截留依赖「手机 90 秒内活跃」，否则 Mac 先答（bridge index.js:311-350, 376-409）。
- 各处上限：diffs ≤4 文件/60 行、todos 24、options 6、queue 12、jobs 12、行文本 4000/1400/800。
- bridge 侧文案硬编码中文（runLabel、活动类别、错误行），不受 app 语言设置影响。

## C. 建议实施顺序

1. P0-2/P0-3（bridge 保真度：历史富渲染 + 行内格式）— 其余一切渲染改进的地基。
2. P0-1 Reasoning 折叠行；P0-5 组头 Took/Failed；P0-6 重试/max-tokens 行。
3. P0-4 问句多问+自定义+倒计时。
4. P1-7 交付物卡；P1-10 用量分解；P1-15 退出码徽记；P1-13 secret 遮罩。
5. P1-8/9/11/12/14/16/18/19 与 P2 按热度。

---

## D. 实施状态（2026-11-18，P0+P1 全量落地）

代码层全部完成并通过编译验证（`bun exact.mjs contract build` 0 错误、`contract verify` 0 findings、`node --check` bridge 通过；verify 的 3 个 drive 失败均为沙箱 profile-lock 环境限制，非代码问题）。

**P0（6/6 完成）**
1. ✅ Reasoning 折叠行：bridge 截断 1200→8000；手机「已深度思考 + 预览」折叠行（testId `thought-*`），verbose 或点按展开全文。
2. ✅ 历史回合富渲染：FULL_ROWS 6→12、PROJ 4→5；旧行降级改保形（md≤1400+slimNodes、reasoning≤400、tool 卡 lazy、flat≤2400）。
3. ✅ 行内 Markdown：bridge inline() 只替换图片，标记原样下发；手机 text `markup="markdown"` 原生渲染。
4. ✅ 问句多问+自定义+倒计时：QuestionRow.items[] 多问渲染、每问 custom 输入、`{n} 秒后交还 Mac 处理` 倒计时；sendAllAnswers tab 编码批量提交。
5. ✅ 组头 Took/Failed：settled 组头显示耗时（已有 took）+ failed→红色警示三角（testId `failed-*`）。
6. ✅ ModelRetry/MaxTokens：`llm/retry` → 橙色重试行（第 N 次重试/X 秒后）；max-tokens → 「已达到输出上限」错误行。

**P1（13/13：12 原样 + 1 适配）**
7. ✅ 交付物卡（present 文件列表 + changedCount「修改了 N 个文件」，testId `deliverables-*`）。
8. ✅ 消息反馈 👍/👎：bridge 新增 `/v1/sessions/:id/feedback` GET/POST（ctx.get('messageFeedback')，无服务 409）；rateMsg 已选态高亮。
9. ✅ 触发归属头：非 user 来源 → trigger 行（目标续跑/定时任务/子代理/Webhook/队列/系统）。
10. ✅ 每轮用量分解：usageTokens {in,out,cacheRead,reasoning}，展开时「输入 X · 输出 Y · 缓存 Z% · 思考 W」。
11. ✅ 引用 chip：bridge 解析 @路径（≤6、去重）；用户气泡下 document chip 行（testId `refs-*`）。*适配：只读标记，无文件查看器（后续可加 /v1/file 查看屏）。*
12. ✅ math fence：bridge mdNodes 识别 `math|latex|tex|katex` → 居中 mono 卡。
13. ✅ secret 遮罩：bridge maskSecrets()（sk-/ghp_/AKIA/xox/AIza → 前6…后2（已遮蔽）），覆盖 assistant md/reasoning、user、tool result。
14. ✅ ContextMeter：more sheet 统计区「上下文窗口已用 N%」（>85% 橙色，testId context-meter）。
15. ✅ 退出码徽记：bridge `[exit code: N]` → badge `exit N` 红标（既有）。
16. ✅ 注入行/系统提示行：>500 字注入 → injection 折叠披露卡；`system/message` → sysprompt 折叠卡（均 toggleProcess 展开，testId `injection-*`/`sysprompt-*`）。
17. ✅（适配）文本选择引用 → Quote 按钮（移动端无选区事件，`> 引用` 前缀进 draft 等价）。
18. ✅ quota toast：error 行匹配配额关键词 → session.quota → 红色 toast（点按消失）。
19. ✅ verbose/compact 呈现策略：verboseLive = verbose or snap.running（运行中自动展开，结算后回落）。

**下一步（可选）**：重启 Mac 侧 bridge 后 `bun exact.mjs share` 真机验证；P2 四项；引用 chip 加文件查看屏。

### P2（2026-11-18 第二轮，5/5 完成）

20. ✅ TurnNavigator：composer 上方「回合刻度轨」（横向 scroll，每已加载回合一枚数字 chip，tap → scrollIntoView 该回合 prompt，testId `turn-rail`/`turn-N`；aria-label t("chat.jumpTurn")）。*适配：无虚拟轨/预览气泡。*
21. ✅ todo 工具卡 diff：bridge 逐 todo_write 卡对照前一写入（todo-diff-model 语义：added/updated/removed/unchanged），＋绿/－红(淡出)/橙=更新，卡头 todoSummary（`+N · 改 M · 删 K`/`无变化`，testId `todosum-*`）。
22. ✅ ApprovalCommand 置顶：bridge 解析关联调用的 command/text，审批卡顶部 mono 命令行（testId `approval-cmd-*`）；倒计时行改 i18n。
23. ✅ 日期分隔：bridge 按行本地日变化打 day 标签（今天/昨天/前天/M月d日[跨年加年份]），transcript 插入 hr+日期+hr 分隔（testId `day-*`）。
24. ✅ 流式 shimmer：流式文本行 pulse 动效（prefers-reduced-motion 关闭；TextShimmer 的等价降级）。

验证：contract build 0 错误、contract verify 0 findings（26 suggested properties）、d.ts 重生成、bridge node --check 通过；verify drive 失败仍为沙箱 profile-lock 环境限制。

## 会话列表排序对齐（2026-11-18 第二轮）

对齐桌面 `ui-workspace` 默认视图（groupBy=workspace / orderBy=updated / archivedFilter=default）：
- bridge `callList(showArchived)`：过滤 subagent 子会话与 blank 占位（桌面 sessionVisible 规则）；归档会话默认隐藏，`archived=show` 混入；组内排序 = 置顶领先 → updatedAt 降序（updatedAt=max(createdAt,lastPromptAt)）→ sessionId 升序 tie-break；组顺序 = workspace registry 顺序，未入组会话归“未分组”尾组（group='' 由手机本地化）。
- 手机端：Settings 增加“显示已归档会话”开关（showArchived persist），loadLive 传 `archived=show`；listRev 指纹随过滤集变化，切换后下一次 poll 自动全量回传；归档行标题置灰；组头未分组显示 t("list.ungrouped")。
- 已知差异（有意）：桌面 manual 拖拽排序/归档 only 视图未做（手机无拖拽）；archivedFilter 只有 default/show 两档。

## 第五轮复审：剩余差距与值得加入的能力（2026-11-18）

前置状态：P0 6/6、P1 13/13（2 项移动适配）、P2 5/5、列表排序对齐、配对失效自愈、扫码自动配对、返回手势修复均已落地。以下为复审后仍值得做的内容，按价值排序。

### A. 会话内查看器（数据大多已过桥，只差查看 UI）
1. **文件查看屏**（高价值）：引用 chips、工具卡 files、交付物卡目前是只读文本。bridge 已有 /v1/file 路由可取文件内容/图片 —— 点 chip/文件名打开查看屏（文本高亮或图片全屏）。对应桌面 ui-sidebar-documentpreview / ui-file-actions。
2. **Diff 查看增强**：>4 文件折叠、"显示全部"；行内 +/- 着色已有但无语法高亮；对照桌面 CHAT_DIFF_MAX_LINES=9 的展开行为。
3. **图片全屏查看器**：gallery/工具图点开全屏 + 双指缩放（现 scroll-snap 缩略）。
4. **单回合 Reasoning 全文**：reasoning 已放宽到 8000 字，但展开仍受全局 verbose 控制；改为逐回合展开（桌面 ReasoningRow 行为）。

### B. 管理面（桌面侧栏/设置对应物，需新增 bridge 路由）
5. **定时任务管理**（ui-schedule）：手机现在只有 trigger 行；桌面有任务列表/创建/启停/RRULE 编辑。bridge 需加 /v1/schedules CRUD（ctx.get('schedule')）。
6. **子代理树 + 团队任务板**（ui-agent-team / ui-trajectory / list_agents）：手机仅有 subagent 跳转；可做会话内 agent 列表 + send_message 续谈 + team_task 看板。
7. **Workflow 运行查看**（ui-workflow-run WorkFlowRunPanel）：运行中 workflow 的阶段/子代理结果流。
8. **反馈 note/类别**（FeedbackDialog）：👍/👎 已有；长按弹出 note 输入 + category 选择（put 已支持）。
9. **统计深挖**（stat-dialog）：tokens 曲线、cache 命中率时序；手机 stats 是静态四项。

### C. 输入与附件
10. **非图片附件**（ui-attachment/file-upload）：PDF/文档发送；bridge /v1/attach 通道已在，手机端缺文件选择器。
11. **@ 引用补全**：composer 输入 @ 时列出工作区文件/skill（桌面 user-text-rules 的输入侧）；现在只有事后 chips。

### D. 状态与通知
12. **回合完成通知**：前台轮询到 running→settled 时本地通知/横幅（后台推送需原生基建，暂缓）。
13. **会话同步状态徽标**（ui-session-status）：linkStale/authStale 已有，可细分 syncing/offline/backfill。

### 有意不做（桌面形态专属）
侧栏终端/文件树/拖拽/快捷键/三栏布局/plugin market/完整设置页族（ui-settings-*）。

### 建议顺序
A1 文件查看屏 → B5 定时任务 → A4 reasoning 全文 → B8 反馈 note → C10 附件 → B6 子代理树。

## 第六轮实施（2026-11-18，复审建议 A1/A2/A4/B5/B6/B8/C11/D12 落地）

已完成（代码+编译+contract verify 0 findings；APK 已装机，待 DSH 重启加载新 bridge 后真机验证）：
- **A1 文件查看屏**：新路由 `GET /v1/sessions/:id/file?p=`（bridge，按会话 cwd 解析相对路径；≤2MB；图片→data URL，文本类→utf8，其余→binary 提示）；手机新 `viewer` 页（文本 mono 滚动/图片 contain/二进制与缺失态），交付物文件与引用 chip 点击进入。
- **A2 diff 增强**：diffFiles 4→8 文件、60→120 行；新增 `diffHidden`（"还有 N 个文件"行，t diff.moreFiles）。
- **A3 图片全屏**：会话内图片/画廊图片点击 → viewer 全屏（object-fit contain）。
- **A4 单回合 reasoning**：确认既有 thoughtPreview 折叠行 + toggleProcess 展开（reasoning 块完整渲染）已覆盖，无需改动。
- **B5 定时任务**：新路由 `/v1/schedules`（GET 列表 / POST 创建 / :id/run / :id/edit{title,prompt,active,timing} / :id/delete，svc=ctx.get('schedule')，缺失时 409）；手机新 `schedules` 页（列表+启停+立即运行+删除+新建表单，timing 走 JSON），more sheet 增入口。
- **B6 团队任务板**：bridge 在 /v1/live 附 `session.team`（pv.agentTeam.tasks ≤20，subject/status/owner）；more sheet 内 Team board 分节（completed/in_progress/pending 三态图标）。子代理树维持既有跳转（子会话可直接打开续谈）。
- **B8 反馈 note**：rateMessage 加第 6 参 note；👎 改为打开 note sheet（textarea + 发送/取消，testId note-sheet）。
- **C11 @ 补全**：composer 输入 `@词` 时按会话标题联想（≤6 个 chip，点击补全，testId mention-row）。
- **D12 完成提醒**：`task doneWatch key=snap.running → checkDone` 检测 running→false 边沿，显示 "本轮已完成" toast（4s 自动清除，`task toastClear after(4000,…)`）。原生推送通知不做（Exact 无通知 API，需 notification-service-extension）。
- **B7 workflow 查看 / B9 统计深挖 / C10 非图片附件 / D13 状态徽标**：未做（B7 数据源为运行中 workflow 事件流，需 bridge 增量投递；C10 需上传端支持任意 MIME；D13 桌面为 tab 徽标+状态栏，移动端已有 running 脉冲，价值低）。留待下轮。

适配决策：@ 补全数据源为会话列表（桌面是文件/skill/会话混合，移动端无工作区文件索引）；viewer 不做编辑。
## 第七轮增量（等待 DSH 重启加载新 bridge 期间完成）

- **B7 workflow 编排查看**：已落地。bridge 在 transcript 事件流中折叠 `tool-workflow/run-start|agent-start|agent-end|run-end` 四事件为单张 workflow 工具卡：label=`编排 <name>`（run-end 非 completed 时附 stopReason），成员列表复用 todo checklist UI（进行中◐/完成●/失败◐✗，≤24 项），状态 ok/error/running 与桌面 WorkflowRunPanel 对齐。
- **B9 统计深挖**：已落地。more sheet 统计区新增"平均每轮 tokens"（(in+cache+out)/turns，千位缩写）。
- **C10 非图片附件**：继续顺延。原因：DSH prompt wire 只收 text/image，文件必须经 fileUploads 服务按 Agent 分阶段 staging 换 receiptId 再入 prompt（session-controller commands.ts resolvePromptFileReceipts），桥侧无法安全伪造；需先在桌面端验证 staging 流程。
- **D13 状态徽标细分**：继续顺延。原因：会话列表错误态需要 per-session 的 lastError 投影，callList 的 registry 投影不含该字段，需上游新增投影。

## 第八轮：iOS 模拟器端到端验证（2026-11-18）

真机断开后改用 iOS 模拟器（DSH Mobile，`bun exact.mjs ios` + `bun exact.mjs agent ios --sim <udid>`，深链配对走 loopback /v1/pairing）验证：

- ✅ **transcript 富渲染**：大会话（27 rows/take=2）bash 工具卡、turn-rail、deliverables 卡、injection/trigger 行均出现。
- ✅ **A1 文件查看屏**：在本会话 present 文档制造真实交付物 → 点交付物文件 chip → viewer 页渲染全文（file-name/file-text）。发现并修复 bug：openFile/openImage 原先 `push(go(nav,"/"), path("viewer"))` 清掉了栈中 chat 条目，导致 `derive selected`（从栈中 chat 参数取 id）为空、请求发到 `/v1/sessions//file`；改为 `push(nav, path("viewer"))` 后正常，且返回手势回会话而非列表。
- ✅ **B5 定时任务**：模拟器创建「日报提醒」daily 任务 → Mac 侧确认真实 schedule（nextAt 次日 09:00）；发现两个 bridge bug 并已修（见下）。测试任务已删。
- bridge 修复（已写入文件，**需下次 DSH 重启生效**）：
  1. schedules edit/delete 需 `expectedUpdatedAt`（否则 409 schedule_conflict）——现自动先 list 查当前 updatedAt（或用 body.updatedAt）。
  2. timingText 兼容 ScheduleRecord 扁平形状（daily 记录是 {kind,time,timeZone} 而非 {kind,daily:{...}}），此前显示「每天  ()」空值。

### 待下次重启后复核
- schedules pause/edit/delete（修复后）；team board（需有 agentTeam 的会话）；workflow 编排卡（需 workflow 运行）。

### 第八轮补充验证（同日）
- ✅ **B7 workflow 编排卡**：在本会话真实运行两阶段 workflow（verify-workflow-card，2 agents）→ transcript 出现 `wf-<runId>` 折叠卡：label「编排 verify-workflow-card」/ status ok / 成员清单「one · step-one ✓completed」「two · step-two ✓completed」。事件源为 tool-workflow/run-start|agent-start|agent-end|run-end。
- **B6 team board**：渲染代码就绪（/v1/live 附 session.team），但当前无带 agentTeam 投影的会话可验证——待真实团队会话出现后复核。

### B8 修复（第八轮）：反馈 target 修正
真机 👎 note 流程发现 `target-not-found`：messageFeedback.put 的 messageId 必须是 DSH 消息 UUID（`deriveEventMessage(event).id`），而非事件 seq。已修：bridge assistant 行携带 `msgId`（合并回合保留最后一步的 id），feedback POST 接受 `body.id`（字符串 UUID，兼容旧 seq）；手机端 MessageRow.msgId 贯通，👍/👎/note 全部改用 msgId。离线 mock 验证：合并回合 msgId=msg-uuid-2、POST {id} → svc.put 收到正确 target。（运行中 bridge 为旧模块，重启后真机生效。）

### D12 验证说明（第八轮）
done-toast 为 `wasRunning → not snap.running` 边沿触发 + 4 秒自动清除。两次 iOS 驱动尝试（Ping 会话真实 prompt）未在驱动轮询窗口内捕获到 toast 展示帧（回复完成时机与 2.5s 采样步长错开）；逻辑代码路径简单，待日常使用中自然复核。

### 终验（重启后，goal-09734780 收尾）
- ✅ **B8 反馈**：iOS 真机 👎→note 输入→发送，Mac 侧 messageFeedback.list 确认落库（negative + note）后清理。msgId 全链路（bridge 合并回合 → wire → 合同）工作正常。
- ✅ **B5 schedules**：真实服务全链路——create（daily 21:30）→ list（timingText「每天 21:30 (Asia/Shanghai)」）→ edit+pause（改名+status paused，无 409）→ delete（list 清空）。
- 顺带修复：feedback GET list 需解 Remote 服务 {ok,value} 包装（文件已改，下次重载生效；手机端当前不用 GET）。
- 终态：A1/A2/A4/B5/B7/B8/B9/C11 真机或真实服务验证；A3 受当前模型无图片输入限制（viewer 基建与 A1 共享已验证）；B6 子代理跳转已有+team board 渲染就绪（无 agentTeam 会话数据可验证）；C10 上游 prompt 仅支持 text+image；D13 移动端以 running 脉冲等价呈现（有意）；D12 边沿逻辑就绪待自然复核。

### Android 真机验证（goal-09734780 补充）
- ✅ 反馈 👎→note→发送：Android 真机全流程，Mac 侧落库确认（negative+note）后清理。
- ✅ Schedules：Android UI 创建（每天 22:00）→ 暂停 → 删除，服务端确认全部生效。
- 修复 1（bridge，commit be6cc52）：`svc.list` 返回 Remote `{ok,value:{items}}` 包装，`currentUpdatedAt()` 取不到 → 设备端暂停/删除 409 schedule_conflict；已解包（下次 bridge 重载生效；设备端同时补发 `updatedAt`，两者冗余兜底）。
- 修复 2（app.ts）：deleteSchedule 结果需符合合同 Reply 形状 {ok,error}（post() 的 data 字段会被 mutation 拒绝，`then` 不执行）。
- 工程教训：Exact mutation 的 send 结果必须精确匹配 shape，多余字段（如 data）= 回答被拒、静默不生效；agent drive 相邻 tap 需给足间隔（6s+），否则资源未刷新 target 不存在。

## 第九轮（2026-11-18/19）：对照官方 rc.3 / rc.4 的整轮对齐

范围：`docs/session-parity-audit.md` 之前各轮之后，对官方仓库（rc.3 为手机所连的 Mac 实际运行版本，latest master 为 dsh-v0.2.2-rc.4）逐项复审出的缺口，共 P0 14 项、P1 若干组、OPT 7 项，分六个波次落地（W1 bridge 与手机并行，W2 交互卡，W3a/W3b 转录结构与呈现，W4 工具卡与 Markdown，W5 输入框，W6 回合尾、会话管理、遗留与文档）。实现一律只依赖 rc.3 里确实存在的事件、字段与服务；缺服务或缺投影时降级，不抛异常。状态用「完成 / 部分 / 未做」表示，原因写在右列。接口与线格式的权威说明在 `bridge/README.md`（本节只做指针）。

### P0：行为错误或与官方相反

| 编号 | 项 | 状态 | 落地与说明 |
|---|---|---|---|
| P0-1 | 「始终允许」= 永久自动拒绝 | 完成 | 工具审批只剩「拒绝 / 允许一次」，`setPolicy('never')` 整条路径删除；仅「问句意图」审批在官方给出 `always` 时才显示（W1、W2）。 |
| P0-2 | 手机只在轮询该会话时才收到审批与问句 | 完成 | `client.js` 订阅桌面的 `uiSession.pendingInteractions` 并镜像到 bridge（`/v1/desktop/*`），手机与 Mac 看到同一批对象、谁先答谁算；桌面不在线时 bridge 自己持有请求直到手机作答或宿主 abort（不再按计时交还）；列表行带 `attention` 徽标（W2）。 |
| P0-3 | ask_user_question 语义 | 完成 | 倒计时、继续（continued）与迟到回答沿用宿主服务（`userQuestions.answer`），「慢慢回答」即 `takeTime`；不再有 bridge 自己的 120 s 持有（W2）。 |
| P0-4 | 计划审阅未按官方呈现 | 完成 | `plan-review` 问句渲染为「计划待审」卡：标题、首段、查看完整计划，「同意执行 / 要求修改」（W2）。 |
| P0-5 | 带参数的斜杠命令被当成聊天文本 | 完成 | 走 `commands.execute(agent, '/name input', [], signal)`；W5 订正了与 rc.3 签名不符的旧调用（W1 B4、W5）。 |
| P0-6 | @ 提及只是纯文本 | 完成 | 发送时规范化为 `@[label](dsh-session:<base64url(JSON id)>)`，label 按官方 `escapeLabel` 转义（W1 A12/B5、W5 E6）。 |
| P0-7 | 运行中展开所有历史回合 | 完成 | 只展开开放中的回合（W1 B2、W3a C3）。 |
| P0-8 | 合成的流式行上出现尾部动作 | 完成 | 复制 / 引用 / 赞踩 / 分叉只出现在已结算回合（W1 B3）。 |
| P0-9 | 插话拆分回合 | 完成 | 按 inbox 认领把插话归入所在回合的 `steer` 块（W3a T1）。 |
| P0-10 | 上下文 / 触发行误分类 | 完成 | 按官方 source kind 区分 trigger 行与 context 行，压缩检查点与替换面事件不成行（W3a T2）。 |
| P0-11 | 统计只数已加载窗口；上下文表读不存在的投影 | 完成 | 统计读 `sessionStats` + `tokenUsage`，上下文读 `contextPressure`（W1 A4、W3b T10）。 |
| P0-12 | 「修改了 N 个文件」按调用数 | 完成 | 先按唯一文件计（W1 A5）；W6 起优先用宿主 `workspace/changes` 摘要（git 快照，含 shell 改动），无摘要时才退回工具调用。 |
| P0-13 | 子智能体子会话可发消息 | 完成 | 一次性 / 未知模式只读；可继续（continuable）的子会话经宿主的子智能体运行时发送（见 G2，W6 核实 rc.3 源码后实现）。 |
| P0-14 | 会话列表顺序 / 子会话泄漏 | 完成 | 列表 = `callList` 可见行按其顺序（W1 A3）。 |

### P1：核心能力

| 组 | 项 | 状态 | 落地与说明 |
|---|---|---|---|
| 回合结构 | 步骤分组与回合头 | 完成 | 分组标题取前三类（并 / ， / 等），回合头「已完成，用时 X · N 次工具调用…」（W3b T4）。 |
| 回合结构 | 跟随 Mac 的呈现设置 | 完成 | 读宿主 `settings` 服务（`ui-chat` / `ui-conversation`），回退读 profile patch（只读）；设置页「工作步骤展示」跟随 Mac / 简洁 / 标准 / 详细 / 完全展开（W3b T5）。 |
| 回合结构 | 实时过程、流式 reasoning 与 Markdown | 完成 | 「正在X · 详情 / 准备X」、实时思考块、流式文本按节点渲染（W3b T6）。 |
| 回合结构 | 压缩状态、命令卡、重试行、失败分类 | 完成 | `正在压缩…`、`执行中 / 已完成 / 指令失败`、重试倒计时、AUTH 不回显等官方文案（W3a T7–T9）。 |
| 回合结构 | 用量面板与统计 | 完成 | 官方 `TurnUsagePanel` 行与模型 / 工具用时、TTFT、TPS（W3b T10）。 |
| 回合结构 | 回合导航「加载并跳转」、用户图片 | 完成 | 导航轨列出全部回合，未载入的回合逐步加载后滚动到位（W3b T11）；用户消息图片作为块显示（W3a T3）。 |
| 交互卡 | 审批卡 | 部分 | 输入框位置的卡片、拒绝 / 允许一次、关联命令详情、本地化的原因已做；官方的风险警示文案未单列。 |
| 交互卡 | 问句卡与问答回放 | 完成 | 分页、跳过、推荐、整组放弃、错误态，工具行 n/m 已回答与「问题与回答」气泡（W2）。 |
| 输入框 | 主按钮变形、继续生成、busy 默认值 | 完成 | 停止 / 插话发送 / 排队发送 / 继续生成（空内容 prompt）；默认值跟随 `busyEnter`（W5 E1、E2）。 |
| 输入框 | 计划模式、目标栏 | 完成 | 计划 chip、目标条（进行中 / 待继续 / 已暂停 / 受阻、轮次、编辑）（W5 E3、E4）。 |
| 输入框 | 命令选项弹层 | 部分 | `/permission`、`/model` 打开手机页，`/file` 打开选择器；其余命令的选项弹层未做——rc.3 的命令描述没有选项数据（W5 E5）。 |
| 输入框 | @ 菜单、附件、草稿、上下文表 | 完成 | 文件 / 文件夹 / 会话 / 子智能体，技能走 `/name`；多图与文件（走 `fileUploads`）；按会话草稿；上下文占比与系统 / 工具 / 消息分解（W5 E6–E8）。 |
| 工具卡 | 本地化标题、分视图、完整结果、diff、todo 对比 | 完成 | 约 70 个标题；terminal / read / search / web / diff / image / 详情卡；调用详情路由最多 64 KB（W4 K1–K3）。未做：`cordis_*`、workflow、ralph、`session_*`、lsp 的专用详情卡（用通用卡）。 |
| Markdown | 表格、任务列表、嵌套、代码、数学、文件链接、缩放 | 完成 | 表格网格、代码标签与复制、JSON 缩进、文件链接进查看器、查看器双指缩放（W4 K4–K6）。内联 `$…$` 以代码样式显示，未渲染 KaTeX；语法高亮覆盖 js/ts/py/sh/json/go/rust/swift/java/c。 |
| 回合尾 | 消息反馈 | 完成 | W6 F1：官方对话框（七个分类、详情、「提交内容会包括当前对话的日志」）、取消标记、冲突与过长的官方文案、感谢提示；打开会话时载入已有评价。写入前先读条目当前 `version`（旧实现总发 `ifVersion: null`，改评分会冲突）。 |
| 回合尾 | 交付物 | 完成 | W6 F2：「已编辑 N 个文件 / 已编辑 {name}」卡，逐文件 +/-，超过 4 个折叠；点文件进入该回合该文件的对比页（宿主 `workspaceChanges.diff` 的真实 hunk，无摘要时用本回合工具 diff）；`present` 的文件做成卡片，点开进查看器。 |
| 回合尾 | 在 Mac 上打开 / 在访达中显示 | 完成 | W6 F3：`sessionController.openWorkspacePath`；查看器、交付物卡、对比页、会话信息均有入口；仅限工作区与临时目录，会运行的文件类型（脚本、`.app`、安装包…）只允许「显示」。 |
| 会话管理 | 列表徽标 | 完成 | W6 G1：未读 / 运行出错（官方 `sessionStatus` 记录；手机查看会话即经宿主 `mark` 标已读，Mac 侧栏圆点同步消失）、运行中的子智能体数；叠加 W2 的 `attention`。 |
| 会话管理 | 子智能体 | 完成 | W6 G2：嵌套树（三层）、模式（一次性 / 可继续 / 外部）、运行 / 已完成 / 未运行、token 与活跃时长、进度计数行；子会话头部面包屑；可继续的子会话可发消息与停止。 |
| 会话管理 | rc.4 会话面板、任务输出 | 部分 | rc.3 没有会话面板（rc.4 才有）；手机的「更多」页给出环境（工作目录 + 在 Mac 上打开）、子智能体树、团队任务板、后台任务；W6 G3 新增后台任务输出（`jobs.readAt` 的末尾，不移动模型游标）。 |
| 会话管理 | 定时任务 | 完成 | W6 G4：列表显示官方状态（已开启 / 已暂停 / 已结束，已过运行时间一分钟以上且未在投递的显示「已到期，等待会话恢复」；「等待触发」是官方对话卡片里单次投递的状态，任务管理页与详情页没有这一状态，它就是「已开启 + 下次运行」）、人话版规则与下次运行（取计划时间与投递冷却结束的较晚者）；任务页用字段编辑（仅一次 / 间隔 / 每天 / 每周 + 时间 + 时区），不再填 JSON；暂停 / 恢复 / 立即运行 / 删除（二次确认）；拒绝原因用官方文案。未做：月度与自定义（cron / RRULE）规则的编辑——这类任务可读、可暂停，保存时保持原规则；rc.4 的「推荐」未做（rc.4 才有）。 |
| 会话管理 | 后台推送 | 未做 | W6 G5：Exact 有 `@exact/notifications`、`@exact/background`、`@exact/push`，但本仓库用不了，缺什么见下面「推送为什么没做」。 |

### OPT：工程项

| 编号 | 状态 | 说明 |
|---|---|---|
| OPT-1 轮询 | 完成 | 手机按 0.7 s / 2.8 s 自适应；bridge 对 (会话, take) 缓存投影、并发冷启动共享一次计算、每个请求只调一次 `sc().list`（W1 A10、B7）。 |
| OPT-2 Markdown 解析 | 完成 | 块级解析器重写（任意长度围栏、缩进代码、数学、表格、setext、混合 / 松散列表、CJK 加粗）并有 `bridge/test/markdown.test.mjs`（W4 K6）。 |
| OPT-3 `lastCalls` 单例 | 完成 | 每会话调用索引（16 个会话 × 400 个调用），详情路由不再因多设备串号 404（W1 A7）。 |
| OPT-4 国际化 | 完成 | 手机侧文案全部走 `t()`（W1 B9）；bridge 侧用 `lang` 参数选语言表（W3 起）；W6 收尾：相对时间用官方 `time.*` 词（刚刚 / 4分钟 / 2小时 / 3天，now / 4min / 2h / 3d）、定时规则与状态、workflow 卡、子智能体与任务状态词、拒绝语、`/pair` 页（按 `Accept-Language`）、桌面面板（按 `navigator.language`）；密钥遮蔽改为官方的 `*` 号（不含文字）。证明：`scratchpad/agents/w6/t-bridge.mjs` 第 L 段对 `index.js` 的 zh 表之外、`client.js` 的 `ZH` 表之外 grep CJK，只剩两处解析用的正则字面量（`RECOMMENDED`、`@` 提及的分隔符集合）。 |
| OPT-5 安全 | 完成 | 文件路由按会话工作区与临时目录收口（真实路径判断）；`_try / _ask / _svc` 仅回环；AUTH 失败不回显；`maskSecrets` 移植自 `ui-secret-mask`，W6 改成官方的 `*` 遮蔽；「在 Mac 上打开」同样收口并拒绝会运行的文件类型；`/v1/health` 的宿主版本与能力只给带 token 或回环调用者。 |
| OPT-6 读宿主设置 | 完成 | 见 P1「跟随 Mac 的呈现设置」（W3b T5）。 |
| OPT-7 版本漂移 | 完成 | W6 O7：`BRIDGE_API = 11`（线格式修订号），`/v1/health` 带 `api`、宿主版本 `dsh`（读包清单，未知为空）与 `caps` 能力表；`/v1/live` 带 `bridge:{api, open}`；手机在 bridge 比自己旧（不带修订号或更小）时在列表页提示「请在 Mac 上重载插件」。所有依赖宿主服务 / 投影的功能先检测再用，缺失则不提供或回退。 |

### 推送为什么没做（G5）

Exact 有三块相关能力：`@exact/notifications`（本地通知、角标、点击跳转）、`@exact/background`（周期性后台同步，最快约每 15 分钟，由系统决定何时唤醒）、`@exact/push`（经 APNs / FCM 的可见推送，由应用自己的服务器发送）。本仓库当前用不了，原因是：

1. `apps/mobile/package.json` 没有这三个依赖；加依赖（`bun exact.mjs add notifications`）属于新增包，并要在 `app.ts` 里声明 `device.notifications purpose.notifications`（推送还要 `device.push`、周期同步还要 `device.periodic-background-sync`）以及 strings 里的 `purpose.notifications`。本轮的约束不允许改 `package.json` / `app.json`，也不允许新增包。
2. 本地通知只能由正在运行的应用发出；iOS 在应用离开前台几秒后挂起 JS，所以本地通知提醒不了已退到后台的手机——它能多出来的只有前台的「本轮已完成」提示，而这个已经有了。
3. 真正能叫醒后台或已退出应用的是 `@exact/push`：需要 iOS 描述文件里的 Push Notifications（`aps-environment`）、APNs 密钥（Android 还要 Firebase 的 `google-services.json`），以及一个发送方。bridge 是无依赖的纯 Node，跑在 DSH 进程里，没有 APNs / FCM 客户端，也没有中转服务，没有东西去发这条推送。

bridge 一侧已经可供发送方接入：`GET /v1/feed?after=&wait=` 是跨会话的长轮询事件流（`approval/request`、`question/request`、`live/end`、`turn/end` 等）。

### W6 顺手修掉的既有问题

- `/pair` 页（Mac 上的二维码页）一直抛 `ReferenceError: base is not defined`，返回 500；现已修复并按浏览器语言出中 / 英文。
- 定时任务：`every` 规则读了不存在的 `every_seconds` 键（记录是扁平的 `everySeconds`），显示成「每 0 分钟」；`run` 把 `schedule_execution_pending`（未真正触发）当成功；按代码读，旧版把带 `st<k>-` 前缀的列表 key 当任务 id 发给 bridge；现在列表 key 与真实 id（`tid`）分开，动作只用后者。
- 消息反馈：写入总是 `ifVersion: null`，对已有评价改评分必然 `version-conflict`；现在先读当前版本。
- 密钥遮蔽的中文占位词（`（已遮蔽）`）改为官方的 `*` 遮蔽，不再随语言变化。

### 验证

- bridge 离线：`scratchpad/agents/w6/run-all.sh` 一次跑完 W2–W6 全部 23 个套件与 `bridge/test/*.test.mjs`，全部通过（W6 自己的三个套件分别有 138 / 36 / 19 条断言；W6 新增 `t-bridge.mjs`：反馈、变更页与 diff 路由、在 Mac 上打开、列表徽标与已读标记、子智能体树与消息、任务输出、定时任务、i18n grep 证明、版本与能力；`t-app.mjs`：手机数据源的请求体与映射；`t-e2e.mjs`：真实 bridge（假宿主服务、真 HTTP）回答真实的 `app.ts`，核对两端字段与声明的形状；注意要用 node 跑——bun 的 `os.homedir()` 不认运行时改的 `$HOME`，会读到真实的 `~/.dsh`）。只更新了两类因本轮有意变更而改变的断言：投影版本 10 → 11、密钥遮蔽改为 `*`。
- 手机：`bun exact.mjs contract build app.contract --json` 为 `[]`，`contract verify` 自身 0 refusals，`contract types --check` 为 current，`bun exact.mjs verify`（web）13 个测试全过，剩余 7 条 finding 与 W5 相同（均为既有）。
- `/v1/live` 暖路径负载 1106 → 1175 B，带列表 1906 → 2011 B。

### 需要在重载插件后真机 / 真服务验证的清单（按顺序）

先在 Mac 上重载：`plugin_manager action=set_bundle target=dsh-remote enabled=false` 再 `enabled=true`，并刷新 DSH 桌面窗口（`client.js` 需要重新注入）。

1. `GET /v1/health`（带 token）应有 `api: 11`、`dsh: "0.2.2-rc.3"`（读不到则为空）与 `caps`；记下哪些能力是 `false`，后面对应功能会降级。用旧手机 App 连新 bridge 与反过来（新 App 连旧 bridge 应出现「请重载插件」提示）各看一次。
2. `http://127.0.0.1:8787/pair` 能打开（之前 500），中 / 英文浏览器各看一次。
3. 反馈：对一条回复点 👎，选分类、写详情、提交，Mac 侧 `messageFeedback.list` 应出现该条（rating / category / note）；改评分（先 👍 再 👎）不应冲突；再点已标记的拇指应取消；在 Mac 上改同一条后手机再提交应出现「已在别处改动」。
4. 交付物：让一个回合用 shell 改文件（不经 write / edit），卡片应按宿主摘要显示文件数与 +/-；点文件看 hunk 与行号；重启 DSH 后打开旧会话应退回工具调用口径；`present` 的文件卡点开进查看器；「在 Mac 上打开」「在访达中显示」生效，`.command` 之类只能「显示」。
5. 列表徽标：手机停在列表时在 Mac 上跑完一轮应出现「未读」，失败的轮次为红色「运行出错」；在手机里打开该会话后，Mac 侧栏的圆点应同步消失（`sessionStatus.mark`）；若 `caps.readMarks` 为 false 则只是 bridge 自己的标记。
6. 子智能体：父会话里并发起几个子智能体，看树、模式、状态、token / 时长、列表行的「N 个子智能体运行中」；进入可继续的子会话发消息（真正走 rc.3 的 `subagents.prompt`，这是本轮唯一没法离线证实宿主行为的路径）并停止（`interruptByUser`）；一次性子会话应只读。
7. 更多页：环境显示工作目录并能在访达中显示；后台任务页点任务看输出（运行中的任务应隔几秒刷新），`kill` 仍可用。
8. 定时任务：分别建「仅一次 / 间隔 / 每天 / 每周」，编辑、暂停、恢复、立即运行（连点第二次应提示已排队或执行中）、删除；桌面上用官方编辑器建的 RRULE 任务应显示成人话；自定义（cron / 复杂 RRULE）任务只改标题时规则保持不变。
9. 语言切换：设置里切英文，列表的相对时间（`4min`）、任务规则、子智能体状态应同步变英文。
10. 观察 `/v1/live` 暖路径负载与耗时没有明显回退。
