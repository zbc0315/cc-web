# 上下文窗口监控

## 概述

通过 Claude Code status line 机制，将上下文使用量实时推送到 ccweb，在项目详情页底部显示进度条。

## 工作原理

1. **HooksManager** 自动配置 Claude Code 的 `settings.json`，添加 `statusLine` 命令
2. statusLine 命令用 `jq` 提取上下文数据，通过 `curl` POST 到 `/api/hooks/context`
3. 后端通过 WebSocket `context_update` 事件推送给前端
4. 前端在终端状态栏显示进度条（绿/黄/红），紧挨 LLM 用量模块左侧

## 数据字段

```json
{
  "usedPercentage": 65,
  "remainingPercentage": 35,
  "contextWindowSize": 200000,
  "inputTokens": 45000,
  "outputTokens": 87000,
  "cacheCreationTokens": 2500,
  "cacheReadTokens": 8900
}
```

## 颜色阈值

- 绿色: < 60%
- 黄色: 60%–80%
- 红色: > 80%

## 关键文件

- `backend/src/hooks-manager.ts` — statusLine 配置注入
- `backend/src/routes/hooks.ts` — `/api/hooks/context` 端点
- 前端状态栏组件（在 ProjectPage 底部）
