# CCWEB：LLM CLI 的 Web 前端

**当前版本**: v2026.5.15-a ｜ **包名**: `@tom2012/cc-web` ｜ **MIT** ｜ https://github.com/zbc0315/cc-web

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

项目：`@tom2012/cc-web`。当前版本 **v2026.5.15-a**（2026-05-15 发布，npm registry latest）。仓库根 `TODO.md` 有更早的阶段规划。

## 进行中

- [ ] [P1] **i18n Phase 2 续摊**：剩 AgentPromptsPanel / HubTokenSection / MemoryPromptsPanel / FileTree / GitPanel / SkillHubPage / ShortcutPanel / MobileChatView / MobileSidePanel / MobileProjectList 约 25 文件。一次攻 1 文件到 `grep [一-鿿]` 为零再 commit
- [ ] [P1] **UI shadcn 化未完**：ChatOverlay 970 行拆分；SkillHubPage 重组；`h-N w-N → size-N` 语义化（codemod）；Framer → Tailwind `data-state` 动效；Mobile 响应式统一
- [ ] [P1] **audit P2 收敛项**：handler 内联 `isAdminUser`/`isProjectOwner` 改 middleware（`routes/projects.ts:280-571` / `routes/sync.ts:136-149,195-202`）；WS auth 在 upgrade 后做（`index.ts:557-610,767-803` race 风险）；动效裸写 0.2/0.25 没走 `MOTION` token

## 待启动

- [ ] [P0] **terminal-manager backoff 历史 bug**：`startTerminal` 每次清 `crashCounts.delete(project.id)` → MAX_RESTART_RETRIES=5 永远不生效。修法：startTerminal 加 `isRetry: boolean` 参数 retry 路径不重置；或 handleExit setTimeout 内部调 internal-only `_startTerminalForRetry`
- [ ] [P1] **任务流 v2 Phase 后续**：v-14-a 把数据合并到 `workflow_data.json` 后，runner watch 单文件 + LLM 改 finish 触发；下一步可继续：(a) WS push 替代 2s 轮询；(b) daemon 重启 rehydrate；(c) workflow_data RMW race 收窄（当前规避：runner 节点完工后不再回写，未根治）；(d) `{{var:X}}` 模板 X 在 validator 已存在但已声明却未初始化的变量 runtime 渲染为 `"(未设置)"` 是否要前端高亮提示
- [ ] [P1] **chat_subscribe 旧客户端 full history replay cap**（v-28-c codex F 项遗留）：客户端不传 `replay` 字段用 `Number.MAX_SAFE_INTEGER` 全文 replay，多 MiB 累积仍可能撞 128MB grace 上限。修：handler 强制 cap（如 200 blocks）或 reject 无 replay 的请求
- [ ] [P1] **audit U5 Settings 神秘悬浮圆点**：v-26-d 跳过待浏览器实测
- [ ] [P1] **Codex tool_result shape 拆字段**（reviewer I-2 延期）：Claude adapter 产 `content(200 short) + output(4000 full)` 两字段，codex-adapter 当前只产 `content(4000)`
- [ ] [P1] view-only 共享用户权限 gate：Quick/Agent/Memory Prompts 的 `+` 按钮和右键 Edit/Delete 对 `_sharedPermission === 'view'` 用户仍可见，点后端返 403。UX 应前端 hide / disable
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

## 相关项目：train-lang（独立仓库 `~/Projects/train-lang/`）

`@train-lang/*` monorepo（与 ccweb 解耦），M1-M3 已完成（lexer / parser / AST / 字符串模板 / async 解释器 / adapter-spec / adapter-mock / 端到端 fai 调用，225 测试通过）。这些 TODO 在 train-lang 仓库内推进，ccweb 仓库**不**含 train 源码：

- [ ] [P2] **train M5 模块系统**：`import { name } from "file"@hash` 真实加载子流 + 子流独立 workflow_data + 循环导入检测 + ask_user 跨栈冒泡（~2 周）
- [ ] [P2] **train M7 真实 adapter**：`@train-lang/adapter-openai` / `adapter-anthropic` / `adapter-ollama` direct API 各 1-3 天
- [ ] [P2] **train M8 CLI 完善**：`train fmt / debug / repl / config / adapters / trace`（~1 周）
- [ ] [P2] **train M9 Agent CLI adapters**：`@train-lang/adapter-claude-code` + `adapter-codex` PTY + workflow_data 协议（~2 周）
- [ ] [P3] **ccweb-train-adapter** 桥接 ccweb 现有 chat 通道 — 等 train 1.0 后做（M12，单独 ~2-3 周；不影响 ccweb 主线）

## 阻塞中

（无）

## 最近已完成（保留 2 周）

