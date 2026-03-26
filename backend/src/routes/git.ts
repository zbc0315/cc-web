// backend/src/routes/git.ts
import { Router, Response } from 'express';
import { simpleGit } from 'simple-git';
import { AuthRequest } from '../auth';
import { getProject, isAdminUser, isProjectOwner } from '../config';
import { Project } from '../types';

const router = Router();

// Helper: validate caller has edit access to project
function canEdit(project: Project, username?: string): boolean {
  if (isAdminUser(username)) return true;
  if (isProjectOwner(project, username)) return true;
  return project.shares?.some((s) => s.username === username && s.permission === 'edit') ?? false;
}

// GET /api/projects/:id/git/status
router.get('/:id/git/status', async (req: AuthRequest, res: Response): Promise<void> => {
  const project = getProject(req.params.id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  if (!canEdit(project, req.user?.username)) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const git = simpleGit(project.folderPath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) { res.json({ isRepo: false }); return; }

    const status = await git.status();
    res.json({
      isRepo: true,
      branch: status.current,
      staged: status.staged,
      modified: status.modified,
      untracked: status.not_added,
      deleted: status.deleted,
      ahead: status.ahead,
      behind: status.behind,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/projects/:id/git/diff?file=<path>
router.get('/:id/git/diff', async (req: AuthRequest, res: Response): Promise<void> => {
  const project = getProject(req.params.id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  if (!canEdit(project, req.user?.username)) { res.status(403).json({ error: 'Forbidden' }); return; }

  const fileParam = typeof req.query.file === 'string' ? req.query.file : undefined;

  try {
    const git = simpleGit(project.folderPath);
    const diff = fileParam ? await git.diff([fileParam]) : await git.diff();
    res.json({ diff });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/projects/:id/git/add   body: { files: string[] }
router.post('/:id/git/add', async (req: AuthRequest, res: Response): Promise<void> => {
  const project = getProject(req.params.id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  if (!canEdit(project, req.user?.username)) { res.status(403).json({ error: 'Forbidden' }); return; }

  const { files } = req.body as { files?: unknown };
  if (!Array.isArray(files) || files.length === 0 || !files.every((f) => typeof f === 'string')) {
    res.status(400).json({ error: 'files must be a non-empty string array' }); return;
  }

  try {
    const git = simpleGit(project.folderPath);
    await git.add(files as string[]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/projects/:id/git/commit   body: { message: string }
router.post('/:id/git/commit', async (req: AuthRequest, res: Response): Promise<void> => {
  const project = getProject(req.params.id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  if (!canEdit(project, req.user?.username)) { res.status(403).json({ error: 'Forbidden' }); return; }

  const { message } = req.body as { message?: unknown };
  if (typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'commit message required' }); return;
  }

  try {
    const git = simpleGit(project.folderPath);
    const result = await git.commit(message.trim());
    res.json({ ok: true, commit: result.commit });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
