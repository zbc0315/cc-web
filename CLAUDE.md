# CCWEB：LLM CLI 的 Web 前端

**当前版本**: v2026.5.24-j ｜ **包名**: `@tom2012/cc-web` ｜ **MIT** ｜ https://github.com/zbc0315/cc-web

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

1. **npm 发版闭环规则**——三条都必须遵守：(a) **bump 前必跑 `date "+%Y-%m-%d"`**：长会话跨午夜，system prompt 的 currentDate 是会话起点快照不是实时；用快照日期发出的版本号一旦上 npm 就**永久占用**无法撤回；(b) 动词集封闭 `bump→build→push→publish`，止于 publish；不准顺手 `npm install -g` 或 `ccweb stop && start`，装机/重启需当前消息明确授权；(c) 验证用 `npm view @tom2012/cc-web version` 不用 install（CDN 传播延迟会命中旧版）。**附加坑**：npm token 经常 revoke/过期（2026-05-20 v-20-a 跨次会话失效），publish 401 时让用户提供新 token，已 push commit 保留不需 bump；prepublishOnly 触发 root `npm run build` 含 backend tsc，**backend tsconfig 无 DOM lib**——e2e test 里 `page.evaluate((el: HTMLInputElement) => el.value)` 会 publish 失败，必须改 `(el: unknown) => (el as { value: string }).value` 和 `(globalThis as unknown as {...})`。`[×6+]`

2. **"verify script / 测试方案 ≠ 真测试"**——parse 通过 ≠ runtime 通过；任何"用户第一次按按钮就要工作"的入口必须 end-to-end smoke test，用 mock adapter / fake binary / 真起 chromium 跑到 `ok=true` 再发版。**v-24-b 又印证**：browser-proxy cookie 方案 vitest fetch 手传 `Cookie` header 全 pass（35 tests），用户实测 LAN 部署下 sandbox iframe 内子资源全 403——因为 sandbox iframe (无 allow-same-origin) = opaque origin，浏览器视为 cross-site，SameSite=Lax cookie 一律不带，而 vitest 手传 header 模拟不到这个行为。修法：cookie 改 `?_bp_tok=` query token。**v-20-a 同类**：cli-prompt-detector 16 vitest 全 pass、codex GO，发版后 detector 永远 active=null（fixture 用假设的字面空格不是真 PTY 字节）。**v-24-c MVP 用户授权跳过浏览器手测**也是同类风险，第一次按按钮 viewport 拉伸 → v-24-d hotfix。`[×6]`

3. **Path-based reverse proxy 处理不了 ES module 内 absolute import**——HTML rewriter 只能动 `src/href/action` attribute 的 path，**改不了 JS 字面量里 `import "/foo"`**。Vite dev / 复杂 SPA 必坏：iframe 加载 main.tsx OK，但 main.tsx 内 `import { x } from "/node_modules/.vite/deps/react.js"` 浏览器按 origin 解析 → 打回 daemon 主路径 → SPA fallback 返 index.html (text/html) → MIME 拒绝。**架构性问题不是单 bug 修补**：v-24-a/b 加 token rewrite/strip 后浪费 1 天，v-24-c 整套换 headless chromium screencast 才根治。早期识别"path-based ≠ ESM-compatible"避免投入。`[×1, 大]`

4. **sandbox iframe (无 allow-same-origin) = opaque origin → SameSite=Lax cookie 不带**——浏览器实现细节，spec 上 cookie 跟随 same-site GET，但 sandbox 把 iframe origin 变 opaque，对它来说所有 URL 都是 "cross-site"。修法二选一：(a) 用 query token (`?_bp_tok=`) 替代 cookie + 后端 strip 不传上游；(b) iframe 加 `allow-same-origin`——但 sandbox 等于失效（代理页能读 ccweb 主 localStorage 拿 token）。v-24-b 选 (a)。`[×1]`

5. **Claude reviewer 审 Claude 自己改的代码是同源盲区**——必须 `codex:codex-rescue` 独立审；同源 reviewer 还会假阳性"P0 自指"批不存在的代码路径，结论先 grep 实证再动。`[×多]`

