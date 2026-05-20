# CCWEB：LLM CLI 的 Web 前端

**当前版本**: v2026.5.20-b ｜ **包名**: `@tom2012/cc-web` ｜ **MIT** ｜ https://github.com/zbc0315/cc-web

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

1. **npm 发版闭环规则**——三条都必须遵守：(a) **bump 前必跑 `date "+%Y-%m-%d"`**：长会话跨午夜，system prompt 的 currentDate 是会话起点快照不是实时；用快照日期发出的版本号一旦上 npm 就**永久占用**无法撤回；(b) 动词集封闭 `bump→build→push→publish`，止于 publish；不准顺手 `npm install -g` 或 `ccweb stop && start`，装机/重启需当前消息明确授权；(c) 验证用 `npm view @tom2012/cc-web version` 不用 install（CDN 传播延迟会命中旧版）。`[×5+]`（2026-05-19 跨午夜连发 v-h~v-l 都用 5.18 日期）

2. **"verify script / 测试方案 ≠ 真测试"**——parse 通过 ≠ runtime 通过；任何"用户第一次按按钮就要工作"的入口必须 end-to-end smoke test，用 mock adapter / fake binary 真跑到 `ok=true` 再发版（codegen fai 内置 prompt 形参也要 emit `prompt: prompt`，否则 dispatch 报 arity 错）。`[×4]`

3. **不能信任他人/上游测试数**——commit message 写 "N tests pass" 时必须自己 grep 测试标题逐条看覆盖了什么 corner case。`[×1, 影响大]`

4. **Claude reviewer 审 Claude 自己改的代码是同源盲区**——必须 `codex:codex-rescue` 独立审；同源 reviewer 还会假阳性"P0 自指"批不存在的代码路径，结论先 grep 实证再动。`[×多]`

5. **静态根因连续被推翻 → 停止猜，转用户亲历观察**——用户说"偶发"就是时序/状态相关，不是内容相关；正解：对比成功 vs 失败样本字节差异；用户原话比 log 单次快照可靠。`[×多]`

6. **GitHub contributors UI 与 REST API 不同源**——`gh api /contributors` 干净 ≠ 仓库主页 `/contributors_list` HTML 干净；force-push + filter-repo 删 trailer 后 API 立即干净但 UI 仍显示数周到几小时；彻底解 = `gh repo delete` 后重建（需 `gh auth refresh -s delete_repo`）。`[×1, 影响大]`

7. **`navigator.clipboard` / `crypto.randomUUID` 只在 secure context 暴露**——HTTPS / `localhost` / `127.0.0.1` 才有，LAN HTTP `http://192.168.x.x:3001` 下 undefined 直接 TypeError；两者都要 polyfill（execCommand fallback / `getRandomValues` fallback）。`[×2]`

8. **`isPathAllowed` 在目标路径不存在时不能跳过 realpath 校验**——攻击者可在 allowed root 放 symlink `link → /etc`，PUT `<allowed>/link/new.txt` 时 `lstat(leaf)` ENOENT 走"跳过 symlink 检查"分支返 true，writeFile 写到 `/etc/`；修法 walk-up 到最近存在祖先 realpath 再 isWithinAllowedDirs。`[×1, 安全 P0]`

9. **chevrotain `MismatchedTokenException` 可能 throw 不进 `parser.errors`**——中途打字时某些 GATE 路径让异常逃逸；任何前端调 `parseToAst()` 的入口（特别是 `useState(() => parseToAst(...))` initializer）必须 try/catch 兜底，或 parseToAst 改 NEVER-THROW 契约。`[×1, 崩前端]`

10. **包裹外部 CLI（Ink TUI / Codex / Claude）的修复本质是"绕过"不是"根治"**——外部 CLI 升级可能打破 ccweb 的绕过；写 changelog 用"绕过"/"预期解决"而非"根治"；新 CLI 版本下用户再报同类 bug 时先 `claude --version` / `codex --version` 比对再怀疑 ccweb 退化。`[×2]`

END 历史教训

START TODO

项目：`@tom2012/cc-web`。当前版本 **v2026.5.20-b**（npm registry latest）。daemon 是否已升级 = 用户当前消息明示，过去会话授权不传递。

## 进行中

