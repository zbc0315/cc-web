import express from 'express';
import cors from 'cors';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as WebSocket from 'ws';
import { initDataDirs, getProject, getProjects, getGlobalShortcuts, saveGlobalShortcuts, writeProjectConfig, readProjectConfig, isProjectOwner } from './config';
import { authMiddleware, verifyToken } from './auth';
import { terminalManager } from './terminal-manager';
import { v4 as uuidv4 } from 'uuid';
import authRouter from './routes/auth';
import projectsRouter from './routes/projects';
import filesystemRouter from './routes/filesystem';
import shortcutsRouter from './routes/shortcuts';
import updateRouter from './routes/update';
import backupRouter, { backupAuthCallbackRouter } from './routes/backup';
import soundsRouter from './routes/sounds';
import skillhubRouter from './routes/skillhub';
import { startScheduler } from './backup/scheduler';
import { sessionManager, ChatBlock } from './session-manager';
import hooksRouter from './routes/hooks';
import { HooksManager } from './hooks-manager';
import * as os from 'os';

// Port file path: always ~/.ccweb/port (fixed path for hook shell commands)
const PORT_FILE = path.join(os.homedir(), '.ccweb', 'port');
const hooksManager = new HooksManager(PORT_FILE);

initDataDirs();
migrateProjectConfigs();
seedPresetShortcuts();

/** Backfill .ccweb/project.json for projects created before this feature existed */
function migrateProjectConfigs(): void {
  for (const project of getProjects()) {
    try {
      if (!readProjectConfig(project.folderPath)) {
        writeProjectConfig(project.folderPath, project);
        console.log(`[Migration] Wrote .ccweb/project.json for "${project.name}"`);
      }
    } catch (err) {
      console.error(`[Migration] Failed for "${project.name}":`, err);
    }
  }
}

