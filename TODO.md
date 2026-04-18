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
- 📋 审批记录进信息系统（可审计）
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

## 放弃 ❌

- ❌ 记忆池自动提取方案 v1（从对话提取独立记忆球）— 被信息系统替代
- ❌ feedback 球默认 permanent=true — 用户明确否决

## 设计文档

- `research/information-system-v2.md` — 信息系统 v2 简化设计（JSONL 为中心）
- `research/memory-pool-conversation-condense.md` — 信息系统完整方案（迭代缩减、展开计数、信息重整）
- `research/memory-pool-auto-extract.md` — 已废弃的自动提取方案
- `research/monitor-dashboard-design.md` — 监控大屏设计方案
- `research/information-sidebar-design.md` — 侧边栏信息标签设计方案

## 后台进程

| 进程 | 命令 | 状态 | 预期结果 |
|------|------|------|---------|
| ccweb 后端 | `node /Users/tom/.nvm/.../@tom2012/cc-web/backend/dist/index.js`（全局安装 v-m） | running（listening `:3001`，PID 见 `lsof -iTCP:3001 -sTCP:LISTEN`） | 持续运行；UI 通过 `http://localhost:3001` 访问；hook 子进程由 Claude Code 按需 spawn，不占常驻 |

停启：
```bash
ccweb stop                      # 或 kill -TERM <pid>
ccweb start --local --daemon    # access mode 与原先一致（local/lan/public）
```
