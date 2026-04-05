# Memory Pool Surface

> t=34 | surface_width=10000 | used≈1514 tokens | 20/20 balls

- **[project]** 记忆池设计决策：项目级、列表+浮球、AI操作、消息级轮次、λ=0.97、主动上浮、层满竞争（下沉+分裂） — `ball_0004` (B=5.9, ~64tok → links: ball_0003)
- **[feedback]** 发版严禁遗漏：四文件版本同步、CLAUDE.md 条目、--include=dev、Edit 前 Read — `ball_0005` (B=5.9, ~39tok)
- **[feedback]** 论文生成必须以代码为 ground truth，先生成 CODE_ANALYSIS.md — `ball_0015` (B=5.7, ~51tok → links: ball_0004)
- **[feedback]** 已移除功能——绝不重新引入：Chat SDK/ambient sound/chat tab/Stop button/built-in shortcuts — `ball_0008` (B=5.2, ~63tok)
- **[feedback]** 本项目停止向 GitHub 推送代码，只通过 npm publish 发布 — `ball_0001` (B=5.0, ~14tok)
- **[project]** v1.5.94: 记忆池并发安全加固 — withPoolLock 全覆盖 + 8处路由修复 + ghost球过滤 — `ball_0019` (B=4.4, ~94tok → links: ball_0004)
- **[project]** v1.5.95-96: 浮力排序修复 — 后端贪心背包 + 前端真实流体物理模型(密度∝1/B) — `ball_0020` (B=4.4, ~77tok → links: ball_0004)
- **[project]** 核心设计决策：open-with-continue/session tailing/hooks/lazy named export 等 8 条 — `ball_0007` (B=4.0, ~186tok → links: ball_0006)
- **[project]** v1.5.93: 全局记忆池 — ~/.ccweb/memory-pool/ 汇聚所有项目记忆，浮力模型驱动通用经验上浮 — `ball_0017` (B=3.9, ~100tok → links: ball_0004)
- **[project]** cc-web 核心架构：Browser→Express→TerminalManager→node-pty→Claude CLI — `ball_0006` (B=3.5, ~75tok → links: ball_0007)
- **[reference]** npm 发布流程：四文件版本同步 → build → commit → npm publish — `ball_0002` (B=3.3, ~61tok)
- **[project]** Memory Pool 论文审查状态：6个审稿风险待处理 — `ball_0016` (B=3.2, ~86tok → links: ball_0004, ball_0015)
- **[project]** v1.5.90 发布：Memory Pool 楔形容器与浮球系统 — `ball_0003` (B=2.8, ~36tok → links: ball_0004)
- **[project]** 本项目记忆池已迁移到 v2 格式（pool.json 统一元数据 + 纯 markdown 球文件） — `ball_0018` (B=2.6, ~52tok → links: ball_0004)
- **[project]** 版本历史概要 v1.5.48-v1.5.90 功能时间线 — `ball_0012` (B=2.3, ~64tok)
- **[reference]** WebSocket 协议速查：Client↔Server 消息类型、localhost 预认证 — `ball_0009` (B=1.7, ~102tok)
- **[reference]** 数据存储路径：~/.ccweb/ 全局 + .ccweb/ 项目级 + 环境变量 — `ball_0010` (B=1.7, ~101tok)
- **[reference]** 多用户与分享：admin/register、工作空间隔离、view/edit 权限 — `ball_0011` (B=1.7, ~57tok)
- **[reference]** SkillHub/Backup/Plugin 子系统概要 — `ball_0013` (B=1.7, ~80tok)
- **[reference]** CLI 命令速查 + 开发启动 + 部署方式 — `ball_0014` (B=1.2, ~112tok)

读取内容: `.memory-pool/balls/{id}.md`
探索关系: 通过 links 字段读取关联球