function seedPresetShortcuts(): void {
  let shortcuts = getGlobalShortcuts();
  let changed = false;

  // 1. Seed: 图关系笔记本操作规范
  const NOTEBOOK_LABEL = '[Built-in] 图关系笔记本操作规范';
  let notebookGuide = shortcuts.find((s) => s.label === NOTEBOOK_LABEL);
  if (!notebookGuide) {
    notebookGuide = {
      id: uuidv4(), label: NOTEBOOK_LABEL,
      command: `你现在可以使用「图关系笔记本」来管理结构化知识。笔记本以纯文件形式存储在项目目录的 .notebook/ 文件夹中，你直接读写这些文件即可操作。

## 重要：请立即将以下规范固化到本项目的记忆中

请你现在就使用 Claude Code 的记忆系统（写入 memory 文件），将下面的「图关系笔记本规范」完整保存为一条项目记忆。这样即使跨会话，你也不会遗忘这些规则。保存后请确认。

---

## 图关系笔记本规范

### 文件结构

\`\`\`
.notebook/
├── graph.yaml          ← 唯一的元数据文件：页面注册表 + 有向依赖关系
└── pages/
    └── *.md            ← 每个页面一个 Markdown 文件
\`\`\`

### graph.yaml 格式

\`\`\`yaml
# 图关系笔记本元数据
pages:
  - id: <kebab-case 唯一标识>
    title: <页面标题>
    file: <文件名.md>
    parent: <父页面id | null>   # 层级结构（类似文件夹组织）

relations:
  # from → to 表示 to 页面的内容依赖于 from 页面
  - from: <源页面id>
    to: <目标页面id>
    label: <可选标签>
\`\`\`

### 操作规则（必须严格遵守）

1. **新建页面**：
   - 在 .notebook/pages/ 下创建 .md 文件
   - 在 graph.yaml 的 pages 列表中添加对应条目
   - 两步必须同时完成

2. **删除页面**：
   - 删除 .md 文件
   - 从 graph.yaml 的 pages 中移除该条目
   - 从 graph.yaml 的 relations 中移除所有涉及该页面的关系（from 或 to）
   - 三步必须同时完成

3. **新建关系**：在 graph.yaml 的 relations 中添加条目
   - from → to 语义：to 页面的内容依赖于 from 页面
   - 不允许自环（from 不能等于 to）

4. **删除关系**：从 graph.yaml 的 relations 中移除对应条目

5. **修改页面前（关键！）**：
   - 先读取 graph.yaml
   - 找到该页面作为 to 的所有 relations（即它的直接上游依赖）
   - 阅读所有上游页面的内容
   - 然后再修改当前页面，确保与上游一致

6. **查询上游依赖**：从 graph.yaml 的 relations 中，沿 from 方向递归遍历
7. **查询下游被依赖**：从 graph.yaml 的 relations 中，沿 to 方向递归遍历

### 约束
- graph.yaml 是唯一的元数据源，不要在其他地方维护页面列表或关系
- 页面 id 使用 kebab-case（如 master-outline, section1-outline）
- 每次增删页面文件都**必须**同步更新 graph.yaml
- 如果 .notebook/ 目录不存在，先创建 .notebook/pages/ 目录和空的 graph.yaml（内容为 pages: []\\nrelations: []）`,
    };
    shortcuts.push(notebookGuide);
    changed = true;
    console.log('[Seed] Created preset shortcut: 图关系笔记本操作规范');
  }

  // 2. Seed: 小说模式 (inherits 操作规范)
  const NOVEL_LABEL = '[Built-in] 小说模式';
  if (!shortcuts.some((s) => s.label === NOVEL_LABEL)) {
    shortcuts.push({
      id: uuidv4(), label: NOVEL_LABEL,
      parentId: notebookGuide.id,
      command: `请进入「小说模式」。你已经通过继承收到了图关系笔记本的操作规范（如果还没有写入记忆，请先完成），现在按照以下小说专用规则操作 .notebook/。

## 第一步：初始化

1. 读取当前项目目录下的 .notebook/graph.yaml
2. 如果 .notebook/ 不存在，按操作规范创建目录和空 graph.yaml
3. 如果已有页面，读取现有结构并跳过已存在的内容
4. 按下方模板创建缺失的页面文件和关系

## 页面模板

按操作规范，在 .notebook/pages/ 下创建 .md 文件并同步注册到 graph.yaml：

### 根页面（无上游依赖）
| id | 文件 | 内容 |
|----|------|------|
| master-outline | 全文总纲.md | 世界观、整体框架、故事简介、Section 划分、主要人物表 |
| writing-style | 文字风格.md | 语言风格定义、叙事视角、节奏要求、禁忌事项 |
| good-example-1 | 好的示例-1.md | 一段优秀的小说片段（按需创建更多：good-example-2, ...） |
| bad-example-1 | 坏的示例-1.md | 一段需要避免的写法（按需创建更多：bad-example-2, ...） |

### 中间页面（按需扩展）
| id 模式 | 文件模式 | 内容 |
|---------|----------|------|
| sectionN-outline | SectionN-总纲.md | 该 Section 的 Subsection 划分、涉及人物、情节走向 |
| sectionN-subM-outline | SectionN-SubM-总纲.md | 该 Subsection 下每章大纲、人物、关键事件 |
| sectionN-subM-chK | SectionN-SubM-ChK.md | 章节正文 |

N/M/K 为数字，按实际章节递增。

## 有向依赖关系规则

在 graph.yaml 的 relations 中严格按以下模式建立（from → to = to 依赖 from）：

\`\`\`
全文总纲 → 每个 Section 总纲
好的示例（每个） → 文字风格
坏的示例（每个） → 文字风格
文字风格 → 每个章节正文
Section 总纲 → 其所有 Subsection 总纲
Subsection 总纲 → 其所有章节正文
\`\`\`

示例 graph.yaml（1 个 Section、1 个 Subsection、1 章）：

\`\`\`yaml
pages:
  - { id: master-outline, title: 全文总纲, file: 全文总纲.md, parent: null }
  - { id: writing-style, title: 文字风格, file: 文字风格.md, parent: null }
  - { id: good-example-1, title: 好的示例-1, file: 好的示例-1.md, parent: null }
  - { id: bad-example-1, title: 坏的示例-1, file: 坏的示例-1.md, parent: null }
  - { id: section1-outline, title: Section1 总纲, file: Section1-总纲.md, parent: master-outline }
  - { id: section1-sub1-outline, title: Section1-Sub1 总纲, file: Section1-Sub1-总纲.md, parent: section1-outline }
  - { id: section1-sub1-ch1, title: Section1-Sub1-Ch1, file: Section1-Sub1-Ch1.md, parent: section1-sub1-outline }

relations:
  - { from: master-outline, to: section1-outline }
  - { from: good-example-1, to: writing-style }
  - { from: bad-example-1, to: writing-style }
  - { from: writing-style, to: section1-sub1-ch1 }
  - { from: section1-outline, to: section1-sub1-outline }
  - { from: section1-sub1-outline, to: section1-sub1-ch1 }
\`\`\`

## 工作流程

### 创建/修改任何页面前
按操作规范：先读 graph.yaml → 找到该页面的所有上游（from→该页面的 relations）→ 读取上游页面内容 → 再编写当前页面。

### 正向更新（我说「更新」时）
1. 读 graph.yaml 构建完整依赖图
2. 找到所有根节点（没有任何 relation 以它为 to 的页面）
3. 按拓扑序逐层向下：先更新父页面，再更新子页面
4. 每更新一个页面前，读取其所有直接上游页面的最新内容
5. 确保父子之间逻辑一致、不冲突

### 反向更新（我说「根据 X 反向更新」时）
1. 从我指定的页面出发
2. 读 graph.yaml 找到它的直接上游页面
3. 根据当前页面内容修改上游页面使之一致
4. 对上游页面重复此过程，迭代直到所有祖先更新完毕

### 新增 Section/Subsection/章节
1. 创建对应 .md 文件
2. 在 graph.yaml 的 pages 中添加条目（parent 设为其层级父页面 id）
3. 在 graph.yaml 的 relations 中按上述规则添加所有依赖边
4. 读取上游页面内容后再编写新页面

请确认你理解了小说模式规则，然后开始初始化 .notebook/。`,
    });
    changed = true;
    console.log('[Seed] Created preset shortcut: 小说模式');
  }

  if (changed) saveGlobalShortcuts(shortcuts);
}

