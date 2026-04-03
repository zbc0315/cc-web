import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest } from '../auth';
import { getGlobalShortcuts, saveGlobalShortcuts, GlobalShortcut, readProjectShortcuts, saveProjectShortcuts, getProject, isAdminUser, isProjectOwner } from '../config';

const router = Router();

/** Detect circular parentId references (A→B→A). Returns true if adding parentId to targetId would create a cycle. */
function hasCycle(shortcuts: GlobalShortcut[], targetId: string, parentId: string): boolean {
  let current: string | undefined = parentId;
  const visited = new Set<string>();
  while (current) {
    if (current === targetId || visited.has(current)) return true;
    visited.add(current);
    current = shortcuts.find((s) => s.id === current)?.parentId;
  }
  return false;
}

// GET /api/shortcuts
router.get('/', (req: AuthRequest, res: Response): void => {
  res.json(getGlobalShortcuts(req.user?.username));
});

// POST /api/shortcuts
router.post('/', (req: AuthRequest, res: Response): void => {
  const { label, command, parentId } = req.body as { label?: string; command?: string; parentId?: string };
  if (!command?.trim()) { res.status(400).json({ error: 'command is required' }); return; }

  const username = req.user?.username;
  const shortcuts = getGlobalShortcuts(username);
  if (parentId && !shortcuts.some((s) => s.id === parentId)) {
    res.status(400).json({ error: 'Parent shortcut not found' }); return;
  }

  const shortcut: GlobalShortcut = {
    id: uuidv4(),
    label: label?.trim() || command.trim(),
    command: command.trim(),
    ...(parentId ? { parentId } : {}),
  };
  shortcuts.push(shortcut);
  saveGlobalShortcuts(shortcuts, username);
  res.status(201).json(shortcut);
});

// PUT /api/shortcuts/:id
router.put('/:id', (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const { label, command } = req.body as { label?: string; command?: string };
  if (!command?.trim()) { res.status(400).json({ error: 'command is required' }); return; }

  const username = req.user?.username;
  const shortcuts = getGlobalShortcuts(username);
  const idx = shortcuts.findIndex((s) => s.id === id);
  if (idx < 0) { res.status(404).json({ error: 'Not found' }); return; }

  const { parentId } = req.body as { parentId?: string | null };
  if (parentId && !shortcuts.some((s) => s.id === parentId)) {
    res.status(400).json({ error: 'Parent shortcut not found' }); return;
  }
  if (parentId && hasCycle(shortcuts, id, parentId)) {
    res.status(400).json({ error: 'Circular parent reference detected' }); return;
  }
  shortcuts[idx] = {
    id, label: label?.trim() || command.trim(), command: command.trim(),
    ...(parentId ? { parentId } : parentId === null ? {} : { parentId: shortcuts[idx].parentId }),
  };
  saveGlobalShortcuts(shortcuts, username);
  res.json(shortcuts[idx]);
});

// DELETE /api/shortcuts/:id
router.delete('/:id', (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const username = req.user?.username;
  const shortcuts = getGlobalShortcuts(username);
  const filtered = shortcuts.filter((s) => s.id !== id);
  if (filtered.length === shortcuts.length) { res.status(404).json({ error: 'Not found' }); return; }
  saveGlobalShortcuts(filtered, username);
  res.json({ success: true });
});

// ── Project shortcuts (stored in .ccweb/shortcuts.json) ──────────────────────

function resolveProjectFolder(projectId: string, username: string, res: Response): string | null {
  const project = getProject(projectId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return null; }
  if (!isAdminUser(username) && !isProjectOwner(project, username) &&
      !project.shares?.some((s: { username: string; permission: string }) => s.username === username && s.permission === 'edit')) {
    res.status(403).json({ error: 'Access denied' }); return null;
  }
  return project.folderPath;
}

// GET /api/shortcuts/project/:projectId
router.get('/project/:projectId', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;
  res.json(readProjectShortcuts(folder));
});

// POST /api/shortcuts/project/:projectId
router.post('/project/:projectId', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;
  const { label, command } = req.body as { label?: string; command?: string };
  if (!command?.trim()) { res.status(400).json({ error: 'command is required' }); return; }
  const shortcuts = readProjectShortcuts(folder);
  const shortcut = { id: uuidv4(), label: label?.trim() || command.trim(), command: command.trim() };
  shortcuts.push(shortcut);
  saveProjectShortcuts(folder, shortcuts);
  res.status(201).json(shortcut);
});

// PUT /api/shortcuts/project/:projectId/:id
router.put('/project/:projectId/:id', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;
  const { id } = req.params;
  const { label, command } = req.body as { label?: string; command?: string };
  if (!command?.trim()) { res.status(400).json({ error: 'command is required' }); return; }
  const shortcuts = readProjectShortcuts(folder);
  const idx = shortcuts.findIndex((s) => s.id === id);
  if (idx < 0) { res.status(404).json({ error: 'Not found' }); return; }
  shortcuts[idx] = { id, label: label?.trim() || command.trim(), command: command.trim() };
  saveProjectShortcuts(folder, shortcuts);
  res.json(shortcuts[idx]);
});

// DELETE /api/shortcuts/project/:projectId/:id
router.delete('/project/:projectId/:id', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;
  const { id } = req.params;
  const shortcuts = readProjectShortcuts(folder);
  const filtered = shortcuts.filter((s) => s.id !== id);
  if (filtered.length === shortcuts.length) { res.status(404).json({ error: 'Not found' }); return; }
  saveProjectShortcuts(folder, filtered);
  res.json({ success: true });
});

export default router;
