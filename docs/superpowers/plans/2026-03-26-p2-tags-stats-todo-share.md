# P2 Features: Tags + Stats + Todo Board + Session Share

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (F) 项目支持 tags 字段，Dashboard 可按标签过滤；(G) 展示项目使用统计（会话数/消息数/最近活动）；(H) RightPanel 新增"任务"标签，展示 Claude Code 的 TodoWrite 列表；(I) 会话分享：生成 token 化只读链接，无需登录可查看。

**Architecture:**
- F/G: `Project` 类型扩展 `tags?: string[]`；后端新增 PATCH tags 端点；Dashboard 标签过滤 chips；stats 从 sessions 派生（纯前端计算）。
- H: `GET /api/projects/:id/todos` 读取当前会话 JSONL，解析最近一次 TodoWrite 的 input.todos；前端 `TodoPanel.tsx` 轮询展示，RightPanel 添加"任务"标签。
- I: `POST /api/sessions/:id/share` 生成 signed token 存入 `~/.ccweb/session-shares.json`；`GET /api/share/:token` 无需 JWT 返回 session 数据；前端新增 `/share/:token` 路由 → `ShareViewPage.tsx`（只读 ChatView）；HistoryTab 每条 session 旁增加"分享"按钮。

**Tech Stack:** crypto.randomBytes (token), React useState/useEffect, shadcn/ui Badge/Checkbox/Dialog, sonner toast

---

## 文件清单

| 动作 | 路径 | 说明 |
|------|------|------|
| 修改 | `backend/src/types.ts` | Project 添加 tags?: string[] |
| 修改 | `frontend/src/types.ts` | 同步 tags 字段 |
| 修改 | `backend/src/routes/projects.ts` | PATCH /:id/tags 端点 |
| 新建 | `backend/src/routes/share.ts` | GET/POST session share 端点 |
| 修改 | `backend/src/index.ts` | 挂载 shareRouter |
| 修改 | `frontend/src/lib/api.ts` | 添加 tags / todos / share API 函数 |
| 修改 | `frontend/src/pages/DashboardPage.tsx` | 标签过滤 chips |
| 修改 | `frontend/src/components/ProjectCard.tsx` | 展示 tags + stats |
| 新建 | `frontend/src/components/TodoPanel.tsx` | Todo 任务看板 |
| 修改 | `frontend/src/components/RightPanel.tsx` | 添加"任务"标签页 |
| 修改 | `frontend/src/components/RightPanel.tsx` | HistoryTab 添加分享按钮 |
| 新建 | `frontend/src/pages/ShareViewPage.tsx` | 公开只读会话查看页 |
| 修改 | `frontend/src/App.tsx` | 添加 /share/:token 路由 |

---

## Task 1: 项目 Tags 字段（类型 + 后端端点）

**Files:**
- Modify: `backend/src/types.ts`
- Modify: `frontend/src/types.ts`
- Modify: `backend/src/routes/projects.ts`

- [ ] **Step 1.1: 添加 tags 到 Project 类型**

`backend/src/types.ts` — 在 `Project` interface 末尾添加：
```typescript
  tags?: string[]; // user-defined labels, e.g. ['work', 'ai']
```

`frontend/src/types.ts`（如果存在独立文件）或 `frontend/src/lib/api.ts` 中的 Project 类型 — 同样添加 `tags?: string[]`。

- [ ] **Step 1.2: 后端 PATCH /:id/tags 端点**

在 `routes/projects.ts` 中，`export default router;` 之前添加：

```typescript
// PATCH /api/projects/:id/tags   body: { tags: string[] }
router.patch('/:id/tags', (req: AuthRequest, res: Response): void => {
  const projects = getProjects();
  const project = projects.find((p) => p.id === req.params.id);
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }
  if (!isProjectOwner(project, req.user?.username) && !isAdminUser(req.user?.username)) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  const { tags } = req.body as { tags?: unknown };
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string')) {
    res.status(400).json({ error: 'tags must be string[]' }); return;
  }

  // Deduplicate and trim
  project.tags = [...new Set(tags.map((t: string) => t.trim()).filter(Boolean))];
  saveProjects(projects);
  res.json(project);
});
```

Note: confirm `saveProjects` is exported from `config.ts` (it should be, used by other PATCH handlers).

- [ ] **Step 1.3: 验证后端编译**
```bash
cd backend && npx tsc --noEmit
```

---

