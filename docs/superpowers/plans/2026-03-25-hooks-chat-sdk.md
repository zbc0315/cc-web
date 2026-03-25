# Hooks + Chat SDK 模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Claude Code Hooks 替换 JSONL 定时轮询（即时语义状态），并新增 Chat SDK 项目模式（流式对话，无终端）。

**Architecture:** Phase 1 后端新增 HooksManager + `/api/hooks` 路由，SessionManager 改为事件驱动。Phase 2 后端新增 ChatProcessManager 管理 `claude --print` 子进程及流式输出。Phase 3 前端新增 Chat 模式 UI（输入框、流式渲染、模式切换按钮）。

**Tech Stack:** Node.js/TypeScript, Express, child_process.spawn, React, xterm.js, WebSocket

**Spec:** `docs/superpowers/specs/2026-03-25-hooks-chat-sdk-design.md`

---

## 文件结构

### 新增文件
| 文件 | 职责 |
|------|------|
| `backend/src/hooks-manager.ts` | 管理 `~/.claude/settings.json` hooks 生命周期（幂等 install/uninstall） |
| `backend/src/chat-process-manager.ts` | Claude SDK 子进程管理（spawn/stdin/stdout/crash-restart） |
| `backend/src/routes/hooks.ts` | `POST /api/hooks` 接收 hook 事件（localhost only） |
| `frontend/src/components/ChatInputBar.tsx` | Chat 模式消息输入框组件 |

### 修改文件
| 文件 | 改动摘要 |
|------|---------|
| `backend/src/types.ts` | 新增 `ProjectMode` 类型，`Project` 加 `mode?` 字段 |
| `backend/src/config.ts` | `ProjectConfig` 加 `mode?`，`writeProjectConfig` 写入 mode，fallback `?? 'terminal'` |
| `backend/src/session-manager.ts` | 移除 `setInterval`，新增 `triggerRead()`、`handleHookPreTool()`、`clearSemanticStatus()` |
| `backend/src/index.ts` | 注册 hooks 路由，写/删 port 文件，HooksManager 生命周期，Chat 模式 WS 处理 |
| `backend/src/routes/projects.ts` | 新增 `POST /:id/switch-mode`，CRUD 带 mode 字段 |
| `backend/src/routes/update.ts` | prepare 适配 Chat 模式 |
| `frontend/src/types.ts` | `Project` 加 `mode?` 字段 |
| `frontend/src/lib/api.ts` | 新增 `switchProjectMode()` |
| `frontend/src/lib/websocket.ts` | 新增 Chat 模式消息类型 |
| `frontend/src/components/ChatView.tsx` | 流式 token 追加，tool 事件展示 |
| `frontend/src/components/TerminalView.tsx` | Chat 模式隐藏 Terminal Tab，显示输入框 |
| `frontend/src/components/ProjectHeader.tsx` | 新增模式切换按钮 |
| `frontend/src/components/NewProjectDialog.tsx` | 新增模式选择步骤 |

---

## Phase 1: Hooks 后端

### Task 1: 类型定义 + config.ts 适配

**Files:**
- Modify: `backend/src/types.ts`
- Modify: `backend/src/config.ts`

- [ ] **Step 1: `backend/src/types.ts` 新增 ProjectMode**

```typescript
export type ProjectMode = 'terminal' | 'chat';

export interface Project {
  id: string;
  name: string;
  folderPath: string;
  permissionMode: 'limited' | 'unlimited';
  cliTool: CliTool;
  createdAt: string;
  status: 'running' | 'stopped' | 'restarting';
  mode?: ProjectMode;          // undefined 等价于 'terminal'
  archived?: boolean;
  owner?: string;
  shares?: ProjectShare[];
}
```

- [ ] **Step 2: 阅读 `backend/src/config.ts` 的 ProjectConfig 和 writeProjectConfig**

```bash
grep -n "ProjectConfig\|writeProjectConfig\|readProjectConfig" backend/src/config.ts
```

- [ ] **Step 3: `backend/src/config.ts` 修改 ProjectConfig + writeProjectConfig**

找到 `ProjectConfig` 接口（在 `// ── .ccweb/ per-project config` 区域），新增 mode 字段：

```typescript
interface ProjectConfig {
  id: string;
  name: string;
  permissionMode: 'limited' | 'unlimited';
  cliTool: CliTool;
  createdAt: string;
  mode?: ProjectMode;   // ← 新增
}
```

并在 `writeProjectConfig` 函数中写入 mode：

```typescript
export function writeProjectConfig(folderPath: string, project: Project): void {
  // ... 现有代码 ...
  const config: ProjectConfig = {
    id: project.id,
    name: project.name,
    permissionMode: project.permissionMode,
    cliTool: project.cliTool,
    createdAt: project.createdAt,
    mode: project.mode,   // ← 新增
  };
  // ... 写文件逻辑不变 ...
}
```

在 `config.ts` 顶部 import 中补上 `ProjectMode`（因为 `ProjectMode` 定义在 `types.ts`）：

```typescript
import { Project, Config, CliTool, ProjectMode } from './types';
```

- [ ] **Step 4: 编译验证**

```bash
cd backend && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

期望：无错误

- [ ] **Step 5: commit**

```bash
git add backend/src/types.ts backend/src/config.ts
git commit -m "feat: add ProjectMode type, mode field to Project and ProjectConfig"
```

---

### Task 2: HooksManager

**Files:**
- Create: `backend/src/hooks-manager.ts`

- [ ] **Step 1: 创建 `backend/src/hooks-manager.ts`**

```typescript
/**
 * HooksManager — manages ccweb entries in ~/.claude/settings.json
 *
 * install() is idempotent: always calls uninstall() first, then adds fresh hooks.
 * This handles the crash-without-cleanup scenario correctly.
 *
 * Hook commands include "# ccweb-hook" marker at the end so uninstall()
 * can precisely identify and remove them without touching user-defined hooks.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CLAUDE_SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');
const CCWEB_MARKER = '# ccweb-hook';

const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'Stop'] as const;
type HookEvent = typeof HOOK_EVENTS[number];

/**
 * Build the curl command for each hook event.
 * Note: Stop event does NOT have CLAUDE_SESSION_ID available, so we omit it.
 */
