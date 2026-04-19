# CCWEB：LLM CLI 的 Web 前端

**当前版本**: v2026.4.19-w ｜ **包名**: `@tom2012/cc-web` ｜ **MIT** ｜ https://github.com/zbc0315/cc-web

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

### 🚀 发版（完整流程见 `DETAILS/release.md`）

- **四文件版本同步**：`package.json` + `UpdateButton.tsx` + `README.md` + `CLAUDE.md`
- **版本号格式**：`YYYY.M.D-<letter>`（日期为下一自然日，字母 `-a/-b/…`）
- **🚫 绝不发 bare 日期版本**（`2026.4.19` 无后缀）：当天断版 + npm 永久占用（#14/#29）
- **git add 必须指定文件**，禁止 `git add -A` / `git add .`（会扫入 `.memory-pool/` / `research/` / `FEEDBACK_*.md` 等私有文件，#13）
- **发版前必须浏览器实测一次 Write 审批路径**（hook 是黑盒，盲发会挂，#25）

## 本机环境

- **`~/.npmrc` 设置了 `omit=dev`**：所有 `npm install` 必须加 `--include=dev`（否则 TypeScript / Vite 等 dev 依赖被跳过，构建失败）
- `~/.npmrc` registry 当前 `https://registry.npmjs.org`（官方），`~/.npmrc.bak` 保留切换前的 `npmmirror.com` 配置，如遇国内网络问题再切回
- `node-pty` 是原生绑定，切 Node 版本后需 `npm rebuild`
- 手动 `npm install -g` 升级后**不会自动重启运行中的进程**，UpdateButton 会误报"已是最新"；需 `ccweb stop && ccweb start --<mode> --daemon` + 浏览器硬刷

## 历史错误防重犯

**33 条详细教训**见 `DETAILS/pitfalls.md`，按主题分类（架构/数据模型、WebSocket、Retry、Hook、前端 UI、安全权限、子进程环境、发版、元认知）。准备改动任一相关模块或发版前建议扫一遍对应章节。

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
<!-- 用途：新会话开始时读此文件获得 30 秒项目全貌。想写代码/改架构前先读"技术及功能细节.md"；想看当前任务读"TODO.md" -->

# ccweb 项目大纲

## 一句话

把 Claude Code / Codex / OpenCode / Qwen / Gemini 等 CLI 工具包装成浏览器 UI 的自托管 web app，单人/局域网多用户使用。

- 包名：`@tom2012/cc-web`（npm）
- 开源仓库：`https://github.com/zbc0315/cc-web`
- 社区共享仓库：`https://github.com/zbc0315/ccweb-hub`（Quick Prompts + Agent Prompts 共享池）
- 作者：zbc0315（Tom）

## 当前阶段

**活跃迭代中**。v2026.4.19-w（2026-04-19 发布，npm registry latest）。发版节奏为"日期 + 字母后缀"，同日多次发布用 `-a/-b/.../-w`，从不发 bare 日期版本。

## 核心模块

- **backend 适配器层**：`backend/src/adapters/` 每个 CLI 一个 adapter（claude/codex/opencode/qwen/gemini/terminal）
- **终端会话**：`terminal-manager.ts` + `session-manager.ts`，node-pty 驱动，直读 CLI 自身 JSONL 转 ChatBlock
- **WebSocket**：`/ws/dashboard` 推活动；`/ws/projects/:id` 推终端+聊天+审批+semantic
- **ChatOverlay**（电脑对话框）+ MobileChatView（手机）+ MonitorDashboard（监控大屏）三端共享 `AssistantMessageContent`
- **Quick Prompts**（原 Shortcuts）：项目/全局两级，点击发送
- **Agent Prompts**：可插拔到 CLAUDE.md 的 prompt 片段，项目/全局两级
- **Memory Prompts**（v-v 新增）：读 `<project>/.ccweb/memory/*.md`，点击用 `START <name>`/`END <name>` 标记插入 CLAUDE.md
- **CCWeb Hub**（v-u 重建）：浏览/提交社区 prompt；per-user GitHub PAT 一键直接提交（AES-GCM 加密存 `~/.ccweb/hub-auth/`）
- **rsync 同步**（v-t 引入）：per-user 配置，openrsync 兼容，push/pull/双向，cron 调度
- **权限审批**：Claude Code `PermissionRequest` hook → 遮罩卡片
- **插件系统**：ccweb 自己的 manifest 插件（不同于 Claude Code plugins）
- **输入框 `/` `@` 面板**（v-u 引入）：斜杠命令 + 文件引用，填充到输入框而非直接发送

## 里程碑

### 已完成

- 2026-04-19 v-v：Hub 一键直提交（per-user PAT）、Memory Prompts、富 tool_use 渲染（TodoWrite checklist 等）、用户气泡可折叠、三 Panel 布局统一、灰色侧边栏
- 2026-04-19 v-u：垂直侧边 tabs、CCWeb Hub shell、输入框 `/ @` 工具栏、`/model` 切换修复、openrsync 兼容
- 2026-04-19 v-t：rsync 同步子系统（SSH wrapper 防注入、AES-GCM 密码加密）、CLAUDE.md 精简到 89 行
- 2026-04-19 v-s：移除 plan-control 子系统
- 2026-04-19 v-q：Agent Prompts + 全局 Confirm Dialog（替代 window.confirm）

### 进行中

无明确进行中的大任务。小 P1 polish 见 TODO.md。

### 未来考虑

- Hub OAuth Device Flow 替代 PAT（更流畅但需先注册 GitHub OAuth App）
- 权限 gate：view-only shared 用户看到但不能用 `+` 按钮（P1）
END 项目大纲

START 项目详情
<!-- 用途：理解"为什么这样设计"时查阅。讨论架构/产品决策前先读此文件；实现新功能前想知道是否踩过类似坑再读"历史教训.md" -->

# ccweb 项目决策与背景

## 是什么 · 给谁用

ccweb = `@tom2012/cc-web`，单文件 npm 包形式发布，用户 `npm install -g` 后运行 `ccweb start --local --daemon`，浏览器访问即可把本机的 Claude Code / Codex / OpenCode / Qwen / Gemini CLI 开到 Web 上。

目标用户主要是作者自己（zbc0315/Tom）+ 局域网内的用户（公司/家中多设备）。非公开 SaaS。

