# Memory Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Memory Pool" tab to the project left panel that lets users initialize a `.memory-pool/` directory with AI-readable spec docs, view memory balls sorted by buoyancy, and send quick commands to the terminal for memory operations.

**Architecture:** Backend provides 4 read-only API endpoints (status, init, index, ball detail) plus one command endpoint. Init generates `.memory-pool/` with SPEC.md, QUICK-REF.md, state.json, index.json, and appends instructions to CLAUDE.md. Frontend adds a MemoryPoolPanel component to LeftPanel with a list view and a bubble dialog popup. Quick action buttons send preset prompts to the terminal via the existing `onSend` WebSocket mechanism (same pattern as RightPanel shortcuts).

**Tech Stack:** Express (backend routes), React + Tailwind + shadcn/ui (frontend), motion/react (animations), YAML frontmatter parsing (gray-matter), SVG (bubble visualization)

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `backend/src/routes/memory-pool.ts` | REST API: init, status, index, ball detail, command |
| Create | `backend/src/memory-pool/templates.ts` | SPEC.md, QUICK-REF.md, CLAUDE.md block content |
| Modify | `backend/src/index.ts:148` | Mount memory-pool router |
| Create | `frontend/src/components/MemoryPoolPanel.tsx` | Left panel tab content: init button, ball list, action buttons |
| Create | `frontend/src/components/MemoryPoolBubbleDialog.tsx` | Floating ball visualization popup |
| Modify | `frontend/src/components/LeftPanel.tsx` | Add 'memory' tab |
| Modify | `frontend/src/lib/api.ts` | Add memory-pool API functions |
| Modify | `frontend/src/pages/ProjectPage.tsx` | Pass `onSend` to LeftPanel |

---

### Task 1: Backend — Document Templates

**Files:**
- Create: `backend/src/memory-pool/templates.ts`

- [ ] **Step 1: Create templates file with all three document generators**

```typescript
// backend/src/memory-pool/templates.ts

export function generateSpecMd(): string {
  return `# Memory Pool 规范文档 (SPEC.md)

> 本文档定义了记忆池系统的完整规范。AI 应在执行复杂记忆操作（分化、融合、架构调整）时参考本文档。
> 日常操作请使用 QUICK-REF.md。

## 一、核心模型：楔形容器与浮球系统

