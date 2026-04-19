import { Router } from 'express';
import * as os from 'os';
import { getProjects } from '../config';
import { pluginManager } from '../plugin-manager';
import { terminalManager } from '../terminal-manager';
import { sessionManager } from '../session-manager';
import { requireAdmin } from '../middleware/authz';

const router = Router();

// ── Permission check middleware ──────────────────────────────────────────────

function requirePermission(permission: string) {
  return (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    const pluginId = req.headers['x-plugin-id'] as string;
    if (!pluginId) return res.status(400).json({ error: 'x-plugin-id header required' });

    const plugin = pluginManager.get(pluginId);
    if (!plugin) return res.status(404).json({ error: 'Plugin not found' });
    if (!plugin.manifest.permissions.includes(permission)) {
      return res.status(403).json({ error: `Plugin "${pluginId}" lacks permission "${permission}"` });
    }
    next();
  };
}

// ── project:status ───────────────────────────────────────────────────────────

router.get('/project/status/:projectId', requirePermission('project:status'), (req, res) => {
  const projects = getProjects();
  const project = projects.find((p) => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const status = terminalManager.getProjectStatus(project.id);
  res.json({ id: project.id, name: project.name, status });
});

// ── project:list ─────────────────────────────────────────────────────────────

router.get('/project/list', requirePermission('project:list'), (_req, res) => {
  const projects = getProjects();
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
  const { projectId, data } = req.body as { projectId?: string; data?: string };
  if (!projectId || !data) return res.status(400).json({ error: 'projectId and data required' });

  const status = terminalManager.getProjectStatus(projectId);
  if (status !== 'running') return res.status(404).json({ error: 'Terminal not running' });

  terminalManager.writeRaw(projectId, data);
  res.json({ success: true });
});

// ── session:read ─────────────────────────────────────────────────────────────

router.get('/session/:projectId', requirePermission('session:read'), (req, res) => {
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
  pluginManager.writeData(pluginId, req.body);
  res.json({ success: true });
});

export default router;
