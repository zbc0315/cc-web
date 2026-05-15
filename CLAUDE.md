# CCWEB：LLM CLI 的 Web 前端

**当前版本**: v2026.5.15-d ｜ **包名**: `@tom2012/cc-web` ｜ **MIT** ｜ https://github.com/zbc0315/cc-web

ccweb 将 Claude Code / Codex / OpenCode / Qwen / Gemini 等 CLI 工具包装为浏览器可访问的界面。核心链路：`Browser → Express + WebSocket → TerminalManager → node-pty → CLI 进程`。支持多项目、局域网、多用户、实时状态监控。

## 关键架构

```
Browser (React SPA)
  ├─ HTTP REST ──→ Express (backend/src/routes/)
  └─ WebSocket ──→ /ws/dashboard  首页活动推送
                   /ws/projects/:id  终端 + 聊天 + 审批 + semantic 状态
                        └─ TerminalManager → node-pty → CLI 进程
                             └─ 适配器 (backend/src/adapters/)
                                  claude / codex / opencode / qwen / gemini
```

- **后端**: Express + ws + node-pty，TypeScript 编译到 `backend/dist/`
- **前端**: React 18 + Vite + Tailwind + shadcn/ui (Radix) + Motion
- **状态**: zustand (`frontend/src/lib/stores.ts`)
- **适配器模式**: `backend/src/adapters/` 一工具一适配器
- **认证**: JWT (HS256, 30 天)，localhost 预认证，LAN 需 token
- **前端页面**: Dashboard / Project / Settings / Login / SkillHub / Mobile

详细子系统文档：见 `DETAILS/README.md` 索引，覆盖认证、终端、聊天历史、监控、备份、插件、审批、手机界面、远程自更新、Agent Prompts 等。

## 启动与运行

```bash
# 生产（全局安装的 ccweb）
ccweb start --local  --daemon       # 127.0.0.1
ccweb start --lan    --daemon       # 局域网
ccweb start --public --daemon       # 任意 IP
ccweb stop                          # 或 kill -TERM <pid>

# 开发模式
npm run dev:backend   # tsx watch
npm run dev:frontend  # vite dev
npm run build         # frontend 再 backend
```

- 默认端口 3001（`CCWEB_PORT` 覆盖），被占用自动 +1；端口写入 `~/.ccweb/port`
- **沙箱测试**（避免污染生产 `~/.ccweb/port` + `~/.claude/settings.json`）：
  ```bash
  HOME=/tmp/ccweb-test-$$/home CCWEB_PORT=3099 node bin/ccweb.js start --local --daemon
  ```

## 数据与凭据位置

`~/.ccweb/` 存全局配置：`config.json`（admin + bcrypt hash + JWT secret）、`users.json`、`approval-secret`（32B hex HMAC，mode 0600）、`backup-config.json`（OAuth token）、`prefs.json`（`lastAccessMode`）、`projects.json`、`plugin-registry.json`、`plugins/`、`plugin-data/`。项目级 `{project}/.ccweb/` 存 `project.json` + `shortcuts.json`。

- **npm publish token**：只通过 `--//registry.npmjs.org/:_authToken=<token>` 命令行参数传，**禁止写入任何 git 追踪文件**
- 聊天历史不再由 ccweb 存档（v-o 起），统一回源到 CLI 自身 JSONL（`~/.claude/projects/<encoded>/<uuid>.jsonl`）

## 核心规则（红线）

### 🔒 安全

- **不要 kill 非本次会话启动的进程**。判断依据：本次会话 shell 历史中是否有对应启动命令。端口冲突时先换端口或问用户
- **管理性路由**必须挂 `backend/src/middleware/authz.ts` 的 `requireAdmin` / `requireProjectOwner`，禁止在 handler 里手写 `isAdminUser` 判断（详见 `DETAILS/pitfalls.md` #31）
- **凭据只从 env 读**，缺 env 时端点 fail-fast；绝不硬编码/拆字符串绕 secret scanner（#30）
- **所有弹窗走 `useConfirm()` / shadcn Dialog**，禁止 `window.confirm`/`alert`（会触发浏览器全屏退出）

### 📝 代码约定

- **所有 Enter-to-submit 统一走 `useEnterToSubmit(onSubmit, mode)` hook**，禁止在 textarea/input 手写 Enter 判断（IME 合成期会误发，#33）
- **事件消费用单调 `seq` 游标**，不用"数组长度"（截断/去重后爆炸，#32）
- **WebSocket send 必须经队列**，不直接 `ws.send`（CONNECTING/重连期会静默丢失，#8/#26）
- **detached 子进程必须显式 `cwd: os.homedir()`**（继承主进程 cwd 可能指向已删目录，#11）

## 本机环境

