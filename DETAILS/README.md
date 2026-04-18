# DETAILS — 功能模块文档索引

本目录记录 ccweb 各功能模块的详细设计与实现细节。

## 模块列表

| 模块 | 文件 | 状态 | 说明 |
|------|------|------|------|
| 认证系统 | [auth.md](auth.md) | 活跃 | JWT 认证、localhost 预认证、多用户 |
| 终端管理 | [terminal.md](terminal.md) | 活跃 | node-pty 进程管理、WebSocket 实时推送 |
| 文件系统 | [filesystem.md](filesystem.md) | 活跃 | 文件浏览、上传、下载、删除、安全校验 |
| 聊天历史 | — | 活跃 | 直读 CLI JSONL，稳定 block id 去重（`/api/projects/:id/chat-history`）|
| 监控大屏 | [monitor.md](monitor.md) | 活跃 | 全屏网格、实时聊天、拖拽排序 |
| 上下文监控 | [context-window.md](context-window.md) | 活跃 | status line 推送、进度条显示 |
| 计划控制 | [plan-control.md](plan-control.md) | 活跃 | 任务树解析与执行 |
| 适配器 | [adapters.md](adapters.md) | 活跃 | 多 CLI 工具支持 |
| 云备份 | [backup.md](backup.md) | 活跃 | Google Drive / OneDrive / Dropbox |
| 插件系统 | [plugins.md](plugins.md) | 活跃 | manifest + 前后端隔离 |
| SkillHub | — | 活跃 | GitHub-based 快捷键分享平台 |
| 通知系统 | — | 活跃 | 通知配置与推送 |
| 手机界面 | [mobile.md](mobile.md) | 活跃 | 项目列表、聊天、侧边面板、PWA |
| 桌面对话框 | [chat-overlay.md](chat-overlay.md) | 活跃 | 终端半透明遮罩 + 气泡折叠/展开 + 输入贴底 |
| 权限审批 | [approval-flow.md](approval-flow.md) | 活跃 | Claude Code `PermissionRequest` hook → 遮罩审批卡片 |
| 远程自更新 | [remote-update.md](remote-update.md) | 活跃 | 浏览器触发 npm install + 服务重启（detached agent） |

## 依赖关系

```
终端管理 ──→ 适配器（选择 CLI 命令）
    │
    ├──→ 会话管理（tail CLI 原生 JSONL → 解析 ChatBlock + 稳定 id）
    │        │
    │        ├──→ 聊天历史 HTTP 端点（`/chat-history` lazy discover）
    │        ├──→ WS `chat_subscribe` 回放（replay=N）
    │        ├──→ WS 实时 `chat_message` 推送（hook → triggerRead）
    │        └──→ 语义状态推送（`semantic_update`，PreToolUse 即时）
    │
    ├──→ 监控大屏（chat_subscribe → 实时显示）
    ├──→ 桌面对话框（onChatMessage 回调 → 气泡显示 + PTY 写入）
    └──→ 手机界面（chat_subscribe + context_update → 聊天 + 上下文）

Hooks 管理 ──→ 上下文监控（statusLine → context_update）
           ──→ 权限审批（PermissionRequest hook → 遮罩卡片）

文件系统  ← 独立模块（无强依赖）
计划控制  ← 依赖终端管理（执行命令）
云备份    ← 依赖文件系统（读取项目文件）
插件系统  ← 独立模块（manifest 驱动）
SkillHub  ← 独立模块（GitHub API 驱动）
通知系统  ← 独立模块（配置驱动）
认证系统  ← 所有 API 的前置中间件
```
