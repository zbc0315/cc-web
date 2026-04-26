/**
 * Claude Code CLI scheduled-tasks reader (best-effort reconstruction).
 *
 * Claude Code provides NO official query API for active scheduled tasks
 * (`ScheduleWakeup` / `CronCreate`). They live in CLI process memory unless
 * created with `durable:true` (which is rare in practice). To give the user
 * any visibility, we reconstruct the timeline by scanning the project's
 * session JSONL files at `~/.claude/projects/<encoded>/<sessionId>.jsonl`,
 * which record every `tool_use` Claude emits — including ScheduleWakeup
 * and CronCreate.
 *
 * Caveats this reconstruction cannot resolve:
 *   - We see "task created" events but cannot directly observe "task fired"
 *     or "task deleted/cancelled". For one-shot ScheduleWakeup we hide
 *     records whose `createdAt + delaySeconds` is already past (must have
 *     fired or been cancelled). For recurring CronCreate we keep entries
 *     created within the last 7 days (Claude's own auto-expiry window).
 *   - Same prompt scheduled across multiple sessions appears multiple
 *     times by design — that preserves provenance.
 *
 * The UI must label this list as "best-effort reconstruction", not the
 * authoritative live state.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CronExpressionParser } from 'cron-parser';
import { modLogger } from '../../logger';

const log = modLogger('scheduled');

const SEVEN_DAYS_MS = 7 * 86400 * 1000;
const PROMPT_PREVIEW_MAX = 4000;

export interface ScheduledTask {
  id: string;                              // tool_use_id from JSONL
  type: 'ScheduleWakeup' | 'CronCreate';
  cron: string | null;                     // CronCreate only
  delaySeconds: number | null;             // ScheduleWakeup only
  recurring: boolean;                      // CronCreate may set this in input
  prompt: string;
  reason: string | null;                   // ScheduleWakeup only
  createdAt: number;                       // epoch ms (from JSONL timestamp)
  nextFireAt: string | null;               // ISO string
  sessionId: string;
  durable: boolean;                        // CronCreate input.durable === true
}

function encodeProjectPath(folderPath: string): string {
  // Match Claude CLI's encoding (see claude-adapter.ts encodeProjectPath).
  return folderPath.replace(/[\/ _]/g, '-');
}

function projectSessionsDir(folderPath: string): string {
  return path.join(os.homedir(), '.claude', 'projects', encodeProjectPath(folderPath));
}

interface RawJsonlLine {
  type?: string;
  sessionId?: string;
  timestamp?: string;
  message?: {
    role?: string;
    content?: Array<{
      type?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
}

function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `…[+${s.length - max}]`;
}

function extractFromLine(line: string, sessionFile: string): ScheduledTask[] {
  let rec: RawJsonlLine;
  try { rec = JSON.parse(line) as RawJsonlLine; } catch { return []; }
  if (rec.type !== 'assistant' || rec.message?.role !== 'assistant') return [];
  const content = rec.message?.content;
  if (!Array.isArray(content)) return [];
  const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
  if (!Number.isFinite(ts)) return [];
  const sessionId = rec.sessionId ?? path.basename(sessionFile, '.jsonl');
  const out: ScheduledTask[] = [];

  for (const block of content) {
    if (!block || block.type !== 'tool_use') continue;
    const name = block.name;
    if (name !== 'ScheduleWakeup' && name !== 'CronCreate') continue;
    const input = (block.input ?? {}) as Record<string, unknown>;
    const id = typeof block.id === 'string' ? block.id : '';
    const promptRaw = typeof input.prompt === 'string' ? input.prompt : '';
    const prompt = clamp(promptRaw, PROMPT_PREVIEW_MAX);

    if (name === 'ScheduleWakeup') {
      const delaySeconds =
        typeof input.delaySeconds === 'number' && Number.isFinite(input.delaySeconds)
          ? input.delaySeconds
          : null;
      const reason = typeof input.reason === 'string' ? input.reason : null;
      const fireMs = delaySeconds !== null ? ts + delaySeconds * 1000 : null;
      out.push({
        id,
        type: 'ScheduleWakeup',
        cron: null,
        delaySeconds,
        recurring: false,
        prompt,
        reason,
        createdAt: ts,
        nextFireAt: fireMs !== null ? new Date(fireMs).toISOString() : null,
        sessionId,
        durable: false,
      });
    } else {
      const cron = typeof input.cron === 'string' ? input.cron : null;
      const durable = input.durable === true;
      const recurring = input.recurring === true;
      let nextFireAt: string | null = null;
      if (cron) {
        try {
          const start = Math.max(ts, Date.now());
          const it = CronExpressionParser.parse(cron, { currentDate: new Date(start) });
          nextFireAt = it.next().toDate().toISOString();
        } catch {
          // unparseable cron — leave nextFireAt null, keep the record so
          // the UI can flag it
        }
      }
      out.push({
        id,
        type: 'CronCreate',
        cron,
        delaySeconds: null,
        recurring,
        prompt,
        reason: null,
        createdAt: ts,
        nextFireAt,
        sessionId,
        durable,
      });
    }
  }
  return out;
}

function readSessionFile(file: string): ScheduledTask[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    log.warn({ err, file }, 'failed to read session jsonl');
    return [];
  }
  const out: ScheduledTask[] = [];
  // Process line-by-line; final line may be a partial write — JSON.parse
  // failures inside extractFromLine are swallowed quietly per line.
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(...extractFromLine(trimmed, file));
    } catch (err) {
      log.debug({ err, file }, 'unexpected error parsing jsonl line');
    }
  }
  return out;
}

export function tasksForProject(folderPath: string): ScheduledTask[] {
  const dir = projectSessionsDir(folderPath);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    // No session dir — Claude was never run for this project.
    return [];
  }

  const cutoffMs = Date.now() - SEVEN_DAYS_MS;
  const sessionFiles: string[] = [];
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    const full = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue; // racing with rotation/deletion
    }
    if (!stat.isFile()) continue;
    if (stat.mtimeMs < cutoffMs) continue; // untouched >7d, skip
    sessionFiles.push(full);
  }

  const all: ScheduledTask[] = [];
  for (const f of sessionFiles) all.push(...readSessionFile(f));

  const now = Date.now();
  const filtered = all.filter((t) => {
    if (t.type === 'ScheduleWakeup') {
      // One-shot: only show records whose fire time is still in the future.
      // Past-fire-time means it has either already fired or been cancelled
      // by user input — keeping them is noise.
      if (t.delaySeconds === null) return false;
      return t.createdAt + t.delaySeconds * 1000 > now;
    }
    // CronCreate (recurring or one-shot): keep entries within Claude's 7-day
    // auto-expiry window.
    return t.createdAt > cutoffMs;
  });

  filtered.sort((a, b) => b.createdAt - a.createdAt);
  return filtered;
}
