# CCWEB：LLM CLI 的 Web 前端

**当前版本**: v1.5.123
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
- **前端页面**: Dashboard / Project / Settings / Login / ShareView / SkillHub

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
| `mammoth` | Office 文件预览 |
| `xlsx` | 电子表格解析 |
| `matter-js` | 记忆池气泡物理可视化（已停用） |
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
| 信息系统 | 活跃 | `information/`, `routes/information.ts` | JSONL 对话同步 + 迭代缩减 + 重整 |
| 监控大屏 | 活跃 | `MonitorDashboard.tsx`, `MonitorPane.tsx` | 全屏网格、实时聊天、拖拽排序 |
| 上下文监控 | 活跃 | `hooks-manager.ts` → 前端进度条 | status line → context_update 推送 |
| 计划控制 | 活跃 | `plan-control/`, `routes/plan-control.ts` | .plan-control/ 任务树解析与执行 |
| 云备份 | 活跃 | `backup/`, `routes/backup.ts` | Google Drive / OneDrive / Dropbox |
| 插件系统 | 活跃 | `plugin-manager.ts`, `routes/plugins.ts` | manifest.json + 前后端隔离 |
| SkillHub | 活跃 | `routes/skillhub.ts`, `SkillHubPage.tsx` | GitHub-based 快捷键分享 |
| 对话分享 | 活跃 | `routes/share.ts`, `ShareViewPage.tsx` | 公开对话分享链接 |
| 通知 | 活跃 | `notify-service.ts`, `routes/notify.ts` | 通知配置与推送 |
| 记忆池 | 已停用 | `memory-pool/`, `routes/memory-pool.ts` | 浮力排序知识球，前端 tab 已 disabled |

## 版本发布流程

**四个文件**必须同步更新版本号：
1. `package.json` → `"version"`
2. `frontend/src/components/UpdateButton.tsx` → `currentVersion`
3. `README.md` → version 行
4. `CLAUDE.md` → `**当前版本**` 行

发布命令：
```bash
npm run build
git add <具体文件> && git commit && git push
npm publish --registry https://registry.npmjs.org --access=public --//registry.npmjs.org/:_authToken=<token>
```

**绝不把 token 写入 git 追踪的文件。** Token 通过命令行参数传入。

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
├── .memory-pool/         # 记忆池（已停用）
├── .plan-control/        # 计划控制
└── .information/         # 信息系统对话
```

## 本机环境注意事项

- `~/.npmrc` 设置了 `omit=dev`，所有 `npm install` 必须加 `--include=dev`
- 不要 kill 非本次会话启动的进程
- ccweb 默认端口 3001，端口被占用时自动 +1
- `node-pty` 是原生绑定，切换 Node 版本后需要 `npm rebuild`

## 历史错误记录（防止重犯）

1. **信息系统 v1 用 ccweb session ID 作为对话标识**：错误。应该用 JSONL 文件名（Claude Code 的对话 UUID）。
2. **迭代缩减设计了但没实现**：写了详细方案和伪代码，编码时只写了单次 Haiku 调用 + 截取末尾。Performative Compliance。
3. **缩减 prompt 过于保守**：告诉 Haiku "如果行为会不同就保留"导致什么都不删。应该明确列出要删的内容类型。
4. **QUICK-REF.md 模板 projectId 写错**：写成 URL 编码路径，实际是 UUID。导致 GLOSS 项目 AI 调用失败。
5. **活动检测用客户端时钟比较**：`Date.now() - lastActivityAt < 2000` 在局域网有时钟偏差。改为服务端 `active` 布尔字段。
6. **每次"反思"只找 1-2 个问题**：应该系统性对照设计文档逐项检查。
7. **新增适配器后遗漏路由验证数组**：`projects.ts` 的 `VALID_CLI_TOOLS` 未同步添加 `'gemini'`，导致创建项目 400。新增 CLI 工具时须检查所有硬编码工具列表。
