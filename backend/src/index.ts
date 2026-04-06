// Reject native Windows — WSL is fine (reports 'linux')
if (process.platform === 'win32') {
  console.error('ccweb does not support native Windows. Please use WSL2 instead.');
  process.exit(1);
}

import express from 'express';
import cors from 'cors';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as WebSocket from 'ws';
import { initDataDirs, getProject, getProjects, writeProjectConfig, readProjectConfig, isProjectOwner } from './config';
import { Project } from './types';
import { authMiddleware, verifyToken } from './auth';
import { terminalManager } from './terminal-manager';
import authRouter from './routes/auth';
import projectsRouter from './routes/projects';
import filesystemRouter from './routes/filesystem';
import shortcutsRouter from './routes/shortcuts';
import updateRouter from './routes/update';
import backupRouter, { backupAuthCallbackRouter } from './routes/backup';
import skillhubRouter from './routes/skillhub';
import { startScheduler } from './backup/scheduler';
import { sessionManager, ChatBlock } from './session-manager';
import hooksRouter from './routes/hooks';
import notifyRouter from './routes/notify';
import { notifyService } from './notify-service';
import shareRouter from './routes/share';
import gitRouter from './routes/git';
import claudeRouter from './routes/claude';
import { HooksManager } from './hooks-manager';
import { pluginManager } from './plugin-manager';
import pluginsRouter from './routes/plugins';
import pluginBridgeRouter from './routes/plugin-bridge';
import planControlRouter, { setPlanDepsFactory } from './routes/plan-control';
import memoryPoolRouter from './routes/memory-pool';
import informationRouter from './routes/information';
import * as os from 'os';

// Port file path: always ~/.ccweb/port (fixed path for hook shell commands)
const PORT_FILE = path.join(os.homedir(), '.ccweb', 'port');
const hooksManager = new HooksManager(PORT_FILE);

initDataDirs();
pluginManager.installBundled();
pluginManager.loadAll();
migrateProjectConfigs();

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
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self'; frame-src 'self'"
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
app.use('/api/skillhub', authMiddleware, skillhubRouter);
app.use('/api/notify', authMiddleware, notifyRouter);
app.use('/api/projects', authMiddleware, gitRouter);
app.use('/api/claude', authMiddleware, claudeRouter);
app.use('/api/tool', authMiddleware, claudeRouter);
app.use('/api/plugins', authMiddleware, pluginsRouter);
app.use('/api/plugin-bridge', authMiddleware, pluginBridgeRouter);
app.use('/api/projects', authMiddleware, planControlRouter);
app.use('/api/memory-pool', authMiddleware, memoryPoolRouter);
app.use('/api/information', authMiddleware, informationRouter);
app.use('/api', shareRouter);

// Serve plugin SDK: /plugin-sdk/ccweb-plugin-sdk.js
app.use('/plugin-sdk', express.static(path.join(__dirname, '../../plugin-sdk')));

// Serve plugin frontend files: /plugins/:id/* → ~/.ccweb/plugins/:id/frontend/*
app.use('/plugins/:id', (req, res, next) => {
  const frontendDir = pluginManager.getFrontendDir(req.params.id);
  if (!frontendDir) return res.status(404).json({ error: 'Plugin not found' });
  express.static(frontendDir)(req, res, next);
});

// Mount plugin backend routers: /api/plugins/:id/* → plugin's Express Router
for (const plugin of pluginManager.getAll()) {
  if (plugin.router) {
    app.use(`/api/plugins/${plugin.manifest.id}`, authMiddleware, plugin.router);
  }
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Serve built frontend (production / Electron)
const frontendDist = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (_req, res, next) => {
    if (_req.path.startsWith('/api/') || _req.path.startsWith('/ws/') || _req.path.startsWith('/plugins/') || _req.path.startsWith('/plugin-sdk/')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true, maxPayload: 1024 * 1024 }); // 1MB max message

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

function broadcastToPlanClients(projectId: string, event: Record<string, unknown>) {
  const clients = projectClients.get(projectId);
  if (!clients) return;
  const payload = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === WebSocket.WebSocket.OPEN) {
      try { client.send(payload); } catch { /**/ }
    }
  }
}

