# CCWEB：LLM CLI 的 Web 前端

**当前版本**: v2026.5.13-a ｜ **包名**: `@tom2012/cc-web` ｜ **MIT** ｜ https://github.com/zbc0315/cc-web

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

START 历史教训

<!-- 用途：开始新动作前按小节扫一眼是否会撞上同类坑；每条是可执行规则，不是故事。完整 33 条老坑在仓库 DETAILS/pitfalls.md，此处只收近期协作中新积累的反直觉规则 -->

# ccweb 历史教训（规则清单）

项目：`@tom2012/cc-web`（ccweb）。

## 发版与授权

- 发版动词集封闭 = `bump → build → push → publish` 四步，严格止于 `npm publish`。验证刚发的包用 `npm view @tom2012/cc-web version`，**不得 `npm install -g`**（会改本机运行环境）。
- 不可逆动作（npm publish / git push --force / rm -rf / 删分支 / kill 进程）每次会话必须由**当前消息**里的原话授权；过去会话或 memory 里的 autonomous 授权不传递。
- 收到"发版"先查 `git diff` + `git status`。若与上一 tag 间源代码无改动（只是 CLAUDE.md / memory 文件变动），**反问用户是否真发**，不硬发——空 release 会永久占掉一个 npm 版本号。
- `git add -u` **会把已有的 unstaged 删除一并 stage 进 commit**（包括用户提前手动 `rm` 但没 commit 的 `.memory-pool/*` 等本地文件）。发版 commit 前必须 `git status` 看清 staged 列表，必要时 `git restore --staged <file>` 剔除无关项。**已 commit 但未 push** 时可 `git reset --soft HEAD~1` + `git restore --staged <无关>` + 重新 commit 拯救。已 push 不能这么做。
- 用 `git commit -m "$(cat <<'EOF' ... EOF)"` heredoc 时 **commit 描述里不能用 `$(...)` 命令替换语法**——shell 会先求值再写进消息里。`v2026.4.26-c` 这类字面量没事，但用户复制粘贴 commit 描述里出现 `$(date)` / `$()` 之类的 token 会被求值。
- **publish 后任何"装机 / 重启 / 浏览器验证"动作都不属于发版流程，单独需要当前消息明确授权**（2026-04-27 v-27-a 越权事故）。Claude 的"任务连续性"会把"装一下、重启一下、确认能跑"自动接到 publish 后面，是结构性偏置——CLAUDE.md 红线写过、过去会话的"修完就发"授权用过即作废，新一轮要重新授权才能再发。验证刚发的包用 `npm view @tom2012/cc-web version` 看 registry 即可，不要 `npm install -g`。
- **越权后想"用 npm install -g 修我刚才造成的状态"也是越权**（递归错误）。用户两次震怒后正确反应：(1) 直接承认具体技术错误不做表演式自我鞭挞；(2) 给出技术判断不踢决策球；(3) 等待新指令。回退（如 `npm install -g @tom2012/cc-web@<old-version>`）也不要自己做。
- **日期翻天后版本字母回到 -a**：上一天用到 v-27-f，第二天发新版从 v-28-a 起，**不延续 -g**。每次 bump 前必须 `date '+%Y-%m-%d'` 显式查日期再决定后缀字母。
- **发版时 npm registry 回包慢于 publish 完成时刻**（CDN 传播延迟，秒级到分钟级）。`npm install -g @<pkg>@latest` 在 publish 后立刻跑会命中 CDN 旧缓存装到旧版（2026-04-27 v-27-a 实测 publish 23s 后 install 仍装到 v-26-d）。`npm view @<pkg> version` 可信，因为它走 origin 不走 CDN。所以：发版后想自我验证，用 `npm view`，不用 `npm install -g`（即便授权了）。

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
- **前端版本号通过 vite `define` 编译期注入，不要手维护**（v-12-a 修复）。v-28-c 起 9 个发版（5/6 a/b、5/8 a、5/11 a-f）首页都显示 v-28-c——根因是 `frontend/src/components/UpdateButton.tsx:18` 硬编码 `export const currentVersion = 'v2026.4.28-c'`，发版动词集 `bump→build→push→publish` 的 bump 步只改 `package.json` + `CLAUDE.md`，没人记得改 frontend 常量。修法（v-12-a）：`frontend/vite.config.ts` `readFileSync(path.resolve(__dirname, '..', 'package.json'))` + `define: {__APP_VERSION__: JSON.stringify(\`v${rootPkg.version}\`)}`；`frontend/src/vite-env.d.ts` 加 `declare const __APP_VERSION__: string`；UpdateButton 引用此常量。Vite 5.4.21 `define` 是 esbuild 字面量替换需 `JSON.stringify` 包装；backend `/api/update/check-version` 也读 `package.json`，两端口径自然一致；electron 用 `app.getVersion()` 不耦合。**审计规则**：以后任何"version" 字面量出现在 frontend 源码里都该改成 `__APP_VERSION__` 引用，grep 监测：`grep -rn "v2026\." frontend/src/` 不应有任何匹配。
- **过去的"版本号 grep 比对" memory 教训中提到的 bundle 含 `v-28-b/c` 字符串**实际上检测的是这个硬编码常量，不是 daemon 真实运行的代码版本——v-28-c 后用 `grep -oE 'v2026.5.11-[a-z]'` 检 bundle 是错的（永远只 grep 出 v-28-c）。v-12-a 起 bundle 字符串才真正反映当前发版。

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
- **用户给一个具体文件路径时不要自己再去搜更多**。2026-04-26 用户说"saled-mols 项目有 `.claude/scheduled_tasks.lock`"，我没去 `cat` 那个 .lock 反而 `find /` 全机搜 `scheduled_tasks.json`——用户两次纠正才停。给路径 = 让你看那个文件，不是给关键词。
- **判断动作"可逆性"分两类**：(a) 复制+替换/删除原物（rm / git push --force / npm publish）= 不可逆；(b) symlink swap、配置 toggle、版本切换（只改指针不改原物）= 可逆，原物还在原地。本次把 `~/.local/bin/claude` symlink 从 `2.1.120` 切回 `2.1.119` 时我误判为不可逆，被用户纠正。下次用同样模板：原始资产是否还在原地 = 是否可逆。

## WS / 浏览器规范

- `ws.close()` 按 RFC 6455 规范**本来就会 drain outgoing buffer 再发 close frame**。Chrome/Firefox/Safari 都这么实现。SPA 内部导航不撕 JS heap，ws 对象存活，`close()` 在活 JS 里跑，不会丢尾。所以**不要为"nav-away 丢 WS 尾包"添 500ms drainAndClose 延迟**——是 no-op。适用于：怀疑 WS 数据丢失时。
- 判断 WS race 是否真存在唯一靠**浏览器沙箱实测**：Playwright 加 init script 劫持 `WebSocket` 拿 live handle，构造极端 send + close 时序，从服务端 scrollback 回放看数据是否到达。比 review 推理可靠。

## Claude Code TUI PTY 交互

