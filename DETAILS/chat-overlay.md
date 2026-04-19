# 桌面对话框覆盖层（ChatOverlay）

## 概述

桌面 ProjectPage 中间列的**半透明遮罩式**对话框，覆盖 terminal 区域但让出底部状态栏。默认开（除 SSH/terminal 类型项目），保存用户手动关闭状态；关闭即还原 terminal。通过 Header 按钮、`Ctrl+I`、`Esc` 切换。

v-o 起 ChatOverlay **不再拥有自己的状态机和发送逻辑** —— 全部移到 `useChatSession` hook，三端（桌面 / 手机 / 监控）共用。本文聚焦 ChatOverlay 独有的遮罩形态、气泡动效、skills/model/voice/approval 这些桌面专属 UI。数据流本身见 [`chat-history.md`](chat-history.md)。

## 组件结构

```
ProjectPage
├── ProjectHeader
│     └── [对话框] 按钮（MessageSquare）— SSH 项目时隐藏
├── 中间列容器 (flex-1 relative flex flex-col)
│     ├── TerminalView
│     │     ├── WebTerminal（flex-1）
│     │     └── 底部状态栏 h-7（UsageBadge + 上下文进度条）
│     └── <AnimatePresence> ChatOverlay（absolute left-0 right-0 top-0 bottom-7）
│           ├── ScrollArea (shadcn) 消息区（flex-1）
│           │     ├── "加载更早消息" 按钮
│           │     ├── 用户气泡（右对齐、蓝色、玻璃态）
│           │     ├── AssistantMessageContent（折叠/展开）
│           │     ├── ActivityBubble（LLM 活跃时，Loader2 + 标签）
│           │     └── ApprovalCard（琥珀色，Allow/Deny）
│           ├── Skills / Model 浮层（上方）
│           └── 底部 band：工具条 + 输入框
```

**关键几何**：外层 `absolute left-0 right-0 top-0 bottom-7` —— `bottom-7` 对齐 `TerminalView` 底部 `h-7` 状态栏，让出"用量 + 上下文"footer。

## 数据流（hook 化）

```
ProjectPage
  ├─ useProjectWebSocket (在 TerminalView 内)
  │     ├── onTerminalData     → WebTerminal
  │     ├── onChatMessage       → ProjectPage.chatMessages ── liveMessages prop ─┐
  │     ├── onApprovalRequest/Resolved → ProjectPage.approvalEvents  ────────────┤
  │     ├── onSemanticUpdate    → ProjectPage.semanticUpdate  ───────────────────┤
  │     └── 导出 { connected, readyTick }                     ────── ws.connected ─┤
  │                                                                              │
  └─ <ChatOverlay>                                                                │
       ├─ useChatSession({ project, liveMessages, ws })  ←──────────────────────┘
       │     └── 返回 { messages, sendMessage, appendUserMessage, state, ... }
       ├─ useChatPinnedScroll(viewportRef, contentRef, [messages, activeBubble, approvals])
       ├─ 本地 state：activeBubble (semanticUpdate → phase 驱动)
       ├─ 本地 state：approvals (approvalEvents 事件流 + `getPendingApprovals` REST 补拉)
       └─ 本地 state：input / skills 面板 / model 面板 / voice
```

**单 WS**：复用 TerminalView 的 `useProjectWebSocket`，不新建第二条。

## 默认开 + 记住关闭状态

- `usePersistedState(STORAGE_KEYS.chatOverlay(id), 'true')`
- 新用户 / 未操作过 → 默认 `'true'`
- 用户关过 → localStorage 里 `'false'`，下次保留
- SSH 项目（`project.cliTool === 'terminal'`）：
  - `ProjectPage` 渲染 guard：`showChatOverlay === 'true' && cliTool !== 'terminal'`
  - `ProjectHeader` 切换按钮 guard：`cliTool !== 'terminal'` 时不渲染
  - `Ctrl+I` 快捷键 guard：同上

## 消息发送

ChatOverlay 的 `handleSend` / `handleCommand` / `handleModelSelect` 统一调 `useChatSession.sendMessage(text)`；hook 内部处理：
- 状态机分支（live / waking / stopped / error）
- 发送队列 + 20 条 cap
- **条件驱动 retry + 单一滚动 watcher**（v-q 改版）：`armRetry()` 改为无参、`recentSentRef` 非空就 fire `\r`、空了停、20 次 cap。旧版 `armRetry(text)` 每次 per-call 清 retry 导致快速连发时只有最后一条受保护（CLAUDE.md #19 同家族）
- **WS `sendTerminalInput` 自动队列化**（v-q）：`useProjectWebSocket` 加 `pendingInputQueueRef`，WS 未 OPEN 时入队，`connected` 事件到达时 `flushInputQueue()` 重放；不再 silent-drop（对齐 `useMonitorWebSocket` 行为）
- wake flow（`startProject` + 10s 超时）
- 消息去重（跨 history/display 按 block id）

