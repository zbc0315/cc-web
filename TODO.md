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

## 进行中 🔄

（无）

## 未完成 📋

### 信息系统 P2
- 📋 Haiku 生成对话摘要（替代首条用户消息前 50 字符截取）
- 📋 全文搜索（搜索所有版本的对话内容）
- 📋 前端对话详情弹窗中的虚拟滚动（大文件性能）

### 功能增强
- 📋 项目内 CLI 切换（运行时从 claude 切到 codex）— 有设计方案，未实现
- 📋 语音输入根本原因调查（Web Speech API 可能需要网络）
- 📋 项目卡片磁盘体积缓存（当前每次渲染都调 du -sk）

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

（当前无后台进程）