## 核心产品决策

### 为什么要做（背景）

- Claude Code 等 CLI 工具只能在终端用；作者在 iPad/手机/其他电脑上也想用
- 原方案（SSH + tmux）对非专业用户太复杂
- ccweb 把 CLI 的 TTY 用 node-pty 桥到浏览器 xterm.js，增加项目管理、权限审批、历史浏览等 web 原生能力

### 适配器模式

每个 CLI 一个 adapter（`backend/src/adapters/<tool>-adapter.ts`），把 CLI 的原生 JSONL 格式（或 JSON/他格式）抽象为统一 `ChatBlock`。好处：切 CLI 不破坏上层 UI；坏处：每次 CLI 升级（如 Claude Code 2.1.114 → 2.x）都要检查 adapter 适配。

### 直读 CLI 原生 JSONL 做历史源

v2026.4.19-o 之后 ccweb **不再自己存档聊天历史**，统一回源到 CLI 自身的 JSONL 文件（如 `~/.claude/projects/<encoded>/<uuid>.jsonl`）。理由：避免双写不一致；Claude Code `--continue` 等操作 ccweb 不需要感知。代价：JSONL 格式变了要追更新。

### CCWeb Hub 为什么用 per-user PAT 而非服务端统一 token

曾在 v-p 之前用过内嵌的 GitHub Bot Token，被迫 rotate（token 永留 npm 历史 tarball）。后果严重到写进 CLAUDE.md 红线（pitfalls #30）。

v-v 方案：
- ccweb 不含任何 token
- 每用户在设置页填自己的 GitHub fine-grained PAT（仅 `ccweb-hub` 仓库 Issues: Read and write）
- AES-256-GCM 加密存 `~/.ccweb/hub-auth/<sha1(user)>.json`，key 派生自 server jwtSecret（jwtSecret 轮换时 token 自动失效，UI 提示 reset）
- 提交时 ccweb 用用户自己的 PAT 调 GitHub Issues API —— Issue 归属该用户，审计清晰

备选方案 GitHub OAuth Device Flow 更流畅但需注册 OAuth App，暂推迟。

### Memory Prompts 为什么用 bare-text 标记而不是 HTML 注释

用户明确要求 `START <name>` / `END <name>` 字面单独成行，而非 `<!-- START name -->`。因为这些标记目的是让 Claude 自己读 CLAUDE.md 时能理解"这段是某 memory 的边界"——bare text 在 markdown 里是普通段落，Claude 能看到；HTML 注释 markdown 渲染时可见，但 Claude 读取 raw 时同样可见，无功能差别。选 bare text 因为用户明确要求。

### 三端（Desktop / Mobile / Monitor）共享同一个 AssistantMessageContent

TodoWrite checklist、Bash 终端样式、Edit 文件预览等富渲染只实现一次。`plain` prop 让用户气泡（不走 blocks）复用同一折叠/展开机制。

### 版本号方案

`YYYY.M.D-<letter>`（如 `2026.4.19-v`）。同日发多次用下一字母，从不发 bare `YYYY.M.D`（原因见 CLAUDE.md pitfalls #29：bare 在 semver 中大于任何 pre-release，发了 bare 当天就断版；npm 还会永久占用版本号即使 unpublish）。

### rsync 不是真双向同步

用户选 "bidirectional" 方向时，backend 顺序执行 push（去掉 `--delete`，加 `-u` 更新策略）然后 pull。**不是真的冲突合并**——是"尽量不互删"。代码注释和 UI 说明都强调这点。用户想要真双向需要 unison 之类工具。

## 架构约束

### 多用户隔离

- LAN 模式下多用户：各自的 GitHub token、rsync 配置、memory prompts（项目级文件，各用户看到各自可访问的项目）
- admin 用户 vs 普通注册用户：`requireAdmin` 和 `requireProjectOwner` 中间件控制
- 凭据永远只从 env/config 读，绝不硬编码

### 平台

- 主力平台 macOS（作者本机 darwin 25.3.0 + macOS 15+）
- macOS 15+ 的 `/usr/bin/rsync` 是 **openrsync**（BSD 重写版），不支持 `--stats` 等 GNU rsync 特性。ccweb 检测并走保守 flag 集（`-avzi`）

### 与 Claude Code 的耦合点

- 聊天历史直读 `~/.claude/projects/<encoded>/<uuid>.jsonl`
- 权限审批走 `PermissionRequest` hook；hook 脚本在 `bin/ccweb-approval-hook.js`；新版 Claude Code v2.1.114+ 的 hook payload 不再带 `tool_use_id`，用 sha1 合成确定性 id
- `/model` 别名集对齐 Claude Code CLI `--model`：`default / opus / sonnet / haiku / opusplan / opus[1m] / sonnet[1m] / 完整 model ID`
- `~/.claude/plugins/<name>/.claude-plugin/plugin.json` 扫描用于 `/` 面板显示 plugin 命令

## 利益相关方

单人项目，作者 = 维护者 = 主要用户。无外部 stakeholder。社区贡献走 CCWeb Hub 的 Issue 审核模式。
END 项目详情

START 技术及功能细节
<!-- 用途：实现层面的"为什么这么写"。改动下列任意模块前先读；改完对照本文件的约束检查。如模块不在此列表中，直接读代码即可，这里只记录"看代码看不明白"的深水区 -->

# ccweb 技术深水区

项目背景：`@tom2012/cc-web`，把 LLM CLI 包装成 Web UI。代码在 `/Users/tom/Projects/cc-web`。

## 斜杠命令的 retry 陷阱

Claude Code 的 slash 命令（`/model`、`/clear` 等）**不产生 JSONL 用户 echo**（它们被 TUI 内部拦截，不发给 assistant）。ccweb 的 `sendMessage`→`sendWithRetry` 机制依赖 user echo 匹配 `recentSentRef` 判断是否送达，没匹配就每 3 秒发一个裸 `\r`，最多 20 次（60 秒）。

后果：`/model opus` 第一次 send 命中了，但 retry 持续发 `\r` 60 秒，这些 Enter 在 TUI 里可能 confirm picker 错误选项或中断状态。

