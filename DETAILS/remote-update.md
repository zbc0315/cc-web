# 远程自更新（Remote Self-Update）

## 概述

允许 LAN/公网客户端通过浏览器按钮触发完整的更新周期：停止服务 → `npm install -g` → 以相同参数重启。仅 admin 可用。

## 架构

```
浏览器                    后端                           Updater Agent (detached)
  │                        │                                │
  │── POST /execute ──→    │                                │
  │                        │── spawn detached agent ───────→│
  │                        │── 返回 200                     │
  │                        │── SIGUSR2 优雅关闭             │  (等待主进程退出)
  │                        X (进程退出)                      │
  │                                                         │── npm install -g @tom2012/cc-web@latest
  │                                                         │── 写 update-status.json
  │                                                         │── $(npm bin -g)/ccweb start --daemon --{mode}
  │                                                         X (退出)
  │                        │←── (新服务启动) ───────────────│
  │←── 轮询 GET /status ──→│
  │←── {success, newVersion}
```

## 核心设计

### Detached Updater Agent

- **内联脚本**：通过 `node -e "SCRIPT"` 传字符串脚本，主进程 fork 前已载入内存，不受 npm 替换 ccweb 文件影响
- **分离进程**：`spawn(...{ detached: true })` + `child.unref()`，主进程退出后 agent 继续运行
- **关键：显式 cwd**：spawn 和内部 `execSync`/`spawnSync` 全部指定 `cwd: os.homedir()`
  - 历史错误 #11：不指定 cwd → agent 继承主进程的坏 cwd（项目目录可能已删除）→ npm/npx 抛 ENOENT
- **绝对路径 ccweb**：用 `$(npm bin -g)/ccweb` 而非 `npx ccweb`，避免 npx 再触发一次 npm 解析链路

### 启动参数持久化

`bin/ccweb.js` 启动成功后写入 `~/.ccweb/prefs.json`：
```json
{ "lastAccessMode": "public" }
```

agent 从 `process.env.CCWEB_ACCESS_MODE` 读取（注入到脚本字符串），保证重启命令使用相同 access mode。

### 权限与安全

- `POST /api/update/execute` → `isAdminUser(req.user?.username)` 检查
- `GET /api/update/check-running`、`POST /api/update/prepare`、`GET /api/update/status` 也都 admin-only
- accessMode 在 agent 内用白名单验证：`['local','lan','public']`，不在白名单则降级 `local`
- 防重复执行：`updateInProgress` 模块级 flag

### 失败处理

- `installOk` flag 控制 `success: true` 的写入 —— 仅 `npm install` 成功才写 success
- spawnSync 重启检查 `result.status` 和 `result.error`，非零退出标记失败
- status 文件终态（成功/失败）被 GET /status 读取后自动删除
- 重启失败时仍会在 `~/.ccweb/update-agent.log` 记录日志供排查

## 数据流

| 端点 | 方法 | 用途 | 权限 |
|------|------|------|------|
| `/api/update/check-version` | GET | 查询 npm registry 最新版本 vs 当前版本 | admin |
| `/api/update/execute` | POST | 触发更新流程 | admin |
| `/api/update/status` | GET | 读取 agent 写入的结果 | 认证即可（无敏感信息）|
| `/api/update/check-running` | GET | 运行中项目列表 | admin |
| `/api/update/prepare` | POST | 预备（记忆保存）— 当前已不使用 | admin |

### update-status.json

```json
{
  "success": true,
  "completedAt": 1713283200000,
  "previousVersion": "2026.4.18",
  "newVersion": "2026.4.19-a",
  "error": "optional error message"
}
```

## 前端轮询

ChatOverlay 更新按钮流程：
1. 点击 Update → `GET /check-version` → 显示版本对比
2. 用户确认 → `POST /execute` → 200 响应
3. `executing` → `reconnecting` 阶段：每 3 秒 `GET /status` 轮询
4. 收到终态（success/failure）→ `update_complete` / `update_failed` 阶段
5. 显示 "Reload Page" 按钮让用户手动刷新（新前端 bundle 需要刷新加载）

5 分钟超时后标记 `update_failed`。

## 关键文件

- `backend/src/routes/update.ts` — execute + status + check-version 端点 + inline agent 脚本
- `bin/ccweb.js` — `savePrefs({ lastAccessMode })` 持久化
- `frontend/src/components/UpdateButton.tsx` — 前端状态机 + 轮询
- `frontend/src/lib/api.ts` — `executeUpdate`、`getUpdateStatus`、`checkVersion`

## 日志

- `~/.ccweb/update-agent.log` — agent 的 stdout/stderr（包括 npm install 输出）
- `~/.ccweb/update-status.json` — 结构化状态，GET /status 读取后清理

## 非自动更新路径的陷阱（手动 `npm install -g`）

走浏览器 UpdateButton 触发的 "execute" 路径会自己重启 node + 前端资源随之刷新。但如果你直接在终端跑 `npm install -g @tom2012/cc-web@<version>`，没有重启 ccweb 进程时会出现**假阳性"已是最新"**：

- `npm install -g` 只替换磁盘文件，**不**重启运行中的 node 后端
- 后端 `/api/update/check-version` 每次从磁盘读 `package.json.version` → 读到的是**新版本号**
- 后端查 npm registry latest → **同样**是新版本号
- 返回 `updateAvailable: false` → 前端显示"已是最新"
- 但浏览器里 UI bundle 还是旧版（`currentVersion` 是编译期常量，被浏览器缓存住）→ 显示 `Current version v<old> is the latest`

**手动升级后正确操作**：
1. 停掉运行中的 ccweb 后端（`ccweb stop` 或 `kill -TERM <pid>`）
2. 重新 `ccweb start --<access-mode> --daemon`（用升级前的同一 access mode）
3. 浏览器硬刷：Cmd+Shift+R / Ctrl+Shift+R

走 UpdateButton → `/execute` 的自动路径不需要手工干预（detached updater agent 会负责 stop + install + start 三步）。