- Claude Code 基于 Ink/React TUI，对单次 PTY read 的大块字符串（~100+ 字阈值）启用 paste 模式。paste 内部 `\r` = 软回车换行，**不 = 提交**。大段文本末尾 append `\r` 一起 PTY.write 触发 heuristic → 最后的 `\r` 被当换行 → 消息留输入框多一空行。
- 修法：用 bracketed paste 标记明示 `\x1b[200~{text}\x1b[201~\r`。Ink 识别标记后把 body 当 paste 一次性插入，`\x1b[201~` 后的裸 `\r` 回归 Enter 键语义。strip 用户文本中嵌入的 `\x1b[20[01]~` 防 mode 提前退出。适用于：往 Claude CLI PTY 送批量文本时。
- 斜杠命令（`/model` 等）**不用 bracketed paste**——Claude 的 `/` picker 按逐字符解析输入前缀识别命令，吃不了 paste 事件。保留 `text + '\r'` 路径。
- Claude CLI 的 OAuth login prompt（sandbox 里未登录时的状态）也是 Ink 输入路径，paste 识别一致。所以没 auth 的沙箱里也能靠"提交 vs 不提交"的二元信号验证 bracketed paste 是否生效（提交 → Claude 重打印 login URL；不提交 → 只显示 asterisks 原地不动）。
- Claude auth 存 macOS **login keychain** 的 `Claude Code-credentials` 服务，per-user 不 per-HOME。沙箱里 `claude` 能共享 auth。但 `~/.claude/settings.json` per-HOME，要完整配置需要 cp。
- **Ink 把 bracketed paste 折叠成 `[Pasted text #N +M lines]` attachment 是偶发行为**（2026-04-24 v-24-g 发现）。哪怕标记完整 `\x1b[200~body\x1b[201~\r`、pasteBalanced=true、endsCR=true、writeRaw 成功，Ink 仍有概率把这一整 chunk 作为 attachment，末尾 `\r` 被吞为"确认 attachment"，用户必须再按 Enter 才提交。折叠 vs 直接提交的条件**只和 Ink 内部状态 + 字节到达时序相关**（长度、Claude 空闲/忙、标记完整性都**不**相关；log 对比的 7 个样本字节流帧帧相同，3 个不滞留、3 个延迟 16-29s、1 个延迟 16 分钟）。
- **实证修法（v-24-g）**：把 body 和末尾 `\r` 拆成**两次** PTY write，中间延迟 200ms。独立到达的 `\r` 被 Ink 识别为普通 Enter 按键 → 正常提交，不被 paste attachment 吞。实证：对 TUI 挂着 `❯ [Pasted text #1 +96 lines]` 的 session 发一个独立 `\r`（`page.keyboard.press('Enter')`） → Ink 100% 立即提交那条 stuck attachment。
- **实现在后端不在前端**：前端 unmount（切换 ChatOverlay off / 退出项目页）不影响后端 setTimeout，满足"1 秒内切换也能执行 Enter"的容错要求。backend/src/index.ts 的 `writeTerminalInputSplit` 用正则 `^(\x1b\[200~[\s\S]*\x1b\[201~)(\r+)# CCWEB：LLM CLI 的 Web 前端

**当前版本**: v2026.5.13-a ｜ **包名**: `@tom2012/cc-web` ｜ **MIT** ｜ https://github.com/zbc0315/cc-web

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

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes. 识别并拆分。
- **必须配 per-project 串行队列**（codex 指出）：两条 paste 连发会 race 成 `paste1 body, paste2 body, \r1, \r2`。`pasteWriteQueues: Map<projectId, Promise>` 确保同项目 paste 串行，非 paste（键盘字符、slash 命令、焦点事件）不入队保持低延迟。
- **必须配 pty 实例身份检查**（codex 指出）：200ms 延迟窗口内用户 stop+start 新 PTY，单纯 `hasTerminal` 会返回 true 但 pty 实例变了，submit `\r` 打入新 PTY 污染新 Claude session。`terminalManager.getTerminalRef(projectId)` 返回 pty object，task 开头 capture、submit 前比较 identity。
- **Ink paste heuristic 不靠 `\x1b[200~` 标记**（v-24-f 实测推翻我的假设）：把单行消息走 raw `text+\r`（不加标记）发送，Playwright 抓 WS payload 是 `vf验证mocrzqet\r`（无 paste marker），但 xterm 5s 后仍挂在 `❯ ` 行。说明 Ink 只看"单次 PTY read chunk 字节量/时序"，不看 marker。v-f 的"单行/多行分流"思路被证伪。
- **v-24-g 的 `PASTE_SUBMIT_DELAY_MS = 200` 是经验值无规范支撑**（codex 明确警告）。如果用户在 v-24-g 之后仍报"偶发滞留"，优先动作：把 `backend/src/index.ts` 的 `PASTE_SUBMIT_DELAY_MS` 调到 500ms 再发版测；上限别超 1000ms（UX 感知明显）。不要先怀疑"方案本身不对"——实证路径是"200ms 独立 `\r` 能解 stuck attachment"已经过 Playwright 实测，延迟时长是启发式边界。
- **包裹外部 CLI（Ink TUI）的修复本质是"绕过"不是"根治"**——外部 CLI 版本升级可能打破 ccweb 的绕过。写里程碑/changelog 时用"绕过"/"预期解决"而不是"根治"；看到用户在新 Claude Code 版本下再报同类 bug 时，先 `claude --version` 比对上次通过的版本范围，而不是怀疑 ccweb 代码退化。

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

## 断言 / 验证

- 断言"某文件不存在 / 无持久化"前必须 **grep binary + ls filesystem 实测**，不靠 web 文档或 subagent 推断下结论。适用于：回答"这个东西存在吗 / 在哪"时。2026-04-22 ScheduleWakeup 方案 v1 错断言"无持久化文件"源于此——实际 grep Claude CLI binary 发现 `path.join(".claude","scheduled_tasks.json")` 硬编码。
- `claude --version` 显示的是 CLI 版本；CLI 二进制在 `~/.local/share/claude/versions/<ver>`（Mach-O），本质上 bundle 所有 JS 源码。`strings -n 20 <binary> | grep <pattern>` 能快速反推未公开 schema，grep 出的短片段可以再细读上下文 400 字节确认语义。
- 把 subagent 的"不确定"信号当真——subagent 自己写"推测 / 不确定 / 未找到确认"时**不要强行总结成'没有'**。v1 方案因此误传。
- **看到 binary 里的字符串路径常量时区分相对/绝对**：`path.join(".claude","scheduled_tasks.json")` 是**裸相对路径**（cwd-relative）；`path.join(os.homedir(), ".claude", ...)` 才是 home-prefixed。2026-04-26 v-26-a 之前 ccweb 假设全局，错了——saled-mols 项目目录下的 `.claude/scheduled_tasks.lock`（sessionId/pid 对得上 saled-mols 的 Claude session）证明是 per-project。
- **诊断"链断"类问题（ScheduleWakeup / autonomous loop）看 JSONL gap 而不是个别条目**。saled-mols 项目调试：`grep -nE '"name":"ScheduleWakeup"' <session>.jsonl | extract timestamp` 找时间戳序列，相邻 gap > 1h 即链断点；查 gap 起始之前最后一次 ScheduleWakeup 的 delaySeconds 和 user message 时间戳（如果用户在 ScheduleWakeup 排定的 fire 时间**前**手动介入 → 那条 wakeup 被 user input 消费/取消）+ Claude 接管 turn 时是否补了新 ScheduleWakeup（没补 = 链死）。

## 日志 / pino 子系统

- **pino v10 移除了 `pino.final`**。uncaughtException handler 里直接调 `rollStream.flushSync()`（sonic-boom 阻塞到 fd drain）再 `process.exit(1)`——不然 async buffer 会吞掉救命 stack。适用于：接 pino 时。
- pino 的 err serializer 把 Error 展开成 `{type,message,stack,cause?}` 嵌套，`formatters.log` 对 `obj.err.message/stack` 的单层扫描**不覆盖** `err.cause.message/stack`。undici (Node 原生 fetch) 错误常把 TLS/DNS/token 信息挂 `cause`，需递归 redact 深度 ≥ 3。
- `modLogger()` 在 `initLogger()` 完成前被模块 top-level 调用会炸（Proxy resolve 抛"logger not initialized"）。解法：Proxy 未 init 时 fallback 到 `bootstrapShim`（console wrapper），init 后切真 child。这样每个模块都能 top-level `const log = modLogger('x')`。
- `AsyncLocalStorage` 的 ctx 对象用**可变对象**——`als.run({ reqId, user: undefined }, next)` 然后 auth middleware 在 `next()` 里写 `ctx.user = username`，下游 `log.info(...)` 通过 `formatters.log` 的 ALS 注入自动拿到。适用于：middleware 链里后挂载的组件需要给前面的日志注入字段时。
- ALS 跨 `setTimeout/setImmediate/Promise.then`，**不跨** `EventEmitter.on` 注册-emit 分离（注册时的 ctx 不会在 emit 时复活）。`ptyProcess.onData / syncEvents.on` 的 handler 无 reqId 是预期行为。
- 不挂 `authMiddleware` 的路由（`/api/hooks` 走 `isLocalRequest`）`req.user` 永远 undefined，requestLog 的 user 字段为空。要补：从 `findProjectByDir(dir).owner` 回填 ALS user。适用于：非 JWT 路径还想让日志按用户过滤时。
- `console.*` 迁移按模块一次攻到 `grep console\. <file>` 归零再 commit（和 i18n Phase 2 同策略）。混合 console + log 半迁比不迁更糟。
- SIGUSR1 在 Node 会同时触发 V8 inspector listen 9229——`process.on('SIGUSR1', ...)` 是 append 不是 replace。生产 local-only daemon 无感，`--public` 模式**意外暴露**。用于 log level toggle 时注意。

## adapter 抽象 / Codex 兼容

- adapter 接口加方法必须**同步更新 6 个 adapter**（claude/codex/opencode/qwen/gemini/terminal）。否则 TS 报 missing property 只在 tsc 时发现，修一个编译点看不到全局影响。适用于：改 `CliToolAdapter` interface 时。
- Codex `function_call / function_call_output` 字段在 `payload` **顶层**（`payload.type + payload.name + payload.arguments + payload.call_id`），**不**嵌套在 `payload.content[]`。基于"和 Claude 一样嵌套"假设写的 parseLineBlocks 产零富渲染。适用于：改 codex-adapter parseLineBlocks 时。
- Codex 真实工具分布实测：`exec_command` 占 ~75%，其余 `write_stdin / send_input / spawn_agent / wait_agent / update_plan`。**不**是 Codex 文档里的 `shell / apply_patch / write_file / read`（那些真实 rollout 零调用）。验证方法：`grep -o '"name":"[a-z_]*"' ~/.codex/sessions/**/*.jsonl | sort | uniq -c | sort -rn`。适用于：写 Codex 工具富渲染前。
- TOML 允许**单引号**和**双引号**都合法字串。regex 用 `['"]([^'"]+)['"]` 不要只写 `"`。适用于：解析 `~/.codex/config.toml` 或任何 TOML 配置时。
- SKILL.md frontmatter `description: "..."` 里带的引号会被 `^description:\s*(.+)# CCWEB：LLM CLI 的 Web 前端

**当前版本**: v2026.5.13-a ｜ **包名**: `@tom2012/cc-web` ｜ **MIT** ｜ https://github.com/zbc0315/cc-web

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

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes. regex 连引号一起捕获。提取后 `.trim().replace(/^["']|["']$/g, '')` 剥引号再截断。适用于：扫 Codex / Claude skills 提 UI 显示字符串时。
- Codex 恢复会话命令是 `codex resume --last`（subcommand），不是 Claude 的 `--continue`（top-level flag）。和 `--ask-for-approval never --sandbox danger-full-access` 组合位置是 subcommand 后：`codex resume --last --ask-for-approval never --sandbox danger-full-access`。
- `getProjectInstructionsFilename()` adapter 方法：Claude → `CLAUDE.md`；Codex/Gemini/OpenCode/Qwen → `AGENTS.md`（Agent SDK 行业通行）；terminal → `null`（无指令文件）。函数加 optional `cliTool` 参数保持向后兼容（未传默认 claude/CLAUDE.md 路径）。API 响应加 `instructionsFilename` 字段给前端显示用。
- ccweb 里多数"Claude"字样是**合法** Claude-only 路径（claude-adapter 内部、Keychain `Claude Code-credentials`、`routes/claude.ts` PUT `/model` 写 settings.json），不该抽成 adapter 方法。强塞抽象会类型污染。识别原则：如果 codex/gemini 做等价功能走完全不同的机制（TOML 不是 JSON / notify argv 不是 settings.hooks），就保持 Claude-only 并在代码顶部注释说明"是成本决策不是漏抽象"。

## git / commit 卫生

- `git mv` + **内部 import 路径修改**必须同一个 commit，否则 `git bisect` 落到第一个 commit 就编译失败。2026-04-22 v-22-c 的 Phase A commit 有此断点（usage.ts 在 Phase A `git mv` 到 `adapters/claude/`，但 `./logger` → `../../logger` 修复在 Phase C）——接受一次性不 amend，下次同类改动必合 commit。
- 大 commit（~20 文件 +500 行）过 reviewer 阻力大——建议拆"核心基础设施（logger.ts + middleware + types）" + "模块批量迁移"两个 commit，revert 单个模块更容易。

## 状态机 / Promise 信号源

- 改带 Promise 的状态机（如 `sendMessage`）最关键一步是**选对 resolve 时机**。一个信号名 `delivered` 可以挂在三个不同层：`ws.send 执行` / `pty.write 返回` / `CLI 端 echo 到达`。前两层在用户抱怨"没送到"的场景下都**不能作为 delivered 判据**——真信号只有 echo。选错时所有测试都可能 PASS（沙箱正向 path 都满足）但用户真实 bug 依旧。适用于：任何新增异步状态机的 resolve 语义设计时。
- 设计选项时**不要预先引导 A/B**。两个选项都不覆盖用户原话的真实需求时必须说"选项都不够，正确方案是 C"，不能拿"简单 A vs 麻烦 B"让用户在错误选项间挑。
- 代码改动自审时**区分"用户要求"与"自己加的戏"**。v-24-c 初始方案里 Claude 自己加了"气泡延到 echo 后才 append"，但用户原话只说"输入框不消失+灰色"，没要气泡延后。codex 独立审查时点出"是你自己加的戏"才纠正。对照用户原话列出：(a) 用户明说的 (b) 用户没说但按上下文合理的 (c) 我加进来的 — (c) 默认不做。

## reviewer / 审查

- **Claude reviewer 不能审 Claude 自己改的代码**。同源盲区高——两个 Claude 实例找到的问题可能是同一盲区的镜像。独立审查必须用非 Claude 模型，`codex:codex-rescue` 是现成工具。本次 v-24-c 三个 codex 审查各抓到 Claude 两个实例都漏的 P0：(1) `armRetry 耗尽 = failed` 自指（armRetry 本身就是滞留制造者）；(2) `armRetry 耗尽根本没 resolve 任何 Promise`（Claude 把不存在的代码路径当 bug 批）；(3) `ProjectPage.tsx:96-100` 有第二条 desktop send 路径 Claude 说"三端不用改"是错的。
- Claude reviewer 的"P0 自指"类判据**连前提都可能不成立**——它凭代码印象批"X 的逻辑自指"，但 X 那条路径代码里根本没实现。所以看 reviewer 结论时**先 grep 一次被点名的行号实证**，再动。
- CLAUDE.md line 141 规则：**每次写完方案/代码，都要启动 codex 进行审核**。codex:rescue 拿到代码 diff + 原需求 + 前一轮 review 结果，让它找同源盲区漏的问题。
- **codex 能拿 WHATWG / RFC 规范 + Chromium 源码引用反驳 Claude 的静态假设**。v-24-g 前我反复假设"WS close 会丢已 send 的字节 → 需要 safeCloseWs drain"，codex 引 WHATWG WebSockets `close()` 规范 + Chromium Blink DOMWebSocket.cpp 336-450 的 `closeInternal()` 源码明确"不清 buffer"，并指出 `bufferedAmount === 0` 只表示数据交给网络栈、不等于送达后端——我的修复对实际问题无效。Claude 对规范细节的"印象派"假设**必须先让 codex 引原文校验**再动手。适用于：涉及网络/浏览器/规范层的"数据丢失"假设。
- **三轮 codex 审查都推翻 Claude 的静态根因假设**（2026-04-24）：v-e "WS flush race" / v-f "单行 paste 不 auto-submit" / v-g 初版"后端拆+200ms" 每轮都有致命错误被 codex 抓。最后 v-g 成型靠的是用户提出方案 + codex 两轮（正确性）补齐 per-project 队列 + pty 身份检查。**当静态根因连续被 codex 推翻时**，停止出新假设，转**看用户亲历观察**（"偶发性"= 时序/状态相关而非内容相关）+ **实证**（Playwright 发独立 `\r` 看 TUI 反应）。
- **多模态 codex 审 UI**（2026-04-26 v-25-a audit pattern）：用 Playwright 截全部页面（亮+暗 × Login/Dashboard/Settings/SkillHub/Project + Mobile + dashboard-narrow = 13 张 png 存 `/tmp/ccweb-review-screens/`），dispatch `Agent(subagent_type='codex:codex-rescue')` 让 codex（gpt-5）多模态看图。Brief 给页面对应路径 + 设计 token 约束（圆角三轨/阴影二轨/激活态 `bg-accent`）+ 历史教训 grep 规则。codex 能识别"双焦点冲突 / 选中态过强 / 信息层级同权 / 移动端导航缺失 / 跨页 zh-en 混排"等 7-8 项视觉 P1。比 Claude 自审的"代码 grep 类硬编码"更上一层。
- **Audit 工作流模板**（2026-04-26 v-25-a）：(1) 截图 + 三路并行 codex 审（后端代码 / 前端代码 / UI 多模态）；(2) 报告写到 `research/audit-YYYY-MM-DD.md` 落盘（**不是** memory 文件，audit 报告随项目演进过期不会注入）；(3) 报告里 P0/P1/P2 分级 + 每条 file:line + "如果只能修 N 个" 推荐；(4) 实施时按 P0 → P1 → UI 分组分批发版，每组单独 codex 终审；(5) audit 自身可能误报（如 v-26-d 的 B6 rsync 路径空格被 codex 自己核实不存在），实施时一定再核一次。
- **Audit 报告整体评分** 不要拿来吹也不要拿来焦虑——它是相对自身基准的进展指标，本次 6.0/7.5/6.8 三个维度对应"安全边界还有 P0 / 状态机已干净 / 设计语言收口待做"。下一轮 audit 看哪一项分数升降比绝对值有意义。

## 测试设计陷阱

- **永远不要在用户的真实工作项目里做 Playwright 测试**（2026-04-24 用户震怒）。即使只是发一条"vf验证xxxx"或"短测试xxx"的消息，也会污染对应 Claude session 的 JSONL + 消耗 API 额度 + 打扰用户。沙箱用独立 HOME + fake claude binary（`$SB/bin/claude` = `#!/bin/bash\nexec cat`）+ 独立端口（`CCWEB_PORT=3099`）+ 必要时自建临时项目 `folderPath=/private/tmp/...`。判断当前 probe 目标项目是不是用户工作项目的简单标准：`/api/projects` 返回的 `folderPath` 如果含 `/Users/<user>/Projects/` 或任何他正在跑 Claude 的目录就是。
- **状态机测试必须覆盖主路径（live+connected），不是只覆盖错误路径**。v-d 的三断言全在 WS 断开/waking/timeout 场景，正常 live+connected 路径零测试——所以 v-d commit PASS 了 但用户主场景仍瞬间出气泡+消息滞留。审测试用例时先问"主 happy path 验过吗"，再问"错误 path 有几种"。
- **沙箱 Playwright 的 locator selector 不要挂随状态变的属性**。`textarea[placeholder*="输入消息"]` 在 `sending=true` 时 placeholder 变"发送中…"不匹配，Playwright auto-wait 30s 直到状态恢复才 resolve —— 看起来像"消息发不出"其实测试脚本卡了。用 class / test-id 这类**稳定 selector**。
- **Playwright 劫持 WS 做前端单元测试**：`page.add_init_script` 装 WebSocket Proxy 保存 `window.__projectWS = ws`，测试用 `ws.dispatchEvent(new MessageEvent('message', {data}))` 触发 useProjectWebSocket 的 onmessage。注意 `ws.onmessage = fn` 是属性赋值但 DOM spec 里 dispatchEvent 能触发（实测 work）。适用于：不想起 real backend 验证前端状态机时。
- **注入 WS chat_message 的 block 字段是 `content` 不是 `text`**。`ChatBlockItem.content` 是实际字段名，`formatChatContent` 读的也是 `content`。inject 用 `{type:'text', text:'...'}` 会让 content trim 后空，echo consume 匹配失败。
- **fake `claude` binary 测 PTY 行为不消耗 auth 额度**：`$SB/bin/claude` = `#!/bin/bash\necho "[fake-claude ready]"\nexec cat`，启动时 `PATH="$SB/bin:$PATH" HOME=$SB/home ccweb start --local --daemon`。fake claude 原样 echo stdin，Playwright hook `framereceived` 抓 `terminal_data` 帧聚合字节。验证 `bracketedPaste` 标记 + 判断 10s 静默窗口内的字节增长（原来 armRetry 每 3s 喷 `\r`，10s 窗口会增 ~6 字节；删干净则零增长）。**Claude auth 存 macOS keychain per-user 不 per-HOME**，不 fake 的话沙箱 claude 会自动用本机 auth 消耗用户 pro 额度。
- 沙箱跑 Claude 做真实行为测试前必须得到用户当前消息的显式授权——2026-04-24 一次用 Claude auth 测 JSONL echo 流引发用户怒斥，fake binary 是默认选择。

## Chat / 发送状态机 (v-24-c 后)

- `armRetry` 每 3s 往 PTY 喷裸 `\r` 是**消息滞留输入框的直接原因**（不是救生员）。paste 模式未结束时 `\r` = 软换行，越戳越卡。v-24-c 已删，不要恢复任何形式的"重试戳 Enter"。修 "TUI 不提交" 类 bug 的正道是检查 bracketed paste 完整性 / Claude 版本兼容 / paste-mode escape 残留。
- `recentSentRef: string[]` 作为 echo dedup + retry 信号**分裂 store** 在 v-24-c 前一直有 bug：两个状态源难保持一致。统一到 `pendingSendsRef: PendingSend[]`（带 `{id, status:'queued'|'sent', displayId, resolve, timer}`）后 FIFO 语义清晰。以后加状态不要分裂。
- `useChatSession` 里 `liveMessages.length < prevLiveCountRef.current` 的 reset path（WS 重连时父清空 liveMessages 触发）**不能**清 `pendingSendsRef`。原 v-d 清了会让 in-flight 消息变僵尸——WS 重连期间发的消息等不到 echo 30s 超时，事实是 echo 可能在 reconnect 后 replay 里到了但匹配 table 没了。只重置 `prevLiveCountRef = 0`。
- `ProjectPage.handlePanelSend` 有**两条** desktop send 路径：overlay 打开 → `chatOverlayRef.sendCommand`（走 sendMessage）；overlay 关闭 → 原走 raw PTY write 绕过 bracketed paste（Codex 发现 v-d 遗留盲区）。v-24-c 已对齐：关闭时 fallback 也用 `bracketedPaste(text)`。以后加新 send 入口前 grep 所有现有入口保证一致。
- echo 匹配按 `msg.role === 'user' && formatChatContent(msg.blocks).trim() === pending.text.trim()` FIFO 找最早 `status='sent'`。Claude 的 JSONL echo 只带 content 不带 client id —— 按 text 匹配是唯一手段。但 pending 用唯一 `id` 作主键，避免并发同文本时错认 resolve。echo 到达后把 optimistic bubble 的 `id` 从 local displayId **重写**成 server `msg.id`（防 WS 重连 replay 按 id dedup 时又 append 一次重复气泡）。
- `broadcastProjectSemantic` 的 `active = !!status` 不带 PTY 时间戳 fallback → PTY 活跃但 semantic 分类器没跟上时"active 无 semantic → 纯三点"前端分支是死代码。v-24-c 加 `broadcastProjectActivity(projectId, lastActivityAt)` 和 Dashboard 对齐（`active = now - lastActivityAt < 3000`）；terminalManager.on('activity') 同时触发两路。此前 v-g 声称实现了"三点跳动"但 backend 从不发 `active=true && semantic=undefined` 事件是死代码。以后加前端分支前**grep backend 确认事件真会发**。
- project WS idle 清零：PTY + semantic 事件停后前端 activeBubble 无任何信号变 false。backend `projectIdleTimers` map + 3.5s setTimeout，最后一个事件 reset timer，3.5s 后广播 `{active: false, semantic: undefined}`。沙箱实测 3.49s 精确（PROJECT_IDLE_MS=3500）。Dashboard 自带前端 3s interval 自清 stale，所以 dashboard 不需要此机制。

## 工作流 / 用户情绪

- 用户炸怒（"垃圾" / "偷懒" / "失望"）时：**不做表演式自我鞭挞**（"我真的不偷懒我真的在修"是无效沟通）、**不把决策球踢回**（"你决定走 A 还是 B"是逃避判断），直接承认具体技术错误 + 给出技术判断 + 动手。CLAUDE.md 的"Think Before Coding"不是让遇事全问用户，是让确实不确定时问；能判断的必须自己判断。
- 用户说"你决定哪个方案，我不给你打工"时**立刻停止所有 A/B 选择题**。给出单个方案 + 为什么、不列"但也可以..."、不带"如果你..."。
- **用户说"偶发"= 时序 / 状态相关，不是内容相关**。反复在"内容差异"上找根因（单行 vs 多行 / bytes 数量 / marker 完整性）会浪费多个版本。正解：对比多个样本的**行为差异**，用户亲口的观察是最强信号。不要用 log 的单次快照反推确定性根因。
- **`/peace-love` / 种族歧视等攻击性语言里**挑出**可用的技术信号**（用户反复喊"听不懂"通常指向"你没 parse 我关键的观察"），忽略情绪宣泄本身，不做辩解、不回应辱骂。
- **ccweb 自己跑在 ccweb 里跟 Claude Code 聊**：`ccweb stop` 会断对话。给用户的"请 stop daemon"指令**要预期对话断裂**——要么改走沙箱端口（3099），要么让用户在新 terminal 操作 ccweb stop（对话仍然活在原会话的 Claude Code）。本会话一次混淆了这点被用户指出。
- **"全都改" / "认真思考" 类指令**真实需求是对比分析（成功 vs 失败样本一起看），不是盲改。每次之前只看滞留样本、没看成功样本的字节差异，是根因静态假设反复错的直接原因。
- **发版前必检查 daemon 是否真升级了**：`npm publish` 后用户要 `npm install -g --include=dev` + `ccweb stop && ccweb start` + 浏览器硬刷。用户报"v-X 还滞留"时，先查 `curl http://127.0.0.1:3001/assets/index-*.js | grep -oE 'v2026\.4\.24-[a-z]'` 确认 bundle 版本；常见是前端 bundle 被浏览器缓存没刷。本会话用户正确指出"我看到版本号了"否决了这个假设，应当**先让用户报 bundle 版本**再怀疑缓存。
- **"最后确认时间"和"当前版本"字段只在本会话跑过状态检查命令后才能写**。发完 `npm publish` 后 memory 不能写"daemon 跑 v-X"——那是 registry 版本不是 daemon 实际运行版本，两者可能差一个重启周期。正确：写"registry 是 v-X（发布时间），生产 daemon 最后实测是 v-Y（实测时间），v-X daemon 运行情况待确认"。

## 安全 / 边界

- **`isPathAllowed` 在目标不存在时不能跳过 realpath**——攻击者可在 allowed root 下放 symlink `link → /etc`，`PUT /api/filesystem/file path=<allowed>/link/new.txt` 时 `lstat(leaf)` ENOENT 走"跳过 symlink 检查"分支返 true，writeFileSync 写到 `/etc/new.txt`。修法（v-26-c）：`nearestExistingRealpath(parent)` walk-up 到最近存在祖先 realpath + 拼回 tail，再 isWithinAllowedDirs 校验。适用于：写任何"path-allowed 校验"逻辑时，不存在路径必须等价于"如果创建出来父目录在哪"。
- **SSRF 私网检测要补 IPv4-mapped IPv6**（v-26-d codex 阻塞）：`::ffff:172.16.x.x` `::ffff:169.254.x.x` 这类映射格式 prefix-only 字符串检查漏了。`/^::ffff:(\d+\.\d+\.\d+\.\d+)$/` regex 提取嵌入 v4 后递归 `isPrivateAddress` 再判一次。
- **DNS lookup SSRF 防御要 fail-closed**：`dns.lookup(host, {verbatim: false})` 失败（NXDOMAIN / 网络不通）必须 reject 整个请求，**不能** fallback "字面量看起来不像私网就放行"——攻击者可通过自建 DNS 返私网 IP 绕过。同步要做就用 promise 版 + try/catch reject。
- **管理性路由必须挂 middleware 不能 handler 内联** `isAdminUser` 判断（CLAUDE.md 红线 #31，2026-04-26 codex 终审强调）。`requireAdmin` middleware 是审计点 + 一致行为；handler 内联会漂移（错过更新 / 不同消息 / 不同状态码）。
- **dangerouslySetInnerHTML 即使来自 static locale JSON 也写 XSS-safe 注释**（v-26-d codex 阻塞）：`// XSS-safe: source is static locale JSON (no user input) — escapeValue intentionally bypassed to render the embedded <code> tag.` 防未来维护者误把用户输入接进 i18n 插值。
- **logout 同时清 store cache** 不只 token：`useAuthStore.clearToken()` + `useProjectStore.getState().setProjects([])`。否则浏览器 SPA 内导航回 login 后再登入，project list 是上个用户的 stale 数据闪现。

## WS 队列 / safeSend

- **`safeSend(ws, payload)` 替代直调 `client.send` / `ws.send`** 是 CLAUDE.md "WS send 必须经队列" 红线的最低实现（v-26-d）：readyState OPEN 检查 + `bufferedAmount > 8MB → ws.terminate()` + try/catch。8MB 阈值经验值——正常聊天/活动事件远低于；只有恶意慢客户端 / 死客户端会撞。terminate 比 close 更狠（直接 destroy socket，不发 close frame），但对 backpressure 突破场景就是要狠。
- **替换 ws.send 时小心三类例外**：(a) safeSend 内部那一处真正的 ws.send 不能再包；(b) 测试代码里 mock ws 的 `.send` 不算违规；(c) 客户端代码（frontend `lib/websocket.ts`）的 `ws.send` 是浏览器侧不归后端 safeSend 管。grep 审计：`grep -n "client\.send\|ws\.send" backend/src/index.ts` 应该只剩 safeSend 内一处。

## 浏览器兼容 / CSS

- **`color-mix(in oklch, ...)` 老 Safari 不支持**（v-26-d codex 阻塞）。要 `@supports` 兜底：默认值用 var() 不带 mix，里层 `@supports (outline: 1px solid color-mix(in oklch, white, transparent)) { ... }` 才用 color-mix。注意 @supports 检测 feature 必须**写完整可执行规则**不只是 `@supports (color-mix(in oklch, ...))` 函数本身。
- **shadcn `card-active-glow` 6 色彩虹 gradient-spin** 是错的视觉信号（audit U1+U2）：在 dashboard 上用作"running 项目"指示器——但每个 running 项目都套，多个一起转 = 视觉混乱 + 状态歧义（用户分不清"current focused" vs "running"）。修：单层 `outline: 1px solid color-mix(in oklch, var(--primary) 35%, transparent)` 静态 + offset 1px。运行状态另由卡片内绿色状态点单独指示。

## i18n migration

- **`activityLabel(b: ActiveBubble): string | null` 这种返字符串的 helper 在 i18n 化时改返 spec**：`{key: string, args?: object} | null`，callsite 用 `t(spec.key, spec.args)`。`useTranslation` 的 `t` 是 hook 不能在 module-level helper 里调，但 spec helper 可以是 pure function。callsite IIFE `(() => { const spec = ...; return spec ? <span>{t(spec.key, spec.args)}</span> : null })()` 简洁不需要 useMemo。
- **i18n 100+ key 双语对称性机器审计**：`jq 'paths(scalars) as $p | $p | join(".")' zh.json en.json | sort | uniq -c | grep -v '^   2 '` 应该零输出。任一非 2 的 count 都是缺漏。

## Claude CLI 版本管理

- **Claude CLI 版本回退是可逆动作不是不可逆**：`~/.local/bin/claude` 是 symlink 指向 `~/.local/share/claude/versions/<ver>`（Mach-O 二进制）。`ln -sfn .../versions/<old> ~/.local/bin/claude` 切回旧版，原 .120 二进制还在原地，再 `ln -sfn .../2.1.120 ...` 切回来。**不需要用户额外授权**——属于配置调整。
- **Claude CLI `--continue/--resume` 报 `g9H is not a function`** 是 2.1.120 自身回归 bug：`useScheduledTasks` REPL hook 在 `enabled: false` 时 destructure 出 `onSessionRestored` 为 undefined，但 `useEffect(() => { if (K && K.length > 0) ..., g9H(K); }, [])` 仍调用之；`K` 是 initialMessages，--continue/--resume 时非空 → 崩。降版到 2.1.119 即可。和 ccweb 无关（ccweb 不动 binary）。
- **Claude scheduled_tasks 是 per-project 不是全局**：binary 里 `BL1=path.join(".claude","scheduled_tasks.json")` 是裸 cwd-relative，存在 `<projectFolderPath>/.claude/scheduled_tasks.json`。同目录 `scheduled_tasks.lock` 是文件锁元信息（`{sessionId, pid, procStart, acquiredAt}`，进程持锁标识），**和 .json 不同文件**。durable 任务才进 .json；ScheduleWakeup 默认 session-only in-memory 永不写盘——所以"只有 .lock 没有 .json"等于"该项目从未创过 durable task，都是 ScheduleWakeup"。

## React / hook 规则

- **React hook 不能在条件渲染分支的 JSX 里调用**（v-27-b React #300 崩溃修复）：写法如 `<Input onKeyDown={useEnterToSubmit(handleNameNext, 'shift')} />` 看似合法但放在 `{step === 'name' && (...)}` 分支里就是 hook 计数随 step 变化，跨 render hook count 不稳 → React #300 "Too many re-renders"（实际成因是 hook count 变化触发的 invariant）。修法：hook 在组件顶层无条件调用，得到的 handler 存变量，再在 JSX 里把变量传给 `onKeyDown`。适用于：任何把 hook 写在 JSX prop 里的位置，特别是把"内联 onKeyDown"改造成 useEnterToSubmit / useCallback 等的迁移过程
- **React error #300 在生产 minified bundle 里报名是 "Too many re-renders"**，但实际触发面更广，hook count 跨 render 变化也算。诊断时不要被字面意思带偏成"找无限渲染循环"——先 grep 受影响组件的 hook 调用是不是在条件分支里

## clipboard / 浏览器 API secure context

- **`navigator.clipboard` 只在 secure context 暴露**（HTTPS / `localhost` / `127.0.0.1`）。LAN HTTP（`http://192.168.x.x:3001`）下 `navigator.clipboard` 是 undefined，`.writeText()` 直接 TypeError。修法：抽 helper 先试 `navigator.clipboard?.writeText` 再 fallback 到 `document.execCommand('copy')` + 隐藏离屏 `<textarea>`。execCommand 'copy' deprecated 但所有现代浏览器仍实现，是非 secure context 下唯一选项。Safari 严格模式还要求**用户手势链上**调用——onClick 触发本来就在手势链上没问题。适用于：任何前端写"复制到剪贴板"的位置
- **`navigator.clipboard.writeText` 是 Promise，不要同步 `if (ok) toast.success` 跟在后面**。Promise reject 时会被 unhandled，但 toast.success 已显示——症状："剪贴板里是空的，可 toast 说复制成功了"。要 await + try/catch + 失败 toast.error 才 honest

## 上传 / multer / multipart

- **multer/busboy 默认按 latin-1 解析 multipart 帧 filename 字节**，但浏览器实际发 UTF-8（HTML5 spec + 主流浏览器 + curl 默认）。结果：`file.originalname` 对中文/日文/emoji 是 mojibake（每个 UTF-8 字节被 latin-1 解码成单字符）。修法：`Buffer.from(name, 'latin1').toString('utf8')` 字节回滚——把"被 latin-1 错误解码的字符串"还原成原始字节，再用 UTF-8 正确解码。ASCII 同构所以无副作用。适用于：任何后端接收 multipart 上传后用 `originalname` 做文件名 / 写盘 / 返回响应的位置（safeName / results / errors / skipped 全部要换）
- **fetch 不支持上传进度事件**——`Request.body` + ReadableStream 理论可以但浏览器实现参差。要进度条只能用 XMLHttpRequest 的 `xhr.upload.onprogress`（cross-browser 稳）。FormData + XHR 的 `setRequestHeader('Authorization', token)` 仍正常工作；浏览器自动设 multipart boundary 不要手动设 Content-Type
- multer fileSize 配置一旦发版生效，前端 fetch/XHR 没显式 abortController 时上传超大文件会被服务器 EBADF 截断，HTTP 413 是预期行为。前端要捕获 413 toast 提示

## WS subscribe / safeSend backpressure

- **`safeSend` 推大 payload 会自杀**（v-28-c 修复）：`safeSend` 检查 `bufferedAmount > 8MB` 时 `ws.terminate()`，但**自己**第一次 send 5 MB scrollback（JSON.stringify 控制码 escape 后膨胀至 ~30 MB）后 bufferedAmount 瞬间 30 MB，紧跟其后的任何 safeSend（包括 `terminal_subscribed` 回包、立即来的 broadcast）都看到超阈值 → terminate。修法：subscribe handler 在第一条 safeSend **前**打 `(ws as any).__subscribeAt = Date.now()` 时间戳；safeSend 检查时间戳 30 s 内用宽阈值（128 MiB）让 TCP 消化首屏 burst，过 30 s 回归 8 MiB strict。三处订阅入口都要 stamp：terminal_subscribe / chat_subscribe / dashboard sendActivitySnapshot
- **诊断 WS 自杀的最快路径**：Python 直接订阅一次 ws，看时序。`websockets` 库 + `ws.send(json.dumps({type:'auth',token:'localhost'}))` + `ws.send(json.dumps({type:'terminal_subscribe',cols:200,rows:50}))` + `ws.recv()` 循环。本会话实测：30 ms 内收到 connected + status 然后 `ConnectionClosed code=1006 reason=''`——明确指向"server 主动 abort"不是"客户端 parse 慢"也不是"加载慢"。代码 `/Users/tom/.cache/ccweb-ws-probe.py`
- **`/tmp/inspect.py` 干扰 stdlib `inspect` 模块**：本机 Python 3.14 把 `/tmp` 加进 sys.path（macOS `/tmp` symlink 到 `/private/tmp`），用户在 `/tmp/inspect.py` 放 `import numpy` 会被 import 时优先于 stdlib 加载。`asyncio` 等内部依赖 `inspect` → AttributeError: module 'inspect' has no attribute 'cleandoc'。修法：脚本写到 `/Users/tom/.cache/` 之类不在 sys.path 起点的位置，**不写 `/tmp`**。换 cwd 没用——`/private/tmp` 一直在 path 里
- scrollback 5 MB raw → JSON 30 MB 是因为 ANSI 控制字节 `\x1b`（1 byte）在 JSON 里 escape 成 ``（6 bytes），普通可打印 ASCII 1:1。codex/claude TUI 输出大量 cursor 移动 + 颜色变更，控制字节占比高，膨胀比 ~6×

## terminal-manager PTY race / fallback

- **onData/onExit 必须做 instance identity check 防 race**（v-27-a + v-27-f codex 抓 BLOCKER）：`switchCliTool` / `stop` 后老 PTY 会异步 onExit。如果 `handleExit(projectId)` 直接 `this.terminals.get(projectId)`，此时 map 里是新 PTY（switchCliTool 已塞进新的），会把新 PTY 误当 crash 走 backoff 拆掉或拖垮。修法：(1) onData 检查 `this.terminals.get(projectId) !== instance` 直接 return（drop late chunks）；(2) onExit 把 dying instance 透传给 handleExit 第二参数，handleExit 早返回 `if (exitingInstance && current && current !== exitingInstance) return`
- **`--continue` 找不到 session 时 `claude/codex` 直接 exit 1**（v-27-f 修）：`claude --continue` 在该目录从未交互过的情况下输出 "No conversation found to continue" 后 exit 1。daemon resumeAll 给所有 status='running' 项目带 `--continue` → 死循环 spawn。修法：terminal-manager 加 `continueSession: boolean` 字段记录本次启动是否带 --continue；handleExit 第一次 `--continue` exit ≠ 0 时立刻 `startTerminal(project, broadcast, false)` fresh 重启，不计 crash count。**必须 gate 一次性**：用 `continueFallbackDone: Set<string>`，stop / killForUpdate / switchCliTool / spawn 失败 catch 四处清除。否则 backoff 路径每次 setTimeout 重 spawn 仍带 --continue（`startTerminal` 重置 crashCounts），又 fallback fresh，无限循环不会 give up
- **`startTerminal` 每次清 `crashCounts.delete(projectId)` 让 MAX_RESTART_RETRIES=5 永远不生效**（v-27-f codex Q7 之外的 A 项指出，**未修，遗留 bug**）：handleExit 末尾 setTimeout 调 `startTerminal(..., true)` 重启 → startTerminal 又清 crashCounts → 再 crash 时 `crashes0` 永远是 0 → 永远不会到 give-up 路径。fresh 模式连续 crash 也会无限重试。修法：handleExit setTimeout 内部不调 startTerminal 而调 `_startTerminalForRetry`（不清 crashCounts 的内部函数），或 startTerminal 加 `isRetry: boolean` 参数

## codex 工具渲染 / TS 断言不能信运行时

- **codex JSONL 的 args 是 JSON.parse 出来的对象，TS 类型断言不约束运行时类型**（v-28-b 修复）：写 `const i = input as { session_id?: string; ... }; i.session_id.slice(0, 12)` 看似合法，但 codex 某版本输出 session_id 为数字 → `i.session_id.slice is not a function` 直接崩 React 组件。修法：所有可能非 string 的字段先 `String(...)` 强转再 slice/length；类型断言改 `unknown` 让 TS 强制运行时校验。`AssistantMessageContent.tsx` 4 处（write_stdin / send_input / spawn_agent / wait_agent）的 session_id / agent_id / goal / text 全部要做。`timeout_ms` 等期望 number 的字段加 `typeof === 'number'` 守卫
- **codex 工具 args 类型不稳定不是 ccweb bug 是 codex 自身行为**——OpenAI 内部 schema 演进时不破坏 JSONL 格式但允许字段类型变。所以 ccweb 任何依赖 codex args 类型的地方都要做运行时防御

## 任务流 / 流编排

- **状态全部 disk 化**（v-11-a 设计）：流的所有状态——progress、currentNodeId、history、loopCounters——都在 `.ccweb/flow_state.json`，runner 只是 active map 缓存。这让 daemon 重启时**理论上**可 resume，但 Phase 1 没实现（runner singleton 不会 rehydrate）；磁盘残留 `status='running'` 时前端要靠 `flow.running && state.status` 双重判断防出 stale dialog（v-11-b 修过）。后续若加 resume 需扫所有 flow_state.json，对 running 项目重建 ActiveRun。
- **LLM 任务推进信号必须用 LLM 自己写的文件**（v-11-a 设计）：runner 不靠 PTY echo / agent turn 完成 / 任何信号，靠 `fs.watch(task_todo.json)` 等 LLM 把约定的 `tasks[i].finish` 改 true。理由：LLM agent 是多 turn 的（一个任务可能跑 5 分钟），turn-end 不等于任务完成；LLM 写文件是它自己擅长的工作，最可靠。
- **prompt 注入靠 chat 通道复用现有路径**（v-11-a 设计）：`flowRunner.setPromptInjector(fn)` 注入 `writeTerminalInputSplit`，runner 自己不知道 PTY、bracketed paste、Ink heuristic 细节——这些都封装在已经实战检验的 chat 通道里。改 PTY 行为时只动 chat 通道一处，runner 自动受益。
- **system-logic 分支文件 cache 必须 per-run 而非 per-flow**（v-11-a runner P0）：`executeSystemLogic` 内部 `fileCache: Map<path, parsed>` 是函数局部变量，每次进节点重新 `new Map()`。回边循环（goto 回到自己）下不会复用过期 cache。如果改成实例字段会出 stale read 假阳性。
- **runner abort 必须先 capture resolvers 再 clearWaiters**（v-11-a codex P0）：旧顺序 `clearWaiters(run)` 先把 `waitResolve` 设 null，再调 `waitResolve?.('aborted')` 是 no-op，导致 in-flight LLM 等待永远不 resolve、runLoop 挂死、UI 显示 aborted 但协程仍在跑。正确顺序：`const wait = run.waitResolve; const userReject = run.userInputReject; run.userInputResolve = null; run.userInputReject = null; wait?.('aborted'); userReject?.('aborted'); this.finalize(run, 'aborted');` ——`settle()` 会内部 clearWaiters，外层不要重复清。
- **branches `Object.is` 严格比较会被 LLM 类型漂移坑**（v-11-a P1）：LLM 写 JSON 经常把 boolean 漂成 string（`"true"` vs `true`），number 漂成 string。`branchMatches(value, expected)` 必须对 boolean/number 加宽松转换：`expected:boolean` 时接受 `"true"`/`"1"`/`"yes"`；`expected:number` 时接受数字字符串。不做转换 → 所有分支静默 mismatch 走 default 路径，无错可查。
- **回边检测靠 history 不靠 id 顺序**（v-11-a P1）：用户可以随意编号节点（5 → 3 → 8），`goto < node.id` 假设拓扑排序错。正解：`visited = new Set(history.map(h => h.nodeId)); isBackward = visited.has(goto)`——访问过的就是回边。
- **删节点 / 删变量必须同步清反向引用**（v-11-b + v-11-f）：FlowEditor 删节点 N 时遍历剩余节点把 `next === N` / `defaultGoto === N` 设 null + 把 `branches.goto === N` 整条 branch 删；删变量 V 时遍历节点把 `initVariables` 中 V 移除 + `branches.variable === V` 整条 branch 删。否则保存时后端 validator 返 generic "invalid flow definition" 不具体，用户撞墙。这是配套数据结构变更时必做的事，不只任务流——以后任何"组件持有引用"的 UI 都要做。
- **validator 必须 trim 后检查空**（v-11-f codex P1）：`field: " "` 在 `length > 0` 下通过校验，但 runtime `obj[" "]` 是 undefined → 静默分支无效。修法：trim 后判空 + 写回 trim 值（落盘已规范化）。同理 variable name / file。
- **`{{file:rel}}` 字符串模板要走 `safeProjectPath`**（v-11-b codex P0）：4 处运行时调用——`renderTemplate` / `readInputs` / `executeUserInput.outputs` 写盘 / `executeSystemLogic` 读分支文件。设计时 `validateFlowDef.isFileRef` 调 `isSafeRelPath` 拦截 PUT 时投毒。任何 `path.join(folderPath, userPath)` 都要换。
- **prompt 拼接字段必须拒控制字符 + backtick**（v-11-f codex P1）：`variable.file` 进 prompt 里 `` `<file>` `` markdown 包裹，`backtick` 会破坏格式 → LLM 理解错乱；`\x00-\x08\x0b\x0c\x0e-\x1f` 控制字节是 prompt 注入面。修法：validator 加 `PROMPT_UNSAFE` regex 黑名单。description 保留 `\t\n\r` 允许多行。
- **AskUserQuestion / ExitPlanMode 是 UI primitive 不是权限请求**（v-11-e）：`bin/ccweb-approval-hook.js` 当时不分 tool 名，所有 PermissionRequest 一律转 backend 弹审批框，把 N-选项压缩成 allow/deny 丢选项。修：白名单 `TUI_PASSTHROUGH_TOOLS` 命中直接写 `{}` passThrough 让 Ink TUI 原生处理。判断标准：rich UI 不等于 allow/deny 的工具都该 passThrough。
- **任务流 task_todo append-only，loop 重入新条目**（v-11-a 设计）：node 5 → goto 4 时 task_todo 里 id=4 出现第二条 entry，runner 等的是 `tasks[currentTaskIndex].finish === true`（按 index 不按 id）。LLM 收到 prompt 时指令明确"改 index N 的 entry"，不会跨条目串扰。这避免了"重置 finish=false 是否丢历史 audit"的歧义。
- **流级变量 default file = `.ccweb/task_var.json`**（v-11-f 设计）：用户没填 `variable.file` 时由 UI 在 Save 时兜底替换。这让"加变量"成本降到 1 字段（仅 name），鼓励用户多用变量代替手写 field+inputs 的繁琐分支。

## React / hook 规则（补充）

- **useEffect 依赖来自轮询父组件的 props 数组/对象**——每次轮询都是新引用 → effect 每 tick 触发一次 → 内含的 setState 把用户的输入清空（v-11-c FlowUserInputDialog）。表现：用户打字过 2s 就被清空，看起来"输入框一直刷新"。修法：删 useEffect，改用 `useState(() => init)` lazy 初始化。组件由父级条件渲染时，切换 unmount/mount 自然处理"不同上下文"——不需要运行时 reset。适用于：任何被父级 polling/WS 重渲染的对话框、表单、列表筛选条件。
- **`crypto.randomUUID()` 仅 secure context 暴露**（HTTPS / localhost / 127.0.0.1）；LAN HTTP（`http://192.168.x.x`）下 `crypto.randomUUID` 是 undefined 直接 TypeError。修法：抽 `uuidV4()` helper 优先用 native，fallback `crypto.getRandomValues` (非 secure context 也可用，密码学安全)，再 fallback `Math.random`。和 `navigator.clipboard` 同类问题——LAN HTTP 部署的浏览器 API 都要 polyfill。

## react-pdf / pdfjs-dist 版本

- **`react-pdf` 内置的 `pdfjs-dist` 必须 exact-pin**（v-6-b 修）：`react-pdf@10.4.1` package.json 写 `"pdfjs-dist": "5.4.296"`（精确版本，不带 `^`）。如果在 host package.json 同时 `"pdfjs-dist": "^5.7.284"`，npm 顶层装 5.7.284，react-pdf 还在用 nested 5.4.296 → API 用 react-pdf 内部的 5.4.296、Worker 用顶层的 5.7.284 → `does not match the Worker version` 直接崩。修法：host 必须用与 react-pdf 同精确版的 pdfjs-dist。
- **pdfjs worker 文件是 `pdf.worker.min.mjs`**（ESM），不是 `.js`。Vite 用 `import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'` 静态打包+懒加载，`pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;` 模块顶层赋值即可。SSR/HMR 无问题（ccweb 是 SPA）。
- **长 PDF 不要一次性渲染所有 `<Page>`**（codex 审 v-6-a P0）：100+ 页 + `renderTextLayer + renderAnnotationLayer` 会主线程卡死/内存爆。最低代价：`LazyPage` + IntersectionObserver `rootMargin=600px`，render-once 不卸载——首屏栅格化 1-2 页，向下滚逐页加载。完整虚拟化（react-window）需要预计算每页高度（`pdf.getPage(i).getViewport()`），代价大；MVP 不做。

## 已归档

（无）

END 历史教训