## Task 2: Dashboard 标签过滤 + ProjectCard 显示 Tags/Stats

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Modify: `frontend/src/components/ProjectCard.tsx`

- [ ] **Step 2.1: api.ts 添加 tags + stats 函数**

```typescript
// Update project tags
export async function updateProjectTags(projectId: string, tags: string[]): Promise<Project> {
  return request<Project>('PATCH', `/api/projects/${projectId}/tags`, { tags });
}

// Project stats (derived from sessions on the frontend from existing getSessions)
export interface ProjectStats {
  sessionCount: number;
  messageCount: number;
  lastActivityAt?: string;
}
```

- [ ] **Step 2.2: DashboardPage 添加标签过滤**

在 DashboardPage 函数内，`projects` 获取之后，派生所有标签和过滤逻辑：

```typescript
// All unique tags across all projects
const allTags = Array.from(new Set(projects.flatMap((p) => p.tags ?? [])));

// Selected filter tags
const [selectedTags, setSelectedTags] = useState<string[]>([]);

// Filtered project list
const filteredActive = activeList.filter((p) => {
  if (selectedTags.length === 0) return true;
  return selectedTags.some((t) => p.tags?.includes(t));
});
```

在项目网格上方，如果 `allTags.length > 0`，显示标签过滤 chips：

```tsx
{allTags.length > 0 && (
  <div className="flex flex-wrap gap-1.5 mb-4">
    {allTags.map((tag) => (
      <button
        key={tag}
        onClick={() => setSelectedTags((prev) =>
          prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
        )}
        className={cn(
          'px-2 py-0.5 rounded-full text-xs border transition-colors',
          selectedTags.includes(tag)
            ? 'bg-blue-500/20 text-blue-400 border-blue-500/40'
            : 'bg-muted text-muted-foreground border-border hover:border-muted-foreground/40'
        )}
      >
        #{tag}
      </button>
    ))}
    {selectedTags.length > 0 && (
      <button
        onClick={() => setSelectedTags([])}
        className="px-2 py-0.5 rounded-full text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        清除
      </button>
    )}
  </div>
)}
```

将原来使用 `activeList` 的 map 改为使用 `filteredActive`。

- [ ] **Step 2.3: ProjectCard 显示 tags**

读取 `frontend/src/components/ProjectCard.tsx`，找到卡片底部区域，在 project name / status 之后添加 tags 显示：

```tsx
{/* Tags */}
{(project.tags ?? []).length > 0 && (
  <div className="flex flex-wrap gap-1 mt-1">
    {(project.tags ?? []).slice(0, 3).map((tag) => (
      <span key={tag} className="px-1.5 py-0 rounded-full text-[10px] bg-muted text-muted-foreground border border-border">
        #{tag}
      </span>
    ))}
    {(project.tags?.length ?? 0) > 3 && (
      <span className="text-[10px] text-muted-foreground">+{(project.tags?.length ?? 0) - 3}</span>
    )}
  </div>
)}
```

- [ ] **Step 2.4: 验证前端编译**
```bash
cd frontend && npx tsc --noEmit
```

---

## Task 3: Todo 任务看板后端

**Files:**
- Modify: `backend/src/routes/projects.ts`
- Modify: `backend/src/session-manager.ts` (read helper)

- [ ] **Step 3.1: 了解 JSONL 结构**

Claude Code 的 TodoWrite 工具调用在 JSONL 中的格式（在 `.claude/projects/` 的会话文件中）：

```json
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_xxx","name":"TodoWrite","input":{"todos":[{"id":"1","content":"...","status":"pending","priority":"high"}]}}]}}
```

- [ ] **Step 3.2: 添加 GET /api/projects/:id/todos 端点**

在 `routes/projects.ts` 的 `export default router;` 之前添加：