6. **静态根因连续被推翻 → 停止猜，转用户亲历观察**——用户说"偶发"就是时序/状态相关，不是内容相关；正解：对比成功 vs 失败样本字节差异；用户原话比 log 单次快照可靠。**v-20-b 印证**：v-20-a 部署后 detector active=null 先猜了"daemon 没升级 / typographic quote"等四个假设全错，WS 旁路抓 PTY 实际字节 dump 才看到 CHA 序列真相。`[×多]`

7. **`navigator.clipboard` / `crypto.randomUUID` 只在 secure context 暴露**——HTTPS / `localhost` / `127.0.0.1` 才有，LAN HTTP `http://192.168.x.x:3001` 下 undefined 直接 TypeError；必须 polyfill。剪贴板**写**有 textarea+execCommand fallback；**读**无可靠 fallback（execCommand('paste') 被禁用），LAN HTTP 下 Cmd+V 只能告诉用户失败。`[×3]`

8. **`isPathAllowed` 在目标路径不存在时不能跳过 realpath 校验**——攻击者可在 allowed root 放 symlink `link → /etc`，PUT `<allowed>/link/new.txt` 时 `lstat(leaf)` ENOENT 走"跳过 symlink 检查"分支返 true，writeFile 写到 `/etc/`；修法 walk-up 到最近存在祖先 realpath 再 isWithinAllowedDirs。`[×1, 安全 P0]`

9. **`isPrivateAddress` deny-list 反过来当 allowlist 会错放 hostname**——notify-service 的 `isPrivateAddress('10.evil.com')` 因字符串前缀 `startsWith('10.')` 返 true（设计意图是拒绝 outbound webhook 打私网）；browser-proxy v0 直接复用 → `10.evil.com` 被当 private 放行 SSRF。修：独立写 `isAllowedProxyIp`，**先 `net.isIP(a)` 守卫**只接受真 IP literal + 加 cloud metadata 黑名单 (169.254.169.254 等)；hostname 单独走 `dns.lookup(all:true)` 拿到 IP 后再走 IP 校验，结果 pin 到 fetch URL 防 rebinding TOCTOU。`[×1, 安全]`

10. **包裹外部 CLI（Ink TUI / Codex / Claude）的修复本质是"绕过"不是"根治"**——外部 CLI 升级可能打破 ccweb 的绕过；写 changelog 用"绕过"/"预期解决"而非"根治"；新 CLI 版本下用户再报同类 bug 时先 `claude --version` / `codex --version` 比对再怀疑 ccweb 退化。**Ink TUI 子坑**：Claude / 多数 Ink CLI 用 CHA `\x1b[<n>G`（cursor 绝对列定位）/ CUF `\x1b[<n>C` 代替字面空格做布局对齐——任何 ANSI strip 必须**先把 CHA → 单空格、CUF → n 空格再删通用 CSI**（顺序关键）。**playwright 子坑**：`Browser` 不暴露 `process()` public API（puppeteer 才有），daemon SIGTERM 后无法主动 SIGKILL 残留 chromium，靠 OS propagate SIGHUP；CDP `Page.startScreencast` **静态页不送帧**（无视觉变化无新 frame），integration test 必须动画页才能验。`[×3]`

END 历史教训

START TODO

项目：`@tom2012/cc-web`。当前版本 **v2026.5.24-j**（npm registry latest）。daemon 是否已升级 = 用户当前消息明示，过去会话授权不传递。

## 进行中

