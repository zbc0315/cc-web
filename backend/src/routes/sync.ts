import { Router, Response } from 'express';
import { AuthRequest } from '../auth';
import { getProjects, isProjectOwner, getProject } from '../config';
import {
  getSyncConfig, setSyncConfig, publicConfig, encryptPassword,
  isValidKeyPath, DEFAULT_CONFIG,
  type SyncConfig, type SyncDirection, type AuthMethod,
} from '../sync-config';
import { validateCron } from '../sync-scheduler';
import { syncProject, testConnection, listInFlight, isSyncing } from '../sync-service';

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
router.post('/all', async (req: AuthRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const projects = getProjects().filter((p) => !p.archived && isProjectOwner(p, user));
  const results: Array<{ projectId: string; name: string; ok: boolean; skipped?: boolean; reason?: string; bytes: number }> = [];
  for (const p of projects) {
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
  res.json({ total: projects.length, results });
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
