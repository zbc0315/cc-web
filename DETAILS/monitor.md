# 监控大屏（Monitor Dashboard）

## 概述

首页工具栏切换进入，全屏网格布局，每个项目一个窗口，实时显示聊天活动。

## 功能

- **Running 项目**: WebSocket `chat_subscribe` 实时显示最近 2 轮聊天
- **Stopped 项目**: 从信息 API 加载历史，输入后自动唤醒
- **活跃项目**: 边框显示 `card-active-glow` 渐变动画
- **拖拽排序**: HTML5 DnD + GripVertical 手柄，顺序持久化到 localStorage
- **3 秒 fallback**: WebSocket 无消息 3 秒后自动切换到信息 API

## 状态机

```
STOPPED → (用户输入) → WAKING → (PATCH /start + WS 连接) → LIVE
LIVE → (外部停止) → STOPPED
任意状态 → (错误) → ERROR
```

## 前端组件

- `MonitorDashboard.tsx` — 网格容器、拖拽排序逻辑
- `MonitorPane.tsx` — 单个项目窗口
- `useMonitorWebSocket` — 轻量 hook（只 chat_subscribe，无终端数据）

## 布局

- 网格列：`repeat(N, minmax(0, 1fr))` — 强制等宽（修复过 `1fr` 导致的列宽不等问题）
- 行高：`fitsOnScreen` 时动态 `minmax(180px, ...vh)`，否则固定 `280px`
- 列数由 `calcGrid(count)` 决定：1→1列, 2→2列, 4→2×2, 6→3×2, 9→3×3, 12→4×3

## v-q 改动

- **liveMessages cap 200**（和桌面/手机同批）：长会话下防数组无限增长 + `useChatSession` effect O(n) diff 的 tail pressure
- **`useChatPinnedScroll` 接入**：MonitorPane 从"每次 messages 变化都 force scroll 到底"改为 pinned-scroll（距底 <80px 才贴底；用户向上滚超过 80px 自动解除 pin，再回底重新 pin）。80ms 程序性滚动屏蔽 + ResizeObserver 于 contentRef 兼容流式长内容
- **IME 守卫**：输入框 `onKeyDown` 改用共享 hook `useEnterToSubmit(handleSend, 'enter')`（'enter' 模式：Shift+Enter 提交、Enter 换行，保留 MonitorPane 原设定）。`isComposing / keyCode === 229` 合成期不发（CLAUDE.md #33）
- Monitor 不消费 `approval_request` 事件（view-only 语义；审批仍需切回桌面 / 手机 ChatView）

## 关键文件

- `frontend/src/components/MonitorDashboard.tsx`
- `frontend/src/components/MonitorPane.tsx`
- `frontend/src/hooks/useChatPinnedScroll.ts`（v-q 接入）
- `frontend/src/hooks/useEnterToSubmit.ts`（v-q 接入）
- `frontend/src/lib/chatUtils.ts` — `formatChatContent()`（与手机界面共用）
