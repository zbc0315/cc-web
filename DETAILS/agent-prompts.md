# Agent Prompts — CLAUDE.md 的"即插即拔"提示词

## 概述

每个项目右侧栏 "Agent Prompts" tab 提供两组可编辑的提示词片段：**全局提示词**（跟用户走）和**项目提示词**（跟项目走）。点击卡片把 prompt 文本**追加到本项目根目录的 CLAUDE.md**；再次点击按**精确文字匹配**从 CLAUDE.md 中删除。如果匹配失败（用户手动编辑过 CLAUDE.md），toast 提示用户自行删除。

这个设计的动机：让用户维护一批可复用的 prompt 模板（类似"系统提示词库"），只在需要某个模板时"插"进 CLAUDE.md，用完再"拔"。和"shortcuts"（一键发送给 CLI）是两个维度的复用。

## 数据模型

```ts
interface AgentPrompt {
  id: string;         // uuid
  label: string;      // 展示名（≤100）
  command: string;    // 原样写入 CLAUDE.md 的文本（≤8000）
  createdAt: string;
}
```

### 存储

| Scope | 路径 | 隔离 |
|---|---|---|
| 全局 (admin) | `~/.ccweb/agent-prompts.json` | —— |
| 全局 (非 admin) | `~/.ccweb/agent-prompts-<sanitized-username>.json` | 按用户名隔离 |
| 项目 | `{projectFolder}/.ccweb/agent-prompts.json` | 跟项目走 |

非 admin 的全局文件名规则和 `global-shortcuts-<user>.json` 完全一致：`username.replace(/[^a-zA-Z0-9_-]/g, '_')`。

## CLAUDE.md 操作

### 插入（idempotent）

- 读 `{folder}/CLAUDE.md`（不存在视为空串；读入时 `CRLF → LF`）
- 若 `content.includes(command)` 已为 true → no-op，返 `{ changed: false }`
- 否则追加：
  - 文件为空 → `content = command + '\n'`
  - 否则 → 前置空行分隔：`content + ('\n\n' | '\n') + command + '\n'`
- atomic write

### 删除（exact match, 三级 fallback）

尝试顺序：
1. 精确匹配我们插入时的形态：`\n\n${command}\n` → 整段剔除
2. 若文件末尾恰好是 `\n\n${command}`（没有结尾 `\n` 的边缘情形）→ 剔除并补一个 `\n`
3. 兜底：`content.includes(command)` → 原样替换一次（可能留下孤立空行）
4. 都失败 → 返 `{ changed: false, reason: 'not-found' }`，前端 toast 提示用户手动删除

> 为什么这样设计？用户明确选择"精确文字匹配"做删除。自动加 marker 反而让 CLAUDE.md 里多出看不见的 HTML 注释。代价是：若用户手动编辑了文本，下次点击删除会命中 not-found。

## 后端 API

挂在 `/api/prompts`，走 `authMiddleware`。

### 全局 CRUD（按登录用户隔离）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 列表（不带 `inserted`，与具体项目无关）|
| POST | `/` | 新建（`{label, command}`）|
| PUT | `/:id` | 更新 |
| DELETE | `/:id` | 删除 |

### 项目 CRUD + CLAUDE.md 操作

权限：admin OR owner OR share `edit`（沿用 `routes/shortcuts.ts` 的 `resolveProjectFolder` 逻辑）。

| 方法 | 路径 | 响应 |
|---|---|---|
| GET | `/project/:projectId` | `{ global: (AgentPrompt & {inserted})[], project: (AgentPrompt & {inserted})[] }` —— 两组均带 `inserted` 标志（服务端 `claudeMd.includes(command)`）|
| POST | `/project/:projectId` | 新建项目 scope |
| PUT | `/project/:projectId/:id` | 更新项目 scope |
| DELETE | `/project/:projectId/:id` | 删除项目 scope（不动 CLAUDE.md）|
| POST | `/project/:projectId/toggle` | body `{text, action: 'insert'|'remove'}` → `{changed, inserted}` 或 `{changed:false, reason:'not-found'|'not-present'}` |

`toggle` **与 prompt 实体解耦**：只关心文本本身，不管它来自 global 还是 project 库。这样一个 prompt 文本如果被复制到多个库里，点击任意一个都走同一路径。

