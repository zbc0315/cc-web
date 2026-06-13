/**
 * Tests for the per-project sync refactor: remote-path validation (security),
 * dirty mtime detection, projectPaths/lastSyncAt storage, and the remoteRoot→
 * projectPaths migration.
 *
 * CCWEB_DATA_DIR is pointed at a temp dir BEFORE importing the modules (config.ts
 * captures DATA_DIR at module load).
 *
 * Run: npx vitest run src/__tests__/sync-refactor.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmp: string;
let SC: typeof import('../sync-config');
let SS: typeof import('../sync-state');
let SD: typeof import('../sync-dirty');
let SM: typeof import('../sync-migrate');

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccweb-sync-test-'));
  process.env.CCWEB_DATA_DIR = tmp;
  SC = await import('../sync-config');
  SS = await import('../sync-state');
  SD = await import('../sync-dirty');
  SM = await import('../sync-migrate');
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Build a fresh project tree per test to avoid cross-test mtime coupling.
function makeProj(name: string): string {
  const root = path.join(tmp, 'projs', name);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'x');
  fs.writeFileSync(path.join(root, 'keep.txt'), 'y');
  fs.writeFileSync(path.join(root, 'node_modules', 'lib', 'index.js'), 'z');
  return root;
}
function setMtime(p: string, ms: number): void {
  const d = new Date(ms);
  fs.utimesSync(p, d, d);
}

describe('isValidRemotePath (remote-path injection guard)', () => {
  it('accepts absolute clean paths', () => {
    expect(SC.isValidRemotePath('/home/me/backups/proj')).toBe(true);
    expect(SC.isValidRemotePath('/srv/data')).toBe(true);
    expect(SC.isValidRemotePath('/a/b-c_d.e')).toBe(true);
  });
  it('rejects empty / relative / ~', () => {
    expect(SC.isValidRemotePath('')).toBe(false);
    expect(SC.isValidRemotePath(null)).toBe(false);
    expect(SC.isValidRemotePath(undefined)).toBe(false);
    expect(SC.isValidRemotePath('relative/path')).toBe(false);
    expect(SC.isValidRemotePath('~/x')).toBe(false);
  });
  it('rejects whitespace, glob, and shell metacharacters', () => {
    const bad = [
      '/a b', '/a\tb', '/a\nb', '/a\x00b',
      '/a;rm', '/a|b', '/a&b', '/a$(x)', '/a`x`', '/a<b', '/a>b',
      '/a*', '/a?', '/a[b]', '/a{b}', "/a'b", '/a"b', '/a\\b',
    ];
    for (const p of bad) expect(SC.isValidRemotePath(p), p).toBe(false);
  });
  it('rejects over-long paths', () => {
    expect(SC.isValidRemotePath('/' + 'a'.repeat(2000))).toBe(false);
  });
});

describe('computeDirty (mtime, push-only, excludes)', () => {
  it('clean when lastSyncAt is in the future', () => {
    const p = makeProj('clean');
    expect(SD.computeDirty(p, ['node_modules/'], Date.now() + 60_000)).toBe(false);
  });
  it('dirty when a tracked file is newer than lastSyncAt', () => {
    const p = makeProj('dirty');
    expect(SD.computeDirty(p, ['node_modules/'], Date.now() - 60_000)).toBe(true);
  });
  it('lastSyncAt=0 (never synced) → dirty', () => {
    const p = makeProj('never');
    expect(SD.computeDirty(p, [], 0)).toBe(true);
  });
  it('changes inside an excluded dir do NOT count', () => {
    const p = makeProj('excluded');
    const old = Date.now() - 120_000;
    setMtime(path.join(p, 'src', 'a.ts'), old);
    setMtime(path.join(p, 'keep.txt'), old);
    // node_modules/lib/index.js stays "now" (newer) but is excluded
    expect(SD.computeDirty(p, ['node_modules/'], Date.now() - 60_000)).toBe(false);
  });
  it('glob exclude (*.log) is honored', () => {
    const p = makeProj('glob');
    const old = Date.now() - 120_000;
    setMtime(path.join(p, 'src', 'a.ts'), old);
    setMtime(path.join(p, 'keep.txt'), old);
    fs.writeFileSync(path.join(p, 'debug.log'), 'log'); // now, but excluded by *.log
    expect(SD.computeDirty(p, ['node_modules/', '*.log'], Date.now() - 60_000)).toBe(false);
  });
  it('ignores future-dated files (no permanent dirty pin)', () => {
    const p = makeProj('future');
    const old = Date.now() - 120_000;
    setMtime(path.join(p, 'src', 'a.ts'), old);
    setMtime(path.join(p, 'keep.txt'), old);
    setMtime(path.join(p, 'node_modules', 'lib', 'index.js'), old);
    const f = path.join(p, 'future.txt');
    fs.writeFileSync(f, 'f');
    setMtime(f, Date.now() + 3_600_000);
    expect(SD.computeDirty(p, ['node_modules/'], Date.now() - 60_000)).toBe(false);
  });
});

describe('projectPaths storage', () => {
  it('default config has empty projectPaths', () => {
    expect(SC.getSyncConfig('u1').projectPaths).toEqual({});
  });
  it('set/get round-trip + clear', () => {
    SC.setProjectPath('u1', 'pid1', '/remote/p1');
    expect(SC.getProjectPath(SC.getSyncConfig('u1'), 'pid1')).toBe('/remote/p1');
    SC.setProjectPath('u1', 'pid1', '');
    expect(SC.getProjectPath(SC.getSyncConfig('u1'), 'pid1')).toBe('');
  });
});

describe('sync-state lastSyncAt', () => {
  it('round-trips per user/project', () => {
    expect(SS.getLastSyncAt('u2', 'p')).toBe(0);
    SS.setLastSyncAt('u2', 'p', 12345);
    expect(SS.getLastSyncAt('u2', 'p')).toBe(12345);
    expect(SS.getAllLastSyncAt('u2')).toEqual({ p: 12345 });
  });
});

describe('migrateRemoteRootToProjectPaths', () => {
  function writeProjects(projects: unknown[]): void {
    fs.writeFileSync(path.join(tmp, 'projects.json'), JSON.stringify(projects));
  }
  const baseProj = (over: Record<string, unknown>) => ({
    permissionMode: 'limited', cliTool: 'claude', createdAt: '2026-06-13', status: 'stopped', ...over,
  });

  it('seeds owned projects from remoteRoot, skips invalid (spaced) names, idempotent', () => {
    writeProjects([
      baseProj({ id: 'mp1', name: 'myproj', folderPath: '/x/myproj', owner: 'mu' }),
      baseProj({ id: 'mp2', name: 'My Proj', folderPath: '/x/My Proj', owner: 'mu' }), // space → skipped
      baseProj({ id: 'mp3', name: 'other', folderPath: '/x/other', owner: 'someone-else' }), // not owned
    ]);
    SC.setSyncConfig({ username: 'mu', ...SC.DEFAULT_CONFIG, remoteRoot: '/remote/base' });

    SM.migrateRemoteRootToProjectPaths();

    const cfg = SC.getSyncConfig('mu');
    expect(cfg.projectPaths['mp1']).toBe('/remote/base/myproj');
    expect(cfg.projectPaths['mp2']).toBeUndefined(); // spaced name not seeded (invalid)
    expect(cfg.projectPaths['mp3']).toBeUndefined(); // not owned

    // Idempotent: a second run does not change anything
    SM.migrateRemoteRootToProjectPaths();
    expect(SC.getSyncConfig('mu').projectPaths).toEqual({ mp1: '/remote/base/myproj' });
    // The one-shot marker is set so it never runs again.
    expect(SC.getSyncConfig('mu').projectPathsMigrated).toBe(true);
  });

  it('never re-seeds after the user clears all paths (resurrection guard)', () => {
    writeProjects([baseProj({ id: 'rp1', name: 'res', folderPath: '/x/res', owner: 'ru' })]);
    SC.setSyncConfig({ username: 'ru', ...SC.DEFAULT_CONFIG, remoteRoot: '/remote/base' });
    SM.migrateRemoteRootToProjectPaths();
    expect(SC.getSyncConfig('ru').projectPaths).toEqual({ rp1: '/remote/base/res' });
    // User deliberately clears the path; remoteRoot stays.
    SC.setProjectPath('ru', 'rp1', '');
    expect(SC.getSyncConfig('ru').projectPaths).toEqual({});
    // Next boot must NOT re-seed (marker already set).
    SM.migrateRemoteRootToProjectPaths();
    expect(SC.getSyncConfig('ru').projectPaths).toEqual({});
  });

  it('does nothing for a user without remoteRoot', () => {
    SC.setSyncConfig({ username: 'noroot', ...SC.DEFAULT_CONFIG, remoteRoot: '' });
    SM.migrateRemoteRootToProjectPaths();
    expect(SC.getSyncConfig('noroot').projectPaths).toEqual({});
  });
});
