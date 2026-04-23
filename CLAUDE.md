# CCWEB：LLM CLI 的 Web 前端

**当前版本**: v2026.4.23-c ｜ **包名**: `@tom2012/cc-web` ｜ **MIT** ｜ https://github.com/zbc0315/cc-web

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
- Edit 工具的 body 格式 `--- old\n{old}\n+++ new\n{new}` **不是 unified diff**（body 行无 `+`/`-` 前缀）。chat 气泡里对它用 `language="diff"` 而不是文件语言，否则 `---` / `+++` 会被当 mangled operator。Write 工具是完整新文件内容，用 `langFromPath(file_path)`。适用于：改 `AssistantMessageContent` 或别处要高亮工具调用 body 时。
- Claude Code JSONL 里 agent-spawning 工具的 `name` 字段实测是 `Agent`（非官方 schema 文档说的 `Task`）。前端按 name 分流前 grep 一次 `~/.claude/projects/*/*.jsonl` 验证当前 CLI 版本的实际 name。适用于：写按 tool name 分流的 UI 代码时。

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

## i18n (react-i18next)

- 不支持的 locale（如 `fr-FR`）**回退 `en` 不回退 house default**。`fallbackLng` 只管 key missing 兜底，detection 阶段用 `convertDetectedLanguage` 显式映射。zh 只给明确 zh-系 locale。适用于：加 i18n 或扩词表。
- 词表 allow-list **同步两端**：backend route allow-list + 前端 `SUPPORTED_LANGUAGES` 必须完全一致，前端新增词表同时必须改 backend PUT 端点。不同步会出现"UI 可选、服务端 400 拒写"。
- `interpolation.escapeValue: true`（**不是**关掉）。即便当前只走纯字符串 toast，插值 value 常含后端 error message 等攻击者可控内容；一旦未来接 markdown / 富 toast 就 XSS。成本近零，默认开。
- DEV 下开 `debug: import.meta.env.DEV` + `saveMissing: import.meta.env.DEV` + `missingKeyHandler`，否则打错的 key 静默以字面量形式 ship 到生产。
- 一个文件只迁移一半**比不迁移更糟**（混合 hardcoded + `t()` 会掩盖 Phase N 进度、让人误判完成度）。一次攻一个文件到"grep 中文为零"再 commit。适用于：多文件分批迁移 i18n 时。
- 跨设备 language 同步靠浏览器 reload，不 repoll。要实时推走 `/ws/dashboard`，不要起轮询。

## 工作流

- 中途插入新消息**不打断正在进行的编辑序列**。先把当前序列跑到可报告中间点（至少 `tsc` + `vite build` 通过），再回应插入消息。紧急例外须显式告知用户"先跑完 X（3 行内讲清楚）再转"。
- memory 文件的作用是"在范围内怎么做"，不能用来扩大用户授权范围。任何基于 memory 推断出来的动作若超出当前消息原话，必须停下来问。
- 用户报"bug 没修好"时**不要叠加新修复前先证伪旧修复**。v-a 修斜杠 retry 的"消息滞留"修不彻底，v-22-a 正确诊断前先尝试过 drainAndClose WS 假设（被浏览器实测证伪）、多行转换假设（被用户补充的"单行长消息"排除）、键绑定假设（被用户补充的 Shift+Enter 排除），每排除一条才精确锁定 Ink paste heuristic。盲加修复 = 垃圾代码堆积。

## WS / 浏览器规范

- `ws.close()` 按 RFC 6455 规范**本来就会 drain outgoing buffer 再发 close frame**。Chrome/Firefox/Safari 都这么实现。SPA 内部导航不撕 JS heap，ws 对象存活，`close()` 在活 JS 里跑，不会丢尾。所以**不要为"nav-away 丢 WS 尾包"添 500ms drainAndClose 延迟**——是 no-op。适用于：怀疑 WS 数据丢失时。
- 判断 WS race 是否真存在唯一靠**浏览器沙箱实测**：Playwright 加 init script 劫持 `WebSocket` 拿 live handle，构造极端 send + close 时序，从服务端 scrollback 回放看数据是否到达。比 review 推理可靠。

## Claude Code TUI PTY 交互

- Claude Code 基于 Ink/React TUI，对单次 PTY read 的大块字符串（~100+ 字阈值）启用 paste 模式。paste 内部 `\r` = 软回车换行，**不 = 提交**。大段文本末尾 append `\r` 一起 PTY.write 触发 heuristic → 最后的 `\r` 被当换行 → 消息留输入框多一空行。
- 修法：用 bracketed paste 标记明示 `\x1b[200~{text}\x1b[201~\r`。Ink 识别标记后把 body 当 paste 一次性插入，`\x1b[201~` 后的裸 `\r` 回归 Enter 键语义。strip 用户文本中嵌入的 `\x1b[20[01]~` 防 mode 提前退出。适用于：往 Claude CLI PTY 送批量文本时。
- 斜杠命令（`/model` 等）**不用 bracketed paste**——Claude 的 `/` picker 按逐字符解析输入前缀识别命令，吃不了 paste 事件。保留 `text + '\r'` 路径。
- Claude CLI 的 OAuth login prompt（sandbox 里未登录时的状态）也是 Ink 输入路径，paste 识别一致。所以没 auth 的沙箱里也能靠"提交 vs 不提交"的二元信号验证 bracketed paste 是否生效（提交 → Claude 重打印 login URL；不提交 → 只显示 asterisks 原地不动）。
- Claude auth 存 macOS **login keychain** 的 `Claude Code-credentials` 服务，per-user 不 per-HOME。沙箱里 `claude` 能共享 auth。但 `~/.claude/settings.json` per-HOME，要完整配置需要 cp。

