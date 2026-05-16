# CCWEB：LLM CLI 的 Web 前端

**当前版本**: v2026.5.16-a ｜ **包名**: `@tom2012/cc-web` ｜ **MIT** ｜ https://github.com/zbc0315/cc-web

ccweb 将 Claude Code / Codex / OpenCode / Qwen / Gemini 等 CLI 工具包装为浏览器可访问的界面。核心链路：`Browser → Express + WebSocket → TerminalManager → node-pty → CLI 进程`。支持多项目、局域网、多用户、实时状态监控。

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

每次写完方案/代码，都要启动codex进行审核；

所有项目，不得包含claude code的署名，git仓库、github仓库不得有claude的贡献者标注

START 历史教训

项目：`@tom2012/cc-web`（ccweb）。每条以"反直觉/代价大"为门槛筛选；最高 10 条；犯错次数标在末尾 `[×N]`。

1. **`npm publish` 后不要顺手 `npm install -g` 或 `ccweb stop && ccweb start`**——发版动词集封闭 `bump→build→push→publish`，止于 publish；装机/重启需要当前消息明确授权，过去会话授权不传递。验证刚发的包用 `npm view @tom2012/cc-web version` 不用 install（npm CDN 传播延迟会让 install 命中旧版）。`[×3+]`

2. **"verify script / 测试方案 ≠ 真测试"**——parse 通过 ≠ runtime 通过。任何"用户第一次按按钮就要工作"的入口（starter 模板、新建项目、新对话框第一帧）必须 end-to-end smoke test：用 mock adapter / fake binary 真跑到 `ok=true` 再发版。`[×3]`（v-15-d/e/f starter 三次连环失败都因为只跑了 parse）

3. **不能信任他人/上游测试数**——commit message 写 "N tests pass" 时必须自己 grep 测试标题逐条看覆盖了什么 corner case，不能直接当 "覆盖完整"。`[×1, 影响大]`（train-lang `module-loader.test.ts` 18 个测试 0 个 naming-collision case，让 silent shadowing 4 个 bug 长期潜伏）

4. **Claude reviewer 审 Claude 自己改的代码是同源盲区**——必须 `codex:codex-rescue` 独立审；它能拿规范引用（WHATWG / Chromium 源码）反驳 Claude 的静态假设。同源 reviewer 还会假阳性"P0 自指"批不存在的代码路径，结论先 grep 实证再动。`[×多]`

5. **静态根因连续被推翻 → 停止猜，转用户亲历观察**——用户说"偶发"就是时序/状态相关，不是内容相关；反复在"内容差异"上找根因会浪费多个版本。正解：对比成功 vs 失败样本的字节差异；用户原话比 log 单次快照可靠。`[×多]`（v-24 系列消息滞留三轮 codex 推翻 Claude 假设才修对）

6. **GitHub contributors UI 与 REST API 不同源**——`gh api /contributors` 干净 ≠ 仓库主页 `/contributors_list` HTML 干净；force-push + filter-repo 改写 message 删 `Co-Authored-By:` trailer 后 API 立即干净但 UI 仍显示（GitHub 用全部 commits 含 unreachable 算，几小时到几周才 GC）。彻底解 = `gh repo delete` 后重建（需 `gh auth refresh -s delete_repo` 加 scope）。审 contributors 时抓 `curl -s https://github.com/<o>/<r>/contributors_list?...` 看 HTML 而非只看 API。`[×1, 影响大]`

7. **`navigator.clipboard` / `crypto.randomUUID` 只在 secure context 暴露**——HTTPS / `localhost` / `127.0.0.1` 才有，LAN HTTP `http://192.168.x.x:3001` 下是 undefined 直接 TypeError。两者都要 polyfill（execCommand fallback / `getRandomValues` fallback）。grep 审计：`crypto\.randomUUID\|navigator\.clipboard\.` 任何新 caller 都要过 polyfill。`[×2]`

8. **`isPathAllowed` 在目标路径不存在时不能跳过 realpath 校验**——攻击者可在 allowed root 放 symlink `link → /etc`，PUT `<allowed>/link/new.txt` 时 `lstat(leaf)` ENOENT 走"跳过 symlink 检查"分支返 true，writeFile 写到 `/etc/`。修法：walk-up 到最近存在祖先 realpath 再 isWithinAllowedDirs。`[×1, 安全 P0]`

9. **chevrotain `MismatchedTokenException` 可能 throw 不进 `parser.errors`**——中途打字时某些 GATE 路径让异常逃逸到调用方。任何前端调 `parseToAst()` 的入口（特别是 `useState(() => parseToAst(...))` initializer）必须 try/catch 兜底，或者 parseToAst 改为 NEVER-THROW 契约（包 parse + buildAst 各自 try/catch，throw 转 synthetic parseError 进返回）。`[×1, 崩前端]`