function buildCommand(event: HookEvent, portFile: string): string {
  const baseBody = [
    `\\"event\\":\\"${event}\\"`,
    `\\"dir\\":\\"$CLAUDE_PROJECT_DIR\\"`,
  ];

  // PreToolUse and PostToolUse have CLAUDE_TOOL_NAME and CLAUDE_SESSION_ID
  if (event === 'PreToolUse' || event === 'PostToolUse') {
    baseBody.push(`\\"tool\\":\\"$CLAUDE_TOOL_NAME\\"`);
    baseBody.push(`\\"session\\":\\"$CLAUDE_SESSION_ID\\"`);
  }

  const body = baseBody.join(',');

  return (
    `curl -sf -X POST "http://localhost:$(cat ${portFile})/api/hooks"` +
    ` -H "Content-Type: application/json"` +
    ` -d "{${body}}" || true  ${CCWEB_MARKER}`
  );
}

function readSettings(): Record<string, unknown> {
  if (!fs.existsSync(CLAUDE_SETTINGS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function atomicWrite(data: Record<string, unknown>): void {
  const dir = path.dirname(CLAUDE_SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = CLAUDE_SETTINGS_FILE + `.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, CLAUDE_SETTINGS_FILE);
}

class HooksManager {
  private portFile: string;

  constructor(portFile: string) {
    this.portFile = portFile;
  }

  /** Remove all ccweb hook entries (identified by CCWEB_MARKER) */
  uninstall(): void {
    const settings = readSettings();
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
    let changed = false;

    for (const event of HOOK_EVENTS) {
      const list = (hooks[event] ?? []) as Array<{ hooks?: Array<{ command?: string }> }>;
      const cleaned = list
        .map((group) => ({
          ...group,
          hooks: (group.hooks ?? []).filter((h) => !h.command?.includes(CCWEB_MARKER)),
        }))
        .filter((group) => (group.hooks?.length ?? 0) > 0);

      if (JSON.stringify(cleaned) !== JSON.stringify(list)) {
        hooks[event] = cleaned;
        changed = true;
      }
    }

    if (changed) {
      settings.hooks = hooks;
      atomicWrite(settings);
      console.log('[HooksManager] Uninstalled ccweb hooks');
    }
  }

  /** Idempotent install: remove stale entries first, then add fresh hooks */
  install(): void {
    this.uninstall(); // always clean first — handles crash-without-cleanup

    const settings = readSettings();
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

    for (const event of HOOK_EVENTS) {
      const list = (hooks[event] ?? []) as Array<{ hooks: Array<{ type: string; command: string }> }>;
      list.push({ hooks: [{ type: 'command', command: buildCommand(event, this.portFile) }] });
      hooks[event] = list;
    }

    settings.hooks = hooks;
    atomicWrite(settings);
    console.log('[HooksManager] Installed ccweb hooks');
  }

  isInstalled(): boolean {
    const settings = readSettings();
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
    const list = (hooks['PreToolUse'] ?? []) as Array<{ hooks?: Array<{ command?: string }> }>;
    return list.some((g) => g.hooks?.some((h) => h.command?.includes(CCWEB_MARKER)));
  }
}

export { HooksManager };
```

- [ ] **Step 2: 编译验证**

```bash
cd backend && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

- [ ] **Step 3: commit**

```bash
git add backend/src/hooks-manager.ts
git commit -m "feat: add HooksManager for idempotent ~/.claude/settings.json hooks"
```

---

### Task 3: `/api/hooks` 路由

**Files:**
- Create: `backend/src/routes/hooks.ts`

- [ ] **Step 1: 创建 `backend/src/routes/hooks.ts`**

```typescript
/**
 * POST /api/hooks — receives Claude Code lifecycle hook events.
 * Localhost only (isLocalRequest). No JWT auth needed.
 *
 * Body: { event: string, tool?: string, dir: string, session?: string }
 *
 * Event handling (order matters for Stop):
 *   PreToolUse   → update semanticStatus immediately (NO triggerRead — JSONL not written yet)
 *   PostToolUse  → triggerRead (JSONL now has tool result)
 *   Stop         → clearSemanticStatus first, then triggerRead (read final text without re-setting phase)
 */

import { Router, Request, Response } from 'express';
import { isLocalRequest } from '../auth';
import { getProjects } from '../config';
import { sessionManager } from '../session-manager';

const router = Router();

interface HookBody {
  event?: string;
  tool?: string;
  dir?: string;
  session?: string;
}

function findProjectByDir(dir: string): string | null {
  const projects = getProjects();
  const match = projects.find((p) => p.folderPath === dir);
  return match?.id ?? null;
}

router.post('/', (req: Request, res: Response): void => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const { event, tool, dir } = req.body as HookBody;

  if (!event || !dir) {
    res.status(400).json({ error: 'Missing event or dir' });
    return;
  }

  const projectId = findProjectByDir(dir);
  if (!projectId) {
    // Hook fired from a claude session not managed by ccweb — silently ignore
    res.json({ ok: true });
    return;
  }

  switch (event) {
    case 'PreToolUse':
      // Update semantic status immediately from CLAUDE_TOOL_NAME env var.
      // Do NOT call triggerRead here — JSONL hasn't been written yet.
      sessionManager.handleHookPreTool(projectId, tool ?? '');
      break;

    case 'PostToolUse':
      // JSONL now contains the tool result block — trigger a read.
      sessionManager.triggerRead(projectId);
      break;

    case 'Stop':
      // Clear semantic status FIRST (so any subsequent JSONL read won't re-emit a stale phase).
      // Then read the final text block from JSONL.
      sessionManager.clearSemanticStatus(projectId);
      sessionManager.triggerRead(projectId);
      break;

    default:
      break;
  }

  res.json({ ok: true });
});

export default router;
```

- [ ] **Step 2: 编译验证（Task 4 前会报 sessionManager 缺少方法，属预期）**

```bash
cd backend && npx tsc --noEmit 2>&1 | grep "session-manager\|handleHook\|triggerRead\|clearSemantic" | head -10
```

- [ ] **Step 3: commit**

```bash
git add backend/src/routes/hooks.ts
git commit -m "feat: add POST /api/hooks route for Claude Code hook events"
```

---

### Task 4: 改造 SessionManager（移除轮询，事件驱动）

**Files:**
- Modify: `backend/src/session-manager.ts`

- [ ] **Step 1: 阅读当前 WatchState 定义和 startSession 方法**

```bash
grep -n "pollTimer\|setInterval\|startSession\|stopWatcher" backend/src/session-manager.ts
```

- [ ] **Step 2: 删除 pollTimer 字段和 setInterval 调用**

在 `WatchState` 接口中删除：
```typescript
// 删除此行：
pollTimer: ReturnType<typeof setInterval> | null;
```

在 `startSession()` 末尾删除：
```typescript
// 删除这两行：
state.pollTimer = setInterval(() => this.poll(projectId, folderPath), 2000);
console.log(`[SessionManager] Started session ${sessionId} for project ${projectId}`);
// 改为保留 console.log，删除 setInterval 那行
```

在 `stopWatcher()` 中删除：
```typescript
// 删除此行：
if (state?.pollTimer) clearInterval(state.pollTimer);
```

删除整个私有 `poll()` 方法（它只是调用 `readNewLines`，现在由 `triggerRead` 替代）。

- [ ] **Step 3: 新增 3 个公开方法**

在 `SessionManager` 类中（`registerChatListener` 方法附近）新增：

```typescript
/** Called by hooks route on PreToolUse.
 *  Updates semantic status directly from env var — does NOT read JSONL
 *  (JSONL has not been written yet at this point). */
handleHookPreTool(projectId: string, toolName: string): void {
  const newStatus: SemanticStatus = {
    phase: 'tool_use',
    detail: toolName || undefined,
    updatedAt: Date.now(),
  };
  this.semanticStatus.set(projectId, newStatus);
  this.emit('semantic', { projectId, status: newStatus });
}

/** Called by hooks route on PostToolUse/Stop.
 *  Immediately reads any new lines from the JSONL file. */
triggerRead(projectId: string): void {
  const state = this.watchers.get(projectId);
  if (!state) return;
  // If JSONL not found yet, try once more (handles race where hook fires before first write)
  if (!state.jsonlPath) {
    state.jsonlPath = this.findJsonl(state.folderPath, state.startedAt);
    if (!state.jsonlPath) {
      // Retry once after a short delay as a safety net
      setTimeout(() => {
        const s = this.watchers.get(projectId);
        if (s && !s.jsonlPath) {
          s.jsonlPath = this.findJsonl(s.folderPath, s.startedAt);
          if (s.jsonlPath) { s.fileOffset = 0; this.readNewLines(projectId, s); }
        }
      }, 500);
      return;
    }
    state.fileOffset = 0;
  }
  this.readNewLines(projectId, state);
}

/** Called by hooks route on Stop — clears semantic status before reading final text. */
clearSemanticStatus(projectId: string): void {
  if (!this.semanticStatus.has(projectId)) return;
  this.semanticStatus.delete(projectId);
  this.emit('semantic', { projectId, status: null });
}
```

- [ ] **Step 4: 编译验证**

```bash
cd backend && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

期望：无错误（routes/hooks.ts 的引用错误应消失）

- [ ] **Step 5: commit**

```bash
git add backend/src/session-manager.ts
git commit -m "feat: replace SessionManager polling with event-driven triggerRead + hook handlers"
```

---

### Task 5: index.ts — 注册 hooks 路由，port 文件，HooksManager 生命周期

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: 新增 imports**

```typescript
import hooksRouter from './routes/hooks';
import { HooksManager } from './hooks-manager';
import * as os from 'os';
```

- [ ] **Step 2: 声明 port 文件路径和 HooksManager 实例**

紧随 `initDataDirs()` 之后：

```typescript
// Port file path: always ~/.ccweb/port (fixed path for hook shell commands)
const PORT_FILE = path.join(os.homedir(), '.ccweb', 'port');
const hooksManager = new HooksManager(PORT_FILE);
```

- [ ] **Step 3: 注册 hooks 路由（无 auth）**

在 `app.use('/api/auth', authRouter)` 附近：

```typescript
app.use('/api/hooks', hooksRouter);
```

- [ ] **Step 4: 在成功监听后写 port 文件并安装 hooks**

找到 `server.listen` 的成功回调（形如 `() => { console.log('Server running on port...') }`），在其中新增：

```typescript
// Write port file so hook commands can discover the current port
try {
  const ccwebDir = path.join(os.homedir(), '.ccweb');
  if (!fs.existsSync(ccwebDir)) fs.mkdirSync(ccwebDir, { recursive: true });
  fs.writeFileSync(PORT_FILE, String(actualPort), 'utf-8');
} catch (err) {
  console.error('[Hooks] Failed to write port file:', err);
}
hooksManager.install();
```

- [ ] **Step 5: 在 shutdown 中清理**

找到 `SIGTERM`/`SIGINT` 处理，新增：

```typescript
hooksManager.uninstall();
try { fs.unlinkSync(PORT_FILE); } catch { /* already gone */ }
```

- [ ] **Step 6: 修正 broadcastDashboardSemantic 处理 null status**

```typescript
function broadcastDashboardSemantic(
  projectId: string,
  status: { phase: string; detail?: string; updatedAt: number } | null
) {
  if (dashboardClients.size === 0) return;
  const lastActivityAt = terminalManager.getLastActivityAt(projectId);
  const payload = JSON.stringify({
    type: 'activity_update',
    projectId,
    lastActivityAt: lastActivityAt ?? Date.now(),
    semantic: status ?? undefined,
  });
  for (const client of dashboardClients) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(payload); } catch { /**/ }
    }
  }
}
```

更新 semantic 事件监听的类型签名：

```typescript
sessionManager.on('semantic', ({ projectId, status }: {
  projectId: string;
  status: { phase: string; detail?: string; updatedAt: number } | null
}) => {
  broadcastDashboardSemantic(projectId, status);
});
```

- [ ] **Step 7: 编译验证**

```bash
cd backend && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

- [ ] **Step 8: 手动冒烟测试 Phase 1**

```bash
npm run dev:backend
```

验证：
1. 日志出现 `[HooksManager] Installed ccweb hooks`
2. `cat ~/.claude/settings.json | grep ccweb-hook` 有输出
3. `cat ~/.ccweb/port` 显示端口号
4. 打开 Terminal 模式项目，让 Claude 执行工具 → 后端日志出现 hook 接收记录
5. 停止后端 → `~/.claude/settings.json` 中 ccweb hooks 已移除

- [ ] **Step 9: commit**

```bash
git add backend/src/index.ts
git commit -m "feat: register hooks route, port file lifecycle, HooksManager in index.ts"
```

---

## Phase 2: Chat SDK 后端

### Task 6: ChatProcessManager

**Files:**
- Create: `backend/src/chat-process-manager.ts`

- [ ] **Step 1: 创建 `backend/src/chat-process-manager.ts`**

```typescript
/**
 * ChatProcessManager — manages claude --print SDK subprocess per project.
 *
 * Key design notes:
 * - sessionManager.startSession() is called AFTER system.init is received,
 *   not immediately after spawn (JSONL file doesn't exist yet at spawn time).
 * - tool_result blocks appear in USER-role messages in SDK output, not assistant.
 * - hasTerminal() is the public API name (mirrors TerminalManager.hasTerminal).
 * - Crash restart uses 3s delay; interrupt restart is immediate (500ms).
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { Project } from './types';
import { saveProject } from './config';
import { sessionManager } from './session-manager';

export interface ChatStreamEvent {
  projectId: string;
  type: 'stream' | 'tool_start' | 'tool_end' | 'turn_end' | 'rate_limit' | 'status';
  delta?: string;
  contentType?: 'text' | 'thinking';
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: string;
  costUsd?: number;
  resetsAt?: number;
  status?: string;
}

interface ChatInstance {
  process: ChildProcess;
  project: Project;
  intentionalStop: boolean;
  lastActivityAt: number | null;
  sessionId: string | null;
  pendingToolName: string | null;
  lineBuffer: string;
}

class ChatProcessManager extends EventEmitter {
  private instances = new Map<string, ChatInstance>();
  private restartTimers = new Map<string, ReturnType<typeof setTimeout>>();

  start(project: Project, continueSession = false): void {
    this.stopInternal(project.id, false);

    const args = this.buildArgs(project, continueSession);
    const userShell = process.env.SHELL || '/bin/zsh';

    const proc = spawn(userShell, ['-ilc', args.join(' ')], {
      cwd: project.folderPath,
      env: { ...process.env } as Record<string, string>,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const instance: ChatInstance = {
      process: proc,
      project,
      intentionalStop: false,
      lastActivityAt: null,
      sessionId: null,
      pendingToolName: null,
      lineBuffer: '',
    };

    this.instances.set(project.id, instance);
    project.status = 'running';
    saveProject(project);
    // NOTE: sessionManager.startSession() is called later, when system.init arrives

    proc.stdout?.on('data', (chunk: Buffer) => {
      instance.lastActivityAt = Date.now();
      instance.lineBuffer += chunk.toString('utf-8');
      const lines = instance.lineBuffer.split('\n');
      instance.lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) this.parseLine(project.id, instance, trimmed);
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      console.error(`[ChatProcess ${project.id}] stderr:`, data.toString().slice(0, 200));
    });

    proc.on('exit', (code) => {
      console.log(`[ChatProcess] Exit for ${project.id}, code: ${code}`);
      this.handleExit(project.id);
    });

    console.log(`[ChatProcessManager] Started for project ${project.id}`);
  }

  stop(projectId: string): void {
    this.stopInternal(projectId, true);
  }

  /** Interrupt current generation and immediately restart with --continue */
  interrupt(projectId: string): void {
    const instance = this.instances.get(projectId);
    if (!instance) return;
    // Mark intentionalStop so handleExit doesn't trigger crash-restart
    instance.intentionalStop = true;
    try { instance.process.kill('SIGINT'); } catch { /**/ }
    this.instances.delete(projectId);

    this.emit('event', { projectId, type: 'status', status: 'restarting' } as ChatStreamEvent);

    // Immediate restart (no 3s delay — user-initiated, not a crash)
    setTimeout(() => {
      this.start(instance.project, true);
    }, 500);
  }

  sendMessage(projectId: string, text: string): boolean {
    const instance = this.instances.get(projectId);
    if (!instance?.process.stdin) return false;
    const msg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: text },
    }) + '\n';
    try {
      instance.process.stdin.write(msg);
      return true;
    } catch {
      return false;
    }
  }

  /** Named hasTerminal for API consistency with TerminalManager */
  hasTerminal(projectId: string): boolean {
    return this.instances.has(projectId);
  }

  getLastActivityAt(projectId: string): number | null {
    return this.instances.get(projectId)?.lastActivityAt ?? null;
  }

  private stopInternal(projectId: string, updateStatus: boolean): void {
    const timer = this.restartTimers.get(projectId);
    if (timer) { clearTimeout(timer); this.restartTimers.delete(projectId); }

    const instance = this.instances.get(projectId);
    if (!instance) return;

    instance.intentionalStop = true;
    try { instance.process.kill('SIGTERM'); } catch { /**/ }
    this.instances.delete(projectId);
    sessionManager.stopWatcherForProject(projectId);

    if (updateStatus) {
      instance.project.status = 'stopped';
      saveProject(instance.project);
    }
  }

  private buildArgs(project: Project, continueSession: boolean): string[] {
    const args = [
      'claude',
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
    ];
    if (continueSession) args.push('--continue');
    if (project.permissionMode === 'unlimited') args.push('--dangerously-skip-permissions');
    return args;
  }

  private parseLine(projectId: string, instance: ChatInstance, line: string): void {
    let record: Record<string, unknown>;
    try { record = JSON.parse(line) as Record<string, unknown>; } catch { return; }

    const type = record.type as string;

    // ── system.init: call startSession now (JSONL file is about to be created) ──
    if (type === 'system' && (record.subtype as string) === 'init') {
      instance.sessionId = (record.session_id as string) ?? null;
      sessionManager.startSession(instance.project.id, instance.project.folderPath);
      return;
    }

    // ── assistant messages: text, thinking, tool_use blocks ──
    if (type === 'assistant') {
      const msg = record.message as { content?: unknown[] } | undefined;
      for (const block of (msg?.content ?? []) as Record<string, unknown>[]) {
        const btype = block.type as string;

        if (btype === 'text') {
          const text = (block.text as string) ?? '';
          if (text) {
            this.emit('event', { projectId, type: 'stream', delta: text, contentType: 'text' } as ChatStreamEvent);
          }
        } else if (btype === 'thinking') {
          const thinking = (block.thinking as string) ?? '';
          if (thinking) {
            this.emit('event', { projectId, type: 'stream', delta: thinking, contentType: 'thinking' } as ChatStreamEvent);
          }
        } else if (btype === 'tool_use') {
          const name = (block.name as string) ?? 'tool';
          instance.pendingToolName = name;
          this.emit('event', { projectId, type: 'tool_start', toolName: name, toolInput: block.input } as ChatStreamEvent);
        }
      }
      return;
    }

    // ── user messages: tool_result blocks (SDK returns tool results as user-role messages) ──
    if (type === 'user') {
      const msg = record.message as { role?: string; content?: unknown[] } | undefined;
      if (msg?.role !== 'tool') return; // only process tool result messages
      for (const block of (msg?.content ?? []) as Record<string, unknown>[]) {
        if ((block.type as string) === 'tool_result') {
          const content = block.content;
          const output = typeof content === 'string' ? content : JSON.stringify(content).slice(0, 500);
          this.emit('event', {
            projectId,
            type: 'tool_end',
            toolName: instance.pendingToolName ?? 'tool',
            toolOutput: output,
          } as ChatStreamEvent);
          instance.pendingToolName = null;
        }
      }
      return;
    }

    // ── result: turn complete ──
    if (type === 'result') {
      this.emit('event', { projectId, type: 'turn_end', costUsd: (record.total_cost_usd as number) ?? 0 } as ChatStreamEvent);
      return;
    }

    // ── rate_limit_event ──
    if (type === 'rate_limit_event') {
      const info = record.rate_limit_info as { resetsAt?: number } | undefined;
      if (info?.resetsAt) {
        this.emit('event', { projectId, type: 'rate_limit', resetsAt: info.resetsAt } as ChatStreamEvent);
      }
    }
  }

  private handleExit(projectId: string): void {
    const instance = this.instances.get(projectId);
    if (!instance || instance.intentionalStop) {
      this.instances.delete(projectId);
      return;
    }

    const { project } = instance;
    this.instances.delete(projectId);

    project.status = 'restarting';
    saveProject(project);
    this.emit('event', { projectId, type: 'status', status: 'restarting' } as ChatStreamEvent);

    console.log(`[ChatProcessManager] Auto-restarting ${projectId} with --continue in 3s...`);
    const timer = setTimeout(() => {
      this.restartTimers.delete(projectId);
      if (!this.instances.has(projectId)) this.start(project, true);
    }, 3000);
    this.restartTimers.set(projectId, timer);
  }
}