- **`~/.npmrc` 设置了 `omit=dev`**：所有 `npm install` 必须加 `--include=dev`（否则 TypeScript / Vite 等 dev 依赖被跳过，构建失败）
- `~/.npmrc` registry 当前 `https://registry.npmjs.org`（官方），`~/.npmrc.bak` 保留切换前的 `npmmirror.com` 配置，如遇国内网络问题再切回
- `node-pty` 是原生绑定，切 Node 版本后需 `npm rebuild`
- 手动 `npm install -g` 升级后**不会自动重启运行中的进程**，UpdateButton 会误报"已是最新"；需 `ccweb stop && ccweb start --<mode> --daemon` + 浏览器硬刷

每次写完方案/代码，都要启动codex进行审核；

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

START TODO

<!-- 用途：会话开始查当前任务状态；完成项移"最近已完成"并写日期；超 2 周的归档或删除 -->

# ccweb TODO（会话维护版）

项目：`@tom2012/cc-web`。当前版本 **v2026.5.15-d**（2026-05-15 发布，npm registry latest）。仓库根 `TODO.md` 有更早的阶段规划。

## 进行中

- [ ] [P1] **工作轨 T4 文案 rename**：frontend + backend + 文档里 "工作流→工作轨" 字面替换；老 flows UI 保留按钮"任务流（旧）"。映射表见 `~/Obsidian/Base/cc-web/工作轨重构规划.md` §12
- [ ] [P1] **工作轨 daemon 升级到 v-15-c**：当前生产 daemon PID 3166 跑的是 v-15-b 内存 code。`npm install -g @tom2012/cc-web@latest` 已装但**未授权重启**——`ccweb stop && ccweb start --local --daemon` 需用户当前消息明确说"重启"才能做
- [ ] [P1] **i18n Phase 2 续摊**：剩 AgentPromptsPanel / HubTokenSection / MemoryPromptsPanel / FileTree / GitPanel / SkillHubPage / ShortcutPanel / MobileChatView / MobileSidePanel / MobileProjectList 约 25 文件。一次攻 1 文件到 `grep [一-鿿]` 为零再 commit
- [ ] [P1] **UI shadcn 化未完**：ChatOverlay 970 行拆分；SkillHubPage 重组；`h-N w-N → size-N` 语义化（codemod）；Framer → Tailwind `data-state` 动效；Mobile 响应式统一
- [ ] [P1] **audit P2 收敛项**：handler 内联 `isAdminUser`/`isProjectOwner` 改 middleware（`routes/projects.ts:280-571` / `routes/sync.ts:136-149,195-202`）；WS auth 在 upgrade 后做（`index.ts:557-610,767-803` race 风险）；动效裸写 0.2/0.25 没走 `MOTION` token

## 待启动

