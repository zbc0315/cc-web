import { Router } from 'express';
import * as os from 'os';
import { getProjects, isAdminUser, isProjectOwner } from '../config';
import { pluginManager } from '../plugin-manager';
import { terminalManager } from '../terminal-manager';
import { sessionManager } from '../session-manager';
import { requireAdmin } from '../middleware/authz';
import { verifyPluginSessionToken } from '../plugin-session';
import { modLogger } from '../logger';
import type { AuthRequest } from '../auth';
import type { Project } from '../types';

/**
 * Plugin token caller may only see / act on projects they themselves own,
 * are explicitly shared on, or (admin) any project. Without this check,
 * any user holding a plugin token could read/write other users' terminals
 * via project:status / session:read / terminal:send.
 */
function pluginUserCanAccessProject(pluginUser: string, project: Project): boolean {
  if (isAdminUser(pluginUser)) return true;
  if (isProjectOwner(project, pluginUser)) return true;
  return project.shares?.some((s) => s.username === pluginUser) ?? false;
}

function pluginUserOf(req: import('express').Request): string | undefined {
  return (req as import('express').Request & { plugin?: { id: string; user: string } }).plugin?.user;
}

const log = modLogger('plugin-bridge');
const router = Router();

// ── Permission check middleware ──────────────────────────────────────────────
//
// Authorization source of truth: the `X-Plugin-Session` HMAC token issued by
// POST /api/plugins/:id/session. The old `x-plugin-id` header was caller-
// controlled and allowed any authenticated user to assume any plugin's
// permissions — see `plugin-session.ts` header for background.

function requirePermission(permission: string) {
  return (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    const sessionHeader = req.headers['x-plugin-session'];
    const tokenRaw = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;

    if (!tokenRaw) {
      if (req.headers['x-plugin-id']) {
        log.warn(
          { path: req.path, pluginIdHeader: req.headers['x-plugin-id'] },
          'deprecated x-plugin-id header received without X-Plugin-Session — rejecting; refresh plugin iframe',
        );
      }
      return res.status(401).json({ error: 'X-Plugin-Session token required (obtain via POST /api/plugins/:id/session)' });
    }

    const payload = verifyPluginSessionToken(tokenRaw);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired plugin session token' });
    }

    // Bind the token to the authenticated caller — a leaked token MUST NOT
    // be replayable by a different user (codex review #11).
    const authUser = (req as AuthRequest).user?.username;
    if (!authUser || payload.usr !== authUser) {
      return res.status(403).json({ error: 'Plugin session token issued for a different user' });
    }

    const plugin = pluginManager.get(payload.pid);
    if (!plugin) return res.status(404).json({ error: 'Plugin not found' });
    if (!plugin.registry.enabled) return res.status(403).json({ error: 'Plugin disabled' });

    // Gate on both the token's issued scopes AND the current manifest — if the
    // plugin was downgraded after issuance, the intersection is the safe floor.
    if (!payload.scp.includes(permission) || !plugin.manifest.permissions.includes(permission)) {
      return res.status(403).json({ error: `Plugin "${payload.pid}" lacks permission "${permission}"` });
    }

    // Expose the verified plugin identity to handlers (replaces untrusted header).
    (req as import('express').Request & { plugin?: { id: string; user: string } }).plugin = {
      id: payload.pid,
      user: payload.usr,
    };
    next();
  };
}

// ── project:status ───────────────────────────────────────────────────────────

