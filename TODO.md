# TODO — ccweb 任务计划

## 已完成 ✅

### v1.5.94–v1.5.101：记忆池 & 浮力可视化 & 模板修复
- ✅ withPoolLock 全覆盖（8 处路由）、Stop hook tickPool 加锁、buildSurface 跳过 ghost 球
- ✅ POST /balls 验证 links 存在性、readPool JSON 解析失败记录日志
- ✅ buildSurface break→continue（贪心背包）、前端 BubbleDialog 真实流体物理模型
- ✅ 按浮力降序逐个生成气泡（100ms 间隔）
- ✅ QUICK-REF.md projectId 改为 UUID（修复 GLOSS 项目 Bug）
- ✅ 语音输入 onerror 增加 toast 提示

### v1.5.102–v1.5.116：信息系统
- ✅ P0：对话同步（JSONL → v0.md + meta.json）+ 读取 API（list, read, delete）
- ✅ P0：Stop hook 集成 + 启动时补偿扫描 + 5 分钟定时扫描
- ✅ P0：前端侧边栏"信息"标签页
- ✅ P1：缩减模块（迭代滑动窗口 + Haiku 调用）+ 重整模块（展开数据 + 高关注轮次保护）
- ✅ P1：缩减/重整按钮 + 进度条 + 错误 toast
- ✅ Codex 适配器（JSONL 解析 + getSessionFilesForProject）
- ✅ 连续 assistant blocks 合并 + 新轮次追加 + 轮次 ID 重映射 + 标记重算
- ✅ 强制重建 v0（sync?force=true，右键同步按钮）
- ✅ 激进缩减 prompt（列出 6 类必须缩减的内容）

### v1.5.103–v1.5.117：监控大屏 & 其他
- ✅ MonitorDashboard + MonitorPane 组件、Stopped 项目从信息 API 加载历史
- ✅ 自动唤醒（输入后 PATCH /start + WS）、状态机 STOPPED→WAKING→LIVE→ERROR
- ✅ 轻量 useMonitorWebSocket hook、活跃项目 card-active-glow 边框
- ✅ 聊天气泡样式（只显示最近 2 轮）、3 秒无消息 fallback 到信息 API
- ✅ Git 提交历史树、项目卡片磁盘体积显示、用量显示 3 个配速
- ✅ 活动检测改为服务端 `active` 字段、全局滚动条统一
- ✅ 记忆池 tab 停用、上下文窗口使用量监控（status line → 进度条）
- ✅ 监控大屏拖拽排序（HTML5 DnD + localStorage 持久化）

### v1.5.118：文件系统增强
- ✅ 文件树右键删除（文件 + 文件夹）
- ✅ 后端 DELETE /api/filesystem 端点
- ✅ 删除前 confirm 确认弹窗

### v1.5.119：文件树右键复制路径
- ✅ 右键菜单新增"复制相对路径"（相对于项目根目录）
- ✅ 右键菜单新增"复制绝对路径"
- ✅ 菜单分隔线分组（复制 / 下载 / 删除）
- ✅ 文档更新（CLAUDE.md 架构图 + DETAILS/ 模块文档）

### v1.5.120–v1.5.121：Gemini CLI 适配器 + 修复
- ✅ 后端 GeminiAdapter（命令构建、会话读取、hooks、模型列表、slash commands）
- ✅ CliTool 类型扩展（前后端 types.ts）+ 前端新建项目/设置页
- ✅ 适配器接口扩展：`parseSessionFile()` + `getSessionFileExtension()` 支持非 JSONL 工具
- ✅ session-manager：`findJsonl()` 按适配器扩展名查找、`readNewLines()` 整文件 JSON 读取路径
- ✅ conversation-sync：`collectJsonlFiles()` / `compensationSync()` 支持 .json 扩展名
- ✅ hooks-manager：gemini 加入工具列表
- ✅ Gemini hooks 改为 jq stdin/stdout 管线（匹配 Gemini CLI 的 hooks 协议）
- ✅ 明/暗配色适配：COLORFGBG 环境变量 + Gemini `/settings theme` + Codex `/theme` 命令

### v1.5.122：Gemini 项目创建修复
- ✅ `projects.ts` 的 `VALID_CLI_TOOLS` 数组遗漏 `'gemini'`，导致创建 Gemini 项目返回 400

### v1.5.123–v1.5.124：手机界面 + Dashboard/Monitor 修复
- ✅ Dashboard: `hasFetched` 守卫跳过重复加载（首次显示骨架屏，返回时直接渲染缓存）
- ✅ MonitorDashboard: `minmax(0, 1fr)` 修复列宽不等问题
- ✅ 提取 `chatUtils.ts`（`formatChatContent` 共享给 MonitorPane + 手机端）
- ✅ 新增 `/mobile` 路由（lazy-loaded），栈式导航：项目列表 → 聊天 → 侧边面板
- ✅ MobileProjectList: 2 列卡片网格 + 实时状态 + 活跃项目 glow 动画
- ✅ MobileChatView: 聊天气泡 + 乐观消息显示 + WS 去重 + 自动唤醒
- ✅ MobileFileBrowser: 3 列图标网格 + 分类颜色图标
- ✅ MobileFilePreview: 语法高亮 + 图片 + Markdown + 认证 URL

### v1.5.125：PWA 支持
- ✅ PNG 图标（192x192 + 512x512）深蓝底 + 蓝色终端 `>_`
- ✅ manifest.json（standalone, start_url=/mobile）
- ✅ apple-touch-icon + theme-color + apple-mobile-web-app-capable

### v1.5.126：手机模式自动检测 + 快捷命令
- ✅ 手机设备（pointer:coarse + width<768）自动重定向到 /mobile
- ✅ 手机设备隐藏 PluginDock + 桌面模式按钮
- ✅ useMobileViewport hook 禁止缩放（卸载时恢复）
- ✅ 聊天输入框上方快捷命令栏（全局 + 项目快捷命令）

