# CC Web — Development Guide

**Current version**: v1.5.92
**Package**: `@tom2012/cc-web`
**License**: MIT

## 记忆池（Memory Pool）

本项目的所有知识、设计决策、架构信息、版本历史、操作规范均由记忆池统一管理。

**每次对话开始时：**
1. 读取 `.memory-pool/QUICK-REF.md` 了解操作规范
2. 读取 `.memory-pool/state.json` 获取当前轮次
3. 读取 `.memory-pool/index.json` 加载活跃层记忆
4. 将活跃层记忆纳入当前对话上下文

**对话过程中：**
- 遇到重要信息时主动提议存入记忆池
- 用户要求记忆操作时参照 QUICK-REF.md 执行
- 每次操作后更新 index.json

**完整规范：** `.memory-pool/SPEC.md`
