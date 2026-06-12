/**
 * Unit tests for the read-only claude-mem store against a synthetic temp DB
 * (minimal subset of the real claude-mem schema). No hardcoded counts against
 * the real DB — everything is built fresh here.
 *
 * Run: npx vitest run src/__tests__/claude-mem-store.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir: string;
let dbPath: string;
let store: typeof import('../claude-mem-store');

const BASE = 1700000000000;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccweb-cm-test-'));
  dbPath = path.join(tmpDir, 'claude-mem.db');

  const db = new Database(dbPath);
  db.pragma('journal_mode = wal');
  db.exec(`
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_session_id TEXT,
      project TEXT NOT NULL,
      text TEXT,
      type TEXT NOT NULL,
      title TEXT, subtitle TEXT, narrative TEXT,
      facts TEXT, concepts TEXT, files_read TEXT, files_modified TEXT,
      agent_type TEXT,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE observations_fts USING fts5(
      title, subtitle, narrative, text, facts, concepts,
      content='observations', content_rowid='id'
    );
    CREATE TABLE session_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      request TEXT, investigated TEXT, learned TEXT, completed TEXT, next_steps TEXT,
      files_read TEXT, files_edited TEXT, notes TEXT,
      created_at TEXT NOT NULL, created_at_epoch INTEGER NOT NULL
    );
  `);

  const insObs = db.prepare(`INSERT INTO observations
    (project,text,type,title,subtitle,narrative,facts,concepts,files_read,files_modified,agent_type,created_at,created_at_epoch)
    VALUES (@project,@text,@type,@title,@subtitle,@narrative,@facts,@concepts,@files_read,@files_modified,@agent_type,@created_at,@created_at_epoch)`);

  insObs.run({
    project: 'cc-web', text: 'host stats endpoint added', type: 'feature',
    title: 'Add host stats', subtitle: 'CPU mem disk', narrative: 'n1',
    facts: JSON.stringify(['fact a', 'fact b']), concepts: JSON.stringify(['how-it-works']),
    files_read: '[]', files_modified: JSON.stringify(['a.ts']), agent_type: null,
    created_at: new Date(BASE + 3000).toISOString(), created_at_epoch: BASE + 3000,
  });
  insObs.run({
    project: 'cc-web', text: 'fix the race', type: 'bugfix',
    title: 'Fix race', subtitle: null, narrative: 'n2',
    facts: 'THIS IS NOT VALID JSON', concepts: '[]', files_read: '[]', files_modified: '[]',
    agent_type: 'Explore',
    created_at: new Date(BASE + 2000).toISOString(), created_at_epoch: BASE + 2000,
  });
  insObs.run({
    project: 'other-proj', text: 'unrelated work', type: 'discovery',
    title: 'Other thing', subtitle: null, narrative: 'n3',
    facts: '[]', concepts: '[]', files_read: '[]', files_modified: '[]', agent_type: null,
    created_at: new Date(BASE + 1000).toISOString(), created_at_epoch: BASE + 1000,
  });
  // Repopulate FTS from the (external-content) observations table.
  db.prepare(`INSERT INTO observations_fts(observations_fts) VALUES('rebuild')`).run();

  db.prepare(`INSERT INTO session_summaries
    (project,request,learned,next_steps,files_read,files_edited,notes,created_at,created_at_epoch)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run('cc-web', 'req', 'learned things', 'do next', '[]', JSON.stringify(['b.ts']), 'note',
      new Date(BASE).toISOString(), BASE);

  db.close();

  process.env.CCWEB_CLAUDE_MEM_DB = dbPath;
  store = await import('../claude-mem-store');
});

afterAll(() => {
  store.closeClaudeMemStore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('claude-mem-store', () => {
  it('reports available with counts', () => {
    const s = store.getStatus();
    expect(s.available).toBe(true);
    expect(s.degraded).toBe(false);
    expect(s.counts).toEqual({ observations: 3, summaries: 1, projects: 2 });
  });

  it('lists all observations newest-first', () => {
    const r = store.listObservations({ limit: 30, offset: 0 });
    expect(r.total).toBe(3);
    expect(r.items.map((o) => o.title)).toEqual(['Add host stats', 'Fix race', 'Other thing']);
  });

  it('parses JSON array fields and tolerates bad JSON', () => {
    const r = store.listObservations({ limit: 30, offset: 0 });
    const feature = r.items.find((o) => o.title === 'Add host stats')!;
    expect(feature.facts).toEqual(['fact a', 'fact b']);
    expect(feature.filesModified).toEqual(['a.ts']);
    const bug = r.items.find((o) => o.title === 'Fix race')!;
    expect(bug.facts).toEqual([]); // invalid JSON degrades to []
  });

  it('filters by project', () => {
    const r = store.listObservations({ project: 'cc-web', limit: 30, offset: 0 });
    expect(r.total).toBe(2);
    expect(r.items.every((o) => o.project === 'cc-web')).toBe(true);
  });

  it('filters by type', () => {
    const r = store.listObservations({ types: ['bugfix'], limit: 30, offset: 0 });
    expect(r.total).toBe(1);
    expect(r.items[0].title).toBe('Fix race');
  });

  it('FTS prefix search matches on indexed columns incl. text', () => {
    const exact = store.listObservations({ q: 'host', limit: 30, offset: 0 });
    expect(exact.total).toBe(1);
    expect(exact.items[0].title).toBe('Add host stats');
    // prefix: "hos" should still match "host" via the trailing *
    const prefix = store.listObservations({ q: 'hos', limit: 30, offset: 0 });
    expect(prefix.total).toBe(1);
  });

  it('whitespace/punctuation-only query falls back to plain list (no MATCH error)', () => {
    expect(store.listObservations({ q: '   ', limit: 30, offset: 0 }).total).toBe(3);
    expect(store.listObservations({ q: '""', limit: 30, offset: 0 }).total).toBe(3);
  });

  it('paginates', () => {
    const p0 = store.listObservations({ limit: 1, offset: 0 });
    expect(p0.items).toHaveLength(1);
    expect(p0.total).toBe(3);
    const p1 = store.listObservations({ limit: 1, offset: 1 });
    expect(p1.items[0].title).toBe('Fix race');
  });

  it('gets a single observation, null for missing', () => {
    const all = store.listObservations({ limit: 30, offset: 0 });
    const one = store.getObservation(all.items[0].id);
    expect(one?.title).toBe('Add host stats');
    expect(store.getObservation(999999)).toBeNull();
  });

  it('lists projects with counts', () => {
    const projects = store.listProjects();
    expect(projects.map((p) => p.project).sort()).toEqual(['cc-web', 'other-proj']);
    expect(projects.find((p) => p.project === 'cc-web')!.count).toBe(2);
  });

  it('lists session summaries with parsed file arrays', () => {
    const r = store.listSessionSummaries({ limit: 30, offset: 0 });
    expect(r.total).toBe(1);
    expect(r.items[0].nextSteps).toBe('do next');
    expect(r.items[0].filesEdited).toEqual(['b.ts']);
  });
});

describe('claude-mem-store (missing db)', () => {
  it('reports unavailable and returns empty, no throw', async () => {
    vi.resetModules();
    const prev = process.env.CCWEB_CLAUDE_MEM_DB;
    process.env.CCWEB_CLAUDE_MEM_DB = path.join(tmpDir, 'nope.db');
    const fresh = await import('../claude-mem-store');
    expect(fresh.getStatus().available).toBe(false);
    expect(fresh.listObservations({ limit: 30, offset: 0 })).toEqual({ items: [], total: 0 });
    expect(fresh.listProjects()).toEqual([]);
    process.env.CCWEB_CLAUDE_MEM_DB = prev;
    vi.resetModules();
  });
});
