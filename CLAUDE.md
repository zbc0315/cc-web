# CC Web — Development Guide

**Current version**: v1.5.108
**Package**: `@tom2012/cc-web`
**License**: MIT

## 记忆池（Memory Pool）

本项目已启用记忆池系统，通过 ccweb API 管理。

**每次对话开始时：**
1. 读取 `.memory-pool/QUICK-REF.md` 了解 API 操作规范（含连接发现方式）
2. 读取 `~/.ccweb/port` 获取端口，拼接 `http://localhost:{port}/api/memory-pool/{projectId}/surface` 获取活跃层记忆
3. 按需调用 `POST /balls/{ballId}/hit` 获取具体球内容

**对话过程中：**
- 遇到重要信息时，通过 `POST /balls` 创建新球
- 使用球信息时，通过 `POST /balls/{ballId}/hit` 自动计数
- 不要直接读写 pool.json，所有元数据由 ccweb 管理

**完整规范：** `.memory-pool/SPEC.md`