const app = express();
const PORT = parseInt(process.env.CCWEB_PORT || '3001', 10);
const ACCESS_MODE = (process.env.CCWEB_ACCESS_MODE || 'local') as 'local' | 'lan' | 'public';
const LISTEN_HOST = ACCESS_MODE === 'local' ? '127.0.0.1' : '0.0.0.0';

/** Check if an IP address belongs to a private network range */
function isPrivateIP(ip: string): boolean {
  // Normalize IPv4-mapped IPv6 (::ffff:x.x.x.x)
  let addr = ip;
  if (addr.startsWith('::ffff:')) addr = addr.slice(7);

  // IPv6 loopback
  if (addr === '::1') return true;
  // IPv6 link-local
  if (addr.toLowerCase().startsWith('fe80:')) return true;

  // IPv4 checks
  const parts = addr.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return false;
  // 127.0.0.0/8
  if (parts[0] === 127) return true;
  // 10.0.0.0/8
  if (parts[0] === 10) return true;
  // 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

/** LAN mode IP filter middleware — reject non-private IPs */
if (ACCESS_MODE === 'lan') {
  app.use((req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || '';
    if (isPrivateIP(ip)) return next();
    res.status(403).json({ error: 'Access denied: LAN only' });
  });
}

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self' data:"
  );
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin, curl, Electron, etc.)
    if (!origin) return callback(null, true);
    // In lan/public mode, allow all origins
    if (ACCESS_MODE !== 'local') return callback(null, true);
    // Local mode: only allow localhost origins
    try {
      const u = new URL(origin);
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1') {
        return callback(null, true);
      }
    } catch { /* invalid origin */ }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/hooks', hooksRouter);