- [ ] [P1] **Browser tab 用户实测打磨**：v-24-c → v-24-j 累计 8 版（含 v-24-d 漏接 ResizeObserver hotfix），实测剪贴板 / 文件传输 / 中文 IME / 多用户 cap。已知体验缺：Cmd+A 等平台特定组合 chromium headless 内是 Meta+A 还是 Ctrl+A 跨平台不一致；canvas 聚焦没有视觉指示（focus ring 只在键盘 Tab 进入时显示）
- [ ] [P1] **v3 M3 浏览器手测打磨**：用户实测完整链路（user_input → 多 LLM → if 循环 → end），用真实 claude-code 跑通；预期暴露 cancel 中间态 / skipped 节点 / run-state.json done flag LLM 自觉性差等问题
- [ ] [P1] **v3 M3 skipped 节点状态 runtime emit**：if 节点未走的分支需 emit skip 让前端灰划线显示；当前仅 active/completed/failed/waiting 状态有写入
- [ ] [P1] **v3 M3 runs 历史回放**：audit log `.flow.runs/<runId>.log.jsonl` + run-state.json 已写，但前端没读 + 展示 UI；需 `/api/projects/:pid/track-flows/:basename/runs` list + 单 runId log get + 前端 RunHistoryPanel
- [ ] [P1] **v3 M4 verify-flow-v3 扩展**：当前 5 checks 只覆盖 happy path；要加 cancel mid-llm / quota 超限 / failed=true LLM 自报失败 / user_input dialog 取消 / sidecar desync 恢复
- [ ] [P1] **v3 M4 Playwright E2E**：拖 3 节点 + 连边 + 保存 + 运行 + 校验 .flow + train.json + run-state.json + WS 事件路径
- [ ] [P1] **mobile/desktop chat 周边 hook 抽离（保守路径）**：新建 `frontend/src/hooks/useApprovalQueue.ts` + `useCliPromptState.ts`，桌面 ChatOverlay + 移动 MobileChatView 各减 ~50 行重复（approval card + cli prompt 卡片重复逻辑）。不做激进 useChatPanel 总 hook —— 动效/布局差异强行 DRY 反而引入 layout-specific workaround
- [ ] [P1] i18n Phase 2 续摊：剩 AgentPromptsPanel / HubTokenSection / MemoryPromptsPanel / FileTree / GitPanel / SkillHubPage / ShortcutPanel / MobileChatView / MobileSidePanel / MobileProjectList 约 25 文件；一次攻 1 文件到 `grep [一-鿿]` 为零再 commit
- [ ] [P1] UI shadcn 化未完：ChatOverlay 1016 行拆分；SkillHubPage 重组；`h-N w-N → size-N` 语义化（codemod）；Framer → Tailwind `data-state` 动效
- [ ] [P1] audit P2 收敛项：handler 内联 `isAdminUser`/`isProjectOwner` 改 middleware（`routes/projects.ts` / `routes/sync.ts`）；WS auth 在 upgrade 后做（race）；动效裸写 0.2/0.25 没走 `MOTION` token

## 待启动 — Browser tab Phase 5 + 后续

- [ ] [P1] **Browser 移动端接入**：`MobileSidePanel` 是块状布局非 Tab，需独立 BrowserPanel 适配；触屏鼠标事件改 touch + 双指缩放；当前 BrowserPanelChrome 桌面 only
- [ ] [P1] **Browser Phase 5 重连**：daemon 重启后 in-flight session 直接丢，前端 WS close + sessionError，需要持久化 last URL + 重启后跳回；WS 抖断重连支持（当前 `ws.onclose` 仅 toast 不重连）
- [ ] [P2] **删 path-based proxy 死代码**：v-24-c 起前端 RightPanel 改挂 BrowserPanelChrome，`browser-proxy.ts` 路由 + `BrowserPanel.tsx` 留着没人用；保留一段实测期后删（v-26 cleanup 候选）
- [ ] [P2] **Browser Phase 5 chromium zombie 防护**：playwright `Browser` 不暴露 `process()` API（puppeteer 有），daemon SIGTERM 后无法主动 SIGKILL 残留 chromium；考虑用 puppeteer-core 替换 or 自管 `child_process.spawn` 然后 detached:false + process tree kill。当前靠 OS propagate SIGHUP，极端 case 留 zombie
- [ ] [P2] **Browser Phase 5 HiDPI**：当前锁 viewport 1280×800，HiDPI deviceScaleFactor 不开；4K monitor 看模糊；开后帧大小翻倍要带宽控制
- [ ] [P2] **Browser N-ops auto restart**：research 警告 chromium long-running 0.5MB/s 内存漂移；当前靠 5min idle sweep 兜底，要每 N=100 ops destroy+recreate+nav 回 URL（要前端 WS 重连支持）
- [ ] [P2] **Browser 内存监控**：当前 30s `Performance.getMetrics` log warn / 1GB force destroy，但用户没 metric UI 看；可加 `/api/browser-chrome/_stats` 端点 + 设置页显示
- [ ] [P3] **Browser Phase 4.5 context menu**：右键 → daemon page.evaluate 探测目标元素 (link/image/text) → 自定义菜单 OR forward 浏览器原生。复杂度高 ROI 低，可能永久跳过
- [ ] [P2] **Browser Cmd+A 等平台特定快捷键不一致**：macOS chromium headless 内 select all 是 Meta+A 不是 Ctrl+A，跨平台 daemon vs user 系统不一致。当前 frontend 把 Meta/Control 都正常 forward 给 chromium，但 chromium 按自己平台逻辑响应

