/**
 * Claude Code CLI scheduled-tasks reader.
 *
 * Reads `~/.claude/scheduled_tasks.json` (durable /loop tasks Claude wrote
 * via CronCreate / ScheduleWakeup with `durable: true`) and filters to the
 * tasks whose originating session's cwd matches a given project folderPath.
 *
 * Claude CLI path / schema reverse-engineered from v2.1.117 Mach-O binary
 * (see research/scheduled-wakeup-panel-plan.md). Session-only tasks are
 * invisible here — they live in CLI process memory, never hit disk.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CronExpressionParser } from 'cron-parser';
import { modLogger } from '../../logger';

const log = modLogger('scheduled');

const SCHEDULED_FILE = path.join(os.homedir(), '.claude', 'scheduled_tasks.json');
const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');

export interface RawScheduledTask {
  id: string;
  cron: string;
  prompt: string;
  createdAt: number;
  recurring?: boolean;
  agentId?: string;
  createdBySessionId?: string;
  createdByPid?: number;
  lastFiredAt?: number;
}

export interface ScheduledTask extends RawScheduledTask {
  nextFireAt: string | null;
}

export function loadScheduledTasks(): RawScheduledTask[] {
  try {
    if (!fs.existsSync(SCHEDULED_FILE)) return [];
    const raw = fs.readFileSync(SCHEDULED_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      log.warn({ file: SCHEDULED_FILE }, 'scheduled_tasks.json is not an array');
      return [];
    }
    return parsed.filter(
      (t): t is RawScheduledTask =>
        !!t && typeof t === 'object' && typeof (t as RawScheduledTask).id === 'string' &&
        typeof (t as RawScheduledTask).cron === 'string' &&
        typeof (t as RawScheduledTask).prompt === 'string',
    );
  } catch (err) {
    log.warn({ err, file: SCHEDULED_FILE }, 'failed to read scheduled_tasks.json');
    return [];
  }
}

interface SessionMeta {
  sessionId?: string;
  cwd?: string;
}

/**
 * Canonicalize an on-disk path for equality comparison: resolve symlinks +
 * normalize. Falls back to `path.resolve` if realpath fails (e.g., the path
 * no longer exists because the session's cwd was deleted).  Without this
 * `Project.folderPath` (stored raw at create-time) and the CLI's captured
 * `cwd` can differ by trailing slash / symlink even when semantically equal.
 */
function canonicalizePath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * Build a sessionId → canonical-cwd index by scanning `~/.claude/sessions/*.json`.
 * Files are named by PID, so we have to open each one. Cheap in practice
 * (O(few dozen), small JSON), and this is called at most once per request.
 */
function buildSessionCwdIndex(): Map<string, string> {
  const index = new Map<string, string>();
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return index;
    const files = fs.readdirSync(SESSIONS_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf-8');
        const meta = JSON.parse(raw) as SessionMeta;
        if (meta.sessionId && meta.cwd) index.set(meta.sessionId, canonicalizePath(meta.cwd));
      } catch {
        // per-file parse failure is non-fatal; skip
      }
    }
  } catch (err) {
    log.warn({ err, dir: SESSIONS_DIR }, 'failed to scan sessions dir');
  }
  return index;
}

function computeNextFire(cron: string, fromHint: number): string | null {
  // We want the next FUTURE fire. If the hint (lastFiredAt or createdAt) is
  // in the past (because the creator process died or the file is stale),
  // starting cron-parser from it would return an already-past date. Clamp
  // to now so we always show a forward-looking timestamp.
  const start = Math.max(fromHint, Date.now());
  try {
    const it = CronExpressionParser.parse(cron, { currentDate: new Date(start) });
    return it.next().toDate().toISOString();
  } catch {
    return null;
  }
}

/**
 * Return scheduled tasks whose originating session's cwd === folderPath.
 * Tasks without `createdBySessionId` (agent/headless-created, rare) are
 * excluded — we can't attribute them. Tasks whose session has exited
 * (stale sessions file cleanup) are also excluded, by design.
 */
export function tasksForProject(folderPath: string): ScheduledTask[] {
  const all = loadScheduledTasks();
  if (all.length === 0) return [];
  const idx = buildSessionCwdIndex();
  const targetCwd = canonicalizePath(folderPath);
  const out: ScheduledTask[] = [];
  for (const t of all) {
    if (!t.createdBySessionId) continue;
    const cwd = idx.get(t.createdBySessionId);
    if (cwd !== targetCwd) continue;
    out.push({
      ...t,
      nextFireAt: computeNextFire(t.cron, t.lastFiredAt ?? t.createdAt),
    });
  }
  return out;
}
