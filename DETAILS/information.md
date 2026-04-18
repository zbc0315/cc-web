# 信息系统（Information）

## 概述

自动同步 Claude Code / Codex / OpenCode / Qwen / Gemini 的 JSONL 聊天记录到 `{project}/.information/{convId}/`，为 ChatOverlay / MobileChatView / MonitorPane **加载历史会话**提供只读 API。

> ⚠️ 迭代缩减（condense）和信息重整（reorganize）功能已在 v2026.4.19-l 之后被移除，后端现在只有同步 + 只读。

## 数据模型

- 一个 JSONL 文件 = 一个对话（以 JSONL 文件名作为对话 ID）
- 每个对话目录：`{project}/.information/{convId}/`
  - `meta.json` — 摘要、token 计数、展开历史（expand_stats）
  - `v0.md` — 原始对话（`## U1/A1` 分轮次格式）

## 核心模块

### conversation-sync.ts
- 读取 `~/.claude/projects/{encoded-path}/` 下的 JSONL 文件
- 解析为轮次，连续 assistant blocks 自动合并
- 新轮次追加到 v0，轮次 ID 重映射
- 导出：`infoDir`、`readMeta`、`writeMeta`、`listConversationIds`、`syncFromJsonl`、`compensationSync`

### types.ts
- `ExpandRecord` 等数据类型

## API 端点（只读）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/information/:projectId/conversations` | 列出对话（分页 limit/offset） |
| GET | `/api/information/:projectId/conversations/:convId` | 读取对话内容（`?version=`、`?turns=U1,U2,...` 过滤、`?source=user|llm` 跟踪展开来源） |

## 触发时机

- **Stop hook**: `routes/hooks.ts` 在 conversation 结束时调用 `syncFromJsonl()`
- **启动补偿**: `index.ts` 启动时 + 每 5 分钟调用 `compensationSync` 扫描遗漏

## 前端消费

- `ChatOverlay`（桌面）：mount 时调 `getConversations` + `getConversationDetail` 加载历史气泡
- `MobileChatView`（手机）：同上
- `MonitorPane`（监控大屏）：`chat_subscribe` 前先拉一次历史填充最近几轮

三者都只用**读** API，不做 delete / sync / condense / reorganize。

## 已移除的能力

- 管理型 UI `InformationPanel`（LeftPanel 的"信息"tab 一起删）
- `backend/src/information/condenser.ts`（Haiku 迭代缩减 + 重整）
- 4 个管理型端点：DELETE 对话、POST condense、POST reorganize、POST sync
- 4 个前端管理 API：`deleteConversation`、`syncConversations`、`condenseConversation_api`、`reorganizeConversation_api`

## 关键文件

- `backend/src/information/conversation-sync.ts`
- `backend/src/information/types.ts`
- `backend/src/routes/information.ts`（只读 2 个端点）
