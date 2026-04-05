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
  writeBallContent,
  enrichBallsWithBuoyancy,
  generateSnapshot,
  migrateV1toV2,
  needsUpgrade,
  isInitialized,
  buildSurface,
  estimateTokens,
  computeDiameter,
  tickPool,
} from '../memory-pool/pool-manager';
import { PoolJson, PoolBallMeta } from '../memory-pool/types';
import { computeBuoyancy } from '../memory-pool/buoyancy';
import { withPoolLock } from '../memory-pool/pool-lock';
import {
  getGlobalPoolDir,
  isGlobalPoolInitialized,
  readGlobalPool,
  readSources,
  registerProject,
  removeSource,
  syncToGlobal,
  computeGlobalT,
} from '../memory-pool/global-pool-manager';

const router = Router();

const BALL_ID_RE = /^ball_\d{1,6}$/;
const VALID_TYPES = ['feedback', 'user', 'project', 'reference'];
const DEFAULT_B0: Record<string, number> = { feedback: 9, user: 6, project: 5, reference: 3 };
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

function validateBallIds(ids: unknown[]): boolean {
  return ids.every((id) => typeof id === 'string' && BALL_ID_RE.test(id));
}

// ══════════════════════════════════════════════════════════════════════════════
// Global Memory Pool Endpoints (MUST be before /:projectId routes)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/memory-pool/global/status
router.get('/global/status', (_req: AuthRequest, res: Response): void => {
  if (!isGlobalPoolInitialized()) {
    res.json({ initialized: false });
    return;
  }
  const pool = readGlobalPool();
  if (!pool) {
    res.json({ initialized: false });
    return;
  }
  const sources = readSources();
  const freshT = computeGlobalT(pool.initialized_at);
  res.json({
    initialized: true,
    state: {
      version: pool.version,
      t: freshT,
      lambda: pool.lambda,
      alpha: pool.alpha,
      active_capacity: pool.active_capacity,
      surface_width: pool.surface_width ?? 10000,
      next_id: pool.next_id,
      pool: pool.pool,
      initialized_at: pool.initialized_at,
    },
    ballCount: pool.balls.length,
    sourceCount: sources.sources.filter((s) => s.status === 'active').length,
    activeBalls: Math.min(pool.balls.length, pool.active_capacity),
  });
});

// GET /api/memory-pool/global/index
router.get('/global/index', (_req: AuthRequest, res: Response): void => {
  const pool = readGlobalPool();
  if (!pool) {
    res.status(404).json({ error: 'Global pool not initialized' });
    return;
  }
  pool.t = computeGlobalT(pool.initialized_at);
  const balls = enrichBallsWithBuoyancy(pool);
  res.json({ t: pool.t, updated_at: new Date().toISOString(), balls, active_capacity: pool.active_capacity });
});

// GET /api/memory-pool/global/surface
router.get('/global/surface', (_req: AuthRequest, res: Response): void => {
  const globalDir = getGlobalPoolDir();
  withPoolLock(globalDir, () => {
    const pool = readGlobalPool();
    if (!pool) {
      res.status(404).json({ error: 'Global pool not initialized' });
      return;
    }
    const freshT = computeGlobalT(pool.initialized_at);
    if (pool.t !== freshT) {
      pool.t = freshT;
      writePool(globalDir, pool);
    }
    const { surfaceBalls, totalTokens } = buildSurface(globalDir);
    res.json({
      t: pool.t,
      surface_width: pool.surface_width ?? 10000,
      used_tokens: totalTokens,
      balls: surfaceBalls,
    });
  }).catch((err: any) => {
    if (!res.headersSent) res.status(500).json({ error: err.message || err });
  });
});

// GET /api/memory-pool/global/ball/:ballId (pure read, no side effect)
router.get('/global/ball/:ballId', (req: AuthRequest, res: Response): void => {
  const { ballId } = req.params;
  if (!BALL_ID_RE.test(ballId)) {
    res.status(400).json({ error: 'Invalid ball ID format' });
    return;
  }
  const content = readBallContent(getGlobalPoolDir(), ballId);
  if (content === null) {
    res.status(404).json({ error: 'Ball not found' });
    return;
  }
  res.json({ id: ballId, content });
});