详见 [`chat-history.md`](chat-history.md) 的"发送路径"段。

**用户送出时 `pinnedRef.current = true`** —— 覆盖用户已滚开时的 pin 状态，保证自己的消息气泡即时可见。

**IME 合成期守卫**（v-q）：`handleKeyDown` 内联 `e.nativeEvent.isComposing || e.keyCode === 229` 检查，中文/日文/韩文用户按 Enter 选候选字时不触发发送。其他三端（Mobile / Monitor）走共享 hook `useEnterToSubmit`；ChatOverlay 因混合 Space 长按语音分支保留内联判断。

## 气泡动效

- 每个气泡外层 `<motion.div>`，spring pop-in：
  - `initial: { opacity: 0, scale: 0.3, y: 40 }`
  - `animate: { opacity: 1, scale: 1, y: 0 }`
  - `transition: { type: 'spring', bounce: 0.45, duration: 0.55 }`
  - `transformOrigin: isUser ? 'bottom right' : 'bottom left'`
- `AnimatePresence initial={false}` 避免 mount 时整列重播
- `useReducedMotion()` 降级为纯 opacity 淡入

## LLM 活跃气泡（ActivityBubble）

- 数据源：`onSemanticUpdate` WS 事件（来自 `sessionManager.emit('semantic')`，PreToolUse / tool_use block 流入时更新）
- 显示条件：`active && semantic.phase !== 'text' && approvals.length === 0`（pending 审批时让位于 ApprovalCard）
- 生命周期：同一 turn 内的 `tool_use ↔ tool_result` 切换**不换 id**（动画不重启）；熄灭（phase=text 或 active=false）后再激活换新 id（新动画）
- 标签映射 Bash → "执行命令…"、Read → "读取文件…"、Edit/MultiEdit → "编辑文件…"、Write → "写入文件…"、Grep → "搜索内容…"、Glob → "匹配文件…"、WebFetch/WebSearch → "访问网络…"、Task → "调度子任务…"、TodoWrite → "更新任务列表…"、NotebookEdit → "编辑 Notebook…"；未知 `phase='thinking'` → "思考中…"；fallback → "工作中…"
- 视觉：`<Loader2 animate-spin>` + 文字，使用与 assistant 气泡相同的玻璃态样式但尺寸更紧凑

## AssistantMessageContent：气泡折叠/展开

- 每个 assistant 气泡的内容由 `<AssistantMessageContent>` 渲染
- **默认**：只有最新一条 assistant (`isLatest`) 展开，其余折叠为一行预览
- 预览：`previewLine(content)` 取首行 + 剥离 markdown（heading/blockquote/list/table-pipe/link/image/code/bold/italic）
- 展开：`ReactMarkdown + remarkGfm + thinking/tool_use/tool_result 识别`（通过 fenced code language tag，v-o 起 `formatChatContent` 保留这些 block）
- 用户点击会翻转为 local state（`userToggled`），覆盖 `isLatest` 默认
- 每个气泡 key 稳定（`ChatMsg.id` 来自后端 `sha1(jsonlPath+line)` 或本地 fallback 计数器），加载更多历史时 local state 不丢

## 滚动（useChatPinnedScroll hook）

从 v-o 起抽到 `frontend/src/hooks/useChatPinnedScroll.ts`：

- 单一 `pinnedRef`（默认 true → 入页即贴底）
- `onScroll` 事件根据距底 80px 翻转 pin 状态；**程序性 `scrollToBottom` 80ms 内**的事件被忽略，避免 scroll-anchoring 误翻
- `useLayoutEffect` 在 deps（messages / activeBubble / approvals）变化时：若 pinned 则贴底
- `ResizeObserver` 观察我们自己持有的 `contentRef`（不依赖 Radix 内部结构，规避历史错误 #21）—— markdown 异步渲染、图片晚到都能正确 re-pin
- 暴露 `{ pinnedRef, scrollToBottom }` 给消费者（如 `sendMessage` 前设置 `pinnedRef.current = true`）

"加载更早消息"按钮外包裹 `handleLoadMore`：调 `useChatSession.loadMoreHistory`，并在前后取 `scrollHeight` 差，`requestAnimationFrame` 后修正 `scrollTop` 让视口停在分界线（不被顶到文件开头）。

## 滚动条容器

