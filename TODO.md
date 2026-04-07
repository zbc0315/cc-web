# TODO — ccweb 任务计划

## 已完成 ✅

### v1.5.94–v1.5.98：记忆池并发修复
- ✅ withPoolLock 全覆盖（8 处路由修复）
- ✅ Stop hook tickPool 加锁
- ✅ buildSurface 跳过 ghost 球
- ✅ POST /balls 验证 links 存在性
- ✅ readPool JSON 解析失败记录日志

### v1.5.95–v1.5.99：浮力可视化修复
- ✅ buildSurface break→continue（贪心背包）
- ✅ 前端 BubbleDialog 物理模型改为真实流体（密度∝1/B）
- ✅ 改为按浮力降序逐个生成气泡（100ms 间隔）

### v1.5.100–v1.5.101：模板修复 + 语音
- ✅ QUICK-REF.md projectId 改为 UUID（修复 GLOSS 项目 Bug）
- ✅ 语音输入 onerror 增加 toast 提示

### v1.5.102–v1.5.116：信息系统
- ✅ P0：对话同步（JSONL → v0.md + meta.json）
- ✅ P0：读取 API（list, read + 展开计数, delete）
- ✅ P0：Stop hook 集成 + 启动时补偿扫描 + 5 分钟定时扫描
- ✅ P0：前端侧边栏"信息"标签页
- ✅ P1：缩减模块（迭代滑动窗口 + Haiku 调用）
- ✅ P1：重整模块（基于展开数据 + 高关注轮次保护）
- ✅ P1：缩减/重整按钮 + 进度条 + 错误 toast
- ✅ Codex 适配器（JSONL 解析 + getSessionFilesForProject）
- ✅ 连续 assistant blocks 合并
- ✅ 新轮次追加到所有版本 + 轮次 ID 重映射 + 标记重算
- ✅ 强制重建 v0（sync?force=true，右键同步按钮）
- ✅ 激进缩减 prompt（列出 6 类必须缩减的内容）
- ✅ CLAUDE.md 信息系统模板块

### v1.5.103–v1.5.110：监控大屏
- ✅ MonitorDashboard + MonitorPane 组件
- ✅ Stopped 项目从信息 API 加载历史
- ✅ 自动唤醒（输入后 PATCH /start + WS 连接）
- ✅ 状态机（STOPPED→WAKING→LIVE→ERROR + 外部触发）
- ✅ 轻量 useMonitorWebSocket hook（只 chat_subscribe）
- ✅ 活跃项目 card-active-glow 边框
- ✅ 聊天气泡样式 + 只显示最近 2 轮
- ✅ 3 秒无消息 fallback 到信息 API

### v1.5.103–v1.5.116：其他功能
- ✅ Git 提交历史树（GET /git/log + 前端 GitPanel）
- ✅ 项目卡片磁盘体积显示（GET /disk-size）
- ✅ 用量显示 3 个配速（5h/7d/7d Sonnet）
- ✅ 活动检测改为服务端 `active` 字段（修复 LAN 时钟偏差）
- ✅ 全局滚动条统一（shadcn 风格）
- ✅ 首页搜索历史对话功能移除
- ✅ 记忆池 tab 停用（disabled）
- ✅ 上下文窗口使用量监控（status line → 进度条）
- ✅ 监控大屏窗口高度限制

### 本次会话（未提交）
- ✅ 上下文进度条移到左侧紧挨 LLM 用量模块（去掉 ml-auto）
- ✅ 监控大屏项目窗口拖拽排序（HTML5 DnD + localStorage 持久化 + GripVertical 手柄）

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
