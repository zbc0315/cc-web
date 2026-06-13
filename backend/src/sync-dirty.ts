import * as fs from 'fs';
import * as path from 'path';

/**
 * "Dirty" detection for the dashboard sync cloud: does a project have local
 * files modified since its last successful sync?
 *
 * BEST-EFFORT, by design. The authoritative exclude semantics live in rsync
 * (patterns are passed verbatim to `rsync --exclude` and matched by rsync's own
 * engine — they are NOT matched in JS anywhere today). This module reimplements
 * a small, well-understood SUBSET of that matcher purely to skip the big/noise
 * directories (.git, node_modules, …) and not count obviously-excluded files.
 * It can disagree with rsync at the margins — so it drives a hint icon, never a
 * correctness decision. Push-only semantics: a pull/bidi leg writes local files
 * and would re-dirty instantly, so callers only use this for push directions.
 */

// ── exclude matcher (subset) ─────────────────────────────────────────────────

interface Matcher {
  excludesDir(name: string, rel: string): boolean;
  excludesFile(name: string, rel: string): boolean;
}

function globToRegExp(glob: string, anchoredPath: boolean): RegExp {
  let re = '';
  for (const ch of glob) {
    if (ch === '*') re += anchoredPath ? '[^/]*' : '.*';
    else if (ch === '?') re += '.';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function makeMatcher(excludes: string[]): Matcher {
  const dirNames = new Set<string>(); // `name/` → directories named `name` at any depth
  const exactNames = new Set<string>(); // `name` → file OR dir basename at any depth
  const baseGlobs: RegExp[] = []; // `*.log` → basename glob at any depth
  const pathGlobs: RegExp[] = []; // `a/b` → anchored relpath glob (best-effort)

  for (let raw of excludes) {
    raw = (raw || '').trim();
    if (!raw || raw.startsWith('#')) continue;
    const isDir = raw.endsWith('/');
    let p = isDir ? raw.slice(0, -1) : raw;
    p = p.replace(/^\.?\//, ''); // strip a leading `/` or `./`
    if (!p) continue;
    if (p.includes('/')) pathGlobs.push(globToRegExp(p, true));
    else if (p.includes('*') || p.includes('?')) baseGlobs.push(globToRegExp(p, false));
    else if (isDir) dirNames.add(p);
    else exactNames.add(p);
  }

  const matchBase = (name: string) => exactNames.has(name) || baseGlobs.some((r) => r.test(name));
  const matchPath = (rel: string) => pathGlobs.length > 0 && pathGlobs.some((r) => r.test(rel));

  return {
    excludesDir: (name, rel) => dirNames.has(name) || matchBase(name) || matchPath(rel),
    excludesFile: (name, rel) => matchBase(name) || matchPath(rel),
  };
}

// ── walk ─────────────────────────────────────────────────────────────────────

const MAX_ENTRIES = 50_000; // safety valve for pathological trees
// Slack on the "ignore future-dated files" guard. File mtimeMs is fractional
// (sub-ms) while Date.now() is integer ms, so a file touched in the same
// millisecond as the check can read a hair "in the future" — without slack it
// would be wrongly skipped. The guard only needs to catch grossly-future
// timestamps (NFS/touch year-2099 pinning dirty forever), so a couple seconds
// of slack is safe.
const FUTURE_SLACK_MS = 2_000;

/**
 * True if any non-excluded file under `localPath` has an mtime newer than
 * `lastSyncAt` (and not in the future). `lastSyncAt === 0` (never synced) →
 * any present file makes it dirty. Returns false on the first sign of "clean"
 * exhaustion, on read errors, or if the entry cap is hit (best-effort).
 */
export function computeDirty(localPath: string, excludes: string[], lastSyncAt: number): boolean {
  const m = makeMatcher(excludes);
  const now = Date.now();
  let walked = 0;

  function walk(dir: string, rel: string): boolean {
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false; // unreadable dir → ignore
    }
    for (const d of dirents) {
      if (++walked > MAX_ENTRIES) return false;
      const name = d.name;
      const childRel = rel ? `${rel}/${name}` : name;

      if (d.isDirectory()) {
        // Don't follow symlinked dirs (isDirectory() is false for symlinks) —
        // avoids loops and escaping the tree.
        if (m.excludesDir(name, childRel)) continue;
        if (walk(path.join(dir, name), childRel)) return true;
      } else if (d.isFile() || d.isSymbolicLink()) {
        if (m.excludesFile(name, childRel)) continue;
        let st: fs.Stats;
        try {
          st = fs.lstatSync(path.join(dir, name)); // own mtime, don't follow links
        } catch {
          continue;
        }
        const mt = st.mtimeMs;
        // Newer than last sync but not grossly future-dated (a bogus future
        // mtime — NFS/touch — must not pin the project dirty forever).
        if (mt > lastSyncAt && mt <= now + FUTURE_SLACK_MS) return true;
      }
    }
    return false;
  }

  try {
    return walk(localPath, '');
  } catch {
    return false;
  }
}

// ── TTL cache ────────────────────────────────────────────────────────────────

const TTL_MS = 10_000;
const cache = new Map<string, { dirty: boolean; at: number }>();

/** Cached computeDirty keyed by `${username}:${projectId}`. */
export function getDirtyCached(
  key: string,
  localPath: string,
  excludes: string[],
  lastSyncAt: number
): boolean {
  const c = cache.get(key);
  if (c && Date.now() - c.at < TTL_MS) return c.dirty;
  const dirty = computeDirty(localPath, excludes, lastSyncAt);
  cache.set(key, { dirty, at: Date.now() });
  return dirty;
}

/** Drop the cached result (call after a successful sync so the card updates). */
export function invalidateDirty(key: string): void {
  cache.delete(key);
}