**约束**：任何发送 slash 命令必须 **绕开 retry 走 `onSend` 直发**，例如：
```ts
onSend(`/model ${alias}\r`);  // 不要走 sendToTerminal/sendMessage
```

`handleCommand`（`/` 面板点击）改成 `insertAtCursor` 不发送；`handleModelSelect` 用 `onSend` 直发。

## `/model` 的别名 + 持久化双保险

Claude Code 2.1.114 的 `--model` / `/model` 接受：
- `default` `best` `opus` `sonnet` `haiku` `opusplan` `opus[1m]` `sonnet[1m]`
- 或完整 ID `claude-opus-4-7` 等

ccweb 下拉菜单暴露前 5 个，高级用户可在输入框直接输完整 ID。

**双保险机制**：
1. 直发 `/model <alias>\r` 即时切换
2. `PUT /api/tool/model` 同时写 `~/.claude/settings.json` 的 `model` 字段（merge-safe，只改 `model` 不动 `hooks` / `mcpServers`，写入前校验 settings 是 plain object，否则 500 拒写）

意图：即时切换若被 TUI state 拦截，下次启动也是对的。

## tool_use 结构化字段

`ChatBlockItem` 扩展：
```ts
interface ChatBlockItem {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  content: string;           // legacy: name(args-truncated-200)
  tool?: string;             // "Bash" / "Edit" / "TodoWrite" ...
  input?: unknown;           // 原始 input，字符串叶子节点 cap 4KB（`capStrings` 递归）
  output?: string;           // tool_result 完整截断到 4KB
}
```

前端 `AssistantMessageContent` 当 `blocks` 存在时走 `BlockView` 分流渲染：
- `TodoWrite` → checklist（Circle/CircleDashed/CheckCircle2 三态图标）
- `Bash` → 终端样式 `$ command` + description
- `Edit`/`Write`/`MultiEdit` → file_path 高亮 + 可折叠 diff
- `Read`/`Grep`/`Glob` → 单行 icon + target
- 其他 → 通用 pretty JSON 卡片
- `thinking` → 折叠"思考…"按钮
- `tool_result` → "Result" + `ToolDetails`（2 行预览 + 展开）

rolling upgrade 兼容：老后端无 `tool`/`input` 字段，前端 fallback 到 `content` 字符串 + ReactMarkdown。

## Memory Prompts 标记格式

文件：`<project>/.ccweb/memory/*.md`，每个文件 = 一个卡片，文件名去 `.md` = `name`。

插入 CLAUDE.md 时追加：
```
START <name>
<file body>
END <name>
```

**bare text**（非 HTML 注释），单独成行。用户明确要求这个字面格式。

删除正则：
```js
new RegExp(`\\n*^START ${reEscape(name)}$[\\s\\S]*?^END ${reEscape(name)}$\\n*`, 'm')
```

`m` flag 让 `^`/`$` 匹配行首/行尾。非贪婪 `*?` 避免吃到后面同名块。3+ 连续空行写入后自动折叠为 2。

**race 风险**：toggle 请求发出后用户手改 CLAUDE.md，toggle 完成时 `writeClaudeMd` 覆盖用户改动。Agent Prompts 有同样风险。未来可加 mtime 比对。

**body 禁用"START/END <name>" 单独成行**：否则 remove regex 会从那行截断。未校验，暂文档化。

**Symlink 防护**：list 和 insert 两条路径都 `lstatSync + isFile()` 过滤 symlink，否则有 edit 权限用户放 `evil.md -> /etc/passwd` 可泄露内容。

## `@` 文件引用的路径边界

`handleFileSelect(absPath)` 计算项目相对路径：
```ts
if (root === absPath || absPath.startsWith(root + '/') || absPath.startsWith(root + '\\')) {
  rel = absPath.slice(root.length).replace(/^[/\\]+/, '');
}
```

**必须带分隔符** `+ '/'` / `+ '\\'`。裸 `startsWith(root)` 会把 `/foo-other/bar` 误配 `/foo` 前缀返 `-other/bar`，错得离谱。

`FilePickerPanel.canGoUp` 和 parent 计算同样守卫；parent 用 `Math.max(lastIndexOf('/'), lastIndexOf('\\'))` 跨平台。

## 加密分层：crypto-at-rest.ts

AES-256-GCM，key 派生 `SHA-256("ccweb-<label>:" + jwtSecret)`。

**label 必须参数化**，每个子系统自己的 label：
- `sync`（rsync 密码）
- `hub`（GitHub PAT）

两个子系统用同一 label 会共享 key；当前只有 2 个调用方，未加 TS 枚举约束（低优）。

每个密文附 4-byte fingerprint（`keyFingerprint(label)`）。读取时比对，不匹配说明 jwtSecret 轮换过（比如用户重跑 setup），UI 应提示"需重新输入 token/密码"而不是返回空字符串让用户以为 token 有效但一直 401。

**jwtSecret 位置**：`~/.ccweb/config.json`（由 setup 生成，不要手动改）。

## CCWeb Hub 后端

仓库 `zbc0315/ccweb-hub`，结构：
```
quick-prompts/<slug>.md    # 每个文件 YAML frontmatter + body
agent-prompts/<slug>.md
```

读取：`/api/skillhub/items` 走 GitHub Contents API 列两个目录 + raw 下载每个 `.md`，5 分钟缓存。YAML 用 `js-yaml` + `FAILSAFE_SCHEMA`（手写 regex 解析不了 multi-line / quoted-colon 等）。单文件解析失败不污染全 hub（per-file try/catch）。

提交：`POST /api/skillhub/submit` 用 caller 的加密 PAT 解密后调 `https://api.github.com/repos/zbc0315/ccweb-hub/issues`。严格校验输入：
- `label` 拒绝 `\r\n`，≤ 200 字符
- `description` 单行 ≤ 300
- `author` 单 token ≤ 64 无空白
- body 外包的 markdown fence 长度 = content 里最长反引号连续 + 1

401/403 时错误消息区分 token 失效 vs scope 不足 vs rate limit。

## 插件命令扫描

Claude Code plugins 装在 `~/.claude/plugins/<name>/`，每个含可选 `.claude-plugin/plugin.json`（字段 `name` = 命名空间）。ccweb 扫：
- `<plugin>/skills/<skill>/SKILL.md`
- `<plugin>/commands/*.md`

