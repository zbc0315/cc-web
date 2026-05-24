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
});
