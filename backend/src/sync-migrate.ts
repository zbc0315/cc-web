import * as path from 'path';
import { getProjects, isProjectOwner } from './config';
import {
  listUsersWithSyncConfig, getSyncConfig, setSyncConfig, sanitizeFolderName, isValidRemotePath,
} from './sync-config';
import { modLogger } from './logger';

const log = modLogger('sync-migrate');

/**
 * One-shot migration for the per-project-path refactor.
 *
 * Before: every project synced to `<remoteRoot>/<sanitized name>` automatically.
 * After: each project has its own `projectPaths[id]`. To not break existing
 * setups, seed each user's owned projects with `remoteRoot/<name>` — the exact
 * target the old code computed — when they have a `remoteRoot` but no
 * `projectPaths` yet.
 *
 * Idempotent: a user with ANY `projectPaths` entry is skipped (already migrated
 * or already using the new per-project config). Run once at startup. Kept OUT
 * of `getSyncConfig` (hot path) to avoid a per-read project scan + write.
 */
export function migrateRemoteRootToProjectPaths(): void {
  let migratedUsers = 0;
  let seededProjects = 0;
  const projects = getProjects();

  for (const username of listUsersWithSyncConfig()) {
    const cfg = getSyncConfig(username);
    if (cfg.projectPathsMigrated) continue; // one-shot: never re-seed (prevents resurrection if a user later clears all paths)
    if (!cfg.remoteRoot) continue;          // nothing to seed from

    // Seed only when there are no per-project paths yet; either way mark the
    // user migrated so this never runs again for them.
    if (Object.keys(cfg.projectPaths).length === 0) {
      for (const p of projects) {
        if (!isProjectOwner(p, username)) continue;
        const folder =
          sanitizeFolderName(p.name) ?? sanitizeFolderName(path.basename(p.folderPath)) ?? p.id;
        const candidate = path.posix.join(cfg.remoteRoot, folder);
        // Never seed an invalid path (e.g. a project name with a space — which
        // also wasn't safely syncable under the old remoteRoot/<name> scheme).
        // Leave it unset → dashed cloud → user configures it explicitly.
        if (!isValidRemotePath(candidate)) {
          log.warn({ user: username, projectId: p.id, candidate }, 'skip migrate: derived path invalid');
          continue;
        }
        cfg.projectPaths[p.id] = candidate;
        seededProjects++;
      }
    }
    cfg.projectPathsMigrated = true;
    setSyncConfig(cfg);
    migratedUsers++;
  }

  if (migratedUsers > 0) {
    log.info({ migratedUsers, seededProjects }, 'seeded per-project sync paths from remoteRoot');
  }
}