// POST /api/memory-pool/global/balls/:ballId/hit
router.post('/global/balls/:ballId/hit', (req: AuthRequest, res: Response): void => {
  const { ballId } = req.params;
  if (!BALL_ID_RE.test(ballId)) {
    res.status(400).json({ error: 'Invalid ball ID format' });
    return;
  }
  const globalDir = getGlobalPoolDir();
  withPoolLock(globalDir, () => {
    const pool = readGlobalPool();
    if (!pool) { res.status(404).json({ error: 'Global pool not initialized' }); return; }
    pool.t = computeGlobalT(pool.initialized_at);

    const ball = pool.balls.find((b) => b.id === ballId);
    if (!ball) { res.status(404).json({ error: 'Ball not found' }); return; }

    ball.H += 1;
    ball.t_last = pool.t;
    writePool(globalDir, pool);

    const content = readBallContent(globalDir, ballId);
    const buoy = computeBuoyancy(ball.B0, ball.H, pool.alpha, pool.lambda, pool.t, ball.t_last, ball.permanent);
    const linkedBalls = ball.links
      .map((lid) => pool.balls.find((b) => b.id === lid))
      .filter((b): b is PoolBallMeta => !!b)
      .map((b) => ({
        id: b.id,
        type: b.type,
        summary: b.summary,
        buoyancy: computeBuoyancy(b.B0, b.H, pool.alpha, pool.lambda, pool.t, b.t_last, b.permanent),
      }));

    res.json({ id: ballId, content, buoyancy: buoy, linked_balls: linkedBalls });
  }).catch((err: any) => {
    if (!res.headersSent) res.status(500).json({ error: err.message || err });
  });
});

// GET /api/memory-pool/global/sources
router.get('/global/sources', (_req: AuthRequest, res: Response): void => {
  const sources = readSources();
  res.json(sources);
});

// DELETE /api/memory-pool/global/sources/:projectId
router.delete('/global/sources/:projectId', (req: AuthRequest, res: Response): void => {
  removeSource(req.params.projectId).then((removed) => {
    if (!removed) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }
    res.json({ success: true });
  }).catch((err: any) => {
    if (!res.headersSent) res.status(500).json({ error: err.message || err });
  });
});

