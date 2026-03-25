# Hooks + Chat SDK 模式设计文档

**日期**: 2026-03-25
**版本**: v1.0
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

ccweb 在启动时自动写入全局 hooks，停止时清理。Hook 命令通过读取 `~/.ccweb/port` 文件获取 ccweb 当前端口，调用本地 HTTP 接口。

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

ccweb 写入时**合并**已有 hooks，不覆盖用户自定义的其他 hooks。读取现有配置 → 追加 ccweb 条目 → 写回。

### 后端变更

#### 新增：`/api/hooks` 接口（`routes/hooks.ts`）

```
POST /api/hooks
Body: { event: "pre_tool"|"post_tool"|"stop"|"notification", tool?: string, dir: string, session?: string }
```

- 无需 JWT 认证（仅接受 localhost 请求，`isLocalRequest` 校验）
- 通过 `dir`（`CLAUDE_PROJECT_DIR`）匹配 projectId
- 根据事件类型执行相应逻辑

#### 修改：`SessionManager`

- **移除** `setInterval` 2s 轮询定时器
- **新增** `triggerRead(projectId)` 公开方法：立即读取 JSONL 新增行
- Hook 事件处理：
  - `pre_tool` → 立即更新 `semanticStatus`（phase: `tool_use`, detail: tool name）→ emit `semantic` 事件
  - `post_tool` → 调用 `triggerRead()` 读取 JSONL 新行（含工具结果）→ emit 事件
  - `stop` → 调用 `triggerRead()` 读取最终文本 → 清除 semantic status

#### 新增：`HooksManager`（`hooks-manager.ts`）

负责 `~/.claude/settings.json` 的读写和 hooks 的生命周期管理：

```typescript
class HooksManager {
  install(): void      // 启动时调用，写入 ccweb hooks（合并，不覆盖）
  uninstall(): void    // 停止时调用，移除 ccweb hooks
  isInstalled(): boolean
}
```

ccweb 进程启动时调用 `install()`，监听 `SIGTERM`/`SIGINT` 时调用 `uninstall()`。

### 数据流变化

**原来（轮询）：**
```
JSONL file ──[每2s]──▶ SessionManager.poll() ──▶ emit('semantic') ──▶ Dashboard WS
```

**现在（事件驱动）：**
```
Claude Code ──[工具开始]──▶ PreToolUse hook ──▶ POST /api/hooks ──▶ SessionManager.triggerRead() / emit('semantic') ──▶ Dashboard WS
Claude Code ──[工具结束]──▶ PostToolUse hook ──▶ POST /api/hooks ──▶ SessionManager.triggerRead() ──▶ emit('chat_message') ──▶ ChatView WS
Claude Code ──[回答完成]──▶ Stop hook ──▶ POST /api/hooks ──▶ SessionManager.triggerRead() ──▶ emit('chat_message') ──▶ ChatView WS
```

### 兼容性说明

- Terminal 项目完全兼容，行为不变，只是响应更快
- Hooks 仅在 ccweb 管理的 claude 会话中有意义；其他终端里的 claude 会话触发 hooks 时，`/api/hooks` 通过 `dir` 找不到对应 projectId 则静默忽略
- 若用户已有自定义 hooks，ccweb 追加而非覆盖

---

## 方案二：Chat SDK 模式

### 项目模式

项目增加 `mode` 字段，存入 `.ccweb/project.json` 和全局 `projects.json`：

```typescript
type ProjectMode = 'terminal' | 'chat';
// 默认值: 'terminal'（向后兼容）
```

### Chat 模式进程（`ChatProcessManager`，新增）

**启动命令：**

```bash
claude --print \
  --output-format stream-json \
  --input-format stream-json \
  --verbose \
  [--continue]                         # 非首次启动时
  [--dangerously-skip-permissions]     # permissionMode = 'unlimited' 时
```

进程以 `spawn`（非 PTY）方式启动，stdin/stdout 作为管道持续开放。

**发送用户消息：**

```typescript
// 写入进程 stdin
process.stdin.write(JSON.stringify({
  type: 'user',
  message: { role: 'user', content: userText }
}) + '\n');
```

**解析输出流（stdout 逐行）：**

| 事件类型 | 处理 |
|---------|------|
| `system` (subtype: init) | 提取 session_id，保存；提取工具列表 |
| `assistant` (stop_reason: null) | 流式推送 `chat_stream` 到前端（逐字） |
| `assistant` (stop_reason: non-null) | 推送最终消息，写入 session 存储 |
| `result` | 推送 `chat_turn_end`，含 cost 信息 |
| `rate_limit_event` | 推送 `chat_rate_limit` 到前端 |

注意：需加 `--include-partial-messages` 才能获得真正的逐字流式 assistant token。

### 新增 WebSocket 消息类型

**Client → Server（Chat 模式专用）：**