## shadcn 设计语言

- **只用三种圆角**：`rounded-md`（控件：按钮/输入/小交互）/ `rounded-xl`（卡片/面板/对话框）/ `rounded-full`（badge/pill/avatar）。`rounded-lg / 2xl / 3xl / sm / xs` 是漂移，grep 审计：`rounded-(lg|2xl|3xl|sm|xs)` 非 `ui/` 目录内的都应归类到三轨之一。例外：chat 气泡 `rounded-2xl`（UX 约定）、`ui/` primitives 里的 `rounded-sm` 菜单项（shadcn 约定保留）。
- **只用两种阴影**：`shadow-sm` 卡片默认 / `shadow-xs` outline 按钮。`shadow-md/lg/xl/2xl` 和 `hover:shadow-*` 跃变都是 shadcn 反模式，用 border 做反馈不用 shadow。唯一例外：`ui/dialog.tsx` 的 `shadow-lg`（shadcn 官方做法，对话框需要 elevation）。
- **无硬编码中性色**：`text-gray-*` / `bg-gray-*` / `border-zinc-*` / `ring-blue-*` / `text-blue-500` 链接色都是漂移，替换为 token：`text-muted-foreground` / `bg-muted` / `border` / `ring-ring` / `text-primary underline-offset-4`。
- **激活态是 `bg-accent font-medium`**（或侧边栏 `data-[active=true]:bg-sidebar-accent`），不是色条 / 不是颜色字 / 不是填充蓝 pill。grep 审计：`bg-blue-500/10`、`text-blue-400`、`border-l-2 border-primary` 这类激活表达都是漂移。
- **CardTitle 不锁尺寸**：shadcn new-york-v4 的 CardTitle 是 `font-semibold leading-none`，**不带 `text-2xl tracking-tight`**。让尺寸继承父级以便 LoginPage（`text-2xl`）和 ProjectCard（`text-base`）各自合适。
- **页面 h1 走 `text-2xl font-bold tracking-tight`**——shadcn dashboard block 标准。
- **图标尺寸**：Lucide only，控件内 `size-4` (16px)，badge 内 `size-3` (12px)。多个库混用 / 20px+ 图标在 inline 控件里都是漂移。
- **焦点环**：`ring-[3px] ring-ring/50`，不是 2px 实色 outline。
- **应用层卡片和 `card-active-glow` 包裹 div 的圆角必须匹配**（`rounded-xl`），否则 glow 边缘角露出。

## 动效

- 页面级 Framer Motion **其实不是 shadcn 倡导的**——shadcn 只在 Radix 原语 `data-[state=*]` 挂 `animate-in/out fade-in-0 zoom-in-95 duration-200` 让 CSS 做动画。能用 CSS 做的不用 JS。适用于：添加 motion.div 前先想想能否走 data-state。
- 动效 duration **必须走 token**，不要 0.25 / 0.4 等 ad-hoc 值。`frontend/src/lib/motion.ts` 提供 `MOTION.fast (150ms) / default (200ms) / slow (300ms) / glacial (500ms)`。Framer：`transition={MOTION.default}` 或 `{{ ...MOTION.default, delay: X }}`。Tailwind：`duration-150 / 200 / 300 / 500`。
- **进场用 `easeOut`，变形/来回动用 `easeInOut`，不用 `easeIn`**（进场 easeIn 开头慢显得 sluggish）。color 变化不用 `easeInOut`（老 GPU banding），改 `easeOut`。
- **loading 态用 Skeleton 不用转圈**（列表/卡片场景）。Skeleton 的 shape-match 让内容进来感觉即时；`Loader2 animate-spin` 限 button 内 / 短任务。

## Node / 子进程兜底

- `spawn()` 可能**同步抛出**（ENOENT binary path、argv 超长等）。Promise executor 里 spawn 不包 try/catch 会让外层 await 挂死 inFlight 泄漏 + logStream fd 泄漏。修法：`let child: ChildProcess; try { child = spawn(...) } catch (err) { cleanup; resolve(err-result); return; }`。适用于：写任何 `new Promise((resolve) => { const child = spawn(...); ... })` 时。
- child process `on('error')` + `on('close')` 可能**双触发**（error 常先 close 后）。依赖这两个 handler 做资源清理（`logStream.end()` / `activeChildren.delete()`）必须加 `finished: boolean` 守卫或 `finish(result)` 集中 helper，否则 `WriteStream.end()` 双调会 warn spam。适用于：用 child + stream 组合时。
- `finally` 里清 flag 的 Promise 在 `res.json(flag)` 前执行——读 flag 永远是清后的值。解法：for-loop 里用 `let latched = false` 锁值，finally 前置。适用于：`POST /all` 这种 batch 处理 + 共享 flag 的场景。

## 前端 / WS 补充

- Playwright `page.on('websocket').on('framesent', payload => ...)` 的 payload 是 **str**（binary 是 bytes），**不是 dict**。写 handler 注意 `if isinstance(payload, str)` 不要 `payload.get(...)`。
- Dashboard WS 广播 payload 含用户敏感内容（如文件绝对路径）时**必须 per-user 过滤**。`dashboardClients: Set<WebSocket>` 全局无 tag → 任何连接收任何用户事件。解法：auth handler 时 `(ws as any).__username = user.username`（localhost 模式用 admin username），bridge 里 `client.__username === evt.username` 再 send。project WS 天生 per-project 不用额外过滤。

## 已归档

（无）

END 历史教训
