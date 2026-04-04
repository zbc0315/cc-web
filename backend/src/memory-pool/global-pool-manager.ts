// backend/src/memory-pool/global-pool-manager.ts

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { atomicWriteSync } from '../config';
import { PoolJson, SourcesJson, SourceEntry, SyncResult, PoolBallMeta, ImportPreviewBall } from './types';
import { readPool, writePool, readBallContent, writeBallContent, enrichBallsWithBuoyancy } from './pool-manager';
import { computeBuoyancy } from './buoyancy';

const GLOBAL_POOL_DIR = path.join(os.homedir(), '.ccweb', 'memory-pool');
const SOURCES_FILE = 'sources.json';

// Concurrency guard
let syncInProgress = false;

export function getGlobalPoolDir(): string {
  return GLOBAL_POOL_DIR;
}

// ── Sources management ──

function sourcesPath(): string {
  return path.join(GLOBAL_POOL_DIR, SOURCES_FILE);
}

export function readSources(): SourcesJson {
  const file = sourcesPath();
  if (!fs.existsSync(file)) return { version: 1, sources: [] };
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return { version: 1, sources: [] };
  }
}

export function writeSources(data: SourcesJson): void {
  atomicWriteSync(sourcesPath(), JSON.stringify(data, null, 2));
}

// ── Global pool init ──

export function isGlobalPoolInitialized(): boolean {
  return fs.existsSync(path.join(GLOBAL_POOL_DIR, 'pool.json'));
}

export function ensureGlobalPool(): void {
  if (isGlobalPoolInitialized()) return;

  fs.mkdirSync(path.join(GLOBAL_POOL_DIR, 'balls'), { recursive: true });

  const now = new Date().toISOString();
  const pool: PoolJson = {
    version: 2,
    t: 0,
    lambda: 0.99,
    alpha: 1.0,
    active_capacity: 40,
    next_id: 1,
    pool: 'global',
    initialized_at: now,
    balls: [],
  };
  writePool(GLOBAL_POOL_DIR, pool);
  writeSources({ version: 1, sources: [] });
}

export function readGlobalPool(): PoolJson | null {
  return readPool(GLOBAL_POOL_DIR);
}

// ── Calendar-based t ──

export function computeGlobalT(initializedAt: string): number {
  const epochDay = Math.floor(new Date(initializedAt).getTime() / 86400000);
  const nowDay = Math.floor(Date.now() / 86400000);
  return Math.max(0, nowDay - epochDay);
}

// ── Register project ──

export function registerProject(projectId: string, projectName: string, poolPath: string): void {
  ensureGlobalPool();
  const sources = readSources();
  const existing = sources.sources.find((s) => s.pool_path === poolPath);
  if (existing) {
    // Refresh metadata
    existing.project_id = projectId;
    existing.project_name = projectName;
    existing.status = 'active';
    existing.unreachable_count = 0;
  } else {
    sources.sources.push({
      project_id: projectId,
      project_name: projectName,
      pool_path: poolPath,
      registered_at: new Date().toISOString(),
      last_synced_at: null,
      status: 'active',
      unreachable_count: 0,
    });
  }
  writeSources(sources);
}

export function removeSource(projectId: string): boolean {
  const sources = readSources();
  const idx = sources.sources.findIndex((s) => s.project_id === projectId);
  if (idx === -1) return false;
  sources.sources.splice(idx, 1);
  writeSources(sources);
  return true;
}

// ── Sync (global operation) ──

