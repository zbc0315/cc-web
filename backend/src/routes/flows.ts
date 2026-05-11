import { Router, Response } from 'express';
import { AuthRequest } from '../auth';
import { getProject } from '../config';
import { requireProjectOwner } from '../middleware/authz';
import {
  deleteFlowDef,
  isSafeRelPath,
  listFlowDefs,
  loadFlowDef,
  loadFlowState,
  sanitizeFlowFilename,
  saveFlowDef,
} from '../flows/store';
import { flowRunner } from '../flows/runner';
import type { FlowDef } from '../flows/types';
import { modLogger } from '../logger';

const log = modLogger('flows-route');

const router = Router();

/** Structural validation. Owner-trusted input but we reject obvious garbage
 *  and surface kind-specific shape mismatches early — otherwise the runner
 *  hits `NaN * 1000` timeouts or `tpl.replace(undefined)` crashes mid-run
 *  (codex review P1a). */
function isFileRef(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const r = v as { path?: unknown; provider?: unknown };
  // Reject absolute paths, `..` traversal, NUL bytes at design time so a
  // malicious save can't poison disk paths before the runner picks it up.
  if (!isSafeRelPath(r.path)) return false;
  return r.provider === 'user' || r.provider === 'llm' || r.provider === 'system';
}

function validateFlowDef(obj: unknown): obj is FlowDef {
  if (!obj || typeof obj !== 'object') return false;
  const d = obj as Partial<FlowDef>;
  if (typeof d.id !== 'string' || !d.id) return false;
  if (typeof d.name !== 'string' || !d.name) return false;
  if (typeof d.entryNodeId !== 'number') return false;
  if (!Array.isArray(d.nodes) || d.nodes.length === 0) return false;
  const seenIds = new Set<number>();
  for (const raw of d.nodes) {
    if (!raw || typeof raw !== 'object') return false;
    const n = raw as unknown as Record<string, unknown>;
    if (typeof n.id !== 'number') return false;
    if (seenIds.has(n.id as number)) return false;
    seenIds.add(n.id as number);
    if (typeof n.name !== 'string') return false;
    const kind = n.kind;
    if (kind === 'user-input') {
      const schema = n.userInputSchema as { fields?: unknown } | undefined;
      if (!schema || !Array.isArray(schema.fields)) return false;
      for (const f of schema.fields) {
        const fr = f as { key?: unknown; label?: unknown; type?: unknown };
        if (typeof fr.key !== 'string' || typeof fr.label !== 'string') return false;
        if (fr.type !== 'text' && fr.type !== 'textarea') return false;
      }
      if (!Array.isArray(n.outputs) || !n.outputs.every(isFileRef)) return false;
      if (n.next !== null && typeof n.next !== 'number') return false;
    } else if (kind === 'llm') {
      if (!Array.isArray(n.inputs) || !n.inputs.every(isFileRef)) return false;
      if (typeof n.promptTemplate !== 'string') return false;
      if (!Array.isArray(n.outputs) || !n.outputs.every(isFileRef)) return false;
      if (typeof n.timeoutSec !== 'number' || !(n.timeoutSec > 0)) return false;
      if (n.next !== null && typeof n.next !== 'number') return false;
    } else if (kind === 'system-logic') {
      if (!Array.isArray(n.inputs) || n.inputs.length === 0 || !n.inputs.every(isFileRef)) return false;
      if (!Array.isArray(n.branches)) return false;
      for (const b of n.branches) {
        const br = b as { field?: unknown; goto?: unknown };
        if (typeof br.field !== 'string') return false;
        if (typeof br.goto !== 'number') return false;
        // `equals` is unknown by design — booleans/numbers/strings all OK
      }
      if (typeof n.maxRetries !== 'number' || !(n.maxRetries >= 0)) return false;
      if (n.defaultGoto != null && typeof n.defaultGoto !== 'number') return false;
    } else {
      return false;
    }
  }
  return true;
}

// ── Definition CRUD ───────────────────────────────────────────────────────