## 待启动 — CLI prompt detector 后续

- [ ] [P1] **detector 不止 Claude resume menu**：现在仅 `claude_resume_session` 一种 fingerprint；Codex / Gemini / OpenCode / Qwen 也有交互菜单（permission、resume、auth flow 等），同模式可扩 fingerprints 数组多加几种
- [ ] [P2] **detector 实测如发现单 digit 不够（Ink select 不立即选）**：在 `respond` endpoint 加 `<digit>\r` fallback。当前 v-20-b 只发 digit，假设 Ink select 按数字键即选不需 Enter
- [ ] [P2] **detector 跨帧混拼风险**：parseOptions 现在扫整 8KB buffer latest-wins by digit；Ink chunk 撕开一帧时可能混拼
- [ ] [P2] **detector dismissed 滞后**：当前 dismissed 仅在 8KB ring buffer 滚出关键词才触发；用户点选后 CLI 输出少时卡片长期残留。可识别清屏 ANSI 序列 `\x1b[2J` / `\x1b[H\x1b[J` 提前 dismiss

## 待启动 — v3 Phase 2+ 候选

- [ ] [P1] **v3 子流程节点**：节点本身是 .flow 文件，进入 sub-runtime（spec §18 Phase 2）
- [ ] [P1] **v3 并行节点 + join 汇合**：多源调研常见；含同步多 LLM + 变量合并冲突策略
- [ ] [P1] **v3 if expr 扩展**：`.length` / 字段访问 `x.a.b` / `in` 算子；当前仅 `==/!=/>/<` + `&&/||` + 字面量
- [ ] [P2] **v3 节点 retry policy**：当前节点失败立即整 run failed
- [ ] [P2] **v3 节点级 / 工作轨级超时**：当前仅总 run 时长 2h
- [ ] [P2] **v3 sidecar desync 三选恢复**：spec §11.4 设计三选 dialog，M1 简化为只显示 banner
- [ ] [P2] **v3 .flow 列表 mode 字段**：当前前端 list 后 batch fetch 判类型
- [ ] [P2] **v3 Monaco 嵌入 CodeNode**：M1 用 textarea + 智能补全
- [ ] [P3] **v3 undo/redo**：图结构变化 ctrl+z/y
- [ ] [P3] **v3 LLM 调用监听换 chokidar**：当前 `fs.statSync` 500ms polling run-state.json
- [ ] [P3] **v3 runtime 持久化**：daemon 重启后 in-flight run 当前直接 failed；可写状态恢复

## 待启动 — 其他

