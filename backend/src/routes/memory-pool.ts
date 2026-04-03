import { Router, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AuthRequest } from '../auth';
import { getProject, isAdminUser, isProjectOwner, atomicWriteSync } from '../config';
import { generateSpecMd, generateQuickRefMd, generateClaudeMdBlock } from '../memory-pool/templates';

const router = Router();

const BALL_ID_RE = /^ball_\d{1,6}$/;
const MEMORY_POOL_DIR = '.memory-pool';
const CLAUDE_MD_MARKER = '## 记忆池（Memory Pool）';

function resolveProjectFolder(projectId: string, username: string, res: Response): string | null {
  const project = getProject(projectId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return null; }
  if (!isAdminUser(username) && !isProjectOwner(project, username) &&
      !project.shares?.some((s: { username: string; permission: string }) => s.username === username && s.permission === 'edit')) {
    res.status(403).json({ error: 'Access denied' }); return null;
  }
  return project.folderPath;
}

// GET /api/memory-pool/:projectId/status
router.get('/:projectId/status', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const poolDir = path.join(folder, MEMORY_POOL_DIR);
  const stateFile = path.join(poolDir, 'state.json');

  if (!fs.existsSync(stateFile)) {
    res.json({ initialized: false });
    return;
  }

  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    const ballsDir = path.join(poolDir, 'balls');
    let ballCount = 0;
    try {
      ballCount = fs.readdirSync(ballsDir).filter(f => f.endsWith('.md')).length;
    } catch { /* empty */ }
    res.json({ initialized: true, state, ballCount });
  } catch {
    res.json({ initialized: false });
  }
});

// POST /api/memory-pool/:projectId/init
router.post('/:projectId/init', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const poolDir = path.join(folder, MEMORY_POOL_DIR);
  if (fs.existsSync(path.join(poolDir, 'state.json'))) {
    res.status(409).json({ error: 'Memory pool already initialized' });
    return;
  }

  // Create directory structure
  fs.mkdirSync(path.join(poolDir, 'balls'), { recursive: true });

  // Generate documents
  atomicWriteSync(path.join(poolDir, 'SPEC.md'), generateSpecMd());
  atomicWriteSync(path.join(poolDir, 'QUICK-REF.md'), generateQuickRefMd());

  const now = new Date().toISOString();
  const state = {
    t: 0,
    lambda: 0.97,
    alpha: 1.0,
    active_capacity: 20,
    next_id: 1,
    pool: 'project',
    initialized_at: now,
  };
  atomicWriteSync(path.join(poolDir, 'state.json'), JSON.stringify(state, null, 2));

  const index = { t: 0, updated_at: now, balls: [] as unknown[] };
  atomicWriteSync(path.join(poolDir, 'index.json'), JSON.stringify(index, null, 2));

  // Append to CLAUDE.md if marker not present
  const claudeMdPath = path.join(folder, 'CLAUDE.md');
  try {
    const existing = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, 'utf-8') : '';
    if (!existing.includes(CLAUDE_MD_MARKER)) {
      const block = generateClaudeMdBlock();
      atomicWriteSync(claudeMdPath, existing + '\n' + block);
    }
  } catch {
    // Non-fatal: CLAUDE.md write failure shouldn't block init
  }

  res.json({ success: true });
});

// GET /api/memory-pool/:projectId/index
router.get('/:projectId/index', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const indexFile = path.join(folder, MEMORY_POOL_DIR, 'index.json');
  try {
    const data = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
    res.json(data);
  } catch {
    res.status(404).json({ error: 'Memory pool not initialized' });
  }
});

// GET /api/memory-pool/:projectId/ball/:ballId
router.get('/:projectId/ball/:ballId', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const { ballId } = req.params;
  if (!BALL_ID_RE.test(ballId)) {
    res.status(400).json({ error: 'Invalid ball ID format' });
    return;
  }

  const ballFile = path.join(folder, MEMORY_POOL_DIR, 'balls', `${ballId}.md`);
  try {
    const content = fs.readFileSync(ballFile, 'utf-8');
    res.json({ id: ballId, content });
  } catch {
    res.status(404).json({ error: 'Ball not found' });
  }
});

export default router;
