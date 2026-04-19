# 手机界面（Mobile Interface）

## 概述

独立的 `/mobile` 路由，为手机屏幕优化的全屏界面。手机设备自动重定向，桌面用户可通过 Dashboard 手机图标手动进入。

## 页面结构（3 层栈导航）

```
MobilePage.tsx (栈容器 + AnimatePresence 转场)
  ├─ MobileProjectList     项目卡片列表（2 列网格）
  ├─ MobileChatView        聊天界面（从右滑入）
  └─ MobileSidePanel       侧边面板（从右滑入）
       ├─ 上下文用量       进度条 + token 详情
       ├─ API 用量         5h/7d 配额 + 重置倒计时
       └─ MobileFileBrowser 文件浏览（3 列图标网格）
            └─ MobileFilePreview 文件预览（语法高亮/图片/Markdown/数学公式/Office）
```

## 手机设备自动检测

```typescript
// App.tsx — 模块级常量，只在页面加载时评估一次
const IS_MOBILE_DEVICE =
  window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 768;
```

- `pointer: coarse` = 触摸屏为主输入设备，排除桌面窄窗口
- 手机设备访问 `/` 自动重定向到 `/mobile`（`MobileRedirectGuard`）
- 手机设备隐藏 PluginDock 和桌面模式按钮
- `/settings`、`/skillhub` 等路由不拦截

## PWA 支持

- `manifest.json`: `start_url: /mobile`, `display: standalone`
- PNG 图标: `icon-192.png`, `icon-512.png`（深蓝底 + 蓝色 `>_`）
- `apple-touch-icon` + `apple-mobile-web-app-capable`
- `useMobileViewport` hook: 进入时禁止缩放，离开时恢复

## 聊天历史分页

MobileChatView 将消息分为两层：

- `allHistoryRef` — 从信息 API 加载的完整历史（ref，不触发渲染）
- `historySlice` — 当前展示的历史切片（state，初始取末尾 20 条）
- `liveMessages` — WebSocket 实时收到的消息（state）
- `messages = useMemo([...historySlice, ...liveMessages])` — 合并后用于渲染

**加载更多**：点击顶部按钮 → `historySlice` 前移 20 条 → `requestAnimationFrame` 修正 `scrollTop` 保持阅读位置。

**防止 loadFromInformation 频繁重建**：用 `liveCountRef` 做运行时检查而非放入 useCallback 依赖，避免每条 WS 消息都重建回调和 timer。

**liveMessages cap 200**（v-q）：`setLiveMessages((prev) => { const next = [...prev, msg]; return next.length > 200 ? next.slice(-200) : next })`。长会话下防止数组无限增长 + `useChatSession` effect 每条消息 O(n) diff 的 tail pressure。

## 键盘输入守卫（IME）

v-q 起 MobileChatView 的 textarea `onKeyDown` 用共享 hook `useEnterToSubmit(onSubmit, 'shift')`（`shift` 模式：Enter 提交、Shift+Enter 换行）。hook 内部首先检查 `e.nativeEvent.isComposing || e.keyCode === 229`，**中文/日文/韩文 IME 合成期 Enter 不提交**，解决历史错误 #33 的手机端痛点。

## 审批卡片

v-q 起 MobileChatView 消费 approval 事件：

- `useMonitorWebSocket` 新增 `onApprovalRequest` / `onApprovalResolved` 回调
- mount + 每次 `wsConnected: false → true` 翻转拉 `getPendingApprovals(project.id)` 补回离线期间的 pending
- `resolvedIdsRef: Set<string>` 记录已解析 toolUseId，防止 REST 补拉返回时复活 ghost card（见 `approval-flow.md`）
- 消息列表末尾渲染共享 `<ApprovalCard>`（桌面 / 手机同组件）
- 点击 Allow/Deny → `decideApproval(projectId, toolUseId, behavior)` → WS 广播 → 其他客户端同步移除

之前手机用户触发 Write/Edit/Bash 权限请求只能等 24h 超时或切回桌面批，v-q 起同构。

## 聊天 Markdown 渲染

Assistant 消息通过共享组件 `<AssistantMessageContent>`（见 `chat-overlay.md`）渲染：默认仅最新一条展开，其余折叠为一行预览；点击可翻转。`previewLine` 剥 heading/list/link/image/code 标记。用户消息保持纯文本 + `whitespace-pre-wrap`。

样式约束（通过 Tailwind `[&_xxx]` 选择器）：
- `prose prose-sm dark:prose-invert` + `text-inherit`（继承气泡颜色）
- `pre`: `overflow-x-auto` 防溢出，`text-xs`
- `p/ul/ol`: `my-1` 紧凑间距
- `h1/h2/h3`: 限制为 `text-base/text-sm`
- `a`: `text-blue-400` 确保链接可见
- `code/table`: `text-xs` 适配小屏

