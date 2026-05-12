import { Router, Response } from 'express';
import { AuthRequest } from '../auth';
import {
  deleteGlobalFlowDef,
  listGlobalFlowDefs,
  loadGlobalFlowDef,
  sanitizeFlowFilename,
  saveGlobalFlowDef,
} from '../flows/store';
import { validateFlowDef } from './flows';
import { modLogger } from '../logger';

const log = modLogger('global-flows-route');

const router = Router();

/**
 * Per-user global flow CRUD. Stored at ~/.ccweb/users/<username>/flows/.
 *
 * Auth: relies on the parent app's auth middleware to populate req.user.
 * Each request namespaces by req.user.username — there is no cross-user
 * visibility. Anonymous (no req.user) requests are rejected with 401.
 *
 * Run/abort/resume/input/state stay on /api/projects/:projectId/flows/* —
 * global flows are templates, not standalone runtimes. The project-scoped
 * run endpoint accepts `source: 'global'` in its body to load from here.
 */

function requireUser(req: AuthRequest, res: Response): string | null {
  const username = req.user?.username;
  if (!username) {
    res.status(401).json({ error: 'auth required' });
    return null;
  }
  return username;
}

// GET /api/global/flows
router.get('/', (req: AuthRequest, res: Response): void => {
  const username = requireUser(req, res);
  if (!username) return;
  res.json({ files: listGlobalFlowDefs(username) });
});

// GET /api/global/flows/file/:filename
router.get('/file/:filename', (req: AuthRequest, res: Response): void => {
  const username = requireUser(req, res);
  if (!username) return;
  const safe = sanitizeFlowFilename(req.params.filename);
  if (!safe) {
    res.status(400).json({ error: 'invalid filename' });
    return;
  }
  const def = loadGlobalFlowDef(username, safe);
  if (!def) {
    res.status(404).json({ error: 'Flow not found' });
    return;
  }
  res.json(def);
});

// PUT /api/global/flows/file/:filename
router.put('/file/:filename', (req: AuthRequest, res: Response): void => {
  const username = requireUser(req, res);
  if (!username) return;
  const safe = sanitizeFlowFilename(req.params.filename);
  if (!safe) {
    res.status(400).json({ error: 'invalid filename' });
    return;
  }
  if (!validateFlowDef(req.body)) {
    log.warn({ username, filename: safe }, 'global flow save rejected (validation)');
    res.status(400).json({ error: 'invalid flow definition' });
    return;
  }
  const ok = saveGlobalFlowDef(username, safe, req.body);
  if (!ok) {
    res.status(500).json({ error: 'failed to write flow' });
    return;
  }
  log.info(
    { username, filename: safe, nodeCount: req.body.nodes.length, entryNodeId: req.body.entryNodeId },
    'global flow saved',
  );
  res.json({ ok });
});

// DELETE /api/global/flows/file/:filename
router.delete('/file/:filename', (req: AuthRequest, res: Response): void => {
  const username = requireUser(req, res);
  if (!username) return;
  const safe = sanitizeFlowFilename(req.params.filename);
  if (!safe) {
    res.status(400).json({ error: 'invalid filename' });
    return;
  }
  const ok = deleteGlobalFlowDef(username, safe);
  log.info({ username, filename: safe, ok }, 'global flow deleted');
  res.json({ ok });
});

export default router;
