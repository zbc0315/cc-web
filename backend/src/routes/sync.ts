import { Router, Response } from 'express';
import { AuthRequest } from '../auth';
import { getProjects, isProjectOwner, getProject } from '../config';
import {
  getSyncConfig, setSyncConfig, publicConfig, encryptPassword,
  isValidKeyPath, isValidRemotePath, getProjectPath, DEFAULT_CONFIG,
  type SyncConfig, type SyncDirection, type AuthMethod,
} from '../sync-config';
import { getLastSyncAt, getAllLastSyncAt } from '../sync-state';
import { getDirtyCached, invalidateDirty } from '../sync-dirty';
import { validateCron } from '../sync-scheduler';
import {
  syncProject, testConnection, listInFlight, isSyncing,
  cancelSync, cancelAllForUser, clearBulkCancel, isBulkCancelled,
} from '../sync-service';

const router = Router();

const VALID_DIRECTIONS: SyncDirection[] = ['push', 'pull', 'bidirectional'];
const VALID_AUTH: AuthMethod[] = ['key', 'password'];

function requireUser(req: AuthRequest, res: Response): string | null {
  const u = req.user?.username;
  if (!u) { res.status(401).json({ error: 'Unauthenticated' }); return null; }
  return u;
}

// GET /api/sync/config  → current user's config (password redacted)
router.get('/config', (req: AuthRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json(publicConfig(getSyncConfig(user)));
});

// PUT /api/sync/config  body: Partial<SyncConfig> with plain `password` for pw auth
router.put('/config', (req: AuthRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const body = (req.body ?? {}) as Partial<SyncConfig> & { password?: string };
  const existing = getSyncConfig(user);

  const next: SyncConfig = { ...existing };
  if (typeof body.host === 'string') next.host = body.host.trim();
  if (typeof body.port === 'number' && body.port > 0 && body.port < 65536) next.port = body.port;
  if (typeof body.user === 'string') next.user = body.user.trim();
  if (body.authMethod && VALID_AUTH.includes(body.authMethod)) next.authMethod = body.authMethod;

  if (typeof body.keyPath === 'string') {
    const candidate = body.keyPath.trim();
    if (candidate && !isValidKeyPath(candidate)) {
      res.status(400).json({ error: 'keyPath 不能包含空格、引号、反斜杠、null 字节，或以 `-` 开头（防止 ssh 参数注入）' });
      return;
    }
    next.keyPath = candidate || undefined;
  }

  if (typeof body.remoteRoot === 'string') {
    const rr = body.remoteRoot.trim().replace(/\/+$/, '');
    // Remote root should be an absolute path; relative would be interpreted
    // relative to the ssh user's home, which is easy to misconfigure.
    if (rr && !rr.startsWith('/')) {
      res.status(400).json({ error: 'remoteRoot 必须是绝对路径（/ 开头）' });
      return;
    }
    next.remoteRoot = rr;
  }

  if (body.direction && VALID_DIRECTIONS.includes(body.direction)) next.direction = body.direction;

  if (Array.isArray(body.defaultExcludes)) {
    next.defaultExcludes = body.defaultExcludes
      .filter((v): v is string => typeof v === 'string')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 200); // prevent DoS via 10K-item excludes
  }

  if (body.schedule && typeof body.schedule === 'object') {
    const sch = body.schedule as { enabled?: boolean; cron?: string };
    const cron = typeof sch.cron === 'string' && sch.cron.trim() ? sch.cron.trim() : existing.schedule.cron;
    // Validate cron now so silent "enabled but never fires" doesn't happen.
    const cronErr = validateCron(cron);
    if (cronErr) {
      res.status(400).json({ error: `cron 表达式无效: ${cronErr}` });
      return;
    }
    next.schedule = { enabled: !!sch.enabled, cron };
  }

  if (body.projectExcludes && typeof body.projectExcludes === 'object') {
    const pe: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(body.projectExcludes)) {
      if (Array.isArray(v)) {
        pe[k] = v
          .filter((x): x is string => typeof x === 'string')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 200);
      }
    }
    next.projectExcludes = pe;
  }

  // Password: only update if explicitly provided
  if (typeof body.password === 'string') {
    if (body.password === '') {
      next.passwordEnc = undefined;
      next.passwordFp = undefined;
    } else {
      const { enc, fp } = encryptPassword(body.password);
      next.passwordEnc = enc;
      next.passwordFp = fp;
    }
  }

  setSyncConfig(next);
  res.json(publicConfig(getSyncConfig(user)));
});

