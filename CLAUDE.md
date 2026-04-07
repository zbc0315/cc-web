# CCWEB：提升 Claude Code, Codex, OpenCode 等 LLM CLI 使用便捷度的工具

**当前版本**: v1.5.117
**包名**: `@tom2012/cc-web`
**许可证**: MIT

## 项目概述

ccweb 是一个 Web 前端，将 Claude Code / Codex / OpenCode 等 CLI 工具包装为浏览器可访问的界面。核心架构：Browser → Express → TerminalManager → node-pty → CLI 进程。支持多项目管理、局域网访问、多用户、实时状态监控。

## 关键架构

- **后端**: Express + WebSocket (ws)，node-pty 管理终端进程
- **前端**: React + Vite + Tailwind + shadcn/ui + Framer Motion
- **适配器模式**: `backend/src/adapters/` 支持 claude / codex / opencode / qwen
- **数据存储**: `~/.ccweb/` 全局 + `.ccweb/` 项目级
- **认证**: JWT，localhost 预认证，LAN 需 token

## 重要依赖

- `node-pty`: 终端进程管理
- `simple-git`: Git 操作
- `xterm.js`: 前端终端渲染
- `matter-js`: 记忆池气泡物理可视化
- `sonner`: Toast 通知

## 子系统

### 记忆池（Memory Pool）— 已停用
`.memory-pool/` 目录，浮力排序的知识球系统。前端 tab 已 disabled。

### 信息系统（Information）— 活跃
`.ccweb/information/` 目录，自动同步 Claude Code JSONL 聊天记录。
- 一个 JSONL 文件 = 一个对话目录（以 JSONL 文件名为 ID）
- v0.md = 原始对话，v1/v2... = 缩减版
- 缩减通过 `claude -p --model haiku` 调用
- 连续 assistant blocks 自动合并为一个轮次
- 新轮次追加到所有版本（v0/v1/v2），轮次 ID 重映射
- API: `GET/DELETE /api/information/{projectId}/conversations`，`POST /condense`，`POST /reorganize`，`POST /sync`

### 监控大屏（Monitor Dashboard）
首页工具栏切换，全屏网格布局，每个项目一个小窗口。
- Running 项目：WebSocket chat_subscribe 实时显示
- Stopped 项目：从信息 API 加载历史，输入后自动唤醒
- 活跃项目边框显示 card-active-glow 渐变动画
- 项目窗口支持拖拽排序（HTML5 DnD），顺序持久化到 localStorage

### 上下文窗口监控
通过 Claude Code status line 机制，将上下文使用量推送到 ccweb。
- HooksManager 自动配置 statusLine（jq + curl）
- 项目详情页底部状态栏显示进度条（绿/黄/红），紧挨 LLM 用量模块左侧

## 版本发布流程

**三个文件**必须同步更新版本号（CLAUDE.md 已无版本号行）：
1. `package.json` → `"version"`
2. `frontend/src/components/UpdateButton.tsx` → `currentVersion`
3. `README.md` → version badge

发布命令：
```
npm run build
git add <具体文件> && git commit && git push
npm publish --registry https://registry.npmjs.org --access=public --//registry.npmjs.org/:_authToken=<token>
```

**绝不把 token 写入 git 追踪的文件。**

## 本机环境注意事项

- `~/.npmrc` 设置了 `omit=dev`，所有 `npm install` 必须加 `--include=dev`
- 不要 kill 非本次会话启动的进程
- ccweb 默认端口 3001，自动搜索可用端口（tryListen +1）

## 历史错误记录（防止重犯）

1. **信息系统 v1 用 ccweb session ID 作为对话标识**：错误。应该用 JSONL 文件名（Claude Code 的对话 UUID）
2. **迭代缩减设计了但没实现**：写了详细方案和伪代码，编码时只写了单次 Haiku 调用 + 截取末尾。Performative Compliance。
3. **缩减 prompt 过于保守**：告诉 Haiku "如果行为会不同就保留"导致什么都不删。应该明确列出要删的内容类型。
4. **QUICK-REF.md 模板 projectId 写错**：写成 URL 编码路径，实际是 UUID。导致 GLOSS 项目 AI 调用失败。
5. **活动检测用客户端时钟比较**：`Date.now() - lastActivityAt < 2000` 在局域网有时钟偏差。改为服务端 `active` 布尔字段。
6. **每次"反思"只找 1-2 个问题**：应该系统性对照设计文档逐项检查。
