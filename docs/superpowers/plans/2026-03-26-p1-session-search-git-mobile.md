# P1 Features: Session Search + Git Panel + Mobile Layout

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (C) 跨项目跨会话全局搜索 JSONL 内容；(D) RightPanel 新增 Git 状态标签，展示 diff 并支持 add/commit；(E) 窄屏单栏布局，底部 Tab 切换面板。

**Architecture:**
- C: 后端 `GET /api/sessions/search?q=` 遍历用户所有项目的 session JSON，返回匹配片段 + 跳转信息；前端 DashboardPage 顶部增加搜索框 + 弹出结果列表。
- D: 后端安装 `simple-git`，新建 `routes/git.ts` 提供 status/diff/add/commit 端点；前端新建 `GitPanel.tsx`，RightPanel 新增 `git` 标签页。
- E: ProjectPage 检测 `window.innerWidth < 768px`（或 CSS `@media`），窄屏下隐藏侧栏，底部显示 3-Tab 导航切换 Files / Terminal / Panel。

**Tech Stack:** simple-git, Express Router, React useState/useEffect, shadcn/ui Tabs, Tailwind responsive classes

---

## 文件清单

| 动作 | 路径 | 说明 |
|------|------|------|
| 修改 | `backend/src/routes/projects.ts` | 添加 GET /sessions/search 端点 |
| 修改 | `backend/package.json` | 添加 simple-git 依赖 |
| 新建 | `backend/src/routes/git.ts` | Git 操作路由 |
| 修改 | `backend/src/index.ts` | 挂载 gitRouter |
| 新建 | `frontend/src/components/GitPanel.tsx` | Git 状态面板 |
| 修改 | `frontend/src/components/RightPanel.tsx` | 添加 git 标签页 |
| 修改 | `frontend/src/pages/DashboardPage.tsx` | 添加搜索框 + 结果弹层 |
| 修改 | `frontend/src/lib/api.ts` | 添加 searchSessions / git API 函数 |
| 修改 | `frontend/src/pages/ProjectPage.tsx` | 移动端底部 Tab 导航 |

---

## Task 1: 后端全局会话搜索

**Files:**
- Modify: `backend/src/routes/projects.ts`

- [ ] **Step 1.1: 理解 session 文件位置**

Session 文件存储于 `{project.folderPath}/.ccweb/sessions/*.json`。
每个 JSON 结构：`{ id, projectId, startedAt, messages: [{ role, content, timestamp }] }`

- [ ] **Step 1.2: 在 routes/projects.ts 末尾添加搜索端点**

找到文件末尾 `export default router;` 之前，插入：

```typescript
// GET /api/projects/sessions/search?q=<keyword>
// Returns matching message snippets across all projects the caller can access
router.get('/sessions/search', async (req: AuthRequest, res: Response): Promise<void> => {
  const q = (req.query.q as string | undefined)?.trim();
  if (!q || q.length < 2) {
    res.json([]);
    return;
  }

  const projects = getProjects();
  const lowerQ = q.toLowerCase();

  interface SearchResult {
    projectId: string;
    projectName: string;
    sessionId: string;
    startedAt: string;
    snippet: string;
    role: 'user' | 'assistant';
  }

  const results: SearchResult[] = [];

  for (const project of projects) {
    // Permission check: owner or shares member
    if (!isProjectOwner(project, req.user?.username) &&
        !project.shares?.some((s) => s.username === req.user?.username)) {
      // Admin can see all
      if (!isAdminUser(req.user?.username)) continue;
    }

    const sessionDir = path.join(project.folderPath, '.ccweb', 'sessions');
    if (!fs.existsSync(sessionDir)) continue;

    let files: string[];
    try {
      files = fs.readdirSync(sessionDir).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(sessionDir, file), 'utf-8');
        const session = JSON.parse(raw) as {
          id: string;
          startedAt: string;
          messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>;
        };

        for (const msg of session.messages ?? []) {
          if (!msg.content?.toLowerCase().includes(lowerQ)) continue;

          // Extract snippet: up to 120 chars around the first match
          const idx = msg.content.toLowerCase().indexOf(lowerQ);
          const start = Math.max(0, idx - 40);
          const end = Math.min(msg.content.length, idx + 80);
          const snippet = (start > 0 ? '…' : '') + msg.content.slice(start, end) + (end < msg.content.length ? '…' : '');

          results.push({
            projectId: project.id,
            projectName: project.name,
            sessionId: session.id,
            startedAt: session.startedAt,
            snippet,
            role: msg.role,
          });

          // At most 3 snippets per session
          if (results.filter((r) => r.sessionId === session.id).length >= 3) break;
        }

        // At most 10 results total
        if (results.length >= 50) break;
      } catch {
        // skip corrupt session files
      }
    }

    if (results.length >= 50) break;
  }

  res.json(results);
});
```

