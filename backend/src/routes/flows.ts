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
  loadGlobalFlowDef,
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

export function validateFlowDef(obj: unknown): obj is FlowDef {
  if (!obj || typeof obj !== 'object') return false;
  const d = obj as Partial<FlowDef>;
  if (typeof d.id !== 'string' || !d.id) return false;
  if (typeof d.name !== 'string' || !d.name) return false;
  if (typeof d.entryNodeId !== 'number') return false;
  if (!Array.isArray(d.nodes) || d.nodes.length === 0) return false;

  // Variables: optional, default []. Names must be unique. File path must be
  // a safe relative path. Description is required (can be empty string but
  // not omitted) so callers see it as a first-class field.
  //
  // PROMPT_UNSAFE rejects characters that would break the prompt formatting
  // (backticks wrap file paths in the init block) or smuggle control bytes
  // through the LLM input (NUL + non-whitespace C0). Tab/LF/CR are allowed
  // in description so multi-line meanings still work.
  const variableNames = new Set<string>();
  const PROMPT_UNSAFE = /[\x00-\x08\x0b\x0c\x0e-\x1f`]/;
  if (d.variables !== undefined) {
    if (!Array.isArray(d.variables)) return false;
    for (const v of d.variables) {
      if (!v || typeof v !== 'object') return false;
      const vr = v as { name?: unknown; file?: unknown; description?: unknown };
      if (typeof vr.name !== 'string') return false;
      const trimmedName = vr.name.trim();
      if (!trimmedName) return false;
      if (PROMPT_UNSAFE.test(trimmedName)) return false;
      vr.name = trimmedName; // normalize for runtime lookups
      if (variableNames.has(trimmedName)) return false; // dedupe
      variableNames.add(trimmedName);
      if (typeof vr.file !== 'string') return false;
      const trimmedFile = vr.file.trim();
      if (!isSafeRelPath(trimmedFile)) return false;
      if (PROMPT_UNSAFE.test(trimmedFile)) return false;
      vr.file = trimmedFile;
      if (typeof vr.description !== 'string') return false;
      if (PROMPT_UNSAFE.test(vr.description)) return false;
    }
  }

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
      // initVariables: optional, default []. Each name must reference a
      // declared flow variable. Trim before lookup so trailing spaces from
      // editor input don't silently break variable resolution.
      if (n.initVariables !== undefined) {
        if (!Array.isArray(n.initVariables)) return false;
        const normalized: string[] = [];
        for (const vn of n.initVariables) {
          if (typeof vn !== 'string') return false;
          const trimmed = vn.trim();
          if (!variableNames.has(trimmed)) return false;
          normalized.push(trimmed);
        }
        n.initVariables = normalized;
      }
    } else if (kind === 'system-logic') {
      // For variable-mode branches the node-level inputs can be empty (runner
      // resolves file per branch). For legacy field-mode it must be non-empty.
      if (!Array.isArray(n.inputs) || !n.inputs.every(isFileRef)) return false;
      if (!Array.isArray(n.branches)) return false;
      let needsNodeInputs = false;
      for (const b of n.branches) {
        const br = b as { variable?: unknown; field?: unknown; goto?: unknown };
        if (typeof br.goto !== 'number') return false;
        // Trim variable/field — without this a whitespace-only value like
        // `" "` would pass the length check but silently no-op at runtime
        // (obj[" "] is undefined → no branch matches → default goto).
        const variable = typeof br.variable === 'string' ? br.variable.trim() : '';
        const field = typeof br.field === 'string' ? br.field.trim() : '';
        const hasVar = variable.length > 0;
        const hasField = field.length > 0;
        if (!hasVar && !hasField) return false;     // need one
        if (hasVar && hasField) return false;        // not both
        if (hasVar) {
          if (!variableNames.has(variable)) return false;
          br.variable = variable;
          delete br.field; // ensure XOR is preserved on disk
        } else {
          br.field = field;
          delete br.variable;
          needsNodeInputs = true;
        }
        // `equals` is unknown by design
      }
      if (needsNodeInputs && n.inputs.length === 0) return false;
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

// POST /api/projects/:projectId/flows/run  body: { filename, source?: 'project' | 'global' }
//
// `source` defaults to 'project'. When 'global', the flow definition is loaded
// from ~/.ccweb/users/<username>/flows/, but the run still binds to this
// project's folderPath/PTY/projectId — global flows are reusable templates,
// not standalone runtimes.
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
    const source = req.body?.source === 'global' ? 'global' : 'project';
    let def: import('../flows/types').FlowDef | null = null;
    if (source === 'global') {
      const username = req.user?.username;
      if (!username) {
        res.status(401).json({ error: 'auth required' });
        return;
      }
      def = loadGlobalFlowDef(username, safe);
    } else {
      def = loadFlowDef(project.folderPath, safe);
    }
    if (!def) {
      res.status(404).json({ error: 'Flow not found' });
      return;
    }
    const result = flowRunner.start(project.id, project.folderPath, def, safe);
    if (!result.ok) {
      res.status(409).json({ error: result.reason ?? 'cannot start' });
      return;
    }
    log.info({ projectId: project.id, flow: safe, source }, 'flow started');
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
