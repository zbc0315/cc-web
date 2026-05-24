# Headless Chrome Browser Proxy — Design Doc

**Status:** Draft v0 — for user review before any code.
**Author:** Claude (待用户审 + 拍板后启动实现)
**Date:** 2026-05-24
**Supersedes:** Path-based HTTP reverse proxy (v2026.5.24-a/b, `backend/src/routes/browser-proxy.ts`) — that approach is fundamentally incompatible with ES module `import "/abs/path"` resolution and complex SPAs.

---

## 1. 目标 & 非目标

### 目标
1. ccweb 右侧栏 Browser tab 能渲染 daemon 所在机器的 **任意** http(s) 服务，包括复杂 SPA（Vite/React/Vue）、需要 WebSocket 的应用（HMR、Grafana live、Jenkins console）、需要登录态的内网应用。
2. 用户视角：地址栏、前进/后退/刷新、点击/键盘/滚动、复制粘贴；交互延迟可接受（<150ms 端到端）。
3. 安全边界：仅 admin 可用；SSRF 仍限 RFC1918 + loopback；用户隔离（多用户独立 chromium instance）。
4. 部署：daemon 单进程跑，无新增系统依赖（chromium 由 playwright 自动下载 ~170MB）。

### 非目标
- 跨 daemon 复用 chromium（多用户隔离硬性要求）。
- 通用 VNC/RDP 替代品（ccweb iframe 内 only）。
- 离线安装（playwright postinstall 需联网下载 chromium）。
- 移动端触控完整支持（v0 仅鼠标 + 键盘；MobileSidePanel 不接入）。

### 不再支持的 v0 path-based proxy
保留代码 + 旧 cookie/token 端点 deprecation 一版后删。新架构完全独立模块。

---

## 2. 架构概览

```
┌────────────────────┐                              ┌──────────────────────────────┐
│ User's Browser     │                              │ ccweb daemon (192.168.x:3001)│
│ ┌────────────────┐ │                              │ ┌──────────────────────────┐ │
│ │ ccweb main UI  │ │                              │ │ /api/browser-chrome      │ │
│ │ ┌────────────┐ │ │  WebSocket (frames+input)    │ │   POST /_session         │ │
│ │ │BrowserPanel│ │ │ ◄──────────────────────────► │ │   WS  /stream/:sid       │ │
│ │ │ <canvas>   │ │ │                              │ │   POST /input/:sid       │ │
│ │ │            │ │ │                              │ │   POST /nav/:sid {url}   │ │
│ │ └────────────┘ │ │                              │ │   GET  /screenshot/:sid  │ │
│ └────────────────┘ │                              │ └────────────┬─────────────┘ │
└────────────────────┘                              │              │               │
                                                    │              ▼               │
                                                    │ ┌──────────────────────────┐ │
                                                    │ │ BrowserSessionManager    │ │
                                                    │ │  sid → ChromiumSession   │ │
                                                    │ │   - per-user pool        │ │
                                                    │ │   - idle cleanup 5min    │ │
                                                    │ │   - max N sessions       │ │
                                                    │ └────────────┬─────────────┘ │
                                                    │              │               │
                                                    │              ▼               │
                                                    │ ┌──────────────────────────┐ │
                                                    │ │ playwright chromium      │ │
                                                    │ │  - headless              │ │
                                                    │ │  - CDP screencast        │ │
                                                    │ │  - Input.dispatchEvent   │ │
                                                    │ │  - network in daemon's   │ │
                                                    │ │    address space         │ │
                                                    │ └────────────┬─────────────┘ │
                                                    │              │               │
                                                    │              ▼               │
                                                    │ Upstream: 127.0.0.1:5173/    │
                                                    │           192.168.x.x:3000/  │
                                                    │           anywhere LAN/loop  │
                                                    └──────────────────────────────┘
```

**核心思路：** 浏览器不再是用户机器上的 iframe 渲染目标 URL，而是**daemon 机器上**的 headless chromium 渲染，daemon 把 viewport 帧推给用户 iframe 显示；用户输入事件反推给 chromium。

