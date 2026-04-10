# 计划控制系统（Plan Control）

## 概述

在项目目录下创建 `.plan-control/` 结构，解析任务树并按顺序执行。

## 文件结构

```
.plan-control/
├── main.pc          # 任务树（Markdown 格式）
├── init.md          # 引导文档
├── plan-code.md     # 语法指南
├── output-format.md # 输出格式规范
├── state.json       # 执行状态
├── nodes/           # 节点数据
└── output/          # 执行输出
```

## 任务树语法

Markdown 格式，支持嵌套任务：
- `TreeNodeType`: task / parallel / fork / parallel_fork
- `TreeNodeStatus`: pending / running / done / skipped / nudge

## 核心模块

| 文件 | 职责 |
|------|------|
| `parser.ts` | 解析 main.pc 为 AST（PlanTreeNode） |
| `executor.ts` | 顺序执行节点，处理并行/分支，状态持久化 |
| `checker.ts` | 语法校验 |
| `templates.ts` | 默认模板文件 |

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/projects/:id/plan/init` | 初始化 .plan-control/ |
| GET | `/api/projects/:id/plan/status` | 当前执行状态 |
| POST | `/api/projects/:id/plan/parse` | 解析任务树 |
| POST | `/api/projects/:id/plan/execute` | 开始执行 |
| POST | `/api/projects/:id/plan/pause` | 暂停 |
| POST | `/api/projects/:id/plan/stop` | 停止 |
| POST | `/api/projects/:id/plan/check` | 语法检查 |

## WebSocket 事件

- `plan_status` — 执行状态变更
- `plan_node_update` — 节点状态变更
- `plan_nudge` — 需要用户干预
- `plan_replan` — 需要重新规划

## 前端组件

- `PlanPanel.tsx` — 计划执行面板
- `TaskTree.tsx` — 任务树可视化
- `GraphPreview.tsx` — 依赖图

## 关键文件

- `backend/src/plan-control/executor.ts`
- `backend/src/plan-control/parser.ts`
- `backend/src/routes/plan-control.ts`
- `frontend/src/components/PlanPanel.tsx`
