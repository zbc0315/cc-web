# 终端管理

## 概述

通过 node-pty 生成 CLI 进程，WebSocket 双向传输终端数据。

## 核心组件

### TerminalManager (`backend/src/terminal-manager.ts`)
- **生成**: node-pty shell（bash/zsh），注入 `CCWEB_PORT` 环境变量
- **滚动缓冲**: 5MB/终端
- **自动重启**: 崩溃后 5s 重试（intentionalStop=true 除外）
- **活动节流**: 每项目最多 500ms 一次 activity 事件

### SessionManager (`backend/src/session-manager.ts`)
- **职责**: Tail CLI 原生 JSONL，解析为 ChatBlock，emit 到 WS listeners 和 HTTP `/chat-history`
- **JSONL 路径**: `~/.claude/projects/{encoded-path}/{sessionId}.jsonl`（或 adapter 对应的 CLI 原生目录）
- **语义状态**: `{ phase: thinking|tool_use|tool_result|text, detail, updatedAt }`
- **block id**: `sha1(jsonlPath + '\0' + line).slice(0,16)` —— 跨 restart 稳定，供前端 history/live 去重
- **不再自行存档**: v2026.4.19-o 起移除 `.ccweb/sessions/`，CLI JSONL 是唯一真相源

### ChatProcessManager (`backend/src/chat-process-manager.ts`)
- 管理 `claude -p` 等后台 AI 调用（缩减、摘要等）

## WebSocket 协议

### 项目 WebSocket (`/ws/projects/:id`)

**Client → Server:**
- `auth { token }` — 远程认证
- `terminal_subscribe { cols, rows }` — 订阅终端输出
- `terminal_input { data }` — 发送击键
- `terminal_resize { cols, rows }` — 调整终端大小
- `chat_subscribe` — 订阅聊天历史

**Server → Client:**
- `connected { projectId }`
- `terminal_data { data }` — PTY 原始输出
- `status { status }` — running/stopped/restarting
- `chat_message { role, timestamp, blocks[] }`
- `project_stopped { projectId, projectName }`
- `context_update { usedPercentage, ... }`

### 首页 WebSocket (`/ws/dashboard`)

**Server → Client (broadcast):**
- `activity_update { projectId, active, status, semantic }`
- `project_stopped { projectId, projectName }`

## 项目生命周期

```
Created → Running（PTY 活跃）
              ↓ 崩溃
         Restarting（等待 5s）→ Running
              ↓ 手动停止
         Stopped（PTY 已销毁）
```

## 前端组件

- `TerminalView.tsx` — XTerm.js 终端渲染
- `TerminalDraftInput.tsx` — 输入栏、命令历史、自动补全
- `TerminalSearch.tsx` — 终端全文搜索
- `ChatView.tsx` — Markdown 渲染的对话历史
