import { Router, Response } from 'express';
import type { AuthRequest } from '../auth';
import { getProject, isAdminUser, isProjectOwner } from '../config';
import { listMemoryPrompts, toggleMemoryPrompt } from '../memory-prompts';

const router = Router();

/** Same permission gate as `routes/agent-prompts.ts` — admin, owner, or a
 *  share with `edit` permission may toggle CLAUDE.md state. */
function resolveProjectFolder(projectId: string, username: string, res: Response): string | null {
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

// GET /api/memory/project/:projectId
// → { items: MemoryPromptItem[] }
router.get('/project/:projectId', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;
  res.json({ items: listMemoryPrompts(folder) });
});

// POST /api/memory/project/:projectId/toggle  body: { filename, action }
router.post('/project/:projectId/toggle', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;
  const { filename, action } = (req.body ?? {}) as { filename?: unknown; action?: unknown };
  if (typeof filename !== 'string' || !filename) {
    res.status(400).json({ error: 'filename is required' });
    return;
  }
  if (action !== 'insert' && action !== 'remove') {
    res.status(400).json({ error: 'action must be "insert" or "remove"' });
    return;
  }
  const result = toggleMemoryPrompt(folder, filename, action);
  res.json(result);
});

export default router;
