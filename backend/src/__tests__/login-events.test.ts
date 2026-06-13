/**
 * Tests the durable login audit + the login-event emitter that drives the
 * real-time "new login" alert. CCWEB_DATA_DIR is set BEFORE import (config.ts
 * captures DATA_DIR at load; login-events.ts derives its audit path from it).
 *
 * Run: npx vitest run src/__tests__/login-events.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmp: string;
let LE: typeof import('../login-events');

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccweb-login-test-'));
  process.env.CCWEB_DATA_DIR = tmp;
  LE = await import('../login-events');
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('login audit', () => {
  it('appends one JSONL record per login, preserving IP + user agent', () => {
    LE.recordLoginAudit({ username: 'zhang', ip: '1.2.3.4', userAgent: 'UA-1', at: '2026-06-13T05:00:00.000Z' });
    LE.recordLoginAudit({ username: 'zhang', ip: '5.6.7.8', userAgent: 'UA-2', at: '2026-06-13T05:01:00.000Z' });

    const file = path.join(tmp, 'login-audit.jsonl');
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first).toEqual({ username: 'zhang', ip: '1.2.3.4', userAgent: 'UA-1', at: '2026-06-13T05:00:00.000Z' });
    const second = JSON.parse(lines[1]);
    expect(second.ip).toBe('5.6.7.8');
  });

  it('records failed attempts with result:"fail" (brute-force forensic signal)', () => {
    LE.recordLoginAudit({ username: 'attacker', ip: '6.6.6.6', userAgent: 'UA-x', at: '2026-06-13T05:03:00.000Z', result: 'fail' });
    const file = path.join(tmp, 'login-audit.jsonl');
    const last = JSON.parse(fs.readFileSync(file, 'utf-8').trim().split('\n').pop()!);
    expect(last.result).toBe('fail');
    expect(last.ip).toBe('6.6.6.6');
  });
});

describe('loginEvents emitter', () => {
  it('delivers the login payload to subscribers (alert fan-out source)', () => {
    const seen: unknown[] = [];
    LE.loginEvents.on('login', (e) => seen.push(e));

    const ev = { username: 'zhang', ip: '9.9.9.9', userAgent: 'UA-3', at: '2026-06-13T05:02:00.000Z' };
    LE.loginEvents.emit('login', ev);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(ev);
  });
});