- [ ] [P1] **v3 M3 浏览器手测打磨**：用户实测完整链路（user_input → 多 LLM → if 循环 → end），用真实 claude-code 跑通；预期暴露 cancel 中间态 / skipped 节点 / run-state.json done flag LLM 自觉性差等问题
- [ ] [P1] **v3 M3 skipped 节点状态 runtime emit**：if 节点未走的分支需 emit skip 让前端灰划线显示；当前仅 active/completed/failed/waiting 状态有写入
- [ ] [P1] **v3 M3 runs 历史回放**：audit log `.flow.runs/<runId>.log.jsonl` + run-state.json 已写，但前端没读 + 展示 UI；需 `/api/projects/:pid/track-flows/:basename/runs` list + 单 runId log get + 前端 RunHistoryPanel
- [ ] [P1] **v3 M4 verify-flow-v3 扩展**：当前 5 checks 只覆盖 happy path；要加 cancel mid-llm / quota 超限 / failed=true LLM 自报失败 / user_input dialog 取消 / sidecar desync 恢复
- [ ] [P1] **v3 M4 Playwright E2E**：拖 3 节点 + 连边 + 保存 + 运行 + 校验 .flow + train.json + run-state.json + WS 事件路径
- [ ] [P1] i18n Phase 2 续摊：剩 AgentPromptsPanel / HubTokenSection / MemoryPromptsPanel / FileTree / GitPanel / SkillHubPage / ShortcutPanel / MobileChatView / MobileSidePanel / MobileProjectList 约 25 文件；一次攻 1 文件到 `grep [一-鿿]` 为零再 commit
- [ ] [P1] UI shadcn 化未完：ChatOverlay 970 行拆分；SkillHubPage 重组；`h-N w-N → size-N` 语义化（codemod）；Framer → Tailwind `data-state` 动效
- [ ] [P1] audit P2 收敛项：handler 内联 `isAdminUser`/`isProjectOwner` 改 middleware（`routes/projects.ts:280-571` / `routes/sync.ts:136-149,195-202`）；WS auth 在 upgrade 后做（`index.ts:557-610,767-803` race）；动效裸写 0.2/0.25 没走 `MOTION` token

## 待启动 — v3 Phase 2+ 候选

- [ ] [P1] **v3 子流程节点**：节点本身是 .flow 文件，进入 sub-runtime（spec §18 Phase 2）
- [ ] [P1] **v3 并行节点 + join 汇合**：多源调研常见；含同步多 LLM + 变量合并冲突策略（spec §4 M1 显式不支持）
- [ ] [P1] **v3 if expr 扩展**：`.length` / 字段访问 `x.a.b` / `in` 算子；当前仅 `==/!=/>/<` + `&&/||` + 字面量
- [ ] [P2] **v3 节点 retry policy**：当前节点失败立即整 run failed
- [ ] [P2] **v3 节点级 / 工作轨级超时**：当前仅总 run 时长 2h
- [ ] [P2] **v3 sidecar desync 三选恢复**：spec §11.4 设计三选 dialog，M1 简化为只显示 banner
- [ ] [P2] **v3 .flow 列表 mode 字段**：当前前端 list 后 batch fetch 判类型
- [ ] [P2] **v3 Monaco 嵌入 CodeNode**：M1 用 textarea + 智能补全；后续若需"纯代码段节点"再议
- [ ] [P3] **v3 undo/redo**：图结构变化 ctrl+z/y
- [ ] [P3] **v3 LLM 调用监听换 chokidar**：当前 `fs.statSync` 500ms polling run-state.json
- [ ] [P3] **v3 runtime 持久化**：daemon 重启后 in-flight run 当前直接 failed；可写状态恢复

## 待启动 — 其他

