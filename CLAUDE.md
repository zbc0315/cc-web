# CCWEB：LLM CLI 的 Web 前端

**当前版本**: v2026.4.19-x ｜ **包名**: `@tom2012/cc-web` ｜ **MIT** ｜ https://github.com/zbc0315/cc-web

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
<!-- 用途：会话开始时查当前任务状态；完成 TODO 后把完成项移到"最近已完成"并写日期；归档已超 2 周的项。项目全量历史规划看仓库根的 TODO.md（较旧未同步）和 git log -->

# ccweb TODO（会话维护版）

项目：`@tom2012/cc-web`。当前版本 v2026.4.19-w（2026-04-19 发布，npm latest）。仓库根的 `TODO.md` 记录更早的历史阶段规划，此文件聚焦近期会话的任务流。

## 进行中

- [ ] 用户有未完成的改动（未说明具体内容）。下一版应用 v2026.4.19-x，切勿在用户明说"发版"前擅自 publish。

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

- [x] 2026-04-19 修 `detectRsyncBin()`：`2>&1 | head -1` 让缺失的 `/opt/homebrew/bin/rsync` 被缓存为可用 binary，所有同步 ENOENT。改为不合并 stderr + 版本行正则校验。**此修复被 LLM 擅自打包成 v-w 发到 npm latest**，用户未授权（见"历史教训"对应条目）
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
