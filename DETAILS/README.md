# DETAILS — 功能模块文档索引

本目录记录 ccweb 各功能模块的详细设计与实现细节。

## 模块列表

| 模块 | 文件 | 状态 | 说明 |
|------|------|------|------|
| 认证系统 | [auth.md](auth.md) | 活跃 | JWT 认证、localhost 预认证、多用户 |
| 终端管理 | [terminal.md](terminal.md) | 活跃 | node-pty 进程管理、WebSocket 实时推送 |
| 文件系统 | [filesystem.md](filesystem.md) | 活跃 | 文件浏览、上传、下载、删除、安全校验 |
| 信息系统 | [information.md](information.md) | 活跃 | JSONL 对话同步、缩减、重整 |
| 监控大屏 | [monitor.md](monitor.md) | 活跃 | 全屏网格、实时聊天、拖拽排序 |
| 上下文监控 | [context-window.md](context-window.md) | 活跃 | status line 推送、进度条显示 |
| 计划控制 | [plan-control.md](plan-control.md) | 活跃 | 任务树解析与执行 |
| 适配器 | [adapters.md](adapters.md) | 活跃 | 多 CLI 工具支持 |
| 云备份 | [backup.md](backup.md) | 活跃 | Google Drive / OneDrive / Dropbox |
| 插件系统 | [plugins.md](plugins.md) | 活跃 | manifest + 前后端隔离 |
| SkillHub | — | 活跃 | GitHub-based 快捷键分享平台 |
| 对话分享 | — | 活跃 | 公开对话分享链接 |
| 通知系统 | — | 活跃 | 通知配置与推送 |
| 手机界面 | [mobile.md](mobile.md) | 活跃 | 项目列表、聊天、侧边面板、PWA |
| 桌面对话框 | [chat-overlay.md](chat-overlay.md) | 活跃 | 终端上层聊天覆盖层（替代 TerminalDraftInput） |
| 记忆池 | [memory-pool.md](memory-pool.md) | 已停用 | 浮力排序知识球 |

## 依赖关系

```
终端管理 ──→ 适配器（选择 CLI 命令）
    │
    ├──→ 会话管理（tail JSONL → 解析聊天记录）
    │        │
    │        ├──→ 信息系统（同步对话 → 缩减/重整）
    │        └──→ 对话分享（选择对话 → 生成公开链接）
    │
    ├──→ 监控大屏（chat_subscribe → 实时显示）
    ├──→ 桌面对话框（onChatMessage 回调 → 气泡显示 + PTY 写入）
    └──→ 手机界面（chat_subscribe + context_update → 聊天 + 上下文）

Hooks 管理 ──→ 上下文监控（statusLine → context_update）
           ──→ 信息系统（Stop hook → 触发同步）

文件系统  ← 独立模块（无强依赖）
计划控制  ← 依赖终端管理（执行命令）
云备份    ← 依赖文件系统（读取项目文件）
插件系统  ← 独立模块（manifest 驱动）
SkillHub  ← 独立模块（GitHub API 驱动）
通知系统  ← 独立模块（配置驱动）
认证系统  ← 所有 API 的前置中间件
```