输出 `/<plugin-name>:<skill-or-command>`（Claude Code 官方 namespacing）。

**防护**：
- plugin.json `name` 白名单 `/^[a-zA-Z0-9_.-]+$/`，不合规 fallback 目录名
- symlink 过滤（`isSymbolicLink()` skip；对 `SKILL.md` 也 `lstatSync` 拒 symlink 文件）
- 多 plugin 同命名空间 console.warn（第二个的 commands 被 `seenCommands` 静默吞掉否则）

## 侧边栏配色

Left/Right Panel 外层 `bg-muted/40`，tab rail `bg-muted/60`，内容区 `bg-background`——三层灰阶形成视觉层次。shadcn 主题变量，亮/暗模式自适应。暗模式下 muted/40 vs background 对比较弱，接受现状未再调。

`PANEL_WIDTH_MIN = 200`（原 150）——给 36px tab rail 留足空间后还有 ~164px 内容区，FileTree 文件名不至于被截成 `app...`。

## 用户气泡折叠

`AssistantMessageContent` `plain` prop 让它服务用户气泡：
- `plain: true` + `blocks?: never`：discriminated union 类型约束互斥
- 渲染改为 `whitespace-pre-wrap` 原文
- 折叠/展开逻辑与 LLM 气泡共用（`isLatest` → 初始 expanded；新 latest 到来自动展开；true→false 从不自动折叠）

ChatOverlay 另算 `latestUserId`（遍历 messages 末尾往前找 role='user'）传给用户气泡。

## rsync 子系统

**macOS 15+ openrsync 兼容**：
- `/usr/bin/rsync` 是 openrsync（`protocol version 29`）
- 不支持 `--stats` / 部分 `-a` 子选项
- 支持 `-avzi`（itemize 每文件变更行格式 `[<>ch]f` 前缀）
- 启动时 `detectRsyncBin()` 检测，优先 `/opt/homebrew/bin/rsync` 若有，fallback `/usr/bin/rsync`

**SSH wrapper script**：rsync `-e` 接受的字符串会被 rsync 按空白 split，用户 keyPath 含空格或 `-oProxyCommand=evil` 可注入。方案：生成 per-user wrapper `<DATA_DIR>/sync-ssh/<sha1>.sh`（mode 0700），所有 SSH 选项 shell 单引号转义嵌入脚本；rsync 用 `-e <script-path>` 直接 exec。

**密码路径**：password auth 走 `sshpass -e ssh ...`（嵌入 wrapper 脚本头），`SSHPASS` env 传递不进 argv。需要系统装 `sshpass`（Homebrew `/opt/homebrew/bin/sshpass`）。

**telemetry**：
- `bytes` 优先 `total size is N`，fallback `sent`/`received` 按方向
- `filesTransferred` 数 `^[<>ch]f` 开头的 itemize 行
- 日志 >2MB 自动 truncate 到后半

## 危险操作规则

- **凭据绝不硬编码进 npm 包**（pitfalls #30）。hub PAT 逃不过这个。
- **`git add` 必须指定文件**（pitfalls #13），`.memory-pool/*` / `research/` / `FEEDBACK_*.md` / `CLAUDE-example.md` 从不入仓
- **发版永不发 bare 日期版本**（pitfalls #29）
- **管理性路由**挂 `requireAdmin` / `requireProjectOwner`，绝不在 handler 里手写 `isAdminUser` 判断（pitfalls #31）
END 技术及功能细节

START 服务及进程
<!-- 用途：看/启/停 ccweb 服务时查此文件。在执行启停操作前先跑一次"状态检查"命令，不要直接相信"当前状态"字段——可能已过时。注意 CLAUDE.md 红线：不要 kill 非本次会话启动的进程 -->

# ccweb 服务 / 进程清单

项目：`@tom2012/cc-web`（ccweb）。本机 macOS 15+。开发机路径 `/Users/tom/Projects/cc-web`。

## ccweb 生产（本地 daemon）

- **位置**：本机（127.0.0.1）
- **类型**：后台 daemon（detached child via `bin/ccweb.js`）
- **启动命令**：
  ```bash
  ccweb start --local  --daemon    # 仅 127.0.0.1
  ccweb start --lan    --daemon    # 局域网
  ccweb start --public --daemon    # 公网任意 IP
  ```
- **停止命令**：
  ```bash
  ccweb stop
  # 或
  kill -TERM "$(cat ~/.ccweb/ccweb.pid)"
  ```
- **状态检查**：
  ```bash
  cat ~/.ccweb/port                         # 看当前端口
  lsof -iTCP:"$(cat ~/.ccweb/port)" -sTCP:LISTEN -n
  curl -sf "http://127.0.0.1:$(cat ~/.ccweb/port)/api/health" || echo "down"
  ps -o pid,command -p "$(cat ~/.ccweb/ccweb.pid 2>/dev/null)" 2>/dev/null
  ```
- **日志位置**：没有集中 daemon 日志（console 默认丢掉）。rsync 子系统日志在 `~/.ccweb/sync-logs/`。开发时用 dev 模式（见下）。
- **预期**：健康时 GET `/api/health` 200；WS 端点 `/ws/dashboard` + `/ws/projects/:id`
- **关键脚本**：`bin/ccweb.js`（npm 包入口）
- **当前状态**：未验证（本次会话未执行状态检查）。以往习惯是作者开机常驻一个 `--local --daemon` 实例。
- **依赖**：需先 `npm run setup` 生成 `~/.ccweb/config.json`；`~/.npmrc` 不要关 dev 依赖

## ccweb 沙箱测试实例

- **用途**：测试开发中改动又不污染生产 `~/.ccweb/port` / `~/.claude/settings.json`（pitfalls #23）
- **启动**：
  ```bash
  HOME=/tmp/ccweb-test-$$/home CCWEB_PORT=3099 \
    node bin/ccweb.js start --local --daemon
  ```
- **状态检查**：
  ```bash
  curl -sf http://127.0.0.1:3099/api/health
  ls -la /tmp/ccweb-test-*/home/.ccweb/ 2>/dev/null
  ```
- **停止**：沙箱 HOME 下 `HOME=/tmp/ccweb-test-$$/home node bin/ccweb.js stop` 或直接 `lsof -ti:3099 | xargs kill`（**只 kill 确认是你启动的**，pitfalls 安全规则）
- **当前状态**：未验证
- **相关脚本**：无专门脚本，命令行直接拼