export const chatProcessManager = new ChatProcessManager();
```

- [ ] **Step 2: 编译验证**

```bash
cd backend && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

- [ ] **Step 3: commit**

```bash
git add backend/src/chat-process-manager.ts
git commit -m "feat: add ChatProcessManager for claude --print SDK subprocess"
```

---

### Task 7: projects 路由 — mode 字段 + switch-mode

**Files:**
- Modify: `backend/src/routes/projects.ts`

- [ ] **Step 1: 在顶部 import 中新增**

```typescript
import { chatProcessManager } from '../chat-process-manager';
import { ProjectMode } from '../types';
```

- [ ] **Step 2: 在创建项目（POST /api/projects）中接受 mode 字段**

找到构造 `project` 对象的地方，新增：

```typescript
mode: (req.body.mode === 'chat' ? 'chat' : 'terminal') as ProjectMode,
```

- [ ] **Step 3: 新增 switch-mode 路由**

在 `export default router` 前新增：

```typescript
// POST /api/projects/:id/switch-mode
router.post('/:id/switch-mode', async (req: AuthRequest, res: Response): Promise<void> => {
  const project = getProject(req.params.id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  if (!isProjectOwner(project, req.user?.username)) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  const newMode = req.body.mode === 'chat' ? 'chat' : 'terminal';
  if (project.mode === newMode) { res.json(project); return; }

  // Stop current process
  if (project.mode === 'chat') {
    chatProcessManager.stop(project.id);
  } else {
    terminalManager.stop(project.id);
  }

  // Update mode and persist
  project.mode = newMode as ProjectMode;
  saveProject(project);
  writeProjectConfig(project.folderPath, project);

  // Restart in new mode with --continue (context preserved via same session JSONL)
  if (newMode === 'chat') {
    chatProcessManager.start(project, true);
  } else {
    // rawBroadcast is set to empty fn here; first WS subscriber will replace it via updateBroadcast
    terminalManager.getOrCreate(project, () => {});
  }

  res.json(project);
});
```

