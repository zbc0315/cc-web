import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { DATA_DIR, atomicWriteSync } from './config';
import { modLogger } from './logger';

const log = modLogger('dev-time');

/**
 * Per-user "development time" tracking: how long the user stayed on each
 * project detail page, accumulated into per-day buckets. Layout mirrors
 * sync-state — one file per user, keyed by a sha1 of the username so any
 * username round-trips losslessly.
 *
 *   <DATA_DIR>/dev-time/<sha1(username)>.json
 *   { "<projectId>": { "YYYY-MM-DD": <seconds>, ... }, ... }
 *
 * Dates are in the SERVER's local timezone (self-hosted, single tz) so day /
 * week / month boundaries are stable regardless of which device sent the beat.
 */

export type DevTimePeriod = 'day' | 'week' | 'month';

type UserDevTime = Record<string, Record<string, number>>; // projectId → dateKey → seconds

const DIR = path.join(DATA_DIR, 'dev-time');

// A single heartbeat can never legitimately exceed the client beat interval by
// much; cap it to bound clock-jump / sleep / forged values.
const MAX_BEAT_SECONDS = 120;

// How many buckets each period returns (most recent N, oldest→newest).
const BUCKET_COUNT: Record<DevTimePeriod, number> = { day: 14, week: 8, month: 6 };

function ensureDir(): void {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
}

function userFile(username: string): string {
  const hash = crypto.createHash('sha1').update(`ccweb-dev-time-user:${username}`).digest('hex');
  return path.join(DIR, `${hash}.json`);
}

function read(username: string): UserDevTime {
  ensureDir();
  const file = userFile(username);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as UserDevTime;
  } catch {
    return {};
  }
}

function write(username: string, data: UserDevTime): void {
  ensureDir();
  atomicWriteSync(userFile(username), JSON.stringify(data));
  try { fs.chmodSync(userFile(username), 0o600); } catch { /* ignore */ }
}

// ── Local-date helpers ───────────────────────────────────────────────────────

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Monday-start week key (the Monday's date) for a YYYY-MM-DD string. */
function weekKey(ds: string): string {
  const [y, m, d] = ds.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const mondayOffset = (dt.getDay() + 6) % 7; // 0 = Monday
  dt.setDate(dt.getDate() - mondayOffset);
  return dateKey(dt);
}

function bucketKeyForDate(ds: string, period: DevTimePeriod): string {
  if (period === 'day') return ds;
  if (period === 'week') return weekKey(ds);
  return ds.slice(0, 7); // YYYY-MM
}

/** Build the list of bucket {key,label}, oldest→newest, for the current date. */
function buildBuckets(period: DevTimePeriod): { key: string; label: string }[] {
  const count = BUCKET_COUNT[period];
  const now = new Date();
  const out: { key: string; label: string }[] = [];
  if (period === 'day') {
    for (let i = count - 1; i >= 0; i--) {
      const dt = new Date(now);
      dt.setDate(now.getDate() - i);
      out.push({ key: dateKey(dt), label: `${dt.getMonth() + 1}/${dt.getDate()}` });
    }
  } else if (period === 'week') {
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    for (let i = count - 1; i >= 0; i--) {
      const dt = new Date(monday);
      dt.setDate(monday.getDate() - i * 7);
      out.push({ key: dateKey(dt), label: `${dt.getMonth() + 1}/${dt.getDate()}` });
    }
  } else {
    for (let i = count - 1; i >= 0; i--) {
      const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      out.push({ key, label: `${dt.getMonth() + 1}` });
    }
  }
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Add `seconds` (capped) to today's bucket for a project. */
export function recordDevTime(username: string, projectId: string, seconds: number): void {
  const add = Math.min(Math.round(seconds), MAX_BEAT_SECONDS);
  if (add <= 0) return;
  try {
    const data = read(username);
    const today = dateKey(new Date());
    const proj = data[projectId] ?? (data[projectId] = {});
    proj[today] = (proj[today] ?? 0) + add;
    write(username, data);
  } catch (err) {
    log.warn({ err, projectId }, 'failed to record dev time');
  }
}

export interface DevTimeStats {
  period: DevTimePeriod;
  buckets: { key: string; label: string }[];
  projects: { projectId: string; values: number[]; total: number }[];
}

/** Aggregate a user's stored per-day seconds into the requested period's buckets. */
export function getDevTimeStats(username: string, period: DevTimePeriod): DevTimeStats {
  const data = read(username);
  const buckets = buildBuckets(period);
  const index = new Map(buckets.map((b, i) => [b.key, i]));

  const projects: DevTimeStats['projects'] = [];
  for (const [projectId, days] of Object.entries(data)) {
    const values = new Array(buckets.length).fill(0);
    let total = 0;
    for (const [ds, secs] of Object.entries(days)) {
      const i = index.get(bucketKeyForDate(ds, period));
      if (i === undefined) continue; // outside the visible range
      values[i] += secs;
      total += secs;
    }
    if (total > 0) projects.push({ projectId, values, total });
  }
  return { period, buckets, projects };
}
