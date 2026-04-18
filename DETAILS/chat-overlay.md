# 桌面对话框覆盖层（ChatOverlay）

## 概述

桌面 ProjectPage 中间列的**半透明遮罩式**对话框，覆盖 terminal 区域但让出底部状态栏。默认开（除 SSH/terminal 类型项目），保存用户手动关闭状态；关闭即还原 terminal。通过 Header 按钮、`Ctrl+I`、`Esc` 切换。

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
│           │     ├── 用户气泡（右对齐、蓝色）
│           │     ├── AssistantMessageContent（折叠/展开）
│           │     └── ApprovalCard（琥珀色，Allow/Deny）
│           ├── Skills / Model 浮层（上方）
│           └── 底部 band：工具条 + 输入框
```

**关键几何**：外层 `absolute left-0 right-0 top-0 bottom-7` —— `bottom-7` 对齐 `TerminalView` 底部 `h-7` 状态栏，让出"用量 + 上下文"footer。

## 数据流

```
useProjectWebSocket (TerminalView 内)
  ├── onTerminalData  → WebTerminal
  ├── onChatMessage   → ProjectPage chatMessages → ChatOverlay.liveMessages
  ├── onApprovalRequest/Resolved → ProjectPage approvalEvents → ChatOverlay
  └── onConnected     → wsReadyTick++ / chatMessages = []

ChatOverlay 内部:
  ├── liveMessages  → prevLiveCountRef 增量 → displayMessages (slice -50)
  ├── loadFromInformation → allHistoryRef → historySlice
  ├── messages = [...historySlice, ...displayMessages]
  ├── approvalEvents → approvals Map → ApprovalCard[]
  ├── pendingApprovals (REST) → 初始 / WS 重连补拉
  └── 发送 → sendToTerminal → onSend → terminalViewRef.sendTerminalInput
```

**单 WS**：不新建第二条连接，复用 TerminalView 的 `useProjectWebSocket`。

## 默认开 + 记住关闭状态

- `usePersistedState(STORAGE_KEYS.chatOverlay(id), 'true')`
- 新用户 / 未操作过 → 默认 `'true'`
- 用户关过 → localStorage 里 `'false'`，下次保留
- SSH 项目（`project.cliTool === 'terminal'`）：
  - `ProjectPage` 渲染 guard：`showChatOverlay === 'true' && cliTool !== 'terminal'`
  - `ProjectHeader` 切换按钮 guard：`cliTool !== 'terminal'` 时不渲染
  - `Ctrl+I` 快捷键 guard：同上

## 消息发送 + 状态机

```
stopped / error → (发送) → waking → (startProject 成功) → live
                                 → (超时 10s / 失败) → error