// POST /api/sync/reset — revert to defaults (keeps nothing)
router.post('/reset', (req: AuthRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  setSyncConfig({ username: user, ...DEFAULT_CONFIG });
  res.json(publicConfig(getSyncConfig(user)));
});

// POST /api/sync/test — ssh <host> true
router.post('/test', async (req: AuthRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const result = await testConnection(user);
  res.json(result);
});

// POST /api/sync/project/:id  — sync one project using configured direction
// Optional body: { direction: 'push'|'pull' } to override for this call.
router.post('/project/:id', async (req: AuthRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const project = getProject(req.params.id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  if (!isProjectOwner(project, user)) { res.status(403).json({ error: 'Forbidden' }); return; }
  const body = (req.body ?? {}) as { direction?: SyncDirection };
  const override =
    body.direction && VALID_DIRECTIONS.includes(body.direction)
      ? body.direction
      : undefined;
  const result = await syncProject(user, project.id, project.name, project.folderPath, override);
  res.json(result);
});

// POST /api/sync/all — sync every owned, non-archived project in sequence.
// Sequential (not parallel) because rsync is bandwidth-bound; parallel
// streams just contend for the same pipe.
//
// Cancel behaviour: the bulk-cancel flag is checked before each project and
// between legs; a mid-flight rsync is SIGTERM'd by POST /cancel-all and the
// loop stops on the next iteration. Already-completed results are preserved
// in the response so the caller can see partial progress.
router.post('/all', async (req: AuthRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  // Only projects that actually have a per-project remote path configured —
  // others would just return `no-path` and add noise.
  const cfgAll = getSyncConfig(user);
  const projects = getProjects().filter(
    (p) => !p.archived && isProjectOwner(p, user) && !!getProjectPath(cfgAll, p.id)
  );
  const results: Array<{ projectId: string; name: string; ok: boolean; skipped?: boolean; reason?: string; bytes: number }> = [];
  clearBulkCancel(user);
  // Latch the cancel state on exit (before the finally clears the flag);
  // isBulkCancelled(user) would always be false by the time we build the
  // response otherwise.
  let wasCancelled = false;
  try {
    for (const p of projects) {
      if (isBulkCancelled(user)) {
        wasCancelled = true;
        results.push({ projectId: p.id, name: p.name, ok: false, reason: 'cancelled', bytes: 0 });
        continue;
      }
      const r = await syncProject(user, p.id, p.name, p.folderPath);
      results.push({
        projectId: p.id,
        name: p.name,
        ok: r.ok,
        skipped: r.skipped,
        reason: r.reason,
        bytes: r.bytes,
      });
    }
    if (isBulkCancelled(user)) wasCancelled = true;
  } finally {
    clearBulkCancel(user);
  }
  res.json({ total: projects.length, results, cancelled: wasCancelled });
});

// POST /api/sync/cancel/:id  — SIGTERM the running rsync for this project
// (owner only). Safe to call when nothing is in flight.
router.post('/cancel/:id', (req: AuthRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const project = getProject(req.params.id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  if (!isProjectOwner(project, user)) { res.status(403).json({ error: 'Forbidden' }); return; }
  const signalled = cancelSync(user, project.id);
  res.json({ cancelled: signalled });
});

// POST /api/sync/cancel-all  — cancel every in-flight sync for this user
// AND break any running /all loop at the next iteration. Returns the list of
// projectIds that had a live rsync signalled.
router.post('/cancel-all', (req: AuthRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const ids = cancelAllForUser(user);
  res.json({ cancelled: ids });
});

// ── Per-project sync (path + status) ─────────────────────────────────────────

/** Shared builder for a single project's sync settings/status. `dirty` is
 *  push-only (pull/bidi rewrites local files → would always read dirty). */
function projectSyncView(user: string, projectId: string, folderPath: string) {
  const cfg = getSyncConfig(user);
  const remotePath = getProjectPath(cfg, projectId);
  const excludes = cfg.projectExcludes[projectId] ?? [];
  const lastSyncAt = getLastSyncAt(user, projectId);
  // Dirty only for pure 'push'. For 'pull'/'bidirectional' the local tree gets
  // remote-written files whose mtime exceeds lastSyncAt → would read dirty
  // forever right after a successful sync (false signal).
  const dirty = remotePath && cfg.direction === 'push'
    ? getDirtyCached(`${user}:${projectId}`, folderPath, [...cfg.defaultExcludes, ...excludes], lastSyncAt)
    : false;
  return {
    path: remotePath,
    excludes,
    lastSyncAt,
    dirty,
    syncing: isSyncing(user, projectId),
    direction: cfg.direction,
    connectionReady: !!(cfg.host && cfg.user),
  };
}

// GET /api/sync/project-status[?dirty=1] — per-project cloud status for the
// dashboard, OWNED projects only (projectPaths is per-user/owner; shared
// projects get no cloud). hasPath/lastSyncAt/syncing are instant; `dirty` is a
// tree walk computed only with ?dirty=1 (dashboard fetches cheap first, then
// upgrades). Dirty is push-only.
router.get('/project-status', (req: AuthRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const cfg = getSyncConfig(user);
  const wantDirty = req.query.dirty === '1';
  const lastMap = getAllLastSyncAt(user);
  // Dirty only for pure 'push' (see projectSyncView).
  const pushOnly = cfg.direction === 'push';
  const items: Record<string, { hasPath: boolean; dirty: boolean | null; lastSyncAt: number; syncing: boolean }> = {};
  for (const p of getProjects()) {
    if (p.archived || !isProjectOwner(p, user)) continue;
    const remotePath = getProjectPath(cfg, p.id);
    const hasPath = !!remotePath;
    const lastSyncAt = lastMap[p.id] ?? 0;
    let dirty: boolean | null = null;
    if (wantDirty) {
      dirty = hasPath && pushOnly
        ? getDirtyCached(`${user}:${p.id}`, p.folderPath, [...cfg.defaultExcludes, ...(cfg.projectExcludes[p.id] ?? [])], lastSyncAt)
        : false;
    }
    items[p.id] = { hasPath, dirty, lastSyncAt, syncing: isSyncing(user, p.id) };
  }
  res.json({ items });
});

// GET /api/sync/project/:id/settings — per-project sync settings page data (owner)
router.get('/project/:id/settings', (req: AuthRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const project = getProject(req.params.id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  if (!isProjectOwner(project, user)) { res.status(403).json({ error: 'Forbidden' }); return; }
  res.json(projectSyncView(user, project.id, project.folderPath));
});

// PUT /api/sync/project/:id/settings  body: { path?: string, excludes?: string[] } (owner)
router.put('/project/:id/settings', (req: AuthRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const project = getProject(req.params.id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  if (!isProjectOwner(project, user)) { res.status(403).json({ error: 'Forbidden' }); return; }

  const body = (req.body ?? {}) as { path?: string; excludes?: string[] };
  const cfg = getSyncConfig(user);

  if (typeof body.path === 'string') {
    const trimmed = body.path.trim().replace(/\/+$/, '');
    if (trimmed && !isValidRemotePath(trimmed)) {
      res.status(400).json({ error: '远端路径必须是绝对路径，且不能包含空格、glob 或 shell 特殊字符（macOS openrsync 无 --protect-args，只能在写入时拦截）' });
      return;
    }
    if (trimmed) cfg.projectPaths[project.id] = trimmed;
    else delete cfg.projectPaths[project.id];
  }

  if (Array.isArray(body.excludes)) {
    const ex = body.excludes
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 200);
    if (ex.length) cfg.projectExcludes[project.id] = ex;
    else delete cfg.projectExcludes[project.id];
  }

  setSyncConfig(cfg);
  invalidateDirty(`${user}:${project.id}`); // path/excludes changed → recompute
  res.json(projectSyncView(user, project.id, project.folderPath));
});

// GET /api/sync/status  → { inFlight: string[] }
router.get('/status', (req: AuthRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json({ inFlight: listInFlight(user) });
});

// GET /api/sync/status/:id  → boolean for a single project
router.get('/status/:id', (req: AuthRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json({ syncing: isSyncing(user, req.params.id) });
});

export default router;