router.get('/project/status/:projectId', requirePermission('project:status'), (req, res) => {
  const user = pluginUserOf(req);
  if (!user) return res.status(401).json({ error: 'No plugin user bound' });
  const projects = getProjects();
  const project = projects.find((p) => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!pluginUserCanAccessProject(user, project)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const status = terminalManager.getProjectStatus(project.id);
  res.json({ id: project.id, name: project.name, status });
});

// ── project:list ─────────────────────────────────────────────────────────────

router.get('/project/list', requirePermission('project:list'), (req, res) => {
  const user = pluginUserOf(req);
  if (!user) return res.status(401).json({ error: 'No plugin user bound' });
  const projects = getProjects().filter((p) => pluginUserCanAccessProject(user, p));
  res.json(
    projects.map((p) => ({
      id: p.id,
      name: p.name,
      status: terminalManager.getProjectStatus(p.id),
      folderPath: p.folderPath,
      tags: p.tags,
    })),
  );
});

// ── terminal:send ────────────────────────────────────────────────────────────

router.post('/terminal/send', requirePermission('terminal:send'), (req, res) => {
  const user = pluginUserOf(req);
  if (!user) return res.status(401).json({ error: 'No plugin user bound' });
  const { projectId, data } = req.body as { projectId?: string; data?: string };
  if (!projectId || !data) return res.status(400).json({ error: 'projectId and data required' });

  const project = getProjects().find((p) => p.id === projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!pluginUserCanAccessProject(user, project)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const status = terminalManager.getProjectStatus(projectId);
  if (status !== 'running') return res.status(404).json({ error: 'Terminal not running' });

  terminalManager.writeRaw(projectId, data);
  res.json({ success: true });
});

// ── session:read ─────────────────────────────────────────────────────────────

router.get('/session/:projectId', requirePermission('session:read'), (req, res) => {
  const user = pluginUserOf(req);
  if (!user) return res.status(401).json({ error: 'No plugin user bound' });
  const project = getProjects().find((p) => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!pluginUserCanAccessProject(user, project)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const history = sessionManager.getChatHistory(req.params.projectId);
  res.json(history);
});

// ── system:info ──────────────────────────────────────────────────────────────

router.get('/system/info', requirePermission('system:info'), (_req, res) => {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  // CPU usage: average across all cores
  const cpuUsage = cpus.map((cpu) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    const idle = cpu.times.idle;
    return ((total - idle) / total) * 100;
  });
  const avgCpu = cpuUsage.reduce((a, b) => a + b, 0) / cpuUsage.length;

  res.json({
    cpu: {
      model: cpus[0]?.model,
      cores: cpus.length,
      usage: Math.round(avgCpu * 10) / 10,
    },
    memory: {
      total: totalMem,
      free: freeMem,
      used: totalMem - freeMem,
      usagePercent: Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10,
    },
    uptime: os.uptime(),
    platform: os.platform(),
    hostname: os.hostname(),
    loadavg: os.loadavg(),
  });
});

// ── storage:self (plugin private key-value) ──────────────────────────────────
//
// Note: the previous "x-plugin-id === :pluginId" check was a tautology — the
// caller controls both. Until we implement iframe-bound HMAC session tokens
// (see DETAILS/plugins.md refactor proposal), storage is admin-only:
//   - prevents any authenticated LAN user from tampering with plugin data
//     (which may contain tokens, OAuth refresh, cached secrets)
//   - plugin data is installation-global anyway, not per-user
// Read-side stays admin-only for symmetry; non-admin plugin UIs that need
// shared state should use a plugin-defined backend endpoint with explicit scoping.

const PLUGIN_ID_RE = /^[a-zA-Z0-9_-]+$/;

router.get('/storage/:pluginId', requireAdmin, (req, res) => {
  const pluginId = req.params.pluginId;
  if (!PLUGIN_ID_RE.test(pluginId)) return res.status(400).json({ error: 'Invalid plugin ID' });
  if (!pluginManager.get(pluginId)) return res.status(404).json({ error: 'Plugin not installed' });
  res.json(pluginManager.readData(pluginId));
});

router.put('/storage/:pluginId', requireAdmin, (req, res) => {
  const pluginId = req.params.pluginId;
  if (!PLUGIN_ID_RE.test(pluginId)) return res.status(400).json({ error: 'Invalid plugin ID' });
  if (!pluginManager.get(pluginId)) return res.status(404).json({ error: 'Plugin not installed' });
  // Reject non-object bodies (arrays, primitives) before they reach the
  // writer — JSON-stringifying e.g. an array would silently lose named
  // properties and break readData's Record<string, unknown> contract.
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'storage payload must be a JSON object' });
  }
  pluginManager.writeData(pluginId, body as Record<string, unknown>);
  res.json({ success: true });
});

export default router;