```typescript
import * as fs from 'fs';
import * as path from 'path';

// GET /api/projects/:id/todos
// Reads current session JSONL and returns the most recent TodoWrite todo list
router.get('/:id/todos', async (req: AuthRequest, res: Response): Promise<void> => {
  const project = getProject(req.params.id);
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }
  if (!isProjectOwner(project, req.user?.username) &&
      !project.shares?.some((s) => s.username === req.user?.username) &&
      !isAdminUser(req.user?.username)) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  interface TodoItem {
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority?: 'low' | 'medium' | 'high';
  }

  // Find the most recent session file
  const sessionDir = path.join(project.folderPath, '.ccweb', 'sessions');
  if (!fs.existsSync(sessionDir)) { res.json([]); return; }

  let files: string[];
  try {
    files = fs.readdirSync(sessionDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse(); // newest first (files are timestamp-prefixed)
  } catch {
    res.json([]); return;
  }

  // Also check Claude's native JSONL files
  const claudeDir = path.join(
    process.env.HOME ?? '',
    '.claude', 'projects',
    project.folderPath.replace(/\//g, '-').replace(/\s/g, '-').replace(/_/g, '-')
  );

  // Search ccweb sessions
  for (const file of files.slice(0, 5)) { // only look at last 5 sessions
    try {
      const raw = fs.readFileSync(path.join(sessionDir, file), 'utf-8');
      const session = JSON.parse(raw) as {
        messages: Array<{ role: string; blocks?: unknown[] }>;
      };

      // Walk messages in reverse to find latest TodoWrite
      const messages = session.messages ?? [];
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role !== 'assistant') continue;
        const blocks = (msg as any).blocks as Array<{ type: string; name?: string; input?: { todos?: TodoItem[] } }> | undefined;
        if (!blocks) continue;
        for (const block of blocks) {
          if (block.type === 'tool_use' && block.name === 'TodoWrite' && Array.isArray(block.input?.todos)) {
            res.json(block.input.todos);
            return;
          }
        }
      }
    } catch {
      // skip
    }
  }

  res.json([]);
});
```

Note: If `fs` and `path` are already imported at top of `routes/projects.ts`, skip re-importing.

- [ ] **Step 3.3: 验证后端编译**
```bash
cd backend && npx tsc --noEmit
```

---

## Task 4: TodoPanel 前端组件 + RightPanel 标签页

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/components/TodoPanel.tsx`
- Modify: `frontend/src/components/RightPanel.tsx`

- [ ] **Step 4.1: api.ts 添加 todos 函数**

```typescript
export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority?: 'low' | 'medium' | 'high';
}

export async function getProjectTodos(projectId: string): Promise<TodoItem[]> {
  return request<TodoItem[]>('GET', `/api/projects/${projectId}/todos`);
}
```

- [ ] **Step 4.2: 创建 TodoPanel.tsx**

```tsx
// frontend/src/components/TodoPanel.tsx
import { useState, useEffect } from 'react';
import { CheckSquare, Clock, AlertCircle, Circle } from 'lucide-react';
import { getProjectTodos, TodoItem } from '@/lib/api';
import { cn } from '@/lib/utils';

const STATUS_ICON = {
  completed: <CheckSquare className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />,
  in_progress: <Clock className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />,
  pending: <Circle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />,
};

const PRIORITY_COLOR = {
  high: 'text-red-400',
  medium: 'text-yellow-400',
  low: 'text-muted-foreground',
};

interface TodoPanelProps {
  projectId: string;
}

