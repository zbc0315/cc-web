# 权限审批流（Claude Code PermissionRequest Bridge）

## 概述

Claude Code 的工具权限请求（Bash / Edit / Write 等）在桌面 TUI 里是一个询问对话框。在 ccweb 的遮罩模式下用户看不到 TUI —— 本模块通过 Claude Code 官方 **`PermissionRequest` hook** 拦截请求，将其桥接成一张**遮罩内的审批卡片**（允许 / 拒绝），用户点击后把决定回传给 Claude Code，工具才继续或中止。

Fail-open 设计：任何通道失败（ccweb 未跑 / 项目未注册 / 网络故障 / HMAC 错）→ hook 输出空 JSON `{}` 让 Claude Code 回落到 TUI 原生询问，不留卸载 footgun。

## 系统图

```
Claude Code (interactive, PTY)
   │ 工具发起 → PermissionRequest hook 触发
   ▼
bin/ccweb-approval-hook.js  (Node, 独立进程, 阻塞等待)
   │ 读 stdin JSON (tool_name, tool_use_id, tool_input, session_id, cwd)
   │ 查 ~/.ccweb/port  +  ~/.ccweb/approval-secret  +  ~/.ccweb/projects.json
   │ HMAC-SHA256 签名 body
   │ POST http://127.0.0.1:<port>/api/hooks/approval-request (长连)
   ▼
ccweb backend
   ├─ routes/approval.ts: loopback 校验 + HMAC 验签
   ├─ approval-manager.ts: 注册 pending + 发 approval_request 事件
   │     │
   │     └─ WS 广播到 projectClients(projectId)，跳过 readOnly 客户端
   ▼                               ▼
手机 MobileChatView    桌面 ChatOverlay → ApprovalCard 弹出
   │                               │
   │  点击 Allow / Deny  → POST /api/approval/:pid/:tuid/decide
   ▼                               ▼
approvalManager.decide()  →  resolve 对应 Promise
   │
   ▼
routes/approval.ts → HTTP 200 给 hook 脚本  { behavior: 'allow' | 'deny', message? }
   │
   ▼
hook 脚本 → process.stdout.write(hookSpecificOutput JSON) → exit(0)
   │
   ▼
Claude Code → 工具执行 / 中止
```

## 关键文件

| 文件 | 角色 |
|------|------|
| `bin/ccweb-approval-hook.js` | 独立 Node 脚本，Claude Code 通过 `hooks.PermissionRequest[*].command` 调用 |
| `backend/src/approval-manager.ts` | 内存 Map + HMAC secret 管理 + 事件订阅总线 |
| `backend/src/routes/approval.ts` | 3 条路由（hook / decide / pending） |
| `backend/src/adapters/claude-adapter.ts` | 注册 `PermissionRequest` 事件 + 构造 hook 命令（`${process.execPath} <scriptPath>`） |
| `backend/src/hooks-manager.ts` | 写 `.claude/settings.json` 时带 `timeout: 120` |
| `backend/src/index.ts` | `express.json({ verify })` 捕 raw body + 挂路由 + WS 广播订阅 |
| `frontend/src/components/ApprovalCard.tsx` | 琥珀色卡片 UI |
| `frontend/src/components/ChatOverlay.tsx` | 订阅 `approval_request/resolved` 事件 + `getPendingApprovals` 补拉 |
| `frontend/src/lib/api.ts` | `getPendingApprovals` / `decideApproval` |
| `frontend/src/lib/websocket.ts` | `ApprovalRequestEvent` / `ApprovalResolvedEvent` 类型 + onmessage 分发 |

## 输出格式（Claude Code hook 契约）

### hook 脚本 stdout

**正常审批**：
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": { "behavior": "allow" },
    "message": "optional reason"
  }
}
```
`behavior` 只能 `"allow"` 或 `"deny"`（不存在 `"defer"` —— `PreToolUse` 才有）。  
`message` 是 `decision` 的 **sibling**，不是内层字段。

**回落 TUI（不干预）**：输出空 JSON `{}` 并 exit 0。触发条件：
- 当前 cwd 不是任何 ccweb 项目
- `~/.ccweb/port` 不存在（ccweb 没启动）
- `~/.ccweb/approval-secret` 不存在
- HTTP 请求到 ccweb 失败（超时 / 连不上）

这是 **fail-open** —— 保持 Claude Code 在没有 ccweb 时的原始行为。

### 硬性拒绝（`failClosed`）

仅在 hook 自身状态异常时触发（bad stdin / HMAC 失败等），输出：
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": { "behavior": "deny" },
    "message": "ccweb: <reason>"
  }
}
```

## 安全模型

### 威胁面