app.use('/api/projects', authMiddleware, projectsRouter);
app.use('/api/filesystem', authMiddleware, filesystemRouter);
app.use('/api/shortcuts', authMiddleware, shortcutsRouter);
app.use('/api/update', authMiddleware, updateRouter);
// OAuth callback must be accessible without auth (browser redirect from OAuth provider)
app.use('/api/backup/auth', backupAuthCallbackRouter);
app.use('/api/backup', authMiddleware, backupRouter);
app.use('/api/sounds', authMiddleware, soundsRouter);
app.use('/api/skillhub', authMiddleware, skillhubRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Serve built frontend (production / Electron)
const frontendDist = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (_req, res, next) => {
    if (_req.path.startsWith('/api/') || _req.path.startsWith('/ws/')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// projectId → connected WebSocket clients (all in terminal mode)
const projectClients = new Map<string, Set<WebSocket.WebSocket>>();

function broadcast(projectId: string, rawData: string): void {
  const clients = projectClients.get(projectId);
  if (!clients) return;
  const payload = JSON.stringify({ type: 'terminal_data', data: rawData });
  for (const client of clients) {
    if (client.readyState === WebSocket.WebSocket.OPEN) client.send(payload);
  }
}

function isLocalWs(req: http.IncomingMessage): boolean {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// ── Dashboard WebSocket clients (activity push) ─────────────────────────────
const dashboardClients = new Set<WebSocket.WebSocket>();

const SEMANTIC_STALE_MS = 30_000;

function broadcastDashboardActivity(projectId: string, lastActivityAt: number) {
  if (dashboardClients.size === 0) return;
  const semantic = sessionManager.getSemanticStatus(projectId);
  const stale = semantic && Date.now() - semantic.updatedAt > SEMANTIC_STALE_MS;
  const payload = JSON.stringify({
    type: 'activity_update',
    projectId,
    lastActivityAt,
    semantic: semantic && !stale ? semantic : undefined,
  });
  for (const client of dashboardClients) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(payload); } catch { /**/ }
    }
  }
}

function broadcastDashboardSemantic(projectId: string, status: { phase: string; detail?: string; updatedAt: number } | null) {
  if (dashboardClients.size === 0) return;
  // When status is non-null, LLM is currently active (hook just fired) — use Date.now() so frontend marks the project active.
  // When status is null (Stop hook), fall back to PTY timestamp.
  const lastActivityAt = status ? Date.now() : (terminalManager.getLastActivityAt(projectId) ?? Date.now());
  const payload = JSON.stringify({
    type: 'activity_update',
    projectId,
    lastActivityAt,
    semantic: status ?? undefined,
  });
  for (const client of dashboardClients) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(payload); } catch { /**/ }
    }
  }
}

// Wire up events from terminal-manager and session-manager
terminalManager.on('activity', ({ projectId, lastActivityAt }: { projectId: string; lastActivityAt: number }) => {
  broadcastDashboardActivity(projectId, lastActivityAt);
});

sessionManager.on('semantic', ({ projectId, status }: { projectId: string; status: { phase: string; detail?: string; updatedAt: number } | null }) => {
  broadcastDashboardSemantic(projectId, status);
});

