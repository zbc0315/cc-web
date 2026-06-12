import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { modLogger } from './logger';

const log = modLogger('claude-mem');

/**
 * Read-only view into the claude-mem plugin's SQLite database
 * (`~/.claude-mem/claude-mem.db`). All access is readonly + query_only; ccweb
 * never writes. Everything claude-mem-version-specific lives in this one module
 * so schema drift across plugin versions is contained (treat as best-effort).
 *
 * Connection lifecycle: lazy open, reused across requests. The DB is live in
 * WAL mode, so a readonly connection sees committed writes without reopening.
 * BUT claude-mem rebuilds the DB on upgrade (backup + replace), which renames
 * the inode — a held handle would then silently read the stale unlinked inode.
 * So each access cheaply stats the path and reopens if the inode changed.
 */

const DB_PATH =
  process.env.CCWEB_CLAUDE_MEM_DB || path.join(os.homedir(), '.claude-mem', 'claude-mem.db');

let db: Database.Database | null = null;
let openedInode: number | null = null;
/** A query threw after a successful open → schema drift / partial corruption. */
let degraded = false;

export interface Observation {
  id: number;
  project: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  narrative: string | null;
  facts: string[];
  concepts: string[];
  filesRead: string[];
  filesModified: string[];
  agentType: string | null;
  createdAt: string;
}

export interface SessionSummary {
  id: number;
  project: string;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  nextSteps: string | null;
  filesRead: string[];
  filesEdited: string[];
  notes: string | null;
  createdAt: string;
}

export interface ProjectEntry {
  project: string;
  count: number;
  lastAt: string;
}

export interface StoreStatus {
  available: boolean;
  degraded: boolean;
  dbPath: string;
  counts?: { observations: number; summaries: number; projects: number };
}

function close(): void {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  db = null;
  openedInode = null;
}

/**
 * Return a usable readonly DB handle, or null if the file is absent/unopenable.
 * Reopens transparently if the on-disk inode changed since we opened (rebuild).
 */
function getDb(): Database.Database | null {
  let ino: number;
  try {
    ino = fs.statSync(DB_PATH).ino;
  } catch {
    // File missing → feature simply unavailable. Drop any stale handle.
    close();
    return null;
  }

  if (db && openedInode === ino) return db;
  if (db && openedInode !== ino) close(); // rebuilt under us → reopen

  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    db.pragma('query_only = true');
    openedInode = ino;
    degraded = false;
    return db;
  } catch (err) {
    log.warn({ err, dbPath: DB_PATH }, 'failed to open claude-mem db');
    close();
    return null;
  }
}

/** Run a read query, degrading (not throwing) on schema drift / IO error. */
function safeQuery<T>(fn: (d: Database.Database) => T, fallback: T): T {
  const d = getDb();
  if (!d) return fallback;
  try {
    return fn(d);
  } catch (err) {
    log.warn({ err }, 'claude-mem query failed — degrading');
    degraded = true;
    // An IO-class failure may mean the handle went bad; drop it so the next
    // call reopens.
    if (err instanceof Error && /SQLITE_(IOERR|CORRUPT|NOTADB|READONLY)/.test(err.message)) close();
    return fallback;
  }
}

function safeJsonArray(s: unknown): string[] {
  if (typeof s !== 'string' || s.length === 0) return [];
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

interface ObsRow {
  id: number;
  project: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  narrative: string | null;
  facts: string | null;
  concepts: string | null;
  files_read: string | null;
  files_modified: string | null;
  agent_type: string | null;
  created_at: string;
}

function mapObs(r: ObsRow): Observation {
  return {
    id: r.id,
    project: r.project,
    type: r.type,
    title: r.title,
    subtitle: r.subtitle,
    narrative: r.narrative,
    facts: safeJsonArray(r.facts),
    concepts: safeJsonArray(r.concepts),
    filesRead: safeJsonArray(r.files_read),
    filesModified: safeJsonArray(r.files_modified),
    agentType: r.agent_type,
    createdAt: r.created_at,
  };
}

const OBS_COLS =
  'o.id, o.project, o.type, o.title, o.subtitle, o.narrative, o.facts, o.concepts, o.files_read, o.files_modified, o.agent_type, o.created_at';

/**
 * Build the shared WHERE fragment + bound params for both the list and the
 * COUNT query so they can never drift. When `q` is given the caller adds the
 * FTS join; the fragment below only covers project/type equality filters.
 */
function buildFilters(opts: { project?: string; types?: string[] }): {
  clause: string;
  params: Record<string, unknown>;
} {
  const parts: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.project) {
    parts.push('o.project = @project');
    params.project = opts.project;
  }
  if (opts.types && opts.types.length > 0) {
    const placeholders = opts.types.map((_, i) => `@type${i}`);
    opts.types.forEach((t, i) => {
      params[`type${i}`] = t;
    });
    parts.push(`o.type IN (${placeholders.join(', ')})`);
  }
  return { clause: parts.length ? parts.join(' AND ') : '', params };
}