- shadcn `<ScrollArea>`（扩展了 `viewportRef` prop）
- `scrollRef` 指向 Radix Viewport（真实滚动元素）
- 内层 `<div ref={contentRef}>` 加 `min-h-full`，ResizeObserver 观察它
- **Radix wrapper 强制 block + 全宽**：传 `viewportClassName="[&>div]:!block [&>div]:!w-full"` 覆盖 Radix 注入的 `display:table`（历史错误 #21）

## 输入区

- 全宽贴底 band（不再浮窗/不可拖动）
- 工具条：Skills 按钮 + Model 按钮（cliTool 对应模型列表）
- 输入框：`<textarea>` 3 行；`Shift+Enter` 发送，`Enter` 换行
- Ctrl+C 按钮（发 `\x03`）、语音（Web Speech API，长按空格 300ms）、发送按钮
- 草稿持久化：`STORAGE_KEYS.terminalDraft(projectId)`

## 权限审批卡片

- ChatOverlay mount 时 + 每次 WS 重连（`wsConnected` deps）拉 `GET /api/approval/:pid/pending` 补回未决请求
- WS 事件 `approval_request` / `approval_resolved` 维护 `approvals` state（`toolUseId` 去重）
- 渲染：消息列表末尾插入 `<ApprovalCard>`（琥珀色高亮、Allow/Deny 按钮）
- **seq 游标消费**（v-q）：ProjectPage 给每条 approval 事件附加单调 `seq: number`，ChatOverlay 用 `lastApprovalSeqRef` 过滤已处理事件，替换掉原先基于 `array.length` 的反模式（父数组 `slice(-50)` 触顶后永远失消费，CLAUDE.md #32）
- **REST/WS race 防护**（v-q reviewer round）：本地维护 `resolvedIdsRef: Set<string>`，WS `approval_resolved` / 本地 Allow/Deny 按钮 / REST 响应 都向其添加 toolUseId；REST 补拉结果进 state 前先过滤已解析 ID，且采用 merge 而非覆盖，防止慢 REST 返回时挤进已被 WS 解析的 ghost card（CLAUDE.md #27 同家族）
- 详见 `approval-flow.md`

## 对外 imperative handle

`forwardRef<ChatOverlayHandle>` 暴露：
- `appendUserMessage(text)` —— RightPanel/其他组件送快捷命令时，优先立即显示气泡不必等 JSONL echo；内部直接调 `useChatSession.appendUserMessage`，并在前设 `pinnedRef.current = true`
- `sendCommand(text)` —— v-q 起新增：把 `text` 送入 `useChatSession.sendMessage`，走完整发送管线。`ProjectPage.handlePanelSend` 在 overlay 已挂的 user-message 路径上就走这里，把原来 `sendWithRetry` + 固定次数 retry + "任何 chat_message 清 retry"（CLAUDE.md #19 反模式）彻底替换掉

## 关键文件

- `frontend/src/components/ChatOverlay.tsx` —— UI + 集成 hook
- `frontend/src/components/AssistantMessageContent.tsx` —— 折叠/展开内容组件
- `frontend/src/components/ApprovalCard.tsx` —— 审批卡片
- `frontend/src/components/ui/scroll-area.tsx` —— 扩展了 `viewportRef`
- `frontend/src/hooks/useChatSession.ts` —— 状态机 + 发送 + 合并（三端共用）
- `frontend/src/hooks/useChatHistory.ts` —— 历史分页（三端共用）
- `frontend/src/hooks/useChatPinnedScroll.ts` —— 贴底滚动（桌面用）
- `frontend/src/pages/ProjectPage.tsx` —— state + ref 编排、semanticUpdate/wsConnected lift
- `frontend/src/components/ProjectHeader.tsx` —— toggle 按钮（SSH 隐藏）
- `frontend/src/components/TerminalView.tsx` —— WS 回调 props 透传
- `frontend/src/lib/websocket.ts` —— 事件类型定义 + WS hook 导出 `{connected, readyTick}`
- `frontend/src/lib/chatUtils.ts` —— `formatChatContent()`（保留非 text block 为 fenced code）

## 不变式

- 遮罩同宽同高跟随 TerminalView，`bottom-7` 永远让出状态栏（若改了 h-7 要同步）
- SSH 项目：永远不渲染 overlay、不响应 Ctrl+I、header 无按钮
- 气泡 `msg.id` 稳定（后端 block id 或本地 fallback），历史 prepend 不破坏 React 局部状态
- retry **仅由 own-echo 清除**（assistant 响应不再清，跨 turn 的 assistant block 会误清新消息的 retry）；retry 是条件驱动，持续 ping 直到 echo，不是固定次数
- 三端共用 `useChatSession` —— 凡改状态机 / 发送逻辑 / 去重语义，只改 hook 一处
