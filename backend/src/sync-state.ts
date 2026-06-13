import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { DATA_DIR, atomicWriteSync } from './config';

/**
 * Per-user, per-project sync runtime state — currently just `lastSyncAt`, used
 * to decide whether a project has local changes newer than its last successful
 * push (the "dirty" cloud on the dashboard card).
 *
 * Kept in a SEPARATE file from sync-config (`<DATA_DIR>/sync-state/<sha1>.json`)
 * because it churns on every sync, while config is rarely written — mixing them
 * would rewrite the whole config (incl. encrypted password) on each sync.
 */

interface ProjectSyncState {
  lastSyncAt: number; // epoch ms of the last successful sync; 0 / absent = never
}
type UserSyncState = Record<string, ProjectSyncState>;

const STATE_DIR = path.join(DATA_DIR, 'sync-state');

function ensureDir(): void {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
}

function userFile(username: string): string {
  const hash = crypto.createHash('sha1').update(`ccweb-sync-state-user:${username}`).digest('hex');
  return path.join(STATE_DIR, `${hash}.json`);
}

function readState(username: string): UserSyncState {
  ensureDir();
  const file = userFile(username);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as UserSyncState;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeState(username: string, state: UserSyncState): void {
  ensureDir();
  atomicWriteSync(userFile(username), JSON.stringify(state, null, 2));
  try { fs.chmodSync(userFile(username), 0o600); } catch { /* ignore */ }
}

export function getLastSyncAt(username: string, projectId: string): number {
  return readState(username)[projectId]?.lastSyncAt ?? 0;
}

export function setLastSyncAt(username: string, projectId: string, ts: number): void {
  // Read-modify-write of the per-user file. Two concurrent syncs of *different*
  // projects for the same user could drop one sibling's update (last-writer-
  // wins). Accepted: syncs are serialized per (user,project), `/all` runs
  // sequentially, the overlap window is tiny, and the only consequence is one
  // project's cloud reading stale until its next sync (self-heals). Not worth
  // per-project files / locking.
  const state = readState(username);
  state[projectId] = { lastSyncAt: ts };
  writeState(username, state);
}

/** All projects' lastSyncAt for a user, for the dashboard status endpoint. */
export function getAllLastSyncAt(username: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [pid, s] of Object.entries(readState(username))) {
    out[pid] = s?.lastSyncAt ?? 0;
  }
  return out;
}
