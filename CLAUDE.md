# CCWEB：LLM CLI 的 Web 前端

**当前版本**: v2026.5.18-g ｜ **包名**: `@tom2012/cc-web` ｜ **MIT** ｜ https://github.com/zbc0315/cc-web

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

2. **"verify script / 测试方案 ≠ 真测试"**——parse 通过 ≠ runtime 通过。任何"用户第一次按按钮就要工作"的入口（starter 模板、新建项目、新对话框第一帧、codegen 出来的代码）必须 end-to-end smoke test：用 mock adapter / fake binary 真跑到 `ok=true` 再发版。**特别注意"内置 trait 形参"**：codegen fai 调用时 train 自动追加 prompt 字符串作为末尾 arg，**声明也必须 emit `prompt: prompt`**，否则 runtime dispatch 报 `expects N arg(s), got N+1`。`[×4]`（v-15-d/e/f starter 三次 + v-17-a 节点图 fai arity 一次都因为只跑了 parse 没真 dispatch）

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

项目：`@tom2012/cc-web`。当前版本 **v2026.5.18-g**（2026-05-18 发布，npm registry latest，v3 M3 第二批实测反馈：列表行 ▶ 直接运行 / 运行时收起编辑面板 / 用户输入对话框提交后关闭 + codex 顺修 P0 attach race）。daemon 是否已升级 = 用户当前消息明示，过去会话授权不传递。

## 进行中

- [ ] [P1] **v3 M3 浏览器手测打磨**：用户实测工作轨完整链路（user_input → 多 LLM → if 循环 → end）；预期暴露边缘 case：cancel 中间态 / skipped 节点 / 真实 claude-code 与 mock injector 行为差异。修后发 v-19-a
- [ ] [P2] **v3 dirty 假阳性**：`TrackFlowEditor` 加载完成 `dispatch(replace)` 触发 `useEffect [flow]` 里 `loadState==='ready'` → `setDirty(true)`，用户没编辑就显示"未保存修改" + 阻塞 FlowToolbar 的"运行"按钮。autoRun 已绕开，但手动入口仍受影响。修：用 ref 标记"是否是 replace 之后的首次 flow 变化"，第一次跳过 setDirty
- [ ] [P2] **v3 编辑器关闭是否 cancel 后台 run**：用户在 run 中按 ← 关闭编辑页只 `onClose`，不 `cancelFlow` → backend run-registry 仍占用 (projectId, basename)，再开同一轨返 409（autoRun 路径 v-g 已能 attach existingRunId 跟进，但产品语义仍模糊）。需决定：← 是"退出但后台继续"还是"退出即取消"
- [ ] [P1] **v3 M3 节点状态细粒度**：spec §10 / §13 完整 4 状态边框（黄 pulse / 绿 ✓ / 红 ✗ / 灰划线）M2 已实现 active/completed/failed，**skipped 还未触发**（runtime if 分支没走的另一支需 emit skip）+ 节点取消中间态 UI
- [ ] [P1] **v3 M3 runs 历史回放**：audit log `.flow.runs/<runId>.log.jsonl` 已写，但前端没有读 + 展示 UI。需要 `/api/projects/:pid/track-flows/:basename/runs` list + `/api/.../runs/:runId/log` get + 前端 RunHistoryPanel（看变量 diff 时间线）
- [ ] [P1] **v3 M4 verify-flow-v3 扩展**：当前 5 checks 只覆盖研究循环 happy path。要加：cancel mid-llm / quota 超限 / outputs 未改 LLM 失败 / 用户输入 dialog 取消 / desync 恢复
- [ ] [P1] **v3 M4 Playwright E2E**：拖 3 节点 + 连边 + 保存 + 运行 + 验证 .flow + train.json + WS 事件路径
- [ ] [P1] i18n Phase 2 续摊：剩 AgentPromptsPanel / HubTokenSection / MemoryPromptsPanel / FileTree / GitPanel / SkillHubPage / ShortcutPanel / MobileChatView / MobileSidePanel / MobileProjectList 约 25 文件。一次攻 1 文件到 `grep [一-鿿]` 为零再 commit
- [ ] [P1] UI shadcn 化未完：ChatOverlay 970 行拆分；SkillHubPage 重组；`h-N w-N → size-N` 语义化（codemod）；Framer → Tailwind `data-state` 动效；Mobile 响应式统一
- [ ] [P1] audit P2 收敛项：handler 内联 `isAdminUser`/`isProjectOwner` 改 middleware（`routes/projects.ts:280-571` / `routes/sync.ts:136-149,195-202`）；WS auth 在 upgrade 后做（`index.ts:557-610,767-803` race 风险）；动效裸写 0.2/0.25 没走 `MOTION` token