- [ ] [P0] terminal-manager backoff 历史 bug：`startTerminal` 每次清 `crashCounts.delete(project.id)` → MAX_RESTART_RETRIES=5 永不生效；修法 `startTerminal` 加 `isRetry: boolean` 参数 retry 路径不重置
- [ ] [P1] chat_subscribe 旧客户端 full history replay cap：客户端不传 `replay` 字段用 `Number.MAX_SAFE_INTEGER` 全文 replay，多 MiB 累积可能撞 128 MB grace；修 handler 强制 cap 200 blocks
- [ ] [P1] audit U5 Settings 神秘悬浮圆点：跳过待浏览器实测
- [ ] [P1] Codex tool_result shape 拆字段：Claude adapter 产 `content(200 short) + output(4000 full)` 两字段，codex-adapter 当前只产 `content(4000)`
- [ ] [P1] view-only 共享用户权限 gate：Quick/Agent/Memory Prompts 的 `+` 按钮和右键 Edit/Delete 对 `_sharedPermission === 'view'` 用户仍可见
- [ ] [P1] view-only 共享用户 CLI prompt respond 403：cli-prompt 卡片在 view-only 用户仍渲染按钮，点击后端返 403 → toast；UX 可前端 disable 按钮
- [ ] [P2] 协作者跑流权限：所有 track-flow 端点 owner-only，分享项目协作者跑不了
- [ ] [P2] ScheduleWakeup 面板"已触发"判定 false positive 风险
- [ ] [P2] Hub 浏览页"已导入"状态 mount 时一次性算，后来删除全局 prompt 不刷新
- [ ] [P2] Memory / Agent toggle 与用户手改 CLAUDE.md / AGENTS.md 的 race：未加 mtime 比对
- [ ] [P2] Memory body 禁用 `START <name>` / `END <name>` 单独成行，未校验
- [ ] [P2] 全局 shortcut 从 Dashboard 删除时不清前端 `cc_used_shortcuts_<pid>` localStorage
- [ ] [P2] Radix ContextMenu + Tabs `orientation="vertical"` 下 Left/Right 方向键不切 tab
- [ ] [P2] CLAUDE.md/AGENTS.md 切工具时孤儿块检测
- [ ] [P2] Gemini / OpenCode / Qwen 的 `getProjectInstructionsFilename()` 实际约定（当前保守默认 AGENTS.md）
- [ ] [P2] ChatOverlay 500ms rerender 频率：WS 每 500ms 一条 `semantic_update`，ChatOverlay 没 `React.memo`
- [ ] [P2] v3 多入口支持：当前 validator 强制 in-degree=0 节点 ≤ 1
- [ ] [P3] `projectIdleTimers` Map memory 清理
- [ ] [P3] PromptCard 样式是否统一
- [ ] [P3] Agent SDK PoC：SDK 与 TUI 能否共享 session ID
- [ ] [P3] `DETAILS/backup.md` 文档清理：v-c 移除云盘备份代码，文档还在
- [ ] [P3] i18n 跨设备实时同步 / 首次登录 flicker
- [ ] [P3] `/api/logs` HTTP 端点（admin-only）远程看日志
- [ ] [P3] WS 连接的 `wsId` ALS scope
- [ ] [P3] SIGUSR1 扩展成按模块开关 log level

## 已废弃 / 不再追

- [~] 老 flows v1 任务流系统（v-h 删干净）
- [~] v1/v2 工作轨节点图 + 写代码 .tr 模式：v3 M0 删
- [~] train-lang DSL：v-18-c 起完全抛弃；vendor 仅保留 `@tom2012/train-adapter-spec` 类型协议
- [~] outputs check 强约束：v-j 改成 done flag 唯一判定 + outputs 检查降级为 warning
- [~] cwd `train.json` / `workflow_data.json` 命名：v-h 改私有名 `.ccweb-flow-train.json`
- [~] FlowMinimapCard 右下角固定悬浮：v-k 移到 LeftPanel tracks tab 内 embedded 模式
- [~] 列表行 ▶ 弹编辑器 Dialog：v-l 改 dispatch CustomEvent 顶层 driver 处理
- [~] CliInteractivePromptCard 的"切到终端" / "知道了" dismiss-only 按钮：v-20-a 第一次实现是轻量提示卡，改为 options.map 可点击按钮 + 桌面/移动同代码
- [~] **Browser tab path-based reverse proxy (v-24-a/b)**：HTML/JS rewrite 不能处理 ES module 内 absolute import，Vite dev 必坏；v-24-c 整套换 headless chromium screencast 架构；路由 + 组件留着没人用待 cleanup
- [~] **Browser tab cookie auth (v-24-a 初版)**：sandbox iframe = opaque origin → SameSite=Lax 不带；v-24-b 改 `?_bp_tok=` query token + daemon strip 不传上游

