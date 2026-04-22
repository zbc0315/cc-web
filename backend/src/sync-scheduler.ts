import * as crypto from 'crypto';
import { getProjects, isProjectOwner } from './config';
import { getSyncConfig, listUsersWithSyncConfig } from './sync-config';
import { syncProject } from './sync-service';
import { modLogger } from './logger';

const log = modLogger('sync');

/**
 * Minimal cron-style scheduler for per-user sync schedules.  Supports the
 * common 5-field form with `*`, literal numbers, `A-B` ranges, `A,B,C` lists,
 * and `*\/N` step patterns.
 *
 * Fields: minute (0-59), hour (0-23), day-of-month (1-31), month (1-12),
 * day-of-week (0-6, 0=Sunday).
 *
 * A single setInterval ticks once per minute; each tick, cron expressions are
 * evaluated against the current minute. `lastRunKey` de-dupes firings so DST
 * fall-back doesn't run the same minute twice.
 */

interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
}

/** Return parsed cron or `null` if invalid.  Refuses empty-Set fields (e.g.
 *  `9-5` with A>B) and invalid step (`*\/0`) rather than silently accepting
 *  them as "never fires" / "every minute". */
function parseField(raw: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const segment of raw.split(',')) {
    const part = segment.trim();
    if (!part) return null;
    let step = 1;
    let rangePart = part;
    const slashIdx = part.indexOf('/');
    if (slashIdx >= 0) {
      const stepRaw = part.slice(slashIdx + 1);
      const parsed = parseInt(stepRaw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      step = parsed;
      rangePart = part.slice(0, slashIdx);
    }
    let start = min;
    let end = max;
    if (rangePart === '*') {
      /* full range */
    } else if (rangePart.includes('-')) {
      const [aStr, bStr] = rangePart.split('-');
      const a = parseInt(aStr, 10);
      const b = parseInt(bStr, 10);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      if (a > b) return null;                   // A>B would yield empty Set
      if (a < min || b > max) return null;      // out-of-range
      start = a;
      end = b;
    } else {
      const n = parseInt(rangePart, 10);
      if (!Number.isFinite(n) || n < min || n > max) return null;
      start = end = n;
    }
    for (let v = start; v <= end; v += step) {
      if (v >= min && v <= max) out.add(v);
    }
  }
  if (out.size === 0) return null;
  return out;
}

function parseCron(expr: string): ParsedCron | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, dom, mo, dow] = parts;
  const minute = parseField(m, 0, 59);
  const hour = parseField(h, 0, 23);
  const domS = parseField(dom, 1, 31);
  const month = parseField(mo, 1, 12);
  const dowS = parseField(dow, 0, 6);
  if (!minute || !hour || !domS || !month || !dowS) return null;
  return { minute, hour, dom: domS, month, dow: dowS };
}

/** Human-readable error or `null` if valid. Consumed by `routes/sync.ts` at
 *  save-time so invalid crons are rejected with a 400 instead of silently
 *  being "enabled but never fires". */
export function validateCron(expr: string): string | null {
  if (!expr || !expr.trim()) return '空表达式';
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return `必须是 5 段（分 时 日 月 周），当前 ${parts.length} 段`;
  const parsed = parseCron(expr);
  if (!parsed) return '包含无效字段、空范围（如 9-5）、或步长为 0';
  return null;
}

function matches(cron: ParsedCron, now: Date): boolean {
  return (
    cron.minute.has(now.getMinutes()) &&
    cron.hour.has(now.getHours()) &&
    cron.dom.has(now.getDate()) &&
    cron.month.has(now.getMonth() + 1) &&
    cron.dow.has(now.getDay())
  );
}

// ── Scheduler state ─────────────────────────────────────────────────────────

let interval: NodeJS.Timeout | null = null;
let timeoutHandle: NodeJS.Timeout | null = null;

/** Keyed by username — the last `YYYYMMDDHHMM` key at which we fired.  Guards
 *  against DST fall-back double-fires (same minute + hour twice in one day)
 *  and any scheduler-tick drift. */
const lastRunKey = new Map<string, string>();

function minuteKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

async function runScheduledOnce(now: Date): Promise<void> {
  const currentKey = minuteKey(now);
  const users = listUsersWithSyncConfig();
  for (const username of users) {
    const cfg = getSyncConfig(username);
    if (!cfg.schedule.enabled || !cfg.schedule.cron) continue;
    const parsed = parseCron(cfg.schedule.cron);
    if (!parsed || !matches(parsed, now)) continue;
    // De-dupe per-minute (DST + tick jitter)
    if (lastRunKey.get(username) === currentKey) continue;
    lastRunKey.set(username, currentKey);

    const projects = getProjects().filter((p) => !p.archived && isProjectOwner(p, username));
    for (const p of projects) {
      // Mint runId before the call so the catch path can log it too
      // (reviewer I3: scheduler failures need cross-file correlation).
      const runId = `sync.${Date.now()}.${crypto.randomBytes(3).toString('hex')}`;
      try {
        await syncProject(username, p.id, p.name, p.folderPath, undefined, { runId });
      } catch (err) {
        log.warn(
          { err, runId, user: username, projectId: p.id, projectName: p.name },
          'scheduled sync failed',
        );
      }
    }
  }
}

export function startSyncScheduler(): void {
  if (interval || timeoutHandle) return;
  // Align to top of minute: wait until seconds == 0, then fire every 60s.
  const alignDelay = (60 - new Date().getSeconds()) * 1000;
  timeoutHandle = setTimeout(() => {
    timeoutHandle = null;
    void runScheduledOnce(new Date()).catch(() => { /* ignore */ });
    interval = setInterval(() => {
      void runScheduledOnce(new Date()).catch(() => { /* ignore */ });
    }, 60_000);
  }, alignDelay);
}

export function stopSyncScheduler(): void {
  if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; }
  if (interval) { clearInterval(interval); interval = null; }
  lastRunKey.clear();
}
