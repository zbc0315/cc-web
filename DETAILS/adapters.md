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
- 启动命令构造（`buildCommand`, `supportsContinue`）
- 会话文件路径（`getSessionDir`, `getSessionFilesForProject?`）
- 聊天记录解析（`parseLine`, `parseLineBlocks`）
- 整文件解析（`parseSessionFile?` — 用于非 JSONL 工具如 Gemini）
- 文件扩展名声明（`getSessionFileExtension?` — 默认 `.jsonl`，Gemini 返回 `.json`）
- Hooks 配置（`getHooksSettingsPath`, `getHookEvents`, `buildHookCommand`）
- 模型与技能（`getCurrentModel`, `getAvailableModels`, `getSkills`）
- 用量查询（`queryUsage`, `clearUsageCache`）

### JSONL vs 整文件 JSON

session-manager 有两条读取路径：
- **JSONL 工具**（Claude、Codex）：增量读取新行，逐行调用 `parseLine()`
- **JSON 工具**（Gemini）：声明 `getSessionFileExtension()` 返回 `.json`，实现 `parseSessionFile()` 返回全部 ChatBlock[]，session-manager 在文件变化时重读整个文件

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
- Slash commands：/help /chat /resume /model /compress /tools /stats 等
- Hooks 通过 jq stdin/stdout 管线通信（匹配 Gemini CLI 的 hooks 协议）

## 明/暗配色适配

- 终端 spawn 时设置 `COLORFGBG=15;0`（dark 默认），让 Ink-based CLI 正确检测主题
- 前端主题切换时发送工具特定命令：
  - Claude: `/theme dark|light`
  - Gemini: `/settings theme dark|light`
  - Codex: `/theme dark|light`

## 路由验证

`backend/src/routes/projects.ts` 维护 `VALID_CLI_TOOLS` 数组，用于创建/更新项目时校验 `cliTool` 字段。新增适配器后必须同步更新此数组，否则创建项目会返回 400。

## 关键文件

- `backend/src/adapters/` 目录
- `backend/src/adapters/types.ts` — 统一接口定义
- `backend/src/adapters/index.ts` — 适配器注册
- `backend/src/routes/projects.ts` — `VALID_CLI_TOOLS` 校验数组
