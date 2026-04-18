# CCWEB：LLM CLI 的 Web 前端

**当前版本**: v2026.4.19-n
**包名**: `@tom2012/cc-web`
**许可证**: MIT
**仓库**: https://github.com/zbc0315/cc-web

## 项目概述

ccweb 将 Claude Code / Codex / OpenCode / Qwen / Gemini 等 CLI 工具包装为浏览器可访问的界面。
核心链路：Browser → Express + WebSocket → TerminalManager → node-pty → CLI 进程。
支持多项目管理、局域网访问、多用户、实时状态监控。

## 关键架构

```
Browser (React SPA)
  │
  ├─ HTTP REST ──→ Express (backend/src/routes/)
  │                  ├─ auth.ts          认证
  │                  ├─ projects.ts      项目 CRUD
  │                  ├─ filesystem.ts    文件操作
  │                  ├─ git.ts           Git 操作
  │                  ├─ information.ts   对话管理
  │                  ├─ plan-control.ts  计划执行
  │                  ├─ backup.ts        云备份
  │                  ├─ plugins.ts       插件管理
  │                  ├─ skillhub.ts      SkillHub 快捷键分享
  │                  ├─ share.ts         对话分享
  │                  ├─ shortcuts.ts     快捷键
  │                  ├─ hooks.ts         Hooks 管理
  │                  ├─ notify.ts        通知
  │                  └─ update.ts        自动更新
  │
  └─ WebSocket ──→ ws 服务
       ├─ /ws/dashboard          首页活动推送
       └─ /ws/projects/:id       终端 + 聊天 + 计划
              │
              └──→ TerminalManager → node-pty → CLI 进程
                      │
                      └──→ 适配器 (backend/src/adapters/)
                             claude / codex / opencode / qwen / gemini
```

- **后端**: Express + WebSocket (ws) + node-pty，TypeScript 编译到 `backend/dist/`
- **前端**: React 18 + Vite + Tailwind + shadcn/ui (Radix) + Motion (Framer Motion)
- **状态管理**: zustand (`frontend/src/lib/stores.ts`)
- **适配器模式**: `backend/src/adapters/` — 每种 CLI 工具一个适配器
- **数据存储**: `~/.ccweb/` 全局配置 + `{project}/.ccweb/` 项目级
- **认证**: JWT (HS256, 30 天过期)，localhost 预认证，LAN 需 token
- **前端页面**: Dashboard / Project / Settings / Login / ShareView / SkillHub / Mobile

## 服务器信息

- **默认端口**: 3001（env: `CCWEB_PORT`），端口被占用时自动 +1
- **端口文件**: `~/.ccweb/port`（hooks 脚本固定读取此文件）
- **访问模式**: `local`（127.0.0.1）/ `lan`（私有 IP）/ `public`（任意）
- **前端 SPA**: 生产模式由 Express 托管 `frontend/dist/`，fallback 到 `index.html`
- **启动命令**: `npx ccweb`（生产）或 `npm run dev:backend` + `npm run dev:frontend`（开发）
- **构建命令**: `npm run build`（先 frontend 后 backend）

## 重要依赖

### 后端 (`backend/package.json`)

| 依赖 | 用途 |
|------|------|
| `node-pty` | 终端进程管理（原生绑定，安装时编译） |
| `ws` | WebSocket 服务 |
| `express` / `cors` | HTTP 框架 |
| `simple-git` | Git 操作 |
| `bcryptjs` / `jsonwebtoken` | 认证 |
| `multer` | 文件上传 |
| `uuid` | ID 生成 |
| `minimatch` | Glob 匹配 |
| `adm-zip` | 压缩包操作 |
| `googleapis` / `@azure/msal-node` / `dropbox` | 云备份 OAuth |

### 前端 (`frontend/package.json`)

| 依赖 | 用途 |
|------|------|
| `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-search` | 终端渲染 |
| `react` / `react-dom` / `react-router-dom` | SPA 框架 |
| `zustand` | 全局状态管理 |
| `@radix-ui/*` | shadcn/ui 底层组件 |
| `motion` | 动画（Framer Motion） |
| `sonner` | Toast 通知 |
| `react-markdown` + `remark-gfm` + `react-syntax-highlighter` | Markdown 渲染 |
| `remark-math` + `rehype-katex` | 数学公式渲染（KaTeX，文件预览用） |
| `mammoth` | Office 文件预览 |
| `xlsx` | 电子表格解析 |
| `jszip` | 压缩包操作 |
| `dompurify` | HTML 净化 |
| `js-yaml` | YAML 解析 |