- [x] 2026-05-14 **v-14-b 发布：工作流编辑器添加变量/常量 Radix Select crash 修复**。`VariablesCard.add` / `ConstantsCard.add` push 占位条目 `{name:''}` 让用户填名字；但 `NodeCard.tsx` 内 UserInputBody 字段绑定 picker (l.155 `pickerList`) 和 SystemLogicBody 分支 picker (l.423 `pickerList`) 把每个 var/const 渲染为 `<SelectItem value={item.name}>`，空 name 触发 Radix 硬错（"value prop must not be an empty string"）crash 整棵子树。修法：两处 pickerList 加 `.filter(x => !!x.name)`——未命名条目本就不能被引用，validator 也在 save 时拒，过滤是正确层。codex 三问全过：(1) picker 层是正解 (2) flows/ 无其他遗漏 SelectItem name 渲染点 (3) defaultName 可能为 '' 但 setFieldBinding 已 truthy 守卫不写空名。commit `de1ecb5`
- [x] 2026-05-14 **v-14-a 发布：工作流系统 v2 schema 重构（workflow_data.json 统一）**。`schemaVersion=2` hard gate；分散数据合到 `<project>/.ccweb/workflow_data.json` 单文件 `{constants, variables, task_progress}`；FlowDef 加 `constants[]`（任意 JSON + 运行时只读）+ `variables[]`（去 file 加 initialValue）；UserInputField 改三态 `outputVariable`/`bindVariable`/`bindConstant` 互斥；LlmNode 改 `readVariables` / `readConstants` / `writeVariables`；`{{var:name}}` / `{{const:name}}` 替换 `{{file:rel}}`；PauseReason 删 file-read-error 两种。codex 大审 YELLOW 三项已修（renderTemplate 未设值变量返"(未设置)"、runner 完工后不回写 finishedAt 避 RMW race、buildPaste 入口剥所有 `\x1b/\r`）。文档同步 `~/Obsidian/Base/cc-web/工作流系统.md`。改动 14 文件 ±1200 行。commit `bd0121c`
- [x] 2026-05-14 **git 历史清理**：所有 314 commit message 的 `Co-Authored-By: Claude` trailer 删除，`git filter-repo` 重写后 force push origin/main。HEAD `15d2f37` → `e0147f5`（v-13-a 实际仍是 v-13-a 但 SHA 重算）。本地保留 `git tag backup-before-filter-claude` 指向旧 HEAD `15d2f37` 防回滚；GitHub contributors 页面 cache 几分钟到几小时内重算掉 Claude 账号
- [x] 2026-05-13 **v-13-a 发布：工作流变量双向绑定 + LLM 引用变量**。UserInputField 加 `outputToVariable` / `bindVariable` 互斥（输出到变量 / 显示变量值 readonly）；LlmNode 加 `referenceVariables` prompt 头部附"变量当前值"上下文；新 `sanitizeVarValue` 剥 `\x1b`/`\r` 防 paste 模式破坏；validator 三项守护（field.key trim 非空+节点内唯一、outputToVariable XOR bindVariable、output.path ↔ variable.file 冲突拒绝）。commit `15d2f37`
- [x] 2026-05-12 **v-12-c 发布：全局工作流 + 聊天气泡数学公式**。① 全局流 per-user 模板 `~/.ccweb/users/<username>/flows/`，新 `/api/global/flows/*` 4 端点，现有 `/run` body 加 `source?:'project'|'global'`；FlowsListDialog Tabs 切「项目流 / 我的全局流」。② ReactMarkdown 加 `remarkMath` + `rehypeKatex`，**关键**：`[remarkMath, { singleDollarTextMath: false }]` 仅 `$$...$$` 块级触发防 shell 文本 `$HOME`/`$cmd` 误判（codex P1）。commit `79ffdd0`

## 已取消 / 已废弃

- [~] 气泡头像（用户名/模型名）— 用户试用后不要
- [~] 计划控制子系统 — v-s 移除
- [~] 云盘备份子系统（Google Drive / OneDrive / Dropbox）— v-c 移除，rsync 同步完全替代
- [~] drainAndClose WS 卸载等待延迟 — 浏览器实测证伪（`ws.close()` 按 RFC 6455 本来就 drain）
- [~] hub-auth "待查是否 Claude-only" — reviewer 核验是工具无关的 PAT 加密存储
- [~] Codex hooks notify 抽象接入 ccweb hooks-manager — 语义不对齐
- [~] 2026-04-24 `bracketedPaste()` 按单行/多行分流（v-24-f 思路）— Playwright 实测证伪
- [~] 2026-04-24 前端监听 WS terminal_data 静默 + 补偿 `\r` — 用户提出更简方案后作废
- [~] 2026-04-26 audit P1 #B6 (rsync 路径含空格统计错误) — 经核实是 audit 误报
- [~] 2026-05-14 v2 schema 老流定义 migrator — Hard break 不写 migrator，项目一人用老流不多

END TODO