- [ ] [P0] terminal-manager backoff 历史 bug：`startTerminal` 每次清 `crashCounts.delete(project.id)` → MAX_RESTART_RETRIES=5 永不生效；修法 `startTerminal` 加 `isRetry: boolean` 参数 retry 路径不重置
- [ ] [P1] chat_subscribe 旧客户端 full history replay cap：客户端不传 `replay` 字段用 `Number.MAX_SAFE_INTEGER` 全文 replay，多 MiB 累积可能撞 128 MB grace；修 handler 强制 cap 200 blocks
- [ ] [P1] audit U5 Settings 神秘悬浮圆点：v-26-d 跳过待浏览器实测
- [ ] [P1] Codex tool_result shape 拆字段（reviewer I-2 延期）：Claude adapter 产 `content(200 short) + output(4000 full)` 两字段，codex-adapter 当前只产 `content(4000)`
- [ ] [P1] view-only 共享用户权限 gate：Quick/Agent/Memory Prompts 的 `+` 按钮和右键 Edit/Delete 对 `_sharedPermission === 'view'` 用户仍可见，点后端返 403；UX 应前端 hide / disable
- [ ] [P2] 协作者跑流权限：所有 track-flow 端点 owner-only，分享项目协作者跑不了；若产品上需要加 `requireProjectAccess` middleware
- [ ] [P2] ScheduleWakeup 面板"已触发"判定 false positive 风险
- [ ] [P2] Hub 浏览页"已导入"状态 mount 时一次性算，后来删除全局 prompt 不刷新
- [ ] [P2] Memory / Agent toggle 与用户手改 CLAUDE.md / AGENTS.md 的 race：未加 mtime 比对
- [ ] [P2] Memory body 禁用 `START <name>` / `END <name>` 单独成行，未校验
- [ ] [P2] 全局 shortcut 从 Dashboard 删除时不清前端 `cc_used_shortcuts_<pid>` localStorage
- [ ] [P2] Radix ContextMenu + Tabs `orientation="vertical"` 下 Left/Right 方向键不切 tab
- [ ] [P2] CLAUDE.md/AGENTS.md 切工具时孤儿块检测
- [ ] [P2] Gemini / OpenCode / Qwen 的 `getProjectInstructionsFilename()` 实际约定（当前保守默认 AGENTS.md，待确认）
- [ ] [P2] ChatOverlay 500ms rerender 频率：WS 每 500ms 一条 `semantic_update`，ChatOverlay 没 `React.memo`
- [ ] [P2] **v3 多入口支持**：当前 validator 强制 in-degree=0 节点 ≤ 1；用户 2026-05-19 提过"多入点"需求未细化（fan-in 已支持，多入口需并行 runtime 或运行时选入口，待用户给具体场景再做）
- [ ] [P3] `projectIdleTimers` Map memory 清理
- [ ] [P3] PromptCard 样式是否统一（Quick 按钮 vs Agent/Memory 槽位）
- [ ] [P3] Agent SDK（`@anthropic-ai/claude-agent-sdk`）PoC：SDK 与 TUI 能否共享 session ID / 是否 honor `~/.claude/commands/*.md` 和 plugin 斜杠命令
- [ ] [P3] `DETAILS/backup.md` 文档清理：v-c 移除云盘备份代码，文档还在
- [ ] [P3] i18n 跨设备实时同步 / 首次登录 flicker
- [ ] [P3] `/api/logs` HTTP 端点（admin-only）远程看日志
- [ ] [P3] WS 连接的 `wsId` ALS scope
- [ ] [P3] SIGUSR1 扩展成按模块开关 log level

## 已废弃 / 不再追

- [~] 老 flows v1 任务流系统（v-h 删干净）：backend `flows/{runner,store,types}.ts` + routes/{flows,global-flows}.ts + frontend `components/flows/` 整目录
- [~] v1 工作轨节点图（嵌套块，v-16-b → v-17-b）：v3 M0 删
- [~] v2 工作轨节点图（ReactFlow + train-lang codegen，v-18-a/b）：v3 M0 删
- [~] 写代码 .tr 模式：v-18-c 删
- [~] train-lang DSL：v-18-c 起完全抛弃；vendor 仅保留 `@tom2012/train-adapter-spec` 类型协议
- [~] outputs check 强约束：v-j 改成 done flag 唯一判定 + outputs 检查降级为 warning
- [~] cwd `train.json` / `workflow_data.json` 命名：v-h 改私有名 `.ccweb-flow-train.json` 避开用户业务文件
- [~] FlowMinimapCard 右下角固定悬浮：v-k 移到 LeftPanel tracks tab 内 embedded 模式
- [~] 列表行 ▶ 弹编辑器 Dialog：v-l 改 dispatch CustomEvent 顶层 driver 处理

## 最近已完成（保留 2 周 / 最多 5 条）