export function syncToGlobal(): SyncResult {
  if (syncInProgress) {
    throw new Error('SYNC_IN_PROGRESS');
  }
  syncInProgress = true;

  try {
    ensureGlobalPool();
    const globalPool = readGlobalPool()!;
    const sources = readSources();
    const globalT = computeGlobalT(globalPool.initialized_at);
    globalPool.t = globalT;

    const result: SyncResult = {
      added: 0,
      updated: 0,
      skipped: 0,
      orphaned: 0,
      unreachable_projects: [],
      synced_projects: [],
    };

    // Build origin lookup: "projectId:ballId" → global ball index
    const originMap = new Map<string, number>();
    globalPool.balls.forEach((gb, idx) => {
      if (gb.origins) {
        for (const o of gb.origins) {
          originMap.set(`${o.source_project}:${o.source_ball_id}`, idx);
        }
      }
    });

    // Track which origins are still alive (from synced projects only)
    const aliveOrigins = new Set<string>();
    // Track projects that were actually synced (for orphan detection scoping)
    const syncedProjectIds = new Set<string>();

    // Step 1 & 2: Collect and merge
    for (const source of sources.sources) {
      if (source.status === 'unreachable') continue;

      const projectPool = readPool(source.pool_path);
      if (!projectPool) {
        source.unreachable_count = (source.unreachable_count ?? 0) + 1;
        if (source.unreachable_count >= 3) {
          source.status = 'unreachable';
        }
        result.unreachable_projects.push(source.project_name);
        continue;
      }

      // Reset unreachable count on success
      source.unreachable_count = 0;
      source.last_synced_at = new Date().toISOString();
      result.synced_projects.push(source.project_name);
      syncedProjectIds.add(source.project_id);

      for (const ball of projectPool.balls) {
        const originKey = `${source.project_id}:${ball.id}`;
        aliveOrigins.add(originKey);

        const existingIdx = originMap.get(originKey);
        if (existingIdx !== undefined) {
          // Already exists — check content change
          const globalBall = globalPool.balls[existingIdx];
          const projectContent = readBallContent(source.pool_path, ball.id);
          const globalContent = readBallContent(GLOBAL_POOL_DIR, globalBall.id);

          if (projectContent !== null && projectContent !== globalContent) {
            // Content changed — update content, keep global H
            writeBallContent(GLOBAL_POOL_DIR, globalBall.id, projectContent);
            globalBall.summary = ball.summary;
            globalBall.t_last = globalT;
            result.updated++;
          } else {
            // Touch: refresh t_last
            globalBall.t_last = globalT;
            result.skipped++;
          }
        } else {
          // New ball — compute project buoyancy as B0
          const projectBuoyancy = computeBuoyancy(
            ball.B0, ball.H, projectPool.alpha, projectPool.lambda,
            projectPool.t, ball.t_last, ball.permanent,
          );

          const newId = `ball_${String(globalPool.next_id).padStart(4, '0')}`;
          globalPool.next_id++;

          const newBall: PoolBallMeta = {
            id: newId,
            type: ball.type,
            summary: ball.summary,
            B0: Math.round(projectBuoyancy * 100) / 100,
            H: 0,
            t_last: globalT,
            hardness: ball.hardness,
            permanent: ball.permanent,
            links: [], // Links resolved separately
            created_at: ball.created_at,
            origins: [{
              source_project: source.project_id,
              source_ball_id: ball.id,
              synced_at: new Date().toISOString(),
            }],
          };

          // Write ball content first (gate pattern)
          const content = readBallContent(source.pool_path, ball.id);
          if (content !== null) {
            writeBallContent(GLOBAL_POOL_DIR, newId, content);
          }

          globalPool.balls.push(newBall);
          originMap.set(originKey, globalPool.balls.length - 1);
          result.added++;
        }
      }
    }

    // Step 3: Orphan detection (only check origins from synced projects)
    for (const gb of globalPool.balls) {
      if (!gb.origins || gb.origins.length === 0) continue;

      // Only remove origins whose source project was actually synced and ball is gone
      gb.origins = gb.origins.filter((o) => {
        if (!syncedProjectIds.has(o.source_project)) return true; // preserve unreachable/unsynced origins
        return aliveOrigins.has(`${o.source_project}:${o.source_ball_id}`);
      });

      if (gb.origins.length === 0 && !gb.orphaned) {
        gb.pre_orphan_B0 = gb.B0;
        gb.orphaned = true;
        gb.B0 = Math.round(gb.B0 * 0.5 * 100) / 100;
        result.orphaned++;
      } else if (gb.origins.length > 0 && gb.orphaned) {
        // Restore orphaned ball when origins reappear
        if (gb.pre_orphan_B0 !== undefined) {
          gb.B0 = gb.pre_orphan_B0;
          delete gb.pre_orphan_B0;
        }
        gb.orphaned = false;
      }
    }

    // Step 4: Write pool.json LAST (gate)
    writePool(GLOBAL_POOL_DIR, globalPool);
    writeSources(sources);

    return result;
  } finally {
    syncInProgress = false;
  }
}

// ── Import preview ──

