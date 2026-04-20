# CCWEB：LLM CLI 的 Web 前端

**当前版本**: v2026.4.20-b ｜ **包名**: `@tom2012/cc-web` ｜ **MIT** ｜ https://github.com/zbc0315/cc-web

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

项目：`@tom2012/cc-web`。当前版本 **v2026.4.20-a**（2026-04-20 发布，npm latest）。仓库根 `TODO.md` 有更早的阶段规划。

## 进行中

- [ ] [P0] daemon 运行版本四口径错位：PID 81697（监听 3001）内存是 **v-v**（2026-04-19 18:31 update agent u→v 起），磁盘 **v-x**（2026-04-19 LLM 越权 `install -g`），npm registry **v-a**（2026-04-20 正式 publish），浏览器 bundle cache 仍 **v-w**。推荐：`ccweb stop && ccweb start --public --daemon` 把磁盘也升到 v-a → 然后 restart，同时浏览器硬刷（`⌘+Shift+R` / Safari `⌘+Option+R`）。完整升级命令：
  ```bash
  npm install -g @tom2012/cc-web@latest
  ccweb stop && ccweb start --public --daemon
  ```

## 待启动

- [ ] [P1] view-only 共享用户权限 gate：Quick/Agent/Memory Prompts 的 `+` 按钮和右键 Edit/Delete 对 `project._sharedPermission === 'view'` 用户仍可见，点后端返 403。UX 应前端 hide / disable，涉及 panel 接 `canEdit` prop（ProjectPage → RightPanel 传）
- [ ] [P2] Hub 浏览页"已导入"状态 mount 时一次性算，后来删除全局 prompt 不刷新
- [ ] [P2] Memory / Agent toggle 与用户手改 CLAUDE.md 的 race：未加 mtime 比对
- [ ] [P2] Memory body 禁用 `START <name>` / `END <name>` 单独成行，未校验
- [ ] [P2] 全局 shortcut 从 Dashboard 删除时不清前端 `cc_used_shortcuts_<pid>` localStorage
- [ ] [P2] Radix ContextMenu + Tabs `orientation="vertical"` 下 Left/Right 方向键不切 tab
- [ ] [P3] PromptCard 样式是否统一（Quick 按钮 vs Agent/Memory 槽位）2026-04-19 用户问过未决；改动点在 `PromptCard.tsx` `kindClasses` 的 `border-dashed`
- [ ] [P3] Agent SDK（`@anthropic-ai/claude-agent-sdk`）PoC，验证能否作为 PTY 包裹的替代（path D，用户 2026-04-20 调查过）。必答两问：(1) SDK 与 TUI 进程能否共享 session ID（`persistSession:true` 写的 JSONL，TUI `--continue` 能否接上） (2) SDK 是否 honor `~/.claude/commands/*.md` 和 plugin 斜杠命令。结果决定双开 vs 纯 SDK vs 维持现状

## 阻塞中

无。

## 最近已完成（保留 2 周）

