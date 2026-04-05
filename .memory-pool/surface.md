# Memory Pool Surface

> t=23 | surface_width=10000 | used≈1343 tokens | 18/18 balls

- **[project]** 记忆池设计决策：项目级、列表+浮球、AI操作、消息级轮次、λ=0.97、主动上浮、层满竞争（下沉+分裂） — `ball_0004` (B=8.2, ~64tok → links: ball_0003)
- **[feedback]** 发版严禁遗漏：四文件版本同步、CLAUDE.md 条目、--include=dev、Edit 前 Read — `ball_0005` (B=8.2, ~39tok)
- **[feedback]** 论文生成必须以代码为 ground truth，先生成 CODE_ANALYSIS.md — `ball_0015` (B=8.0, ~51tok → links: ball_0004)
- **[feedback]** 已移除功能——绝不重新引入：Chat SDK/ambient sound/chat tab/Stop button/built-in shortcuts — `ball_0008` (B=7.3, ~63tok)
- **[feedback]** 本项目停止向 GitHub 推送代码，只通过 npm publish 发布 — `ball_0001` (B=7.0, ~14tok)
- **[project]** 核心设计决策：open-with-continue/session tailing/hooks/lazy named export 等 8 条 — `ball_0007` (B=5.7, ~186tok → links: ball_0006)
- **[project]** v1.5.93: 全局记忆池 — ~/.ccweb/memory-pool/ 汇聚所有项目记忆，浮力模型驱动通用经验上浮 — `ball_0017` (B=5.5, ~100tok → links: ball_0004)
- **[project]** cc-web 核心架构：Browser→Express→TerminalManager→node-pty→Claude CLI — `ball_0006` (B=4.8, ~75tok → links: ball_0007)
- **[reference]** npm 发布流程：四文件版本同步 → build → commit → npm publish — `ball_0002` (B=4.6, ~61tok)
- **[project]** Memory Pool 论文审查状态：6个审稿风险待处理 — `ball_0016` (B=4.4, ~86tok → links: ball_0004, ball_0015)
- **[project]** v1.5.90 发布：Memory Pool 楔形容器与浮球系统 — `ball_0003` (B=3.9, ~36tok → links: ball_0004)
- **[project]** 本项目记忆池已迁移到 v2 格式（pool.json 统一元数据 + 纯 markdown 球文件） — `ball_0018` (B=3.6, ~52tok → links: ball_0004)
- **[project]** 版本历史概要 v1.5.48-v1.5.90 功能时间线 — `ball_0012` (B=3.2, ~64tok)
- **[reference]** WebSocket 协议速查：Client↔Server 消息类型、localhost 预认证 — `ball_0009` (B=2.4, ~102tok)
- **[reference]** 数据存储路径：~/.ccweb/ 全局 + .ccweb/ 项目级 + 环境变量 — `ball_0010` (B=2.4, ~101tok)
- **[reference]** 多用户与分享：admin/register、工作空间隔离、view/edit 权限 — `ball_0011` (B=2.4, ~57tok)
- **[reference]** SkillHub/Backup/Plugin 子系统概要 — `ball_0013` (B=2.4, ~80tok)
- **[reference]** CLI 命令速查 + 开发启动 + 部署方式 — `ball_0014` (B=1.6, ~112tok)

读取内容: `.memory-pool/balls/{id}.md`
探索关系: 通过 links 字段读取关联球