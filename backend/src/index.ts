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
import { initDataDirs, getProject, getProjects, writeProjectConfig, readProjectConfig, isProjectOwner, getAdminUsername } from './config';
import { Project } from './types';
import { authMiddleware, verifyToken } from './auth';
import { terminalManager } from './terminal-manager';
import authRouter from './routes/auth';
import projectsRouter from './routes/projects';
import filesystemRouter from './routes/filesystem';
import shortcutsRouter from './routes/shortcuts';
import agentPromptsRouter from './routes/agent-prompts';
import memoryPromptsRouter from './routes/memory-prompts';
import updateRouter from './routes/update';
import userPrefsRouter from './routes/user-prefs';
import skillhubRouter from './routes/skillhub';
import { sessionManager, ChatBlock } from './session-manager';
import { initLogger, installFatalHandlers, flushLogger, modLogger } from './logger';
import { requestLog } from './middleware/request-log';
import hooksRouter, { setBroadcastContextUpdate, getContextData } from './routes/hooks';
import approvalRouter from './routes/approval';
import { approvalManager } from './approval-manager';
import notifyRouter from './routes/notify';
import { notifyService } from './notify-service';
import gitRouter from './routes/git';
import claudeRouter from './routes/claude';
import { HooksManager } from './hooks-manager';
import { pluginManager } from './plugin-manager';
import pluginsRouter from './routes/plugins';
import pluginBridgeRouter from './routes/plugin-bridge';
import syncRouter from './routes/sync';
import { startSyncScheduler } from './sync-scheduler';
import { startBackupScheduler } from './chat-backup';
import { syncEvents, type SyncEvent } from './sync-service';
import * as os from 'os';

// Port file path: always ~/.ccweb/port (fixed path for hook shell commands)
const PORT_FILE = path.join(os.homedir(), '.ccweb', 'port');
const hooksManager = new HooksManager(PORT_FILE);

// modLogger returns a lazy Proxy; safe to call at module top. Every log.*
// site below resolves the real child logger on first use (after initLogger).
const log = modLogger('server');

// NOTE: a handful of BOOTSTRAP-PHASE console.* remain in this file —
//   - L3  (Windows reject): runs before any import
//   - L60 (migrateProjectConfigs): runs at module load, before logger init
//   - L699 (bootstrap catch): fires only if logger init itself failed
// They are intentionally retained. Daemon stdout/stderr → ~/.ccweb/ccweb.log
// is the bootstrap/crash fallback (plan §11). All POST-init console.* have
// been migrated to structured logging.
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
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self' data:; frame-src 'self'"
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
app.use(express.json({
  // Stash raw body for all POSTs so HMAC routes can verify against exact bytes.
  // Cost is one Buffer.from per request body (small, bounded by body size).
  verify: (req, _res, buf) => {
    if ((req as { method?: string }).method === 'POST') {
      (req as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    }
  },
}));

// Structured request logging + reqId injection into AsyncLocalStorage.
// Runs AFTER json parser (so req.rawBody is set if needed) and BEFORE any
// auth/router — downstream handlers auto-inherit the reqId via ALS.
app.use(requestLog);

app.use('/api/auth', authRouter);
app.use('/api/hooks', hooksRouter);
// Approval router mounts at /api; hook-facing route is loopback+HMAC gated internally,
// user-facing routes check req.user manually.
if (app.get('trust proxy')) {
  console.warn('[approval] trust proxy is set — hook loopback check may accept spoofed IPs. Disable trust proxy or bind backend to 127.0.0.1.');
}
app.use('/api', approvalRouter);
app.use('/api/projects', authMiddleware, projectsRouter);
app.use('/api/filesystem', authMiddleware, filesystemRouter);
app.use('/api/shortcuts', authMiddleware, shortcutsRouter);
app.use('/api/prompts', authMiddleware, agentPromptsRouter);
app.use('/api/memory', authMiddleware, memoryPromptsRouter);
app.use('/api/update', authMiddleware, updateRouter);
app.use('/api/user-prefs', authMiddleware, userPrefsRouter);
app.use('/api/skillhub', authMiddleware, skillhubRouter);
app.use('/api/notify', authMiddleware, notifyRouter);
app.use('/api/projects', authMiddleware, gitRouter);
app.use('/api/claude', authMiddleware, claudeRouter);
app.use('/api/tool', authMiddleware, claudeRouter);
app.use('/api/plugins', authMiddleware, pluginsRouter);
app.use('/api/plugin-bridge', authMiddleware, pluginBridgeRouter);
app.use('/api/sync', authMiddleware, syncRouter);

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

// Approval events leak tool inputs (command strings, file paths). Withhold from view-only clients.
approvalManager.subscribe((evt) => {
  if (!('projectId' in evt)) return;
  const clients = projectClients.get(evt.projectId);
  if (!clients) return;
  const payload = JSON.stringify(evt);
  for (const client of clients) {
    if (client.readyState !== WebSocket.WebSocket.OPEN) continue;
    if ((client as unknown as { __readOnly?: boolean }).__readOnly) continue;
    try { client.send(payload); } catch { /* ignore */ }
  }
});

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
  const now = Date.now();
  const payload = JSON.stringify({
    type: 'activity_update',
    projectId,
    lastActivityAt,
    active: now - lastActivityAt < 3000, // server-side determination, no clock skew
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
  // When status is non-null, LLM is currently active (hook just fired).
  // When status is null (Stop hook), fall back to PTY timestamp.
  const lastActivityAt = status ? Date.now() : (terminalManager.getLastActivityAt(projectId) ?? 0);
  const now = Date.now();
  const payload = JSON.stringify({
    type: 'activity_update',
    projectId,
    lastActivityAt,
    active: !!status || (now - lastActivityAt < 3000),
    status: terminalManager.getProjectStatus(projectId),
    semantic: status ?? undefined,
  });
  for (const client of dashboardClients) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(payload); } catch { /**/ }
    }
  }
}