/**
 * Turn raw user text into a safe FTS5 prefix query, or null if nothing usable.
 * Each token is double-quoted (escaping `"`) THEN suffixed with `*` for prefix
 * matching — `"<tok>"*`. Quoting alone is an exact term; the trailing `*` is
 * what makes it a prefix. Returns null for empty/whitespace/punctuation-only
 * input so callers fall back to a plain list (never `MATCH ''`, which throws).
 */
function buildFtsMatch(q: string): string | null {
  const tokens = q
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '').trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(' ');
}

export function listObservations(opts: {
  project?: string;
  types?: string[];
  q?: string;
  limit: number;
  offset: number;
}): { items: Observation[]; total: number } {
  return safeQuery(
    (d) => {
      const { clause, params } = buildFilters(opts);
      const match = opts.q ? buildFtsMatch(opts.q) : null;

      const where: string[] = [];
      const p: Record<string, unknown> = { ...params };
      let join = '';
      if (match) {
        join = 'JOIN observations_fts f ON f.rowid = o.id';
        where.push('observations_fts MATCH @match');
        p.match = match;
      }
      if (clause) where.push(clause);
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const total = (
        d.prepare(`SELECT COUNT(*) AS c FROM observations o ${join} ${whereSql}`).get(p) as {
          c: number;
        }
      ).c;

      const rows = d
        .prepare(
          `SELECT ${OBS_COLS} FROM observations o ${join} ${whereSql}
           ORDER BY o.created_at_epoch DESC LIMIT @limit OFFSET @offset`
        )
        .all({ ...p, limit: opts.limit, offset: opts.offset }) as ObsRow[];

      return { items: rows.map(mapObs), total };
    },
    { items: [], total: 0 }
  );
}

export function getObservation(id: number): Observation | null {
  return safeQuery((d) => {
    const row = d.prepare(`SELECT ${OBS_COLS} FROM observations o WHERE o.id = @id`).get({ id }) as
      | ObsRow
      | undefined;
    return row ? mapObs(row) : null;
  }, null);
}

interface SumRow {
  id: number;
  project: string;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
  files_read: string | null;
  files_edited: string | null;
  notes: string | null;
  created_at: string;
}

export function listSessionSummaries(opts: {
  project?: string;
  limit: number;
  offset: number;
}): { items: SessionSummary[]; total: number } {
  return safeQuery(
    (d) => {
      const whereSql = opts.project ? 'WHERE project = @project' : '';
      const p: Record<string, unknown> = opts.project ? { project: opts.project } : {};
      const total = (
        d.prepare(`SELECT COUNT(*) AS c FROM session_summaries ${whereSql}`).get(p) as { c: number }
      ).c;
      const rows = d
        .prepare(
          `SELECT id, project, request, investigated, learned, completed, next_steps,
                  files_read, files_edited, notes, created_at
           FROM session_summaries ${whereSql}
           ORDER BY created_at_epoch DESC LIMIT @limit OFFSET @offset`
        )
        .all({ ...p, limit: opts.limit, offset: opts.offset }) as SumRow[];
      const items: SessionSummary[] = rows.map((r) => ({
        id: r.id,
        project: r.project,
        request: r.request,
        investigated: r.investigated,
        learned: r.learned,
        completed: r.completed,
        nextSteps: r.next_steps,
        filesRead: safeJsonArray(r.files_read),
        filesEdited: safeJsonArray(r.files_edited),
        notes: r.notes,
        createdAt: r.created_at,
      }));
      return { items, total };
    },
    { items: [], total: 0 }
  );
}

export function listProjects(): ProjectEntry[] {
  return safeQuery((d) => {
    const rows = d
      .prepare(
        `SELECT project, COUNT(*) AS count, MAX(created_at) AS lastAt
         FROM observations GROUP BY project ORDER BY MAX(created_at_epoch) DESC`
      )
      .all() as ProjectEntry[];
    return rows;
  }, []);
}

export function getStatus(): StoreStatus {
  const d = getDb();
  if (!d) return { available: false, degraded: false, dbPath: DB_PATH };
  const counts = safeQuery(
    (db2) => ({
      observations: (db2.prepare('SELECT COUNT(*) AS c FROM observations').get() as { c: number }).c,
      summaries: (db2.prepare('SELECT COUNT(*) AS c FROM session_summaries').get() as { c: number })
        .c,
      projects: (
        db2.prepare('SELECT COUNT(DISTINCT project) AS c FROM observations').get() as { c: number }
      ).c,
    }),
    { observations: 0, summaries: 0, projects: 0 }
  );
  return { available: true, degraded, dbPath: DB_PATH, counts };
}

/** For graceful shutdown. */
export function closeClaudeMemStore(): void {
  close();
}