## 开发模式

分离的前后端，需要两个 terminal：

### backend dev
- **启动**：`npm run dev:backend`（`tsx watch`）
- **停止**：Ctrl+C
- **状态检查**：监听 3001（默认），看 console 输出
- **日志**：console 前台

### frontend dev
- **启动**：`npm run dev:frontend`（`vite dev`）
- **停止**：Ctrl+C
- **状态检查**：Vite 默认开在 5173
- **日志**：console 前台
- **依赖**：`npm install --include=dev` 必须装（因 `~/.npmrc` 有 `omit=dev`）

### 全量 build
```bash
npm run build   # frontend 再 backend
```

## rsync 同步调度器（后台线程）

- **位置**：在 ccweb 主进程内（`backend/src/sync-scheduler.ts`）
- **启动**：主服务 `server.listen` 成功后 `startSyncScheduler()` 自动调
- **停止**：`stopSyncScheduler()`（主进程退出时隐含）
- **状态检查**：无专门端点。日志看 `~/.ccweb/sync-logs/<sha1(user)>/<projectId>.log`
- **tick**：每分钟顶部时刻触发一次，遍历所有 `listUsersWithSyncConfig()` 返回的用户，匹配 cron 的触发该用户全项目同步
- **lastRunKey** 防 DST 双触发
- **依赖**：用户必须在 Settings → 同步 (rsync) 里配好 host/user/remoteRoot + 勾选 "启用" cron

## Claude Code CLI 进程（被 ccweb 管的子进程）

- 每个项目窗口 = 一个 `node-pty` 派生的 `claude` CLI 子进程
- ccweb 通过 `terminal-manager.ts` 管理 PID、stdin/out 桥到 WS
- 停止方式：ccweb 调 `terminalManager.stopProject(projectId)` → SIGTERM 子进程
- 状态：由 ccweb 自己 track，前端 `Project.status = running/stopped/restarting`
- **不要手动 kill 这些 PID**——会让 ccweb 的 state 和实际不一致

## CCWeb Hub（远程 read-only 依赖）

不是本地进程，是作者维护的 GitHub 仓库 `zbc0315/ccweb-hub`。ccweb 后端通过 `https://api.github.com/repos/zbc0315/ccweb-hub/contents/...` 读取，5 分钟缓存。

- **健康检查**：`curl -sI https://api.github.com/repos/zbc0315/ccweb-hub`
- 无 ccweb 本地"进程"需要管
- 60/hr 匿名 rate limit（raw.githubusercontent.com 不计入）

## 已退役

### 计划控制子系统（v-s 移除）
原 `backend/src/plan-control/` + `PlanPanel.tsx` + `.plan-control/` 目录 + `plan_*` WS 事件。整体删除。

### SkillHub 内嵌 Bot Token（v-p 前）
曾在 `skillhub.ts` 以 `_TP.join('')` 拆字符串绕 secret scanner 硬编码 GitHub PAT。已被迫 rotate（永留 npm 历史 tarball）。现方案：per-user PAT（pitfalls #30）。

### ccweb 自有聊天历史存档（v-o 前）
`<project>/.ccweb/sessions/` + `<project>/.ccweb/information/`。v-o 统一回源到 CLI 自身 JSONL，两目录完全移除。
END 服务及进程

START 配置信息
<!-- 用途：找"某东西在哪 / 某凭据在哪 / 某端口占谁"时先查此文件；记住"值的位置"永远只记文件路径/环境变量名，不记明文 -->

# ccweb 配置与资源清单

项目：`@tom2012/cc-web`（ccweb），开发机 macOS 15+（darwin 25.3.0），本机路径 `/Users/tom/Projects/cc-web`。

## 包管理 / 发布

| 资源 | 值 | 备注 |
|------|-----|------|
| npm 包名 | `@tom2012/cc-web` | `npm install -g @tom2012/cc-web` 全局安装 |
| npm registry | `https://registry.npmjs.org` | 已从 `npmmirror.com` 切回官方（2026-04-18）；备份在 `~/.npmrc.bak` |
| npm token | 用户 tom2012 的 publish token | 仅通过命令行参数 `--//registry.npmjs.org/:_authToken=<token>` 传，**绝不写入任何 git 追踪文件**（pitfalls #30） |
| `~/.npmrc` | 设置了 `omit=dev` | 所有 `npm install` 必须加 `--include=dev`，否则 TypeScript/Vite 等 dev 依赖被跳过构建失败 |

## GitHub

| 仓库 | URL | 用途 |
|------|-----|------|
| `zbc0315/cc-web` | `https://github.com/zbc0315/cc-web` | 主仓库 |
| `zbc0315/ccweb-hub` | `https://github.com/zbc0315/ccweb-hub` | 社区共享 Quick Prompts + Agent Prompts（`quick-prompts/*.md` + `agent-prompts/*.md`） |

- gh CLI 已登录 `zbc0315`，token scope: `gist, read:org, repo, workflow`（无 `delete_repo`）
- 用户通过自己建的 GitHub fine-grained PAT 向 ccweb-hub 提交 Issue（scope 限定为 `ccweb-hub` 仓库 Issues: Read and write）
- 用户 PAT 加密存于 `~/.ccweb/hub-auth/<sha1(username)>.json`，明文**从不出现在服务端内存外**

## 数据目录 `~/.ccweb/`

| 文件/目录 | 内容 | 备注 |
|-----|------|------|
| `config.json` | admin 用户名 + bcrypt 密码 hash + JWT secret | 由 `npm run setup` 生成，**不要手改** |
| `users.json` | 次级注册用户列表 + bcrypt hash | |
| `approval-secret` | 32 字节 hex，mode 0600 | Claude Code PermissionRequest hook 签名用 |
| `prefs.json` | `lastAccessMode` 等小 prefs | |
| `port` | 当前监听端口号 | hook 脚本读此文件找服务 |
| `ccweb.pid` | 主进程 PID | |
| `projects.json` | 项目注册表 | |
| `plugin-registry.json` + `plugins/` + `plugin-data/` | ccweb 自己的插件（非 Claude Code plugins） | |
| `backup-config.json` | Google Drive/OneDrive/Dropbox OAuth token | v-backup 旧子系统 |
| `sync-config/<sha1(user)>.json` | per-user rsync 配置，密码 AES-256-GCM 加密（label `sync`） | v-t 引入 |
| `hub-auth/<sha1(user)>.json` | per-user GitHub PAT 加密（label `hub`，crypto-at-rest） | v-v 引入 |
| `sync-ssh/<sha1(user)>.sh` | 每用户生成的 SSH wrapper（mode 0700） | rsync 通过 -e 调用 |
| `sync-logs/<sha1(user)>/<projectId>.log` | rsync 日志，>2MB 自动截半 | |

