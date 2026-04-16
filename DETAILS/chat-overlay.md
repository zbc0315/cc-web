# 桌面对话框覆盖层（ChatOverlay）

## 概述

桌面 ProjectPage 的聊天覆盖层，浮在终端区域上层。替代了旧的 TerminalDraftInput 浮动输入框，新增了聊天气泡显示功能。通过 header 按钮或 Ctrl+I 切换。

## 组件结构

```
ProjectPage
├── ProjectHeader
│     └── [对话框] 按钮（MessageSquare 图标）
├── TerminalView（纯终端 + 状态栏）
│     ├── WebTerminal
│     ├── TerminalSearch（Ctrl+F）
│     └── 底部状态栏（UsageBadge + 上下文进度条）
└── ChatOverlay（absolute 定位，z-40）
      ├── Header 栏（拖拽手柄 + 状态灯 + 关闭按钮）
      ├── 消息列表（滚动）
      │     ├── "加载更早消息"按钮
      │     ├── 历史消息（information API）
      │     └── 实时消息（WS chat_message）
      ├── 工具栏（Skills 按钮 + Model 选择器）
      └── 输入区（textarea + Ctrl+C / 语音 / 发送按钮）
```

## 数据流

```
useProjectWebSocket (TerminalView 内)
  ├── onTerminalData → WebTerminal         (不变)
  ├── onChatMessage  → ProjectPage state → ChatOverlay.liveMessages prop
  └── onConnected    → ProjectPage → wsReadyTick + 清空 chatMessages

ChatOverlay 内部：
  ├── liveMessages → prevLiveCountRef 增量处理 → displayMessages state
  ├── information API → allHistoryRef → historySlice state
  ├── messages = [...historySlice, ...displayMessages] → 渲染
  └── 发送 → sendToTerminal → onSend → sendTerminalInput (PTY 写入)
```

**关键**：不新建第二条 WS 连接。复用 TerminalView 的 `useProjectWebSocket`，通过 `onChatMessage` 回调将消息上报到 ProjectPage。

## 状态机

```
stopped → (发送消息) → waking → (startProject 成功 + WS 连接) → live
                              → (超时 10s / 失败) → error
```

- `project.status` 变化时同步状态
- `wakeIdRef` 防止过期唤醒回调（多次快速唤醒只有最新一次生效）

## 消息发送机制

```
sendToTerminal(text)
  ├── state === 'live'
  │     └── onSend(text + '\r')  → rawSend({type:'terminal_input'})
  ├── state === 'waking'
  │     └── pendingQueueRef.push(text)  → wsReadyTick 触发时 flush
  └── state === 'stopped' / 'error'
        ├── pendingQueueRef.push(text)
        ├── startProject() → waking → live
        └── 10s 超时 → error + 清空队列
```

**wsReadyTick 机制**：
- ProjectPage 的 `handleWsConnected` 回调在 WS 发来 `connected` 消息时触发
- 递增 `wsReadyTick` 计数器，传给 ChatOverlay
- ChatOverlay 的 useEffect 监听 `wsReadyTick`，flush `pendingQueueRef` 中所有消息
- 保证消息在 WS 真正就绪后才发送，避免 `rawSend` 静默丢弃

## 历史消息加载

- **mount 时**：调用 `loadFromInformation()` 加载历史
- **3 秒 fallback**：`state === 'live'` 但 3 秒内无 WS 消息 → 再次调用
- **分页**：`allHistoryRef` 存完整历史，`historySlice` 展示末尾 20 条，点击"加载更早消息"向前扩展 20 条
- **scrollTop 修正**：加载更早消息后用 `requestAnimationFrame` 修正滚动位置

## 消息渲染

- 用户消息：右对齐，蓝色气泡，纯文本 `whitespace-pre-wrap`
- 助手消息：左对齐，secondary 气泡，`ReactMarkdown + remarkGfm`
- 样式：`prose prose-sm dark:prose-invert`，代码块 `overflow-x-auto`，标题限制大小
- 乐观显示 + `recentSentRef` 去重（WS 重连时清空）

## 输入区功能（迁移自 TerminalDraftInput）

- **草稿持久化**：`STORAGE_KEYS.terminalDraft(projectId)` → localStorage
- **Skills 面板**：`getToolSkills(cliTool)` → 内置/自定义/MCP 命令列表
- **Model 选择器**：`getToolModels(cliTool)` + `/model` 命令切换
- **语音输入**：Web Speech API，长按空格 300ms 触发，松开停止
- **Ctrl+C 中断**：发送 `\x03`，仅 live 状态可用
- **键盘**：Shift+Enter 发送，Enter 换行

## 定位与尺寸

- `absolute` 在终端区域容器内，`z-40`
- 默认位置：右下角（`right: 16, bottom: 48`）
- 宽度 50%（min 320px, max 600px），高度 60%（min 300px, max 80%）
- 可拖拽（Header 栏为拖拽手柄），边界限制在父容器内
- 位置持久化：`STORAGE_KEYS.chatOverlayPos(projectId)` → localStorage
- per-project 显示状态持久化：`STORAGE_KEYS.chatOverlay(projectId)`

## 关键文件

- `frontend/src/components/ChatOverlay.tsx` — 主组件
- `frontend/src/pages/ProjectPage.tsx` — 状态管理 + 渲染
- `frontend/src/components/ProjectHeader.tsx` — toggle 按钮
- `frontend/src/components/TerminalView.tsx` — WS 回调 props
- `frontend/src/lib/storage.ts` — 持久化 keys
- `frontend/src/lib/chatUtils.ts` — `formatChatContent()` 消息格式化
