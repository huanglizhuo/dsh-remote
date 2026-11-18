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
