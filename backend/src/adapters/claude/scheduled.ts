/**
 * Claude Code CLI scheduled-tasks reader.
 *
 * Reads `<projectFolderPath>/.claude/scheduled_tasks.json` (durable /loop
 * tasks Claude wrote via CronCreate / ScheduleWakeup with `durable: true`).
 *
 * Path is per-project: Claude resolves `path.join(".claude",
 * "scheduled_tasks.json")` relative to its working directory, so each
 * project keeps its own file. Session-only tasks (default ScheduleWakeup
 * and CronCreate without durable:true) live in CLI process memory and
 * never hit disk — they are invisible to ccweb by design.
 *
 * Schema reverse-engineered from 2.1.119 Mach-O binary (BL1 constant,
 * wQ_ creator function). Earlier versions of this file assumed a global
 * `~/.claude/scheduled_tasks.json` — that was wrong.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CronExpressionParser } from 'cron-parser';
import { modLogger } from '../../logger';

const log = modLogger('scheduled');

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

function scheduledFileFor(folderPath: string): string {
  return path.join(folderPath, '.claude', 'scheduled_tasks.json');
}

export function loadScheduledTasks(folderPath: string): RawScheduledTask[] {
  const file = scheduledFileFor(folderPath);
  try {
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      log.warn({ file }, 'scheduled_tasks.json is not an array');
      return [];
    }
    return parsed.filter(
      (t): t is RawScheduledTask =>
        !!t && typeof t === 'object' && typeof (t as RawScheduledTask).id === 'string' &&
        typeof (t as RawScheduledTask).cron === 'string' &&
        typeof (t as RawScheduledTask).prompt === 'string' &&
        typeof (t as RawScheduledTask).createdAt === 'number',
    );
  } catch (err) {
    log.warn({ err, file }, 'failed to read scheduled_tasks.json');
    return [];
  }
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

export function tasksForProject(folderPath: string): ScheduledTask[] {
  const all = loadScheduledTasks(folderPath);
  if (all.length === 0) return [];
  return all.map((t) => ({
    ...t,
    nextFireAt: computeNextFire(t.cron, t.lastFiredAt ?? t.createdAt),
  }));
}
