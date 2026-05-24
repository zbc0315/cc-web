import { describe, it, expect } from 'vitest';
import * as jwt from 'jsonwebtoken';
import { mintSessionToken, verifySessionToken } from '../browser-chrome/session-manager';
import { getConfig } from '../config';

describe('mintSessionToken / verifySessionToken', () => {
  it('round-trips a valid token', () => {
    const token = mintSessionToken('sid-1', 'tom');
    const claim = verifySessionToken(token);
    expect(claim).toEqual({ sid: 'sid-1', username: 'tom' });
  });

  it('rejects token with wrong typ', () => {
    const config = getConfig();
    const wrongTyp = jwt.sign({ sid: 'x', username: 'tom', typ: 'user' }, config.jwtSecret, { expiresIn: '1h' });
    expect(verifySessionToken(wrongTyp)).toBeNull();
  });

  it('rejects token signed with wrong secret', () => {
    const wrong = jwt.sign({ sid: 'x', username: 'tom', typ: 'browser-chrome' }, 'wrong-secret', { expiresIn: '1h' });
    expect(verifySessionToken(wrong)).toBeNull();
  });

  it('rejects token missing sid or username', () => {
    const config = getConfig();
    const noSid = jwt.sign({ username: 'tom', typ: 'browser-chrome' }, config.jwtSecret, { expiresIn: '1h' });
    expect(verifySessionToken(noSid)).toBeNull();
    const noUser = jwt.sign({ sid: 'x', typ: 'browser-chrome' }, config.jwtSecret, { expiresIn: '1h' });
    expect(verifySessionToken(noUser)).toBeNull();
  });

  it('rejects malformed token', () => {
    expect(verifySessionToken('not-a-jwt')).toBeNull();
    expect(verifySessionToken('')).toBeNull();
  });
});

// Pure-logic tests for input-forwarder require it to export sanitize helpers
// or accept a mock page. We test sanitize/clamp behavior indirectly by
// constructing edge-case messages and asserting they don't throw with a
// minimal mock Page.

describe('handleInput (with mock page)', () => {
  // Lazy import to avoid pulling playwright at module load.
  it('clamps out-of-range click coords and ignores invalid modifiers', async () => {
    const calls: Array<[string, ...unknown[]]> = [];
    const mockPage = {
      mouse: {
        click: async (x: number, y: number, opts: { button: string }) => { calls.push(['click', x, y, opts.button]); },
        move: async () => { calls.push(['move']); },
        wheel: async (dx: number, dy: number) => { calls.push(['wheel', dx, dy]); },
      },
      keyboard: {
        down: async (k: string) => { calls.push(['kd', k]); },
        up: async (k: string) => { calls.push(['ku', k]); },
        press: async (k: string) => { calls.push(['kp', k]); },
        type: async (t: string) => { calls.push(['type', t]); },
      },
      setViewportSize: async (s: { width: number; height: number }) => { calls.push(['vp', s.width, s.height]); },
    };
    const mockSession = {
      sid: 's', username: 'u', browser: {} as never, context: {} as never,
      page: mockPage as never, cdp: {} as never,
      createdAt: 0, lastActivityAt: 0,
      viewport: { w: 1280, h: 800 }, url: '',
      downloads: new Map(),
    };
    const { handleInput } = await import('../browser-chrome/input-forwarder');

    // Negative coords clamp to 0; over-max clamp to viewport.
    await handleInput(mockSession, { type: 'click', x: -100, y: -50 });
    expect(calls).toContainEqual(['click', 0, 0, 'left']);

    calls.length = 0;
    await handleInput(mockSession, { type: 'click', x: 9999, y: 9999, button: 'right', modifiers: ['Shift', 'EvilMod'] });
    // EvilMod dropped; Shift held around click.
    expect(calls).toEqual([
      ['kd', 'Shift'],
      ['click', 1280, 800, 'right'],
      ['ku', 'Shift'],
    ]);

    // Scroll clamps delta.
    calls.length = 0;
    await handleInput(mockSession, { type: 'scroll', x: 100, y: 100, deltaX: 999999, deltaY: -999999 });
    expect(calls).toEqual([
      ['move'],
      ['wheel', 10000, -10000],
    ]);

    // type with too-long text rejected silently.
    calls.length = 0;
    await handleInput(mockSession, { type: 'type', text: 'x'.repeat(2000) });
    expect(calls).toEqual([]);

    // type with normal text works.
    calls.length = 0;
    await handleInput(mockSession, { type: 'type', text: 'hello' });
    expect(calls).toEqual([['type', 'hello']]);

    // resize clamps to bounds.
    calls.length = 0;
    await handleInput(mockSession, { type: 'resize', w: 50, h: 100000 });
    expect(calls).toEqual([['vp', 200, 2160]]);
    expect(mockSession.viewport).toEqual({ w: 200, h: 2160 });
  });

  it('key event uses press by default and releases modifiers in reverse', async () => {
    const calls: string[] = [];
    const mockPage = {
      mouse: { click: async () => {}, move: async () => {}, wheel: async () => {} },
      keyboard: {
        down: async (k: string) => { calls.push(`d:${k}`); },
        up: async (k: string) => { calls.push(`u:${k}`); },
        press: async (k: string) => { calls.push(`p:${k}`); },
        type: async () => {},
      },
      setViewportSize: async () => {},
    };
    const mockSession = {
      sid: 's', username: 'u', browser: {} as never, context: {} as never,
      page: mockPage as never, cdp: {} as never,
      createdAt: 0, lastActivityAt: 0,
      viewport: { w: 1280, h: 800 }, url: '',
      downloads: new Map(),
    };
    const { handleInput } = await import('../browser-chrome/input-forwarder');

    await handleInput(mockSession, { type: 'key', action: 'press', key: 'a', modifiers: ['Control', 'Shift'] });
    expect(calls).toEqual(['d:Control', 'd:Shift', 'p:a', 'u:Shift', 'u:Control']);
  });

  it('drops key event when key is empty or too long', async () => {
    const calls: string[] = [];
    const mockPage = {
      mouse: { click: async () => {}, move: async () => {}, wheel: async () => {} },
      keyboard: { down: async () => {}, up: async () => {}, press: async (k: string) => { calls.push(k); }, type: async () => {} },
      setViewportSize: async () => {},
    };
    const mockSession = {
      sid: 's', username: 'u', browser: {} as never, context: {} as never,
      page: mockPage as never, cdp: {} as never,
      createdAt: 0, lastActivityAt: 0,
      viewport: { w: 1280, h: 800 }, url: '',
      downloads: new Map(),
    };
    const { handleInput } = await import('../browser-chrome/input-forwarder');

    await handleInput(mockSession, { type: 'key', action: 'press', key: '' });
    await handleInput(mockSession, { type: 'key', action: 'press', key: 'x'.repeat(100) });
    expect(calls).toEqual([]);
  });
});
