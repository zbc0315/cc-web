# Plan B: 前端架构重组 — 全部完成 ✅

## 总体方案

在保持全部现有功能的前提下，渐进式重组前端架构。

## 完成的所有步骤

### ✅ Step 1: Toast 系统
- 安装 `sonner`，App.tsx 加 `<Toaster>`
- 7 处 `alert()` → `toast.error()`

### ✅ Step 2: localStorage 抽象
- 新建 `lib/storage.ts`（STORAGE_KEYS, getStorage/setStorage/removeStorage, usePersistedState hook）
- 5 个文件的 localStorage 调用全部迁移

### ✅ Step 3: Zustand 全局状态
- 新建 `lib/stores.ts`（useAuthStore, useProjectStore）
- 集成到 api.ts, App.tsx, DashboardPage, LoginPage, ProjectPage

### ✅ Step 4: Error Boundaries
- 新建 `components/ErrorBoundary.tsx`
- App.tsx 顶层包裹

### ✅ Step 5: React.memo + useMemo
- ProjectCard 用 React.memo 包裹
- DashboardPage 的 activeList/archivedList 用 useMemo

### ✅ Step 6: 拆分 ProjectPage
- 新建 `components/ProjectHeader.tsx`（顶栏：状态、音效、备份、启停、面板切换、全屏）
- 新建 `components/TerminalView.tsx`（WS连接、终端、聊天、viewMode、LLM活跃检测、SoundPlayer）
- ProjectPage 从 ~416 行简化为 ~120 行纯布局壳

### ✅ Step 7: 懒加载
- 路由级: React.lazy + Suspense → ProjectPage, SettingsPage, SkillHubPage
- 组件级: ChatView, OfficePreview, GraphPreview 均懒加载
- Build chunk 分割效果:
  - ChatView: 4.41 KB (gzip 1.97 KB)
  - OfficePreview: 5.19 KB (gzip 2.12 KB)
  - GraphPreview: 36 KB (gzip 12.4 KB)
  - SettingsPage: 21 KB (gzip 7.24 KB)
  - SkillHubPage: 6.61 KB (gzip 2.60 KB)
  - xlsx/jszip: 独立 chunk，不在首屏

### ✅ Step 9: Activity WebSocket 推送
- 后端: TerminalManager extends EventEmitter, emit 'activity'（500ms 节流）
- 后端: SessionManager extends EventEmitter, emit 'semantic'
- 后端: 新 `/ws/dashboard` 端点，广播 `activity_update`
- 前端: `useDashboardWebSocket` hook
- 前端: DashboardPage 删除 2s 轮询，改用 WS 订阅

## 新增文件
| 文件 | 用途 |
|------|------|
| `frontend/src/lib/storage.ts` | localStorage 类型安全封装 |
| `frontend/src/lib/stores.ts` | Zustand stores |
| `frontend/src/components/ErrorBoundary.tsx` | 错误边界 |
| `frontend/src/components/ProjectHeader.tsx` | 项目页顶栏 |
| `frontend/src/components/TerminalView.tsx` | 终端+聊天主面板 |

## 新增依赖
- `sonner` (~5KB gzip)
- `zustand` (~2KB gzip)
