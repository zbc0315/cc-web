# Hooks + Chat SDK 模式设计文档

**日期**: 2026-03-25
**版本**: v1.1
**影响版本**: v1.5.40+

---

## 背景与目标

### 现有问题

ccweb 当前通过两种机制获取 Claude Code 的输出：

1. **PTY raw output**（node-pty）：实时终端字节流，用于 Terminal Tab 渲染
2. **JSONL 定时轮询**（每 2s）：读取 `~/.claude/projects/{path}/*.jsonl`，解析结构化消息，用于：
   - Dashboard 卡片语义状态（Thinking / Tool / Writing 标签）
   - ChatView 消息内容（text / thinking / tool_use 块）

轮询方案的问题：
- 语义状态最多延迟 2s 才能反映
- 工具调用开始/结束时没有即时信号
- JSONL 无论是否有新内容都在轮询，浪费 I/O

### 目标

1. **用 Claude Code Hooks 替换 JSONL 定时轮询**：事件驱动，即时响应
2. **新增 Chat SDK 模式**：基于 `claude --print --output-format stream-json` 的真正流式对话，作为 Terminal 模式的可选替代

---

## 方案一：Claude Code Hooks（替换 JSONL 轮询）

### Hooks 机制

Claude Code 支持在 `~/.claude/settings.json` 中配置 hooks，在以下生命周期事件触发时执行 shell 命令：

| 事件 | 触发时机 | 可用环境变量 |
|------|---------|------------|
| `PreToolUse` | 工具调用开始前 | `CLAUDE_TOOL_NAME`, `CLAUDE_PROJECT_DIR`, `CLAUDE_SESSION_ID` |
| `PostToolUse` | 工具调用完成后 | 同上，另有 `CLAUDE_TOOL_OUTPUT` |
| `Stop` | Claude 本轮回答完成 | `CLAUDE_PROJECT_DIR`, `CLAUDE_SESSION_ID` |
| `Notification` | Claude 请求用户注意 | `CLAUDE_PROJECT_DIR` |

### ccweb 自动管理 Hooks

ccweb 在启动时自动写入全局 hooks，停止时清理。

**`~/.ccweb/port` 文件：**
- `index.ts` 的 `tryListen()` 成功回调中写入当前端口（覆盖写）
- `shutdown()` 中删除此文件
- Hook 命令通过 `cat ~/.ccweb/port` 读取端口，调用本地 HTTP 接口

**Hook 命令格式（以 PreToolUse 为例）：**

```bash
curl -sf -X POST \
  "http://localhost:$(cat ~/.ccweb/port)/api/hooks" \
  -H "Content-Type: application/json" \
  -d "{\"event\":\"pre_tool\",\"tool\":\"$CLAUDE_TOOL_NAME\",\"dir\":\"$CLAUDE_PROJECT_DIR\",\"session\":\"$CLAUDE_SESSION_ID\"}" \
  || true
```

`|| true` 确保 ccweb 未运行时静默失败，不影响 Claude Code 正常使用。

**写入的 `~/.claude/settings.json` hooks 结构：**

```json
{
  "hooks": {
    "PreToolUse": [{
      "hooks": [{ "type": "command", "command": "<pre_tool curl command>" }]
    }],
    "PostToolUse": [{
      "hooks": [{ "type": "command", "command": "<post_tool curl command>" }]
    }],
    "Stop": [{
      "hooks": [{ "type": "command", "command": "<stop curl command>" }]
    }]
  }
}
```

ccweb 写入时**合并**已有 hooks，不覆盖用户自定义的其他 hooks：读取现有配置 → 追加 ccweb 条目 → **原子写回**（同 `config.ts` 的 `atomicWriteSync` 模式，防止与用户同时编辑产生竞争）。卸载时精确移除 ccweb 添加的条目，保留其他内容。

**幂等性保证（防重复写入）：**

`install()` 内部第一步始终先调用 `uninstall()`，再追加新条目。无论上次是正常退出还是 `SIGKILL`/断电等意外崩溃导致清理代码未执行，重启后都不会产生重复 hook 条目。

ccweb hook 命令末尾附加唯一标记注释，供 `uninstall()` 精确识别和过滤：

```bash
curl -sf -X POST "http://localhost:$(cat ~/.ccweb/port)/api/hooks" \
  -H "Content-Type: application/json" \
  -d "{...}" || true  # ccweb-hook
```

