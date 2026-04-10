# 记忆池（Memory Pool）— 已停用

## 概述

浮力排序的知识球系统。前端 tab 已 disabled，被信息系统替代。

## 数据模型

- **PoolBall**: 一个知识片段，有 buoyancy（浮力）、links（关联）、permanent 等属性
- **PoolJson**: 池配置，包含 version、initialized_at、lambda 衰减、active_capacity
- **Surface**: 当前活跃球的快照（用于 AI 上下文注入）

## 核心模块

| 文件 | 职责 |
|------|------|
| `pool-manager.ts` | Ball CRUD、buildSurface、tickPool |
| `global-pool-manager.ts` | 跨项目全局池同步 |
| `buoyancy.ts` | 浮力计算 |
| `templates.ts` | QUICK-REF.md / SPEC.md / CLAUDE.md 模板 |
| `pool-lock.ts` | 文件锁（并发安全） |

## 物理可视化

- 前端用 `matter-js` 渲染气泡
- 密度 ∝ 1/B（浮力越高气泡越大越轻）
- 按浮力降序逐个生成（100ms 间隔）

## 存储

```
{project}/.memory-pool/
├── pool.json
├── surface.md
├── QUICK-REF.md
└── balls/
    └── ball_XXXX.md
```

## 停用原因

信息系统提供了更好的对话上下文管理方案，记忆池的手动维护成本过高。