记忆池是一个**楔形容器**——上窄下深，深度无限。每条记忆是容器中的一个**浮球**，对应 \`balls/\` 下的一个 \`.md\` 文件。

- **活跃层**：浮力最高的 Top-N 个球（N = \`state.json\` 中的 \`active_capacity\`），AI 每次对话应优先加载
- **深层**：其余球，不主动加载，但可通过查询或连线召回
- **永不消失**：浮力趋近于零但永远不为零，任何记忆都可被召回

## 二、浮力公式

\`\`\`
B(t) = (B₀ + α · H) · λ^(t - t_last)
\`\`\`

| 符号 | 含义 | 来源 |
|------|------|------|
| B₀ | 初始浮力 | 球文件 frontmatter \`B0\` |
| H | 累计命中次数 | 球文件 frontmatter \`H\` |
| α | 查询增益系数 | \`state.json\` → \`alpha\`（默认 1.0） |
| λ | 衰减率 | \`state.json\` → \`lambda\`（默认 0.97） |
| t | 当前全局轮次 | \`state.json\` → \`t\` |
| t_last | 上次访问轮次 | 球文件 frontmatter \`t_last\` |

**轮次规则**：每条用户消息算一轮。AI 在对话开始时读取 \`state.json\` 的 \`t\` 值，在对话过程中根据用户消息数量自增并写回。

## 三、球的五个属性

| 属性 | 字段 | 说明 |
|------|------|------|
| 体积 | （正文长度） | 信息的 token 数或字数，越长越大 |
| 浮力 | \`B0\`, \`H\`, \`t_last\` | 由公式计算，决定检索优先级 |
| 硬度 | \`hardness\` (0-10) | 抗拆解能力，硬度高的球抵抗分化 |
| 连线 | \`links[]\` | 与其他球的关联：\`strong\`（分化产生）或 \`weak\`（共现产生） |
| 融合潜力 | \`fusion_potential\` (0-1) | 多次共现检索时累积，超过阈值可触发融合 |

## 四、球的四种类型

| 类型 | B₀ 参考 | 用途 |
|------|---------|------|
| \`feedback\` | 8-10 | 用户纠正、行为反馈——直接影响行为正确性 |
| \`user\` | 5-7 | 用户身份、偏好、知识背景 |
| \`project\` | 4-6 | 项目上下文、技术决策、进度状态 |
| \`reference\` | 2-4 | 外部资源指针（URL、文档位置等） |

## 五、球文件格式

文件路径：\`.memory-pool/balls/ball_XXXX.md\`

\`\`\`yaml
---
id: ball_0042
type: feedback
B0: 8
H: 3
t_last: 156
hardness: 7
fusion_potential: 0.3
links:
  - target: ball_0015
    strength: strong
  - target: ball_0038
    strength: weak
created_at: "2026-04-03T10:00:00Z"
---

（记忆正文内容）
\`\`\`

**字段规则：**
- \`id\`：与文件名一致，格式 \`ball_XXXX\`（从 \`state.json\` 的 \`next_id\` 获取，创建后自增）
- \`type\`：必须是 \`user\` / \`feedback\` / \`project\` / \`reference\` 之一
- \`B0\`：初始浮力，参考上方类型表
- \`H\`：初始为 0，每次被查询/使用时 +1
- \`t_last\`：初始为创建时的 \`t\` 值，每次被访问时重置为当前 \`t\`
- \`hardness\`：0-10，评估语义完整性（拆了就丧失意义的信息硬度高）
- \`fusion_potential\`：0-1，初始为 0，多次共现检索时累积
- \`links\`：数组，每项包含 \`target\`（目标球 ID）和 \`strength\`（\`strong\` 或 \`weak\`）
- \`created_at\`：ISO 8601 时间戳

## 六、state.json 格式

\`\`\`json
{
  "t": 0,
  "lambda": 0.97,
  "alpha": 1.0,
  "active_capacity": 20,
  "next_id": 1,
  "pool": "project",
  "initialized_at": "2026-04-03T10:00:00Z"
}
\`\`\`

## 七、index.json 格式

AI 每次修改球文件后必须同步更新 index.json。前端读取此文件渲染列表。

\`\`\`json
{
  "t": 156,
  "updated_at": "2026-04-03T12:30:00Z",
  "balls": [
    {
      "id": "ball_0042",
      "type": "feedback",
      "summary": "不在代码中添加多余注释",
      "B0": 8,
      "H": 3,
      "t_last": 156,
      "buoyancy": 8.2,
      "hardness": 7,
      "links": ["ball_0015", "ball_0038"]
    }
  ]
}
\`\`\`

**\`buoyancy\` 字段**：AI 在更新 index 时用公式计算并写入，前端直接读取显示。

## 八、操作流程

### 8.1 创建球

1. 读取 \`state.json\`，获取 \`next_id\` 和当前 \`t\`
2. 创建 \`balls/ball_XXXX.md\`，填写 frontmatter 和正文
3. \`state.json\` 的 \`next_id\` += 1
4. 更新 \`index.json\`：添加新球条目，重新计算所有球的 \`buoyancy\`，按浮力降序排列

### 8.2 查询/使用球（命中更新）

每次在对话中使用某个球的信息时：
1. 该球 \`H\` += 1
2. \`t_last\` = 当前 \`t\`
3. 更新球文件和 \`index.json\`

### 8.3 维护（衰减、分化、融合）

**衰减**：不需要显式操作——浮力公式中的 \`λ^(t - t_last)\` 自动完成衰减。每次更新 index.json 时重新计算即可。

**分化**（大球拆为多个小球）：
- 触发条件：活跃层空间不足，且存在体积大的球
- 判据：易裂度 = (z - x) / (y - x)，其中 x=原球浮力，y=子球最大浮力，z=子球最小浮力
- 硬度约束：硬度 ≥ 7 的球不拆
- 操作：删除原球文件，创建多个新球文件，新球之间建立 \`strong\` 连线

**融合**（多个小球合为一个）：
- 触发条件：\`fusion_potential\` > 0.7 的多个球
- 操作：合并源球内容为新球，重新评估 B₀ 和硬度，继承外部连线，删除源球文件

### 8.4 连线召回

查询命中活跃层某球时，检查其 \`links\`：
- \`strong\` 连线：直接拉出关联球（H+=1, t_last 重置）
- \`weak\` 连线：仅当该连线已被多次激活时触发

### 8.5 轮次自增

AI 在对话中应跟踪用户消息数量，在对话结束或执行记忆操作时将增量写入 \`state.json\` 的 \`t\`。

## 九、多容器架构（预留）

当前为项目级记忆池（\`pool: "project"\`）。未来可扩展全局池（\`~/.ccweb/memory-pool/\`，\`pool: "global"\`，\`lambda: 0.99\`）。球文件格式和操作流程保持一致。
`;
}