// POST /api/memory-pool/global/sync
router.post('/global/sync', (_req: AuthRequest, res: Response): void => {
  syncToGlobal().then((result) => {
    res.json(result);
  }).catch((err: any) => {
    if (err.message === 'SYNC_IN_PROGRESS') {
      res.status(409).json({ error: 'Sync already in progress' });
      return;
    }
    if (!res.headersSent) res.status(500).json({ error: 'Sync failed: ' + (err.message || err) });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Project Memory Pool Endpoints
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/memory-pool/:projectId/status
router.get('/:projectId/status', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const poolDir = path.join(folder, MEMORY_POOL_DIR);

  if (!isInitialized(poolDir)) {
    res.json({ initialized: false });
    return;
  }

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
        surface_width: pool.surface_width ?? 10000,
        next_id: pool.next_id,
        pool: pool.pool,
        initialized_at: pool.initialized_at,
      },
      ballCount: pool.balls.length,
    });
    return;
  }

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
  withPoolLock(poolDir, async () => {
    if (isInitialized(poolDir)) {
      res.status(409).json({ error: 'Memory pool already initialized' });
      return;
    }

    fs.mkdirSync(path.join(poolDir, 'balls'), { recursive: true });
    atomicWriteSync(path.join(poolDir, 'SPEC.md'), generateSpecMd());
    atomicWriteSync(path.join(poolDir, 'QUICK-REF.md'), generateQuickRefMd());

    const now = new Date().toISOString();
    const pool: PoolJson = {
      version: 2,
      t: 0,
      lambda: 0.97,
      alpha: 1.0,
      active_capacity: 20,
      surface_width: 10000,
      next_id: 1,
      pool: 'project',
      initialized_at: now,
      balls: [],
    };
    writePool(poolDir, pool);

    try {
      const project = getProject(req.params.projectId);
      if (project) {
        await registerProject(req.params.projectId, project.name, poolDir);
        pool.global_pool_path = getGlobalPoolDir();
        writePool(poolDir, pool);
      }
    } catch { /* non-fatal */ }

    const claudeMdPath = path.join(folder, 'CLAUDE.md');
    try {
      const existing = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, 'utf-8') : '';
      if (!existing.includes(CLAUDE_MD_MARKER)) {
        atomicWriteSync(claudeMdPath, existing + '\n' + generateClaudeMdBlock());
      }
    } catch { /* non-fatal */ }

    buildSurface(poolDir);
    res.json({ success: true });
  }).catch((err: any) => {
    if (!res.headersSent) res.status(500).json({ error: err.message || err });
  });
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

  withPoolLock(poolDir, async () => {
    const allChanges: string[] = [];

    if (needsUpgrade(poolDir)) {
      const { changes } = migrateV1toV2(poolDir);
      allChanges.push(...changes);
    }

    const pool = readPool(poolDir);
    if (pool) {
      atomicWriteSync(path.join(poolDir, 'SPEC.md'), generateSpecMd());
      atomicWriteSync(path.join(poolDir, 'QUICK-REF.md'), generateQuickRefMd());
      allChanges.push('updated SPEC.md and QUICK-REF.md');

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
      } catch { /* non-fatal */ }

      try {
        const project = getProject(req.params.projectId);
        if (project) {
          await registerProject(req.params.projectId, project.name, poolDir);
          pool.global_pool_path = getGlobalPoolDir();
          writePool(poolDir, pool);
          allChanges.push('registered with global memory pool');
        }
      } catch { /* non-fatal */ }

      buildSurface(poolDir);
      res.json({ success: true, version: pool.version, changes: allChanges });
    } else {
      res.status(500).json({ error: 'Failed to read pool after migration' });
    }
  }).catch((err: any) => {
    if (!res.headersSent) res.status(500).json({ error: 'Upgrade failed: ' + (err.message || err) });
  });
});

// GET /api/memory-pool/:projectId/index
router.get('/:projectId/index', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const poolDir = path.join(folder, MEMORY_POOL_DIR);
  const pool = readPool(poolDir);
  if (pool) {
    const balls = enrichBallsWithBuoyancy(pool);
    res.json({ t: pool.t, updated_at: new Date().toISOString(), balls, active_capacity: pool.active_capacity });
    return;
  }

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
  res.json({ snapshot, t: pool.t, activeCount: Math.min(ballCount, cap), deepCount: Math.max(0, ballCount - cap) });
});

// GET /api/memory-pool/:projectId/ball/:ballId (pure read, no side effect)
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

