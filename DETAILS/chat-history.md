# 聊天历史与实时流（Chat History & Live Stream）

> v2026.4.19-o / -p 引入的**统一聊天数据流**。三端（桌面 ChatOverlay / 手机 MobileChatView / 监控 MonitorPane）共用同一套 hook + 后端端点，CLI 原生 JSONL 是唯一真相源。

## 数据源

**单一真相源**：CLI 工具自身的原生 JSONL 文件（Claude Code、Codex、Gemini 等各有自己的位置）。
- Claude Code：`~/.claude/projects/<encoded-path>/<session-uuid>.jsonl`
- Codex：`~/.codex/sessions/<YYYY>/<MM>/<DD>/<uuid>.jsonl`（共享目录，按 cwd 过滤）
- Gemini：整文件 JSON（`.json` 扩展名）

ccweb **不自持**任何会话数据 —— v-p 起 `.ccweb/sessions/` + `.ccweb/information/` 彻底移除，前端无自己的 markdown 聚合视图。

## 两条获取路径 + 单一 resolver

### 路径 A：HTTP 按需拉取

```
GET /api/projects/:id/chat-history?limit=20&before=<blockId>
→ { blocks: ChatBlock[], hasMore: boolean }
```

- 首次挂载时由 `useChatHistory` 调用
- `limit` 默认 20；`before` 省略表示取最新 N 条
- 响应里每个 block 带 `id = sha1(jsonlPath + '\0' + line).slice(0, 16)`
- 分页：前端传**最旧 block 的 id**作为下一页的 `before`
- 权限：owner / share / admin

### 路径 B：WebSocket 实时推送

```
client → { type: 'chat_subscribe', replay?: number }
server → (replay 最后 N 条为 chat_message)
server → (listener 注册，后续 hook 触发时推增量 chat_message)
```

- `replay` 字段可选：
  - 无（老客户端）→ 默认 `Number.MAX_SAFE_INTEGER`（全量回放，向后兼容）
  - 50（v-o 起前端显式传）→ 只回放最后 50 条，减少首屏网络开销
  - 0（理论上支持）→ 不回放，完全依赖 HTTP
- 每条 `chat_message` payload = `ChatBlock`（含 `id`）

### 单一 JSONL resolver

**关键不变式**：HTTP 和 WS hook 两条路径**必须解析到同一个 JSONL 文件**，否则 block id 不同 → 前端 dedup 失败 → 气泡重复。

为保证这一点，`sessionManager.findLatestJsonlForProject(folderPath, cliTool)` 是**唯一**的 JSONL 发现函数：
- 优先用 `adapter.getSessionFilesForProject(folderPath)`（Codex 这种共享目录 + cwd 过滤）
- 否则 `adapter.getSessionDir(folderPath)` + 扩展名过滤 + 按 `mtime` 降序取第一个
- **无 `startedAt` 过滤** —— 历史上有过这条过滤的 `findJsonl`，但它与 `findLatestJsonlForProject` 不一致导致了 race，v-p 统一为单一实现

`triggerRead`（hook 触发）每次调用都**重新 resolve** 并在发现新文件时重置 `fileOffset=0`，同时处理 Claude `--continue` 可能切换新 JSONL 的情况。

## `ChatBlock` 结构

```ts
interface ChatBlockItem {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  content: string;
}

interface ChatBlock {
  id?: string;                          // sha1(jsonlPath + '\0' + source).slice(0,16)
  role: 'user' | 'assistant';
  timestamp: string;                    // ISO 8601
  blocks: ChatBlockItem[];
}
```

- `id` 可选 —— 后端 v-o 之后总是填充；旧后端滚动升级过程中可能没有，前端按需 fallback 到本地 ID 计数器
- `formatChatContent(blocks)` 把 block 数组拍平成 markdown 字符串：text 原样，非 text block 用 ``` ```${type}\n${content}\n``` ``` 围栏（AssistantMessageContent 靠 code-block-language 识别做样式化）

## 后端：`session-manager.ts` API