**关键差异 vs path-based proxy：**
- 不再 rewrite HTML/JS/redirect URL — 浏览器在 daemon 上原生加载，所有 absolute path / module / WS 都按 chromium 期望正常工作
- iframe 是 `<canvas>`（用 ImageData 绘制截图帧）而非 `<iframe src=...>` — 完全 same-origin，无 sandbox / CSP / cookie 复杂度
- daemon 网络栈直接是 chromium 的网络栈 — `127.0.0.1` 就是 daemon 机器的 loopback

---

## 3. 阶段拆分（建议按此顺序发版）

### Phase 0: 调研（半天，先于 implementation）
- [ ] playwright vs puppeteer-core + chrome-headless-shell vs CDP-direct（`chrome-remote-interface`）实测：bundle size、启动时延、API 工效
- [ ] CDP `Page.startScreencast` vs `Page.screenshot()` 轮询 — 实测帧率 / CPU
- [ ] 现有 ccweb daemon 启动流量内嵌 chromium 的内存基线
- [ ] WebP vs JPEG vs PNG 帧编码 — 大小 / 解码速度对比

**产出：** 短报告 `docs/browser-headless-chrome-research.md`，决定 stack。

### Phase 1: MVP（1 天）
**Scope:** "URL load + 截图回传 + 点击" 三件套
- [ ] daemon: 装 playwright，单 singleton browser instance（v0 不做多用户隔离）
- [ ] `backend/src/routes/browser-chrome.ts`：
  - `POST /_session` → 创建 page，返回 sid + 初始 viewport size
  - `POST /:sid/nav { url }` → page.goto，限 SSRF (复用 `isAllowedProxyIp`)
  - `WS /stream/:sid` → CDP screencast 帧推送（WebP，~10fps）
  - `POST /:sid/click { x, y }` → CDP `Input.dispatchMouseEvent`
- [ ] `frontend/src/components/BrowserPanel.tsx` 整改：
  - 删 iframe，改 `<canvas>` + 监听 WS 帧 + `ctx.putImageData`
  - 监听 click 事件，转 daemon coords，POST `/:sid/click`
- [ ] backend 单测覆盖：session 创建 / SSRF 拒绝 / click coord 转换
- [ ] **smoke test 必做**（教训 #2）：本地起 Vite dev → ccweb 同机访问 → Browser tab → 看到 Vite 首屏 → 点击链接跳转。

**发版条件：** Vite dev 首屏可见 + 点击导航工作。键盘、滚动、修饰键、复制粘贴 **暂缺**（UI 给提示 "v0 仅支持鼠标点击"）。

### Phase 2: 可用（1 天）
- [ ] 滚动事件（WheelEvent → CDP `Input.dispatchMouseWheelEvent`）
- [ ] 键盘字符输入（KeyboardEvent → CDP `Input.dispatchKeyEvent`，处理 Chinese 输入法 composition）
- [ ] 修饰键组合（Cmd/Ctrl/Shift/Alt + 字母）
- [ ] `<input>`/`<textarea>` 聚焦时键盘事件正确路由
- [ ] viewport resize 适配（ccweb 右侧栏宽度变 → CDP `Emulation.setDeviceMetricsOverride`）
- [ ] 帧率自适应：可见时 15fps，blur 时降 2fps

**发版条件：** 用户能在 chromium 里登录任意内网应用、滚 Grafana 看板、用快捷键。

### Phase 3: 多用户（1 天）
- [ ] `BrowserSessionManager`：per-user instance pool
  - 配置：`maxSessions = 3`，`idleTimeoutMs = 5*60*1000`
  - 入站：`POST /_session` 先看 user 已有 session，复用；无则创建（超 max 返 429）
  - 退出：用户 close BrowserPanel → 不立即 kill，进入 idle 计时；5min 无活动 close browser
- [ ] daemon shutdown hook：杀所有 chromium child process
- [ ] 监控：log per-session memory / page count，超阈值告警