// PUT /api/memory-pool/:projectId/surface-width
router.put('/:projectId/surface-width', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const poolDir = path.join(folder, MEMORY_POOL_DIR);
  withPoolLock(poolDir, () => {
    const pool = readPool(poolDir);
    if (!pool) { res.status(404).json({ error: 'Memory pool not initialized' }); return; }

    const { surface_width } = req.body;
    if (typeof surface_width !== 'number' || surface_width < 1000 || surface_width > 100000) {
      res.status(400).json({ error: 'surface_width must be a number between 1000 and 100000' });
      return;
    }

    pool.surface_width = surface_width;
    writePool(poolDir, pool);
    const { surfaceBalls, totalTokens } = buildSurface(poolDir);
    res.json({ success: true, surface_width, surface_balls: surfaceBalls.length, total_tokens: totalTokens });
  }).catch((err: any) => {
    if (!res.headersSent) res.status(500).json({ error: err.message || err });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Ball CRUD Endpoints (ccweb-managed)
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/memory-pool/:projectId/balls — Create ball
router.post('/:projectId/balls', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const poolDir = path.join(folder, MEMORY_POOL_DIR);
  const { type, summary, content, links, b0_override } = req.body;

  // Validate required fields
  if (!type || !VALID_TYPES.includes(type)) {
    res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
    return;
  }
  if (!summary || typeof summary !== 'string' || summary.length > 500) {
    res.status(400).json({ error: 'summary is required and must be <= 500 characters' });
    return;
  }
  if (!content || typeof content !== 'string' || content.length > 100000) {
    res.status(400).json({ error: 'content is required and must be <= 100KB' });
    return;
  }
  if (links && (!Array.isArray(links) || !validateBallIds(links))) {
    res.status(400).json({ error: 'links must be an array of valid ball IDs' });
    return;
  }
  if (b0_override !== undefined && b0_override !== null &&
      (typeof b0_override !== 'number' || b0_override < 1 || b0_override > 10)) {
    res.status(400).json({ error: 'b0_override must be a number between 1 and 10' });
    return;
  }

  withPoolLock(poolDir, () => {
    const pool = readPool(poolDir);
    if (!pool) { res.status(404).json({ error: 'Memory pool not initialized' }); return; }

    // M-2 fix: validate that linked ball IDs exist in pool
    const validLinks: string[] = [];
    if (links) {
      const existingIds = new Set(pool.balls.map((b) => b.id));
      for (const lid of links as string[]) {
        if (!existingIds.has(lid)) {
          res.status(400).json({ error: `Linked ball ${lid} does not exist` });
          return;
        }
        validLinks.push(lid);
      }
    }

    const ballId = `ball_${String(pool.next_id).padStart(4, '0')}`;
    pool.next_id++;

    const B0 = b0_override ?? DEFAULT_B0[type] ?? 5;
    const diameter = estimateTokens(content);

    // Write ball content first (gate pattern)
    writeBallContent(poolDir, ballId, content);

    const newBall: PoolBallMeta = {
      id: ballId,
      type: type as PoolBallMeta['type'],
      summary,
      B0,
      H: 0,
      t_last: pool.t,
      hardness: 5,
      permanent: false,
      links: validLinks,
      created_at: new Date().toISOString(),
      diameter,
    };

    pool.balls.push(newBall);
    writePool(poolDir, pool);
    buildSurface(poolDir);

    res.json({ id: ballId, B0, diameter });
  }).catch((err: any) => {
    if (!res.headersSent) res.status(500).json({ error: err.message || err });
  });
});

// PUT /api/memory-pool/:projectId/balls/:ballId — Update ball metadata after content edit
router.put('/:projectId/balls/:ballId', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const { ballId } = req.params;
  if (!BALL_ID_RE.test(ballId)) {
    res.status(400).json({ error: 'Invalid ball ID format' });
    return;
  }

  const poolDir = path.join(folder, MEMORY_POOL_DIR);

  withPoolLock(poolDir, () => {
    const pool = readPool(poolDir);
    if (!pool) { res.status(404).json({ error: 'Memory pool not initialized' }); return; }

    const ball = pool.balls.find((b) => b.id === ballId);
    if (!ball) { res.status(404).json({ error: 'Ball not found in pool' }); return; }

    // Recalculate diameter from current content
    const diameter = computeDiameter(poolDir, ballId);
    ball.diameter = diameter;

    // Update summary if provided
    const { summary } = req.body;
    if (summary && typeof summary === 'string') {
      if (summary.length > 500) { res.status(400).json({ error: 'summary must be ≤ 500 characters' }); return; }
      ball.summary = summary;
    }

    writePool(poolDir, pool);
    buildSurface(poolDir);

    res.json({ id: ballId, diameter, summary: ball.summary });
  }).catch((err: any) => {
    if (!res.headersSent) res.status(500).json({ error: err.message || err });
  });
});

// POST /api/memory-pool/:projectId/balls/:ballId/hit — Hit query (read + count)
router.post('/:projectId/balls/:ballId/hit', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const { ballId } = req.params;
  if (!BALL_ID_RE.test(ballId)) {
    res.status(400).json({ error: 'Invalid ball ID format' });
    return;
  }

  const poolDir = path.join(folder, MEMORY_POOL_DIR);

  withPoolLock(poolDir, () => {
    const pool = readPool(poolDir);
    if (!pool) { res.status(404).json({ error: 'Memory pool not initialized' }); return; }

    const ball = pool.balls.find((b) => b.id === ballId);
    if (!ball) { res.status(404).json({ error: 'Ball not found' }); return; }

    // Update hit count
    ball.H += 1;
    ball.t_last = pool.t;
    writePool(poolDir, pool);
    // Skip surface rebuild for hit — H change rarely affects surface order

    // Read content
    const content = readBallContent(poolDir, ballId);
    const buoy = computeBuoyancy(ball.B0, ball.H, pool.alpha, pool.lambda, pool.t, ball.t_last, ball.permanent);

    // Read linked balls' summaries
    const linkedBalls = ball.links
      .map((lid) => pool.balls.find((b) => b.id === lid))
      .filter((b): b is PoolBallMeta => !!b)
      .map((b) => ({
        id: b.id,
        type: b.type,
        summary: b.summary,
        buoyancy: computeBuoyancy(b.B0, b.H, pool.alpha, pool.lambda, pool.t, b.t_last, b.permanent),
      }));

    res.json({ id: ballId, content, buoyancy: buoy, linked_balls: linkedBalls });
  }).catch((err: any) => {
    if (!res.headersSent) res.status(500).json({ error: err.message || err });
  });
});