```

发送路径（desktop `sendToTerminal`）：
- `live` + 队列空：`onSend(text.replace(/\n/g, '\r') + '\r')` + arm retry
- `live` + 队列非空：push 到 `pendingQueueRef`（WS 还没 ready）
- `waking`：push 到 `pendingQueueRef`
- `stopped` / `error`：push + `startProject`，10s 超时

**wsReadyTick flush**：WS 连上后 ProjectPage 递增 `wsReadyTick`，触发 ChatOverlay useEffect 消费队列。flush 后**为最后一项 arm retry**（覆盖 post-wake 的 stuck-in-TUI 情况）。

**sendRetry 机制**（解决"消息卡在 Claude TUI 输入框"）：
- **条件驱动**（v-m）：每 3s 检查一次 `recentSentRef.includes(text)`，没 echo 就继续补 `\r`；echo 了就停。20 次硬 cap（60s）防止 CLI 崩溃后无限循环；到 cap 自己从 recentSentRef 清掉防污染
- 清除条件进一步收紧：**仅自己的 user 回音匹配 recentSentRef** 才清（assistant 响应不再清 —— 上一轮 assistant 响应完成时用户可能已经发了新消息，不能误清新 retry）
- `appendUserMessage` 存入 recentSentRef 时 `.trim()`，与 `handleChatMessage.indexOf(content.trim())` 对齐防止失配

## 快捷命令（RightPanel）乐观气泡

`ChatOverlay` 通过 `forwardRef` 暴露 `ChatOverlayHandle.appendUserMessage`。  
`ProjectPage.sendWithRetry`（RightPanel onSend 路径）在数据以 `\r` 结尾时调用 `chatOverlayRef.appendUserMessage(text)`，立即显示用户气泡不必等 JSONL echo。

## 气泡动效

- 每个气泡外层 `<motion.div>`，spring pop-in：
  - `initial: { opacity: 0, scale: 0.3, y: 40 }`
  - `animate: { opacity: 1, scale: 1, y: 0 }`
  - `transition: { type: 'spring', bounce: 0.45, duration: 0.55 }`
  - `transformOrigin: isUser ? 'bottom right' : 'bottom left'`
- `AnimatePresence initial={false}` 避免 mount 时整列重播
- `useReducedMotion()` 降级为纯 opacity 淡入

## AssistantMessageContent：气泡折叠/展开

- 每个 assistant 气泡的内容由 `<AssistantMessageContent>` 渲染
- **默认**：只有最新一条 assistant (`isLatest`) 展开，其余折叠为一行预览
- 预览：`previewLine(content)` 取首行 + 剥离 markdown（heading/blockquote/list/table-pipe/link/image/code/bold/italic）
- 展开：`ReactMarkdown + remarkGfm` 渲染完整内容 + 底部"折叠"按钮
- 用户点击会翻转为 local state（`userToggled`），覆盖 `isLatest` 默认
- 每个气泡 key 稳定（桌面 `msg.id` 单调计数器；手机 `ChatMsg.id` 同步方案），加载更多历史时 local state 不丢

## 历史 + 滚动

- mount 时 `loadFromInformation` + 每次 WS 重连（`wsReadyTick`）重拉
- 3s fallback：live 状态 3s 内无 chat_message → 再次拉 API
- **stick-to-bottom on initial load**：`useLayoutEffect` + 双 rAF + 100/300/800ms 多次重 pin，1200ms 宽限期内持续贴底，`wheel`/`touchmove` 触发即释放
- "加载更早消息"：`requestAnimationFrame` 修正 `scrollTop`

## 滚动条样式

- shadcn `<ScrollArea>`（扩展了 `viewportRef` prop）
- `scrollRef` 指向 Radix Viewport（真实滚动元素）
- 内层 `<div>` 加 `min-h-full`，点击空白处 `e.target === e.currentTarget` 关闭 skills/model 浮层
- **Radix wrapper 强制 block + 全宽**：Radix Viewport 会注入一层 `<div style="min-width:100%; display:table">` 包裹 children，`display:table` 会让这层随气泡内容（长代码块、长 URL、不可断字符串）拉宽从而超出 terminal 宽度。传 `viewportClassName="[&>div]:!block [&>div]:!w-full"` 覆盖内联样式为 `display:block; width:100%`，气泡 `max-w-[85%]` 从而是真实 viewport 宽度的 85%；代码块自己的 `overflow-x-auto` 处理内部横向滚动

## 输入区

- 全宽贴底 band（不再浮窗/不可拖动）
- 工具条：Skills 按钮 + Model 按钮（cliTool 对应模型列表）
- 输入框：`<textarea>` 3 行；`Shift+Enter` 发送，`Enter` 换行
- Ctrl+C 按钮（发 `\x03`）、语音（Web Speech API，长按空格 300ms）、发送按钮
- 草稿持久化：`STORAGE_KEYS.terminalDraft(projectId)`

## 权限审批卡片

- ChatOverlay mount 时 + 每次 WS 重连 (`wsReadyTick` deps) 拉 `GET /api/approval/:pid/pending` 补回未决请求
- WS 事件 `approval_request` / `approval_resolved` 维护 `approvals` state（`toolUseId` 去重）
- 渲染：消息列表末尾插入 `<ApprovalCard>`（琥珀色高亮、Allow/Deny 按钮）
- 详见 `approval-flow.md`

## 关键文件

- `frontend/src/components/ChatOverlay.tsx`
- `frontend/src/components/AssistantMessageContent.tsx` — 折叠/展开内容组件
- `frontend/src/components/ApprovalCard.tsx` — 审批卡片
- `frontend/src/components/ui/scroll-area.tsx` — 扩展了 `viewportRef`
- `frontend/src/pages/ProjectPage.tsx` — state + ref 编排
- `frontend/src/components/ProjectHeader.tsx` — toggle 按钮（SSH 隐藏）
- `frontend/src/components/TerminalView.tsx` — WS 回调 props
- `frontend/src/lib/websocket.ts` — `approval_request/resolved` 事件类型
- `frontend/src/lib/storage.ts` — persistence keys
- `frontend/src/lib/chatUtils.ts` — `formatChatContent()`（过滤 tool_use/tool_result）

## 不变式

- 遮罩同宽同高跟随 TerminalView，`bottom-7` 永远让出状态栏（若改了 h-7 要同步）
- SSH 项目：永远不渲染 overlay、不响应 Ctrl+I、header 无按钮
- 气泡 `msg.id` 单调稳定，历史 prepend 不破坏 React 局部状态
- retry **仅由 own-echo 清除**（assistant 响应不再清 —— 跨 turn 的 assistant block 会误清新消息的 retry）；retry 是条件驱动、持续 ping 直到 echo，不是固定次数