- [x] 2026-05-20 **v2026.5.20-b**：CLI 交互菜单 detector 根因修复（v-20-a 部署后用户实测 active=null）。根因：Ink TUI 用 CHA `\x1b[<n>G`（Cursor Horizontal Absolute 绝对列定位）代替字面空格做对齐，所以 PTY 实际输出是 `Resume\x1b[15Gfrom\x1b[20Gsummary`；v-20-a 的 stripAnsi `\x1b\[[0-9;?]*[ -/]*[@-~]/g` 一刀切删 CSI 把 CHA 也吞了，buffer 里变 `Resumefromsummary` → fingerprint 三短语永远匹配不到 → active=null。修：stripAnsi 先把 CHA `\x1b[<n>G` 替换为单空格、CUF `\x1b[<n>C` 替换为 n 个空格（cap 200 防意外），然后再走通用 CSI 清扫。order 关键。WS 旁路抓真实 Claude CLI 2.1.144 PTY 输出 dump 验证。新加 2 个测试 case：v-20-b 根因 CHA case 用真实 dump 字节 + CUF case。backend 89/89（87+2 new）+ tsc 干净。教训 #10 风险评估不变：parseOptions 还是按解析出的 digit 绑 label，digit↔label 映射稳定；CHA 修法是恢复正常空格语义，不引入新 CLI 依赖。
- [x] 2026-05-20 **v2026.5.20-a**：CLI 交互菜单可点击选择（解决 `claude --continue` Ink TUI select 在 ChatOverlay 看不到的盲区）。新建 `backend/src/cli-prompt-detector.ts`：per-project 8KB ringbuffer + ANSI strip + 三短语 fingerprint（Resume from summary / Resume full session / Don't ask me again）+ `parseOptions` 正则 `^[ \t]*(❯|>)?[ \t]*(\d+)\.[ \t]+(.+?)$` /gm 提取 `{digit, label, recommended}`，options.length<2 时沉默（教训 #10）；options 内容变化（Ink ↑↓ 移高亮）→ 重发 detected 而非闪烁；terminal-manager onData feed / handleExit reset；`POST /api/projects/:id/cli-prompt-respond { digit }` edit 权限 + digit 1..9 + active.options 校验 + `terminalManager.hasTerminal()` 验 PTY 存活后 writeRaw（codex P0 顺修：原本 PTY 不存在时 no-op 假成功导致前端 spinner 永转）；`GET /:id/cli-prompt-state` 给 WS 重连/页面刷新补 active；frontend `CliInteractivePromptCard` 仿 ApprovalCard 视觉（sky 配色 + Terminal icon）渲染 options.map 按钮（recommended 项 border 强调 + "(推荐)" 后缀，点击 Loader2 spinner），桌面 ChatOverlay + 移动 MobileChatView 完全相同交互（同代码路径）。教训 #10 风险：按钮 label 是解析出来的菜单文字，发送的 digit 来自当前 options 数组，CLI 重排菜单时自动跟随；CLI 大改格式 → parseOptions 返空 → 不显示卡片（回退原本"用户去终端面板"）。backend 87/87（80+7 new from options 解析） + frontend 47/47 + tsc 干净。
- [x] 2026-05-19 **v2026.5.19-b**：工作轨 LLM 节点 prompt 全部英文化（CLI LLM 对英文 prompt 执行更稳）。`prompt-translator.ts`：`${key}` 替换语段从"修改变量 ${key}(${description};记录路径...)=${value} 为..."（省略号槽位易被 LLM 当装饰）→ `Update variable ${key}(${description}; stored at .ccweb-flow-train.json under key:${key}). Current value: ${value}. Write the new value.`（显式槽位）；`buildSystemInstruction` 整段【系统指令】→ `[System Instructions]` 英文版，含 run-state.json 完整路径 / done flag 协议 / failed+reason 协议 / multi-step interaction hint。变量 description / runtime 内部 reason / UI 文案保留中文（用户数据 + ccweb 给用户看的）。codex 主审一轮 GO，顺修 P1+P2：P1 系统指令里所有提到 `run-state.json` 的句子都用完整路径插值（防 LLM 误改根目录文件）；P2 加 done/failed 互斥 + 禁动 iter/status 等字段提示；P2 placeholder `<node id>` → `<node-id>` 与 `<basename>` 一致。backend 71/71（原 68+3 codex assertions） + tsc 干净。
- [x] 2026-05-19 **v2026.5.19-a**：工作轨 UI 全套对齐 ccweb 设计系统 + shadcn。Dialog 统一走 `@/components/ui/dialog`（TrackEditorDialog / FlowUserInputDialog 弃直调 @radix-ui）；新建 ui/textarea.tsx；19 文件原生 `<button>` 换 Button + lucide icon（💬🤖🔀🕸️▶■× → MessageSquare/Bot/GitBranch/Workflow/Play/Square/X）；编辑器全景补 dark: + 语义 token（bg-background/bg-card/text-muted-foreground/border-border）；FlowMinimapCard SVG fill/stroke hex → Tailwind className（fill-amber-100 dark:fill-amber-900/50），箭头 marker 用 currentColor 跟 muted-foreground 联动；window.prompt/confirm/alert → 嵌入 Dialog/useConfirm/toast；PromptTemplateEditor 新建变量、TracksLeftPanelContent 新建工作轨改 Dialog + 校验。codex 主审一轮抓 1P0+2P1+2P2 已修：P0 Radix onOpenChange 不等 async confirm → dirty 上提到 TrackEditorDialog，preventDefault 同步拦截 Esc/Outside；P1 FlowUserInputDialog values 残留 → useEffect(open,nodeId) reset；P1 double overlay → 自管 DialogPortal+Overlay z-[70]；P2 pendingCompletionRef cleanup；P2 number 空字符串保留 '' 不强转 0。frontend 47/47 + tsc 干净。
- [x] 2026-05-18 跨午夜 **v2026.5.18-l**：抽独立运行 driver。ProjectPage 顶层 useFlowRun + runningFlow state；listener `ccweb:flow-run-request` / `ccweb:flow-cancel-request`；FlowUserInputDialog 提顶层；FlowMinimapCard 加 ■ cancel；TrackFlowEditor 接 runState props（codex P0 必修）；FlowToolbar ▶/■ 改 dispatch event；删 autoRun prop。frontend 47/47 pass + tsc 干净 + codex 主审通过。

END TODO