// Inject real PTY/WS deps into plan-control routes
setPlanDepsFactory((projectId, _folderPath) => ({
  writeToPty: (text: string) => terminalManager.writeRaw(projectId, text),
  getLastActivity: () => terminalManager.getLastActivityAt(projectId),
  broadcast: (event) => broadcastToPlanClients(projectId, event),
}));

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
    status: terminalManager.getProjectStatus(projectId),
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
    status: terminalManager.getProjectStatus(projectId),
    semantic: status ?? undefined,
  });
  for (const client of dashboardClients) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(payload); } catch { /**/ }
    }
  }
}

function initProjectTerminal(project: Project, projectId: string): void {
  const fn = (data: string) => broadcast(projectId, data);
  // Always pass continueSession=true: if terminal already exists getOrCreate returns early
  // (flag is ignored); if project is stopped and user navigates to it, --continue is correct.
  // Brand-new projects are pre-started in POST /api/projects before any WS connects, so
  // their terminal already exists and this flag is never consumed for truly new projects.
  terminalManager.getOrCreate(project, fn, true);
  terminalManager.updateBroadcast(projectId, fn);
}

function sendActivitySnapshot(ws: WebSocket.WebSocket): void {
  const allActivity = terminalManager.getAllActivity();
  const allSemantic = sessionManager.getAllSemanticStatus();
  // Include all running/restarting projects, even those with no PTY output yet
  const allRunningIds = new Set([...Object.keys(allActivity), ...terminalManager.getAllRunningIds()]);
  for (const id of allRunningIds) {
    const lastActivityAt = allActivity[id] ?? 0;
    const semantic = allSemantic[id];
    const stale = semantic && Date.now() - semantic.updatedAt > SEMANTIC_STALE_MS;
    ws.send(JSON.stringify({
      type: 'activity_update',
      projectId: id,
      lastActivityAt,
      status: terminalManager.getProjectStatus(id),
      semantic: semantic && !stale ? semantic : undefined,
    }));
  }
}

// Wire up events from terminal-manager and session-manager
terminalManager.on('activity', ({ projectId, lastActivityAt }: { projectId: string; lastActivityAt: number }) => {
  broadcastDashboardActivity(projectId, lastActivityAt);
});

sessionManager.on('semantic', ({ projectId, status }: { projectId: string; status: { phase: string; detail?: string; updatedAt: number } | null }) => {
  broadcastDashboardSemantic(projectId, status);
});

notifyService.on('stopped', ({ projectId, projectName }: { projectId: string; projectName: string }) => {
  const msg = JSON.stringify({ type: 'project_stopped', projectId, projectName });
  // Broadcast to dashboard clients
  for (const client of dashboardClients) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(msg); } catch { /**/ }
    }
  }
  // Broadcast to project-specific clients (so ProjectPage also receives notifications)
  const clients = projectClients.get(projectId);
  if (clients) {
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(msg); } catch { /**/ }
      }
    }
  }
});

wss.on('connection', (ws: WebSocket.WebSocket, req: http.IncomingMessage) => {
  const parsedUrl = new URL(req.url || '', 'http://localhost');

  // ── Dashboard WebSocket (/ws/dashboard) ────────────────────────────────────
  if (parsedUrl.pathname === '/ws/dashboard') {
    const localConnection = isLocalWs(req);
    let authenticated = localConnection;

    if (localConnection) {
      sendActivitySnapshot(ws);
      dashboardClients.add(ws);
    }

    ws.on('message', (rawMsg: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(rawMsg.toString());
        if (!authenticated && parsed.type === 'auth' && parsed.token) {
          const user = verifyToken(parsed.token);
          if (user) {
            authenticated = true;
            sendActivitySnapshot(ws);
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
  const match = parsedUrl.pathname?.match(/^\/ws\/projects\/([a-zA-Z0-9_-]+)$/);
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
    initProjectTerminal(project, projectId);
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

        initProjectTerminal(project, projectId);
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
    if (authTimeout) clearTimeout(authTimeout);
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