export function generateQuickRefMd(): string {
  return `# Memory Pool 快速参考 (QUICK-REF.md)

> AI 日常操作记忆池时读取此文档。完整规范见 SPEC.md。

## 创建球

\`\`\`bash
# 1. 读取 state.json 获取 next_id 和 t
# 2. 创建文件
\`\`\`

\`\`\`yaml
---
id: ball_{next_id 补零到4位}
type: feedback | user | project | reference
B0: {参考下方}
H: 0
t_last: {当前 t}
hardness: {0-10}
fusion_potential: 0
links: []
created_at: "{ISO时间}"
---

{记忆正文}
\`\`\`

\`\`\`
# 3. state.json next_id += 1
# 4. 更新 index.json（重算所有 buoyancy，降序排列）
\`\`\`

**B₀ 参考**：feedback=8-10 | user=5-7 | project=4-6 | reference=2-4

## 浮力计算

\`\`\`
B(t) = (B0 + alpha * H) * lambda^(t - t_last)
\`\`\`

默认参数在 state.json：lambda=0.97, alpha=1.0

## 命中更新

使用某球信息时：H += 1, t_last = 当前 t，更新球文件 + index.json

## 维护流程

1. 读取 state.json 和所有球文件
2. 对每个球计算当前 buoyancy
3. 按 buoyancy 降序排列
4. 前 active_capacity 个为活跃层，其余为深层
5. 检查是否需要分化（活跃层满 + 大球 + 硬度 < 7）
6. 检查是否需要融合（fusion_potential > 0.7 的共现球组）
7. 写回所有修改的球文件 + index.json

## 轮次管理

每条用户消息 = 1 轮。对话中跟踪消息数，操作记忆时将增量写入 state.json 的 t。

## index.json 更新

**每次修改球文件后必须更新 index.json**。每个球条目：

\`\`\`json
{ "id", "type", "summary"(正文首行或摘要), "B0", "H", "t_last", "buoyancy"(计算值), "hardness", "links"(ID数组) }
\`\`\`
`;
}

export function generateClaudeMdBlock(): string {
  return `
## 记忆池（Memory Pool）

本项目已启用记忆池系统。

**每次对话开始时：**
1. 读取 \`.memory-pool/QUICK-REF.md\` 了解操作规范
2. 读取 \`.memory-pool/state.json\` 获取当前轮次
3. 读取 \`.memory-pool/index.json\` 加载活跃层记忆
4. 将活跃层记忆纳入当前对话上下文

**对话过程中：**
- 遇到重要信息时主动提议存入记忆池
- 用户要求记忆操作时参照 QUICK-REF.md 执行
- 每次操作后更新 index.json

**完整规范：** \`.memory-pool/SPEC.md\`
`;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/memory-pool/templates.ts
git commit -m "feat(memory-pool): add document templates for SPEC, QUICK-REF, CLAUDE.md"
```

---

### Task 2: Backend — Memory Pool Route

**Files:**
- Create: `backend/src/routes/memory-pool.ts`
- Modify: `backend/src/index.ts:148`

- [ ] **Step 1: Create the memory-pool route file**

```typescript
// backend/src/routes/memory-pool.ts
import { Router, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AuthRequest } from '../auth';
import { getProject, isAdminUser, isProjectOwner, atomicWriteSync } from '../config';
import { generateSpecMd, generateQuickRefMd, generateClaudeMdBlock } from '../memory-pool/templates';

const router = Router();

const BALL_ID_RE = /^ball_\d{1,6}$/;
const MEMORY_POOL_DIR = '.memory-pool';
const CLAUDE_MD_MARKER = '## 记忆池（Memory Pool）';

function resolveProjectFolder(projectId: string, username: string, res: Response): string | null {
  const project = getProject(projectId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return null; }
  if (!isAdminUser(username) && !isProjectOwner(project, username) &&
      !project.shares?.some((s: { username: string; permission: string }) => s.username === username && s.permission === 'edit')) {
    res.status(403).json({ error: 'Access denied' }); return null;
  }
  return project.folderPath;
}

// GET /api/memory-pool/:projectId/status
router.get('/:projectId/status', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const poolDir = path.join(folder, MEMORY_POOL_DIR);
  const stateFile = path.join(poolDir, 'state.json');

  if (!fs.existsSync(stateFile)) {
    res.json({ initialized: false });
    return;
  }

  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    const ballsDir = path.join(poolDir, 'balls');
    let ballCount = 0;
    try {
      ballCount = fs.readdirSync(ballsDir).filter(f => f.endsWith('.md')).length;
    } catch { /* empty */ }
    res.json({ initialized: true, state, ballCount });
  } catch {
    res.json({ initialized: false });
  }
});

// POST /api/memory-pool/:projectId/init
router.post('/:projectId/init', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const poolDir = path.join(folder, MEMORY_POOL_DIR);
  if (fs.existsSync(path.join(poolDir, 'state.json'))) {
    res.status(409).json({ error: 'Memory pool already initialized' });
    return;
  }

  // Create directory structure
  fs.mkdirSync(path.join(poolDir, 'balls'), { recursive: true });

  // Generate documents
  atomicWriteSync(path.join(poolDir, 'SPEC.md'), generateSpecMd());
  atomicWriteSync(path.join(poolDir, 'QUICK-REF.md'), generateQuickRefMd());

  const now = new Date().toISOString();
  const state = {
    t: 0,
    lambda: 0.97,
    alpha: 1.0,
    active_capacity: 20,
    next_id: 1,
    pool: 'project',
    initialized_at: now,
  };
  atomicWriteSync(path.join(poolDir, 'state.json'), JSON.stringify(state, null, 2));

  const index = { t: 0, updated_at: now, balls: [] };
  atomicWriteSync(path.join(poolDir, 'index.json'), JSON.stringify(index, null, 2));

  // Append to CLAUDE.md if marker not present
  const claudeMdPath = path.join(folder, 'CLAUDE.md');
  try {
    const existing = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, 'utf-8') : '';
    if (!existing.includes(CLAUDE_MD_MARKER)) {
      const block = generateClaudeMdBlock();
      atomicWriteSync(claudeMdPath, existing + '\n' + block);
    }
  } catch {
    // Non-fatal: CLAUDE.md write failure shouldn't block init
  }

  res.json({ success: true });
});