## WebSocket 消息队列（v1.5.132）

`useMonitorWebSocket` 内置消息队列机制，确保消息永不静默丢失：

```
sendInput(data)
  ├─ readyRef === true && WS OPEN → 直接发送
  └─ 否则 → 入 pendingQueueRef 队列
                    │
ws.onmessage('connected') → readyRef = true → flushQueue() 刷出所有排队消息
ws.onclose              → readyRef = false（后续 sendInput 自动入队）
```

**关键设计**：
- `readyRef` 只在收到 `connected` 确认（认证 + chat_subscribe 完成）后才设 true
- `chat_subscribe` 分支（后端 `index.ts`）在 v2026.4.19-g 之后也会把 ws 加入 `projectClients` 并推一次初始 `context_update`，让手机/监控客户端能收到 `context_update` 广播和 `approval_request/resolved` 事件（之前只有 `terminal_subscribe` 注册，导致手机端看不到 context）
- 队列跨重连保留：connection lifecycle effect cleanup 不清空队列，仅 unmount effect 清空
- 重试耗尽（MAX_RETRIES=5）时清空队列 + console.warn，防内存泄漏
- `state === 'waking'` 时发送的消息也走 `wsSendInput` → 入队 → WS 就绪后自动发出

**状态路径覆盖**：
| 状态 | 发送路径 |
|------|----------|
| live | `sendWithRetry(text)` → 直发（或队列+flush） + arm retry |
| waking | `sendWithRetry(text)` → 入队 → connected 后 flush + retry |
| stopped | `pendingInputRef` → startProject → live → effect → `sendWithRetry(pending)` → 入队/直发 + retry |

## Send retry 机制

**问题**：Claude Code TUI 在 bootstrap 或处理中可能吞掉 Enter，文本卡在输入框未提交。

**设计**（v-m 起，条件驱动）：`sendWithRetry(text)` 接受原始文本（无 `\r`），caller 负责先 push 到 `recentSentRef`：
- 每 3s 检查一次：`recentSentRef.includes(text)` 为 true（Claude 还没 echo 回来）→ 发 `\r`，继续循环
- `recentSentRef` 不再含 text（被 `handleChatMessage` pop 出去）→ 停止 retry
- 20 次硬 cap（60s）兜底防 CLI 崩溃无限循环；到 cap 自己从 recentSentRef 清掉 text 防后续污染

**`clearSendRetry` 触发条件收紧（v-m）**：仅 **自己的 user 回音匹配 `recentSentRef`** 才清。assistant 响应不再清 retry —— 跨 turn 的 streaming assistant block 会误清新消息的 retry，导致 msg2 失去保护。

## Header 更新按钮

`MobileProjectList` header 引入 `<UpdateButton />`（与桌面 Dashboard 同一组件），仅在有新版本时显示。

## 数据流

```
useProjectStore ──→ MobileProjectList（项目数据 + 缓存）
useDashboardWebSocket ──→ 实时状态（running/stopped） + 活跃检测（glow 动画）
useMonitorWebSocket ──→ MobileChatView（chat_message + context_update + approval events）
getConversations + getConversationDetail ──→ 历史消息分页（allHistoryRef → historySlice）
getGlobalShortcuts / getProjectShortcuts ──→ 快捷命令栏
getUsage ──→ MobileSidePanel API 用量
browseFilesystem / readFile ──→ MobileFileBrowser / MobileFilePreview
```

## 共享工具

- `lib/chatUtils.ts` — `formatChatContent()`（从 MonitorPane 提取，Mobile + Monitor 共用）
- `useMonitorWebSocket` — 扩展支持 `onContextUpdate` 回调

## 关键文件

- `frontend/src/pages/MobilePage.tsx` — 路由入口 + 栈导航
- `frontend/src/components/mobile/MobileProjectList.tsx` — 项目列表
- `frontend/src/components/mobile/MobileChatView.tsx` — 聊天界面 + 快捷命令
- `frontend/src/components/mobile/MobileSidePanel.tsx` — 侧边面板（上下文 + 用量 + 文件）
- `frontend/src/components/mobile/MobileFileBrowser.tsx` — 文件浏览
- `frontend/src/components/mobile/MobileFilePreview.tsx` — 文件预览
- `frontend/src/lib/chatUtils.ts` — 消息格式化
- `frontend/public/manifest.json` — PWA manifest
- `frontend/public/icon-192.png` / `icon-512.png` — 应用图标