## 待启动 — v3 Phase 2+ 候选

- [ ] [P1] **v3 子流程节点**：节点本身是个 .flow 文件，进入运行 sub-runtime（spec §18 Phase 2）
- [ ] [P1] **v3 并行节点 + join 汇合**：多源调研常见 pattern；spec §4 M1 显式列为不支持 + §18 Phase 2 候选；含同步多 LLM 调用、变量合并冲突策略
- [ ] [P1] **v3 if expr 扩展**：`.length` / 简单字段访问（`x.a.b`）/ `in` 包含算子；当前 M1 仅 `==/!=/>/<` + `&&/||` + 字面量；spec §5.4 / §17 风险 #4
- [ ] [P2] **v3 节点 retry policy**：spec §18 Phase 3；当前节点失败立刻 failed 整个 run
- [ ] [P2] **v3 超时**：节点级 + 工作轨级；当前仅有总 run 时长 2h 上限
- [ ] [P2] **v3 sidecar desync 三选恢复**：spec §11.4 设计了"重建 sidecar / 只读图 / 代码模式"三选 dialog；M1 简化为只显示 banner，需补完
- [ ] [P2] **v3 .flow 列表 mode 字段**：当前前端 list 后 batch fetch 判断标识；后端 list 一次返结构化更高效（同 v2 时代留下的 P2 项）
- [ ] [P2] **v3 layout 持久化**：节点坐标已在 .flow.nodes[].position 持久化；当前足够；后续若引入嵌套 frame 才需要 sidecar
- [ ] [P2] **v3 Monaco 嵌入 CodeNode**（重新评估）：spec §6.5 用 textarea + 智能补全；如果 v3 后续需要"纯代码段节点"则 Monaco 嵌入回到议题
- [ ] [P3] **v3 undo/redo**：图结构变化 ctrl+z/y；M2 plan 内提及但未实施
- [ ] [P3] **v3 LLM 调用监听优化**：当前 llm-dispatcher 用 `fs.statSync` 500ms polling，可换 chokidar 更敏感
- [ ] [P3] **v3 runtime 持久化**：daemon 重启后 in-flight run 现状为直接 failed（M2 简化）；可写 .run-state.json 支持恢复

## 待启动 — 其他