wss.on('connection', (ws: WebSocket.WebSocket, req: http.IncomingMessage) => {
  const parsedUrl = new URL(req.url || '', 'http://localhost');

  // ── Dashboard WebSocket (/ws/dashboard) ────────────────────────────────────
  if (parsedUrl.pathname === '/ws/dashboard') {
    const localConnection = isLocalWs(req);
    let authenticated = localConnection;

    if (localConnection) {
      // Send initial full activity snapshot
      const allActivity = terminalManager.getAllActivity();
      const allSemantic = sessionManager.getAllSemanticStatus();
      for (const [id, lastActivityAt] of Object.entries(allActivity)) {
        const semantic = allSemantic[id];
        const stale = semantic && Date.now() - semantic.updatedAt > SEMANTIC_STALE_MS;
        ws.send(JSON.stringify({
          type: 'activity_update',
          projectId: id,
          lastActivityAt,
          semantic: semantic && !stale ? semantic : undefined,
        }));
      }
      dashboardClients.add(ws);
    }

    ws.on('message', (rawMsg: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(rawMsg.toString());
        if (!authenticated && parsed.type === 'auth' && parsed.token) {
          const user = verifyToken(parsed.token);
          if (user) {
            authenticated = true;
            // Send initial snapshot after auth
            const allActivity = terminalManager.getAllActivity();
            const allSemantic = sessionManager.getAllSemanticStatus();
            for (const [id, lastActivityAt] of Object.entries(allActivity)) {
              const semantic = allSemantic[id];
              const stale = semantic && Date.now() - semantic.updatedAt > SEMANTIC_STALE_MS;
              ws.send(JSON.stringify({
                type: 'activity_update',
                projectId: id,
                lastActivityAt,
                semantic: semantic && !stale ? semantic : undefined,
              }));
            }
            dashboardClients.add(ws);
          } else {
            ws.close(1008, 'Invalid token');
          }
        }
      } catch { /**/ }
    });

    ws.on('close', () => {
      dashboardClients.delete(ws);
    });
    return;
  }

  // ── Project WebSocket (/ws/projects/:id) ───────────────────────────────────
  const match = parsedUrl.pathname?.match(/^\/ws\/projects\/([^/]+)$/);
  if (!match) { ws.close(1008, 'Invalid path'); return; }

  const projectId = match[1];
  const localConnection = isLocalWs(req);
  let authenticated = localConnection; // localhost = pre-authenticated
  let wsReadOnly = false; // true for view-only shared projects
  const chatListener = (msg: ChatBlock) => {
    try { ws.send(JSON.stringify({ type: 'chat_message', ...msg })); } catch { /**/ }
  };

  const authTimeout = localConnection ? null : setTimeout(() => {
    if (!authenticated) ws.close(1008, 'Authentication timeout');
  }, 10000);

  // For local connections, set up project immediately
  if (localConnection) {
    const project = getProject(projectId);
    if (!project) {
      ws.send(JSON.stringify({ type: 'error', message: 'Project not found' }));
      ws.close(1008, 'Project not found');
      return;
    }
    const broadcastFn = (data: string) => broadcast(projectId, data);
    terminalManager.getOrCreate(project, broadcastFn);
    terminalManager.updateBroadcast(projectId, broadcastFn);
    ws.send(JSON.stringify({ type: 'connected', projectId }));
    ws.send(JSON.stringify({ type: 'status', status: project.status }));
  }

  ws.on('message', (rawMsg: WebSocket.RawData) => {
    try {
      let parsed: { type: string; token?: string; data?: string; cols?: number; rows?: number };
      try {
        parsed = JSON.parse(rawMsg.toString());
      } catch {
        return;
      }

      // ── Auth handshake (skipped for localhost) ─────────────────────────────────
      if (!authenticated) {
        if (parsed.type !== 'auth' || !parsed.token) {
          ws.close(1008, 'Authentication required');
          return;
        }
        const tokenUser = verifyToken(parsed.token);
        if (!tokenUser) {
          ws.close(1008, 'Invalid token');
          return;
        }
        if (authTimeout) clearTimeout(authTimeout);
        authenticated = true;

        const project = getProject(projectId);
        if (!project) {
          ws.send(JSON.stringify({ type: 'error', message: 'Project not found' }));
          ws.close(1008, 'Project not found');
          return;
        }

        // Check access: owner, admin for legacy, or shared user
        const wsUsername = tokenUser.username;
        if (!isProjectOwner(project, wsUsername)) {
          const share = project.shares?.find((s) => s.username === wsUsername);
          if (!share) {
            ws.send(JSON.stringify({ type: 'error', message: 'Access denied' }));
            ws.close(1008, 'Access denied');
            return;
          }
          if (share.permission === 'view') wsReadOnly = true;
        }

        const broadcastFn2 = (data: string) => broadcast(projectId, data);
        terminalManager.getOrCreate(project, broadcastFn2);
        terminalManager.updateBroadcast(projectId, broadcastFn2);

        ws.send(JSON.stringify({ type: 'connected', projectId, readOnly: wsReadOnly }));
        ws.send(JSON.stringify({ type: 'status', status: project.status }));
        return;
      }

      // For local connections, skip the auth message if sent anyway
      if (parsed.type === 'auth') return;

      // ── Authenticated messages ────────────────────────────────────────────────
      switch (parsed.type) {
        case 'terminal_subscribe':
          // Resize PTY to browser dimensions before replaying scrollback
          if (typeof parsed.cols === 'number' && typeof parsed.rows === 'number') {
            terminalManager.resize(projectId, parsed.cols, parsed.rows);
          }
          // Replay history so reconnecting clients see prior output
          {
            const scrollback = terminalManager.getScrollback(projectId);
            if (scrollback) ws.send(JSON.stringify({ type: 'terminal_data', data: scrollback }));
          }
          // Register as a live client
          if (!projectClients.has(projectId)) projectClients.set(projectId, new Set());
          projectClients.get(projectId)!.add(ws);
          ws.send(JSON.stringify({ type: 'terminal_subscribed' }));
          break;

        case 'terminal_input':
          if (wsReadOnly) break; // view-only users cannot send input
          if (typeof parsed.data === 'string') terminalManager.writeRaw(projectId, parsed.data);
          break;

        case 'terminal_resize':
          if (typeof parsed.cols === 'number' && typeof parsed.rows === 'number') {
            terminalManager.resize(projectId, parsed.cols, parsed.rows);
          }
          break;

        case 'chat_subscribe':
          // Replay existing chat history so reconnecting/switching clients see prior messages
          {
            const history = sessionManager.getChatHistory(projectId);
            for (const block of history) {
              try { ws.send(JSON.stringify({ type: 'chat_message', ...block })); } catch { /**/ }
            }
          }
          sessionManager.registerChatListener(projectId, chatListener);
          break;

      }
    } catch (err) {
      console.error(`[WS] Message handling error for project ${projectId}:`, err);
      try { ws.send(JSON.stringify({ type: 'error', message: 'Internal server error' })); } catch { /**/ }
    }
  });

  ws.on('close', () => {
    const clients = projectClients.get(projectId);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) projectClients.delete(projectId);
    }
    sessionManager.unregisterChatListener(projectId, chatListener);
  });

  ws.on('error', (err) => console.error(`[WS] Error for project ${projectId}:`, err));
});