```ts
class SessionManager extends EventEmitter {
  // 写路径（由 terminal-manager + hooks 驱动）
  startSession(projectId, folderPath, cliTool)   // PTY 启动时注册 watcher
  stopWatcherForProject(projectId)                // PTY 停止时清理
  triggerRead(projectId)                          // Hook 触发；lazy 发现 JSONL + 读新行 + emit('semantic') + 调 chatListeners
  handleHookPreTool(projectId, toolName)          // PreToolUse 即时更新 semantic
  clearSemanticStatus(projectId)                  // Stop 前清 semantic（防脏读）

  // 读路径
  getChatHistory(projectId): ChatBlock[]          // HTTP /chat-history 和 chat_subscribe replay 都调这个
    // 三级 fallback：
    //   1. 已有 watcher + jsonlPath → 直接解析
    //   2. 有 watcher 但 jsonlPath null → lazy findLatestJsonlForProject + 缓存
    //   3. 无 watcher（stopped 项目 HTTP race） → getProject() + 即席解析，不缓存

  getJsonlPath(projectId)                         // 外部查询当前 jsonlPath
  getSemanticStatus(projectId) / getAllSemanticStatus()

  // 事件
  registerChatListener(projectId, cb)             // WS 订阅用
  unregisterChatListener(projectId, cb)
  emit('semantic', { projectId, status })         // 由 index.ts 转发为 WS `semantic_update`
}
```

### 触发时序（一次 Claude 交互）

```
PreToolUse hook        → handleHookPreTool(projectId, toolName)
                       → semanticStatus = { phase: 'tool_use', detail: toolName }
                       → emit('semantic') → WS `semantic_update`
                       → （不 triggerRead，JSONL 尚未写入）

PostToolUse hook       → triggerRead(projectId)
                       → 读新行 → 每个 block 经 chatListeners → WS `chat_message`
                       → 每个 assistant block 末尾更新 semantic + emit

Stop hook              → clearSemanticStatus → emit('semantic', null) → WS
                       → triggerRead（立即 + 300ms + 1500ms 三次，覆盖 JSONL flush 延迟）
```

## 前端：三个 hook

### `useChatHistory`（历史加载 + 分页）

```ts
useChatHistory({ projectId, historyLimit = 20, enabled = true })
  → { history, hasMore, isLoading, reload, loadMore }
```

- mount 时自动拉取第一页
- `loadMore()` 前拼下一批（按最旧 block id 作为 `before` 游标）
- `reload()` 用于 WS 重连 / 3s live-fallback

### `useChatSession`（状态机 + 发送 + 合并）

```ts
useChatSession({
  project, liveMessages, ws: { send, connected },
  historyLimit?, liveWindow?, historyEnabled?,
})
  → {
    state,                          // stopped | waking | live | error
    messages,                       // [...history, ...display] dedup by id
    historyMessages, displayMessages,
    hasMoreHistory, loadMoreHistory, reloadHistory,
    sendMessage(text),              // 统一发送入口（状态机 + 队列 + retry + wake）
    appendUserMessage(text),        // 仅追加气泡不发送（外部快捷命令用）
    clearSendRetry, liveReceivedRef,
    isWaking, isRunning,
  }
```

内部机制：
- **状态机**：外部 `project.status` → `state`；`sendMessage` 触发 stopped→waking；`startProject` 成功→live 或 10s 超时→error
- **发送队列**：`pendingQueueRef` + 20 条 cap；drain effect 依赖 `[wsConnected, state]`，三者（wsConnected / state==='live' / queue 非空）同时成立才发送
- **Retry**：最后一条 flushed 消息 arm 条件驱动 retry，每 3s 检查 `recentSentRef.includes(text)`，没 echo 补 `\r`，20 次硬 cap
- **Own-echo 去重**：收到 user chat_message 时在 `recentSentRef` 里精确匹配 content.trim()，匹配即 clearSendRetry + continue（不追加重复气泡）
- **History/Live 合并 dedup**：`const liveIds = new Set(display.map(m=>m.id))` → history 里 id 命中的跳过，避免 WS replay + HTTP 重叠导致的重复

### `useChatPinnedScroll`（桌面用）

```ts
useChatPinnedScroll(viewportRef, contentRef, deps)
  → { pinnedRef, scrollToBottom }
```