**发版条件：** 多人 LAN 共享 ccweb 时 Browser tab 互不串台 + 内存可预测（≤450MB max for 3 sessions）。

### Phase 4: 稳定（2-3 天）
- [ ] 剪贴板透传（用户在 canvas 里 Ctrl+C → daemon page.evaluate 拿 selection text → 推回前端 → 写主机剪贴板）
- [ ] 文件上传（前端 `<input type=file>` → multipart → daemon 写 tmp → CDP `Input.uploadFile`）
- [ ] 文件下载（chromium download intercept → daemon stream → 前端触发 `<a download>`）
- [ ] context menu（右键 → daemon page.evaluate 探测 → 自定义菜单或 forward 浏览器原生）
- [ ] document title 同步 → ccweb tab badge

### Phase 5: 生产（2-3 天）
- [ ] HiDPI / retina (`deviceScaleFactor`)
- [ ] WebSocket 抖动重连 + 帧缺失重传策略
- [ ] daemon 重启后 session 恢复（持久化 URL，新 session 跳到原 URL；无 in-flight 状态恢复）
- [ ] chromium 下载失败兜底：postinstall 失败时 BrowserPanel 显示 "缺 chromium，手动 `npx playwright install chromium`"
- [ ] 关闭 Browser tab 时 cleanup 不立即但延迟，避免快速切换重建成本

---

## 4. API 设计

### HTTP

```
POST /api/browser-chrome/_session
  Auth: Authorization: Bearer <admin-jwt>
  → 201 { sid: string, viewport: { w, h }, expiresAt }

POST /api/browser-chrome/:sid/nav
  Auth: cookie or query token (来自 _session 响应)
  Body: { url: string }
  → 200 { ok: true, title, url } | 403 { error: 'SSRF blocked' }

POST /api/browser-chrome/:sid/click
  Body: { x, y, button?: 'left'|'right'|'middle', modifiers?: string[] }

POST /api/browser-chrome/:sid/key
  Body: { type: 'keydown'|'keyup'|'char', key, code?, modifiers? }

POST /api/browser-chrome/:sid/scroll
  Body: { x, y, deltaX, deltaY }

POST /api/browser-chrome/:sid/resize
  Body: { w, h }

DELETE /api/browser-chrome/:sid
  → 204
```

### WebSocket

```
WS /api/browser-chrome/stream/:sid?_bp_tok=<jwt>

server → client:
  { type: 'frame', data: <binary WebP/JPEG bytes>, w, h, ts }
  { type: 'nav', url, title }
  { type: 'download', filename, size, downloadId }
  { type: 'cursor', shape: 'pointer'|'text'|... }

client → server:
  { type: 'click', x, y, button, modifiers }    // 替代 HTTP click 减少延迟
  { type: 'key', ... }
  { type: 'scroll', ... }
```

**v0 简化：** 所有 input 走 WS（不要 HTTP），降延迟。HTTP endpoint 仅留 `nav` / `delete` / `_session`。

### 帧编码
- 默认 WebP（chromium 原生支持，比 PNG 小 30-50%、CPU 比 H.264 低）
- 分辨率：viewport 实际像素（不上采样），帧率默认 15fps
- 关键帧策略：CDP screencast 自带 dirty rectangle，无需额外处理

---

## 5. 安全设计

### 认证
- `POST /_session` 要 explicit Bearer admin（同 v-24-b `requireBearerAdmin`）
- sid 是 daemon-generated UUIDv4，仅 issued user 可访问
- WS upgrade 带 `?_bp_tok=<jwt>` 校验 typ='browser-chrome-session'，签字段含 sid + username

### SSRF
- `nav { url }` 解析 URL，对 hostname 走 `resolveAllowedTarget`（复用 v-24-b）
- chromium **不**走 SOCKS/HTTP proxy；它在 daemon 进程空间里直接打 TCP
- chromium 内 JS 用 `fetch()` 打第三方公网：**允许**（用户期望 — Vite dev 从 unpkg.com 拉 CDN 资源是常态）
- chromium 内 JS 打 daemon 自身 API（`/api/projects/...`）：**会成功**（同 origin），但用户已经 admin，无 privilege escalation；旁路风险：被代理网页里恶意 JS 调 ccweb API。**缓解：** chromium 不挂任何 ccweb cookie（fresh user data dir per session）。