## 项目级（仓库 `.ccweb/`）

| 文件/目录 | 内容 |
|-----|------|
| `project.json` | 项目 ID、name、permissionMode、cliTool |
| `shortcuts.json` | 项目级 Quick Prompts（原 shortcuts） |
| `agent-prompts.json` | 项目级 Agent Prompts |
| `memory/*.md` | v-v 新增 Memory Prompts（外部维护，ccweb 只读） |
| `memory/` 扫描策略 | 只列 `.md` 文件，lstat 过滤 symlink；toggle 插入/移除走 `START <name>` / `END <name>` 标记 |

## 端口

| 端口 | 用途 | 备注 |
|------|-----|------|
| 3001 | ccweb 生产（`ccweb start --local --daemon`）默认 | `CCWEB_PORT` 可覆盖；被占自动 +1；写 `~/.ccweb/port` |
| 3099 | 推荐沙箱测试端口 | 配合 `HOME=/tmp/ccweb-test-$$/home` 不污染生产 |

## Claude Code 相关路径

| 路径 | 内容 |
|------|------|
| `~/.claude/settings.json` | Claude Code 全局设置（含 ccweb 注入的 hooks）。ccweb `PUT /api/tool/model` 会 merge 写 `model` 字段 |
| `~/.claude/commands/*.md` | 用户全局自定义斜杠命令 |
| `~/.claude/skills/<name>/SKILL.md` | 用户全局 skills |
| `~/.claude/plugins/<name>/` | Claude Code 插件；ccweb `/` 面板扫 `<plugin>/.claude-plugin/plugin.json` 的 `name` 作为命名空间 |
| `~/.claude/projects/<encoded-path>/<uuid>.jsonl` | Claude Code 原生会话 JSONL —— ccweb 聊天历史的 ground truth |
| `~/.ssh/known_hosts_ccweb` | rsync SSH wrapper 的独立 known_hosts（不污染用户 `~/.ssh/known_hosts`） |

## 环境变量

| 变量 | 用途 | 默认/位置 |
|------|-----|----------|
| `CCWEB_PORT` | 覆盖默认端口 3001 | 无默认 |
| `CCWEB_DATA_DIR` | 覆盖 `~/.ccweb/` 数据目录 | 默认 `~/.ccweb`（源码开发时 `backend/../data`） |
| `CCWEB_ACCESS_MODE` | `local` / `lan` / `public` | 由 `ccweb start --<mode>` 传入 |
| `ANTHROPIC_MODEL` | Claude Code 的模型覆盖 | 读 `~/.claude/settings.json` 的 `model` 字段更常见 |
| `SSHPASS` | rsync 密码认证用（由 ccweb 进程在 spawn 时注入子进程 env，不在 argv） | 加密密码解密后临时注入 |
| `CCWEB_GITHUB_TOKEN` | 已废弃 —— v-p 前的 SkillHub 服务端 token；现在 hub 用户自持 PAT | 不应再出现 |

## 本机环境 quirks

- 作者使用 nvm 管理 Node，当前 `v23.2.0`。`node-pty` 是原生绑定，**切 Node 版本后必须 `npm rebuild`**。
- Homebrew 装有 `sshpass`（`/opt/homebrew/bin/sshpass`）；**没装 GNU rsync**（只有 openrsync 在 `/usr/bin/rsync`）。如果需要更好的 rsync telemetry，可 `brew install rsync` 装到 `/opt/homebrew/bin/rsync`，ccweb 会自动优先用它。
- `~/.npmrc` 当前 registry 官方（`registry.npmjs.org`）。如切回国内镜像 `npmmirror.com`，ccweb update 路径可能卡住（镜像同步滞后导致新发布版本查不到）。
- 作者是单人项目 owner = admin user。LAN 多用户共享此实例时需注册次级用户。

## 不该入仓的本地文件

`.memory-pool/*`、`.test-sandbox/`、`research/`、`FEEDBACK_TO_HUMAN.md`、`FEEDBACK_TO_LLM.md`、`CLAUDE-example.md` 都是本地私有，git add 必须指定文件防止扫入（pitfalls #13）。
END 配置信息

START 历史教训
<!-- 用途：踩新坑前查是否踩过类似的；改某个模块前若本文件有对应日期条目，必读。项目全面教训在 DETAILS/pitfalls.md 有 33 条详细版，此文件只记录本人从本次协作会话中新学到/反直觉的 -->

# ccweb 历史教训（会话提炼）

项目：`@tom2012/cc-web`（ccweb），自托管 CLI 包装 UI。完整历史教训看仓库内 `DETAILS/pitfalls.md`（33 条）——本文件补充最近会话新增的反直觉教训。

## [2026-04-19] Slash 命令不 echo 导致 retry 机制误发 `\r` 搞乱 TUI

- **现象**：用户反馈"输入框顶栏的 /model opus 并不能切换到 opus"。点击后模型没变。
- **原因**：ccweb `sendMessage`→`sendWithRetry` 依赖用户 echo 在 JSONL 里匹配 `recentSentRef`。但 **slash 命令被 Claude Code TUI 内部拦截，不写入 JSONL**。`recentSentRef` 永不清，retry 每 3 秒发裸 `\r` 最多 20 次（60 秒）。第一次命中了 `/model opus`，但后续 `\r` 在 TUI 里可能 confirm picker 错误选项 / 中断状态。
- **解法**：slash 命令绕开 retry 走 `onSend` 直发（`onSend(\`/model ${alias}\r\`)`）。同时 `PUT /api/tool/model` 写 `~/.claude/settings.json` 做双保险。
- **预防**：**凡"不会回 user echo"的发送路径，都不走 retry 管线**。代码注释在 `ChatOverlay.handleModelSelect` 明确警告。
- **适用范围**：Claude Code CLI 任何版本（slash 命令 JSONL 不 echo 是设计）。其他 CLI 需单独验证。

