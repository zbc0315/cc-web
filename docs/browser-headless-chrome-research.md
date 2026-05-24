# Headless Chrome Phase 0 — Research Summary

**Date:** 2026-05-24
**Verdict:** GO — stack 已定，进 Phase 1。

## 决策

| 选项 | 选定 | 理由 |
|---|---|---|
| 库 | `playwright-core` | MS 全职维护 + CDPSession 一等公民 + cross-browser 备胎；不带默认 chromium download，配合 `npx playwright install chromium` 可控 |
| 帧采集 | CDP `Page.startScreencast`（非 playwright `page.screenshot()` 轮询） | 实测稳定 + 自带 dirty rect 优化；playwright API 不暴露 startScreencast，**必须用 `context.newCDPSession(page)` 走 raw CDP** |
| 帧编码 | JPEG q=70 透传 | 实测 21.6 KB/frame；server 端转 webp 单帧 5-15ms CPU 不值得，v0 跳过 |
| 帧率 | 默认 10fps (`everyNthFrame: 3` from 30fps source) | research/PoC 双确认；15fps 可选用 |
| 输入 | playwright `page.mouse` / `page.keyboard` | 95% 桌面场景够；IME 走 raw CDP `Input.imeSetComposition` Phase 2 跟进 |

## PoC 实测数据 (`/tmp/playwright-poc/poc.mjs`)

| 指标 | 实测 | design 预算 |
|---|---|---|
| chromium 冷启 | 1717ms | <2s ✓ |
| screencast 启动 ack | 4ms | - |
| effective fps | 10.3 (受测试页节奏限制) | 15 fps |
| 帧大小 (1024×768 JPEG q=70) | 21.6 KB | <50 KB ✓ |
| 带宽 | 222 KB/s | <750 KB/s ✓ |
| 30/30 帧成功率 | 100% | - |

## 必修的实现细节（research 已揭示，避免 Phase 1 踩坑）

1. **背压**：`screencastFrameAck` 必须显式 send；否则 backend 不送下一帧。但客户端慢 → daemon 内存堆积，要给 WS sendQueue 加上限。
2. **进程回收**：daemon SIGTERM/SIGKILL 不自动杀 chromium。必须：
   - `process.on('SIGTERM'|'SIGINT')` → `await browser.close({timeout: 5s})` 后 group kill
   - 启 chromium 用 `--disable-dev-shm-usage` 防 /dev/shm 爆
3. **修饰键 bitmask 易踩反**：`1=Alt 2=Ctrl 4=Meta 8=Shift`（注意不是 Shift=1）
4. **键盘事件三件套**：`key` + `code` + `windowsVirtualKeyCode` 全给，少了某些站监听 keyCode 不触发
5. **单字符 text 字段**：`Input.dispatchKeyEvent` 的 `text` 必填，否则输入框无字
6. **macOS Cmd 组合键** headless 常坏：v0 文档说明，Phase 2 再修
7. **内存漂移**：每 50-100 ops 重启 browser；Phase 3 之前可以靠 idle timeout 5min 兜底
8. **IME composition**：playwright 不暴露，Phase 2 必做（中文输入用户必踩）

## 参考实现可借鉴

- `vercel-labs/agent-browser` 已开源 screencast + live preview，直接读源码学结构
- `browserless/browserless` 架构参考（WS queue + session lifecycle + restart 策略）；商用要付费但代码可看

## 风险评估更新

| design doc 风险 | 状态 |
|---|---|
| #1 playwright 170MB | 缓解：用 playwright-core + 手动 install chromium，文档说明 |
| #2 screencast headless 不稳 | **排除** — PoC 100% 帧成功 |
| #3 cold start 慢 | 实测 1.7s，UI 加 spinner OK |
| #4 HiDPI 带宽 | 推迟 Phase 5，v0 锁 1280×800 |
| #5 IME | 确认 Phase 2 风险 |
| #6 崩溃恢复 | 不变 |
| #7 OOM | 不变 |
| #8 第三方 TOS | 不变 |

**新增风险**：
- backend daemon 长跑 chromium 内存漂移 0.5 MB/s（research 数据）→ Phase 3 必须做 N-ops restart

## 进 Phase 1 GO

下一步立刻：装 playwright-core 到 backend → 写 BrowserSessionManager + ChromiumSession + routes/browser-chrome.ts + BrowserPanelChrome.tsx → smoke test → v2026.5.25-a。
