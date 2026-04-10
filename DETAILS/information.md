# 信息系统（Information）

## 概述

自动同步 Claude Code JSONL 聊天记录，支持迭代缩减和信息重整。

## 数据模型

- 一个 JSONL 文件 = 一个对话（以 JSONL 文件名作为对话 ID）
- 每个对话目录：`{project}/.information/{convId}/`
  - `meta.json` — 摘要、token 计数、展开历史
  - `v0.md` — 原始对话
  - `v1.md`, `v2.md`... — 缩减版本

## 核心模块

### conversation-sync.ts
- 读取 `~/.claude/projects/{encoded-path}/` 下的 JSONL 文件
- 解析为轮次，连续 assistant blocks 自动合并
- 新轮次追加到所有版本（v0/v1/v2），轮次 ID 重映射

### condenser.ts
- 迭代滑动窗口缩减（半窗口 80K tokens）
- 通过 `claude -p --model haiku` 调用
- 标记格式：`[c1,45%]`（缩减次数，压缩率）
- 不可缩减检测（中文关键词：不要/别/错了/改成）

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/information/:projectId/conversations` | 列出对话 |
| GET | `/api/information/:projectId/conversations/:convId` | 读取对话 |
| DELETE | `/api/information/:projectId/conversations/:convId` | 删除对话 |
| POST | `/api/information/:projectId/condense` | 触发缩减 |
| POST | `/api/information/:projectId/reorganize` | 触发重整 |
| POST | `/api/information/:projectId/sync` | 手动同步（?force=true 强制重建 v0） |

## 触发时机

- **Stop hook**: 对话结束时自动同步
- **启动补偿**: 服务启动时扫描遗漏
- **定时扫描**: 每 5 分钟

## 前端

- `InformationPanel.tsx` — 侧边栏信息标签页
- 缩减/重整按钮 + 进度条 + 错误 toast

## 关键文件

- `backend/src/information/conversation-sync.ts`
- `backend/src/information/condenser.ts`
- `backend/src/routes/information.ts`
- `frontend/src/components/InformationPanel.tsx`