- [ ] **Step 4: 编译验证**

```bash
cd backend && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

- [ ] **Step 5: commit**

```bash
git add backend/src/routes/projects.ts
git commit -m "feat: add mode field to project creation and switch-mode endpoint"
```

---

### Task 8: update 路由适配 Chat 模式

**Files:**
- Modify: `backend/src/routes/update.ts`

- [ ] **Step 1: 新增 import**

```typescript
import { chatProcessManager } from '../chat-process-manager';
```

- [ ] **Step 2: 修改 check-running 包含 Chat 模式项目**

```typescript
const running = projects.filter((p) => {
  if (p.status !== 'running') return false;
  return terminalManager.hasTerminal(p.id) || chatProcessManager.hasTerminal(p.id);
});
```

- [ ] **Step 3: 修改 prepare 中的循环，跳过 Chat 模式的 writeRaw**

```typescript
if (project.mode === 'chat') {
  // Chat mode has no PTY — stop directly (no memory-save command needed)
  chatProcessManager.stop(project.id);
  status.status = 'ready';
  status.message = 'Chat mode — stopped directly';
} else {
  // Terminal mode — existing logic unchanged
  terminalManager.writeRaw(project.id, MEMORY_SAVE_COMMAND);
  status.status = 'waiting_idle';
  const idle = await waitForIdle(project.id, IDLE_THRESHOLD_MS, MAX_WAIT_MS);
  status.status = 'ready';
  status.message = idle ? 'Memory saved — will resume after update' : 'Timed out — will resume after update';
}
```

- [ ] **Step 4: 编译验证**

```bash
cd backend && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