## 最近已完成（保留 2 周 / 最多 5 条）

- [x] 2026-06-08 **v2026.6.8-a**：ccweb MCP server（stdio）。新子命令 `ccweb mcp` 暴露 8 个 tool 给 Claude Code / Codex / Cursor：list_projects (含 archived filter)、archive_project、unarchive_project、list_files、read_file、read_memory、send_to_llm、wait_for_llm。daemon 加 2 个端点：`POST /:id/send-input { text, mode: paste|raw }` 返回 `{ ok, sentAt: ISO }` 锚点；`GET /:id/semantic-status`。stdio MCP server 用 `/api/auth/local-token` 拿 admin JWT（同机同用户 ≈ admin，文档已注 trust boundary）。wait_for_llm 用 sentAt 比对 ChatBlock.timestamp 判 "新 turn 已到 + active=false"，解决 review 发现的 P1（fast turn miss、并发误识别、撒谎 timedOut）。read_file tooLarge/binary 加 note hint。backend 147 + tsc 干净，stdio JSON-RPC smoke 通。
- [x] 2026-05-24 **v2026.5.24-j**：Browser Phase 4.3 文件上传。chromium `<input type=file>` → playwright `page.on('filechooser')` → daemon 存 `session.pendingChooser` + push WS `{type:'request-file',multiple}`。前端弹隐藏 `<input type=file>` 自动 click → 选好走 multipart POST `/api/browser-chrome/:sid/upload?token=` → daemon multer 写 tmp (50MB/file cap) → `chooser.setFiles(paths)` → chromium 接收 → 清 tmp + pendingChooser。文件名 latin-1→utf-8 decode 支持中文。playwright FileChooser default timeout 30s。backend 147 + frontend 47 + tsc 干净。
- [x] 2026-05-24 **v2026.5.24-i**：Browser Phase 4.2 文件下载。chromium 触发下载 → playwright `page.on('download').saveAs(/tmp/ccweb-dl-<uuid>)` → 读 buffer 进 `session.downloads` Map（100MB cap）→ WS 推 `download-ready` → 前端构造 anchor `/api/browser-chrome/:sid/download/:dlId?token=...` 自动 click 触发主机保存。RFC 5987 双 Content-Disposition 支持中文文件名。buffer serve 一次后立即删释放内存。Session 接口加 `downloads: Map`。backend 147 + frontend 47 + tsc 干净。
- [x] 2026-05-24 **v2026.5.24-h**：Browser Phase 4.1+4.4 剪贴板 + page title。Cmd/Ctrl+C 截走→`{type:'clipboard-read'}` →daemon `page.evaluate(getSelection)` → 推回 `clipboard-text` → 前端 `navigator.clipboard.writeText`（LAN HTTP secure-context 缺失走 textarea+execCommand fallback）；Cmd/Ctrl+V → `navigator.clipboard.readText` → 发 `{type:'type', text}`；Cmd/Ctrl+X = copy + 仍 forward 删 selection。`InputMsg` 加 `clipboard-read` + `ReplyFn`。daemon `page.on('domcontentloaded'|'framenavigated')` 推 `title` → BrowserPanel 顶部 11px title 行。新增 e2e selection='copy me 你好'。backend 147 + frontend 47 + tsc 干净。
- [x] 2026-05-24 **v2026.5.24-g**：Browser Phase 3 多用户隔离 + 内存监控 + shutdown timeout。SessionLimitError 自定义 class，超 maxSessions=3 → routes 转 HTTP 429 (前端友好 toast 不再 generic 500)。30s 间隔 `Performance.getMetrics` 内存采样，JSHeapUsedSize 超 500MB log warn，超 1GB 自动 force destroy。destroyAll 加 5s grace + 超时后 log warn（playwright Browser 不暴露 process() API，无法主动 SIGKILL；靠 daemon force-exit 5s 触发 OS 清理子进程）。e2e 多用户 page 隔离 + 第 4 user 抛 SessionLimitError + reuse 已有 user 在 cap 下仍 work。backend 146 + frontend 47 + tsc 干净。

END TODO

