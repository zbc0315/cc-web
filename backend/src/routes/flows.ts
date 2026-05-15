import { Router, Response } from 'express';
import { AuthRequest } from '../auth';
import { getProject } from '../config';
import { requireProjectOwner } from '../middleware/authz';
import {
  deleteFlowDef,
  listFlowDefs,
  loadFlowDef,
  loadFlowState,
  loadGlobalFlowDef,
  sanitizeFlowFilename,
  saveFlowDef,
} from '../flows/store';
import { flowRunner } from '../flows/runner';
import { isTrackRunning } from '../tracks/cross-lock';
import type { FlowDef } from '../flows/types';
import { SCHEMA_VERSION } from '../flows/types';
import { modLogger } from '../logger';

const log = modLogger('flows-route');

const router = Router();

// ── Validation ────────────────────────────────────────────────────────────

/** Names must be non-empty, not contain control bytes or backticks (backticks
 *  wrap names in prompt blocks; control bytes can corrupt PTY paste mode). */
const PROMPT_UNSAFE = /[\x00-\x08\x0b\x0c\x0e-\x1f`]/;

/** Extract all `{{var:name}}` and `{{const:name}}` references from a prompt
 *  template. Returned names are trimmed. */
function extractTemplateRefs(tpl: string): { vars: Set<string>; consts: Set<string> } {
  const vars = new Set<string>();
  const consts = new Set<string>();
  const varRe = /\{\{var:([^}]+)\}\}/g;
  const constRe = /\{\{const:([^}]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = varRe.exec(tpl)) !== null) vars.add(m[1].trim());
  while ((m = constRe.exec(tpl)) !== null) consts.add(m[1].trim());
  return { vars, consts };
}

export function validateFlowDef(obj: unknown): obj is FlowDef {
  if (!obj || typeof obj !== 'object') return false;
  const d = obj as Partial<FlowDef> & Record<string, unknown>;

  // Hard schemaVersion gate. v1 (pre-workflow_data) defs are rejected — the
  // refactor is intentionally non-backward-compatible.
  if (d.schemaVersion !== SCHEMA_VERSION) return false;
  if (typeof d.id !== 'string' || !d.id) return false;
  if (typeof d.name !== 'string' || !d.name) return false;
  if (typeof d.entryNodeId !== 'number') return false;
  if (!Array.isArray(d.nodes) || d.nodes.length === 0) return false;

  // Constants + variables share a single namespace; names must be unique
  // across both lists (a system-logic branch.variable/constant referencing
  // a name would be ambiguous otherwise).
  const declaredNames = new Set<string>();
  const constantNames = new Set<string>();
  const variableNames = new Set<string>();

  if (d.constants !== undefined) {
    if (!Array.isArray(d.constants)) return false;
    for (const c of d.constants) {
      if (!c || typeof c !== 'object') return false;
      const cr = c as { name?: unknown; value?: unknown; description?: unknown };
      if (typeof cr.name !== 'string') return false;
      const name = cr.name.trim();
      if (!name) return false;
      if (PROMPT_UNSAFE.test(name)) return false;
      if (declaredNames.has(name)) return false;
      declaredNames.add(name);
      constantNames.add(name);
      cr.name = name;
      // value: any JSON; must serialize. Validator accepts anything that
      // JSON.stringify can round-trip; circular refs / functions get caught
      // by the runtime writer.
      try {
        JSON.stringify(cr.value);
      } catch {
        return false;
      }
      if (cr.description !== undefined && typeof cr.description !== 'string') return false;
      if (typeof cr.description === 'string' && PROMPT_UNSAFE.test(cr.description)) return false;
    }
  }

  if (d.variables !== undefined) {
    if (!Array.isArray(d.variables)) return false;
    for (const v of d.variables) {
      if (!v || typeof v !== 'object') return false;
      const vr = v as { name?: unknown; description?: unknown; initialValue?: unknown };
      if (typeof vr.name !== 'string') return false;
      const name = vr.name.trim();
      if (!name) return false;
      if (PROMPT_UNSAFE.test(name)) return false;
      if (declaredNames.has(name)) return false; // collision with constants OR another variable
      declaredNames.add(name);
      variableNames.add(name);
      vr.name = name;
      if (typeof vr.description !== 'string') return false;
      if (PROMPT_UNSAFE.test(vr.description)) return false;
      if (vr.initialValue !== undefined) {
        try {
          JSON.stringify(vr.initialValue);
        } catch {
          return false;
        }
      }
    }
  }

  // Node validation
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
      const fieldKeys = new Set<string>();
      for (const f of schema.fields) {
        const fr = f as {
          key?: unknown; label?: unknown; type?: unknown;
          outputVariable?: unknown; bindVariable?: unknown; bindConstant?: unknown;
        };
        if (typeof fr.key !== 'string') return false;
        const trimmedKey = fr.key.trim();
        if (!trimmedKey) return false;
        if (fieldKeys.has(trimmedKey)) return false;
        fieldKeys.add(trimmedKey);
        fr.key = trimmedKey;
        if (typeof fr.label !== 'string') return false;
        if (fr.type !== 'text' && fr.type !== 'textarea') return false;
        // outputVariable / bindVariable / bindConstant: exactly 0 or 1 must
        // be set. Setting two is ambiguous (does the user value or the
        // displayed value win on submit?).
        const out = typeof fr.outputVariable === 'string' && fr.outputVariable.trim().length > 0
          ? fr.outputVariable.trim() : null;
        const bindV = typeof fr.bindVariable === 'string' && fr.bindVariable.trim().length > 0
          ? fr.bindVariable.trim() : null;
        const bindC = typeof fr.bindConstant === 'string' && fr.bindConstant.trim().length > 0
          ? fr.bindConstant.trim() : null;
        const setCount = [out, bindV, bindC].filter((x) => x !== null).length;
        if (setCount > 1) return false;
        if (out !== null && !variableNames.has(out)) return false;
        if (bindV !== null && !variableNames.has(bindV)) return false;
        if (bindC !== null && !constantNames.has(bindC)) return false;
        // Normalize on disk — only one binding key is kept.
        delete fr.outputVariable;
        delete fr.bindVariable;
        delete fr.bindConstant;
        if (out !== null) fr.outputVariable = out;
        else if (bindV !== null) fr.bindVariable = bindV;
        else if (bindC !== null) fr.bindConstant = bindC;
      }
      if (n.next !== null && typeof n.next !== 'number') return false;
    } else if (kind === 'llm') {
      if (typeof n.promptTemplate !== 'string') return false;
      if (typeof n.timeoutSec !== 'number' || !(n.timeoutSec > 0)) return false;
      if (n.next !== null && typeof n.next !== 'number') return false;
      // Validate readVariables / writeVariables / readConstants are declared.
      for (const field of ['readVariables', 'writeVariables'] as const) {
        if (n[field] !== undefined) {
          if (!Array.isArray(n[field])) return false;
          const normalized: string[] = [];
          for (const vn of n[field] as unknown[]) {
            if (typeof vn !== 'string') return false;
            const trimmed = vn.trim();
            if (!variableNames.has(trimmed)) return false;
            normalized.push(trimmed);
          }
          n[field] = normalized;
        }
      }
      if (n.readConstants !== undefined) {
        if (!Array.isArray(n.readConstants)) return false;
        const normalized: string[] = [];
        for (const cn of n.readConstants as unknown[]) {
          if (typeof cn !== 'string') return false;
          const trimmed = cn.trim();
          if (!constantNames.has(trimmed)) return false;
          normalized.push(trimmed);
        }
        n.readConstants = normalized;
      }
      // promptTemplate references {{var:X}} / {{const:Y}}: X must be a
      // declared variable, Y a declared constant. Catches typos at save time.
      const refs = extractTemplateRefs(n.promptTemplate as string);
      for (const v of refs.vars) {
        if (!variableNames.has(v)) return false;
      }
      for (const c of refs.consts) {
        if (!constantNames.has(c)) return false;
      }
    } else if (kind === 'system-logic') {
      if (!Array.isArray(n.branches)) return false;
      for (const b of n.branches) {
        if (!b || typeof b !== 'object') return false;
        const br = b as { variable?: unknown; constant?: unknown; goto?: unknown };
        if (typeof br.goto !== 'number') return false;
        const v = typeof br.variable === 'string' ? br.variable.trim() : '';
        const c = typeof br.constant === 'string' ? br.constant.trim() : '';
        const hasV = v.length > 0;
        const hasC = c.length > 0;
        if (!hasV && !hasC) return false; // need one
        if (hasV && hasC) return false;     // not both
        if (hasV) {
          if (!variableNames.has(v)) return false;
          br.variable = v;
          delete br.constant;
        } else {
          if (!constantNames.has(c)) return false;
          br.constant = c;
          delete br.variable;
        }
      }
      if (typeof n.maxRetries !== 'number' || !(n.maxRetries >= 0)) return false;
      if (n.defaultGoto != null && typeof n.defaultGoto !== 'number') return false;
    } else {
      return false;
    }
  }

  // entryNodeId must point to an existing node
  if (!seenIds.has(d.entryNodeId)) return false;

  // All next/defaultGoto/goto must point to existing nodes (or null)
  for (const raw of d.nodes) {
    const n = raw as unknown as Record<string, unknown>;
    if (n.kind === 'user-input' || n.kind === 'llm') {
      if (n.next !== null && typeof n.next === 'number' && !seenIds.has(n.next)) return false;
    } else if (n.kind === 'system-logic') {
      if (n.defaultGoto != null && typeof n.defaultGoto === 'number' && !seenIds.has(n.defaultGoto as number)) return false;
      for (const b of (n.branches as { goto: number }[])) {
        if (!seenIds.has(b.goto)) return false;
      }
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
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    res.json({ files: listFlowDefs(project.folderPath) });
  },
);

// GET /api/projects/:projectId/flows/file/:filename
router.get(
  '/:projectId/flows/file/:filename',
  requireProjectOwner('projectId'),
  (req: AuthRequest, res: Response): void => {
    const project = getProject(req.params.projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    const safe = sanitizeFlowFilename(req.params.filename);
    if (!safe) { res.status(400).json({ error: 'invalid filename' }); return; }
    const def = loadFlowDef(project.folderPath, safe);
    if (!def) { res.status(404).json({ error: 'Flow not found' }); return; }
    res.json(def);
  },
);

// PUT /api/projects/:projectId/flows/file/:filename
router.put(
  '/:projectId/flows/file/:filename',
  requireProjectOwner('projectId'),
  (req: AuthRequest, res: Response): void => {
    const project = getProject(req.params.projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    const safe = sanitizeFlowFilename(req.params.filename);
    if (!safe) { res.status(400).json({ error: 'invalid filename' }); return; }
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

// DELETE /api/projects/:projectId/flows/file/:filename
router.delete(
  '/:projectId/flows/file/:filename',
  requireProjectOwner('projectId'),
  (req: AuthRequest, res: Response): void => {
    const project = getProject(req.params.projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    const safe = sanitizeFlowFilename(req.params.filename);
    if (!safe) { res.status(400).json({ error: 'invalid filename' }); return; }
    const ok = deleteFlowDef(project.folderPath, safe);
    log.info({ projectId: project.id, filename: safe, ok }, 'flow deleted');
    res.json({ ok });
  },
);

// ── Runtime ───────────────────────────────────────────────────────────────

// POST /api/projects/:projectId/flows/run  body: { filename, source?: 'project' | 'global' }
router.post(
  '/:projectId/flows/run',
  requireProjectOwner('projectId'),
  (req: AuthRequest, res: Response): void => {
    const project = getProject(req.params.projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    const filename = typeof req.body?.filename === 'string' ? req.body.filename : '';
    const safe = sanitizeFlowFilename(filename);
    if (!safe) { res.status(400).json({ error: 'invalid filename' }); return; }
    const source = req.body?.source === 'global' ? 'global' : 'project';
    let def: FlowDef | null = null;
    if (source === 'global') {
      const username = req.user?.username;
      if (!username) { res.status(401).json({ error: 'auth required' }); return; }
      def = loadGlobalFlowDef(username, safe);
    } else {
      def = loadFlowDef(project.folderPath, safe);
    }
    if (!def) { res.status(404).json({ error: 'Flow not found' }); return; }
    // Cross-subsystem lock: refuse to start a flow if a track is currently
    // running on the same project. Both write workflow_data.json (RMW race).
    // Symmetric guard in routes/tracks.ts.
    if (isTrackRunning(project.id)) {
      res.status(409).json({
        error: 'a track is currently running on this project; abort it first',
      });
      return;
    }
    const result = flowRunner.start(project.id, project.folderPath, def, safe);
    if (!result.ok) { res.status(409).json({ error: result.reason ?? 'cannot start' }); return; }
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
    if (!ok) { res.status(409).json({ error: 'cannot resume (not paused or awaiting user input)' }); return; }
    res.json({ ok });
  },
);

// POST /api/projects/:projectId/flows/input  body: { data: {key: value, ...} }
router.post(
  '/:projectId/flows/input',
  requireProjectOwner('projectId'),
  (req: AuthRequest, res: Response): void => {
    const data = req.body?.data;
    if (!data || typeof data !== 'object') { res.status(400).json({ error: 'data is required' }); return; }
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      cleaned[k] = typeof v === 'string' ? v : String(v);
    }
    const ok = flowRunner.submitUserInput(req.params.projectId, cleaned);
    if (!ok) { res.status(409).json({ error: 'no flow awaiting input' }); return; }
    log.info(
      { projectId: req.params.projectId, fieldCount: Object.keys(cleaned).length },
      'flow user-input submission',
    );
    res.json({ ok });
  },
);

// GET /api/projects/:projectId/flows/state
router.get(
  '/:projectId/flows/state',
  requireProjectOwner('projectId'),
  (req: AuthRequest, res: Response): void => {
    const project = getProject(req.params.projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    const state = flowRunner.getState(project.id) ?? loadFlowState(project.folderPath);
    res.json({ running: flowRunner.isRunning(project.id), state });
  },
);

export default router;