- [ ] **Step 5: commit**

```bash
git add backend/src/routes/update.ts
git commit -m "feat: adapt update/prepare route for Chat mode projects"
```

---

### Task 9: index.ts — Chat 模式 WebSocket 处理

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: 新增 import**

```typescript
import { chatProcessManager, ChatStreamEvent } from './chat-process-manager';
```

- [ ] **Step 2: 注册 ChatProcessManager 事件转发**

在 `sessionManager.on('semantic', ...)` 之后新增：

```typescript
chatProcessManager.on('event', (evt: ChatStreamEvent) => {
  const clients = projectClients.get(evt.projectId);
  if (!clients?.size) return;

  let payload: string;
  switch (evt.type) {
    case 'stream':
      payload = JSON.stringify({ type: 'chat_stream', delta: evt.delta, contentType: evt.contentType });
      break;
    case 'tool_start':
      payload = JSON.stringify({ type: 'chat_tool_start', name: evt.toolName, input: evt.toolInput });
      break;
    case 'tool_end':
      payload = JSON.stringify({ type: 'chat_tool_end', name: evt.toolName, output: evt.toolOutput });
      break;
    case 'turn_end':
      payload = JSON.stringify({ type: 'chat_turn_end', cost_usd: evt.costUsd });
      break;
    case 'rate_limit':
      payload = JSON.stringify({ type: 'chat_rate_limit', resetsAt: evt.resetsAt });
      break;
    case 'status':
      payload = JSON.stringify({ type: 'status', status: evt.status });
      break;
    default:
      return;
  }

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(payload); } catch { /**/ }
    }
  }
});
```