- [ ] [P0] terminal-manager backoff 历史 bug：`startTerminal` 每次清 `crashCounts.delete(project.id)` → MAX_RESTART_RETRIES=5 永远不生效。修法：startTerminal 加 `isRetry: boolean` 参数 retry 路径不重置；或 handleExit setTimeout 内部调 internal-only `_startTerminalForRetry`
- [ ] [P1] **老 flows v1 任务流删除**：v3 工作轨稳定后删 `backend/src/flows/` + `backend/src/routes/flows.ts` + `routes/global-flows.ts` + frontend 旧组件。约 -1200 后端 -2000 前端。注意：M0 已删 v1 visual/ + v2 graph/ + 写代码 .tr 模式，但**任务流（旧 flows）系统是另一个独立子系统**仍在线
- [ ] [P1] 任务流 v2 Phase 后续（旧 flows，工作轨另起炉灶）：(a) WS push 替代 2s 轮询；(b) daemon 重启 rehydrate；(c) workflow_data RMW race 收窄；(d) `{{var:X}}` 模板 X 已声明却未初始化变量 runtime 渲染 `"(未设置)"` 是否要高亮
- [ ] [P1] chat_subscribe 旧客户端 full history replay cap（v-28-c codex F 项遗留）：客户端不传 `replay` 字段用 `Number.MAX_SAFE_INTEGER` 全文 replay，多 MiB 累积仍可能撞 128MB grace 上限。修：handler 强制 cap（如 200 blocks）或 reject 无 replay 的请求
- [ ] [P1] audit U5 Settings 神秘悬浮圆点：v-26-d 跳过待浏览器实测
- [ ] [P1] Codex tool_result shape 拆字段（reviewer I-2 延期）：Claude adapter 产 `content(200 short) + output(4000 full)` 两字段，codex-adapter 当前只产 `content(4000)`
- [ ] [P1] view-only 共享用户权限 gate：Quick/Agent/Memory Prompts 的 `+` 按钮和右键 Edit/Delete 对 `_sharedPermission === 'view'` 用户仍可见，点后端返 403。UX 应前端 hide / disable
- [ ] [P2] 协作者跑流权限：所有 flow / track-flow 端点 owner-only（含全局流到非 owner 项目），分享项目的协作者跑不了流。若产品上需要，加 `requireProjectAccess` middleware
- [ ] [P2] ScheduleWakeup 面板"已触发"判定：v-26-b 决定不判 false positive 风险大
- [ ] [P2] Hub 浏览页"已导入"状态 mount 时一次性算，后来删除全局 prompt 不刷新
- [ ] [P2] Memory / Agent toggle 与用户手改 CLAUDE.md / AGENTS.md 的 race：未加 mtime 比对
- [ ] [P2] Memory body 禁用 `START <name>` / `END <name>` 单独成行，未校验
- [ ] [P2] 全局 shortcut 从 Dashboard 删除时不清前端 `cc_used_shortcuts_<pid>` localStorage
- [ ] [P2] Radix ContextMenu + Tabs `orientation="vertical"` 下 Left/Right 方向键不切 tab
- [ ] [P2] `CLAUDE.md/AGENTS.md` 切工具时孤儿块检测：cliTool 改变后，对面指令文件里残留的 Memory/Agent Prompts 块不自动迁移
- [ ] [P2] Gemini / OpenCode / Qwen 的 `getProjectInstructionsFilename()` 实际约定待确认（v-22-c 保守默认 AGENTS.md）
- [ ] [P2] ChatOverlay 500ms rerender 频率：project WS 每 500ms 一条 `semantic_update`，ChatOverlay 没 `React.memo`
- [ ] [P3] `projectIdleTimers` Map memory 清理：project 删除 / WS 全部断开时 idle timer 不自动清
- [ ] [P3] PromptCard 样式是否统一（Quick 按钮 vs Agent/Memory 槽位）
- [ ] [P3] Agent SDK（`@anthropic-ai/claude-agent-sdk`）PoC：(1) SDK 与 TUI 能否共享 session ID (2) SDK 是否 honor `~/.claude/commands/*.md` 和 plugin 斜杠命令
- [ ] [P3] `DETAILS/backup.md` 文档清理：v-c 移除云盘备份代码，文档还在
- [ ] [P3] i18n 跨设备实时同步：当前切换需 reload 才跨设备生效
- [ ] [P3] i18n 首次登录 flicker：detected lang 先渲染 → server pref 回来 relabel
- [ ] [P3] `/api/logs` HTTP 端点（admin-only via `requireAdmin`）远程看日志
- [ ] [P3] WS 连接的 `wsId` ALS scope
- [ ] [P3] SIGUSR1 扩展成按模块开关 log level

## 已废弃 / 不再追

