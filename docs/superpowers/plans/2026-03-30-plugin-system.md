# Plugin System — Architecture Plan

## 概述

为 ccweb 增加插件系统，支持社区开发和分发浮窗插件。插件运行在 iframe 沙箱中，通过 postMessage bridge 与 ccweb 交互。插件可包含后端模块（Express Router），由 ccweb 在启动时加载。

## 核心设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 隔离方式 | iframe sandbox | 安全隔离，恶意插件无法访问 ccweb DOM/状态 |
| 通信方式 | postMessage bridge | 标准 Web API，可做权限控制 |
| 分发渠道 | 复用 SkillHub GitHub repo | 零额外基础设施 |
| 发布流程 | GitHub Issue 提交，同 SkillHub | 已验证的流程 |
| 后端能力 | 插件可注册 Express Router | 支持系统监控等场景 |
| 浮窗管理 | 多浮窗共存，可拖拽 | 用户确认 |
| 配置分层 | 开发者约束 > 用户自定义 | 用户确认 |
| 脚手架 | `ccweb-plugin create` CLI | 用户确认 |

## 插件包结构

```
my-plugin/
├── manifest.json           # 元数据 + 浮窗约束 + 权限声明
├── frontend/
│   ├── index.html          # iframe 入口
│   └── ...                 # 打包后的 JS/CSS
├── backend/                # 可选
│   └── index.js            # exports: { router, onStart?, onStop? }
└── icon.svg                # 可选，插件图标
```

## manifest.json

```json
{
  "id": "system-monitor",
  "name": "系统监控",
  "version": "1.0.0",
  "author": "tom",
  "description": "实时显示 CPU/内存/磁盘使用率",
  "icon": "icon.svg",

  "type": "float",

  "float": {
    "defaultWidth": 320,
    "defaultHeight": 240,
    "minWidth": 200,
    "minHeight": 150,
    "resizable": true,

    "scope": {
      "allowed": ["global", "dashboard", "project", "project:specific"],
      "default": "global"
    },

    "clickable": {
      "allowed": [true, false],
      "default": true
    }
  },

  "permissions": [
    "project:status",
    "terminal:send",
    "session:read",
    "system:info"
  ],

  "backend": {
    "entry": "backend/index.js"
  },

  "frontend": {
    "entry": "frontend/index.html"
  }
}
```

### 配置分层规则

`manifest.float.scope` 和 `manifest.float.clickable` 各含两个字段：
- `allowed` — 开发者约束的可选范围（数组）
- `default` — 默认值

用户只能在 `allowed` 范围内选择。如果 `allowed` 只有一个值，用户无法修改（开发者锁定）。

## 权限系统

```
project:status    — 读取项目运行状态
project:list      — 列出所有项目
terminal:send     — 向终端发送命令
terminal:output   — 监听终端输出（只读）
session:read      — 读取会话历史
system:info       — CPU/内存/磁盘等系统信息
storage:self      — 插件私有存储（key-value）
```

插件安装时展示所需权限，用户确认后授权。bridge 只转发已授权的 API 调用。

## 架构图