// DELETE /api/memory-pool/:projectId/balls/:ballId — Delete ball
router.delete('/:projectId/balls/:ballId', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const { ballId } = req.params;
  if (!BALL_ID_RE.test(ballId)) {
    res.status(400).json({ error: 'Invalid ball ID format' });
    return;
  }

  const poolDir = path.join(folder, MEMORY_POOL_DIR);

  withPoolLock(poolDir, () => {
    const pool = readPool(poolDir);
    if (!pool) { res.status(404).json({ error: 'Memory pool not initialized' }); return; }

    const idx = pool.balls.findIndex((b) => b.id === ballId);
    if (idx === -1) { res.status(404).json({ error: 'Ball not found' }); return; }

    // Remove from balls array
    pool.balls.splice(idx, 1);

    // Clean up links in other balls that reference this ball
    let linksCleaned = 0;
    for (const b of pool.balls) {
      const before = b.links.length;
      b.links = b.links.filter((l) => l !== ballId);
      linksCleaned += before - b.links.length;
    }

    writePool(poolDir, pool);

    // Delete ball file
    const ballFile = path.join(poolDir, 'balls', `${ballId}.md`);
    try { fs.unlinkSync(ballFile); } catch { /* may not exist */ }

    buildSurface(poolDir);
    res.json({ id: ballId, deleted: true, links_cleaned: linksCleaned });
  }).catch((err: any) => {
    if (!res.headersSent) res.status(500).json({ error: err.message || err });
  });
});

// PATCH /api/memory-pool/:projectId/balls/:ballId/links — Manage links
router.patch('/:projectId/balls/:ballId/links', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const { ballId } = req.params;
  if (!BALL_ID_RE.test(ballId)) {
    res.status(400).json({ error: 'Invalid ball ID format' });
    return;
  }

  const poolDir = path.join(folder, MEMORY_POOL_DIR);
  const { add, remove } = req.body;

  if (add && (!Array.isArray(add) || !validateBallIds(add))) {
    res.status(400).json({ error: 'add must be an array of valid ball IDs' });
    return;
  }
  if (remove && (!Array.isArray(remove) || !validateBallIds(remove))) {
    res.status(400).json({ error: 'remove must be an array of valid ball IDs' });
    return;
  }

  withPoolLock(poolDir, () => {
    const pool = readPool(poolDir);
    if (!pool) { res.status(404).json({ error: 'Memory pool not initialized' }); return; }

    const ball = pool.balls.find((b) => b.id === ballId);
    if (!ball) { res.status(404).json({ error: 'Ball not found' }); return; }

    const existingIds = new Set(pool.balls.map((b) => b.id));

    if (remove) {
      const removeSet = new Set(remove as string[]);
      ball.links = ball.links.filter((l) => !removeSet.has(l));
    }
    if (add) {
      for (const lid of add as string[]) {
        if (existingIds.has(lid) && !ball.links.includes(lid) && lid !== ballId) {
          ball.links.push(lid);
        }
      }
    }

    writePool(poolDir, pool);
    buildSurface(poolDir);
    res.json({ id: ballId, links: ball.links });
  }).catch((err: any) => {
    if (!res.headersSent) res.status(500).json({ error: err.message || err });
  });
});