- 默认 pinned=true
- scroll 事件 80ms 内程序性滚动被忽略（抵抗浏览器 scroll-anchoring）
- ResizeObserver 观察消费者提供的 `contentRef`（不依赖 Radix 结构，CLAUDE.md #21）
- `useLayoutEffect` 在 deps 变化时：若 pinned 则贴底

手机 / 监控不用此 hook —— 它们的滚动是简版 `scrollTo({behavior:'smooth'})`，产品差异正当。

## 三端消费模式

| 组件 | WS hook | useChatHistory | useChatSession | 滚动 |
|---|---|---|---|---|
| **ChatOverlay** (桌面) | `useProjectWebSocket` 内嵌于 `TerminalView`；ProjectPage lift liveMessages/semantic/wsConnected 给 overlay | ✓（通过 useChatSession）| ✓ | `useChatPinnedScroll` |
| **MobileChatView** | `useMonitorWebSocket` 直接用 | ✓（通过 useChatSession）| ✓ | 简版 `scrollTo` |
| **MonitorPane** | `useMonitorWebSocket` 直接用 | ✓（`historyLimit=4`）| ✓（`liveWindow=4`）| `scrollTo` + `line-clamp-6` 截断 |

## Block ID 与去重策略

- 后端每条 block 附稳定 id：`sha1(jsonlPath + '\0' + line).slice(0,16)`
  - 跨 ccweb restart 幂等（相同 jsonlPath + 相同 line 永远产生同 id）
  - 对 whole-file JSON（Gemini）用 `timestamp + JSON.stringify(blocks)` 替代 `line`
- 前端去重：
  - `useChatSession` setDisplayMessages 前 `prev.some(p => p.id === msg.id)` 跳过重复（保护 WS 重连 replay 的幂等）
  - `messages` useMemo 里：`liveIds` 覆盖 `historyMessages` 里同 id 的条目，保留 live（反映最新状态）
- 两条路径的 id 一致性**依赖单一 JSONL resolver**（见上）

## `chat_subscribe` 兼容策略

后端 `chat_subscribe` 处理：
```ts
const replayLimit = typeof parsed.replay === 'number' ? parsed.replay : Number.MAX_SAFE_INTEGER;
if (replayLimit > 0) {
  const history = sessionManager.getChatHistory(projectId);
  const slice = replayLimit >= history.length ? history : history.slice(-replayLimit);
  for (const block of slice) ws.send(JSON.stringify({ type: 'chat_message', ...block }));
}
sessionManager.registerChatListener(projectId, chatListener);
```

- 老客户端（v-n 及更早）不传 `replay` → 全量回放（与旧行为一致）
- 新客户端传 `replay: 50` → 只回放 50 条
- Dedup 兜底：即使回放 + HTTP 都给出最后 50 条（overlap），靠 block id 合并去重

## 关键文件

**后端**
- `backend/src/session-manager.ts` —— 核心：watcher、resolver、getChatHistory、triggerRead
- `backend/src/routes/projects.ts` —— `/chat-history` 端点
- `backend/src/routes/hooks.ts` —— PreToolUse/PostToolUse/Stop → SessionManager
- `backend/src/index.ts` —— WS `chat_subscribe` / `chat_message` / `semantic_update` 处理
- `backend/src/adapters/*` —— `parseLineBlocks`、`parseSessionFile`、`getSessionDir`、`getSessionFilesForProject`

**前端**
- `frontend/src/hooks/useChatHistory.ts`
- `frontend/src/hooks/useChatSession.ts`
- `frontend/src/hooks/useChatPinnedScroll.ts`（桌面）
- `frontend/src/lib/chatUtils.ts` —— `formatChatContent`
- `frontend/src/lib/websocket.ts` —— 两个 WS hook + 事件类型
- `frontend/src/lib/api.ts` —— `getChatHistory()`

## 不变式

- JSONL 是**唯一真相源** —— 从不写 ccweb 自己的聚合文件
- HTTP 和 WS 回放**永远通过同一个 resolver** 得到同一个 JSONL path
- Block id 稳定：跨 restart / 跨路径 / 跨 dedup 都使用同一公式
- `replay` 字段缺失 = 兼容老客户端全量回放，不能改语义
- `useChatSession` 三端都消费同一个 hook，新行为一处改多处生效