| 类型 | Payload | 说明 |
|------|---------|------|
| `chat_input` | `{ text: string }` | 用户发送消息 |
| `chat_interrupt` | `{}` | 中断当前生成（kill + restart with --continue） |

**Server → Client（Chat 模式专用）：**

| 类型 | Payload | 说明 |
|------|---------|------|
| `chat_stream` | `{ delta: string, type: 'text'\|'thinking' }` | 流式 token |
| `chat_tool_start` | `{ name: string, input: object }` | 工具调用开始 |
| `chat_tool_end` | `{ name: string, output: string }` | 工具调用结束 |
| `chat_turn_end` | `{ cost_usd: number }` | 本轮完成 |
| `chat_rate_limit` | `{ resetsAt: number }` | 限速信息 |

### 模式切换

**ProjectHeader** 新增模式切换按钮（Terminal 项目显示"切换到 Chat 模式"，反之亦然）：

1. 前端发送 `POST /api/projects/:id/switch-mode`
2. 后端：停止当前进程（`terminalManager.stop()` 或 `chatProcessManager.stop()`）
3. 更新 project.mode，保存
4. 以新模式 + `--continue` 重启
5. 返回新模式，前端刷新 UI

切换期间前端显示 loading 状态（约 2-3s）。切换后：
- 对话上下文完全保留（同一 session_id，`--continue` 续接）
- Terminal → Chat：Terminal Tab 隐藏，出现输入框
- Chat → Terminal：输入框隐藏，Terminal Tab 恢复

### 前端变更

#### ProjectPage / TerminalView

- Terminal 模式：现有逻辑不变
- Chat 模式：
  - 隐藏 Terminal Tab（或灰化并提示"Chat 模式下不可用"）
  - Chat Tab 变为主界面
  - 底部出现消息输入框（替代终端键盘输入）

#### ChatView 增强

- 支持 `chat_stream` 逐字追加（streaming cursor 效果）
- tool_use / tool_result 实时展示（来自 `chat_tool_start` / `chat_tool_end`）
- 显示每轮 cost（来自 `chat_turn_end`）
- 中断按钮（发送 `chat_interrupt`）

#### 创建项目 Dialog（NewProjectDialog）

- 新增第 4 步（或在第 1 步合并）：选择模式（Terminal / Chat）
- 默认 Terminal，Chat 模式标注"流式对话，无终端"

### 数据存储

Chat 模式的消息历史仍写入 `.ccweb/sessions/`（与 Terminal 模式复用），格式不变。SDK 进程保存 JSONL 到 `~/.claude/projects/`（不使用 `--no-session-persistence`）。

---

## 不在本期范围内

- `Notification` hook 的 UI 展示（闪烁/提示）
- Chat 模式下的文件树操作（FileTree 保留，只读展示）
- Chat 模式的 `--resume <session_id>` 切换到历史会话
- opencode / codex / qwen 的 Chat 模式支持

---

## 文件改动清单

### 后端（新增/修改）

| 文件 | 类型 | 说明 |
|------|------|------|
| `backend/src/hooks-manager.ts` | 新增 | 管理 `~/.claude/settings.json` hooks 写入/清理 |
| `backend/src/chat-process-manager.ts` | 新增 | SDK 模式进程管理，stdin/stdout 管道 |
| `backend/src/routes/hooks.ts` | 新增 | `POST /api/hooks` 接收 hook 事件 |
| `backend/src/session-manager.ts` | 修改 | 移除 setInterval，新增 triggerRead()，接受外部触发 |
| `backend/src/terminal-manager.ts` | 微修 | 无需大改，stop() 补充通知 hooks |
| `backend/src/index.ts` | 修改 | 注册 hooks 路由，新增 Chat 模式 WS 处理，启动/停止时调用 HooksManager |
| `backend/src/routes/projects.ts` | 修改 | 新增 `POST /:id/switch-mode`，项目 CRUD 带 mode 字段 |
| `backend/src/config.ts` | 微修 | Project 类型新增 `mode?: ProjectMode` |

### 前端（新增/修改）

| 文件 | 类型 | 说明 |
|------|------|------|
| `frontend/src/components/ChatView.tsx` | 修改 | 支持流式 token 追加，tool 事件实时展示 |
| `frontend/src/components/ChatInputBar.tsx` | 新增 | Chat 模式消息输入框组件 |
| `frontend/src/components/ProjectHeader.tsx` | 修改 | 新增模式切换按钮 |
| `frontend/src/components/TerminalView.tsx` | 修改 | Chat 模式下隐藏 Terminal Tab，显示输入框 |
| `frontend/src/components/NewProjectDialog.tsx` | 修改 | 新增模式选择步骤 |
| `frontend/src/lib/websocket.ts` | 修改 | 新增 chat_stream / chat_tool_start 等消息类型处理 |
| `frontend/src/lib/api.ts` | 修改 | 新增 switchProjectMode API 调用 |
| `frontend/src/types.ts` | 修改 | Project 类型新增 mode 字段 |