### v1.5.127–v1.5.130：手机界面完善
- ✅ 活跃项目卡片 card-active-glow 渐变动画
- ✅ 文件预览认证 URL（img src + download href 加 token）
- ✅ theme resolved 修复（system 主题下语法高亮正确）
- ✅ 侧边面板：上下文用量进度条 + API 用量统计 + 文件浏览器
- ✅ useMonitorWebSocket 扩展支持 context_update 消息
- ✅ 聊天 header 改为 Menu 图标打开侧边面板
- ✅ 聊天历史分页：初始加载最近 20 轮，顶部"加载更早消息"按钮逐页追加
- ✅ 历史/实时消息分离（historySlice + liveMessages），滚动位置修正

### v1.5.131：手机聊天 Markdown 渲染
- ✅ Assistant 消息使用 ReactMarkdown + remarkGfm 渲染（用户消息保持纯文本）
- ✅ prose-sm 样式约束（紧凑间距、代码块 overflow-x-auto、标题限制大小）
- ✅ text-inherit 继承气泡颜色、链接 text-blue-400

### v1.5.132：稳定性与可靠性修复
- ✅ **P0** useMonitorWebSocket 无限重连 → 添加 MAX_RETRIES=5 + connectingRef 防重入
- ✅ **P0** Monitor WS 认证竞态 → auth 先发，等 `connected` 确认后再发 chat_subscribe
- ✅ **P0** Admin 文件系统权限过宽 → 添加敏感路径黑名单（.ssh/.gnupg/.aws/config.json）
- ✅ **P1** 终端崩溃无限重启 → 指数退避（3s→6s→12s→24s→48s）+ 5 次后停止
- ✅ **P1** WS 消息队列机制 → sendInput 永不丢弃消息，未就绪时排队，connected 后 flushQueue
- ✅ **P1** 队列跨重连保留 → 拆分 effect（unmount vs connection lifecycle），队列仅卸载时清空
- ✅ **P1** `state === 'waking'` 发消息无分支 → live/waking 合并处理，走 WS 队列
- ✅ **P2** sendToTerminal 统一发送逻辑（消除 handleSend/handleShortcut 重复代码）
- ✅ **P2** 消息列表 key 改为复合键（`role-ts-index`），历史加载失败显示 toast
- ✅ **P2** SidePanel 用量区 div → role="button" + tabIndex + onKeyDown（可访问性）
- ✅ **P2** 快捷命令按钮 waking 状态下禁用
- ✅ **P2** WS 重试耗尽时清空队列（防内存泄漏）
- ✅ 桌面 MonitorPane 同步修复（移除 2s 延时、waking 状态处理）

### v1.5.133：Markdown 数学公式预览
- ✅ 安装 `remark-math@6` + `rehype-katex@7`（KaTeX 渲染引擎）
- ✅ 桌面端 FilePreviewDialog：remarkMath + rehypeKatex 插件 + KaTeX CSS
- ✅ 手机端 MobileFilePreview：同上
- ✅ 支持行内公式 `$...$` 和块级公式 `$$...$$`
- ✅ KaTeX 在 lazy chunk 中，不影响主 bundle 体积

### v1.5.134：项目重命名
- ✅ 后端 `PATCH /api/projects/:id/rename`（权限验证 + 同步 `.ccweb/project.json`）
- ✅ 前端 `renameProject()` API 函数
- ✅ ProjectCard 内联编辑（Pencil 按钮 + 双击名称 → 输入框 → Enter/Escape/失焦）
- ✅ 共享项目和归档项目不可重命名

### v1.5.135：桌面端对话框覆盖层
- ✅ 移除 TerminalDraftInput（浮动输入框）
- ✅ ProjectHeader 新增"对话框"按钮（MessageSquare 图标，Ctrl+I 快捷键）
- ✅ 新建 `ChatOverlay.tsx`：聊天气泡覆盖层，浮在终端上层
- ✅ 消息气泡：用户纯文本右对齐 + 助手 ReactMarkdown 左对齐
- ✅ 历史分页：information API 加载 + "加载更早消息"按钮
- ✅ 状态机：stopped → waking → live → error（自动唤醒 + wakeIdRef 防过期回调）
- ✅ 发送走 sendTerminalInput（PTY 写入），保证所有 CLI 功能正常
- ✅ pendingQueueRef 消息队列 + wsReadyTick 信号确保 WS 就绪后 flush
- ✅ Skills 面板 + Model 选择器 + 语音输入（从 TerminalDraftInput 迁移）
- ✅ 可拖拽定位 + 边界限制 + localStorage 持久化
- ✅ per-project 显示状态持久化
- ✅ 3 秒无 WS 消息 fallback 到 API 加载历史
- ✅ 经过 3 轮独立代码审查 + Codex 审查，修复状态机遗漏、队列、竞态等问题

### v1.5.136–v1.5.137：通知移除 + 手机 Office 预览 + UI 改进
- ✅ 移除浏览器 Notification API，统一使用 sonner toast
- ✅ 手机端新增 docx/xlsx/xls/pptx 文件预览（lazy-loaded OfficePreview）
- ✅ 文本文件预览大小阈值从 1MB 提高到 5MB
- ✅ ChatOverlay 透明背景（气泡漂浮在终端上）、底部工具栏面板、Escape 关闭

### v1.5.138：Terminal 项目类型（浏览器版 SSH）
- ✅ 新增 `cliTool = 'terminal'`：纯 shell，无 LLM CLI
- ✅ `TerminalAdapter`：`buildCommand()` 返回空，调用 `$SHELL -il`
- ✅ Terminal 项目不走 sessionManager、hooks、resumeAll，不自动重启
- ✅ NewProjectDialog 新增 Terminal 选项，隐藏 permission mode
- ✅ 修复 `routes/claude.ts` VALID_TOOLS 遗漏 gemini+terminal
- ✅ Rename endpoint 加 255 字符长度限制

### v1.5.139：发送重试机制
- ✅ 发送后 3 秒无 WS chat_message 回显 → 补发 `\r`，最多 3 次
- ✅ 覆盖 MobileChatView、ChatOverlay、桌面快捷命令（ProjectPage `sendWithRetry` 包装）
- ✅ 任何 CLI 响应（user 或 assistant 消息）立即清除 retry