function buildSemanticSnapshot(projectId: string): { active: boolean; semantic?: { phase: string; detail?: string; updatedAt: number } } {
  const semantic = sessionManager.getSemanticStatus(projectId);
  const fresh = semantic && Date.now() - semantic.updatedAt <= SEMANTIC_STALE_MS;
  return { active: !!(semantic && fresh), semantic: fresh ? (semantic as { phase: string; detail?: string; updatedAt: number }) : undefined };
}

function broadcastProjectSemantic(projectId: string, status: { phase: string; detail?: string; updatedAt: number } | null) {
  const clients = projectClients.get(projectId);
  if (!clients || clients.size === 0) return;
  const payload = JSON.stringify({ type: 'semantic_update', active: !!status, semantic: status ?? undefined });
  for (const client of clients) {
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
  const now = Date.now();
  for (const id of allRunningIds) {
    const lastActivityAt = allActivity[id] ?? 0;
    const semantic = allSemantic[id];
    const stale = semantic && now - semantic.updatedAt > SEMANTIC_STALE_MS;
    ws.send(JSON.stringify({
      type: 'activity_update',
      projectId: id,
      lastActivityAt,
      active: (semantic && !stale) ? true : (lastActivityAt > 0 && now - lastActivityAt < 3000),
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
  broadcastProjectSemantic(projectId, status);
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

// ── Sync progress bridge ────────────────────────────────────────────────────
// Forward rsync-driven start/progress/done events to both the per-project WS
// (so ProjectHeader's button can render) and the dashboard WS (so the
// SettingsPage batch-sync view can render). Payload type prefix `sync.` avoids
// collisions with existing message types.
//
// Dashboard WS is user-partitioned here: `currentFile` can contain sensitive
// absolute paths, so only the sync's owner receives the event. The project WS
// bucket is already per-project and further gated by ownership at subscribe
// time, so no additional filter needed there. __username is set at auth time
// in both the localhost and token-auth paths of the dashboard WS handler.
syncEvents.on('event', (evt: SyncEvent) => {
  const payload = JSON.stringify({ type: `sync.${evt.kind}`, ...evt });
  const projectBucket = projectClients.get(evt.projectId);
  if (projectBucket) {
    for (const client of projectBucket) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(payload); } catch { /**/ }
      }
    }
  }
  for (const client of dashboardClients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const clientUser = (client as unknown as { __username?: string }).__username;
    if (clientUser !== evt.username) continue;
    try { client.send(payload); } catch { /**/ }
  }
});

wss.on('connection', (ws: WebSocket.WebSocket, req: http.IncomingMessage) => {
  const parsedUrl = new URL(req.url || '', 'http://localhost');

  // ── Dashboard WebSocket (/ws/dashboard) ────────────────────────────────────
  if (parsedUrl.pathname === '/ws/dashboard') {
    const localConnection = isLocalWs(req);
    let authenticated = localConnection;

    if (localConnection) {
      // Localhost pre-auth ≡ admin. Tag the socket so the sync-events bridge
      // can filter cross-user events (see sync bridge above).
      (ws as unknown as { __username?: string }).__username = getAdminUsername() ?? '__local_admin__';
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
            (ws as unknown as { __username?: string }).__username = user.username;
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
      let parsed: { type: string; token?: string; data?: string; cols?: number; rows?: number; replay?: number };
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
        (ws as unknown as { __readOnly?: boolean }).__readOnly = wsReadOnly;

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
          // Send initial context data if available
          {
            const ctxData = getContextData(projectId);
            if (ctxData) ws.send(JSON.stringify({ type: 'context_update', ...ctxData }));
          }
          {
            const snap = buildSemanticSnapshot(projectId);
            ws.send(JSON.stringify({ type: 'semantic_update', ...snap }));
          }
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
          // Replay existing chat history so reconnecting/switching clients see prior messages.
          // New clients (v-o+) pass `replay: N` (typically 50) and pair this with an
          // HTTP /chat-history pull; the id-based dedup on the frontend handles overlap.
          // Old clients (no replay field) default to MAX_SAFE_INTEGER = full file,
          // preserving existing behavior during rolling upgrades.
          {
            const replayLimit = typeof parsed.replay === 'number' ? parsed.replay : Number.MAX_SAFE_INTEGER;
            if (replayLimit > 0) {
              const history = sessionManager.getChatHistory(projectId);
              const slice = replayLimit >= history.length ? history : history.slice(-replayLimit);
              for (const block of slice) {
                try { ws.send(JSON.stringify({ type: 'chat_message', ...block })); } catch { /**/ }
              }
            }
          }
          sessionManager.registerChatListener(projectId, chatListener);
          // Mobile/monitor clients never send `terminal_subscribe` — without this
          // they'd never join `projectClients` (missing real-time context_update
          // and approval broadcasts) and never receive the initial context snapshot.
          if (!projectClients.has(projectId)) projectClients.set(projectId, new Set());
          projectClients.get(projectId)!.add(ws);
          {
            const ctxData = getContextData(projectId);
            if (ctxData) ws.send(JSON.stringify({ type: 'context_update', ...ctxData }));
          }
          {
            const snap = buildSemanticSnapshot(projectId);
            ws.send(JSON.stringify({ type: 'semantic_update', ...snap }));
          }
          break;

      }
    } catch (err) {
      log.error({ err, projectId, mod: 'ws' }, 'ws message handling error');
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

  ws.on('error', (err) => log.error({ err, projectId, mod: 'ws' }, 'ws connection error'));
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
      log.info({ port, nextPort: port + 1 }, 'port in use, trying next');
      tryListen(port + 1, maxAttempts - 1);
    } else {
      log.error({ err, port }, 'listen failed');
      process.exit(1);
    }
  });

  server.listen(port, LISTEN_HOST, () => {
    log.info({ host: LISTEN_HOST, port, accessMode: ACCESS_MODE }, 'server listening');
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
      log.error({ err, portFile: PORT_FILE }, 'failed to write port file');
    }
    hooksManager.install();
    startSyncScheduler();
    startBackupScheduler();
    terminalManager.resumeAll();

    // Wire up context broadcast to project WS clients
    setBroadcastContextUpdate((projectId, data) => {
      const clients = projectClients.get(projectId);
      if (!clients) return;
      const payload = JSON.stringify({ type: 'context_update', ...data });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          try { client.send(payload); } catch { /**/ }
        }
      }
    });

  });
}