- [~] v1 工作轨节点图（嵌套块，v-16-b → v-17-b）：M0 删干净
- [~] v2 工作轨节点图（ReactFlow + train-lang codegen，v-18-a/b）：M0 删干净
- [~] 写代码 .tr 模式（TrackEditor + parse-train + train-monaco-lang）：M0 删
- [~] train-lang DSL：v-18-c 起完全抛弃；vendor `@tom2012/train-core` 已删，仅保留 `@tom2012/train-adapter-spec` 类型协议
- [~] v1/v2 时代 M2-M4 路线（嵌套容器 if/for / train-lang trace hook / 节点图运行可视化）：v3 完全重新设计，路线作废
- [~] train-lang vendor 升级流程：vendor 仅剩 adapter-spec（类型协议），未来不再升级 train-core
- [~] 节点图 .tr 反向 parse：v3 用 `.flow` JSON，不再有"代码↔节点图"双向问题
- [~] CodePreviewModal Escape 冒泡 bug：组件随 v2 graph/ 一起删
- [~] ccweb TrackRunner entry: trackBaseName：v3 不用 train.runFile()
- [~] 气泡头像 / 计划控制子系统 / 云盘备份 / drainAndClose / hub-auth Claude-only / Codex hooks notify 抽象 / bracketedPaste 单行多行分流 / v2 schema migrator / 工作轨 v2 FlowDef→.tr 迁移 / train-lang 不发 npm（v-15-d 反转）

## 最近已完成（保留 2 周 / 最多 5 条）