`uninstall()` 遍历 `PreToolUse`、`PostToolUse`、`Stop` 三个事件，过滤掉 `command` 包含 `# ccweb-hook` 的条目，保留其余用户自定义内容，原子写回。

### 后端变更

#### 新增：`/api/hooks` 接口（`routes/hooks.ts`）

```
POST /api/hooks
Body: { event: "pre_tool"|"post_tool"|"stop"|"notification", tool?: string, dir: string, session?: string }
```

- **无需 JWT 认证**：仅接受 localhost 请求（`isLocalRequest` 校验），拒绝外网请求
- 通过 `dir`（`CLAUDE_PROJECT_DIR`）匹配 `project.folderPath` 找到 projectId
- 若 `dir` 无法匹配任何项目（如用户在 ccweb 外自行运行 claude），静默返回 200 忽略
- 多用户场景安全：`dir` 是完整文件路径，每个用户的项目路径唯一，不会跨用户匹配

#### 修改：`SessionManager`

- **移除** `setInterval` 2s 轮询定时器（`WatchState.pollTimer` 字段删除）
- **新增** `triggerRead(projectId)` 公开方法：立即执行一次 `readNewLines()`

**Hook 事件处理逻辑（关键）：**

| 事件 | 操作 | 是否调用 triggerRead |
|------|------|---------------------|
| `pre_tool` | 用 `CLAUDE_TOOL_NAME` 直接更新内存中的 `semanticStatus`，emit `semantic` 事件 | **否**（此时 JSONL 尚未写入工具记录，读取无意义） |
| `post_tool` | 调用 `triggerRead()` 读取 JSONL 新行（含工具结果块）| **是** |
| `stop` | 调用 `triggerRead()` 读取最终文本块，然后清除 `semanticStatus` | **是** |

`pre_tool` 必须**不触发 triggerRead**——此时 JSONL 内容尚未写入工具调用记录，强行读取只会得到上一轮的旧内容。语义状态直接从 hook 环境变量 `CLAUDE_TOOL_NAME` 更新，无需读文件。

#### 新增：`HooksManager`（`hooks-manager.ts`）

负责 `~/.claude/settings.json` 的读写和 hooks 的生命周期管理：

```typescript
class HooksManager {
  install(): void      // 启动时调用，写入 ccweb hooks（合并，原子写）
  uninstall(): void    // 停止时调用，精确移除 ccweb hooks
  isInstalled(): boolean
}
```

ccweb 进程启动时调用 `install()`，监听 `SIGTERM`/`SIGINT` 时调用 `uninstall()`，同时删除 `~/.ccweb/port`。

### 数据流变化

**原来（轮询）：**
```
JSONL file ──[每2s]──▶ SessionManager.poll() ──▶ emit('semantic') ──▶ Dashboard WS
```

**现在（事件驱动）：**
```
Claude Code ──[工具开始]──▶ PreToolUse hook  ──▶ POST /api/hooks ──▶ semanticStatus 内存更新 ──▶ emit('semantic') ──▶ Dashboard WS
Claude Code ──[工具结束]──▶ PostToolUse hook ──▶ POST /api/hooks ──▶ triggerRead() ──▶ emit('chat_message') ──▶ ChatView WS
Claude Code ──[回答完成]──▶ Stop hook        ──▶ POST /api/hooks ──▶ triggerRead() ──▶ emit('chat_message') + clear semantic ──▶ WS
```

### 兼容性说明

- Terminal 项目完全兼容，行为不变，只是响应更快
- Hooks 全局生效：其他终端里的 claude 会话触发时，`/api/hooks` 通过 `dir` 找不到 projectId 则静默忽略，不影响正常使用
- 若用户已有自定义 hooks，ccweb 追加而非覆盖，卸载时也只删除自己的条目

---

## 方案二：Chat SDK 模式

### 项目模式

项目增加 `mode` 字段，存入 `.ccweb/project.json` 和全局 `projects.json`：

```typescript
type ProjectMode = 'terminal' | 'chat';
```

**向后兼容**：读取旧项目时 `mode` 字段缺失，在 `getProject()` / `getProjects()` 返回处 fallback 为 `'terminal'`（代码层 `project.mode ?? 'terminal'`），无需 migration 写回。`migrateProjectConfigs()` 不扩展。

### Chat 模式进程（`ChatProcessManager`，新增）

**启动命令：**

```bash
claude --print \
  --output-format stream-json \
  --input-format stream-json \
  --include-partial-messages \
  --verbose \
  [--continue]                         # 非首次启动时（hasExistingSession 为 true）
  [--dangerously-skip-permissions]     # permissionMode = 'unlimited' 时
```