export function getImportPreview(projectPoolDir: string): ImportPreviewBall[] {
  const globalPool = readGlobalPool();
  if (!globalPool) return [];

  // Use fresh calendar-based t for accurate buoyancy
  globalPool.t = computeGlobalT(globalPool.initialized_at);

  const projectPool = readPool(projectPoolDir);
  if (!projectPool) return [];

  // Get global active balls sorted by buoyancy
  const enriched = enrichBallsWithBuoyancy(globalPool);
  const activeBalls = enriched.slice(0, globalPool.active_capacity);

  // Find which global balls are already imported into this project
  const importedGlobalIds = new Set(
    projectPool.balls.filter((b) => b.global_ball_id).map((b) => b.global_ball_id!),
  );

  return activeBalls
    .filter((b) => !importedGlobalIds.has(b.id) && !b.orphaned)
    .map((b) => ({
      global_ball_id: b.id,
      type: b.type,
      summary: b.summary,
      buoyancy: b.buoyancy,
      origins_count: b.origins?.length ?? 0,
    }));
}

// ── Import from global ──

export function importFromGlobal(
  projectPoolDir: string,
  selectedGlobalIds: string[],
): { imported: number; balls: Array<{ local_id: string; global_id: string; summary: string }> } {
  const globalPool = readGlobalPool();
  if (!globalPool) throw new Error('Global pool not initialized');

  // Use fresh calendar-based t for accurate buoyancy
  globalPool.t = computeGlobalT(globalPool.initialized_at);

  const projectPool = readPool(projectPoolDir);
  if (!projectPool) throw new Error('Project pool not initialized');

  // Compute global buoyancies
  const enriched = enrichBallsWithBuoyancy(globalPool);
  const globalBallMap = new Map(enriched.map((b) => [b.id, b]));

  // Compute project active layer lowest buoyancy for B0 normalization
  const projectEnriched = enrichBallsWithBuoyancy(projectPool);
  const projectActiveBalls = projectEnriched.slice(0, projectPool.active_capacity);
  const lowestActiveB = projectActiveBalls.length > 0
    ? projectActiveBalls[projectActiveBalls.length - 1].buoyancy
    : 5;

  // Default B0 by type
  const defaultB0: Record<string, number> = { feedback: 8, user: 5, project: 4, reference: 2 };

  // Build global→local ID mapping for links (include previously imported balls)
  const globalToLocal = new Map<string, string>();
  for (const b of projectPool.balls) {
    if (b.global_ball_id) {
      globalToLocal.set(b.global_ball_id, b.id);
    }
  }
  const imported: Array<{ local_id: string; global_id: string; summary: string }> = [];

  // First pass: assign local IDs for new imports
  for (const gid of selectedGlobalIds) {
    const gb = globalBallMap.get(gid);
    if (!gb) continue;

    // Skip if already imported
    if (globalToLocal.has(gid)) continue;

    const localId = `ball_${String(projectPool.next_id).padStart(4, '0')}`;
    projectPool.next_id++;
    globalToLocal.set(gid, localId);
  }

  // Collect newly assigned IDs (exclude previously imported)
  const previouslyImported = new Set(projectPool.balls.filter((b) => b.global_ball_id).map((b) => b.global_ball_id!));

  // Second pass: create balls with mapped links
  for (const gid of selectedGlobalIds) {
    const gb = globalBallMap.get(gid);
    if (!gb) continue;

    // Skip if this was previously imported
    if (previouslyImported.has(gid)) continue;

    const localId = globalToLocal.get(gid);
    if (!localId) continue;

    // B0 normalization
    const normalizedB0 = Math.max(
      defaultB0[gb.type] ?? 4,
      Math.min(gb.buoyancy, lowestActiveB * 1.5),
    );

    // Map links: only keep links to simultaneously imported balls
    const mappedLinks = (gb.links || [])
      .map((linkGid) => globalToLocal.get(linkGid))
      .filter((id): id is string => id !== undefined);

    const newBall: PoolBallMeta = {
      id: localId,
      type: gb.type as PoolBallMeta['type'],
      summary: gb.summary,
      B0: Math.round(normalizedB0 * 100) / 100,
      H: 0,
      t_last: projectPool.t,
      hardness: gb.hardness,
      permanent: gb.permanent,
      links: mappedLinks,
      created_at: new Date().toISOString(),
      global_ball_id: gid,
    };

    // Copy ball content
    const content = readBallContent(GLOBAL_POOL_DIR, gid);
    if (content !== null) {
      writeBallContent(projectPoolDir, localId, content);
    }

    projectPool.balls.push(newBall);
    imported.push({ local_id: localId, global_id: gid, summary: gb.summary });
  }

  // Write project pool
  writePool(projectPoolDir, projectPool);

  return { imported: imported.length, balls: imported };
}
