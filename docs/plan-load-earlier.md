# 修复计划：`Load earlier messages` 的展开方式

> 症状来自真机反馈：
> 1. 点 `Load earlier messages` 之后，**视图跳到了最早的那几条**，用户以为自己刚才没加载成功（实际加载了，只是位置变了）。
> 2. 想继续看更早的，只能再去找那个按钮——**向上滑到底不会自动续载**。

## 1. 为什么会这样（现状）

- 数据：`take` 是「从最新往回取多少条」。点一次 `loadEarlier` 把 `take` 从 80 加到 200，bridge 重新返回**整个窗口**。
- 渲染：`list virtualized=true`，`for` 里是新的一整批行；Exact 的虚拟列表没有「prepend 时保持可视位置」的默认行为。
- 结果：行数变了，滚动偏移还是旧数值，于是屏幕停在了新内容里某个位置——通常是**最上面那批旧消息**，看起来就像「跳到了最早」。
- 触发：目前只有按钮。列表是 `scroll-start="end"`，用户滑到顶部后没有任何回调告诉我们「到底了」。

## 2. 业界怎么做（查过之后）

| 来源 | 要点 |
|---|---|
| [TanStack Virtual · Chat](https://github.com/TanStack/virtual/blob/main/docs/chat.md) | 聊天要 **end-anchored**：`anchorTo:'end'`，prepend 前记下「当前第一个可见项 + 偏移」，prepend 后按 **稳定 key** 找回同一项并还原偏移；**不要**用 `column-reverse` 或手写 `scrollTop += delta`。新消息只在用户「已在底部」时才跟随（`followOnAppend` + `scrollEndThreshold≈80px`）。 |
| [react-anchorlist](https://www.npmjs.com/package/react-anchorlist?activeTab=readme) | 同一套机制的三件套：prepend 的项先强制测高 → 用 anchor 还原 → 晚到的测量用 transform 补偿。强调 **不能用 index 当 key**（prepend 后全部 index 位移）。 |
| [or3-scroll](https://www.npmjs.com/package/or3-scroll) | `@reachTop` 事件 → 拉更早的一页 → prepend；`loadingHistory` 期间抑制重复触发。 |
| [StackOverflow 同类问题](https://stackoverflow.com/questions/79350759/how-to-handle-page-scrolling-with-upward-infinite-scrolling-with-javascript) | 反例现场：加载后「跳到下一页顶部」，被明确判定是坏体验。 |
| [Jump to latest pill（iOS）](https://github.com/milind-soni/OpenMausBot/commit/09493932f9abbf78ec6d8b2d8cae5b882e7c2dfd) | 读历史时给一个「回到最新」的胶囊；离底部超过阈值才出现。 |

两条可以直接搬的结论：

1. **prepend 必须做锚定补偿**，否则一定会「跳」；
2. **加载要由「到顶」触发**，按钮只是状态提示与兜底。

## 3. Exact 给我们什么

- 虚拟列表的 `scroll` 事件带 `firstVisibleKey` 和 `firstVisibleOffset`（`vendor/exact/docs/contract-grammar.md:1920-1945`），正是 TanStack 那套 anchor 的等价物。
- 还原用列表形态：`scrollIntoView("transcript", key, offset=<px>, behavior="instant")`——`offset=` 只属于列表形态，语义是「把视口放进该行内多少像素」。
- 行 key 已经是稳定的 `m.id`（bridge 合并回合后仍然唯一），满足「不要用 index 当 key」。
- 没有 `onStartReached` / `onEndReached` 这类回调，也没有 pull-to-refresh 控件，所以「到顶触发」要自己从 `scroll` 事件里算。

## 4. 方案

### A. 锚定补偿（修「跳到最早」）

1. 列表挂 `scroll=moved`：
   ```
   list id="transcript" testId="transcript" virtualized=true scroll-start="end"
        scrollFollowEnd=(stick) scroll=moved keep-mounted=[first(threadKeys), last(threadKeys)]
   action moved(x: number, y: number, e: ScrollEvent)
     topKey = e.firstVisibleKey
     topOffset = e.firstVisibleOffset
     atTop = e.scrollTop < 80
   ```
2. `loadEarlier` 不再直接改 `take`：
   ```
   action loadEarlier
     if not pending(snap) and snap.hasMore and loadingKey == ""
       loadingKey = topKey            // 记下锚
       send more = loadOlder(server, token, selected, take)   // 现有接口，返回新的 take
   action afterMore
     take = more.take                  // 触发重取
     loadingKey = ""                   // 数据到位后，poll 里做还原
   ```
3. `poll` 里，**当 `take` 变化且 `anchorKey != ""` 时**，等一帧再还原：
   ```
   if loadingKey != "" and snap.messages.length > 0
     scrollIntoView("transcript", loadingKey, offset=topOffset, behavior="instant")
     loadingKey = ""
   ```
   这一帧的等待用 `after(80, restore)`（Exact 的 `task` 定时器），确保新行已经量过尺寸。

### B. 顶部触发（修「不能继续滑」）

- `moved` 里算出来的 `atTop` 为真、`snap.hasMore` 为真、`loadingKey == ""`、且距上次触发 > 600ms → 直接调用 `loadEarlier`。
- iOS 的橡皮筋会把 `scrollTop` 拉成负数，判据用 `e.scrollTop < 80` 而不是 `== 0`，天然覆盖「下拉一下」。
- 触发后立刻把 `loadingKey` 占住，避免一次滑动连发三次请求。

### C. 顶部那一行的三态（不再闪、不再骗人）

`derive moreRow` 按状态渲染，高度固定 44pt，内容变化不改变布局：

| 状态 | 文案 | 交互 |
|---|---|---|
| `hasMore` 且空闲 | `Load earlier messages` | 可点（兜底） |
| 加载中 | `Loading…` + 小转圈 | 不可点、不重复触发 |
| `hasMore == false` | `Beginning of conversation` | 纯文字 |
| 上次失败 | `Couldn't load earlier · Retry` | 可点重试 |

要点：**文案不再依赖 `pending(snap)`**（那条曾经因为 700ms 轮询反复翻转，这就是上一轮「一直闪」的根因）。

### D. 超过 400 条之后

现在 `take` 有 20–400 的上限，取满之后 `hasMore` 仍为真但再也加不上去。补一条真正的分页：

- bridge：`/v1/snapshot?...&before=<seq>` 透传给 `sessionController.events({ address, beforeSeq })`；
- app：`state older` 累积「更早的页」，与当前窗口按 `seq` 去重合并；`take` 逻辑保留给「一次看更多」。
- 这样「向上无限加载」才是真的无限。

### E. 读历史时不被拽回底部（顺带）

- `stick` 已有：`loadEarlier` 置 `false`，`open`/发送时复位。
- `stick == false` 时显示「回到最新」胶囊（复用现有的 `anchor`），点它滚到最后一条并恢复 `stick`。

## 5. 分阶段落地

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 探针：`scroll` 事件确实带 `firstVisibleKey/Offset`（实测 `"a238"` / `290.66`），`offset=` 还原可用 | ✅ |
| P1 | 锚定补偿：点 `Load earlier` 前后，同一行 y 坐标完全不变（`-778.33` → `-778.33`），新行插在上方 | ✅ |
| P2 | 到顶自动触发：滚到顶部自动加载，`take` 80 → 200 | ✅（还加了「打开会话时不误触发」） |
| P4 | 读历史时出现 `Latest ›` 胶囊，点击回到底部并恢复跟随 | ✅ |
| P3 | `before=<seq>` 真分页 | ⏳ 未做；当前把上限抬到 1200 条（bridge 与 app 同步），超过再往前翻需要真分页 |

## 6. 风险与备选

- **`firstVisibleKey` 在合并行/合成行上的行为**：`moreRow`、`goalRow` 也是行，key 是 `more`/`goal{id}`。还原时如果锚点正好是它们，`offset=` 可能无意义 → 只对 `role == "user"/"assistant"` 的行做锚。
- **行高变化**：图片、代码块展开会让行高在测量后变化；必要时在还原后再补一次 `scrollIntoView`（同 key，同一 offset），或改用「锚点行的 y 与还原后 y 的差」补偿。
- **备选**：如果 Exact 的 `offset=` 精度不够（比如整行对齐），退化成「记下锚点行的 key，把视口滚到该行 `block="start"`」——体验差一点，但至少不会跳到最早。
- **实现之后的两个补充**：① `Load earlier` 这一行从列表里挪出来，变成列表上方的固定条——否则它自己会成为 `firstVisibleKey`，锚在它身上等于没锚；② 跟随底部改成由滚动位置推导（`scrollHeight - scrollTop - clientHeight <= 24`），而不是一个要手动复位的开关——否则用户向上滚会被每 700ms 的轮询拽回底部。
- **短会话**：不足一屏时不显示任何加载行，避免「一屏内容还提示加载」。

## 7. 附：这次不动的东西

- 不引入 `column-reverse`（Exact 的 list 也不支持反转）。
- 不改「按 turn 合并」的数据形状。
- 不改 `/v1/snapshot` 的返回结构，只是多一个可选 `before`。