## 子系统概览

详细文档见 `DETAILS/` 目录。

| 子系统 | 状态 | 关键文件 | 说明 |
|--------|------|----------|------|
| 认证系统 | 活跃 | `routes/auth.ts`, `auth.ts` | JWT、localhost 预认证、多用户 |
| 终端管理 | 活跃 | `terminal-manager.ts`, `session-manager.ts` | node-pty 进程、WebSocket 推送 |
| 文件系统 | 活跃 | `routes/filesystem.ts` | 浏览、上传、下载、创建文件夹、删除 |
| 信息系统 | 活跃 | `information/`, `routes/information.ts` | JSONL 对话同步 + 只读 API（历史加载用） |
| 监控大屏 | 活跃 | `MonitorDashboard.tsx`, `MonitorPane.tsx` | 全屏网格、实时聊天、拖拽排序 |
| 上下文监控 | 活跃 | `hooks-manager.ts` → 前端进度条 | status line → context_update 推送 |
| 计划控制 | 活跃 | `plan-control/`, `routes/plan-control.ts` | .plan-control/ 任务树解析与执行 |
| 云备份 | 活跃 | `backup/`, `routes/backup.ts` | Google Drive / OneDrive / Dropbox |
| 插件系统 | 活跃 | `plugin-manager.ts`, `routes/plugins.ts` | manifest.json + 前后端隔离 |
| SkillHub | 活跃 | `routes/skillhub.ts`, `SkillHubPage.tsx` | GitHub-based 快捷键分享 |
| 对话分享 | 活跃 | `routes/share.ts`, `ShareViewPage.tsx` | 公开对话分享链接 |
| 通知 | 活跃 | `notify-service.ts`, `routes/notify.ts` | 通知配置与推送 |
| 手机界面 | 活跃 | `MobilePage.tsx`, `components/mobile/` | 项目列表、聊天、侧边面板、文件浏览 |
| 桌面对话框 | 活跃 | `ChatOverlay.tsx`, `AssistantMessageContent.tsx` | 终端区半透明遮罩 + 气泡折叠/展开 + 输入区贴底 |
| 权限审批 | 活跃 | `approval-manager.ts`, `routes/approval.ts`, `bin/ccweb-approval-hook.js`, `ApprovalCard.tsx` | Claude Code `PermissionRequest` hook 桥接到遮罩卡片 |
| 远程自更新 | 活跃 | `routes/update.ts`, `UpdateButton.tsx` | 浏览器触发 npm install + detached agent 重启 |

## 版本发布流程

**四个文件**必须同步更新版本号：
1. `package.json` → `"version"`
2. `frontend/src/components/UpdateButton.tsx` → `currentVersion`
3. `README.md` → version 行
4. `CLAUDE.md` → `**当前版本**` 行

**版本号方案（日期驱动 + semver 兼容）**：
- 当日首次发布：`YYYY.M.D`（如 `2026.4.17`）—— bare 版本匹配真实日期
- 当日多次发布：`YYYY.M.(D+1)-a`、`-b`、`-c` …（pre-release 标签）
  - 规则：bare `YYYY.M.(D+1)` 只在真实到达该日期时发布
  - 例：4/17 已发 `2026.4.17`，当日第 2 次发布 `2026.4.18-a`，第 3 次 `2026.4.18-b`，直到 4/18 真实日期才能发 bare `2026.4.18`
- 发布 pre-release 到默认 tag：`npm publish --tag latest`（否则不进入 `latest`）

**绝对规则**：
- 发布前先查当前真实日期（`date` 命令或系统提示），不得凭印象跳日期
- `git add` 必须指定具体文件，**禁止用 `git add -A` / `git add .`**（会扫入本地私有文件）
- **绝不把 token 写入 git 追踪的文件** —— 通过命令行参数传入

