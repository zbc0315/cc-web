import { Router, Response } from 'express';
import type { AuthRequest } from '../auth';
import { getProject, isAdminUser, isProjectOwner } from '../config';
import { listMemoryPrompts, toggleMemoryPrompt } from '../memory-prompts';
import { instructionsFilename } from '../agent-prompts';
import type { CliTool } from '../types';

const router = Router();

/** Same permission gate as `routes/agent-prompts.ts` — admin, owner, or a
 *  share with `edit` permission may toggle the project's instructions file. */
function resolveProject(
  projectId: string,
  username: string,
  res: Response,
): { folderPath: string; cliTool?: CliTool } | null {
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
  return { folderPath: project.folderPath, cliTool: project.cliTool };
}

// GET /api/memory/project/:projectId
// → { items, claudeMdLineCount, instructionsFilename }
router.get('/project/:projectId', (req: AuthRequest, res: Response): void => {
  const p = resolveProject(req.params.projectId, req.user?.username || '', res);
  if (!p) return;
  const result = listMemoryPrompts(p.folderPath, p.cliTool);
  res.json({ ...result, instructionsFilename: instructionsFilename(p.cliTool) });
});

// POST /api/memory/project/:projectId/toggle  body: { filename, action }
router.post('/project/:projectId/toggle', (req: AuthRequest, res: Response): void => {
  const p = resolveProject(req.params.projectId, req.user?.username || '', res);
  if (!p) return;
  const { filename, action } = (req.body ?? {}) as { filename?: unknown; action?: unknown };
  if (typeof filename !== 'string' || !filename) {
    res.status(400).json({ error: 'filename is required' });
    return;
  }
  if (action !== 'insert' && action !== 'remove') {
    res.status(400).json({ error: 'action must be "insert" or "remove"' });
    return;
  }
  const result = toggleMemoryPrompt(p.folderPath, filename, action, p.cliTool);
  res.json({ ...result, instructionsFilename: instructionsFilename(p.cliTool) });
});

export default router;
