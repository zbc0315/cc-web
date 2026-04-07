# 适配器系统（Adapters）

## 概述

适配器模式支持多种 CLI 工具，统一接口供 TerminalManager 使用。

## 支持的 CLI

| 适配器 | CLI | 成熟度 | 命令示例 |
|--------|-----|--------|----------|
| `claude-adapter.ts` | claude | 成熟 | `claude [--dangerously-skip-permissions] [--continue]` |
| `codex-adapter.ts` | codex | 中等 | JSONL 解析 + getSessionFilesForProject |
| `opencode-adapter.ts` | opencode | 基础 | `opencode [--continue]` |
| `qwen-adapter.ts` | qwen | 基础 | 最小支持 |
| `gemini-adapter.ts` | gemini | 中等 | `gemini [--yolo] [--resume]` |

## 接口

每个适配器实现统一接口（`backend/src/adapters/types.ts`），提供：
- 启动命令构造
- JSONL 会话文件路径
- 聊天记录解析
- Hooks 配置路径

## Claude 适配器特有功能

- JSONL 解析：text / thinking / tool_use / tool_result blocks
- Hooks：PreToolUse / PostToolUse / Stop + statusLine
- 会话路径：`~/.claude/projects/{encoded-path}/`

## Gemini 适配器特有功能

- 会话格式：JSON 文件（非 JSONL），每个文件一个完整 ConversationRecord
- 会话路径：`~/.gemini/tmp/<project_hash>/chats/session-*.json`（project_hash = SHA-256 前 16 位）
- Hooks：AfterAgent / SessionEnd（通过 ~/.gemini/settings.json 配置）
- 解析：GeminiPart（text / thought / functionCall / functionResponse）
- 模型：gemini-2.5-pro / gemini-2.5-flash / gemini-2.0-flash
- Slash commands：/help /chat /resume /model /compress /plan /tools /stats 等

## 关键文件

- `backend/src/adapters/` 目录
- `backend/src/adapters/types.ts` — 统一接口定义
- `backend/src/adapters/index.ts` — 适配器注册