// POST /api/memory-pool/:projectId/tick — Increment turn
router.post('/:projectId/tick', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const poolDir = path.join(folder, MEMORY_POOL_DIR);
  const { session } = req.body || {};

  withPoolLock(poolDir, () => {
    const result = tickPool(poolDir, session);
    if (!result) { res.status(404).json({ error: 'Memory pool not initialized' }); return; }
    res.json(result);
  }).catch((err: any) => {
    if (!res.headersSent) res.status(500).json({ error: err.message || err });
  });
});

// GET /api/memory-pool/:projectId/surface — Get active layer summary
router.get('/:projectId/surface', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const poolDir = path.join(folder, MEMORY_POOL_DIR);
  withPoolLock(poolDir, () => {
    const pool = readPool(poolDir);
    if (!pool) {
      res.status(404).json({ error: 'Memory pool not initialized' });
      return;
    }

    // Compensate missed tick if last_tick_at > 10 minutes ago.
    // Uses a special session marker so the next Stop hook tick won't be deduped —
    // the compensate tick covers the *previous* stale gap, Stop hook covers *this* session.
    if (pool.last_tick_at) {
      const elapsed = Date.now() - new Date(pool.last_tick_at).getTime();
      if (elapsed > 10 * 60 * 1000) {
        pool.t += 1;
        pool.last_tick_at = new Date().toISOString();
        pool.last_tick_session = '__surface_compensate__';
        writePool(poolDir, pool);
      }
    }

    const { surfaceBalls, totalTokens } = buildSurface(poolDir);
    res.json({
      t: pool.t,
      surface_width: pool.surface_width ?? 10000,
      used_tokens: totalTokens,
      balls: surfaceBalls,
    });
  }).catch((err: any) => {
    if (!res.headersSent) res.status(500).json({ error: err.message || err });
  });
});

// POST /api/memory-pool/:projectId/maintenance — Maintenance suggestions + self-healing
router.post('/:projectId/maintenance', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const poolDir = path.join(folder, MEMORY_POOL_DIR);
  const pool = readPool(poolDir);
  if (!pool) {
    res.status(404).json({ error: 'Memory pool not initialized' });
    return;
  }

  const enriched = enrichBallsWithBuoyancy(pool);
  const cap = pool.active_capacity;
  const activeFull = enriched.length >= cap;

  // Split suggestions: all active layer balls, mark recommended based on hardness + size
  const suggestions: Array<{ action: string; ball_id: string; reason: string; recommended: boolean }> = [];
  const activeBalls = enriched.slice(0, cap);
  for (const b of activeBalls) {
    const diameter = b.diameter ?? computeDiameter(poolDir, b.id);
    if (diameter > 100) {
      const recommended = b.hardness < 7;
      suggestions.push({
        action: 'split',
        ball_id: b.id,
        reason: `diameter=${diameter}tok, hardness=${b.hardness}${recommended ? ' — 可考虑拆分' : ' — 硬度过高，不建议拆分'}`,
        recommended,
      });
    }
  }

  // Self-healing: detect inconsistencies (H-4 fix)
  const anomalies: string[] = [];
  const ballsDir = path.join(poolDir, 'balls');

  // Check for ghost entries (pool.json has ball but file missing)
  for (const b of pool.balls) {
    const file = path.join(ballsDir, `${b.id}.md`);
    if (!fs.existsSync(file)) {
      anomalies.push(`ghost: ${b.id} in pool.json but file missing`);
    }
  }

  // Check for orphan files (file exists but not in pool.json)
  try {
    const poolIds = new Set(pool.balls.map((b) => b.id));
    const files = fs.readdirSync(ballsDir).filter((f) => f.endsWith('.md') && f.startsWith('ball_'));
    for (const f of files) {
      const id = f.replace('.md', '');
      if (!poolIds.has(id)) {
        anomalies.push(`orphan_file: ${f} exists but not in pool.json`);
      }
    }
  } catch { /* balls dir may not exist */ }

  res.json({ active_full: activeFull, suggestions, anomalies });
});

export default router;