### 隔离
- 每 session 一个 chromium browser instance（不是 page），独立 cookies / cache / localStorage
- 用户登出 ccweb → kill 所有 owned sessions
- Per-session 网络 quota: TODO（v0 不做，监控为主）

### 输入校验
- click x/y 范围内（防 negative 触发 CDP undefined behavior）
- modifiers 白名单（仅 `Shift|Control|Alt|Meta`）
- key 字符限可见 ASCII + 已知特殊（Enter/Backspace/Arrow等）

---

## 6. 性能预算

| 指标 | 目标 | 实测前估计 |
|---|---|---|
| daemon 启动后增量内存（无 session） | < 30 MB | playwright lazy load，~30MB |
| 单 session 内存（idle） | < 150 MB | chromium headless baseline |
| 单 session 内存（活跃 SPA） | < 300 MB | Vite + React + DevTools |
| 帧率（活跃） | 15 fps | CDP screencast capped |
| 帧大小（1024×768 WebP q=70） | < 50 KB | 估计 30-50KB |
| 带宽（活跃 15fps） | < 750 KB/s | 50KB × 15 |
| 输入延迟（click → 视觉响应） | < 150ms | WS 50ms + CDP 50ms + 渲染 50ms |

**warning thresholds:** session 内存 > 500MB log warn；> 1GB force kill。

---

## 7. 代码改动清单

### 新增
- `backend/src/browser-chrome/session-manager.ts` — pool + lifecycle
- `backend/src/browser-chrome/chromium-session.ts` — single page wrapper（CDP / events）
- `backend/src/browser-chrome/cdp-input.ts` — keyboard / mouse / scroll forwarder
- `backend/src/browser-chrome/screencast.ts` — CDP screencast → WS bridge
- `backend/src/routes/browser-chrome.ts` — HTTP endpoints
- `backend/src/__tests__/browser-chrome.test.ts` — SSRF, session creation, input coord
- `frontend/src/components/BrowserPanelChrome.tsx` — canvas-based UI（替换现 BrowserPanel）
- `frontend/src/components/browser-chrome/use-chrome-stream.ts` — WS hook
- `frontend/src/components/browser-chrome/use-chrome-input.ts` — pointer/keyboard event capture
- `docs/browser-headless-chrome-research.md` — Phase 0 调研结果

### 修改
- `backend/package.json` — 加 `playwright` 或 `playwright-core` + `playwright-chromium` (~170MB postinstall)
- `backend/src/index.ts` — 挂 router + shutdown hook 杀所有 session
- `frontend/src/components/RightPanel.tsx` — Browser tab 路由切到新组件
- `frontend/src/lib/storage.ts` — keys 保留（兼容 fall-back 到旧 path-based？v0 删旧）

### 删除（v-24-d 后）
- `backend/src/routes/browser-proxy.ts`（保留一版 deprecation 后删）
- `backend/src/__tests__/browser-proxy.test.ts`
- `frontend/src/components/BrowserPanel.tsx`

---

## 8. 风险 & 不确定项

1. **playwright postinstall 体积**：~170MB chromium 下载。已经装 ccweb 的用户 npm update 会拉一次。**缓解：** 文档说明，failed 时 BrowserPanel 友好提示。
2. **CDP screencast 在 headless mode 的稳定性**：playwright 官方 API 是 `page.screenshot()` 而非 screencast，screencast 要 raw CDP；headless Chrome screencast 有过 bug 历史。**缓解：** Phase 0 实测，不行就 fallback 轮询 screenshot（~5fps，体验降级但保底）。
3. **per-user chromium 实例化时延**：cold start 估计 500-1500ms。**缓解：** 预热 1 个空 instance + UI 显示 "启动浏览器…"。
4. **大屏 / HiDPI 带宽**：4K HiDPI 帧可能 500KB+，带宽爆。**缓解：** v0 强制 viewport 1280×800，HiDPI 暂不开。
5. **键盘输入法（中文拼音/五笔）**：composition event 转 CDP 非直观。**缓解：** Phase 2 单独研究，v0 警告 "中文输入支持 Phase 2 跟进"。
6. **daemon 崩溃 → 所有 session 丢**：用户体验差。**缓解：** Phase 5 持久化 last URL，重启后跳回。
7. **chromium 自动 killed by OS OOM**：多用户场景。**缓解：** Phase 3 quota + 监控。
8. **法律 / TOS**：chromium 内打开第三方网站走 daemon IP，被第三方限流时困扰。**缓解：** 文档说明这是 user-driven 行为。