// GET /api/memory-pool/:projectId/index
router.get('/:projectId/index', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const indexFile = path.join(folder, MEMORY_POOL_DIR, 'index.json');
  try {
    const data = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
    res.json(data);
  } catch {
    res.status(404).json({ error: 'Memory pool not initialized' });
  }
});

// GET /api/memory-pool/:projectId/ball/:ballId
router.get('/:projectId/ball/:ballId', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const { ballId } = req.params;
  if (!BALL_ID_RE.test(ballId)) {
    res.status(400).json({ error: 'Invalid ball ID format' });
    return;
  }

  const ballFile = path.join(folder, MEMORY_POOL_DIR, 'balls', `${ballId}.md`);
  try {
    const content = fs.readFileSync(ballFile, 'utf-8');
    res.json({ id: ballId, content });
  } catch {
    res.status(404).json({ error: 'Ball not found' });
  }
});

export default router;
```

- [ ] **Step 2: Mount the router in index.ts**

Add import and `app.use` line in `backend/src/index.ts`. Insert after the plan-control router mount (line 148):

```typescript
// Add import at top (after planControlRouter import):
import memoryPoolRouter from './routes/memory-pool';

// Add mount after line 148 (app.use('/api/projects', authMiddleware, planControlRouter)):
app.use('/api/memory-pool', authMiddleware, memoryPoolRouter);
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/memory-pool.ts backend/src/index.ts
git commit -m "feat(memory-pool): add backend API routes (status, init, index, ball)"
```

---

### Task 3: Frontend — API Functions

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add memory-pool API functions at the end of api.ts**

```typescript
// ── Memory Pool API ──────────────────────────────────────────────────────────

export interface MemoryPoolBall {
  id: string;
  type: 'user' | 'feedback' | 'project' | 'reference';
  summary: string;
  B0: number;
  H: number;
  t_last: number;
  buoyancy: number;
  hardness: number;
  links: string[];
}

export interface MemoryPoolIndex {
  t: number;
  updated_at: string;
  balls: MemoryPoolBall[];
}

export interface MemoryPoolState {
  t: number;
  lambda: number;
  alpha: number;
  active_capacity: number;
  next_id: number;
  pool: string;
  initialized_at: string;
}

export interface MemoryPoolStatus {
  initialized: boolean;
  state?: MemoryPoolState;
  ballCount?: number;
}

export async function getMemoryPoolStatus(projectId: string): Promise<MemoryPoolStatus> {
  return request<MemoryPoolStatus>('GET', `/api/memory-pool/${projectId}/status`);
}

export async function initMemoryPool(projectId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('POST', `/api/memory-pool/${projectId}/init`);
}

export async function getMemoryPoolIndex(projectId: string, signal?: AbortSignal): Promise<MemoryPoolIndex> {
  return request<MemoryPoolIndex>('GET', `/api/memory-pool/${projectId}/index`, undefined, true, signal);
}