`--include-partial-messages` 是逐字流式的必要条件，必须始终包含。

进程以 `child_process.spawn`（非 PTY）方式启动，stdin/stdout 作为管道持续开放。

**发送用户消息：**

```typescript
childProcess.stdin.write(JSON.stringify({
  type: 'user',
  message: { role: 'user', content: userText }
}) + '\n');
```

**解析输出流（stdout 逐行）：**

| 事件类型 | 处理 |
|---------|------|
| `system` (subtype: init) | 提取 `session_id` 并保存；调用 `sessionManager.startSession()` 创建 ccweb session 记录 |
| `assistant` (stop_reason: null, `--include-partial-messages`) | 推送 `chat_stream` delta 到前端 |
| `assistant` (stop_reason: non-null) | 推送最终完整消息；通知 sessionManager 写入 |
| `result` | 推送 `chat_turn_end`，含 cost；标记本轮结束 |
| `rate_limit_event` | 推送 `chat_rate_limit` 到前端 |

**进程崩溃重启：**

进程 `onExit` 时，若非主动停止（`intentionalStop = false`）：
1. 推送 `status: restarting` 到前端
2. 3s 后以 `--continue` 重启
3. 重启后推送 `status: running`

与 `TerminalManager.handleExit()` 逻辑对称。

**session 集成：**
- 进程启动时（收到 `system.init`）：调用 `sessionManager.startSession(projectId, folderPath)`，触发 JSONL 文件监听（Chat 模式 SDK 进程同样写 JSONL 到 `~/.claude/projects/`）
- Chat 模式下 `sessionManager` 的 `triggerRead()` 由 Hooks 同样触发（Chat 模式进程也会触发全局 hooks）
- Chat 模式不使用 `--no-session-persistence`，JSONL 正常写入以支持 `--continue`

### 新增 WebSocket 消息类型

**Client → Server（Chat 模式专用）：**

| 类型 | Payload | 说明 |
|------|---------|------|
| `chat_input` | `{ text: string }` | 用户发送消息 |
| `chat_interrupt` | `{}` | 中断当前生成 |

**Server → Client（Chat 模式专用）：**

| 类型 | Payload | 说明 |
|------|---------|------|
| `chat_stream` | `{ delta: string, type: 'text'\|'thinking' }` | 流式 token（逐字） |
| `chat_tool_start` | `{ name: string, input: object }` | 工具调用开始（来自 SDK stdout 的 `tool_use` 块，携带完整 input 对象） |
| `chat_tool_end` | `{ name: string, output: string }` | 工具调用结束（来自 SDK stdout 的 `tool_result` 块） |
| `chat_turn_end` | `{ cost_usd: number }` | 本轮完成 |
| `chat_rate_limit` | `{ resetsAt: number }` | 限速信息 |

**`chat_interrupt` 处理：**
1. 向进程发送 `SIGINT`，进程退出
2. 前端已展示的流式内容保留（不回滚），追加标注"[已中断]"
3. 进程**立即**以 `--continue` 重启（不需要 3s 延迟，与崩溃重启不同），重启后处于等待输入状态，不自动发送任何消息
4. 注意：被中断的不完整 assistant 消息不会写入 JSONL（claude 未正常结束），ccweb 不做额外补写

### 模式切换

**ProjectHeader** 新增模式切换按钮：

1. 前端发送 `POST /api/projects/:id/switch-mode { mode: 'terminal'|'chat' }`
2. 后端：停止当前进程（`terminalManager.stop()` 或 `chatProcessManager.stop()`）
   - **注意**：`terminalManager.stop()` 会将 `project.status` 设为 `'stopped'`，随后立即以新模式重启，status 恢复 `'running'`；若 ccweb 在 stop 后、重启前崩溃，项目将停留在 `stopped` 状态，需用户手动 Start（可接受的 Known Limitation）
3. 更新 `project.mode`，保存到 `projects.json` 和 `.ccweb/project.json`
4. 以新模式 + `--continue` 重启
5. 返回更新后的 project 对象，前端刷新 UI

切换期间前端显示 loading 状态（约 2-3s）。切换后：
- 对话上下文完全保留（同一 session_id，`--continue` 续接，已验证）
- Terminal → Chat：Terminal Tab 隐藏，出现输入框
- Chat → Terminal：输入框隐藏，Terminal Tab 恢复

### Update 流程兼容性