发布命令：
```bash
npm run build
git add <具体文件列表> && git commit && git push
npm publish --registry=https://registry.npmjs.org --access=public --tag latest --//registry.npmjs.org/:_authToken=<token>
```

**不该进仓库的本地文件**：`.memory-pool/*`、`research/*`、`CLAUDE-example.md`、`FEEDBACK_*.md` —— 均为本地私有，发布时必须 untracked 保持。

## 数据存储布局

```
~/.ccweb/
├── config.json           # 管理员用户、JWT secret、密码 hash
├── users.json            # 注册的次级用户
├── projects.json         # 项目注册表
├── port                  # 当前服务端口
├── global-shortcuts.json
├── notify-config.json
├── backup-config.json
├── plugin-registry.json
├── plugins/              # 已安装插件
└── plugin-data/

{project}/
├── .ccweb/
│   ├── project.json      # ID, name, permissionMode, cliTool
│   ├── shortcuts.json
│   └── sessions/         # 对话存档
├── .plan-control/        # 计划控制
└── .information/         # 信息系统对话
```

## 本机环境注意事项

- `~/.npmrc` 设置了 `omit=dev`，所有 `npm install` 必须加 `--include=dev`
- `~/.npmrc` 的 `registry` 当前为 `https://registry.npmjs.org`（官方），2026-04-18 从 `npmmirror.com` 切回；切换备份在 `~/.npmrc.bak`。如遇国内网络问题再切回
- 不要 kill 非本次会话启动的进程
- ccweb 默认端口 3001，端口被占用时自动 +1
- `node-pty` 是原生绑定，切换 Node 版本后需要 `npm rebuild`
- 手动 `npm install -g` 升级 ccweb 后**不会自动重启运行中的 node 进程**，UpdateButton 会误报"已是最新"；需要 `ccweb stop && ccweb start --<mode> --daemon` + 浏览器硬刷（详见 `DETAILS/remote-update.md`）

## 历史错误记录（防止重犯）