### v1.5.140–v1.5.141：远程自更新 + UI 完善
- ✅ `POST /api/update/execute`：admin-only，spawn detached updater agent → `npm install -g` → `ccweb start --daemon --{mode}`
- ✅ `GET /api/update/status`：读取 agent 写入的状态，前端轮询重连
- ✅ 启动参数持久化 `~/.ccweb/prefs.json`
- ✅ ChatOverlay 气泡阴影、底部工具栏蓝色调面板
- ✅ UpdateButton 添加到 Dashboard header

### v1.5.142–v1.5.144：磨砂玻璃 UI
- ✅ ChatOverlay 输入框 3 行高度、字体 2 倍（text-lg）
- ✅ 气泡半透明 backdrop-blur-md
- ✅ 多层 boxShadow 模拟玻璃厚度（外阴影 + 顶部高光 + 底部暗边）
- ✅ Light mode 修复（`bg-black/5 dark:bg-white/10`）

### v1.5.145–v1.5.146：按钮优化 + 隐藏滚动条 + 版本号显示
- ✅ Update 按钮改为纯图标（size="icon"）
- ✅ 版本检查改为后端查 npm registry（修复 LAN/公网 fetch GitHub 失败）
- ✅ 修复 `package.json` 路径错误（读到 `1.0.0` 的 bug）
- ✅ 跳过 confirm_prepare 阶段（不再自动保存记忆）
- ✅ 对话区域隐藏滚动条（Tailwind arbitrary variants）
- ✅ Dashboard header logo 下方显示版本号

### v2026.4.17–v2026.4.19-a：日期版本 + 关键修复
- ✅ 版本号方案改为 `YYYY.M.D`（date-based semver），同日后续发布用 `-a/-b/-c` pre-release 后缀
- ✅ 移除 Dashboard 记忆池按钮 + 相关死代码
- ✅ 新建项目不再自动创建 `.notebook/` 文件夹
- ✅ 新增 `docs/animation-libraries-2026.md` 动效库选型指南
- ✅ ChatOverlay 磨砂玻璃气泡（backdrop-blur-md + 多层 boxShadow）
- ✅ **修复远程更新 agent cwd 继承问题**（之前更新后服务不重启的 root cause）：agent spawn 指定 `cwd: $HOME`，execSync/spawnSync 显式 cwd，用绝对路径 ccweb 而非 npx
- ✅ **修复 LLM 最后一条消息不显示**：Stop hook 额外在 300ms/1500ms 重新 triggerRead，解决 Claude JSONL 延迟 flush
- ✅ **ChatOverlay 消息窗口优化**：`formatChatContent` 只保留 text block，工具调用/工具结果不再占用 50-slot 气泡窗口

### 2026-04-17 当日后续（v2026.4.19-b 到 -i，同日 pre-release）
- ✅ **ChatOverlay 气泡 spring pop-in 动效**：scale 0.3, y 40, bounce 0.45；`useReducedMotion` 降级为纯淡入；`AnimatePresence initial={false}`
- ✅ **气泡稳定 msg.id**：单调计数器，避免历史 prepend 时 React 重挂载 + 丢动画 / 折叠状态
- ✅ **对话框重构为半透明遮罩**（v-c 到 -e）：外层改 `absolute left-0 right-0 top-0 bottom-7` 覆盖 terminal 让出 footer；默认开；纯 SSH 项目无此功能；去掉拖拽/位置记忆/X 按钮；输入区全宽贴底
- ✅ **shadcn ScrollArea 恢复滚动条**：扩展 `viewportRef` prop 让 scrollRef 指向真实 Radix Viewport
- ✅ **stick-to-bottom 初次加载**：`useLayoutEffect` + 双 rAF + 100/300/800ms 多次 pin + 1200ms 宽限窗口 + wheel/touchmove 立即释放
- ✅ **shortcut 乐观气泡**：ChatOverlay `forwardRef` 暴露 `appendUserMessage`；RightPanel 快捷命令经 `sendWithRetry` 时立刻插气泡，不等 JSONL echo
- ✅ **AssistantMessageContent 折叠/展开**（桌面 + 手机）：默认仅最新 assistant 展开；local `userToggled` 保留手动选择；`previewLine` 剥 heading/list/link/image/code 生成一行预览；`aria-expanded`
- ✅ **手机 header 更新按钮**：`MobileProjectList` 引入 `<UpdateButton />`
- ✅ **Claude Code PermissionRequest hook 审批桥接**（v-f）：新建 `bin/ccweb-approval-hook.js` + `approval-manager.ts` + `routes/approval.ts` + `ApprovalCard.tsx`；HMAC + loopback + view-only 隔离；失败 fallback 到 TUI 不阻塞 Claude；`hookSpecificOutput.decision.behavior` 格式；timeout chain 120/112/110s
- ✅ **手机 WS 加入 projectClients**（v-g）：`chat_subscribe` 分支补 `projectClients.get().add(ws)` + 推初始 `context_update`；手机看不到 context + approval 的 root cause 修复
- ✅ **send-retry 加固**（v-i）：narrow clear（仅 own echo / assistant 响应才清 retry）+ 4×2.5s（10s 窗口）+ desktop wsReadyTick flush 也 arm retry

### 2026-04-18（v2026.4.19-j）
- ✅ **桌面气泡宽度溢出修复**：Radix ScrollArea 注入的 `display:table` 包裹随宽内容拉伸，气泡 `max-w-[85%]` 于是跟着超出 terminal。用 `viewportClassName="[&>div]:!block [&>div]:!w-full"` 覆盖为 block + 100%
- ✅ **文档刷新**：`DETAILS/chat-overlay.md` 按遮罩+折叠+审批卡片重写；新建 `DETAILS/approval-flow.md`；`CLAUDE.md` 历史错误 #15-21；`DETAILS/mobile.md` send-retry + `chat_subscribe` 修复

