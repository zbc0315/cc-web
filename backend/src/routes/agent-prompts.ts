import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest } from '../auth';
import { getProject, isAdminUser, isProjectOwner } from '../config';
import {
  readGlobalPrompts, writeGlobalPrompts,
  readProjectPrompts, writeProjectPrompts,
  readClaudeMd, insertIntoClaudeMd, removeFromClaudeMd, annotateInserted,
  validatePromptInput,
} from '../agent-prompts';
import { AgentPrompt } from '../types';

const router = Router();

// ── Global prompts (per user) ────────────────────────────────────────────────

// GET /api/prompts
router.get('/', (req: AuthRequest, res: Response): void => {
  res.json(readGlobalPrompts(req.user?.username));
});

// POST /api/prompts
router.post('/', (req: AuthRequest, res: Response): void => {
  const parsed = validatePromptInput(req.body);
  if (typeof parsed === 'string') { res.status(400).json({ error: parsed }); return; }
  const username = req.user?.username;
  const list = readGlobalPrompts(username);
  const entry: AgentPrompt = {
    id: uuidv4(),
    label: parsed.label,
    command: parsed.command,
    createdAt: new Date().toISOString(),
  };
  list.push(entry);
  writeGlobalPrompts(list, username);
  res.status(201).json(entry);
});

// PUT /api/prompts/:id
router.put('/:id', (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const parsed = validatePromptInput(req.body);
  if (typeof parsed === 'string') { res.status(400).json({ error: parsed }); return; }
  const username = req.user?.username;
  const list = readGlobalPrompts(username);
  const idx = list.findIndex((p) => p.id === id);
  if (idx < 0) { res.status(404).json({ error: 'Not found' }); return; }
  list[idx] = { ...list[idx], label: parsed.label, command: parsed.command };
  writeGlobalPrompts(list, username);
  res.json(list[idx]);
});

// DELETE /api/prompts/:id
router.delete('/:id', (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const username = req.user?.username;
  const list = readGlobalPrompts(username);
  const filtered = list.filter((p) => p.id !== id);
  if (filtered.length === list.length) { res.status(404).json({ error: 'Not found' }); return; }
  writeGlobalPrompts(filtered, username);
  res.json({ success: true });
});

// ── Project prompts (stored in {folder}/.ccweb/agent-prompts.json) ──────────

/**
 * Resolve the project folder for a prompt operation, checking that the caller
 * has edit-level access (admin OR owner OR share with 'edit' permission).
 * Mirrors the permission model used by `routes/shortcuts.ts`.
 */
function resolveProjectFolder(
  projectId: string,
  username: string,
  res: Response,
): string | null {
  const project = getProject(projectId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return null; }
  if (
    !isAdminUser(username) &&
    !isProjectOwner(project, username) &&
    !project.shares?.some((s) => s.username === username && s.permission === 'edit')
  ) {
    res.status(403).json({ error: 'Access denied' });
    return null;
  }
  return project.folderPath;
}

// GET /api/prompts/project/:projectId
//   → { global: (AgentPrompt & {inserted})[], project: (AgentPrompt & {inserted})[] }
router.get('/project/:projectId', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;
  const claudeMd = readClaudeMd(folder);
  res.json({
    global: annotateInserted(readGlobalPrompts(req.user?.username), claudeMd),
    project: annotateInserted(readProjectPrompts(folder), claudeMd),
  });
});

// POST /api/prompts/project/:projectId
router.post('/project/:projectId', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;
  const parsed = validatePromptInput(req.body);
  if (typeof parsed === 'string') { res.status(400).json({ error: parsed }); return; }
  const list = readProjectPrompts(folder);
  const entry: AgentPrompt = {
    id: uuidv4(),
    label: parsed.label,
    command: parsed.command,
    createdAt: new Date().toISOString(),
  };
  list.push(entry);
  writeProjectPrompts(folder, list);
  res.status(201).json(entry);
});

// PUT /api/prompts/project/:projectId/:id
router.put('/project/:projectId/:id', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;
  const { id } = req.params;
  const parsed = validatePromptInput(req.body);
  if (typeof parsed === 'string') { res.status(400).json({ error: parsed }); return; }
  const list = readProjectPrompts(folder);
  const idx = list.findIndex((p) => p.id === id);
  if (idx < 0) { res.status(404).json({ error: 'Not found' }); return; }
  list[idx] = { ...list[idx], label: parsed.label, command: parsed.command };
  writeProjectPrompts(folder, list);
  res.json(list[idx]);
});

// DELETE /api/prompts/project/:projectId/:id
router.delete('/project/:projectId/:id', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;
  const { id } = req.params;
  const list = readProjectPrompts(folder);
  const filtered = list.filter((p) => p.id !== id);
  if (filtered.length === list.length) { res.status(404).json({ error: 'Not found' }); return; }
  writeProjectPrompts(folder, filtered);
  res.json({ success: true });
});

// ── CLAUDE.md toggle (insert / remove by exact text) ────────────────────────

// POST /api/prompts/project/:projectId/toggle
// body: { text: string, action: 'insert' | 'remove' }
router.post('/project/:projectId/toggle', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const { text, action } = req.body as { text?: string; action?: string };
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  if (text.length > 8000) {
    res.status(400).json({ error: 'text must be ≤8000 characters' });
    return;
  }

  if (action === 'insert') {
    try {
      const result = insertIntoClaudeMd(folder, text);
      res.json({ action, ...result, inserted: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
    return;
  }

  if (action === 'remove') {
    try {
      const result = removeFromClaudeMd(folder, text);
      if (result.changed) {
        res.json({ action, changed: true, inserted: false });
      } else {
        // 'not-found' means the exact text could not be located; distinct from
        // 'not-present' (file empty / text never there) so the frontend can
        // decide whether to surface a "please delete manually" toast.
        res.json({ action, changed: false, reason: result.reason, inserted: result.reason === 'not-found' });
      }
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
    return;
  }

  res.status(400).json({ error: "action must be 'insert' or 'remove'" });
});

export default router;
