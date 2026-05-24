/**
 * E2E: launches real headless chromium via SessionManager and verifies
 * screencast frames are delivered. Skipped if chromium binary missing.
 *
 * Run: npx vitest run src/__tests__/browser-chrome-e2e.test.ts
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as http from 'http';
import { AddressInfo } from 'net';
import { chromium } from 'playwright';
import { browserChromeSessions } from '../browser-chrome/session-manager';
import { startScreencast } from '../browser-chrome/screencast';

// Skip if chromium binary not installed locally — keeps CI green when
// `npx playwright install chromium` hasn't run.
let chromiumAvailable = false;
try {
  const path = chromium.executablePath();
  chromiumAvailable = !!path;
} catch {
  chromiumAvailable = false;
}

describe.skipIf(!chromiumAvailable)('browser-chrome e2e (real chromium)', () => {
  let upstream: http.Server;
  let upstreamPort = 0;

  // Minimal mock WS that captures sent messages — avoids needing a real
  // server/client pair just to verify screencast delivers frames.
  function mockWs(): { sent: string[]; ws: object } {
    const sent: string[] = [];
    const ws = {
      readyState: 1, // OPEN
      bufferedAmount: 0,
      send: (data: string) => sent.push(data),
      close: () => { (ws as { readyState: number }).readyState = 3; },
    };
    return { sent, ws };
  }

  afterAll(async () => {
    await browserChromeSessions.destroyAll();
    if (upstream) await new Promise<void>(r => upstream.close(() => r()));
  }, 30_000);

  it('starts chromium, navigates to local server, and delivers screencast frames', async () => {
    upstream = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      // Animated page is required — CDP screencast only emits frames on
      // visual change, a fully static page yields zero frames.
      res.end(`<html><body style="background:#f00;font-size:48px">
        <div id="c">0</div>
        <script>let n=0;setInterval(()=>{document.getElementById('c').textContent=++n},50)</script>
      </body></html>`);
    });
    await new Promise<void>(r => upstream.listen(0, '127.0.0.1', r));
    upstreamPort = (upstream.address() as AddressInfo).port;

    const session = await browserChromeSessions.getOrCreate('e2e-user');
    expect(session.sid).toBeTruthy();
    expect(session.username).toBe('e2e-user');

    await session.page.goto(`http://127.0.0.1:${upstreamPort}/`, { waitUntil: 'load' });
    expect(session.page.url()).toContain('127.0.0.1');

    const { sent, ws } = mockWs();
    const stop = await startScreencast(session, ws as never);

    // Wait for at least 1 frame (chromium usually emits within 200ms after page paints).
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no frame in 3s')), 3000);
      const i = setInterval(() => {
        if (sent.length > 0) { clearTimeout(t); clearInterval(i); resolve(); }
      }, 50);
    });

    expect(sent.length).toBeGreaterThan(0);
    const msg = JSON.parse(sent[0]);
    expect(msg.type).toBe('frame');
    expect(msg.format).toBe('jpeg');
    expect(typeof msg.data).toBe('string');
    expect(msg.data.length).toBeGreaterThan(100);

    await stop();
  }, 30_000);

  it('reuses session for same user', async () => {
    const a = await browserChromeSessions.getOrCreate('reuse-user');
    const b = await browserChromeSessions.getOrCreate('reuse-user');
    expect(a.sid).toBe(b.sid);
  }, 30_000);

  it('forwards keyboard input to a focused <input>', async () => {
    const port = (upstream.address() as AddressInfo).port;
    const session = await browserChromeSessions.getOrCreate('e2e-user');
    // Same dummy server has an animated body; mount a page with an input.
    await session.page.setContent(`<!doctype html><html><body>
      <input id="x" autofocus style="width:300px;font-size:24px"/>
    </body></html>`);
    await session.page.focus('#x');

    const { handleInput } = await import('../browser-chrome/input-forwarder');
    // type some plain text
    await handleInput(session, { type: 'type', text: 'hello' });
    expect(await session.page.$eval('#x', (el: unknown) => (el as { value: string }).value)).toBe('hello');
    // named key — Backspace clears last char
    await handleInput(session, { type: 'key', action: 'press', key: 'Backspace' });
    expect(await session.page.$eval('#x', (el: unknown) => (el as { value: string }).value)).toBe('hell');
    // shifted char via 'type' (matches frontend: Shift+letter sent as text='X')
    await handleInput(session, { type: 'type', text: 'X' });
    expect(await session.page.$eval('#x', (el: unknown) => (el as { value: string }).value)).toBe('hellX');
    // arrow key navigation
    await handleInput(session, { type: 'key', action: 'press', key: 'Home' });
    await handleInput(session, { type: 'key', action: 'press', key: 'Delete' });
    expect(await session.page.$eval('#x', (el: unknown) => (el as { value: string }).value)).toBe('ellX');

    void port;
  }, 30_000);

  it('isolates pages between users and enforces SessionLimitError at the 4th user', async () => {
    // Earlier tests leave 'e2e-user' + 'reuse-user' alive at the time this
    // runs. Drop everything to a clean slate so we can deterministically
    // verify the cap, then re-establish 'e2e-user' afterwards.
    await browserChromeSessions.destroyAll(2000);
    const { SessionLimitError } = await import('../browser-chrome/session-manager');

    const userA = await browserChromeSessions.getOrCreate('user-a');
    const userB = await browserChromeSessions.getOrCreate('user-b');
    const userC = await browserChromeSessions.getOrCreate('user-c');
    expect(userA.sid).toBeTruthy();
    // user-b and user-c distinct from each other and from e2e-user.
    const sidSet = new Set([userB.sid, userC.sid]);
    expect(sidSet.size).toBe(2);

    // Set distinct content per session and confirm pages don't share state.
    await userB.page.setContent('<title>B-PAGE</title><body>BBB</body>');
    await userC.page.setContent('<title>C-PAGE</title><body>CCC</body>');
    expect(await userB.page.title()).toBe('B-PAGE');
    expect(await userC.page.title()).toBe('C-PAGE');

    // 4th distinct user hits the cap.
    let caught: unknown = null;
    try {
      await browserChromeSessions.getOrCreate('user-d');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SessionLimitError);

    // Reusing an existing user still works even at the cap.
    const userBAgain = await browserChromeSessions.getOrCreate('user-b');
    expect(userBAgain.sid).toBe(userB.sid);

    // Cleanup: free everyone so the next test starts under the cap.
    await browserChromeSessions.destroy(userA.sid);
    await browserChromeSessions.destroy(userB.sid);
    await browserChromeSessions.destroy(userC.sid);
  }, 60_000);

  it('forwards IME-committed CJK text via type msg', async () => {
    const session = await browserChromeSessions.getOrCreate('e2e-user');
    await session.page.setContent(`<!doctype html><html><body>
      <input id="cn" autofocus style="width:400px;font-size:24px"/>
    </body></html>`);
    await session.page.focus('#cn');

    const { handleInput } = await import('../browser-chrome/input-forwarder');
    // Simulates what the frontend sends on compositionend: the final composed
    // CJK string as a single 'type' msg (rather than per-keystroke 'key').
    await handleInput(session, { type: 'type', text: '你好世界' });
    expect(await session.page.$eval('#cn', (el: unknown) => (el as { value: string }).value)).toBe('你好世界');

    // Mix CJK + ASCII as IME often does (user types '你好' then ASCII 'foo').
    await handleInput(session, { type: 'type', text: 'foo' });
    expect(await session.page.$eval('#cn', (el: unknown) => (el as { value: string }).value)).toBe('你好世界foo');
  }, 30_000);

  it('resize updates viewport and persists on session', async () => {
    const session = await browserChromeSessions.getOrCreate('e2e-user');
    const { handleInput } = await import('../browser-chrome/input-forwarder');
    await handleInput(session, { type: 'resize', w: 800, h: 600 });
    expect(session.viewport).toEqual({ w: 800, h: 600 });
    const dims = await session.page.evaluate(() => ({
      w: (globalThis as unknown as { innerWidth: number }).innerWidth,
      h: (globalThis as unknown as { innerHeight: number }).innerHeight,
    }));
    expect(dims.w).toBe(800);
    expect(dims.h).toBe(600);
  }, 30_000);
});
