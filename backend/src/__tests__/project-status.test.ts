/**
 * Regression: a project rename must survive the daemon writing a lifecycle
 * status change. The terminal-manager holds an in-memory Project captured when
 * the terminal started; before this fix it wrote that whole stale object back
 * (saveProject) on stop/crash/restart/shutdown, reverting a meanwhile rename on
 * the next restart. updateProjectStatus must touch ONLY status.
 *
 * CCWEB_DATA_DIR is set BEFORE import (config.ts captures DATA_DIR at load).
 *
 * Run: npx vitest run src/__tests__/project-status.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Project } from '../types';

let tmp: string;
let C: typeof import('../config');

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccweb-projstatus-test-'));
  process.env.CCWEB_DATA_DIR = tmp;
  C = await import('../config');
  C.initDataDirs();
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function mkProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'original-name',
    folderPath: path.join(tmp, 'p1'),
    permissionMode: 'limited',
    cliTool: 'claude',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'running',
    tags: ['a', 'b'],
    ...over,
  } as Project;
}

describe('updateProjectStatus', () => {
  it('changes only status, preserving a meanwhile rename (the bug)', () => {
    // 1. Terminal starts → registry has the original name, status running.
    C.saveProject(mkProject({ status: 'running' }));

    // 2. User renames the project while the terminal is alive. The on-disk
    //    record now says new-name; the terminal-manager still holds a stale
    //    in-memory Project { name: 'original-name' }.
    const fresh = C.getProject('p1')!;
    fresh.name = 'new-name';
    C.saveProject(fresh);

    // 3. Daemon stops the terminal → status write driven by the STALE object.
    //    updateProjectStatus must merge onto the fresh on-disk record, not
    //    write the stale name back.
    C.updateProjectStatus('p1', 'stopped');

    const after = C.getProject('p1')!;
    expect(after.name).toBe('new-name'); // rename survives
    expect(after.status).toBe('stopped'); // status applied
    expect(after.tags).toEqual(['a', 'b']); // other fields untouched
  });

  it('is a no-op for an unknown id (deleted project mid-lifecycle)', () => {
    expect(() => C.updateProjectStatus('does-not-exist', 'stopped')).not.toThrow();
    expect(C.getProject('does-not-exist')).toBeUndefined();
  });
});