- [x] 2026-05-18 **v2026.5.18-g**：v3 M3 第二批实测反馈。**Bug 1**（列表里不能直接运行）：`TrackFlowsListDialog` 每行加 `▶ 运行` 按钮 + `ActiveEditor` 加 `autoRun?: boolean`；`TrackFlowEditor` 加 `autoRun` prop + useRef 守门的 useEffect，`loadState==='ready' && runState.status==='idle'` 时 fire `apiRunFlow + attachRunId`。**Bug 2**（运行时面板挡屏）：`isRunningView = runState.status==='running'/'waiting_user_input'`，三个编辑面板（NodePalette / VariablesPanel / NodeInspector）条件渲染，Canvas + 底部 FlowRunPanel 占满；run 完成/失败/取消时面板回来便于复盘。**Bug 3**（用户输入对话框点确定不消失）：`useFlowRun` reducer 在 `flow_node_completed` 时若 `nodeId === pendingUserInput.nodeId` 清空 pendingUserInput + status 转 'running'。**codex 顺修 P0**：useFlowRun 未 attach 时（runIdRef null）忽略所有 flow_* 事件，避免 resetRun 后晚到事件污染 + mount 初次接到他人 run；**顺修 P1**：req() 错误透出 status + detail，autoRun catch 处理 409 FLOW_ALREADY_RUNNING attach existingRunId（同 filename 后台仍有 run 时关→开能正确接管）。两 P2 进 TODO：dirty 假阳性 / 编辑器 ← 关闭是否 cancel。backend 51/51 + frontend 38/38 pass + 两端 tsc 干净。
- [x] 2026-05-18 **v2026.5.18-f**：v3 M3 首批用户实测反馈修复。**Bug A**：v3 LLM 节点 prompt 滞留 CLI 输入框 —— `_flow-injector.ts` 之前直接 `terminalManager.writeRaw` 绕过了 ccweb chat / v1 任务流共用的 paste 两道处理（buildPaste 包 bracketed-paste + 末尾 CR strip ESC/CR；writeTerminalInputSplit 拆 body/CR 200ms 延迟绕 Ink TUI paste-folding）。**修法**：把 buildPaste + writeTerminalInputSplit + paste 队列抽到新模块 `backend/src/terminal-paste.ts`，`index.ts` / `flows/runner.ts` / `routes/_flow-injector.ts` 三处共用。**Bug B**：变量面板新建变量名每次按键失焦 —— rename 走 `remove_variable + add_variable` + React row `key={v.key}` 导致整行 unmount。**修法**：reducer `update_variable` 支持 `patch.key`（重名拒绝保位置）；VariablesPanel rename 改用 update_variable，row key 改用数组 index。**Q4 顺修 P1**（codex 审出）：变量 rename 不级联，IfNode.conditionExpr 旧 key 在 runtime 求值 null → `null == null → true` 分支静默翻转；validator 补 conditionExpr identifier 校验，rename 后引用旧 key 的 IfNode 保存失败给提示。backend 51/51 + frontend 38/38 vitest pass（新加 2 个 rename 测试 + 3 个 conditionExpr 测试）+ 两端 tsc 干净 + codex 主体审通过。
- [x] 2026-05-18 **v2026.5.18-e**：v3 M2 runtime（首版能端到端跑通）。后端 prompt-translator + if-expr parser/evaluator（null 安全）+ train-json-sync（原子写 + flush 等待 + 白名单）+ llm-dispatcher（PTY 注入 + mtime polling）+ runtime state machine + run-registry（锁 + 三道防线）+ audit-log + 9 个 WS 事件；前端 useFlowRun hook（用 window CustomEvent `ccweb:flow-msg` 与现有 `ccweb:track-msg` 对齐避免 prop-drill WS）+ FlowRunPanel + FlowUserInputDialog + 节点状态边框 + FlowToolbar ▶/■ 按钮。backend 51 vitest pass / verify-flow-v3 5/5 真跑通研究循环（mock injector 模拟 retry 一次后 end）。terminal-manager 真实注入 API 是 `writeRaw(projectId, data)`（不是 `inject`）。commit `df0dc68`
- [x] 2026-05-18 **v2026.5.18-d**：v3 M1 编辑器骨架（push 未 publish 中间版）。flow-types-v3 / flow-reducer / flow-validator / flow-sidecar-io / prompt-placeholder-extractor + 3 节点视图（UserInputNode/LLMNode/IfNode）+ FlowCanvas（自动拓扑编号）+ NodePalette + VariablesPanel + NodeInspector + PromptTemplateEditor（`@/# CCWEB：LLM CLI 的 Web 前端

**当前版本**: v2026.5.18-g ｜ **包名**: `@tom2012/cc-web` ｜ **MIT** ｜ https://github.com/zbc0315/cc-web

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

2. **"verify script / 测试方案 ≠ 真测试"**——parse 通过 ≠ runtime 通过。任何"用户第一次按按钮就要工作"的入口（starter 模板、新建项目、新对话框第一帧、codegen 出来的代码）必须 end-to-end smoke test：用 mock adapter / fake binary 真跑到 `ok=true` 再发版。**特别注意"内置 trait 形参"**：codegen fai 调用时 train 自动追加 prompt 字符串作为末尾 arg，**声明也必须 emit `prompt: prompt`**，否则 runtime dispatch 报 `expects N arg(s), got N+1`。`[×4]`（v-15-d/e/f starter 三次 + v-17-a 节点图 fai arity 一次都因为只跑了 parse 没真 dispatch）

3. **不能信任他人/上游测试数**——commit message 写 "N tests pass" 时必须自己 grep 测试标题逐条看覆盖了什么 corner case，不能直接当 "覆盖完整"。`[×1, 影响大]`（train-lang `module-loader.test.ts` 18 个测试 0 个 naming-collision case，让 silent shadowing 4 个 bug 长期潜伏）

4. **Claude reviewer 审 Claude 自己改的代码是同源盲区**——必须 `codex:codex-rescue` 独立审；它能拿规范引用（WHATWG / Chromium 源码）反驳 Claude 的静态假设。同源 reviewer 还会假阳性"P0 自指"批不存在的代码路径，结论先 grep 实证再动。`[×多]`

5. **静态根因连续被推翻 → 停止猜，转用户亲历观察**——用户说"偶发"就是时序/状态相关，不是内容相关；反复在"内容差异"上找根因会浪费多个版本。正解：对比成功 vs 失败样本的字节差异；用户原话比 log 单次快照可靠。`[×多]`（v-24 系列消息滞留三轮 codex 推翻 Claude 假设才修对）

6. **GitHub contributors UI 与 REST API 不同源**——`gh api /contributors` 干净 ≠ 仓库主页 `/contributors_list` HTML 干净；force-push + filter-repo 改写 message 删 `Co-Authored-By:` trailer 后 API 立即干净但 UI 仍显示（GitHub 用全部 commits 含 unreachable 算，几小时到几周才 GC）。彻底解 = `gh repo delete` 后重建（需 `gh auth refresh -s delete_repo` 加 scope）。审 contributors 时抓 `curl -s https://github.com/<o>/<r>/contributors_list?...` 看 HTML 而非只看 API。`[×1, 影响大]`