## [2026-04-19] macOS 15+ `/usr/bin/rsync` 是 openrsync 不支持 `--stats`

- **现象**：用户配完 rsync server 点"同步"直接报错，log 目录都没创建。
- **原因**：macOS 15 换 GNU rsync 为 **openrsync**（BSD 重写，`protocol version 29`）。`--stats` / `-a` 子选项等 GNU 扩展不兼容；spawn 立刻失败。preflight 还额外加了 `missing-key-path` 误挡（empty keyPath 其实合法 = 用默认 agent/keys）。
- **解法**：`-az --stats` → `-avzi`（itemize 两家都支持）。`detectRsyncBin()` 启动探测 `/opt/homebrew/bin/rsync`（GNU）→ `/usr/local/bin/rsync` → `/usr/bin/rsync`（openrsync）优先级挑。删 `missing-key-path` preflight。
- **预防**：**macOS 项目默认发行到 `/usr/bin` 的工具版本与 Linux 或 Homebrew 的不同**，涉及外部命令前 `--version` 探测，不假设 flag 兼容。
- **适用范围**：只要项目要在 macOS 15+ 本机跑 rsync/其他被 Apple 替换的 GNU 工具（将来 tar/awk/sed 也可能被换）。

## [2026-04-19] path prefix 判断必须带分隔符

- **现象**：`@` 文件引用计算相对路径时 `absPath.startsWith(root)` 匹配了 sibling 目录。
- **原因**：`root = "/foo"` 时 `"/foo-other/bar".startsWith("/foo")` 返 true，切片得 `-other/bar`。经典边界 bug。
- **解法**：改 `root === absPath || absPath.startsWith(root + '/') || absPath.startsWith(root + '\\')`。跨平台同时处理 POSIX 和 Windows 分隔符。
- **预防**：**任何路径前缀比较一律带分隔符**。JS 标准库没内置 `path.isSubpathOf`，每次手写要警觉。同类 `FilePickerPanel.canGoUp` 也被同一 bug 命中，一并修。
- **适用范围**：任何处理绝对/相对路径转换的代码。

## [2026-04-19] 本地缓存 + 跨端一致状态：服务端 fetch 会 clobber 用户的本地编辑

- **现象**：`useProjectOrder` hook mount 时 fetch 服务端 order，用户在 50-500ms 窗口拖动一次项目，fetch 返回后 `setOrder(serverOrder)` 覆盖。
- **原因**：并发模型假设"服务端数据到达就用"，忽略用户在 window 内也能改状态。
- **解法**：`hasLocalEditRef` 标志；用户一旦 commit 过本地改动，mount fetch 的响应忽略 server 值。另外 drag rapid-fire 用 debounce + `pendingRef` 避免连续 PUT 丢失最后一次。
- **预防**：**任何"mount 时 fetch + 用户本地可改"的组合**都要有"用户改过则忽略晚到 fetch"的守卫。不是 React 专属 pitfall，所有 SPA 都有。
- **适用范围**：SPA 双向同步的 hook（useSyncWithServer 类模式）。

## [2026-04-19] noContextMenu 卡片右键弹浏览器原生菜单

- **现象**：Memory Prompts 卡片右键时弹出 "View Source" / "Inspect Element" 等浏览器默认菜单，与 Quick/Agent 卡片右键弹应用菜单不一致。
- **原因**：`PromptCard` 的 `noContextMenu=true` 跳过 Radix `ContextMenu` 包裹，但没 `preventDefault` contextmenu 事件。
- **解法**：卡片外层 `<div onContextMenu={(e) => e.preventDefault()}>`。
- **预防**：**跳过自定义右键菜单 ≠ 允许浏览器菜单**。如果设计上右键不是 affordance，要显式 `preventDefault`。
- **适用范围**：React 里决定不实现 context menu 的交互控件。

## [2026-04-19] `settings.json` 非对象会被 JSON.parse + 赋属性搞崩

- **现象**：`PUT /api/tool/model` 若用户误把 `~/.claude/settings.json` 存成数组或字符串，代码 `settings.model = raw; JSON.stringify(settings)` 产生非法配置。
- **原因**：JS 允许给数组设命名属性，`JSON.stringify([]) === '[]'` 但 `JSON.stringify(Object.assign([], {model:'opus'})) === '[]'`（吞了 named prop）或者对 string 类型赋 `.model` 直接丢值。
- **解法**：`if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { res.status(500).json(...); return; }`。不静默 fallback 到 `{}` 覆盖用户文件。
- **预防**：**读外部文件 merge 回去前，一定检查类型是 plain object**。`typeof === 'object'` 不够，要额外排数组/null。
- **适用范围**：所有 "read → merge → write" 配置文件流。

## [2026-04-19] GitHub Issue title 换行静默截断

- **现象**：POST /api/skillhub/submit 的 `label` 含换行被 GitHub 当成只到换行前的部分。
- **原因**：GitHub Issues API 对 `title` 字段的 `\n` 会截断，不报错。
- **解法**：Backend 明确拒绝 `/[\r\n]/`，长度 ≤ 200 字符。描述/作者同类限制（`description` 单行 ≤ 300，`author` 单 token 无空白 ≤ 64）。
- **预防**：**第三方 API 对"不合法"输入往往 silent truncate/drop 而非 400**。本地校验比依赖对方更可靠。
- **适用范围**：所有第三方 REST API 提交。

## [2026-04-19] 加密存储分子系统时要把 label 作为 KDF 输入

- **现象**：要把 hub PAT 加密存到 `~/.ccweb/hub-auth/`，又不想和已有 rsync password（`~/.ccweb/sync-config/` 内的 `passwordEnc`）共享同一 key。
- **原因**：如果两个子系统用同一 KDF（`SHA-256(jwtSecret)`），一边的 bug 可能解密另一边。defense in depth。
- **解法**：`crypto-at-rest.ts` 把 `label` 作为参数：`SHA-256("ccweb-<label>:" + jwtSecret)`。sync 用 `'sync'`，hub 用 `'hub'`。同时保留 fingerprint 机制，jwtSecret 轮换时 UI 提示 "需重新输入"。
- **预防**：**多个"各自独立的秘密存储"不要共享一把派生 key**。label 参数化是最低成本的命名空间化。
- **适用范围**：任何新增"按用户加密存储某种凭据"的场景。

