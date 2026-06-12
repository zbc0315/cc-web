import { Router, Response } from 'express';
import type { AuthRequest } from '../auth';
import { getHostStats } from '../host-stats';

/**
 * Host machine resource stats (CPU / memory / disk / network) for the
 * dashboard "host usage" badge. Behind authMiddleware — any logged-in user
 * may read it (it's a dev-tool system monitor, not per-project data).
 */
const router = Router();

// GET /api/host-stats → HostStats
router.get('/', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    res.json(await getHostStats());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to read host stats' });
  }
});

export default router;