7. **`navigator.clipboard` / `crypto.randomUUID` 只在 secure context 暴露**——HTTPS / `localhost` / `127.0.0.1` 才有，LAN HTTP `http://192.168.x.x:3001` 下是 undefined 直接 TypeError。两者都要 polyfill（execCommand fallback / `getRandomValues` fallback）。grep 审计：`crypto\.randomUUID\|navigator\.clipboard\.` 任何新 caller 都要过 polyfill。`[×2]`

8. **`isPathAllowed` 在目标路径不存在时不能跳过 realpath 校验**——攻击者可在 allowed root 放 symlink `link → /etc`，PUT `<allowed>/link/new.txt` 时 `lstat(leaf)` ENOENT 走"跳过 symlink 检查"分支返 true，writeFile 写到 `/etc/`。修法：walk-up 到最近存在祖先 realpath 再 isWithinAllowedDirs。`[×1, 安全 P0]`

9. **chevrotain `MismatchedTokenException` 可能 throw 不进 `parser.errors`**——中途打字时某些 GATE 路径让异常逃逸到调用方。任何前端调 `parseToAst()` 的入口（特别是 `useState(() => parseToAst(...))` initializer）必须 try/catch 兜底，或者 parseToAst 改为 NEVER-THROW 契约（包 parse + buildAst 各自 try/catch，throw 转 synthetic parseError 进返回）。`[×1, 崩前端]`

10. **包裹外部 CLI（Ink TUI / Codex / Claude）的修复本质是"绕过"不是"根治"**——外部 CLI 版本升级可能打破 ccweb 的绕过；写 changelog / commit message 用"绕过"/"预期解决"而非"根治"；用户在新 CLI 版本下再报同类 bug 时先 `claude --version` / `codex --version` 比对上次通过的版本范围，再怀疑 ccweb 退化。`[×2]`

END 历史教训 触发下拉 + "+ 新建变量"快捷）+ FlowToolbar + TrackFlowEditor + TrackFlowsListDialog 替换占位 + DeletableEdge + backend track-flow/store + routes/track-flows.ts CRUD。frontend 33 vitest pass。commit `f0c49c8`
- [x] 2026-05-18 **v2026.5.18-c**：v3 M0 清理（删 train-core vendor + v1 visual + v2 graph + 写代码模式）。9 commits 删 ~12000 行；包大小 4.0→2.7 MB；frontend tsc + backend tsc + verify scripts 全过；终态 backend/vendor/@tom2012/ 仅剩 train-adapter-spec。spec `docs/superpowers/specs/2026-05-18-track-v3-flow-design.md` + plan `docs/superpowers/plans/2026-05-18-track-v3-M0-cleanup.md`。commit `b5c45ab`
- [x] 2026-05-18 **v2026.5.18-b**：v2 节点图删除 UI 修复（节点头部 × + 边 hover × + Inspector 删除按钮 + deleteKeyCode 兜底）。1 commit `cc95c0a`。**注意**：M0 已删整个 v2 graph/，本版本代码也随删
- [x] 2026-05-18 **v2026.5.18-a**：v2 ReactFlow 节点图 M1（自由坐标 + Monaco 嵌入 CodeNode + sidecar JSON + 智能补全等）。已被 M0 删除，仅作历史记录

END TODO

