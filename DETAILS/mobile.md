# 手机界面（Mobile Interface）

## 概述

独立的 `/mobile` 路由，为手机屏幕优化的全屏界面。手机设备自动重定向，桌面用户可通过 Dashboard 手机图标手动进入。

## 页面结构（3 层栈导航）

```
MobilePage.tsx (栈容器 + AnimatePresence 转场)
  ├─ MobileProjectList     项目卡片列表（2 列网格）
  ├─ MobileChatView        聊天界面（从右滑入）
  └─ MobileSidePanel       侧边面板（从右滑入）
       ├─ 上下文用量       进度条 + token 详情
       ├─ API 用量         5h/7d 配额 + 重置倒计时
       └─ MobileFileBrowser 文件浏览（3 列图标网格）
            └─ MobileFilePreview 文件预览（语法高亮/图片/Markdown）
```

## 手机设备自动检测

```typescript
// App.tsx — 模块级常量，只在页面加载时评估一次
const IS_MOBILE_DEVICE =
  window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 768;
```

- `pointer: coarse` = 触摸屏为主输入设备，排除桌面窄窗口
- 手机设备访问 `/` 自动重定向到 `/mobile`（`MobileRedirectGuard`）
- 手机设备隐藏 PluginDock 和桌面模式按钮
- `/settings`、`/skillhub` 等路由不拦截

## PWA 支持

- `manifest.json`: `start_url: /mobile`, `display: standalone`
- PNG 图标: `icon-192.png`, `icon-512.png`（深蓝底 + 蓝色 `>_`）
- `apple-touch-icon` + `apple-mobile-web-app-capable`
- `useMobileViewport` hook: 进入时禁止缩放，离开时恢复

## 数据流

```
useProjectStore ──→ MobileProjectList（项目数据 + 缓存）
useDashboardWebSocket ──→ 实时状态（running/stopped） + 活跃检测（glow 动画）
useMonitorWebSocket ──→ MobileChatView（chat_message + context_update）
getGlobalShortcuts / getProjectShortcuts ──→ 快捷命令栏
getUsage ──→ MobileSidePanel API 用量
browseFilesystem / readFile ──→ MobileFileBrowser / MobileFilePreview
```

## 共享工具

- `lib/chatUtils.ts` — `formatChatContent()`（从 MonitorPane 提取，Mobile + Monitor 共用）
- `useMonitorWebSocket` — 扩展支持 `onContextUpdate` 回调

## 关键文件

- `frontend/src/pages/MobilePage.tsx` — 路由入口 + 栈导航
- `frontend/src/components/mobile/MobileProjectList.tsx` — 项目列表
- `frontend/src/components/mobile/MobileChatView.tsx` — 聊天界面 + 快捷命令
- `frontend/src/components/mobile/MobileSidePanel.tsx` — 侧边面板（上下文 + 用量 + 文件）
- `frontend/src/components/mobile/MobileFileBrowser.tsx` — 文件浏览
- `frontend/src/components/mobile/MobileFilePreview.tsx` — 文件预览
- `frontend/src/lib/chatUtils.ts` — 消息格式化
- `frontend/public/manifest.json` — PWA manifest
- `frontend/public/icon-192.png` / `icon-512.png` — 应用图标