- [ ] [P0] **terminal-manager backoff 历史 bug**：`startTerminal` 每次清 `crashCounts.delete(project.id)` → MAX_RESTART_RETRIES=5 永远不生效。修法：startTerminal 加 `isRetry: boolean` 参数 retry 路径不重置；或 handleExit setTimeout 内部调 internal-only `_startTerminalForRetry`
- [ ] [P1] **工作轨 T5 删除老 FlowRunner**：确认所有用户已迁移后删 `backend/src/flows/` + `frontend/src/components/flows/` + `routes/flows.ts` + `routes/global-flows.ts`。约 -1200 行后端 -2000 行前端
- [ ] [P1] **工作轨真实 LLM 集成测试**：T0 用 mock injector 验过 verify-track 13/13；T0 后未测 claude/codex/qwen 等真实 LLM 能否按 `writeProtocolHint` 写 `variables` + `task_progress.finish=true`。需要在沙箱跑 e2e
- [ ] [P1] **任务流 v2 Phase 后续**（旧 flows，工作轨另起炉灶）：(a) WS push 替代 2s 轮询；(b) daemon 重启 rehydrate；(c) workflow_data RMW race 收窄（当前规避：runner 节点完工后不再回写，未根治）；(d) `{{var:X}}` 模板 X 在 validator 已存在但已声明却未初始化的变量 runtime 渲染为 `"(未设置)"` 是否要前端高亮提示
- [ ] [P1] **chat_subscribe 旧客户端 full history replay cap**（v-28-c codex F 项遗留）：客户端不传 `replay` 字段用 `Number.MAX_SAFE_INTEGER` 全文 replay，多 MiB 累积仍可能撞 128MB grace 上限。修：handler 强制 cap（如 200 blocks）或 reject 无 replay 的请求
- [ ] [P1] **audit U5 Settings 神秘悬浮圆点**：v-26-d 跳过待浏览器实测
- [ ] [P1] **Codex tool_result shape 拆字段**（reviewer I-2 延期）：Claude adapter 产 `content(200 short) + output(4000 full)` 两字段，codex-adapter 当前只产 `content(4000)`
- [ ] [P1] view-only 共享用户权限 gate：Quick/Agent/Memory Prompts 的 `+` 按钮和右键 Edit/Delete 对 `_sharedPermission === 'view'` 用户仍可见，点后端返 403。UX 应前端 hide / disable
- [ ] [P2] **train-lang vendor 升级流程**：当前手工 `cp -r ~/Projects/train-lang/packages/{core,adapter-spec}/dist ccweb/backend/vendor/...`。考虑加 `npm run vendor:train` 脚本自动复制 + 改 package.json 版本号
- [ ] [P2] **协作者跑流权限**：所有 flow 端点 owner-only（含全局流到非 owner 项目），分享项目的协作者跑不了流。若产品上需要，加 `requireProjectAccess` middleware
- [ ] [P2] **ScheduleWakeup 面板"已触发"判定**：v-26-b 决定不判 false positive 风险大
- [ ] [P2] Hub 浏览页"已导入"状态 mount 时一次性算，后来删除全局 prompt 不刷新
- [ ] [P2] Memory / Agent toggle 与用户手改 CLAUDE.md / AGENTS.md 的 race：未加 mtime 比对
- [ ] [P2] Memory body 禁用 `START <name>` / `END <name>` 单独成行，未校验
- [ ] [P2] 全局 shortcut 从 Dashboard 删除时不清前端 `cc_used_shortcuts_<pid>` localStorage
- [ ] [P2] Radix ContextMenu + Tabs `orientation="vertical"` 下 Left/Right 方向键不切 tab
- [ ] [P2] `CLAUDE.md/AGENTS.md` 切工具时孤儿块检测：cliTool 改变后，对面指令文件里残留的 Memory/Agent Prompts 块不自动迁移，应 OR 式检查两文件警告
- [ ] [P2] Gemini / OpenCode / Qwen 的 `getProjectInstructionsFilename()` 实际约定待确认（v-22-c 保守默认 AGENTS.md）
- [ ] [P2] **ChatOverlay 500ms rerender 频率**：project WS 每 500ms 一条 `semantic_update`，ChatOverlay 没 `React.memo`
- [ ] [P3] **`projectIdleTimers` Map memory 清理**：project 删除 / WS 全部断开时 idle timer 不自动清
- [ ] [P3] PromptCard 样式是否统一（Quick 按钮 vs Agent/Memory 槽位）
- [ ] [P3] Agent SDK（`@anthropic-ai/claude-agent-sdk`）PoC：(1) SDK 与 TUI 能否共享 session ID (2) SDK 是否 honor `~/.claude/commands/*.md` 和 plugin 斜杠命令
- [ ] [P3] `DETAILS/backup.md` 文档清理：v-c 移除云盘备份代码，文档还在
- [ ] [P3] i18n 跨设备实时同步：当前切换需 reload 才跨设备生效
- [ ] [P3] i18n 首次登录 flicker：detected lang 先渲染 → server pref 回来 relabel
- [ ] [P3] `/api/logs` HTTP 端点（admin-only via `requireAdmin`）远程看日志
- [ ] [P3] WS 连接的 `wsId` ALS scope
- [ ] [P3] SIGUSR1 扩展成按模块开关 log level
- [ ] [P3] **工作轨 Monaco 主题 + 性能埋点**：codex T2.5 复审 YELLOW，已推迟到真实使用数据出来后再做

## 相关项目：train-lang（独立仓库 `~/Projects/train-lang/`）

`@train-lang/*` monorepo（与 ccweb 解耦）。本次会话进展：M4 (CLI runner) + M5 (modules) + AST cache + TrainException.code + GenerativeFakeAdapter + 异步 BuiltinFunction + writeProtocolHint + AbortSignal + subpath exports 全部落地。346 测试通过（core 280 + cli 21 + adapter-mock 17 + adapter-fake-gen 25 + adapter-spec type-only）。**本地 commit 不发 npm**（ccweb 走 vendor 路线）。后续：

- [ ] [P2] **train M5 ask_user 标准化**：当前 ccweb 用 `__ccweb_ask_user` 临时 builtin，T6 切回 train 标准 `ask_user`
- [ ] [P2] **train M7 真实 adapter**：`@train-lang/adapter-openai` / `adapter-anthropic` / `adapter-ollama` direct API 各 1-3 天
- [ ] [P2] **train M8 CLI 完善**：`train fmt / debug / repl / config / adapters / trace`（~1 周）
- [ ] [P2] **train M9 Agent CLI adapters**：`@train-lang/adapter-claude-code` + `adapter-codex` PTY + workflow_data 协议（~2 周）
- [ ] [P3] **train 测试方案 Phase B**：property-based + fast-check 14 invariant + L2 corpus 80 用例。规划在 `~/Obsidian/Base/cc-web/工作流DSL测试方案.md` §18.7