server.on('upgrade', (req: http.IncomingMessage, socket, head) => {
  const pathname = new URL(req.url || '', 'http://localhost').pathname;
  if (!pathname.startsWith('/ws/')) {
    socket.destroy();
    return;
  }

  // Validate WebSocket Origin — local mode only allows localhost origins
  if (ACCESS_MODE === 'local') {
    const origin = req.headers.origin;
    if (origin) {
      try {
        const u = new URL(origin);
        if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1' && u.hostname !== '::1') {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
      } catch {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    }
  }

  // LAN mode: reject non-private IPs on WebSocket upgrade
  if (ACCESS_MODE === 'lan') {
    const ip = req.socket.remoteAddress || '';
    if (!isPrivateIP(ip)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
  }

  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

function tryListen(port: number, maxAttempts = 20): void {
  server.once('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && maxAttempts > 1) {
      console.log(`[Server] Port ${port} in use, trying ${port + 1}...`);
      tryListen(port + 1, maxAttempts - 1);
    } else {
      console.error(`[Server] Failed to listen:`, err);
      process.exit(1);
    }
  });

  server.listen(port, LISTEN_HOST, () => {
    const modeLabels = { local: 'Local only', lan: 'LAN', public: 'Public' };
    console.log(`[Server] Running on http://${LISTEN_HOST}:${port} (${modeLabels[ACCESS_MODE]})`);
    // Notify parent (Electron) of the actual port via IPC
    if (process.send) {
      process.send({ type: 'server-port', port });
    }
    // Write port file so hook commands can discover the current port
    try {
      const ccwebDir = path.join(os.homedir(), '.ccweb');
      if (!fs.existsSync(ccwebDir)) fs.mkdirSync(ccwebDir, { recursive: true });
      fs.writeFileSync(PORT_FILE, String(port), 'utf-8');
    } catch (err) {
      console.error('[Hooks] Failed to write port file:', err);
    }
    hooksManager.install();
    terminalManager.resumeAll();
    startScheduler();
  });
}

tryListen(PORT);

// Graceful shutdown
let updateMode = false;

// SIGUSR2 = update mode: kill PTYs but keep project status as 'running'
// so resumeAll() restarts them with --continue after update
process.on('SIGUSR2', () => {
  updateMode = true;
  shutdown();
});

function shutdown(): void {
  console.log(`[Server] Shutting down...${updateMode ? ' (update mode — terminals will resume)' : ''}`);
  hooksManager.uninstall();
  try { fs.unlinkSync(PORT_FILE); } catch { /* already gone */ }
  for (const project of getProjects()) {
    if (terminalManager.hasTerminal(project.id)) {
      if (updateMode) {
        terminalManager.killForUpdate(project.id);
      } else {
        terminalManager.stop(project.id);
      }
    }
  }
  // Close WebSocket connections
  wss.clients.forEach((ws) => ws.close(1001, 'Server shutting down'));
  server.close(() => {
    console.log('[Server] Closed.');
    process.exit(0);
  });
  // Force exit after 5s
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
