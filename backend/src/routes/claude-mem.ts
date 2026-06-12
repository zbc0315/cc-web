import { Router, Response } from 'express';
import type { AuthRequest } from '../auth';
import {
  getStatus,
  listObservations,
  getObservation,
  listSessionSummaries,
  listProjects,
} from '../claude-mem-store';

/**
 * Read-only browse of the claude-mem plugin's memories. Mounted behind
 * `authMiddleware + requireAdmin` (see index.ts) — the DB is machine-wide
 * across ALL projects and can contain sensitive content, so it is admin-only.
 * Non-admins get 403 on every endpoint, including /status (the frontend treats
 * that as "unavailable" and hides the entry point).
 */
const router = Router();

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;

function clampLimit(raw: unknown): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, n));
}

function clampOffset(raw: unknown): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseTypes(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  const types = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => /^[a-z_]+$/i.test(t)); // observation types are bare identifiers
  return types.length ? types : undefined;
}

function strParam(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

// GET /status → { available, degraded, dbPath, counts? }
router.get('/status', (_req: AuthRequest, res: Response): void => {
  res.json(getStatus());
});

// GET /projects → [{ project, count, lastAt }]
router.get('/projects', (_req: AuthRequest, res: Response): void => {
  res.json({ items: listProjects() });
});

// GET /observations?project=&type=&q=&limit=&offset= → { items, total }
router.get('/observations', (req: AuthRequest, res: Response): void => {
  const { project, type, q, limit, offset } = req.query;
  res.json(
    listObservations({
      project: strParam(project),
      types: parseTypes(type),
      q: strParam(q),
      limit: clampLimit(limit),
      offset: clampOffset(offset),
    })
  );
});

// GET /observations/:id → Observation | 404
router.get('/observations/:id', (req: AuthRequest, res: Response): void => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const obs = getObservation(id);
  if (!obs) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(obs);
});

// GET /summaries?project=&limit=&offset= → { items, total }
router.get('/summaries', (req: AuthRequest, res: Response): void => {
  const { project, limit, offset } = req.query;
  res.json(
    listSessionSummaries({
      project: strParam(project),
      limit: clampLimit(limit),
      offset: clampOffset(offset),
    })
  );
});

export default router;