ccweb 后端可能绑在 `127.0.0.1`、LAN、或 `public`。hook 脚本只在本机执行，但它调用的 HTTP 端口可能被同网段访问。

### 防护层

1. **Loopback only**：`approval-request` 路由检查 `req.socket.remoteAddress`，只接受 `127.0.0.1` / `::1`。
2. **HMAC-SHA256**：hook 脚本读 `~/.ccweb/approval-secret`（mode 0600，32 bytes hex），对 raw body 签名放进 `X-CCWeb-Signature` header。  
   后端 `approvalManager.verify(raw, sig)` 比对；raw body 通过 `express.json({ verify })` 在**所有 POST**上捕获（无 URL 白名单），避免路径改写绕过。
3. **timing-safe equality**：hex → Buffer，显式长度检查 + `crypto.timingSafeEqual`；绝不抛。
4. **`trust proxy` 告警**：启动时若 Express 启用 `trust proxy` 会打印 warning（proxy 可伪造 remote IP）。
5. **view-only 共享隔离**：
   - `canDecideApproval(projectId, username)` 拒绝非 owner/admin/edit 共享
   - WS 广播跳过 `ws.__readOnly = true` 的客户端（避免工具 input 泄漏）
   - `GET /pending` 对 view-only 返回空数组

### 超时链（向内递减，防抢超时）

| 层级 | 超时 |
|------|------|
| `.claude/settings.json` 配置的 `hooks.PermissionRequest[*].timeout` | 120s |
| hook 脚本 HTTP 请求 | 112s |
| backend `HOOK_TIMEOUT_MS`（`approvalManager.register`） | 110s |

backend 先到期 → 自动返回 `{behavior:'deny', message:'Approval timeout'}` 给 hook → hook 输出 deny → Claude 中止工具。10s 安全冗余。

## 数据结构

### Pending 注册

```ts
type ApprovalRequest = {
  projectId: string;
  toolUseId: string;   // dedup key
  toolName: string;    // Bash / Edit / Write / ...
  toolInput: unknown;  // tool-specific
  sessionId: string;
  createdAt: number;
}
```

键：`${projectId}:${toolUseId}`。duplicate 再次注册自动得到 `{behavior:'deny', message:'Duplicate request'}`。

### 事件

```ts
{ type: 'approval_request',  projectId, toolUseId, toolName, toolInput, sessionId, createdAt }
{ type: 'approval_resolved', projectId, toolUseId, behavior: 'allow'|'deny', reason? }
```

## 路由

| 方法路径 | 调用者 | 鉴权 |
|---------|-------|-----|
| `POST /api/hooks/approval-request` | hook 脚本 | loopback + HMAC，**阻塞**至用户决定或超时 |
| `POST /api/approval/:projectId/:toolUseId/decide` | 前端 | JWT + 项目权限校验（canDecideApproval） |
| `GET /api/approval/:projectId/pending` | 前端 | 同上；view-only 返回空 |

## 前端消费

- `ChatOverlay` mount 时 + 每次 `wsReadyTick` 变化时（WS 重连）`getPendingApprovals(projectId)` 补拉未决列表（应对 WS 断连期间错过的 `approval_request`）
- `approval_request` WS 事件 → 追加到 approvals 数组（`toolUseId` 去重）
- `approval_resolved` → 从数组移除
- 用户点按钮 → `decideApproval(...)` → 后端 resolve Promise → hook 脚本收到 HTTP 响应

## 不变式

- fail-open 三大回落点：`passThroughToTui()` 输出 `{}`，绝不用 `deny` 做降级默认
- raw body 覆盖所有 POST，绝不 fallback 到 `JSON.stringify(req.body)`
- `PermissionRequest` 只接受 `allow` / `deny`，`message` 必为 `decision` 的 sibling
- loopback 检查总是先于 HMAC，HMAC 总是先于 body 解析副作用
- Phase 1 不做"allow always" —— 需要构造 `updatedPermissions: [{type:'addRules',destination:'session'}]` rule，留待 Phase 2

## 已知限制（follow-up 范围）

- **未持久化**：内存 Map，backend 重启 pending 全丢（hook 会按 HTTP 断连后超时 deny）
- **"本会话始终允许"**：未实现（Phase 2 用原生 `updatedPermissions`）
- **审批日志**：目前不进信息系统，审计靠 backend stdout
- **多客户端竞争**：先点者胜；`approval_resolved` 广播让其他客户端移除卡片
- **全局 settings.json 注入**：ccweb 的 hooks 写入 `~/.claude/settings.json`（全局），影响用户所有 Claude 会话。`passThroughToTui()` 保证未匹配项目时自动回落，无功能副作用；只是每次 Claude TUI 权限提示都会 fork 一次 node 进程（开销 ~50-150ms）
