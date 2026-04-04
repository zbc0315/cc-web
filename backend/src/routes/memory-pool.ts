import { Router, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AuthRequest } from '../auth';
import { getProject, isAdminUser, isProjectOwner, atomicWriteSync } from '../config';
import { generateSpecMd, generateQuickRefMd, generateClaudeMdBlock } from '../memory-pool/templates';
import {
  readPool,
  writePool,
  readBallContent,
  enrichBallsWithBuoyancy,
  generateSnapshot,
  migrateV1toV2,
  needsUpgrade,
  isInitialized,
} from '../memory-pool/pool-manager';
import { PoolJson } from '../memory-pool/types';

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

  if (!isInitialized(poolDir)) {
    res.json({ initialized: false });
    return;
  }

  // Try v2 format first
  const pool = readPool(poolDir);
  if (pool) {
    res.json({
      initialized: true,
      needsUpgrade: false,
      state: {
        version: pool.version,
        t: pool.t,
        lambda: pool.lambda,
        alpha: pool.alpha,
        active_capacity: pool.active_capacity,
        next_id: pool.next_id,
        pool: pool.pool,
        initialized_at: pool.initialized_at,
      },
      ballCount: pool.balls.length,
    });
    return;
  }

  // Fall back to v1 format
  const stateFile = path.join(poolDir, 'state.json');
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    const ballsDir = path.join(poolDir, 'balls');
    let ballCount = 0;
    try {
      ballCount = fs.readdirSync(ballsDir).filter(f => f.endsWith('.md')).length;
    } catch { /* empty */ }
    res.json({ initialized: true, needsUpgrade: true, state, ballCount });
  } catch {
    res.json({ initialized: false });
  }
});

// POST /api/memory-pool/:projectId/init
router.post('/:projectId/init', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const poolDir = path.join(folder, MEMORY_POOL_DIR);
  if (isInitialized(poolDir)) {
    res.status(409).json({ error: 'Memory pool already initialized' });
    return;
  }

  // Create directory structure
  fs.mkdirSync(path.join(poolDir, 'balls'), { recursive: true });

  // Generate documents
  atomicWriteSync(path.join(poolDir, 'SPEC.md'), generateSpecMd());
  atomicWriteSync(path.join(poolDir, 'QUICK-REF.md'), generateQuickRefMd());

  // Create pool.json (v2 format directly)
  const now = new Date().toISOString();
  const pool: PoolJson = {
    version: 2,
    t: 0,
    lambda: 0.97,
    alpha: 1.0,
    active_capacity: 20,
    next_id: 1,
    pool: 'project',
    initialized_at: now,
    balls: [],
  };
  writePool(poolDir, pool);

  // Append to CLAUDE.md if marker not present
  const claudeMdPath = path.join(folder, 'CLAUDE.md');
  try {
    const existing = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, 'utf-8') : '';
    if (!existing.includes(CLAUDE_MD_MARKER)) {
      const block = generateClaudeMdBlock();
      atomicWriteSync(claudeMdPath, existing + '\n' + block);
    }
  } catch {
    // Non-fatal
  }

  res.json({ success: true });
});

// POST /api/memory-pool/:projectId/upgrade
router.post('/:projectId/upgrade', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const poolDir = path.join(folder, MEMORY_POOL_DIR);

  if (!isInitialized(poolDir)) {
    res.status(404).json({ error: 'Memory pool not initialized' });
    return;
  }

  try {
    const allChanges: string[] = [];

    // Step 1: Migrate data format (v1 → v2)
    if (needsUpgrade(poolDir)) {
      const { changes } = migrateV1toV2(poolDir);
      allChanges.push(...changes);
    }

    // Step 2: Regenerate documentation files (always update to latest templates)
    const pool = readPool(poolDir);
    if (pool) {
      atomicWriteSync(path.join(poolDir, 'SPEC.md'), generateSpecMd());
      atomicWriteSync(path.join(poolDir, 'QUICK-REF.md'), generateQuickRefMd());
      allChanges.push('updated SPEC.md and QUICK-REF.md');

      // Step 3: Update CLAUDE.md block
      const claudeMdPath = path.join(folder, 'CLAUDE.md');
      try {
        if (fs.existsSync(claudeMdPath)) {
          let content = fs.readFileSync(claudeMdPath, 'utf-8');
          const markerIdx = content.indexOf(CLAUDE_MD_MARKER);
          if (markerIdx !== -1) {
            const afterMarker = content.slice(markerIdx + CLAUDE_MD_MARKER.length);
            const nextSection = afterMarker.search(/\n## /);
            const before = content.slice(0, markerIdx);
            const after = nextSection !== -1 ? afterMarker.slice(nextSection) : '';
            content = before + generateClaudeMdBlock() + after;
          } else {
            content += '\n' + generateClaudeMdBlock();
          }
          atomicWriteSync(claudeMdPath, content);
          allChanges.push('updated CLAUDE.md memory pool section');
        }
      } catch {
        // Non-fatal
      }

      res.json({ success: true, version: pool.version, changes: allChanges });
    } else {
      res.status(500).json({ error: 'Failed to read pool after migration' });
    }
  } catch (err: any) {
    res.status(500).json({ error: 'Upgrade failed: ' + (err.message || err) });
  }
});

// GET /api/memory-pool/:projectId/index
router.get('/:projectId/index', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const poolDir = path.join(folder, MEMORY_POOL_DIR);

  // Try v2 format
  const pool = readPool(poolDir);
  if (pool) {
    const balls = enrichBallsWithBuoyancy(pool);
    res.json({ t: pool.t, updated_at: new Date().toISOString(), balls });
    return;
  }

  // Fall back to v1 format (read index.json directly)
  const indexFile = path.join(poolDir, 'index.json');
  try {
    const data = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
    res.json(data);
  } catch {
    res.status(404).json({ error: 'Memory pool not initialized' });
  }
});

// GET /api/memory-pool/:projectId/snapshot
router.get('/:projectId/snapshot', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const poolDir = path.join(folder, MEMORY_POOL_DIR);
  const pool = readPool(poolDir);
  if (!pool) {
    res.status(404).json({ error: 'Memory pool not initialized or needs upgrade' });
    return;
  }

  const cap = pool.active_capacity;
  const ballCount = pool.balls.length;
  const snapshot = generateSnapshot(pool);

  res.json({
    snapshot,
    t: pool.t,
    activeCount: Math.min(ballCount, cap),
    deepCount: Math.max(0, ballCount - cap),
  });
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

  const poolDir = path.join(folder, MEMORY_POOL_DIR);
  const content = readBallContent(poolDir, ballId);
  if (content === null) {
    res.status(404).json({ error: 'Ball not found' });
    return;
  }

  res.json({ id: ballId, content });
});

export default router;