1. **信息系统 v1 用 ccweb session ID 作为对话标识**：错误。应该用 JSONL 文件名（Claude Code 的对话 UUID）。
2. **迭代缩减设计了但没实现**：写了详细方案和伪代码，编码时只写了单次 Haiku 调用 + 截取末尾。Performative Compliance。
3. **缩减 prompt 过于保守**：告诉 Haiku "如果行为会不同就保留"导致什么都不删。应该明确列出要删的内容类型。
4. **QUICK-REF.md 模板 projectId 写错**：写成 URL 编码路径，实际是 UUID。导致 GLOSS 项目 AI 调用失败。
5. **活动检测用客户端时钟比较**：`Date.now() - lastActivityAt < 2000` 在局域网有时钟偏差。改为服务端 `active` 布尔字段。
6. **每次"反思"只找 1-2 个问题**：应该系统性对照设计文档逐项检查。
7. **新增适配器后遗漏路由验证数组**：`projects.ts` 的 `VALID_CLI_TOOLS` 未同步添加 `'gemini'`，导致创建项目 400。新增 CLI 工具时须检查所有硬编码工具列表。
8. **WebSocket sendInput 静默丢弃消息**：`wsRef.current?.readyState === WebSocket.OPEN` 不满足时直接 return，无队列、无反馈。导致手机端消息间歇性发不出。必须用消息队列 + connected 后 flushQueue。
9. **useEffect cleanup 清空消息队列导致跨重连丢失**：`enabled` 变化时 effect cleanup 清空了 `pendingQueueRef`，但队列中可能有等待发送的消息。队列应仅在组件卸载时清空，不应在重连时清空。
10. **状态机分支遗漏 waking**：`sendToTerminal` 只处理 `live` 和 `stopped/error`，`waking` 状态下发送消息两个分支都不命中，消息仅显示在 UI 但从未发送。所有可发送状态必须有分支覆盖。
11. **Detached 子进程继承坏的 cwd**：远程自更新 agent spawn 时继承主进程的 cwd（可能是已删除的项目目录），导致 `npm`/`npx` 启动时 `process.cwd()` 抛 ENOENT，更新完成但重启失败。**任何 detached 子进程都必须显式指定 `cwd: os.homedir()`**，其内部 `execSync`/`spawnSync` 也要显式 `cwd`。
12. **Stop hook 触发时 JSONL 未完全 flush**：Claude Code 写完最后一条文本到 JSONL 前就触发 Stop hook，`triggerRead` 立即执行读到不完整内容。必须在 Stop hook 中做延时重读（300ms / 1500ms），等文件系统 flush 完成。
13. **`git add -A` 扫入本地私有文件**：`research/`、`.memory-pool/balls/*`、`FEEDBACK_*` 等本地文件被意外提交到公开仓库。必须严格用 `git add <具体文件列表>`。
14. **版本号跳日期绕 semver**：日期版本方案下遇到同日多次发布，semver 要求版本递增。误判 `2026.4.19-a` 不能用而跳到 bare `2026.4.19`，导致版本号领先真实日期。正确做法：bare 只在真实日期到达时发，同日后续用 pre-release `-a/-b/-c`。
15. **CDN 解析本地 npm registry mirror**：`~/.npmrc` 曾设为 `registry=https://registry.npmmirror.com`（国内镜像），新发布若镜像未同步会导致 `npm install -g @tom2012/cc-web@latest` 报 `ETARGET No matching version`，远程自更新也受影响。**2026-04-18 起已切回 `https://registry.npmjs.org`**（官方），`~/.npmrc.bak` 保留切换前的镜像配置。发版验证始终直查 `curl -s https://registry.npmjs.org/@tom2012/cc-web`，不要信 `npm view`（会经过本地 npmrc 配置）。
16. **手机 WS 不在 projectClients 集合里**：`chat_subscribe` 分支（手机/监控）没把 ws 加入 `projectClients`，只有 `terminal_subscribe`（桌面终端）才加。结果手机端接收不到 `context_update` 广播、初始上下文快照、以及 `approval_request` 事件。修复：`chat_subscribe` 分支也要 `projectClients.get().add(ws)` 并推一次初始 `context_update`。
17. **Claude Code hook `PermissionRequest` 输出格式易错**：正确格式是 `{hookSpecificOutput:{hookEventName:'PermissionRequest',decision:{behavior:'allow'|'deny'},message?}}`。常见误区：把 `message` 放进 `decision` 里（错）；用 `behavior: 'defer'`（`PreToolUse` 才有，`PermissionRequest` 没有）。非 ccweb 项目/ccweb 未运行时应输出空 `{}` 让 Claude 回落到 TUI，不要输出 `deny`（否则用户卸载 ccweb 后所有 Claude 权限请求会被永久拒绝）。
18. **HMAC 签名脆弱：URL-匹配 raw body capture**：`express.json({ verify: req.url === '...' ? save : skip })` 看似高效但只要路由挂载路径变化或代理改写 URL，raw body 就捕获不到，fallback 到 `JSON.stringify(req.body)` 会因 key 顺序/空白差异破坏 HMAC。应对所有 POST 无条件 capture，缺失就 400。
19. **`clearSendRetry` 过度触发**：retry 被任何非空 chat_message 无差别清除。场景：msg1 发完、Stop hook 300/1500ms 延迟重读触发延迟 chat_message，用户刚发 msg2，msg2 的 retry 就被 msg1 的延迟 echo 清掉。修复：仅在自己的 user 回音（匹配 `recentSentRef`）时清 retry。**注意**：最初也保留了 "assistant 响应清 retry" 作为加速路径，但后来发现也会误清 —— Claude 正在流式响应 msg1 的 assistant block 期间，用户发 msg2，msg1 的 assistant 响应到达会把 msg2 的 retry 误清。最终只留 own-echo 匹配作为唯一清除信号。
20. **post-wake flush 无 retry 保护**：桌面 `wsReadyTick` flush、`state === live` 但 queue 非空、手机 stopped→live flush 三条路径都在 Claude TUI bootstrap 未完成时直接发送，Enter 可能被吞，且没 retry 补救。所有 post-wake 首次发送必须 arm retry。
21. **Radix ScrollArea 的 display:table 包裹撑宽子元素**：`<ScrollAreaPrimitive.Viewport>` 会自动注入一层 `<div style="min-width:100%; display:table">`，`display:table` 允许这层随不可断的宽内容（代码块、长 URL、不可断 CJK）拉宽，子元素的 `max-w-[85%]` 实际变成 "stretched-wrapper 的 85%"，视觉上气泡超出 viewport。要用 Tailwind `!important` 覆盖为 block + `w-full`（例如在 `viewportClassName` 传 `[&>div]:!block [&>div]:!w-full`）。
22. **Node 16+ `IncomingMessage` body 读完后 auto-destroy，`req.on('close')` 误触发**：PermissionRequest hook 路由用 `req.on('close')` 去检测 hook 客户端断连以 cancel pending，但对小 POST body，body 读完即触发（而非真的 socket 断）→ pending 几乎立刻被 cancel、前端审批卡片拿不到、hook 立刻收到 deny。修复：改用 `res.on('close')`，仅在 response 真正 end 或 socket 断开时才触发；后检查用 `res.writableEnded || res.destroyed`。
23. **测试 ccweb 若不做 HOME 沙箱会破坏生产**：ccweb 多处硬编码 `~/.ccweb/port`、`~/.claude/settings.json` 等，仅 `CCWEB_DATA_DIR` 不够。启动测试实例会覆盖生产 port 文件 + 移除生产 hooks。安全方案：`HOME=/tmp/ccweb-test-$$/home CCWEB_PORT=3099 node bin/ccweb.js start --local --daemon`，沙箱 HOME 把所有 `os.homedir()` 路径重定向到沙箱。
24. **固定次数 retry 面对慢 TUI 仍会丢消息**：4 × 2.5s 的 retry 链在 Claude TUI 重的 bootstrap / 长 turn 处理期间可能全部被吞。修复：改成**条件驱动**——每 3s 检查一次 `recentSentRef.includes(text)`，没 echo 就继续发 `\r`，echo 了就停；20 次硬 cap 兜底。`appendUserMessage` 新消息也要 `.trim()` 对齐 `handleChatMessage.indexOf(content.trim())`，否则"hello "这种带空格的永远 indexOf miss → 白跑 60s 到 cap。
25. **Claude Code v2.1.114+ PermissionRequest 不再带 `tool_use_id`**：新版 Claude Code 的 hook stdin payload 只有 `session_id / transcript_path / cwd / permission_mode / hook_event_name / tool_name / tool_input / permission_suggestions`，没有 `tool_use_id`。ccweb v-l 的 `bin/ccweb-approval-hook.js` 把 `tool_use_id` 作为必填字段，缺失即 `failClosed` → `decision: deny`，导致**所有 Write/Edit/Bash 被自动拒绝，ApprovalCard 永不弹出**。修复：缺失时用 `sha1(session_id + '|' + tool_name + '|' + JSON.stringify(tool_input))` 合成一个确定性 id（同一次调用重试幂等；不同调用 id 不同）。发版前必须用浏览器实测一次 Write 审批路径，hook 形如黑盒不验证就发等于盲飞。
26. **`state='live'` 的同步快照与 WebSocket 的异步就绪不对齐**：ChatOverlay 挂载时从 `project.status === 'running'` 同步推断 `state='live'`，但 `useProjectWebSocket` 的 WS 还在 CONNECTING（50-500ms）。用户秒点发送 → `rawSend` 的 `readyState === OPEN` 检查失败 → **静默丢弃**。原先 `wsReadyTick` 在"ever connected"语义下够用，但**不能反映当前是否可用**（后端 `terminalManager.stopProject` 不关 WS → 无 reconnect → tick 不涨 → `stopped → waking → live` 流的队列永远不 flush）。正解：`useProjectWebSocket` 补 `onDisconnected` 回调，parent 维护 `wsConnected: boolean`（连 true / 断 false）；flush effect 依赖 `[wsConnected, state]`，`wsConnected && state === 'live' && queue 非空` 三者同时成立才 drain，单一 effect 覆盖 (a) 初挂 CONNECTING 期入队、(b) 会话中 WS 抖动重连、(c) stopped→waking→live 三场景。教训：**凡"同步推断的 ready 状态"配合"异步就绪的底层通道"，发送路径都必须走队列 + 用底层通道真实状态（boolean）而非"历史事件计数"（tick）做 gate**。