---

## 9. 测试策略

### 单测（vitest）
- `session-manager`: 创建、复用、淘汰、超量返 429
- `cdp-input`: click coord 转换 / modifier 编码
- `screencast`: WS 消息序列化
- `routes/browser-chrome`: SSRF 拒绝公网 / 拒非 admin

### Integration（vitest + 真 playwright）
- 起 dummy http server 提供 HTML
- 起 daemon route + 真 chromium，nav 到 dummy → 截图含特定文字 → 点击 → URL 变化
- **关键：** 不要 mock CDP，要真跑 chromium（教训 #2 又一次）

### E2E（Phase 1 必做）
- 本地起 Vite + ccweb daemon 同机 → 浏览器开 ccweb → Browser tab → 输入 `http://127.0.0.1:5173` → 看到 Vite 首屏 React 计数器 → 点击 + 1 → 计数变 2
- LAN 测试：ccweb 部署机 + Vite 都在 192.168.x.x → 另一台机器浏览器访问 ccweb → 同上验证

---

## 10. Roll-out 计划

- **v2026.5.25-a (Phase 0+1 MVP)**：feature flag `BROWSER_CHROME=1` 才显示新 tab；旧 path-based proxy 仍在。用户授权后实测，验证基本可用。
- **v2026.5.26-a (Phase 2)**：默认开启，旧 path-based proxy tab 改为 fallback 选项（"使用旧版代理"），UI 隐藏除非 query string `?legacy=1`。
- **v2026.5.27-a (Phase 3-4)**：多用户 + 剪贴板/上传下载
- **v2026.5.28-a (Phase 5)**：HiDPI + 重连 + 稳定性
- **v2026.6.1-a (cleanup)**：删 path-based proxy 代码

---

## 11. 待用户拍板的开放问题

1. **playwright vs puppeteer-core**：playwright API 更现代但 dep 大；puppeteer-core 需要自带 chromium。**默认推荐 playwright**，是否同意？
2. **Phase 0 调研一定要做吗**：可以直接进 Phase 1 用 playwright，但调研能避免后期 backout（CDP screencast 不稳就要换路）。**强烈建议做半天**。
3. **MVP 不要键盘可以吗**：Phase 1 仅鼠标点击就能"看 Vite 首屏 + 跳转"，但用户想登录任何应用都要键盘。要不要 Phase 1+2 一起算 MVP（2 天）？
4. **feature flag 命名**：`BROWSER_CHROME=1` 还是直接默认开？
5. **是否保留旧 path-based proxy 作为低耗 fallback**：长期？还是一律换 headless？保留意味着双码路维护成本。**建议** v0+1 阶段双码路，v3 cleanup 删旧。
6. **多用户内存上限**：默认 `maxSessions=3` 够用？或者要 admin 可配置？
7. **chromium 下载策略**：postinstall 阻塞？还是 lazy 首次用时下载（用户友好但首次体验慢）？

---

## 12. Next Steps（待你审完决定）

- 若 GO：明天我开 Phase 0 调研 + Phase 1 实现，先发 v-25-a MVP 让你实测
- 若需要修改：你在这个 doc 上标注 + 我改 v0.2
- 若拒绝（觉得 ROI 不够）：退到 B (subdomain via nip.io) 或 A (维持现有 + 文档限制)