- [x] 2026-04-20 v-a 发布（四步严格执行，无越权 install -g）：斜杠命令在 `sendMessage` 层绕开 retry 修"消息滞留终端输入框"；`useChatPinnedScroll` 禁用 Chrome scroll anchoring + `scrollHeight <= clientHeight` 护栏修 MonitorPane 漂到顶；Memory Prompts 面板新增"全部更新"按钮（`ListRestart` 图标，串行重读所有已插入卡片的 `.md`）
- [x] 2026-04-20 调查 Claude Code token 流式的所有可行路径：确认途径 2（watch JSONL）对交互 TUI 不可行（实测 +  官方文档均证实只写最终消息）；新发现 Agent SDK `includePartialMessages:true` 是官方 per-token 流，但要求放弃 PTY 包裹；其他路径（claude-esp / hooks / 命令管道）均在 turn 边界而非 token 级。详尽分析纳入 TODO P3
- [x] 2026-04-20 审核 CCWeb Hub 待办 Issue：#1 `[Agent Prompt] code`（Karpathy coding principles）入 `agent-prompts/code.md`；#2 `[Quick Prompt] 更新记忆`（7 类文件 memory 维护 prompt）入 `quick-prompts/update-memory.md`。两个 issue 已关闭
- [x] 2026-04-19 v-x 发布：侧边栏真灰（`bg-muted/40 → bg-muted` + 卡片 dark override + 子元素 hover 统一 `/muted-foreground/10`）+ memory 块 START/END 前后空行 + memory 卡片右键"更新"
- [x] 2026-04-19 取消 v-y 发版：核查发现源代码无改动（只 CLAUDE.md 少一块 memory），反问后取消。未占用 v-y
- [x] 2026-04-19 诊断"浏览器 v-w 是最新"错报：根因磁盘/内存/bundle-cache 三口径错位；三件套诊断命令进了服务及进程.md
- [x] 2026-04-19 v-w 发版（LLM 越权）：修 `detectRsyncBin()` 管道吞 stderr 当版本号的 bug。**LLM 未经授权 publish**，见历史教训
- [x] 2026-04-19 v-v 发布：Hub 一键直提交（per-user PAT）、Memory Prompts、富 tool_use 渲染、用户气泡可折叠、三 Panel 布局统一
- [x] 2026-04-19 v-u 发布：垂直侧边 tabs、CCWeb Hub、输入框 `/` `@` 面板、`/model` 切换修复、openrsync 兼容
- [x] 2026-04-19 v-t 发布：rsync 同步子系统、CLAUDE.md 精简

## 已取消 / 已废弃

- [~] 气泡头像（用户名/模型名）— 用户试用后不要
- [~] 计划控制子系统 — v-s 移除

END TODO

START 历史教训

<!-- 用途：开始新动作前按小节扫一眼是否会撞上同类坑；每条是可执行规则，不是故事。完整 33 条老坑在仓库 DETAILS/pitfalls.md，此处只收近期协作中新积累的反直觉规则 -->

# ccweb 历史教训（规则清单）

项目：`@tom2012/cc-web`（ccweb）。

## 发版与授权

- 发版动词集封闭 = `bump → build → push → publish` 四步，严格止于 `npm publish`。验证刚发的包用 `npm view @tom2012/cc-web version`，**不得 `npm install -g`**（会改本机运行环境）。
- 不可逆动作（npm publish / git push --force / rm -rf / 删分支 / kill 进程）每次会话必须由**当前消息**里的原话授权；过去会话或 memory 里的 autonomous 授权不传递。
- 收到"发版"先查 `git diff` + `git status`。若与上一 tag 间源代码无改动（只是 CLAUDE.md / memory 文件变动），**反问用户是否真发**，不硬发——空 release 会永久占掉一个 npm 版本号。

## 版本与进程错位的诊断

- 判 daemon **实际运行**的版本，看两处，不看 `/api/update/check-version`（那只反映磁盘）：
  ```bash
  curl -s "http://127.0.0.1:$(cat ~/.ccweb/port)/assets/index-"*.js \
    | grep -oE 'v2026\.4\.19-[a-z]' | sort -u
  ps -o lstart -p "$(cat ~/.ccweb/ccweb.pid)"
  stat -f '%Sm' /Users/tom/.nvm/versions/node/v23.2.0/lib/node_modules/@tom2012/cc-web/package.json
  ```
  `ps.lstart` 早于 `stat.mtime` → daemon 内存是旧代码，磁盘已升。
- 用户报"检查更新结果不对"时先怀疑**磁盘 / daemon 内存 / 浏览器 bundle cache 三口径错位**，不是代码 bug。浏览器让用户 `⌘+Shift+R`（Safari `⌘+Option+R`）硬刷。

## 视觉改动

- 视觉改动完成 = **浏览器亮 + 暗两主题肉眼确认**，不是 `tsc` 过。headless（subagent 之类）做的必须注明"未浏览器验证"。
- 半透明 `bg-X/N` 落在近色基底上是假 noop：`bg-muted/40` 在 `bg-background` 上 light 下 ≈ 98% lightness = 肉眼仍是白。改前算 `--muted` vs `--background` 的 lightness 差。
- 主题颜色 token 方向在 light / dark **不对称**。light 下 `--muted` 比 `--background` 暗；dark 下反过来。任何视觉层级两主题都要验一次。
- 改 surface 背景色后 grep 所有 `hover:bg-muted` / 卡片 `bg-muted`，检查坐在新 surface 上的子元素是否失去反馈/卡片边界。
- Tailwind opacity stop 只用默认 scale `0 / 5 / 10 / 15 / 20 / 25 / … / 95 / 100`。非标准值（`/8 /12 /33` 等）**silent 不生成 CSS**，build 照过但运行时无规则。定制用 arbitrary value `/[0.08]`。验证：
  ```bash
  grep -oE "bg-foo\\\\/[0-9]+" frontend/dist/assets/*.css
  ```