// GET /api/projects/:projectId/flows
router.get(
  '/:projectId/flows',
  requireProjectOwner('projectId'),
  (req: AuthRequest, res: Response): void => {
    const project = getProject(req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json({ files: listFlowDefs(project.folderPath) });
  },
);

// GET /api/projects/:projectId/flows/:filename
router.get(
  '/:projectId/flows/file/:filename',
  requireProjectOwner('projectId'),
  (req: AuthRequest, res: Response): void => {
    const project = getProject(req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const safe = sanitizeFlowFilename(req.params.filename);
    if (!safe) {
      res.status(400).json({ error: 'invalid filename' });
      return;
    }
    const def = loadFlowDef(project.folderPath, safe);
    if (!def) {
      res.status(404).json({ error: 'Flow not found' });
      return;
    }
    res.json(def);
  },
);

// PUT /api/projects/:projectId/flows/:filename
router.put(
  '/:projectId/flows/file/:filename',
  requireProjectOwner('projectId'),
  (req: AuthRequest, res: Response): void => {
    const project = getProject(req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const safe = sanitizeFlowFilename(req.params.filename);
    if (!safe) {
      res.status(400).json({ error: 'invalid filename' });
      return;
    }
    if (!validateFlowDef(req.body)) {
      log.warn({ projectId: project.id, filename: safe }, 'flow save rejected (validation)');
      res.status(400).json({ error: 'invalid flow definition' });
      return;
    }
    const ok = saveFlowDef(project.folderPath, safe, req.body);
    log.info(
      { projectId: project.id, filename: safe, nodeCount: req.body.nodes.length, entryNodeId: req.body.entryNodeId },
      'flow saved',
    );
    res.json({ ok });
  },
);

// DELETE /api/projects/:projectId/flows/:filename
router.delete(
  '/:projectId/flows/file/:filename',
  requireProjectOwner('projectId'),
  (req: AuthRequest, res: Response): void => {
    const project = getProject(req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const safe = sanitizeFlowFilename(req.params.filename);
    if (!safe) {
      res.status(400).json({ error: 'invalid filename' });
      return;
    }
    const ok = deleteFlowDef(project.folderPath, safe);
    log.info({ projectId: project.id, filename: safe, ok }, 'flow deleted');
    res.json({ ok });
  },
);

// ── Runtime ───────────────────────────────────────────────────────────────

// POST /api/projects/:projectId/flows/run  body: { filename }
router.post(
  '/:projectId/flows/run',
  requireProjectOwner('projectId'),
  (req: AuthRequest, res: Response): void => {
    const project = getProject(req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const filename = typeof req.body?.filename === 'string' ? req.body.filename : '';
    const safe = sanitizeFlowFilename(filename);
    if (!safe) {
      res.status(400).json({ error: 'invalid filename' });
      return;
    }
    const def = loadFlowDef(project.folderPath, safe);
    if (!def) {
      res.status(404).json({ error: 'Flow not found' });
      return;
    }
    const result = flowRunner.start(project.id, project.folderPath, def, safe);
    if (!result.ok) {
      res.status(409).json({ error: result.reason ?? 'cannot start' });
      return;
    }
    log.info({ projectId: project.id, flow: safe }, 'flow started');
    res.json({ ok: true, state: result.state });
  },
);

// POST /api/projects/:projectId/flows/abort
router.post(
  '/:projectId/flows/abort',
  requireProjectOwner('projectId'),
  (req: AuthRequest, res: Response): void => {
    const ok = flowRunner.abort(req.params.projectId);
    log.info({ projectId: req.params.projectId, ok }, 'flow abort requested');
    res.json({ ok });
  },
);

// POST /api/projects/:projectId/flows/resume
router.post(
  '/:projectId/flows/resume',
  requireProjectOwner('projectId'),
  (req: AuthRequest, res: Response): void => {
    const ok = flowRunner.resume(req.params.projectId);
    log.info({ projectId: req.params.projectId, ok }, 'flow resume requested');
    if (!ok) {
      res.status(409).json({ error: 'cannot resume (not paused or awaiting user input)' });
      return;
    }
    res.json({ ok });
  },
);

// POST /api/projects/:projectId/flows/input  body: { data: {key: value, ...} }
router.post(
  '/:projectId/flows/input',
  requireProjectOwner('projectId'),
  (req: AuthRequest, res: Response): void => {
    const data = req.body?.data;
    if (!data || typeof data !== 'object') {
      res.status(400).json({ error: 'data required' });
      return;
    }
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      flat[k] = v == null ? '' : String(v);
    }
    const ok = flowRunner.submitUserInput(req.params.projectId, flat);
    log.info(
      { projectId: req.params.projectId, ok, fieldKeys: Object.keys(flat) },
      'flow user-input submission',
    );
    if (!ok) {
      res.status(409).json({ error: 'no pending user input' });
      return;
    }
    res.json({ ok: true });
  },
);

// GET /api/projects/:projectId/flows/state
router.get(
  '/:projectId/flows/state',
  requireProjectOwner('projectId'),
  (req: AuthRequest, res: Response): void => {
    const project = getProject(req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    // In-memory (running) takes precedence over on-disk (terminated).
    const state = flowRunner.isRunning(project.id)
      ? flowRunner.getState(project.id)
      : loadFlowState(project.folderPath);
    res.json({ running: flowRunner.isRunning(project.id), state });
  },
);

export default router;