// Bootstrap: initialize structured logger BEFORE listening so the very first
// event on disk is our own "daemon starting" line. Fatal handlers installed
// here call sonic-boom's flushSync() on the pino-roll stream to guarantee
// uncaughtException stack traces hit disk before exit — the async buffer
// would otherwise swallow them. (pino v10 removed pino.final, so we flush
// the destination directly; see logger.ts installFatalHandlers.)
(async () => {
  await initLogger();
  installFatalHandlers();
  log.info(
    { accessMode: ACCESS_MODE, requestedPort: PORT, host: LISTEN_HOST },
    'daemon starting',
  );
  tryListen(PORT);
})().catch((err) => {
  // If logger init itself fails, fall back to console before exiting.
  // This is the ONLY console.error acceptable post-init.
  console.error('[Bootstrap] failed to initialize logger:', err);
  process.exit(1);
});

// Graceful shutdown
let updateMode = false;

// SIGUSR2 = update mode: kill PTYs but keep project status as 'running'
// so resumeAll() restarts them with --continue after update
process.on('SIGUSR2', () => {
  updateMode = true;
  shutdown();
});

function shutdown(): void {
  log.info({ updateMode }, 'shutdown begin');
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
  server.close(async () => {
    log.info('shutdown closed');
    await flushLogger();
    process.exit(0);
  });
  // Force exit after 5s (still flush synchronously if possible)
  setTimeout(async () => {
    log.warn('shutdown forced after 5s');
    await flushLogger();
    process.exit(1);
  }, 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