export function TodoPanel({ projectId }: TodoPanelProps) {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const data = await getProjectTodos(projectId);
        if (active) setTodos(data);
      } catch {
        if (active) setTodos([]);
      } finally {
        if (active) setLoading(false);
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), 5000);
    return () => { active = false; clearInterval(interval); };
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground/50 text-xs">
        <CheckSquare className="h-5 w-5" />
        <p>加载中…</p>
      </div>
    );
  }

  if (todos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground/50 text-xs">
        <CheckSquare className="h-5 w-5" />
        <p className="text-center">暂无任务</p>
        <p className="text-center text-[10px]">当 Claude 使用 TodoWrite 工具时，任务将显示在这里</p>
      </div>
    );
  }

  const byStatus = {
    in_progress: todos.filter((t) => t.status === 'in_progress'),
    pending: todos.filter((t) => t.status === 'pending'),
    completed: todos.filter((t) => t.status === 'completed'),
  };

  const Section = ({ title, items }: { title: string; items: TodoItem[] }) => {
    if (items.length === 0) return null;
    return (
      <div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 font-medium">{title}</div>
        <div className="space-y-0.5">
          {items.map((todo) => (
            <div key={todo.id} className="flex items-start gap-1.5 px-1 py-1.5 rounded hover:bg-muted transition-colors">
              {STATUS_ICON[todo.status]}
              <span className={cn(
                'flex-1 text-xs leading-snug',
                todo.status === 'completed' ? 'line-through text-muted-foreground' : 'text-foreground'
              )}>
                {todo.content}
              </span>
              {todo.priority && todo.priority !== 'medium' && (
                <AlertCircle className={cn('h-2.5 w-2.5 flex-shrink-0 mt-0.5', PRIORITY_COLOR[todo.priority])} />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-3 min-h-0">
      <Section title="进行中" items={byStatus.in_progress} />
      <Section title="待处理" items={byStatus.pending} />
      <Section title="已完成" items={byStatus.completed} />
    </div>
  );
}
```

- [ ] **Step 4.3: RightPanel.tsx 添加"任务"标签页**

在 `RightPanel.tsx` 顶部 imports 添加：
```typescript
import { TodoPanel } from './TodoPanel';
```

更新 Tab 类型（注意：如果 P1 已添加 'git' 标签，这里在 P1 的基础上继续添加）：
```typescript
type Tab = 'shortcuts' | 'history' | 'git' | 'todos';

const TAB_LABELS: Record<Tab, string> = {
  shortcuts: '快捷命令',
  history: '历史记录',
  git: 'Git',
  todos: '任务',
};
```

将 Tab 数组更新为：`(['shortcuts', 'history', 'git', 'todos'] as Tab[])`

在 `AnimatePresence` 内添加：
```tsx
{tab === 'todos' && (
  <motion.div key="todos" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex-1 min-h-0 overflow-hidden">
    <TodoPanel projectId={projectId} />
  </motion.div>
)}
```

- [ ] **Step 4.4: 验证前端编译**
```bash
cd frontend && npx tsc --noEmit
```

---

## Task 5: 会话分享后端

**Files:**
- Create: `backend/src/routes/share.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 5.1: 创建 backend/src/routes/share.ts**

```typescript
// backend/src/routes/share.ts
import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AuthRequest } from '../auth';
import { DATA_DIR, getProject, isAdminUser, isProjectOwner } from '../config';
import { sessionManager } from '../session-manager';

const router = Router();
const SHARES_FILE = path.join(DATA_DIR, 'session-shares.json');

interface ShareEntry {
  token: string;
  projectId: string;
  sessionId: string;
  createdAt: string;
  expiresAt?: string; // ISO date, undefined = no expiry
}

function loadShares(): ShareEntry[] {
  try {
    if (!fs.existsSync(SHARES_FILE)) return [];
    return JSON.parse(fs.readFileSync(SHARES_FILE, 'utf-8')) as ShareEntry[];
  } catch {
    return [];
  }
}

function saveShares(shares: ShareEntry[]): void {
  const tmp = SHARES_FILE + `.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(shares, null, 2), 'utf-8');
  fs.renameSync(tmp, SHARES_FILE);
}

// POST /api/sessions/:sessionId/share   body: { expiryDays?: number }
// Creates a share token for a session. Requires auth + project access.
router.post('/sessions/:sessionId/share', async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const { expiryDays } = req.body as { expiryDays?: number };

  // Find which project this session belongs to
  // Sessions are stored in {projectFolder}/.ccweb/sessions/{sessionId}.json
  // We need to scan all projects the caller can access
  const { getProjects } = await import('../config');
  const projects = getProjects();

  let foundProjectId: string | null = null;
  for (const p of projects) {
    if (!isProjectOwner(p, req.user?.username) && !isAdminUser(req.user?.username)) continue;
    const sessionFile = path.join(p.folderPath, '.ccweb', 'sessions', `${sessionId}.json`);
    if (fs.existsSync(sessionFile)) { foundProjectId = p.id; break; }
    // Also check legacy location
    const sessions = sessionManager.getSessions(p.id);
    if (sessions.some((s: { id: string }) => s.id === sessionId)) { foundProjectId = p.id; break; }
  }

  if (!foundProjectId) {
    res.status(404).json({ error: 'Session not found or access denied' }); return;
  }

  const token = crypto.randomBytes(24).toString('base64url');
  const entry: ShareEntry = {
    token,
    projectId: foundProjectId,
    sessionId,
    createdAt: new Date().toISOString(),
    ...(expiryDays ? { expiresAt: new Date(Date.now() + expiryDays * 86400000).toISOString() } : {}),
  };

  const shares = loadShares();
  shares.push(entry);
  saveShares(shares);

  res.json({ token, shareUrl: `/share/${token}` });
});

// GET /api/share/:token — NO AUTH REQUIRED — returns session data
router.get('/share/:token', async (req: Request, res: Response): Promise<void> => {
  const shares = loadShares();
  const entry = shares.find((s) => s.token === req.params.token);

  if (!entry) { res.status(404).json({ error: 'Share link not found or expired' }); return; }

  if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
    res.status(410).json({ error: 'Share link has expired' }); return;
  }

  // Read session
  const project = getProject(entry.projectId);
  if (!project) { res.status(404).json({ error: 'Project no longer exists' }); return; }

  const sessionFile = path.join(project.folderPath, '.ccweb', 'sessions', `${entry.sessionId}.json`);
  try {
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    res.json({ session, projectName: project.name });
  } catch {
    res.status(404).json({ error: 'Session data not found' });
  }
});

export default router;
```

- [ ] **Step 5.2: 挂载 shareRouter 到 index.ts**

```typescript
import shareRouter from './routes/share';

// 无需 authMiddleware 的公开路由 (GET /api/share/:token)
app.use('/api', shareRouter);
// 需要 auth 的路由 (POST /api/sessions/:id/share) — 已包含在 shareRouter 中，中间件在 router 层级处理
```

实际上，因为 router 内部对 POST 端点自己检查 `req.user`，可以把整个 router 都挂载在 `/api` 下且不加全局 authMiddleware（POST 端点通过 `req.user` 检查来保护）。但更安全的做法是分别挂载：

```typescript
// 公开路由 — 无 auth 检查
app.get('/api/share/:token', (req, res, next) => shareRouter.handle(req, res, next));
// 或者直接：
app.use('/api', shareRouter); // GET /api/share/:token 不需要 JWT
// POST /api/sessions/:sessionId/share 需要 JWT — 在 authMiddleware 保护的分组下单独挂载
app.use('/api', authMiddleware, Router().post('/sessions/:sessionId/share', /* handler */));
```

**简化方案**：在 `shareRouter` 内部为 POST 端点添加手动 JWT 校验（`verifyToken`），这样 `app.use('/api', shareRouter)` 一行挂载即可。

修改 `share.ts` POST handler 顶部添加：
```typescript
import { verifyToken } from '../auth';

// POST handler 顶部：
const authHeader = req.headers['authorization'];
const token_jwt = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
if (!token_jwt) { res.status(401).json({ error: 'Unauthorized' }); return; }
const user = verifyToken(token_jwt);
if (!user) { res.status(401).json({ error: 'Invalid token' }); return; }
req.user = user;
```

检查 `auth.ts` 确认 `verifyToken` 函数签名。

- [ ] **Step 5.3: 验证后端编译**
```bash
cd backend && npx tsc --noEmit
```

---

## Task 6: 会话分享前端

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/RightPanel.tsx` (HistoryTab 添加分享按钮)
- Create: `frontend/src/pages/ShareViewPage.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 6.1: api.ts 添加 share 函数**

```typescript
export interface ShareResult {
  token: string;
  shareUrl: string;
}

export async function shareSession(sessionId: string, expiryDays?: number): Promise<ShareResult> {
  return request<ShareResult>('POST', `/api/sessions/${sessionId}/share`, { expiryDays });
}

export async function getSharedSession(token: string): Promise<{
  session: Session;
  projectName: string;
}> {
  // Public endpoint — no auth token needed
  const base = import.meta.env.DEV ? 'http://localhost:3001' : '';
  const resp = await fetch(`${base}/api/share/${token}`);
  if (!resp.ok) throw new Error((await resp.json() as { error: string }).error);
  return resp.json() as Promise<{ session: Session; projectName: string }>;
}
```

- [ ] **Step 6.2: HistoryTab 添加分享按钮**

在 `RightPanel.tsx` 的 HistoryTab 中，找到每个 session 的按钮区域（当前有"回忆"按钮），添加"分享"按钮：

```tsx
import { Share2 } from 'lucide-react';
import { shareSession } from '@/lib/api';
import { toast } from 'sonner';

// 在"回忆"按钮旁边添加：
<button
  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-secondary hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
  onClick={async (e) => {
    e.stopPropagation();
    try {
      const result = await shareSession(s.id);
      const fullUrl = window.location.origin + result.shareUrl;
      await navigator.clipboard.writeText(fullUrl);
      toast.success('分享链接已复制到剪贴板');
    } catch {
      toast.error('分享失败');
    }
  }}
>
  <Share2 className="h-2.5 w-2.5" />
  分享
</button>
```

- [ ] **Step 6.3: 创建 ShareViewPage.tsx**

```tsx
// frontend/src/pages/ShareViewPage.tsx
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Bot, User } from 'lucide-react';
import { getSharedSession } from '@/lib/api';
import { cn } from '@/lib/utils';