export async function getMemoryPoolBall(projectId: string, ballId: string): Promise<{ id: string; content: string }> {
  return request<{ id: string; content: string }>('GET', `/api/memory-pool/${projectId}/ball/${ballId}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(memory-pool): add frontend API functions"
```

---

### Task 4: Frontend — MemoryPoolPanel Component

**Files:**
- Create: `frontend/src/components/MemoryPoolPanel.tsx`

- [ ] **Step 1: Create the MemoryPoolPanel component**

```tsx
// frontend/src/components/MemoryPoolPanel.tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  getMemoryPoolStatus,
  initMemoryPool,
  getMemoryPoolIndex,
  MemoryPoolStatus,
  MemoryPoolIndex,
  MemoryPoolBall,
} from '@/lib/api';
import { cn } from '@/lib/utils';

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  feedback: { bg: 'bg-blue-500', text: 'text-blue-400', border: 'border-blue-500/30' },
  user: { bg: 'bg-green-500', text: 'text-green-400', border: 'border-green-500/30' },
  project: { bg: 'bg-yellow-500', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  reference: { bg: 'bg-purple-500', text: 'text-purple-400', border: 'border-purple-500/30' },
};

const COMMANDS = {
  maintain: '请执行记忆池维护：读取 .memory-pool/QUICK-REF.md，然后执行衰减计算、分化判定、融合检查，最后更新 index.json',
  load: '请读取 .memory-pool/index.json 和活跃层记忆球，将重要记忆纳入当前上下文',
  save: '请从我们当前的对话中提取值得记忆的信息，按照 .memory-pool/QUICK-REF.md 的规范存入记忆池',
  general: '请读取 .memory-pool/QUICK-REF.md，对记忆池执行你认为合适的操作',
} as const;

interface MemoryPoolPanelProps {
  projectId: string;
  onSend?: (text: string) => void;
  onBallClick?: (ball: MemoryPoolBall, allBalls: MemoryPoolBall[]) => void;
}

export function MemoryPoolPanel({ projectId, onSend, onBallClick }: MemoryPoolPanelProps) {
  const [status, setStatus] = useState<MemoryPoolStatus | null>(null);
  const [index, setIndex] = useState<MemoryPoolIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [initLoading, setInitLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const s = await getMemoryPoolStatus(projectId);
      setStatus(s);
      return s.initialized;
    } catch {
      return false;
    }
  }, [projectId]);

  const fetchIndex = useCallback(async () => {
    try {
      const data = await getMemoryPoolIndex(projectId);
      setIndex(data);
    } catch { /* pool may not exist */ }
  }, [projectId]);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const initialized = await fetchStatus();
      if (!cancelled && initialized) await fetchIndex();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId, fetchStatus, fetchIndex]);

  // Poll index every 5s when initialized
  useEffect(() => {
    if (!status?.initialized) return;

    const poll = () => fetchIndex();
    pollRef.current = setInterval(poll, 5000);

    const onVisChange = () => {
      if (document.hidden) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      } else {
        poll();
        pollRef.current = setInterval(poll, 5000);
      }
    };
    document.addEventListener('visibilitychange', onVisChange);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, [status?.initialized, fetchIndex]);

  const handleInit = async () => {
    setInitLoading(true);
    try {
      await initMemoryPool(projectId);
      await fetchStatus();
      await fetchIndex();
    } catch (err: any) {
      console.error('Memory pool init failed:', err);
    } finally {
      setInitLoading(false);
    }
  };

  const sendCommand = (action: keyof typeof COMMANDS) => {
    if (onSend) onSend(COMMANDS[action] + '\r');
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-xs text-muted-foreground">加载中...</div>;
  }

  // Not initialized: show init button
  if (!status?.initialized) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
        <div className="text-3xl opacity-30">🧠</div>
        <p className="text-muted-foreground text-xs text-center">本项目尚未启用记忆池</p>
        <Button size="sm" onClick={handleInit} disabled={initLoading}>
          {initLoading ? '初始化中...' : '初始化记忆池'}
        </Button>
      </div>
    );
  }

  // Initialized: show ball list
  const balls = index?.balls ?? [];
  const activeCapacity = status.state?.active_capacity ?? 20;
  const activeBalls = balls.slice(0, activeCapacity);
  const deepBalls = balls.slice(activeCapacity);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-3 pt-2 pb-1 flex items-center justify-between">
        <span className="font-medium text-xs text-foreground">记忆池</span>
        <span className="text-[10px] text-muted-foreground">
          t={status.state?.t ?? 0} · {balls.length} balls
        </span>
      </div>

      {/* Quick action buttons */}
      <div className="flex-shrink-0 px-3 pb-2 flex gap-1 flex-wrap">
        <button onClick={() => sendCommand('maintain')} className="px-2 py-0.5 text-[10px] rounded border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition-colors">
          整理
        </button>
        <button onClick={() => sendCommand('load')} className="px-2 py-0.5 text-[10px] rounded border border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors">
          读取
        </button>
        <button onClick={() => sendCommand('save')} className="px-2 py-0.5 text-[10px] rounded border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 transition-colors">
          保存
        </button>
        <button onClick={() => sendCommand('general')} className="px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:bg-muted/30 transition-colors">
          通用
        </button>
      </div>

      {/* Ball list */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
        {activeBalls.length > 0 && (
          <>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">活跃层</div>
            {activeBalls.map((ball) => (
              <BallCard key={ball.id} ball={ball} onClick={() => onBallClick?.(ball, balls)} />
            ))}
          </>
        )}
        {deepBalls.length > 0 && (
          <>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider mt-3 mb-1">深层</div>
            {deepBalls.map((ball) => (
              <BallCard key={ball.id} ball={ball} deep onClick={() => onBallClick?.(ball, balls)} />
            ))}
          </>
        )}
        {balls.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-8">
            记忆池为空，在终端中与 AI 对话时会自动积累记忆
          </div>
        )}
      </div>
    </div>
  );
}

function BallCard({ ball, deep, onClick }: { ball: MemoryPoolBall; deep?: boolean; onClick?: () => void }) {
  const colors = TYPE_COLORS[ball.type] ?? TYPE_COLORS.reference;
  return (
    <div
      onClick={onClick}
      className={cn(
        'p-2 rounded-md cursor-pointer transition-colors border-l-2',
        deep ? 'bg-muted/20 opacity-50 hover:opacity-70' : 'bg-muted/40 hover:bg-muted/60',
        colors.border,
      )}
    >
      <div className="flex items-center justify-between mb-0.5">
        <span className={cn('text-[9px] px-1 py-px rounded text-white', colors.bg)}>{ball.type}</span>
        <span className={cn('text-[10px] font-medium', colors.text)}>B {ball.buoyancy.toFixed(1)}</span>
      </div>
      <div className="text-[11px] text-foreground leading-tight line-clamp-2">{ball.summary}</div>
      <div className="text-[9px] text-muted-foreground mt-0.5">
        H={ball.H} · t={ball.t_last}{ball.links.length > 0 ? ` · ${ball.links.length} links` : ''}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/MemoryPoolPanel.tsx
git commit -m "feat(memory-pool): add MemoryPoolPanel component with list view and action buttons"
```

---

### Task 5: Frontend — MemoryPoolBubbleDialog Component

**Files:**
- Create: `frontend/src/components/MemoryPoolBubbleDialog.tsx`

- [ ] **Step 1: Create the bubble dialog component**

```tsx
// frontend/src/components/MemoryPoolBubbleDialog.tsx
import { useState, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { MemoryPoolBall } from '@/lib/api';
import { cn } from '@/lib/utils';

const TYPE_FILL: Record<string, { main: string; light: string }> = {
  feedback: { main: '#4a6cf7', light: '#6b8cff' },
  user: { main: '#22c55e', light: '#5ee87a' },
  project: { main: '#f59e0b', light: '#fbbf4e' },
  reference: { main: '#a78bfa', light: '#c4b5fd' },
};

interface MemoryPoolBubbleDialogProps {
  balls: MemoryPoolBall[];
  selectedId?: string;
  activeCapacity: number;
  onClose: () => void;
}

export function MemoryPoolBubbleDialog({ balls, selectedId, activeCapacity, onClose }: MemoryPoolBubbleDialogProps) {
  const [selected, setSelected] = useState<string | undefined>(selectedId);
  const containerRef = useRef<HTMLDivElement>(null);

  // Drag state (refs to avoid stale closures)
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const offsetRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-ball]')) return; // don't drag when clicking ball
    draggingRef.current = true;
    dragStartRef.current = { x: e.clientX - offsetRef.current.x, y: e.clientY - offsetRef.current.y };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingRef.current) return;
    const newOffset = {
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    };
    offsetRef.current = newOffset;
    setOffset(newOffset);
  }, []);

  const handleMouseUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  // Layout: distribute balls vertically by buoyancy rank
  const maxBuoyancy = balls.length > 0 ? Math.max(...balls.map(b => b.buoyancy), 0.01) : 1;
  const viewHeight = 500;
  const viewWidth = 600;
  const padding = 60;

  // Compute positions: higher buoyancy = higher position (lower y)
  const positioned = balls.map((ball, i) => {
    const ratio = maxBuoyancy > 0 ? ball.buoyancy / maxBuoyancy : 0;
    const y = padding + (viewHeight - padding * 2) * (1 - ratio);
    // Spread horizontally with some variation based on index
    const xBase = viewWidth / 2;
    const xSpread = (viewWidth - padding * 2) * 0.4;
    const angle = (i * 137.5 * Math.PI) / 180; // golden angle spread
    const r = Math.sqrt(i + 1) * (xSpread / Math.sqrt(balls.length + 1));
    const x = xBase + Math.cos(angle) * r;
    // Ball size: based on summary length (proxy for volume)
    const minSize = 20;
    const maxSize = 60;
    const size = Math.min(maxSize, Math.max(minSize, 15 + ball.summary.length * 0.5));
    return { ball, x, y, size };
  });

  const selectedBall = balls.find(b => b.id === selected);

  // Active/deep divider line Y position
  const dividerY = activeCapacity < balls.length
    ? (() => {
        const lastActive = positioned[activeCapacity - 1];
        const firstDeep = positioned[activeCapacity];
        return lastActive && firstDeep ? (lastActive.y + firstDeep.y) / 2 : viewHeight - padding;
      })()
    : viewHeight - padding;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="relative bg-background border border-border rounded-xl shadow-2xl overflow-hidden"
        style={{ width: Math.min(viewWidth + 40, window.innerWidth - 40), height: Math.min(viewHeight + 120, window.innerHeight - 40) }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <span className="text-sm font-medium">记忆池全景</span>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> feedback</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> user</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> project</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400 inline-block" /> reference</span>
            <button onClick={onClose} className="ml-2 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* SVG canvas */}
        <div
          ref={containerRef}
          className="cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <svg width="100%" height={viewHeight} viewBox={`0 0 ${viewWidth} ${viewHeight}`}>
            <g transform={`translate(${offset.x}, ${offset.y})`}>
              {/* Active/Deep divider */}
              <line x1={padding} y1={dividerY} x2={viewWidth - padding} y2={dividerY} stroke="#333" strokeDasharray="4,4" />
              <text x={viewWidth - padding} y={dividerY - 5} textAnchor="end" fill="#555" fontSize="9">深层</text>

              {/* Links */}
              {positioned.map(({ ball: b, x: x1, y: y1 }) =>
                b.links.map((targetId) => {
                  const target = positioned.find(p => p.ball.id === targetId);
                  if (!target) return null;
                  return (
                    <line
                      key={`${b.id}-${targetId}`}
                      x1={x1} y1={y1} x2={target.x} y2={target.y}
                      stroke="#4a6cf744" strokeWidth={1} strokeDasharray="4,4"
                    />
                  );
                })
              )}

              {/* Balls */}
              {positioned.map(({ ball, x, y, size }) => {
                const isActive = balls.indexOf(ball) < activeCapacity;
                const isSelected = ball.id === selected;
                const colors = TYPE_FILL[ball.type] ?? TYPE_FILL.reference;
                return (
                  <g
                    key={ball.id}
                    data-ball
                    onClick={() => setSelected(ball.id)}
                    className="cursor-pointer"
                    opacity={isActive ? 1 : 0.35}
                  >
                    <circle
                      cx={x} cy={y} r={size / 2}
                      fill={`url(#grad-${ball.type})`}
                      stroke={isSelected ? '#fff' : 'none'}
                      strokeWidth={isSelected ? 2 : 0}
                    />
                    {size > 30 && (
                      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={Math.max(8, size * 0.15)}>
                        {ball.summary.slice(0, Math.floor(size / 5))}
                      </text>
                    )}
                    {isSelected && (
                      <circle cx={x} cy={y} r={size / 2 + 4} fill="none" stroke={colors.main} strokeWidth={1} opacity={0.5} />
                    )}
                  </g>
                );
              })}

              {/* Gradients */}
              <defs>
                {Object.entries(TYPE_FILL).map(([type, { main, light }]) => (
                  <radialGradient key={type} id={`grad-${type}`} cx="35%" cy="35%">
                    <stop offset="0%" stopColor={light} />
                    <stop offset="100%" stopColor={main} />
                  </radialGradient>
                ))}
              </defs>
            </g>
          </svg>
        </div>

        {/* Selected ball info bar */}
        {selectedBall && (
          <div className="absolute bottom-0 left-0 right-0 px-4 py-2 bg-background/95 border-t border-border">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={cn(
                'text-[9px] px-1 py-px rounded text-white',
                TYPE_FILL[selectedBall.type] ? '' : '',
              )} style={{ backgroundColor: TYPE_FILL[selectedBall.type]?.main ?? '#888' }}>{selectedBall.type}</span>
              <span className="text-xs font-medium text-foreground">{selectedBall.summary}</span>
            </div>
            <div className="flex gap-3 text-[10px] text-muted-foreground">
              <span>B={selectedBall.buoyancy.toFixed(1)}</span>
              <span>H={selectedBall.H}</span>
              <span>硬度={selectedBall.hardness}</span>
              {selectedBall.links.length > 0 && <span>连线: {selectedBall.links.join(', ')}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/MemoryPoolBubbleDialog.tsx
git commit -m "feat(memory-pool): add floating ball visualization dialog"
```

---

### Task 6: Frontend — Wire Up LeftPanel and ProjectPage

**Files:**
- Modify: `frontend/src/components/LeftPanel.tsx`
- Modify: `frontend/src/pages/ProjectPage.tsx`

- [ ] **Step 1: Add 'memory' tab to LeftPanel**

In `frontend/src/components/LeftPanel.tsx`:

1. Add imports:

```typescript
import { useState, lazy, Suspense } from 'react';
// ... existing imports ...
import { MemoryPoolPanel } from './MemoryPoolPanel';
import { MemoryPoolBubbleDialog } from './MemoryPoolBubbleDialog';
import { MemoryPoolBall } from '@/lib/api';
```

2. Update the `LeftTab` type and labels:

```typescript
type LeftTab = 'files' | 'git' | 'plan' | 'memory';

const TAB_LABELS: Record<LeftTab, string> = {
  files: '文件',
  git: 'Git',
  plan: '任务',
  memory: '记忆',
};
```

3. Add `onSend` to the props interface:

```typescript
interface LeftPanelProps {
  projectPath: string;
  projectId: string;
  planStatus?: { status: string; executed_tasks: number; estimated_tasks: number; current_line: number } | null;
  planNodeUpdate?: { node_id: string; status: string; summary: string | null } | null;
  planReplan?: number;
  onSend?: (text: string) => void;
}
```

4. Update the component body:

```typescript
export function LeftPanel({ projectPath, projectId, planStatus, planNodeUpdate, planReplan, onSend }: LeftPanelProps) {
  const [tab, setTab] = useState<LeftTab>('files');
  const [bubbleState, setBubbleState] = useState<{ balls: MemoryPoolBall[]; selectedId: string; capacity: number } | null>(null);

  return (
    <div className="h-full flex flex-row">
      {/* Tab strip on the left */}
      <div className="flex flex-col flex-shrink-0 w-7 border-r border-border bg-background">
        {(['files', 'git', 'plan', 'memory'] as LeftTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'flex-none px-1.5 py-3 text-[11px] font-medium transition-colors select-none',
              tab === t
                ? 'text-blue-400 bg-muted/50 border-r-2 border-blue-500 -mr-px'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
            )}
            style={{ writingMode: 'vertical-rl' }}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {tab === 'files' && (
          <motion.div key="files" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex-1 min-w-0 overflow-hidden">
            <FileTree projectPath={projectPath} projectId={projectId} />
          </motion.div>
        )}
        {tab === 'git' && (
          <motion.div key="git" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex-1 min-w-0 overflow-hidden">
            <GitPanel projectId={projectId} />
          </motion.div>
        )}
        {tab === 'plan' && (
          <motion.div key="plan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex-1 min-w-0 overflow-hidden">
            <Suspense fallback={<div className="flex items-center justify-center h-full text-xs text-muted-foreground">加载中...</div>}>
              <PlanPanel projectId={projectId} projectPath={projectPath} planStatus={planStatus} planNodeUpdate={planNodeUpdate} planReplan={planReplan} />
            </Suspense>
          </motion.div>
        )}
        {tab === 'memory' && (
          <motion.div key="memory" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex-1 min-w-0 overflow-hidden">
            <MemoryPoolPanel
              projectId={projectId}
              onSend={onSend}
              onBallClick={(ball, allBalls) => setBubbleState({ balls: allBalls, selectedId: ball.id, capacity: 20 })}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bubble dialog (renders as overlay) */}
      {bubbleState && (
        <MemoryPoolBubbleDialog
          balls={bubbleState.balls}
          selectedId={bubbleState.selectedId}
          activeCapacity={bubbleState.capacity}
          onClose={() => setBubbleState(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Pass onSend from ProjectPage to LeftPanel**

In `frontend/src/pages/ProjectPage.tsx`, update both mobile and desktop LeftPanel usages to pass `onSend`:

Mobile (around line 165):
```tsx
<LeftPanel
  projectPath={project.folderPath}
  projectId={id}
  planStatus={planStatus}
  planNodeUpdate={planNodeUpdate}
  planReplan={planReplan}
  onSend={(text) => terminalViewRef.current?.sendTerminalInput(text)}
/>
```

Desktop (around line 232):
```tsx
<LeftPanel
  projectPath={project.folderPath}
  projectId={id}
  planStatus={planStatus}
  planNodeUpdate={planNodeUpdate}
  planReplan={planReplan}
  onSend={(text) => terminalViewRef.current?.sendTerminalInput(text)}
/>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/LeftPanel.tsx frontend/src/pages/ProjectPage.tsx
git commit -m "feat(memory-pool): wire up MemoryPoolPanel in LeftPanel with bubble dialog"
```

---

### Task 7: Build Verification

- [ ] **Step 1: Build backend**

Run: `cd /Users/tom/Projects/cc-web && npm run build:backend`
Expected: No TypeScript errors

- [ ] **Step 2: Build frontend**

Run: `cd /Users/tom/Projects/cc-web && npm run build:frontend`
Expected: No TypeScript or Vite errors

- [ ] **Step 3: Fix any build errors**

If any errors, fix them and re-run the failing build.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(memory-pool): resolve build errors"
```

---

### Task 8: Manual Smoke Test

- [ ] **Step 1: Start the dev servers**

```bash
cd /Users/tom/Projects/cc-web && npm run dev:backend &
cd /Users/tom/Projects/cc-web && npm run dev:frontend &
```

- [ ] **Step 2: Verify left panel tab appears**

Open http://localhost:5173, navigate to a project. Verify the left panel shows 4 tabs: 文件 / Git / 任务 / 记忆.

- [ ] **Step 3: Verify init flow**

Click the 记忆 tab → see "初始化记忆池" button → click it → verify `.memory-pool/` directory is created with SPEC.md, QUICK-REF.md, state.json, index.json, and balls/ directory.

- [ ] **Step 4: Verify CLAUDE.md was updated**

Check that the project's CLAUDE.md now contains the "记忆池（Memory Pool）" section.

- [ ] **Step 5: Verify quick action buttons**

Click each of the 4 quick action buttons (整理/读取/保存/通用) and verify the corresponding command text appears in the terminal.

- [ ] **Step 6: Stop dev servers**