### 2026-04-18（v2026.4.19-k）— 全面测试 + bug 修复
通过沙箱 HOME 隔离（`/Users/tom/Projects/cc-web/.test-sandbox/home`）+ Playwright + OpenCode 跑了 56 个 UI/interaction 测试用例（51/56 通过 91%），发现并修复：
- ✅ **P1 审批流 `req.on('close')` 误触发**：Node 16+ IncomingMessage 在 body 完全接收后 auto-destroy 会触发 `req.on('close')`，小 POST body 导致它几乎立刻触发误触发 cancel → pending 条目被删、前端看不到审批卡片。修：改用 `res.on('close')`（仅 response 实际断开或 end 后才触发），并把 `req.destroyed` 改为 `res.writableEnded || res.destroyed`。验证：审批流 12/12 通过
- ✅ **P2 CSP 阻止 woff2 data URL 字体**：`font-src 'self'` 改为 `font-src 'self' data:`。验证：console 0 errors

### 2026-04-18（v2026.4.19-l）— 审批超时拉长
- ✅ **审批流 24h 超时**：三层超时链（settings.json、hook 脚本 HTTP、backend `HOOK_TIMEOUT_MS`）全部拉到 24 小时，实际等同"无时限"。注意实际天花板还有 OS TCP keepalive ~2h idle，真正无限期要加服务端心跳保活（后续）

### 2026-04-18（post v-l 清理）
- ✅ **移除项目完成后的通知**：`lib/notify.ts` 的 `notifyProjectStopped` 整个删除；DashboardPage 和 TerminalView 不再订阅 `onProjectStopped`。WS 后端广播基础设施保留（只是没有前端 toast）
- ✅ **完全去除记忆池系统**：删除 `backend/src/memory-pool/` 整目录、`backend/src/routes/memory-pool.ts`、`frontend/src/components/MemoryPoolPanel.tsx`、`MemoryPoolBubbleDialog.tsx`、`DETAILS/memory-pool.md`；更新 `index.ts`/`hooks.ts` 去掉 imports 和 Stop hook 里的 `tickPool` 块；LeftPanel 去掉 `memory` tab；api.ts 删 ~110 行 interfaces + fetch；`npm uninstall matter-js @types/matter-js`；CLAUDE.md / DETAILS/README.md 相关引用清理
- ✅ **移除信息 tab + 管理型 API**：删 `frontend/src/components/InformationPanel.tsx`；LeftPanel 去掉 `info` tab；删 `backend/src/information/condenser.ts`；删 4 个管理型端点（DELETE 对话、POST condense、POST reorganize、POST sync）+ 对应 4 个前端 API 函数。**保留只读**：`getConversations`、`getConversationDetail` + 后端两个 GET 端点 + Stop hook 自动同步（ChatOverlay / Mobile / Monitor 历史加载仍然可用）
- ✅ **条件驱动 send-retry**：针对用户反馈的"偶尔消息卡在 Claude TUI 输入框"。原 4×2.5s 固定次数 retry 有两个缺陷 —— (a) 慢 TUI 场景 10s 窗口不够；(b) assistant 响应误清 retry（Claude 正流式输出 msg1 时用户发 msg2，msg1 的 assistant block 到达误清 msg2 的 retry）。改为每 3s 检查 `recentSentRef.includes(text)`，没 echo 继续发 `\r`，echo 了停；20 次硬 cap（60s）防无限循环。清除条件收紧为**仅 own-echo 匹配**。同时修 `appendUserMessage` 必须 `.trim()`（之前只剥 `\r`，带末尾空格永远 indexOf miss 导致白跑 60s）

### 2026-04-19（v2026.4.19-p 之后，未发版）— 三维深度审查 + P0 批量修复
三个独立 sub-agent 分别从后端正确性 / 前端 UX / 安全基础设施切入，共命中 ~120 条问题，合并排序为 P0 / P1 / P2 + R1–R8 重构提案。按 P0 逐项落地（**未 commit / 未发版**，供手动验证）：

**安全 P0**（`middleware/authz.ts` + 多路由）
- ✅ 新建 `backend/src/middleware/authz.ts`：`requireAdmin` / `requireProjectOwner` 统一 middleware；禁止在 handler 里手写 admin 判断
- ✅ **S-1 SkillHub PAT 去硬编码**：删 `_TP.join('')` 拼接；`getGithubToken()` 只读 env `CCWEB_GITHUB_TOKEN`，缺失时 `githubApi` fail-fast 返 clear error（读端点 `/skills` / `/plugins` 仍可用）。**⚠ 需人工 rotate**：之前发布的 tarball 永远在 npm 仓库里，旧 token 已泄漏，必须去 GitHub 把它 revoke + 生成新 PAT 放入运行环境 env
- ✅ **S-2 plugins 路由加 requireAdmin**：`/install` / `DELETE /:id` / `/:id/update` / `/:id/config` / `/:id/enabled` 全部 admin-only；删掉冗余的 `/:id/data` GET/PUT（plugin-bridge 已有 `/storage/:pluginId`）
- ✅ **S-3 backup 路由整体 admin-only**：`router.use(requireAdmin)`；OAuth callback 仍走 `backupAuthCallbackRouter`（无 auth，因外部 provider 回调）
- ✅ **S-4 plugin-bridge storage 加 requireAdmin**：原来的 `pluginId === headerPluginId` 检查是 tautology（调用者双方都控），现在存储只有 admin 能读写；plugin backend 自己的 `/api/plugins/:id/*` 端点不受影响
- ✅ **S-5 `__local_admin__` 常量 secret fallback 删除**（**保留 sentinel 支持首次 setup**）：`generateLocalToken` 改为无 config 直接 throw（路由 500），不再签 `ccweb-local-fallback` 的 fallback token；`isLocalRequest` 改用 `req.socket.remoteAddress`（不走 `req.ip`），免疫 `X-Forwarded-For` 伪造。**`authMiddleware` 无 config 时仍给 localhost 赋 `__local_admin__` 身份**（首次 setup 需要无凭据就能进浏览器完成 `ccweb setup`），加了启动时一次性 `console.warn` 告警提醒操作员完成 setup。反向代理终结后源 IP 为 127.0.0.1 的场景需单独评估（建议不要把 ccweb 部署在 TLS 反向代理后面，或至少保证 setup 已完成）
- ✅ **S-6 filesystem 黑名单扩充**：补 `.docker` / `.kube` / `.config/gcloud`；`~/.ccweb/` 下新增 `users.json` / `approval-secret` / `backup-config.json` / `plugin-data/*`；`~/.npmrc` / `~/.docker/config.json`
- ✅ **S-7 + B-4 update agent 双修**：(a) `spawnSync('sleep', …)` 60×fork busy-loop → `Atomics.wait` 真 sleep；(b) `npm install -g` / `npm info` 加 `--registry=https://registry.npmjs.org` 固定，防 `~/.npmrc` 被篡改导致 MITM；(c) 整个 update router 改 `router.use(requireAdmin)`，原先 `/status` 端点无 admin 判断的漏洞一并修