## 前端

- `RightPanel.tsx` → 新增 shadcn `Tabs`：**Shortcuts** / **Agent Prompts**（tab 选择持久化到 `localStorage.cc_right_panel_tab`）
- `AgentPromptsPanel.tsx` → 两个 Section（全局 + 项目），每个 Section 有 "+ 添加" 按钮 + 卡片列表
- `AgentPromptDialog.tsx` → 新建/编辑对话框，复用 ShortcutEditorDialog 的 `modal={false} + noOverlay` 风格（点外部不关闭，只 dim；避免误触）
- `AgentPromptCard` 子组件：
  - `inserted=false` → 虚线边框 + hover 显示 "点击插入 CLAUDE.md"
  - `inserted=true` → 实线蓝色边框 + 勾图标 + hover 显示 "点击从 CLAUDE.md 移除"
  - 右上角 kebab (`MoreVertical`) → 菜单"编辑" / "删除"
  - `pointerdown` outside → 关闭菜单（触控友好）

### 点击卡片的状态机

```
idle
 ├── click (inserted === false)
 │    乐观 UI (inserted=true)
 │    POST /toggle { action: 'insert' }
 │    └── 服务端 refetch 兜底
 │
 └── click (inserted === true)
      乐观 UI (inserted=false)
      POST /toggle { action: 'remove' }
       ├── changed=true → refetch 纠正
       └── changed=false, reason='not-found'
            toast: "CLAUDE.md 中找不到该提示词的精确文本，请自行编辑 CLAUDE.md 移除。"
            refetch 让服务端重算 inserted
```

### 删除 prompt 记录的 confirm

若该 prompt 当前 `inserted=true`，confirm 文案特意提示：
> 此提示词目前已插入当前项目的 CLAUDE.md。删除后它会在 CLAUDE.md 中成为"孤儿文本"——仅删除提示词记录，不会自动从 CLAUDE.md 移除。

confirm 走 **`ConfirmProvider` / `useConfirm`**（见下节），不用 `window.confirm`。

## ConfirmProvider（全局规则）

从这个功能开始，ccweb **所有 confirm 对话框**改用 `@/components/ConfirmProvider` 的 shadcn 方案，不再使用浏览器原生 `window.confirm` / `alert`：

- 原生 `confirm` / `alert` 在全屏（fullscreen API）时会**强制浏览器退出全屏**，终端和监控大屏用户会被打断
- 原生弹窗无法样式化、不能多行、不支持键盘自定义

`useConfirm()` hook 返回异步 `confirm(options)` 函数，API 形如：
```ts
const confirm = useConfirm();
if (await confirm({ description: '...', destructive: true })) { /* 确认 */ }
```

Provider 在 `App.tsx` 根部挂载，全局共享一个 Dialog 实例。该规则已应用到历史残留的 5 处（FileTree、ProjectCard、FilePreviewDialog × 3）。

## 不变式

- 存储文件格式：始终是合法 JSON 数组，读取失败记录 warn 并返空数组
- CLAUDE.md 读写始终走 LF（写入前 `\r\n → \n`）
- `toggle` 的 `insert` 永远幂等（includes 已有则 no-op）
- 非 owner / 非 admin / 非 share-edit 用户访问项目 scope 路由 → 403
- 非 admin 用户的全局提示词与 admin 的物理隔离（文件名不同）

## 关键文件

- `backend/src/types.ts` → `AgentPrompt` 类型
- `backend/src/agent-prompts.ts` → 读写 + CLAUDE.md 操作 helpers
- `backend/src/routes/agent-prompts.ts` → 9 条路由
- `backend/src/index.ts` → 挂 `/api/prompts`
- `frontend/src/lib/api.ts` → 9 个对应函数 + 类型
- `frontend/src/components/AgentPromptDialog.tsx` → 编辑对话框
- `frontend/src/components/AgentPromptsPanel.tsx` → 双 section 主面板
- `frontend/src/components/RightPanel.tsx` → 增加 Tabs 壳
- `frontend/src/components/ConfirmProvider.tsx` → 全局 confirm 基础设施
- `frontend/src/App.tsx` → `<ConfirmProvider>` 挂载