10. **包裹外部 CLI（Ink TUI / Codex / Claude）的修复本质是"绕过"不是"根治"**——外部 CLI 版本升级可能打破 ccweb 的绕过；写 changelog / commit message 用"绕过"/"预期解决"而非"根治"；用户在新 CLI 版本下再报同类 bug 时先 `claude --version` / `codex --version` 比对上次通过的版本范围，再怀疑 ccweb 退化。`[×2]`

END 历史教训

START TODO

# ccweb TODO（会话维护版）

项目：`@tom2012/cc-web`。当前版本 **v2026.5.16-a**（2026-05-16 发布，npm registry latest）。仓库根 `TODO.md` 有更早的阶段规划。

## 进行中

- [ ] [P0] **生产 daemon 升级到 v2026.5.16-a**：v-15-g daemon（PID 59634，15-16 15:37 启动）跑老代码会在工作轨终止时崩溃（unhandledRejection → process.exit(1)）。v-16-a 修了双层防御 + runId mismatch（详见最近已完成）。升级命令：`npm install -g @tom2012/cc-web@latest --include=dev && ccweb stop && ccweb start --local --daemon`，需用户明确说"重启"。`npm view @tom2012/cc-web version` 等 registry 真显示 v-16-a 再 install
- [ ] [P1] **工作轨 T4 文案 rename**：frontend + backend + 文档里 "工作流→工作轨" 字面替换；老 flows UI 保留按钮"任务流（旧）"。映射表见 `~/Obsidian/Base/cc-web/工作轨重构规划.md` §12
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
- [ ] [P1] **train-lang bug #9 empty template interp**：`"${""}"` parser 提前终止 outer string（lexer modes 限制，spec 已标注）。需重写 lexer 才能解决，暂搁
- [ ] [P2] **train-lang vendor 升级流程**：当前手工 `cp -r ~/Projects/train-lang/packages/{core,adapter-spec}/dist ccweb/backend/vendor/@tom2012/{train-core,train-adapter-spec}/dist`。考虑加 `npm run vendor:train` 脚本自动复制 + 改 package.json version
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
- [ ] [P3] **ccweb TrackRunner 加 `entry: trackBaseName`**：当前 starter 必须裸 `export main`，多 .tr 文件如果互相 import 同名 main 会撞 v-g 新加的 duplicate-symbol check。要支持就改 `train.runFile()` 传 `entry: path.basename(file, '.tr')`，starter 改回 `export main as <name>`

## 相关项目：train-lang（独立仓库 `~/Projects/train-lang/` + `github.com/zbc0315/train-lang`）

`@tom2012/train-*` monorepo（与 ccweb 解耦）。npm 已发 `core` / `adapter-spec` / `adapter-mock` / `adapter-fake-gen` / `cli` 都 `0.1.0`（v-15-d 改主意发，scope 改名因 `@train-lang` 不在 tom2012 名下）。当前 358 测试通过（core 295 含 12 个 v-g audit 回归 + cli 21 + adapter-mock 17 + adapter-fake-gen 25 + adapter-spec type-only）。后续：

- [ ] [P2] **train M5 ask_user 标准化**：当前 ccweb 用 `__ccweb_ask_user` 临时 builtin，T6 切回 train 标准 `ask_user`
- [ ] [P2] **train M7 真实 adapter**：`@tom2012/train-adapter-{openai,anthropic,ollama}` direct API 各 1-3 天
- [ ] [P2] **train M8 CLI 完善**：`train fmt / debug / repl / config / adapters / trace`（~1 周）
- [ ] [P2] **train M9 Agent CLI adapters**：`@tom2012/train-adapter-{claude-code,codex}` PTY + workflow_data 协议（~2 周）
- [ ] [P3] **train 测试方案 Phase B**：property-based + fast-check 14 invariant + L2 corpus 80 用例。规划在 `~/Obsidian/Base/cc-web/工作流DSL测试方案.md` §18.7

## 阻塞中

（无）

## 最近已完成（保留 2 周 / 最多 5 条）