```
┌─────────────────────────────────────────────────────┐
│  Browser                                            │
│                                                     │
│  ┌──────────────┐   ┌──────────────┐                │
│  │ ccweb React  │   │ FloatManager │                │
│  │ (main frame) │   │ (React)      │                │
│  └──────────────┘   └──────┬───────┘                │
│                            │ manages                │
│         ┌──────────────────┼──────────────────┐     │
│         ▼                  ▼                  ▼     │
│  ┌─────────────┐   ┌─────────────┐    ┌───────────┐│
│  │ iframe      │   │ iframe      │    │ iframe    ││
│  │ Plugin A    │   │ Plugin B    │    │ Plugin C  ││
│  │ (sandbox)   │   │ (sandbox)   │    │ (sandbox) ││
│  └──────┬──────┘   └──────┬──────┘    └─────┬─────┘│
│         │ postMessage      │                 │      │
│         ▼                  ▼                 ▼      │
│  ┌─────────────────────────────────────────────┐    │
│  │          PluginBridge (message router)       │    │
│  │  validates permissions → routes to handler   │    │
│  └──────────────────────┬──────────────────────┘    │
│                         │ REST calls                │
│                         ▼                           │
│  ┌──────────────────────────────────────────────┐   │
│  │  Express Server (:3001)                      │   │
│  │                                              │   │
│  │  /api/plugins/:id/*  →  plugin backend       │   │
│  │  /api/plugin-bridge  →  bridge endpoints     │   │
│  │  /plugins/:id/       →  serve frontend files │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## 数据存储

```
~/.ccweb/
├── plugins/                         # 已安装的插件
│   ├── system-monitor/
│   │   ├── manifest.json
│   │   ├── frontend/
│   │   └── backend/
│   └── pomodoro/
│       └── ...
├── plugin-registry.json             # 安装列表 + 用户配置覆盖
│   [
│     {
│       "id": "system-monitor",
│       "version": "1.0.0",
│       "enabled": true,
│       "installedAt": "2026-03-30T...",
│       "userConfig": {
│         "scope": "project",
│         "clickable": false,
│         "projectIds": ["uuid1"],
│         "floatPosition": { "x": 100, "y": 200 },
│         "floatSize": { "w": 320, "h": 240 }
│       }
│     }
│   ]
├── plugin-data/                     # 插件私有持久化数据
│   └── system-monitor/
│       └── data.json
```

## 实现步骤

### Phase 1：后端插件基础设施（最关键路径）

**Step 1.1 — PluginManager（后端核心）**

`backend/src/plugin-manager.ts`

- `loadAll()` — 扫描 `~/.ccweb/plugins/`，读取每个 `manifest.json`，校验 schema
- `loadBackend(plugin)` — `require(plugin.backend.entry)` 获取 Express Router，挂载到 `/api/plugins/:id/`
- `install(zipBuffer)` — 解压到 `~/.ccweb/plugins/:id/`，写入 `plugin-registry.json`
- `uninstall(id)` — 停止后端、删除目录、更新 registry
- `update(id, zipBuffer)` — uninstall + install，保留 userConfig
- `getRegistry()` / `updateUserConfig(id, config)` — 读写用户配置

**Step 1.2 — 插件 API 路由**

`backend/src/routes/plugins.ts`

- `GET /api/plugins` — 已安装插件列表
- `POST /api/plugins/install` — 从 Hub 下载并安装
- `DELETE /api/plugins/:id` — 卸载
- `POST /api/plugins/:id/update` — 更新
- `PUT /api/plugins/:id/config` — 用户配置覆盖（scope/clickable/position/size）
- `GET /api/plugins/:id/data` / `PUT` — 插件私有数据读写

**Step 1.3 — 插件前端文件服务**

`index.ts` 新增静态路由：

```typescript
app.use('/plugins/:id', (req, res, next) => {
  const pluginDir = join(PLUGIN_DIR, req.params.id, 'frontend');
  express.static(pluginDir)(req, res, next);
});
```

**Step 1.4 — Bridge API 端点**

`backend/src/routes/plugin-bridge.ts`

- `GET /api/plugin-bridge/project/status` — 项目状态
- `GET /api/plugin-bridge/project/list` — 项目列表
- `POST /api/plugin-bridge/terminal/send` — 发送终端命令
- `GET /api/plugin-bridge/system/info` — CPU/内存/磁盘
- `GET /api/plugin-bridge/session/:projectId` — 会话历史

每个端点校验请求来源插件的权限声明。

### Phase 2：前端浮窗管理

**Step 2.1 — FloatManager（全局浮窗管理器）**

`frontend/src/components/FloatManager.tsx`

- 挂载在 `App.tsx`（类似 PomodoroController/Overlay）
- 根据当前页面 + 每个插件的 scope 决定显示哪些浮窗
- 每个浮窗渲染为一个 `<FloatWindow>` 组件

scope 匹配逻辑：
```
global        → 所有页面都显示
dashboard     → 仅 DashboardPage
project       → 所有 ProjectPage
project:specific → 仅 userConfig.projectIds 中指定的 ProjectPage
```

**Step 2.2 — FloatWindow 组件**

`frontend/src/components/FloatWindow.tsx`

- 外层：可拖拽容器（复用 TerminalDraftInput 的拖拽模式），可缩放（右下角 resize handle）
- 内层：`<iframe src="/plugins/:id/index.html" sandbox="allow-scripts allow-same-origin" />`
- 标题栏：插件名 + 最小化/关闭按钮 + 拖拽把手
- clickable=false 时：`pointer-events: none` 在 iframe 上（标题栏保持可交互）
- z-index 管理：点击浮窗提升到最高层
- 位置/尺寸持久化到 `plugin-registry.json` via `PUT /api/plugins/:id/config`

**Step 2.3 — PluginBridge（前端 postMessage 路由）**

`frontend/src/lib/plugin-bridge.ts`

```typescript
// 监听所有 iframe 的 postMessage
window.addEventListener('message', (e) => {
  const { pluginId, method, args, callId } = e.data;
  // 校验 origin 合法
  // 校验 pluginId 的权限是否包含该 method
  // 调用 ccweb API
  // 回复结果：iframe.contentWindow.postMessage({ callId, result }, '*')
});
```

**插件端 SDK（注入 iframe）：**

```javascript
// ccweb-plugin-sdk.js — 插件 import 这个
export const ccweb = {
  async getProjectStatus(projectId) {
    return await rpc('project:status', { projectId });
  },
  async sendTerminal(projectId, command) {
    return await rpc('terminal:send', { projectId, command });
  },
  async getSystemInfo() {
    return await rpc('system:info', {});
  },
  // rpc 内部：postMessage + 等待 callId 回复
};
```

### Phase 3：Plugin Hub 集成

**Step 3.1 — Hub 数据结构扩展**

SkillHub 的 `skills.json` 增加 `"plugins"` 分区（或新建 `plugins.json`）：

```json
{
  "id": "system-monitor",
  "name": "系统监控",
  "version": "1.0.0",
  "author": "tom",
  "description": "...",
  "tags": ["monitoring", "system"],
  "downloads": 42,
  "size": "45KB",
  "permissions": ["system:info"],
  "downloadUrl": "plugins/system-monitor/system-monitor-1.0.0.zip"
}
```

**Step 3.2 — Hub 路由扩展**

`backend/src/routes/skillhub.ts` 增加：

- `GET /api/skillhub/plugins` — 获取插件列表（从 GitHub repo 的 `plugins.json`）
- `POST /api/skillhub/plugins/submit` — 提交新插件（GitHub Issue）

**Step 3.3 — Hub UI 页面**

`frontend/src/pages/SkillHubPage.tsx` 增加 tab 切换：技能 | 插件

插件卡片显示：名称、描述、权限标签、版本、大小、安装/更新/卸载按钮。

### Phase 4：脚手架 CLI

**Step 4.1 — `ccweb-plugin` CLI**

```bash
ccweb-plugin create my-plugin    # 交互式创建项目
ccweb-plugin dev                 # 本地开发服务（hot reload）
ccweb-plugin build               # 打包为 zip
ccweb-plugin publish             # 提交到 Hub
```

`create` 生成：
```
my-plugin/
├── manifest.json           # 模板
├── frontend/
│   ├── index.html
│   ├── main.js             # import ccweb-plugin-sdk
│   └── style.css
├── backend/
│   └── index.js            # Express Router 模板
├── package.json
└── README.md
```

### Phase 5：存量迁移

将番茄钟从内置组件迁移为插件，验证完整的插件生命周期。

## 建议实施顺序

```
Phase 1.1 PluginManager ──→ Phase 1.2 API 路由 ──→ Phase 1.3 静态服务
     │
     └──→ Phase 1.4 Bridge API
              │
Phase 2.1 FloatManager ──→ Phase 2.2 FloatWindow ──→ Phase 2.3 PluginBridge
              │
Phase 3.1 Hub 数据 ──→ Phase 3.2 Hub 路由 ──→ Phase 3.3 Hub UI
              │
Phase 4.1 CLI scaffold
              │
Phase 5 番茄钟迁移（验证）
```

Phase 1 + Phase 2 是最小可用版本（能手动安装和运行一个插件）。
Phase 3 加上 Hub（能从社区下载）。
Phase 4 让别人也能开发插件。
Phase 5 验证真实迁移场景。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| iframe 内 postMessage 延迟影响体验 | bridge 用 Promise + callId 异步机制，实测 <1ms |
| 插件后端 crash 拖垮 ccweb | require 插件 Router 时 try-catch，运行时错误隔离在 route handler 内 |
| 恶意插件后端执行任意代码 | 插件从 Hub 安装时展示权限 + README，同 VS Code 信任模型 |
| iframe sandbox 限制过严 | `allow-scripts allow-same-origin` 足够运行 JS + 访问 ccweb API |
| 多浮窗遮挡内容 | 提供最小化到角标、clickable=false（穿透）两种方式 |