**数据完整 P0**（session-manager / hooks / projects）
- ✅ **B-1 hook route 路径解析兼容子目录**：`findProjectByDir` 从 exact-match 改为 "exact or longest-prefix"，与 `bin/ccweb-approval-hook.js#resolveProjectId` 语义对齐。之前用户在 `~/Projects/X/src` 启动 Claude 时，PreToolUse hook 的 `$CLAUDE_PROJECT_DIR` 是子目录 → route 匹配失败 → 聊天历史 + semantic 全丢
- ✅ **B-2 `POST /api/projects` folderPath 查重**：同一文件夹创建第二个项目时返 409 + 原 projectId。消除 "两个 UUID 同 folder" 的 `.ccweb/project.json` 覆盖 + hook resolver 歧义风险
- ✅ **B-3 `triggerRead` retry 去掉 `state.retrying` guard**：原先"in-flight retry 期间后续 triggerRead 直接 return"会吞掉 Stop 的最终文本；改为允许多条 retry 链并发，每条在回调里各自看 `s.jsonlPath` 已被解决则 no-op
- ✅ **B-4 update agent busy-loop 修复**：见 S-7 (a)

**前端 P0**（useEnterToSubmit + approval seq + AssistantMessage 折叠 + liveMessages cap + ProjectPage 死码）
- ✅ **F-2 新建 `useEnterToSubmit` hook**：统一 Enter-to-submit + `isComposing / keyCode=229` IME 合成期守卫。`MobileChatView` / `MonitorPane` 迁移完成；`ChatOverlay` 内联增加 IME 检查（它的 Space 长按分支不便抽 hook）。之前中文/日文/韩文 IME 用户按 Enter 选候选字 = 100% 误发半截消息，手机端尤严重
- ✅ **F-1 approvalEvents 改 seq 序号游标**：ProjectPage 给每个 approval 事件打 `seq: number`，ChatOverlay 用 `lastApprovalSeqRef` 过滤 —— 替换原来的 `slice(-50) + events.length` 反模式。之前父数组触顶 50 条后，所有新审批永远不进 UI
- ✅ **F-3 AssistantMessageContent 不再因 isLatest 翻转而自动折叠**：改为 mount 时读一次；`isLatest=false → true` 重新展开；`true → false` **不再**自动折叠（之前用户刚读到一半时新消息到达会把老消息缩成一行，误以为内容丢失）
- ✅ **F-5 liveMessages / chatMessages 三端 cap 200**：ProjectPage / MobileChatView / MonitorPane 全部 `.slice(-200)`。消除长会话下数组无限增长 + useChatSession 每条消息 O(n) diff 的 tail pressure
- ✅ **B-P1-b 删除 ProjectPage `sendWithRetry` + `sendRetryRef`**：那一套固定次数 retry + "任何 chat_message 清 retry" 就是 CLAUDE.md #19 批评的反模式的复活。改为 `handlePanelSend`：user message (`\r` 结尾) + overlay 已挂 → `chatOverlayRef.sendCommand` 走 useChatSession 的条件驱动 retry；否则 → raw PTY write。ChatOverlay `forwardRef` 新增 `sendCommand(text)` 入口
- ✅ **F-4 手机端 ApprovalCard 集成**：`useMonitorWebSocket` 扩 `onApprovalRequest` / `onApprovalResolved`；`MobileChatView` mount + 每次 wsConnected 翻转时 `getPendingApprovals` 补拉；消息列表末尾渲染复用的 `<ApprovalCard>`。之前手机用户触发 Write/Edit/Bash 只能等 24h 超时或开桌面批

**教训写回 CLAUDE.md**：新增历史错误 #30（凭据编译进 npm 包 + 拆字符串绕扫描器）、#31（权限手写于 handler）、#32（数组长度做游标遇父截断失效）、#33（IME 合成期 Enter 直接提交）