- [x] 2026-05-16 **v2026.5.16-a 发布：工作轨终止崩溃 ccweb 修复 + ask_user runId 一致化**。生产日志（v-15-f PID 2345 / v-15-g PID 45593 都复现）：用户按"终止工作轨"时 `AbortController.abort()` 同步触发 `entry.signalHandler` → reject ask_user pending promise → 沿 builtin/train/runFile/runner.run 一路抛回 `registry.ts:153` 的 `void runner.run(...).then(...)`，**该处无 .catch** → 逃逸 `unhandledRejection` → `logger.ts:312` `process.exit(1)` → ccweb daemon 整体退出。同时静态分析发现：`registry.start` 生成的 runId 与 `track-runner.run` 内部又生成的 runId 不同，导致 `getPendingAskUser/submitInput/cancelAllForRun` 全部 no-op（解释了"ask_user dialog 没弹出 / 即使弹了提交也没反应"）。修复 3 处：(1) `track-runner.ts` 加 `runId?: deps` + try 加 catch 把 abort throw 转 ok:false UserCancelError；(2) `registry.ts` createTrackRunner 时传 runId pin 一致 + `.then().catch()` 防御（catch 里合成 failed 终态写 lastState + emit status_change 防 isRunning 卡死，per codex P1）；(3) 新建 `verify-track-cancel.ts` 装 `unhandledRejection` listener 复现 12/12 pass。codex APPROVE。verify-track-t1 / verify-track / verify-starter-templates 全部回归 pass
- [x] 2026-05-15 **v-15-g 发布：vendor 同步 train-lang 8 bug 修复**。train-lang commit `1dd174e` 修了 audit 暴露的 8 个 silent-incorrect-behavior bug + 12 个回归测试（core 283 → 295）；ccweb 端复制新 dist 进 `backend/vendor/@tom2012/train-core/dist/` 52 文件，源码零改动。涉及行为变化：命名冲突 #1-4 静默改抛 RuntimeError/ModuleError；obj.missing #5 返 null 对齐 spec；let typed-no-init #6 parser fork `declTypeAnnot` 禁止 trailing constraint（breaking: `let x: int 0-10 = 5` 不再 parse）；concat array #7 返数组；catch lowercase #8 当 catch-all。verify-starter-templates 8/8。commit `d89574f`
- [x] 2026-05-15 **v-15-f 发布：starter 真 0-arg 自洽 + verify 升级 runtime 真跑**。v-e 只修 parse 没修 `main(input_path)` 签名 → 用户实跑报 `E9999 main() expects 1 arg(s), got 0`。改 STARTER_BASIC 用 `greet` 0-arg；STARTER_ASK_USER 用 `__ccweb_ask_user` 收 `file_path`；用户 `~/.ccweb/users/zhang/tracks/literature_search.tr` 同步改并把 `export main as literature_search` 修回 `export main`。verify-starter-templates.ts 升级三层（parse + 0-arg + 真跑 mock + export 必须裸 main）。commit `6569705` + `e046da1`
- [x] 2026-05-15 **v-15-e 发布：starter parse 修 + UI failed/cancelled toast + logger 参数顺序**。三件相关 bug 围绕"显示已启动实际未启动"：(1) STARTER_* 模板 `-> object {` parse error（`object` 是结构类型 keyword）→ 改 `-> any {`；(2) `useTrackState.ts` track_status_change 加 `toast.error(failed)` / `toast.info(cancelled)`（之前 StatusBar 一闪而过）；(3) `registry.ts:149` `logger.info(msg, obj)` 参数顺序与 pino 反 → 字段全丢，改 `info(obj, msg)`。commit `9a049cb`
- [x] 2026-05-15 **v-15-d 发布：train-lang vendor 改名 `@train-lang/*` → `@tom2012/train-*` + train-lang 上 npm 0.1.0**。决策反转（v-15-a 时定"不发"），5 包都发 0.1.0；ccweb vendor 目录同步 rename，所有 import path/file: 路径 sed 改。train-lang GitHub repo 删后重建清除 contributors UI 残留 @claude 缓存。commit `a9bf77f`（ccweb） + train-lang `5a05f0e`
- [x] 2026-05-15 **v-15-c 发布：parseToAst NEVER-THROW 防御**。用户编辑 .tr 时 chevrotain `MismatchedTokenException: Expecting Identifier but found 'let'` 冒泡到 Promise reject。`frontend/src/components/tracks/parse-train.ts` 改 NEVER-THROW 契约 — 包 `parse()` 和 `buildAst()` 各自 try/catch，throw 转 synthetic parseError 进返回。commit `9c31db3`

## 已取消 / 已废弃

- [~] 气泡头像（用户名/模型名）— 用户试用后不要
- [~] 计划控制子系统 — v-s 移除
- [~] 云盘备份子系统（Google Drive / OneDrive / Dropbox）— v-c 移除，rsync 同步完全替代
- [~] drainAndClose WS 卸载等待延迟 — 浏览器实测证伪（`ws.close()` 按 RFC 6455 本来就 drain）
- [~] hub-auth "待查是否 Claude-only" — reviewer 核验是工具无关的 PAT 加密存储
- [~] Codex hooks notify 抽象接入 ccweb hooks-manager — 语义不对齐
- [~] 2026-04-24 `bracketedPaste()` 按单行/多行分流（v-24-f 思路）— Playwright 实测证伪
- [~] 2026-05-14 v2 schema 老流定义 migrator — Hard break 不写 migrator，项目一人用老流不多
- [~] 2026-05-15 **工作轨 v2 FlowDef → .tr 迁移工具（T3 原计划）**：用户明确"不需要其中的迁移工具"，T3 改做 WS 实时订阅
- [~] 2026-05-15 **train-lang 不发 npm 决策**：v-15-a 时定不发走 vendor，v-15-d 反转改发 5 包都 `0.1.0`（@tom2012/train-* scope）。vendor 路径仍保留作为 ccweb 端的离线副本

END TODO
