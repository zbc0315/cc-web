import { Router, Response } from 'express';
import type { AuthRequest } from '../auth';
import { getProjects } from '../config';
import { recordDevTime, getDevTimeStats, type DevTimePeriod } from '../dev-time';

const router = Router();

const VALID_PERIODS: DevTimePeriod[] = ['day', 'week', 'month'];

function requireUser(req: AuthRequest, res: Response): string | null {
  const u = req.user?.username;
  if (!u) { res.status(401).json({ error: 'Unauthenticated' }); return null; }
  return u;
}

// POST /api/dev-time/beat  { projectId, seconds } — accumulate page-dwell time.
router.post('/beat', (req: AuthRequest, res: Response): void => {
  const user = requireUser(req, res);
  if (!user) return;
  const { projectId, seconds } = req.body as { projectId?: string; seconds?: number };
  if (!projectId || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    res.status(400).json({ error: 'projectId and positive seconds required' });
    return;
  }
  // Only track real projects — keeps junk/forged ids out of the store.
  if (!getProjects().some((p) => p.id === projectId)) {
    res.status(404).json({ error: 'Unknown project' });
    return;
  }
  recordDevTime(user, projectId, seconds);
  res.json({ ok: true });
});

// GET /api/dev-time/stats?period=day|week|month — per-project time buckets.
router.get('/stats', (req: AuthRequest, res: Response): void => {
  const user = requireUser(req, res);
  if (!user) return;
  const period = (req.query.period as DevTimePeriod) || 'day';
  if (!VALID_PERIODS.includes(period)) {
    res.status(400).json({ error: 'invalid period' });
    return;
  }
  const nameById = new Map(getProjects().map((p) => [p.id, p.name]));
  const stats = getDevTimeStats(user, period);
  const projects = stats.projects
    .map((p) => ({ ...p, projectName: nameById.get(p.projectId) ?? p.projectId }))
    .sort((a, b) => b.total - a.total);
  res.json({ period: stats.period, buckets: stats.buckets, projects });
});

export default router;