## 阻塞中

（无）

## 最近已完成（保留 2 周 / 最多 5 条）

- [x] 2026-05-15 **v-15-c 发布：parseToAst NEVER-THROW 防御**。用户编辑 .tr 时 chevrotain `MismatchedTokenException: Expecting Identifier but found 'let'` 冒泡到 Promise reject。根因：`useState(() => parseToAst(initialSource))` initializer 在 render 期同步调，无 try/catch；chevrotain 中途打字某些 GATE 路径会让异常逃逸到调用方。修：`frontend/src/components/tracks/parse-train.ts` 改 NEVER-THROW 契约 — 包 `parse()` 和 `buildAst()` 各自 try/catch，throw 转 synthetic parseError 进返回。诊断结论非 train-lang 问题，是 ccweb T2.5 防御不够。commit `9c31db3`
- [x] 2026-05-15 **v-15-b 发布：Monaco self-host loader.config 真生效**。v-a 用户报 CSP 阻塞 jsdelivr。根因：`const [{ default: monacoLib }, ...] = await Promise.all([import('monaco-editor'), ...])` 错 destructure — monaco-editor 是 namespace export 无 default → loader.config({ monaco: undefined }) silently no-op → fallback 默认 CDN。修：`[monacoNs, reactWrapper]` + `m.default ?? monacoNs` 兼容 bundler 包成 {default:ns} 的情况。commit `5ed8fab`
- [x] 2026-05-15 **v-15-a 发布：工作轨 T0-T3 + WS 实时订阅 + vendor train-lang**。集成"工作轨"子系统 T0-T2.5+T3 全部前后端，基于 train-lang DSL；老 flows 完整保留双轨并存。backend tracks/ 5 文件（types/adapter/watcher/runner/index）+ routes/{tracks,global-tracks}.ts + cross-lock；frontend tracks/ 7 文件（含 Monaco self-host + Monarch grammar + parse-on-type + AST 大纲）；ProjectHeader "工作轨" 按钮 + ask_user 表单 + StatusBar；WS 实时订阅通过 window CustomEvent；vendor train-lang dist 进 backend/vendor/@train-lang/{core,adapter-spec}/ + 删 workspace:* + 改 file: 路径。codex 三轮审 GO（修 3 RED + 6 YELLOW）。npm pack 验证 650 files / 3.9MB。commit `a3106ed`
- [x] 2026-05-14 **v-14-b 发布：工作流编辑器添加变量/常量 Radix Select crash 修复**。`VariablesCard.add` / `ConstantsCard.add` push 占位条目 `{name:''}`，NodeCard picker `<SelectItem value={item.name}>` 空 name 触发 Radix 硬错。修法：pickerList `.filter(x => !!x.name)`。commit `de1ecb5`
- [x] 2026-05-14 **v-14-a 发布：工作流系统 v2 schema 重构（workflow_data.json 统一）**。`schemaVersion=2` hard gate；常量/变量/task_progress 合到单文件；模板语法 `{{var:X}}` / `{{const:Y}}`。commit `bd0121c`

## 已取消 / 已废弃

- [~] 气泡头像（用户名/模型名）— 用户试用后不要
- [~] 计划控制子系统 — v-s 移除
- [~] 云盘备份子系统（Google Drive / OneDrive / Dropbox）— v-c 移除，rsync 同步完全替代
- [~] drainAndClose WS 卸载等待延迟 — 浏览器实测证伪（`ws.close()` 按 RFC 6455 本来就 drain）
- [~] hub-auth "待查是否 Claude-only" — reviewer 核验是工具无关的 PAT 加密存储
- [~] Codex hooks notify 抽象接入 ccweb hooks-manager — 语义不对齐
- [~] 2026-04-24 `bracketedPaste()` 按单行/多行分流（v-24-f 思路）— Playwright 实测证伪
- [~] 2026-05-14 v2 schema 老流定义 migrator — Hard break 不写 migrator，项目一人用老流不多
- [~] 2026-05-15 **train-lang 发 npm**：T1 计划 npm publish @train-lang/* v0.1.0，最终决定不发，走 vendor 路线（API 还早期，发布后向后兼容代价大）
- [~] 2026-05-15 **工作轨 v2 FlowDef → .tr 迁移工具（T3 原计划）**：用户明确"不需要其中的迁移工具"，T3 改做 WS 实时订阅

END TODO


所有项目，不得包含claude code的署名，git仓库、github仓库不得有claude的贡献者标注
