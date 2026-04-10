# 插件系统（Plugins）

## 概述

基于 manifest.json 的插件系统，支持前端 UI + 后端路由隔离。

## 插件结构

```
~/.ccweb/plugins/{id}/
├── manifest.json    # ID、版本、权限、入口文件
├── frontend/        # 前端资源（HTML/JS/CSS）
└── backend.js       # 后端路由（可选）
```

## 作用域

- `global` — 全局可见
- `dashboard` — 仅首页
- `project` — 所有项目页
- `project:specific` — 指定项目

## 路由挂载

- 前端：`/plugins/:id/*` → `~/.ccweb/plugins/:id/frontend/*`
- 后端：`/api/plugins/:id/*` → 插件 backend.js 导出的 Router
- 桥接：`/api/plugin-bridge/:pluginId/*` — 前后端消息路由

## 内置插件

- **Pomodoro Timer** — 番茄钟（`plugins/pomodoro/`）

## CLI 工具

- `ccweb-plugin` (`bin/ccweb-plugin.js`) — 插件脚手架

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/plugins` | 列出所有插件 |
| POST | `/api/plugins/:id/config` | 更新插件配置 |
| PUT | `/api/plugins/:id` | 启用/禁用 |
| DELETE | `/api/plugins/:id` | 删除插件 |

## 前端组件

- `PluginDock.tsx` — 插件启动器
- `FloatWindow.tsx` / `FloatManager.tsx` — 可拖拽浮动窗口

## 关键文件

- `backend/src/plugin-manager.ts`
- `backend/src/routes/plugins.ts`
- `backend/src/routes/plugin-bridge.ts`