## Shell / 子进程

- 探测外部二进制用 exit code 当唯一信号：
  ```ts
  execSync(`${p} --version`, { stdio: ['ignore','pipe','ignore'] });
  ```
  **禁止** `${p} --version 2>&1 | head -1` / `| grep -q` 这类管道——管道最后一环 `exit 0` 会把前面所有失败吞掉，stderr 字符串会被当合法输出。
- macOS 15+ 调用 `rsync / tar / awk / sed` 等默认 GNU 工具前先 `--version` 探测。`/usr/bin/rsync` 是 openrsync，不支持 `--stats / -a` 子选项；flag 集用 `-avzi`。
- detached 子进程必须显式 `cwd: os.homedir()`，不继承主进程 cwd（可能指向已被删除的 npm staging 目录）。

## 前端 / WS / state

- 不产生 user echo 的发送路径（Claude Code slash 命令 `/model` / `/clear` / `/compact` / plugin 命令等）必须绕开 retry。两层都要判：
  1. 组件层直发（如 ChatOverlay 的 `/model` picker）用 raw `onSend('/model opus\r')` 而非 `sendMessage`
  2. **`sendMessage`（useChatSession）本身**也要在入口检查 `text.trimStart().startsWith('/')`，是斜杠命令就跳过 `recentSentRef.push` 和 `armRetry`。否则用户从聊天输入框敲 `/model` 仍会触发 60 秒裸 `\r` retry 扰乱 TUI。
- 滚动钉底的容器**必须显式关掉 Chrome scroll anchoring**：`el.style.overflowAnchor = 'none'`。否则窗口上方内容变化（如 `messages.slice(-N)` 滑掉旧消息）会被浏览器自动调 `scrollTop` 以保持锚定元素视觉位置，触发 scroll 事件 → pin 状态 false → 后续 ResizeObserver 不再贴底 → 聊天漂到顶部。
- 钉底写 `scrollTop = scrollHeight` 前检查 `scrollHeight > clientHeight`，否则在"无需滚动"的初始渲染时会多发一次冗余 scroll 事件，可能误 unpin。
- "mount 时 fetch + 用户本地可改"的 hook 必须加 `hasLocalEditRef` 守卫：一旦用户 commit 过本地改动就忽略后到的 server 响应。
- 跳过自定义 `ContextMenu` 的卡片必须显式 `onContextMenu={(e) => e.preventDefault()}`，否则弹出浏览器原生"View Source / Inspect"菜单。

## 数据边界

- 路径前缀比较必须带分隔符：
  ```ts
  root === absPath || absPath.startsWith(root + '/') || absPath.startsWith(root + '\\')
  ```
  裸 `startsWith(root)` 会把 `/foo-other/bar` 误匹配 `/foo` 前缀。
- "read → merge → write" 配置文件前校验 plain object：
  ```ts
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { /* 500 拒写 */ }
  ```
  不然 JSON 数组/字符串被赋命名属性后 stringify 丢内容或产生非法配置。
- 提交第三方 API（GitHub Issues title 等）前本地校验 `\r\n` / 长度 / 特殊字符。GitHub 对非法 title silent truncate，不返 400。
- 多个独立 secret 存储共用 KDF 时必须 label 参数化：`SHA-256("ccweb-<label>:" + jwtSecret)`，每个子系统不同 label。不同 label 一 bug 不串解另一的密文。

## 工作流