**独立 code-review 回合 + 二次修复**（同批次内、未发版）：
独立 sub-agent（`superpowers:code-reviewer`）对首轮 P0 修复做二次审查，结果"可以发版，但建议先修 H-1/H-3"。已落地：
- ✅ **H-1 approval REST/WS race**（`ChatOverlay.tsx` + `MobileChatView.tsx`）：新增 `resolvedIdsRef: Set<string>` 记录所有已经被解析的 `toolUseId`（WS `approval_resolved` + 本地点击 Allow/Deny 均计入）；REST 补拉结果进入 state 前先过滤掉已解析 ID，且采用 merge 而非覆盖（REST 对它看到的 entries 权威，但 prev 里 WS 已加进但 REST 未看到的 entries 保留）。堵住 CLAUDE.md #27 同家族 race（REST 返回时挤进已解析的 toolUseId）
- ✅ **H-3 armRetry 改为"单个滚动 watcher"**（`useChatSession.ts`）：原来的 `armRetry(lastText)` 每次调用都 `clearSendRetry()` → 快速连发（如快捷命令 chain）时仅最后一条有 retry 保护。改为无参 `armRetry()`，`sendRetryRef.current != null` 时直接 return，单一 timer 持续检查 `recentSentRef` 非空就 fire `\r`、空了就停、20 次 cap 保持不变。**同时修 `useProjectWebSocket.sendTerminalInput` 的静默丢弃**：原本 WS 未 OPEN 时 silent-drop，现改为入队 `pendingInputQueueRef`，`connected` 事件到达时 `flushInputQueue()` 重放。手机端 `useMonitorWebSocket` 本来就有队列，桌面侧现在和它对齐。这一项同时堵住 CLAUDE.md #26 同家族（初挂 CONNECTING 期的 drop）
- ✅ **H-2 `__local_admin__` 告警 + TODO 澄清**（`backend/src/auth.ts`）：`authMiddleware` fallback 到 `__local_admin__` sentinel 时 `console.warn` 一次性告警（`_firstRunWarned` 防刷屏），提醒操作员跑 `ccweb setup`。代码行为不变（首次 setup 仍能走通），但日志里会看到"正在用 sentinel 绕过认证"的信号。同时 TODO 里 S-5 的措辞从"常量 secret 删除"改为"常量 secret **fallback** 删除（保留 sentinel）"，和实际代码对齐
- ✅ **M-1 folderPath 查重加 realpath**（`routes/projects.ts`）：`canonicalize()` helper 先 `path.resolve` 再 `fs.realpathSync`（失败回退 resolve）。两条路径经 symlink 指向同一物理目录时也能识别为重复
- ✅ **M-2 filesystem 跨平台路径**（`routes/filesystem.ts`）：`.config/gcloud` 等多段路径改用 `path.join(...segs)`，Windows (`\`) 和 POSIX (`/`) 都能正确拼接；`.docker/config.json` 同步改
- ✅ **M-3 triggerRead retry 链幂等入口**（`session-manager.ts`）：重新引入 `retryChainActive` 字段，但**不短路外层的"jsonlPath 已就位直接读"路径**——只阻止同时起 N 条完全一样的 `findLatestJsonlForProject` 磁盘 scan 链。和旧 `state.retrying` guard 的本质区别：旧的把 jsonlPath 已就位的 triggerRead 也吞了（引入原 bug），新的只对"chain start"幂等
- ✅ **M-4 `useEnterToSubmit` 类型清理**：去掉 `as unknown as {keyCode?: number}` cast——现代 `KeyboardEvent` 类型本来就有 `keyCode` 和 `nativeEvent.isComposing`
- ✅ **死码清理**：`backup.ts:209` `router.get('/auth/callback', …)` 在 admin-locked router 下完全不可达（真路由走 `backupAuthCallbackRouter`），删之

**重构提案（未执行，留待后续）**：
- R1 S：发版流水线脚本 `scripts/release.mjs`（四文件版本校验 + `npm pack --dry-run` 黑名单 grep + bare 冲突预检 + publish）
- R2 M-L：三端合并为单一 `useChatChannel` facade（消除 lift-state + prev-counter 反模式）
- R3 M：`projects.json` → 每项目一文件 + 内存索引（消除 R-M-W race）
- R4 M：session-manager 拆 `JsonlTail` / `SessionRegistry` / `ChatEmitter` 三模块
- R5 L：插件 backend 改 `child_process.fork` 沙箱
- R6 S-M：secrets vault 集中（`~/.ccweb/secrets/*.bin` 统一 0o600）
- R7 S：useEnterToSubmit hook（已在本批 P0 内落地）
- R8 M：ChatOverlay 拆 5 个子组件

### 2026-04-19（v2026.4.19-p）— 子系统下架 + 统一 JSONL finder + 版本规则硬化
- ✅ **后端移除**：`backend/src/information/` 整目录、`routes/information.ts`、`routes/share.ts`；`session-manager.ts` 去掉 `Session`/`SessionMessage`/`pruneOldSessions`/`listSessions`/`getSession`/`appendMessages`/`overwriteMessages` 等，只保留 JSONL 直读 + semantic + chat listeners；`config.ts` 移除 `ccwebSessionsDir`；`routes/projects.ts` 删 `/sessions`、`/sessions/:id`、`/sessions/search`、`/last-messages`、`/todos` 五个端点；`routes/hooks.ts` 去 `syncFromJsonl`；`index.ts` 去 informationRouter / shareRouter / compensationSync 启动块
- ✅ **适配器瘦身**：统一删除 `parseLine()` 方法和 `SessionMessage` 导入（6 适配器 + types.ts），只保留 `parseLineBlocks`
- ✅ **前端移除**：`api.ts` 删 `Session/SessionSummary/SessionMessage/getSessions/getSession/searchSessions/getLastMessages/getConversations/getConversationDetail/shareSession/getSharedSession/TodoItem/getProjectTodos`；删 `ShareViewPage.tsx` + App 路由；删 `TodoPanel.tsx`（已是孤儿组件）；`RightPanel.tsx` 删历史记录 Tab；`stores.ts` 去 `useProjectDialogStore.sessionId` 死字段
- ✅ **运行时数据清理**：`rm -rf` 48 个项目下 77 个目录共 ~61 MB（`.ccweb/information/` + `.ccweb/sessions/`）
- ✅ **Lazy JSONL discovery**：`getChatHistory` 不再依赖 hook 先触发；watcher 存在时 lazy 发现并缓存，无 watcher 时 fallback 走 `getProject()` + 即席解析（解决 ccweb 重启后首次访问项目详情看不到历史的回归）
- ✅ **统一 JSONL finder**：删 `findJsonl`（startedAt 过滤版），`triggerRead` 和 `getChatHistory` 都用 `findLatestJsonlForProject`，triggerRead 每次调用重检以侦测 mid-session 文件切换。避免两条路径返回不同文件导致前端 id 去重失效
- ✅ **版本号规则硬化**：CLAUDE.md 明确"**永远不发 bare 日期版本**"，即便真实日期到达、即便字母用光（加位 `-aa/-ab`），也不发 bare。起因：今日误尝试 `2026.4.19` bare 被 npm 拒绝（永久占用），浪费一次 publish
- ✅ **独立 code-review**：superpowers:code-reviewer pass 出 7 项，全部修复（2 P0 死代码、1 P1 finder 漂移、4 P2-P3 清理）
- ✅ **发版 + 验证**：`npm publish 2026.4.19-p → latest`（跳过 `-o` 之后的 bare 尝试）；git 3 commits（cleanup + bump + rule hardening）

### 2026-04-19（v2026.4.19-o）— 聊天数据流统一（hooks 抽取）
- ✅ **Phase 0 — `formatChatContent` 保留非文本 block**：旧实现 `.filter(b => b.type==='text')` 直接丢弃 thinking/tool_use/tool_result。改为用 fenced code 包裹（`\n\`\`\`${type}\n${content}\n\`\`\`\n`），AssistantMessageContent 通过 code-block-language 识别
- ✅ **Phase 2 — 新 `/api/projects/:id/chat-history` 端点 + block id + replay limit**：ChatBlock 新增 `id: sha1(jsonlPath + '\0' + line).slice(0,16)`（稳定、幂等、跨 restart 一致）；新端点支持 `limit` + `before=<id>` 游标分页；`chat_subscribe` 接受可选 `replay` 字段（默认 `Number.MAX_SAFE_INTEGER` 保后向兼容、新客户端显式传 `50`）；前端 `getChatHistory()` API
- ✅ **Phase 1 前置 — WS hook 扩 connected + readyTick**：`useProjectWebSocket` / `useMonitorWebSocket` 都导出 `{connected, readyTick}`，`useProjectWebSocket` 新增 `onDisconnected` 回调
- ✅ **Phase 1a — `useChatHistory` hook**：抽出 `loadFromInformation + 分页 + 去重` 逻辑，三端（ChatOverlay / MobileChatView / MonitorPane）共用；接新的 `/chat-history` 端点而非 `/api/information`
- ✅ **Phase 1b — `useChatSession` hook**：抽出状态机（stopped/waking/live/error）+ 发送队列（20 条 cap）+ 条件驱动 retry + wake flow + own-echo 去重 + 历史&实时合并（按 block id 跨 history/display 去重），三端共用；桌面 ChatOverlay 980→743 行、手机 466→294 行、监控 153→186 行（微增因补了重置逻辑），新增 hooks 共 527 行 → 总量略升但"一处改多处生效"
- ✅ **Phase 3（部分）— `useChatPinnedScroll` hook**：抽 `pinnedRef` + scroll 事件 + 80ms 程序性滚动屏蔽 + ResizeObserver 于 `contentRef`，ChatOverlay 从 inline 逻辑迁移；手机/监控 保留简版 `scrollTo`（reviewer 建议：Monitor/Mobile 的滚动差异是产品需求，不强统一）
- ✅ **独立 code-review**：基于 `/research/chat-unification-plan.md`（已纳入 git），reviewer 指出的事实性错误（`formatChatContent` 描述、竞态方向）+ 阶段次序（Phase 2 前置）全部写回方案 v2
- ✅ **发版 + 验证**：`npm publish 2026.4.19-o → latest`
- 🔁 **备选项**（未采纳但保留可回退的设计）：
  - 让三端都用**同一 WS hook**（合并 `useProjectWebSocket` + `useMonitorWebSocket`）—— 放弃：前者要承载 xterm 的 `terminal_data/resize`，合并会污染 monitor/mobile 的聊天专用场景
  - 让 `ChatBubble` / `ChatMessageList` UI 组件也在三端共享 —— 放弃：Monitor 的 `line-clamp-6` + 不走 markdown 是真实的产品差异；Monitor 只共享 hook 不共享 bubble
  - Phase 4 "block 级渲染"（保留 thinking / tool_use 结构化元素）—— 推迟：影响面大、streaming 中 block 未完成时的 UI 稳定性需要额外设计

### 2026-04-18（v2026.4.19-n）— ChatOverlay 自动滚动 + 活跃气泡 + 发送队列鲁棒性
- ✅ **自动滚动重写**：单一 `pinnedRef`（默认 true，入页即贴底）+ scroll 事件翻转 + `ResizeObserver` 观察我们自己持有的 `contentRef`（不依赖 Radix 内部结构）+ `useLayoutEffect` 在消息/气泡/审批变化时贴底。`scrollToBottom()` 打 `lastProgrammaticScrollAtRef` 时间戳，`onScroll` 忽略 80ms 内的自触发事件，防止流式长内容因 scroll-anchoring 被"抛锚"
- ✅ **LLM 活跃气泡**：`sessionManager.emit('semantic')` 在项目级 WS 广播新事件 `semantic_update`，`terminal_subscribe`/`chat_subscribe` 返回初始快照。ChatOverlay `activeBubble` 由 phase 驱动：非 `text` 且 active 时显示，phase='text' 或 active=false 时消失；`tool_use↔tool_result` 不换 id（动画不重启），熄灭后再激活换新 id（新动画）；pending 审批时抑制避免与 ApprovalCard 冗余；细粒度标签（执行命令/读取文件/编辑文件/搜索/...）
- ✅ **发送队列三场景覆盖**：用户反馈"消息滞留 Terminal 输入框"。根因：初次挂载时 `state='live'` 来自 `project.status` 同步快照，但 WebSocket 还在 CONNECTING → `rawSend` 的 `readyState==OPEN` 检查失败 → 静默丢弃。修：`useProjectWebSocket` 新增 `onDisconnected` 回调；`wsReadyTick: number` 替换为 `wsConnected: boolean`（连接时 true、断开时 false）；flush effect 依赖 `[wsConnected, state]`，`wsConnected && state==='live' && queue 非空` 三者同时成立才 drain —— 单一 effect 覆盖三场景：(a) 初挂 CONNECTING 期间入队、(b) 会话中 WS 抖动重连、(c) stopped→waking→live（后端不关 WS，wsReadyTick 不涨，原先依赖它的 flush 永不触发）
- ✅ **Code review pass**：用 superpowers:code-reviewer 独立 review，修了两个发现项：`lastProgrammaticScrollAt` 50ms→80ms 窗口抵抗 scroll-anchoring、RO 改为观察我们自己的 `contentRef` 不依赖 Radix 子元素结构
- ✅ **发版 + 验证**：npm publish 2026.4.19-n → latest

### 2026-04-18（v2026.4.19-m）— 审批 hook 兼容 Claude Code v2.1.114+
- ✅ **Approval hook 合成 `tool_use_id`**：浏览器深度回归测试发现 **v-l 所有 Write/Edit/Bash 被 `Denied by PermissionRequest hook` 自动拒绝**，ApprovalCard 永不弹出。根因：Claude Code v2.1.114+ PermissionRequest 的 hook stdin payload 只有 `session_id / transcript_path / cwd / permission_mode / hook_event_name / tool_name / tool_input / permission_suggestions`，**不再携带 `tool_use_id`**。`bin/ccweb-approval-hook.js` 把该字段作为必填，缺失即 `failClosed` → `decision: deny`。修：缺失时用 `'syn-' + sha1(session_id + '|' + tool_name + '|' + JSON.stringify(tool_input))` 前 16 字符合成一个确定性 id（同一次调用重试幂等，不同调用 id 不同）。浏览器实测 `Write ok.txt` 弹出 ApprovalCard 且文件成功写入。配套新增 CLAUDE.md #25 教训与"发版前必须实测审批"的注记
- ✅ **发版 + 验证**：npm publish 2026.4.19-m → latest；`npm install -g` 全局装好，hook 文件在 global path 包含 `syn-` 合成逻辑
- ✅ **`~/.npmrc` registry 切回官方**：从 `https://registry.npmmirror.com` 改为 `https://registry.npmjs.org`（`~/.npmrc.bak` 备份镜像配置）。起因：用户不需要国内镜像；同时去除 #15 类型的陷阱
- ✅ **文档化手动 `npm install -g` 的"假阳性已是最新"陷阱**：手动升级不会重启 node 进程，update-check 端点读磁盘 package.json 拿到新版本号 → 看似 up-to-date；必须 `ccweb stop && ccweb start --<mode> --daemon` + 浏览器硬刷。细节见 `DETAILS/remote-update.md`"非自动更新路径的陷阱"段

## 进行中 🔄

（无）

## 未完成 📋

### 权限审批 follow-up
- 📋 **服务端心跳保活**，绕过 OS TCP keepalive ~2h 限制以支持真正无限期审批等待
- 📋 "本会话始终允许"按钮（原生 `updatedPermissions: [{type:'addRules', destination:'session'}]`）
- 📋 pending 持久化（backend 重启不丢）

### 功能增强
- 📋 项目内 CLI 切换（运行时从 claude 切到 codex）— 有设计方案，未实现
- 📋 语音输入根本原因调查（Web Speech API 可能需要网络）
- 📋 项目卡片磁盘体积缓存（当前每次渲染都调 du -sk）
- 📋 UpdateButton 对非管理员隐藏（现在点了会 403）
- 📋 Reviewer 标注的 send-retry edge cases：rapid 双发的 stale-submit 问题（小概率）

### 对话框小优化
- 📋 非最新 assistant 气泡折叠的"jarring mid-read"问题（用户若反馈再改为快照 isLatest）
- 📋 审批卡片支持手机端触控体验（当前 `UpdateButton` 在移动端 tap target < 44px）

### Chat 统一后残留
- 📋 `getChatHistory` 的 "no watcher" fallback 分支每次都 `readFileSync` 全量 JSONL。冷启动时多客户端并发访问同一项目可能有 I/O 尖峰。如需优化：加 5-10s mtime-keyed 内存缓存
- 📋 三端滚动锚定未完全统一：Monitor + Mobile 用简版 `scrollTo`，只有桌面用 `useChatPinnedScroll`。手机若引入贴底模式需验证虚拟键盘 + iOS momentum
- 📋 Phase 4（block-level 渲染）：保留 thinking / tool_use 结构化而不是拍平成 fenced markdown。需先解决 streaming 中 block 未完成的稳定性

## 失败 ⚠

- ⚠ **2026-04-19 误发 bare `2026.4.19`**：npm 返回 "Cannot publish over previously published version"（bare 此前曾占用后 unpublish，永久保留）。损失：一次发布尝试，需改 `-p` 后再发；CLAUDE.md 对应规则硬化。根因：字面解读"真实日期到达就可发 bare"，忽略 bare 大于所有 pre-release 会导致**当天彻底断版**。教训已写回 CLAUDE.md 历史错误 #29 + 记忆池

## 放弃 ❌

- ❌ 记忆池自动提取方案 v1（从对话提取独立记忆球）— 被信息系统替代
- ❌ feedback 球默认 permanent=true — 用户明确否决
- ❌ **信息系统 / 对话分享 / TodoPanel / RightPanel 历史记录 Tab**（v2026.4.19-p 起）—— 核心数据源迁到 CLI 原生 JSONL 后全部成死代码，用户明确确认"全删"；相关 `.ccweb/information/` + `.ccweb/sessions/` + 77 个项目目录 + 所有路由 / 前端组件 / API 函数一并移除

## 设计文档（历史归档）

> 以下方案此前指导了"信息系统"的实现。该子系统已在 v-p 彻底移除，方案文档留存仅作历史参考。

- `research/chat-unification-plan.md` — 本次 v-o 重构的最终方案（hook 抽取 + `/chat-history` + block id dedup）—— **已实现**
- `research/information-system-v2.md` — 历史：信息系统 v2 简化设计（JSONL 为中心）—— 子系统已删
- `research/memory-pool-conversation-condense.md` — 历史：完整缩减/重整方案 —— 子系统已删
- `research/memory-pool-auto-extract.md` — 已废弃的自动提取方案
- `research/monitor-dashboard-design.md` — 监控大屏设计方案
- `research/information-sidebar-design.md` — 历史：侧边栏信息 tab 设计 —— 子系统已删

## 后台进程

| 进程 | 命令 | 状态 | 预期结果 |
|------|------|------|---------|
| ccweb 后端 | `node ~/.nvm/versions/node/v23.2.0/lib/node_modules/@tom2012/cc-web/backend/dist/index.js`（全局安装 v2026.4.19-p） | running（`:3001`，`lsof -iTCP:3001 -sTCP:LISTEN` / `cat ~/.ccweb/ccweb.pid`） | 持续运行；UI 通过 `http://localhost:3001` 访问；hook 子进程由 Claude Code 按需 spawn，不占常驻 |

停启：
```bash
ccweb stop                      # 或 kill -TERM $(cat ~/.ccweb/ccweb.pid)
ccweb start --local --daemon    # access mode 与原先一致（local/lan/public），daemon 后台常驻
```