## 已归档

（目前没有失效的条目。新坑增加且某条件不再成立时移到这里或直接删除。）
END 历史教训

START TODO
<!-- 用途：会话开始时查当前任务状态；完成 TODO 后把完成项移到"最近已完成"并写日期；归档已超 2 周的项。项目全量历史规划看仓库根的 TODO.md（较旧未同步）和 git log -->

# ccweb TODO（会话维护版）

项目：`@tom2012/cc-web`。当前版本 v2026.4.19-v（2026-04-19 发布，npm latest）。仓库根的 `TODO.md` 记录更早的历史阶段规划，此文件聚焦近期会话的任务流。

## 进行中

无明确进行中大任务。

## 待启动

- [ ] [P1] view-only 共享用户权限 gate：Quick/Agent/Memory Prompts 的 `+` 按钮和卡片右键 Edit/Delete 当前对 `project._sharedPermission === 'view'` 的用户仍可见，点击时后端返 403。UX 应该在前端隐藏或 disable。预计改动：panel 接收 `canEdit` prop（从 ProjectPage → RightPanel 传），`+` 按钮和 ContextMenu Edit/Delete 条目相应隐藏/禁用。（独立 review 在 2026-04-19 v-v 提出 P1-4，标记为"未修，需跨组件 plumb"）

- [ ] [P2] CCWeb Hub 浏览页已导入状态不更新：用户删除全局 shortcut/prompt 后再打开 Hub 浏览页，被删的条目仍显示"已导入"（因为 `importedIds` 是 mount 时一次性基于当时的 getGlobalShortcuts/getGlobalPrompts 计算）。低频不紧急。

- [ ] [P2] 侧边栏暗色模式对比度：`bg-muted/40` 外层 vs `bg-background` 内容区在暗色主题下差别很小，浅色好点但也勉强。值得在亮/暗两个主题分别实测后决定是否加 `shadow-inner` 或换 `bg-muted/70`。

- [ ] [P2] Memory toggle 与用户手改 CLAUDE.md 的 race：toggle 请求发出后用户立刻手改文件，toggle 完成时 `writeClaudeMd` 覆盖。Agent Prompts 有同样风险。方案：读 CLAUDE.md 时记 mtime，写回前 re-stat 比对。小概率，可暂不修。

- [ ] [P2] Memory body 禁用 `START <name>` / `END <name>` 单独成行——目前未校验，用户创建此类文件会导致插入后无法正确 remove。文档化或 insert 前验证。

- [ ] [P2] `usedShortcuts` 僵尸 id 已修项目级（delete 时同步清 localStorage），但全局 shortcut 删除不走 ShortcutPanel 的 delete handler（Dashboard 的 GlobalShortcutsSection 管），若从 Dashboard 删除不会清前端的 `usedShortcuts`。低影响，略过。

- [ ] [P2] Radix ContextMenu 键盘导航：`orientation="vertical"` 在 Radix Tabs 里使 Left/Right 方向键不切 tab（只响应 Up/Down）。桌面键盘用户可能 confuse。

## 阻塞中

无。

## 最近已完成（保留最近 2 周）

- [x] 2026-04-19 v2026.4.19-v 发布 — 全部 27 文件改动推到 GitHub + npm publish `latest` tag
- [x] 2026-04-19 Memory Prompts 子系统 — 新增 `memory-prompts.ts` 模块 + routes + `MemoryPromptsPanel.tsx`，.ccweb/memory/*.md 实时加载，START/END bare-text 标记，symlink 防护
- [x] 2026-04-19 Hub 一键直接提交 — per-user GitHub PAT 加密存储 (`crypto-at-rest.ts` 共用 AES helper, `hub-auth.ts`)，Settings 加 "CCWeb Hub" tab，SharePromptDialog 改一键提交（token 未配置时深链到 Settings）
- [x] 2026-04-19 富 tool_use 渲染 — AssistantMessageContent 新 `BlockView`: TodoWrite checklist / Bash 终端卡 / Edit 文件预览 / Read-Grep-Glob 单行 / tool_result 折叠；backend 加 `tool`/`input`/`output` 字段，`capStrings` 4KB cap
- [x] 2026-04-19 `/model opus` 切换修复 — 直发 `onSend` 绕开 retry；同时 PUT /api/tool/model 写 settings.json
- [x] 2026-04-19 Quick/Agent/Memory 三 Panel 布局统一 — UPPERCASE 标题 + 描述；项目在上全局在下；每 section 独立 `+` 按钮；全局 Quick Prompts 支持 edit/delete（parentId 保留）
- [x] 2026-04-19 气泡折叠只剩 chevron — 移除 "折叠" 文字（保留 aria-label）
- [x] 2026-04-19 用户气泡可折叠 — AssistantMessageContent `plain` prop + discriminated union + latestUserId
- [x] 2026-04-19 侧边栏灰色背景 — LeftPanel/RightPanel `bg-muted/40`，tab rail `bg-muted/60`
- [x] 2026-04-19 Quick Prompts unclicked 浅蓝 — localStorage `cc_used_shortcuts_<projectId>` 跟踪
- [x] 2026-04-19 `/` 面板加 `plugins` tab — 扫描 `~/.claude/plugins/*/`，`.claude-plugin/plugin.json` name 白名单 + symlink 过滤
- [x] 2026-04-19 `@` 文件选择器 + fill-not-send — 斜杠命令 / @ 文件引用自动填充到输入框而非直接发送
- [x] 2026-04-19 v2026.4.19-u 发布
- [x] 2026-04-19 v2026.4.19-t 发布 — rsync 同步子系统、CLAUDE.md 精简

## 已取消 / 已废弃

- [~] 2026-04-19 气泡头像（用户名/模型名） — 用户试用后觉得不需要，移除
- [~] 早期（已在 v-s 完成）计划控制子系统 — 用户决定移除 plan-control，代码和相关 WS 事件全部删除
END TODO