- [ ] **Step 3: 在 Project WS message handler 中新增 chat_input / chat_interrupt**

在 `ws.on('message', ...)` 的 switch 中新增：

```typescript
case 'chat_input': {
  const { text } = parsed as { text: string };
  if (project.mode === 'chat' && text?.trim()) {
    chatProcessManager.sendMessage(projectId, text.trim());
  }
  break;
}
case 'chat_interrupt': {
  if (project.mode === 'chat') {
    chatProcessManager.interrupt(projectId);
  }
  break;
}
```

- [ ] **Step 4: 在 WS 连接时根据 mode 启动正确进程**

找到 `terminal_subscribe` 处理（或 WS 连接后启动进程的逻辑），区分模式：

```typescript
// Terminal mode: init PTY
if (project.mode !== 'chat') {
  terminalManager.getOrCreate(project, rawBroadcast);
} else {
  // Chat mode: ensure ChatProcessManager is running
  if (!chatProcessManager.hasTerminal(projectId)) {
    chatProcessManager.start(project, project.status === 'running');
  }
}
```

- [ ] **Step 5: 在 resumeAll 中包含 Chat 模式项目**

找到 `terminalManager.resumeAll()` 调用处，在其后新增：

```typescript
for (const project of getProjects()) {
  if ((project.status === 'running' || project.status === 'restarting') && project.mode === 'chat') {
    chatProcessManager.start(project, true);
  }
}
```

- [ ] **Step 6: 编译验证**

```bash
cd backend && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

- [ ] **Step 7: 后端完整冒烟测试**

```bash
npm run dev:backend
```

验证：
1. Hooks 安装正常（见 Task 5 Step 8）
2. 调用 `POST /api/projects` 带 `"mode":"chat"` 创建项目，返回 project 含 mode 字段
3. Chat 项目的 WS 连接后日志显示 `[ChatProcessManager] Started`
4. 发送 `{"type":"chat_input","text":"hello"}` WS 消息，ChatProcessManager stdin 接收
5. 调用 `POST /api/projects/:id/switch-mode {"mode":"terminal"}` 成功切换

- [ ] **Step 8: commit**

```bash
git add backend/src/index.ts
git commit -m "feat: wire ChatProcessManager events to WS, handle chat_input/interrupt, mode-aware process startup"
```

---

## Phase 3: 前端

### Task 10: 类型和 API

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: 阅读 frontend/src/types.ts**

```bash
cat frontend/src/types.ts
```

- [ ] **Step 2: frontend/src/types.ts 新增 mode 字段**

```typescript
export type ProjectMode = 'terminal' | 'chat';

export interface Project {
  id: string;
  name: string;
  folderPath: string;
  permissionMode: 'limited' | 'unlimited';
  cliTool: CliTool;
  createdAt: string;
  status: 'running' | 'stopped' | 'restarting';
  mode?: ProjectMode;
  archived?: boolean;
  owner?: string;
  shares?: ProjectShare[];
  _sharedPermission?: 'view' | 'edit';
}
```

- [ ] **Step 3: api.ts 新增 switchProjectMode**

```typescript
import { Project, CliTool, ProjectMode } from '../types';

export async function switchProjectMode(id: string, mode: ProjectMode): Promise<Project> {
  return request<Project>('POST', `/api/projects/${id}/switch-mode`, { mode });
}
```

- [ ] **Step 4: 编译验证**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

- [ ] **Step 5: commit**

```bash
git add frontend/src/types.ts frontend/src/lib/api.ts
git commit -m "feat: add ProjectMode type and switchProjectMode API"
```

---

### Task 11: WebSocket — Chat 消息类型

**Files:**
- Modify: `frontend/src/lib/websocket.ts`

- [ ] **Step 1: 扩展 IncomingMessage 联合类型**

```typescript
| { type: 'chat_stream'; delta: string; contentType: 'text' | 'thinking' }
| { type: 'chat_tool_start'; name: string; input: unknown }
| { type: 'chat_tool_end'; name: string; output: string }
| { type: 'chat_turn_end'; cost_usd: number }
| { type: 'chat_rate_limit'; resetsAt: number }
```

- [ ] **Step 2: 扩展 UseProjectWebSocketOptions**

```typescript
onChatStream?: (delta: string, contentType: 'text' | 'thinking') => void;
onChatToolStart?: (name: string, input: unknown) => void;
onChatToolEnd?: (name: string, output: string) => void;
onChatTurnEnd?: (costUsd: number) => void;
onChatRateLimit?: (resetsAt: number) => void;
```

- [ ] **Step 3: 在 ws.onmessage switch 中处理新类型**

```typescript
case 'chat_stream': {
  const m = parsed as { delta: string; contentType: 'text' | 'thinking' };
  optionsRef.current.onChatStream?.(m.delta, m.contentType);
  break;
}
case 'chat_tool_start': {
  const m = parsed as { name: string; input: unknown };
  optionsRef.current.onChatToolStart?.(m.name, m.input);
  break;
}
case 'chat_tool_end': {
  const m = parsed as { name: string; output: string };
  optionsRef.current.onChatToolEnd?.(m.name, m.output);
  break;
}
case 'chat_turn_end': {
  const m = parsed as { cost_usd: number };
  optionsRef.current.onChatTurnEnd?.(m.cost_usd);
  break;
}
case 'chat_rate_limit': {
  const m = parsed as { resetsAt: number };
  optionsRef.current.onChatRateLimit?.(m.resetsAt);
  break;
}
```

- [ ] **Step 4: 新增 sendChatInput 和 sendChatInterrupt，加入返回值**

```typescript
const sendChatInput = useCallback((text: string) => {
  rawSend({ type: 'chat_input', text });
}, [rawSend]);