`routes/update.ts` 的 `POST /api/update/prepare` 依赖 `terminalManager.writeRaw()` 发送记忆保存指令，以及 `terminalManager.getLastActivityAt()` 检测空闲。

Chat 模式无 PTY，处理策略：
- `prepare` 接口检测项目 mode；若为 `chat` 模式，跳过记忆保存指令，直接停止 Chat 进程（调用 `chatProcessManager.stop()`）
- `getLastActivityAt()` 对 Chat 模式返回 `ChatProcessManager.lastActivityAt`（由 stdout 数据流更新）

### 前端变更

#### ProjectPage / TerminalView

- Terminal 模式：现有逻辑不变
- Chat 模式：
  - 隐藏 Terminal Tab（或灰化并提示"Chat 模式下不可用"）
  - Chat Tab 变为主界面
  - 底部出现 `ChatInputBar` 消息输入框

#### ChatView 增强

- 支持 `chat_stream` 逐字追加（streaming cursor 效果）
- tool_use / tool_result 实时展示（来自 `chat_tool_start` / `chat_tool_end`）
- 显示每轮 cost（来自 `chat_turn_end`）
- 中断按钮（发送 `chat_interrupt`），仅 Chat 模式可见

#### 创建项目 Dialog（NewProjectDialog）

- 新增模式选择步骤（第 3 步后插入，或合并到第 1 步）
- 默认 Terminal；Chat 模式标注"流式对话，无终端"

### 数据存储

Chat 模式的消息历史写入 `.ccweb/sessions/`（与 Terminal 模式相同格式）。SDK 进程自身也写 JSONL 到 `~/.claude/projects/`（不使用 `--no-session-persistence`），供 `--continue` 和 `sessionManager` 读取。

---

## 不在本期范围内

- `Notification` hook 的 UI 展示（闪烁/提示）
- Chat 模式下 FileTree 的写操作支持（保留只读展示）
- Chat 模式的 `--resume <session_id>` 历史会话切换
- opencode / codex / qwen 的 Chat 模式支持

---

## 文件改动清单

### 后端（新增/修改）

| 文件 | 类型 | 说明 |
|------|------|------|
| `backend/src/hooks-manager.ts` | 新增 | 管理 `~/.claude/settings.json` hooks 写入/清理（原子写） |
| `backend/src/chat-process-manager.ts` | 新增 | SDK 模式进程管理，stdin/stdout 管道，崩溃重启，lastActivityAt |
| `backend/src/routes/hooks.ts` | 新增 | `POST /api/hooks`，localhost only，dir → projectId 映射 |
| `backend/src/session-manager.ts` | 修改 | 移除 setInterval，新增 `triggerRead()` 和 `startSession()` 公开方法，接受外部触发 |
| `backend/src/index.ts` | 修改 | 注册 hooks 路由；Chat 模式 WS 处理；启动写 `~/.ccweb/port`；shutdown 删 port 文件并调用 HooksManager.uninstall() |
| `backend/src/routes/projects.ts` | 修改 | 新增 `POST /:id/switch-mode`；项目 CRUD 带 mode 字段 |
| `backend/src/routes/update.ts` | 修改 | prepare 接口适配 Chat 模式（跳过 writeRaw，改用 chatProcessManager.stop()） |
| `backend/src/config.ts` | 修改 | `Project` 和 `ProjectConfig` 类型新增 `mode?: ProjectMode`；读取时 fallback `?? 'terminal'` |

### 前端（新增/修改）

| 文件 | 类型 | 说明 |
|------|------|------|
| `frontend/src/components/ChatView.tsx` | 修改 | 流式 token 追加，tool 事件实时展示，中断按钮 |
| `frontend/src/components/ChatInputBar.tsx` | 新增 | Chat 模式消息输入框组件 |
| `frontend/src/components/ProjectHeader.tsx` | 修改 | 新增模式切换按钮 |
| `frontend/src/components/TerminalView.tsx` | 修改 | Chat 模式下隐藏 Terminal Tab，显示 ChatInputBar |
| `frontend/src/components/NewProjectDialog.tsx` | 修改 | 新增模式选择步骤 |
| `frontend/src/lib/websocket.ts` | 修改 | 新增 chat_stream / chat_tool_start / chat_turn_end 等消息类型 |
| `frontend/src/lib/api.ts` | 修改 | 新增 `switchProjectMode()` API 调用 |
| `frontend/src/types.ts` | 修改 | `Project` 类型新增 `mode` 字段 |