Note: needs `import * as fs from 'fs'; import * as path from 'path';` — check if already imported at top of file.

- [ ] **Step 1.3: 确认后端编译**
```bash
cd backend && npx tsc --noEmit
```
期望：无报错

---

## Task 2: 安装 simple-git + Git 路由

**Files:**
- Modify: `backend/package.json`
- Create: `backend/src/routes/git.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 2.1: 安装 simple-git**
```bash
cd backend && npm install simple-git
npm install --save-dev @types/node
```

- [ ] **Step 2.2: 创建 backend/src/routes/git.ts**

```typescript
// backend/src/routes/git.ts
import { Router, Response } from 'express';
import { simpleGit } from 'simple-git';
import { AuthRequest } from '../auth';
import { getProject, isAdminUser, isProjectOwner } from '../config';

const router = Router();

// Helper: validate caller has edit access to project
function canEdit(project: { owner?: string; shares?: Array<{ username: string; permission: string }> }, username?: string): boolean {
  if (isAdminUser(username)) return true;
  if (isProjectOwner(project, username)) return true;
  return project.shares?.some((s) => s.username === username && s.permission === 'edit') ?? false;
}

// GET /api/projects/:id/git/status
// Returns { isRepo, staged, modified, untracked }
router.get('/:id/git/status', async (req: AuthRequest, res: Response): Promise<void> => {
  const project = getProject(req.params.id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  if (!canEdit(project, req.user?.username)) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const git = simpleGit(project.folderPath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) { res.json({ isRepo: false }); return; }

    const status = await git.status();
    res.json({
      isRepo: true,
      branch: status.current,
      staged: status.staged,
      modified: status.modified,
      untracked: status.not_added,
      deleted: status.deleted,
      ahead: status.ahead,
      behind: status.behind,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/projects/:id/git/diff?file=<path>
// Returns unified diff for a specific file (or all if no file param)
router.get('/:id/git/diff', async (req: AuthRequest, res: Response): Promise<void> => {
  const project = getProject(req.params.id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  if (!canEdit(project, req.user?.username)) { res.status(403).json({ error: 'Forbidden' }); return; }

  const file = req.query.file as string | undefined;

  try {
    const git = simpleGit(project.folderPath);
    const diff = file ? await git.diff([file]) : await git.diff();
    res.json({ diff });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/projects/:id/git/add   body: { files: string[] }
router.post('/:id/git/add', async (req: AuthRequest, res: Response): Promise<void> => {
  const project = getProject(req.params.id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  if (!canEdit(project, req.user?.username)) { res.status(403).json({ error: 'Forbidden' }); return; }

  const { files } = req.body as { files?: string[] };
  if (!Array.isArray(files) || files.length === 0) {
    res.status(400).json({ error: 'files array required' }); return;
  }

  try {
    const git = simpleGit(project.folderPath);
    await git.add(files);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/projects/:id/git/commit   body: { message: string }
router.post('/:id/git/commit', async (req: AuthRequest, res: Response): Promise<void> => {
  const project = getProject(req.params.id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  if (!canEdit(project, req.user?.username)) { res.status(403).json({ error: 'Forbidden' }); return; }

  const { message } = req.body as { message?: string };
  if (!message?.trim()) { res.status(400).json({ error: 'commit message required' }); return; }

  try {
    const git = simpleGit(project.folderPath);
    const result = await git.commit(message.trim());
    res.json({ ok: true, commit: result.commit });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
```

- [ ] **Step 2.3: 挂载 gitRouter 到 index.ts**

在 index.ts 中找到路由挂载区域，添加：
```typescript
import gitRouter from './routes/git';
// 已有挂载区域中添加（与其他 project 路由一起，保持 authMiddleware）：
app.use('/api/projects', authMiddleware, gitRouter);
```

注意：gitRouter 路由带 `/:id/git/...`，已包含 projectId 参数，所以挂载在 `/api/projects` 下即可。

- [ ] **Step 2.4: 验证后端编译**
```bash
cd backend && npx tsc --noEmit
```
期望：无报错

---

## Task 3: GitPanel 前端组件

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/components/GitPanel.tsx`

- [ ] **Step 3.1: 添加 Git API 函数到 api.ts**

```typescript
// Git types
export interface GitStatus {
  isRepo: boolean;
  branch?: string;
  staged?: string[];
  modified?: string[];
  untracked?: string[];
  deleted?: string[];
  ahead?: number;
  behind?: number;
}

export async function getGitStatus(projectId: string): Promise<GitStatus> {
  return request<GitStatus>('GET', `/api/projects/${projectId}/git/status`);
}

export async function getGitDiff(projectId: string, file?: string): Promise<{ diff: string }> {
  const qs = file ? `?file=${encodeURIComponent(file)}` : '';
  return request<{ diff: string }>('GET', `/api/projects/${projectId}/git/diff${qs}`);
}

export async function gitAdd(projectId: string, files: string[]): Promise<void> {
  await request<void>('POST', `/api/projects/${projectId}/git/add`, { files });
}

export async function gitCommit(projectId: string, message: string): Promise<void> {
  await request<void>('POST', `/api/projects/${projectId}/git/commit`, { message });
}

// Search sessions
export interface SessionSearchResult {
  projectId: string;
  projectName: string;
  sessionId: string;
  startedAt: string;
  snippet: string;
  role: 'user' | 'assistant';
}

export async function searchSessions(q: string): Promise<SessionSearchResult[]> {
  return request<SessionSearchResult[]>('GET', `/api/projects/sessions/search?q=${encodeURIComponent(q)}`);
}
```

- [ ] **Step 3.2: 创建 GitPanel.tsx**

```tsx
// frontend/src/components/GitPanel.tsx
import { useState, useEffect, useCallback } from 'react';
import { GitBranch, RefreshCw, Plus, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { getGitStatus, getGitDiff, gitAdd, gitCommit, GitStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

interface GitPanelProps {
  projectId: string;
}

export function GitPanel({ projectId }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await getGitStatus(projectId));
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const showDiff = async (file?: string) => {
    try {
      const { diff: d } = await getGitDiff(projectId, file);
      setDiff(d || '(no diff)');
      setDiffFile(file ?? 'all changes');
    } catch (err) {
      toast.error('获取 diff 失败');
    }
  };

  const handleAdd = async (file: string) => {
    try {
      await gitAdd(projectId, [file]);
      toast.success(`已暂存 ${file}`);
      await refresh();
    } catch (err) {
      toast.error('git add 失败');
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) return;
    setCommitting(true);
    try {
      await gitCommit(projectId, commitMsg);
      toast.success('提交成功');
      setCommitMsg('');
      await refresh();
    } catch (err) {
      toast.error((err as Error).message || '提交失败');
    } finally {
      setCommitting(false);
    }
  };

  if (!status) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground/50 text-xs">
        <GitBranch className="h-5 w-5" />
        <p>加载中…</p>
      </div>
    );
  }

  if (!status.isRepo) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground/50 text-xs">
        <GitBranch className="h-5 w-5" />
        <p>非 Git 仓库</p>
      </div>
    );
  }

  const allChanged = [...(status.modified ?? []), ...(status.deleted ?? [])];
  const staged = status.staged ?? [];
  const untracked = status.untracked ?? [];

  return (
    <div className="flex flex-col h-full overflow-y-auto p-2 space-y-2 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-muted-foreground font-medium">
          <GitBranch className="h-3 w-3" />
          <span>{status.branch}</span>
          {(status.ahead ?? 0) > 0 && <span className="text-blue-400">↑{status.ahead}</span>}
          {(status.behind ?? 0) > 0 && <span className="text-yellow-400">↓{status.behind}</span>}
        </div>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
        </Button>
      </div>

      {/* Staged */}
      {staged.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-1 font-medium">已暂存 ({staged.length})</div>
          {staged.map((f) => (
            <div key={f} className="flex items-center gap-1 py-0.5 px-1 rounded hover:bg-muted group">
              <Check className="h-2.5 w-2.5 text-green-500 flex-shrink-0" />
              <button className="flex-1 text-left truncate text-green-400" onClick={() => void showDiff(f)}>{f}</button>
            </div>
          ))}
        </div>
      )}

      {/* Modified/Deleted */}
      {allChanged.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-1 font-medium">未暂存 ({allChanged.length})</div>
          {allChanged.map((f) => (
            <div key={f} className="flex items-center gap-1 py-0.5 px-1 rounded hover:bg-muted group">
              <button
                className="flex-shrink-0 h-4 w-4 flex items-center justify-center rounded hover:bg-green-500/20 text-muted-foreground hover:text-green-400"
                title="git add"
                onClick={() => void handleAdd(f)}
              >
                <Plus className="h-2.5 w-2.5" />
              </button>
              <button className="flex-1 text-left truncate text-yellow-400" onClick={() => void showDiff(f)}>{f}</button>
            </div>
          ))}
        </div>
      )}

      {/* Untracked */}
      {untracked.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-1 font-medium">未跟踪 ({untracked.length})</div>
          {untracked.map((f) => (
            <div key={f} className="flex items-center gap-1 py-0.5 px-1 rounded hover:bg-muted">
              <button
                className="flex-shrink-0 h-4 w-4 flex items-center justify-center rounded hover:bg-green-500/20 text-muted-foreground hover:text-green-400"
                title="git add"
                onClick={() => void handleAdd(f)}
              >
                <Plus className="h-2.5 w-2.5" />
              </button>
              <span className="flex-1 truncate text-muted-foreground">{f}</span>
            </div>
          ))}
        </div>
      )}

      {/* Nothing to commit */}
      {allChanged.length === 0 && staged.length === 0 && untracked.length === 0 && (
        <p className="text-muted-foreground/50 text-center py-4">工作区干净</p>
      )}

      {/* Commit */}
      {staged.length > 0 && (
        <div className="space-y-1.5 pt-1 border-t border-border">
          <Input
            placeholder="提交消息…"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && void handleCommit()}
            className="h-7 text-xs"
          />
          <Button
            size="sm"
            className="w-full h-7 text-xs"
            onClick={() => void handleCommit()}
            disabled={!commitMsg.trim() || committing}
          >
            {committing ? '提交中…' : `提交 (${staged.length} 文件)`}
          </Button>
        </div>
      )}

      {/* Diff Dialog */}
      {diff !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setDiff(null)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative z-10 w-[700px] max-w-[95vw] max-h-[80vh] flex flex-col bg-background border border-border rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 h-10 border-b border-border text-sm font-medium flex-shrink-0">
              <span className="truncate text-muted-foreground">{diffFile}</span>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => setDiff(null)}>✕</button>
            </div>
            <pre className="flex-1 overflow-auto p-3 text-[11px] font-mono whitespace-pre leading-relaxed">
              {diff.split('\n').map((line, i) => (
                <span
                  key={i}
                  className={cn(
                    'block',
                    line.startsWith('+') && !line.startsWith('+++') && 'text-green-400 bg-green-400/5',
                    line.startsWith('-') && !line.startsWith('---') && 'text-red-400 bg-red-400/5',
                    line.startsWith('@@') && 'text-blue-400',
                  )}
                >{line}</span>
              ))}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## Task 4: RightPanel 添加 Git 标签页

**Files:**
- Modify: `frontend/src/components/RightPanel.tsx`

- [ ] **Step 4.1: 更新 RightPanel.tsx**

在顶部 imports 中添加：
```typescript
import { GitPanel } from './GitPanel';
```

更新 Tab 类型和标签：
```typescript
type Tab = 'shortcuts' | 'history' | 'git';

const TAB_LABELS: Record<Tab, string> = {
  shortcuts: '快捷命令',
  history: '历史记录',
  git: 'Git',
};
```

更新 `(['shortcuts', 'history'] as Tab[])` → `(['shortcuts', 'history', 'git'] as Tab[])`

在 `AnimatePresence` 内添加 git 分支：
```tsx
{tab === 'git' && (
  <motion.div key="git" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex-1 min-h-0 overflow-hidden">
    <GitPanel projectId={projectId} />
  </motion.div>
)}
```

- [ ] **Step 4.2: 验证前端编译**
```bash
cd frontend && npx tsc --noEmit
```

---

## Task 5: DashboardPage 全局搜索 UI

**Files:**
- Modify: `frontend/src/pages/DashboardPage.tsx`

- [ ] **Step 5.1: 添加搜索 state 和逻辑**

在 DashboardPage 函数内添加：
```typescript
import { searchSessions, SessionSearchResult } from '@/lib/api';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

// state
const [searchQ, setSearchQ] = useState('');
const [searchResults, setSearchResults] = useState<SessionSearchResult[]>([]);
const [searching, setSearching] = useState(false);

// debounced search
useEffect(() => {
  if (!searchQ.trim() || searchQ.trim().length < 2) {
    setSearchResults([]);
    return;
  }
  const t = setTimeout(async () => {
    setSearching(true);
    try {
      setSearchResults(await searchSessions(searchQ));
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, 400);
  return () => clearTimeout(t);
}, [searchQ]);
```

- [ ] **Step 5.2: 在 DashboardPage header 区域添加搜索框**

在现有 header 区域找到合适位置（项目标题旁边或项目网格上方），添加：

```tsx
<div className="relative">
  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
  <Input
    placeholder="搜索历史对话…"
    value={searchQ}
    onChange={(e) => setSearchQ(e.target.value)}
    className="pl-8 h-8 text-xs w-52"
  />
  {/* Results dropdown */}
  {searchQ.trim().length >= 2 && (
    <div className="absolute top-full mt-1 left-0 w-96 max-h-80 overflow-y-auto bg-popover border border-border rounded-lg shadow-xl z-50">
      {searching && (
        <div className="px-4 py-3 text-xs text-muted-foreground">搜索中…</div>
      )}
      {!searching && searchResults.length === 0 && (
        <div className="px-4 py-3 text-xs text-muted-foreground">无结果</div>
      )}
      {searchResults.map((r, i) => (
        <button
          key={i}
          className="w-full text-left px-4 py-2.5 hover:bg-muted transition-colors border-b border-border last:border-0"
          onClick={() => {
            navigate(`/project/${r.projectId}`);
            setSearchQ('');
          }}
        >
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-medium text-foreground truncate">{r.projectName}</span>
            <span className="text-[10px] text-muted-foreground flex-shrink-0">
              {new Date(r.startedAt).toLocaleDateString('zh-CN')}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{r.snippet}</p>
        </button>
      ))}
    </div>
  )}
</div>
```

- [ ] **Step 5.3: 验证前端编译**
```bash
cd frontend && npx tsc --noEmit
```

---

## Task 6: 移动端底部 Tab 导航

**Files:**
- Modify: `frontend/src/pages/ProjectPage.tsx`

- [ ] **Step 6.1: 添加移动端 panel state**

在 ProjectPage.tsx 中：

```typescript
import { FolderOpen, Terminal as TerminalIcon, PanelRight, Menu } from 'lucide-react';

// 移动端激活面板
type MobilePanel = 'files' | 'terminal' | 'panel';
const [mobilePanel, setMobilePanel] = useState<MobilePanel>('terminal');

// 检测移动端（媒体查询，响应 resize）
const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
useEffect(() => {
  const handleResize = () => setIsMobile(window.innerWidth < 768);
  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}, []);
```

- [ ] **Step 6.2: 在 JSX 的主布局区修改为响应式**

桌面端布局不变（3 栏）。移动端时替换为：

```tsx
{isMobile ? (
  // 移动端：单栏 + 底部 Tab
  <div className="flex-1 overflow-hidden flex flex-col min-h-0">
    {/* Active panel content */}
    <div className="flex-1 overflow-hidden min-h-0">
      {mobilePanel === 'files' && (
        <FileTree projectPath={project.folderPath} />
      )}
      {mobilePanel === 'terminal' && (
        <TerminalView
          ref={terminalViewRef}
          projectId={id}
          project={project}
          soundConfig={soundConfig}
          onStatusChange={(status) =>
            setProject((prev) => (prev ? { ...prev, status: status as Project['status'] } : prev))
          }
        />
      )}
      {mobilePanel === 'panel' && (
        <RightPanel
          projectId={id}
          onSend={(text) => terminalViewRef.current?.sendTerminalInput(text)}
        />
      )}
    </div>

    {/* Bottom Tab Nav */}
    <div className="flex-shrink-0 flex border-t border-border bg-background">
      {([
        { id: 'files', icon: FolderOpen, label: '文件' },
        { id: 'terminal', icon: TerminalIcon, label: '终端' },
        { id: 'panel', icon: PanelRight, label: '面板' },
      ] as { id: MobilePanel; icon: React.ElementType; label: string }[]).map(({ id: panelId, icon: Icon, label }) => (
        <button
          key={panelId}
          onClick={() => setMobilePanel(panelId)}
          className={cn(
            'flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] transition-colors',
            mobilePanel === panelId
              ? 'text-blue-400'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  </div>
) : (
  // 桌面端：3 栏布局
  <div className="flex-1 overflow-hidden flex min-h-0">
    {/* Left: File tree */}
    <AnimatePresence initial={false}>
      {showFileTree === 'true' && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 224, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="flex-shrink-0 border-r border-border overflow-hidden"
        >
          <FileTree projectPath={project.folderPath} />
        </motion.div>
      )}
    </AnimatePresence>

    {/* Center: Terminal */}
    <TerminalView
      ref={terminalViewRef}
      projectId={id}
      project={project}
      soundConfig={soundConfig}
      onStatusChange={(status) =>
        setProject((prev) => (prev ? { ...prev, status: status as Project['status'] } : prev))
      }
    />

    {/* Right: Panel */}
    <AnimatePresence initial={false}>
      {showShortcuts === 'true' && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 208, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="flex-shrink-0 border-l border-border overflow-hidden"
        >
          <RightPanel
            projectId={id}
            onSend={(text) => terminalViewRef.current?.sendTerminalInput(text)}
          />
        </motion.div>
      )}
    </AnimatePresence>
  </div>
)}
```

Note: `cn` 需要 import from `@/lib/utils`（已有）。也需要在文件顶部补 `import { cn } from '@/lib/utils';` 如果还没有。

- [ ] **Step 6.3: 验证前端编译**
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
Git 面板:
  □ 打开一个有 git 仓库的项目
  □ RightPanel 点击 "Git" 标签 → 显示当前分支 + 变更文件
  □ 点击文件名 → 弹出 diff 面板，绿/红高亮
  □ 点击 "+" → git add，状态刷新
  □ 填入提交消息 + 点提交 → 成功提示，状态刷新
  □ 非 git 仓库 → 显示"非 Git 仓库"

全局搜索:
  □ Dashboard 顶部显示搜索框
  □ 输入 2+ 字符 → 300ms 后显示下拉结果
  □ 点击结果 → 跳转到对应项目页

移动端:
  □ 将浏览器窗口缩小到 < 768px
  □ 底部显示 3 个 Tab（文件 / 终端 / 面板）
  □ 点击切换单栏显示
  □ 宽屏时恢复 3 栏布局
```

- [ ] **Step 7.3: 版本号 bump 到 v1.5.50，四文件同步**

修改：`package.json`, `frontend/src/components/UpdateButton.tsx`, `README.md`, `CLAUDE.md`

- [ ] **Step 7.4: 提交**
```bash
git add backend/src/routes/projects.ts \
  backend/src/routes/git.ts \
  backend/src/index.ts \
  backend/package.json \
  backend/package-lock.json \
  frontend/src/lib/api.ts \
  frontend/src/components/GitPanel.tsx \
  frontend/src/components/RightPanel.tsx \
  frontend/src/pages/DashboardPage.tsx \
  frontend/src/pages/ProjectPage.tsx \
  package.json README.md CLAUDE.md \
  frontend/src/components/UpdateButton.tsx

git commit -m "feat: session search, git panel, mobile layout (v1.5.50)"
```
