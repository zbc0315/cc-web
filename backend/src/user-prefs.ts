import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR, atomicWriteSync } from './config';

/**
 * Per-user preferences persisted across restarts.
 *
 * Shape on disk: `{ [username]: { [key]: value } }`
 *
 * Keeps tiny, non-secret client-side state (project order, ui prefs) in one
 * file rather than scattering one file per user × feature. Not for anything
 * security-sensitive — no auth data here.
 */

const PREFS_FILE = path.join(DATA_DIR, 'user-prefs.json');

type Prefs = Record<string, Record<string, unknown>>;

let cache: Prefs | null = null;
let cacheMtime = 0;

function readAll(): Prefs {
  try {
    const stat = fs.statSync(PREFS_FILE);
    if (cache && stat.mtimeMs === cacheMtime) return cache;
    const raw = fs.readFileSync(PREFS_FILE, 'utf-8');
    cache = JSON.parse(raw) as Prefs;
    cacheMtime = stat.mtimeMs;
    return cache;
  } catch {
    cache = {};
    cacheMtime = 0;
    return cache;
  }
}

function writeAll(prefs: Prefs): void {
  atomicWriteSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
  cache = prefs;
  try { cacheMtime = fs.statSync(PREFS_FILE).mtimeMs; } catch { /* ignore */ }
}

export function getUserPref<T = unknown>(username: string, key: string): T | undefined {
  const all = readAll();
  return all[username]?.[key] as T | undefined;
}

export function setUserPref(username: string, key: string, value: unknown): void {
  const all = readAll();
  const forUser = { ...(all[username] ?? {}) };
  forUser[key] = value;
  writeAll({ ...all, [username]: forUser });
}