const sendChatInterrupt = useCallback(() => {
  rawSend({ type: 'chat_interrupt' });
}, [rawSend]);

// 加入 return { ..., sendChatInput, sendChatInterrupt }
```

- [ ] **Step 5: 编译验证**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

- [ ] **Step 6: commit**

```bash
git add frontend/src/lib/websocket.ts
git commit -m "feat: add Chat SDK message types and send methods to WebSocket hook"
```

---

### Task 12: ChatInputBar 组件

**Files:**
- Create: `frontend/src/components/ChatInputBar.tsx`

- [ ] **Step 1: 创建组件**

```tsx
import { useState, useRef, KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Square } from 'lucide-react';

interface ChatInputBarProps {
  onSend: (text: string) => void;
  onInterrupt: () => void;
  isGenerating: boolean;
  disabled?: boolean;
}

export function ChatInputBar({ onSend, onInterrupt, isGenerating, disabled }: ChatInputBarProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled || isGenerating) return;
    onSend(trimmed);
    setText('');
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t bg-background p-3 flex gap-2 items-end">
      <Textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="发送消息… (Enter 发送，Shift+Enter 换行)"
        className="resize-none min-h-[60px] max-h-[200px] text-sm"
        disabled={disabled || isGenerating}
        rows={2}
      />
      {isGenerating ? (
        <Button size="sm" variant="destructive" onClick={onInterrupt} title="中断生成" className="shrink-0">
          <Square className="h-4 w-4" />
        </Button>
      ) : (
        <Button size="sm" onClick={handleSend} disabled={!text.trim() || disabled} className="shrink-0">
          <Send className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 编译验证**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

- [ ] **Step 3: commit**

```bash
git add frontend/src/components/ChatInputBar.tsx
git commit -m "feat: add ChatInputBar component for Chat mode input"
```

---

### Task 13: ChatView — 流式渲染

**Files:**
- Modify: `frontend/src/components/ChatView.tsx`

- [ ] **Step 1: 阅读当前 ChatView**

```bash
cat frontend/src/components/ChatView.tsx
```

- [ ] **Step 2: 新增流式 props**

```tsx
interface ChatViewProps {
  // ... 现有 props 保持不变 ...
  streamingText?: string;       // 正在流式输出的 text 累积内容
  streamingThinking?: string;   // 正在流式输出的 thinking 内容
  isGenerating?: boolean;
  currentToolName?: string | null;
}
```

- [ ] **Step 3: 在消息列表末尾渲染流式 bubble**

```tsx
{isGenerating && (streamingText || streamingThinking || currentToolName) && (
  <div className="flex flex-col gap-1 px-2">
    {currentToolName && (
      <div className="text-xs text-blue-500 px-3 py-1 bg-blue-50 dark:bg-blue-950/30 rounded-md">
        🔧 {currentToolName}...
      </div>
    )}
    {streamingThinking && (
      <div className="text-xs text-muted-foreground italic px-3 py-1 bg-muted/40 rounded-md line-clamp-3">
        💭 {streamingThinking}
      </div>
    )}
    {streamingText && (
      <div className="text-sm px-3 py-2 bg-muted/20 border rounded-lg whitespace-pre-wrap">
        {streamingText}
        <span className="inline-block w-1.5 h-4 bg-foreground/70 ml-0.5 align-middle animate-pulse" />
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4: 编译验证**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

- [ ] **Step 5: commit**

```bash
git add frontend/src/components/ChatView.tsx
git commit -m "feat: add streaming token display to ChatView"
```

---

### Task 14: TerminalView — Chat 模式 UI 集成

**Files:**
- Modify: `frontend/src/components/TerminalView.tsx`

- [ ] **Step 1: 阅读当前 TerminalView**

```bash
cat frontend/src/components/TerminalView.tsx
```

- [ ] **Step 2: 新增流式状态**

```tsx
const [streamingText, setStreamingText] = useState('');
const [streamingThinking, setStreamingThinking] = useState('');
const [isGenerating, setIsGenerating] = useState(false);
const [currentToolName, setCurrentToolName] = useState<string | null>(null);
```

- [ ] **Step 3: 在 useProjectWebSocket 中接入 Chat 回调**

```tsx
onChatStream: (delta, contentType) => {
  if (contentType === 'thinking') setStreamingThinking(prev => prev + delta);
  else setStreamingText(prev => prev + delta);
  setIsGenerating(true);
},
onChatToolStart: (name) => {
  setCurrentToolName(name);
  setIsGenerating(true);
},
onChatToolEnd: () => {
  setCurrentToolName(null);
},
onChatTurnEnd: () => {
  setIsGenerating(false);
  setStreamingText('');
  setStreamingThinking('');
  setCurrentToolName(null);
},
```

- [ ] **Step 4: Chat 模式下渲染 ChatInputBar，隐藏 Terminal Tab**

```tsx
const isChatMode = project.mode === 'chat';

// 在 Tab bar 处：
{!isChatMode && (
  // 现有 Terminal / Chat tab 切换按钮
)}

// 在底部：
{isChatMode && (
  <ChatInputBar
    onSend={(text) => {
      sendChatInput(text);
      setIsGenerating(true);
      setStreamingText('');
      setStreamingThinking('');
    }}
    onInterrupt={sendChatInterrupt}
    isGenerating={isGenerating}
    disabled={project.status !== 'running'}
  />
)}
```

- [ ] **Step 5: 将 streamingText 等 props 传给 ChatView**

```tsx
<ChatView
  // ... 现有 props ...
  streamingText={isChatMode ? streamingText : undefined}
  streamingThinking={isChatMode ? streamingThinking : undefined}
  isGenerating={isChatMode ? isGenerating : undefined}
  currentToolName={isChatMode ? currentToolName : undefined}
/>
```

- [ ] **Step 6: 编译验证**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

- [ ] **Step 7: commit**

```bash
git add frontend/src/components/TerminalView.tsx
git commit -m "feat: integrate Chat mode streaming UI into TerminalView"
```

---

### Task 15: ProjectHeader — 模式切换按钮

**Files:**
- Modify: `frontend/src/components/ProjectHeader.tsx`

- [ ] **Step 1: 阅读当前 ProjectHeader**

```bash
cat frontend/src/components/ProjectHeader.tsx
```

- [ ] **Step 2: 新增 import**

```tsx
import { switchProjectMode } from '@/lib/api';
import { MessageSquare, Terminal } from 'lucide-react';
```

- [ ] **Step 3: 新增切换逻辑和按钮**

```tsx
const [switching, setSwitching] = useState(false);

const handleSwitchMode = async () => {
  setSwitching(true);
  try {
    const newMode = project.mode === 'chat' ? 'terminal' : 'chat';
    const updated = await switchProjectMode(project.id, newMode);
    onUpdated?.(updated);
    toast.success(`已切换到 ${newMode === 'chat' ? 'Chat' : 'Terminal'} 模式`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '切换失败');
  } finally {
    setSwitching(false);
  }
};

// 在 Start/Stop 按钮附近：
<Button
  variant="outline"
  size="sm"
  onClick={handleSwitchMode}
  disabled={switching || project.status === 'stopped'}
  title={project.mode === 'chat' ? '切换到 Terminal 模式' : '切换到 Chat 模式'}
>
  {switching
    ? <span className="text-xs animate-spin inline-block">⟳</span>
    : project.mode === 'chat'
      ? <Terminal className="h-4 w-4" />
      : <MessageSquare className="h-4 w-4" />
  }
</Button>
```

- [ ] **Step 4: 编译验证**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

- [ ] **Step 5: commit**

```bash
git add frontend/src/components/ProjectHeader.tsx
git commit -m "feat: add mode switch button to ProjectHeader"
```

---

### Task 16: NewProjectDialog — 模式选择

**Files:**
- Modify: `frontend/src/components/NewProjectDialog.tsx`

- [ ] **Step 1: 阅读当前 NewProjectDialog**

```bash
cat frontend/src/components/NewProjectDialog.tsx
```

- [ ] **Step 2: 新增 mode state 和 import**

```tsx
import { ProjectMode } from '@/types';
import { MessageSquare, Terminal } from 'lucide-react';

const [mode, setMode] = useState<ProjectMode>('terminal');
```

- [ ] **Step 3: 在对话框中插入模式选择 UI**

在现有步骤（权限选择）后新增模式选择：

```tsx
<div className="space-y-2">
  <label className="text-sm font-medium">项目模式</label>
  <div className="grid grid-cols-2 gap-2">
    {(['terminal', 'chat'] as const).map((m) => (
      <button
        key={m}
        type="button"
        onClick={() => setMode(m)}
        className={`p-3 border rounded-lg text-left text-sm transition-colors ${
          mode === m
            ? 'border-primary bg-primary/5 text-foreground'
            : 'border-border text-muted-foreground hover:border-muted-foreground'
        }`}
      >
        {m === 'terminal'
          ? <Terminal className="h-4 w-4 mb-1" />
          : <MessageSquare className="h-4 w-4 mb-1" />
        }
        <div className="font-medium capitalize">{m === 'terminal' ? 'Terminal' : 'Chat'}</div>
        <div className="text-xs">
          {m === 'terminal' ? '完整终端体验' : '流式对话，无终端'}
        </div>
      </button>
    ))}
  </div>
</div>
```

- [ ] **Step 4: 在提交时带上 mode**

在创建项目的 API 调用中新增 `mode` 字段：

```typescript
// 在 request body 中加：
mode,
```

- [ ] **Step 5: 编译验证**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

- [ ] **Step 6: commit**

```bash
git add frontend/src/components/NewProjectDialog.tsx
git commit -m "feat: add Terminal/Chat mode selection to NewProjectDialog"
```

---

## Phase 4: 构建验证与发布

### Task 17: 完整构建、测试、发布

- [ ] **Step 1: 完整构建**

```bash
cd /Users/tom/Projects/cc-web && npm run build 2>&1 | tail -20
```

期望：frontend + backend 均成功，无 TypeScript 错误

- [ ] **Step 2: 集成验证清单**

```bash
npm run dev:backend &
npm run dev:frontend &
```

- [ ] Hooks 安装：`cat ~/.claude/settings.json | grep ccweb-hook` 有 3 条
- [ ] Port 文件：`cat ~/.ccweb/port` 显示端口号
- [ ] Terminal 项目工具调用 → Dashboard 语义状态**立即**更新（无 2s 延迟）
- [ ] 创建 Chat 模式项目 → 项目页显示输入框，无 Terminal Tab
- [ ] Chat 模式发送消息 → 看到逐字流式输出
- [ ] Chat 模式工具调用 → 实时显示工具名气泡
- [ ] Chat → Terminal 模式切换 → 对话上下文保留
- [ ] Terminal → Chat 模式切换 → 对话上下文保留
- [ ] kill -9 后端，重启 → hooks 无重复安装
- [ ] 停止后端 → hooks 清除，port 文件删除

- [ ] **Step 3: 更新版本号（4 处）**

```
package.json:                                    "version": "1.5.40"
frontend/src/components/UpdateButton.tsx:        currentVersion = '1.5.40'
README.md:                                       版本 badge 更新
CLAUDE.md:                                       **Current version**: v1.5.40
```

- [ ] **Step 4: 更新 CLAUDE.md + README.md 文档**

在 backend 架构表中新增：
- `hooks-manager.ts` — 管理 `~/.claude/settings.json` hooks，幂等 install/uninstall
- `chat-process-manager.ts` — Chat 模式 `claude --print` 子进程管理
- `routes/hooks.ts` — `POST /api/hooks` hook 事件接收（localhost only）

在 Key Design Decisions 中新增：
- **Claude Code Hooks**：PreToolUse/PostToolUse/Stop hooks 替换 JSONL 定时轮询，语义状态即时更新
- **Chat SDK 模式**：`claude --print --output-format stream-json --include-partial-messages`，逐字流式输出，通过 `--continue` 与 Terminal 模式无缝互换

在 WS Protocol 表中新增 `chat_stream`、`chat_tool_start`、`chat_tool_end`、`chat_turn_end` 消息类型

- [ ] **Step 5: 最终构建**

```bash
npm run build
```

- [ ] **Step 6: commit + push + publish**

```bash
git add -A
git commit -m "v1.5.40: Claude Code Hooks + Chat SDK streaming mode"
git push
npm publish --registry https://registry.npmjs.org --access=public \
  --//registry.npmjs.org/:_authToken=<TOKEN>
```
