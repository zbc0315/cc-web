// backend/src/memory-pool/pool-manager.ts

import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteSync } from '../config';
import { PoolJson, PoolBallMeta, PoolBallWithBuoyancy } from './types';
import { computeBuoyancy } from './buoyancy';

const POOL_FILE = 'pool.json';
const BALLS_DIR = 'balls';
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export function readPool(poolDir: string): PoolJson | null {
  const file = path.join(poolDir, POOL_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export function writePool(poolDir: string, pool: PoolJson): void {
  atomicWriteSync(path.join(poolDir, POOL_FILE), JSON.stringify(pool, null, 2));
}

export function readBallContent(poolDir: string, ballId: string): string | null {
  const file = path.join(poolDir, BALLS_DIR, `${ballId}.md`);
  if (!fs.existsSync(file)) return null;
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
}

export function writeBallContent(poolDir: string, ballId: string, content: string): void {
  const dir = path.join(poolDir, BALLS_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  atomicWriteSync(path.join(dir, `${ballId}.md`), content);
}

export function enrichBallsWithBuoyancy(pool: PoolJson): PoolBallWithBuoyancy[] {
  const { lambda, alpha, t } = pool;
  return pool.balls
    .map((ball) => ({
      ...ball,
      buoyancy: computeBuoyancy(ball.B0, ball.H, alpha, lambda, t, ball.t_last, ball.permanent),
    }))
    .sort((a, b) => b.buoyancy - a.buoyancy);
}

export function generateSnapshot(pool: PoolJson): string {
  const balls = enrichBallsWithBuoyancy(pool);
  const cap = pool.active_capacity;
  const active = balls.slice(0, cap);
  const deep = balls.slice(cap);

  const lines: string[] = [`## Memory Pool Snapshot (t=${pool.t})`, '### Active (sorted by buoyancy)'];
  active.forEach((b, i) => {
    const perm = b.permanent ? ', permanent' : '';
    lines.push(`${i + 1}. [${b.type}] ${b.summary} (B=${b.buoyancy.toFixed(1)}${perm})`);
  });

  if (deep.length > 0) {
    const lowest = deep[deep.length - 1].buoyancy;
    lines.push(`### Deep (${deep.length} balls, lowest B=${lowest.toFixed(2)})`);
  }

  return lines.join('\n');
}

// ── Surface builder ──

/**
 * Estimate token count from text content (rough: ~4 chars per token for mixed CJK/EN).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface SurfaceBall {
  id: string;
  type: string;
  summary: string;
  buoyancy: number;
  diameter: number; // estimated tokens
  links: string[];
}

/**
 * Build surface.md — the set of top-buoyancy balls whose total token diameter
 * fits within the wedge top width (surface_width). Writes surface.md to poolDir.
 * MUST be called within withPoolLock when pool.json may be concurrently modified.
 */
export function buildSurface(poolDir: string): { surfaceBalls: SurfaceBall[]; totalTokens: number } {
  const pool = readPool(poolDir);
  if (!pool) return { surfaceBalls: [], totalTokens: 0 };

  const surfaceWidth = pool.surface_width ?? 10000;
  const enriched = enrichBallsWithBuoyancy(pool);

  const surfaceBalls: SurfaceBall[] = [];
  let totalTokens = 0;

  for (const ball of enriched) {
    // Use cached diameter if available, otherwise read and estimate
    let diameter = ball.diameter ?? 0;
    if (!diameter) {
      const content = readBallContent(poolDir, ball.id);
      diameter = content ? estimateTokens(content) : 0;
    }

    // M-1 fix: skip ghost entries (pool.json has ball but file missing → diameter=0)
    if (diameter === 0) continue;

    if (totalTokens + diameter > surfaceWidth && surfaceBalls.length > 0) {
      break; // Surface full — but always include at least 1 ball
    }

    surfaceBalls.push({
      id: ball.id,
      type: ball.type,
      summary: ball.summary,
      buoyancy: ball.buoyancy,
      diameter,
      links: ball.links,
    });
    totalTokens += diameter;
  }

  // Write surface.md
  const lines: string[] = [
    `# Memory Pool Surface`,
    ``,
    `> t=${pool.t} | surface_width=${surfaceWidth} | used≈${totalTokens} tokens | ${surfaceBalls.length}/${pool.balls.length} balls`,
    ``,
  ];

  for (const b of surfaceBalls) {
    const linksStr = b.links.length > 0 ? ` → links: ${b.links.join(', ')}` : '';
    lines.push(`- **[${b.type}]** ${b.summary} — \`${b.id}\` (B=${b.buoyancy.toFixed(1)}, ~${b.diameter}tok${linksStr})`);
  }

  lines.push('', `读取内容: \`.memory-pool/balls/{id}.md\``, `探索关系: 通过 links 字段读取关联球`);

  atomicWriteSync(path.join(poolDir, 'surface.md'), lines.join('\n'));

  return { surfaceBalls, totalTokens };
}

/**
 * Compute and cache the diameter (token estimate) for a ball.
 */
export function computeDiameter(poolDir: string, ballId: string): number {
  const content = readBallContent(poolDir, ballId);
  return content ? estimateTokens(content) : 0;
}

/**
 * Tick the pool: increment t with session-based dedup.
 * Returns { t, deduplicated } or null if pool not found.
 * MUST be called within withPoolLock to prevent concurrent read-modify-write races.
 */
export function tickPool(poolDir: string, session?: string): { t: number; deduplicated: boolean } | null {
  const pool = readPool(poolDir);
  if (!pool) return null;

  // Session-based dedup: same session won't tick twice
  if (session && pool.last_tick_session === session) {
    return { t: pool.t, deduplicated: true };
  }

  pool.t += 1;
  pool.last_tick_at = new Date().toISOString();
  if (session) pool.last_tick_session = session;
  writePool(poolDir, pool);
  buildSurface(poolDir);
  return { t: pool.t, deduplicated: false };
}

/**
 * Migrate from v1 (state.json + index.json + frontmatter balls) to v2 (pool.json + pure content balls).
 * Idempotent: if pool.json already exists with version >= 2, returns empty changes.
 */
export function migrateV1toV2(poolDir: string): { changes: string[] } {
  const changes: string[] = [];

  // Check if already migrated
  const existing = readPool(poolDir);
  if (existing && existing.version >= 2) return { changes };

  // Read old state.json
  const stateFile = path.join(poolDir, 'state.json');
  if (!fs.existsSync(stateFile)) return { changes: ['no state.json found, skipping'] };
  let state: any;
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  } catch (e: any) {
    throw new Error('state.json is corrupt: ' + (e.message || e));
  }

  // Read old index.json
  const indexFile = path.join(poolDir, 'index.json');
  let oldBalls: any[] = [];
  if (fs.existsSync(indexFile)) {
    try {
      const idx = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
      oldBalls = idx.balls || [];
    } catch { /* empty */ }
  }

  // Build ball metadata from index.json entries, enriching with frontmatter data where available
  const ballsMeta: PoolBallMeta[] = oldBalls.map((b: any) => {
    // Try to read created_at from ball frontmatter
    let created_at = new Date().toISOString();
    const ballFile = path.join(poolDir, BALLS_DIR, `${b.id}.md`);
    if (fs.existsSync(ballFile)) {
      const raw = fs.readFileSync(ballFile, 'utf-8');
      const match = raw.match(/created_at:\s*"?([^"\n]+)"?/);
      if (match) created_at = match[1].trim();
    }

    return {
      id: b.id,
      type: b.type || 'project',
      summary: b.summary || '',
      B0: b.B0 ?? 5,
      H: b.H ?? 0,
      t_last: b.t_last ?? 0,
      hardness: b.hardness ?? 5,
      permanent: false,
      links: b.links || [],
      created_at,
    };
  });

  // Strip frontmatter from ball files FIRST (before writing pool.json as the v2 gate)
  const ballsDir = path.join(poolDir, BALLS_DIR);
  if (fs.existsSync(ballsDir)) {
    const files = fs.readdirSync(ballsDir).filter((f) => f.endsWith('.md'));
    let stripped = 0;
    for (const file of files) {
      try {
        const filePath = path.join(ballsDir, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        if (raw.startsWith('---')) {
          const clean = raw.replace(FRONTMATTER_RE, '').trimStart();
          atomicWriteSync(filePath, clean);
          stripped++;
        }
      } catch (e: any) {
        changes.push(`warning: failed to strip frontmatter from ${file}: ${e.message}`);
      }
    }
    if (stripped > 0) changes.push(`stripped frontmatter from ${stripped} ball files`);
  }

  // Write pool.json LAST — this is the v2 gate, so partial migration can be retried
  const pool: PoolJson = {
    version: 2,
    t: state.t ?? 0,
    lambda: state.lambda ?? 0.97,
    alpha: state.alpha ?? 1.0,
    active_capacity: state.active_capacity ?? 20,
    surface_width: state.surface_width ?? 10000,
    next_id: state.next_id ?? 1,
    pool: state.pool ?? 'project',
    initialized_at: state.initialized_at ?? new Date().toISOString(),
    balls: ballsMeta,
  };
  writePool(poolDir, pool);
  changes.push(`created pool.json with ${ballsMeta.length} balls`);

  // Backup old files (rename, not delete)
  try {
    fs.renameSync(stateFile, stateFile + '.v1bak');
    changes.push('backed up state.json → state.json.v1bak');
  } catch { /* non-fatal */ }
  if (fs.existsSync(indexFile)) {
    try {
      fs.renameSync(indexFile, indexFile + '.v1bak');
      changes.push('backed up index.json → index.json.v1bak');
    } catch { /* non-fatal */ }
  }

  return { changes };
}

/**
 * Check if pool directory uses v1 format (has state.json but no pool.json).
 */
export function needsUpgrade(poolDir: string): boolean {
  const hasPool = fs.existsSync(path.join(poolDir, POOL_FILE));
  const hasState = fs.existsSync(path.join(poolDir, 'state.json'));
  return hasState && !hasPool;
}

/**
 * Check if pool is initialized (either v1 or v2 format).
 */
export function isInitialized(poolDir: string): boolean {
  return (
    fs.existsSync(path.join(poolDir, POOL_FILE)) ||
    fs.existsSync(path.join(poolDir, 'state.json'))
  );
}