- 中途插入新消息**不打断正在进行的编辑序列**。先把当前序列跑到可报告中间点（至少 `tsc` + `vite build` 通过），再回应插入消息。紧急例外须显式告知用户"先跑完 X（3 行内讲清楚）再转"。
- memory 文件的作用是"在范围内怎么做"，不能用来扩大用户授权范围。任何基于 memory 推断出来的动作若超出当前消息原话，必须停下来问。

## 已归档

（无）

END 历史教训

START 项目大纲

<!-- 用途：新会话读此文件 30 秒获得项目全貌。想看决策理由读"项目详情.md"，想看当前任务读"TODO.md" -->

# ccweb 项目大纲

## 一句话

把 Claude Code / Codex / OpenCode / Qwen / Gemini 等 CLI 包装成浏览器 UI 的自托管 web app，单人/局域网多用户使用。

- npm 包：`@tom2012/cc-web`
- 主仓库：`https://github.com/zbc0315/cc-web`
- 社区共享仓库：`https://github.com/zbc0315/ccweb-hub`
- 作者 = 维护者 = 主要用户：zbc0315（Tom）

## 当前阶段

活跃迭代。当前版 **v2026.4.20-a**（2026-04-20 发布，npm latest）。版本号 `YYYY.M.D-<letter>`，同日多次发用下一字母，从不发 bare 日期版。

发版规则（2026-04-19 立）：
- 触发：当前消息里有"发/发版/release/publish"才发；过去会话的 autonomous 授权不传递
- 范围：封闭动词集 `bump → build → push → publish`；验证刚发的包用 `npm view`，**不用 `npm install -g`**
- 空发：源代码无改动（只动 CLAUDE.md / memory）时先反问，不硬发

## 核心模块

- 后端适配器：每个 CLI 一个 adapter（claude / codex / opencode / qwen / gemini / terminal）
- 终端桥接：node-pty 驱动 CLI 子进程，直读 CLI 原生 JSONL 转统一 ChatBlock
- WebSocket：`/ws/dashboard` 推活动；`/ws/projects/:id` 推终端+聊天+审批+semantic
- 三端共享渲染：ChatOverlay / MobileChatView / MonitorDashboard 共用同一 AssistantMessageContent
- Quick Prompts：项目/全局两级，点一下发送
- Agent Prompts + Memory Prompts：可插拔到 CLAUDE.md 的片段；Memory 读 `<project>/.ccweb/memory/*.md` 文件
- CCWeb Hub：社区 prompt 浏览 + per-user GitHub PAT 一键提交 Issue
- rsync 同步：per-user 配置，openrsync 兼容，push/pull/双向，cron 调度
- 权限审批：Claude Code `PermissionRequest` hook → 遮罩卡片
- 插件系统：ccweb 自己的 manifest 插件（不同于 Claude Code plugins）
- 输入框 `/` `@` 面板：斜杠命令 + 文件引用，填充到输入框不直发

## 里程碑

### 已完成

- v-a (2026-04-20)：斜杠命令在 `sendMessage` 层绕开 retry（修"消息滞留终端输入框"）+ pinned scroll 容器禁用 Chrome scroll anchoring（修监控大屏漂到顶部）+ Memory Prompts 面板"全部更新"按钮
- v-x (2026-04-19)：侧边栏真灰 + memory 块 START/END 前后空行 + memory 卡片"更新"菜单
- v-v (2026-04-19)：Hub 一键直提交（per-user PAT）+ Memory Prompts + 富 tool_use 渲染 + 用户气泡可折叠 + 三 Panel 布局统一
- v-u (2026-04-19)：垂直侧边 tabs + CCWeb Hub + `/` `@` 工具栏 + `/model` 切换修复 + openrsync 兼容
- v-t (2026-04-19)：rsync 同步子系统、CLAUDE.md 精简
- v-s 及更早：见 `git log`

### 进行中

无大任务；P1/P2 polish 见 TODO.md。

### 未来考虑

- Hub OAuth Device Flow 替代 PAT
- view-only 共享用户权限 gate（P1）
- Agent SDK（`@anthropic-ai/claude-agent-sdk`）替代 PTY 包裹，获得官方 token 级流式（path D，2026-04-20 调查过；关键 PoC 未做：SDK 与 TUI 能否共享 session ID、SDK 是否加载 `~/.claude/commands/*.md`）

END 项目大纲