export function ShareViewPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<{ session: { messages: Array<{ role: string; content: string; timestamp: string }>; startedAt: string }; projectName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    getSharedSession(token)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [token]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-2">
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground text-sm">加载中…</p>
      </div>
    );
  }

  const { session, projectName } = data;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur px-4 py-3 flex items-center gap-3">
        <Bot className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-sm font-medium text-foreground">{projectName}</h1>
          <p className="text-[10px] text-muted-foreground">
            {new Date(session.startedAt).toLocaleString('zh-CN')}
            {' · '}
            {session.messages.length} 条消息
            {' · '}
            <span className="text-blue-400">只读分享</span>
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {session.messages.map((msg, i) => (
          <div key={i} className={cn('flex gap-3', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
            <div className={cn(
              'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5',
              msg.role === 'user' ? 'bg-blue-600/20' : 'bg-muted'
            )}>
              {msg.role === 'user'
                ? <User className="h-3.5 w-3.5 text-blue-400" />
                : <Bot className="h-3.5 w-3.5 text-muted-foreground" />
              }
            </div>
            <div className={cn(
              'max-w-[80%] text-sm rounded-xl px-4 py-2.5 whitespace-pre-wrap break-words',
              msg.role === 'user'
                ? 'bg-blue-600/20 text-blue-100 border border-blue-500/20'
                : 'bg-muted text-foreground border border-border'
            )}>
              {msg.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6.4: 添加 /share/:token 路由到 App.tsx**

读取 `App.tsx`，在 Router 中找到路由定义区域，在现有路由之后添加公开路由：

```tsx
import { ShareViewPage } from '@/pages/ShareViewPage';

// 在 Routes 中，无需 PrivateRoute 包装：
<Route path="/share/:token" element={<ShareViewPage />} />
```

注意：这条路由必须放在 `PrivateRoute` 之外，因为它不需要登录。

- [ ] **Step 6.5: 验证前端编译**
```bash
cd frontend && npx tsc --noEmit
```

---

## Task 7: 完整构建 + 提交

- [ ] **Step 7.1: 完整构建**
```bash
cd /Users/tom/Projects/cc-web && npm run build
```
期望：无错误

- [ ] **Step 7.2: 手动验证清单**
```
Tags 过滤:
  □ 打开项目设置（或通过 API）为项目添加 tags
  □ Dashboard 顶部显示标签 chips
  □ 点击标签 → 只显示含该标签的项目
  □ 点击"清除" → 显示全部

Todo 面板:
  □ 打开使用过 TodoWrite 的项目
  □ RightPanel "任务" 标签 → 显示 pending/in_progress/completed 分组
  □ 没有任务时显示"暂无任务"提示
  □ Claude 使用 TodoWrite 后，5s 内自动刷新

会话分享:
  □ 历史记录 Tab 中，每个 session 有"分享"按钮
  □ 点击"分享" → 链接复制到剪贴板，toast 成功提示
  □ 无痕/私密窗口打开 /share/<token> → 无需登录，显示会话内容
  □ 显示项目名、时间、消息列表
  □ 无效 token → 显示错误信息
```

- [ ] **Step 7.3: 版本号 bump 到 v1.5.51，四文件同步**

修改：`package.json`, `frontend/src/components/UpdateButton.tsx`, `README.md`, `CLAUDE.md`

- [ ] **Step 7.4: 提交**
```bash
git add backend/src/types.ts \
  frontend/src/types.ts \
  backend/src/routes/projects.ts \
  backend/src/routes/share.ts \
  backend/src/index.ts \
  frontend/src/lib/api.ts \
  frontend/src/pages/DashboardPage.tsx \
  frontend/src/components/ProjectCard.tsx \
  frontend/src/components/TodoPanel.tsx \
  frontend/src/components/RightPanel.tsx \
  frontend/src/pages/ShareViewPage.tsx \
  frontend/src/App.tsx \
  package.json README.md CLAUDE.md \
  frontend/src/components/UpdateButton.tsx

git commit -m "feat: project tags, todo board, session share (v1.5.51)"
```
