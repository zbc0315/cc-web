import { chromium, type Browser, type BrowserContext, type Page, type CDPSession, type FileChooser } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import * as jwt from 'jsonwebtoken';
import { getConfig } from '../config';
import { modLogger } from '../logger';

const log = modLogger('browser-chrome');

export interface PendingDownload {
  dlId: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
  createdAt: number;
}

export interface PendingFileChooser {
  chooser: FileChooser;
  createdAt: number;
}

export interface Session {
  sid: string;
  username: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  createdAt: number;
  lastActivityAt: number;
  viewport: { w: number; h: number };
  url: string;
  downloads: Map<string, PendingDownload>;
  pendingChooser: PendingFileChooser | null;
}

const MAX_SESSIONS = 3;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_VIEWPORT = { w: 1280, h: 800 };
const MEMORY_SAMPLE_INTERVAL_MS = 30 * 1000;
const MEMORY_WARN_BYTES = 500 * 1024 * 1024;   // log warn at 500MB JS heap
const MEMORY_HARD_LIMIT_BYTES = 1024 * 1024 * 1024;  // force destroy at 1GB
const SHUTDOWN_GRACE_MS = 5000;
export const MAX_DOWNLOAD_SIZE_BYTES = 100 * 1024 * 1024;  // 100MB per file
export const DOWNLOAD_TTL_MS = 5 * 60 * 1000;

/**
 * Thrown by `getOrCreate` when the global session cap is reached. Routes
 * map this to HTTP 429 so the frontend can surface a friendly "too many
 * concurrent browser sessions, try again later" instead of a generic 500.
 */
export class SessionLimitError extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super(`Max ${limit} browser sessions reached`);
    this.name = 'SessionLimitError';
    this.limit = limit;
  }
}

class SessionManager extends EventEmitter {
  private sessions = new Map<string, Session>();
  private idleTimer: NodeJS.Timeout | null = null;
  private memoryTimer: NodeJS.Timeout | null = null;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.idleTimer = setInterval(() => this.sweepIdle(), 30 * 1000);
    this.memoryTimer = setInterval(() => { void this.sampleMemory(); }, MEMORY_SAMPLE_INTERVAL_MS);
  }

  /** Return existing session for this user (reuse) or create a new one. */
  async getOrCreate(username: string): Promise<Session> {
    this.start();
    for (const s of this.sessions.values()) {
      if (s.username === username) {
        s.lastActivityAt = Date.now();
        return s;
      }
    }
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new SessionLimitError(MAX_SESSIONS);
    }

    const sid = uuidv4();
    let browser: Browser;
    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'],
      });
    } catch (err) {
      log.error({ err }, 'chromium launch failed — is `npx playwright install chromium` done?');
      throw new Error('Chromium not available — run: npx playwright install chromium');
    }
    const context = await browser.newContext({
      viewport: { width: DEFAULT_VIEWPORT.w, height: DEFAULT_VIEWPORT.h },
      userAgent: 'ccweb-browser-chrome/1.0',
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);

    const session: Session = {
      sid, username, browser, context, page, cdp,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      viewport: { ...DEFAULT_VIEWPORT },
      url: 'about:blank',
      downloads: new Map(),
      pendingChooser: null,
    };
    this.sessions.set(sid, session);
    log.info({ sid, username, count: this.sessions.size }, 'session created');

    // Auto-destroy if browser dies underneath us (chromium crash).
    browser.once('disconnected', () => {
      log.warn({ sid }, 'browser disconnected unexpectedly');
      this.sessions.delete(sid);
    });

    return session;
  }

  get(sid: string, username: string): Session | null {
    const s = this.sessions.get(sid);
    if (!s) return null;
    if (s.username !== username) return null;
    s.lastActivityAt = Date.now();
    return s;
  }

  async destroy(sid: string): Promise<void> {
    const s = this.sessions.get(sid);
    if (!s) return;
    this.sessions.delete(sid);
    try {
      await s.cdp.detach().catch(() => {});
      await s.browser.close();
    } catch (err) {
      log.warn({ err, sid }, 'browser close failed');
    }
    log.info({ sid, count: this.sessions.size }, 'session destroyed');
  }

  /**
   * Tear down every session within `gracefulMs`. Playwright doesn't expose
   * the chromium child process via public API (only puppeteer does), so we
   * rely on `browser.close()` to be polite. Anything stuck past the grace
   * window is logged loudly — the daemon's force-exit timeout (process.exit
   * 5s later) will SIGKILL the parent and OS propagates SIGHUP to children.
   * Residual zombie chromium handling deferred to Phase 5.
   */
  async destroyAll(gracefulMs: number = SHUTDOWN_GRACE_MS): Promise<void> {
    const sids = Array.from(this.sessions.keys());
    if (this.idleTimer) clearInterval(this.idleTimer);
    if (this.memoryTimer) clearInterval(this.memoryTimer);
    this.idleTimer = null;
    this.memoryTimer = null;
    this.started = false;

    await Promise.race([
      Promise.all(sids.map(sid => this.destroy(sid))),
      new Promise<void>(r => setTimeout(r, gracefulMs)),
    ]);

    if (this.sessions.size > 0) {
      log.warn(
        { remaining: Array.from(this.sessions.keys()) },
        `${this.sessions.size} chromium session(s) did not close within ${gracefulMs}ms — relying on OS cleanup`,
      );
    }
  }

  size(): number {
    return this.sessions.size;
  }

  private async sampleMemory(): Promise<void> {
    for (const [sid, s] of this.sessions) {
      try {
        const metrics = await s.cdp.send('Performance.getMetrics');
        const heap = metrics.metrics.find(m => m.name === 'JSHeapUsedSize');
        if (!heap) continue;
        const bytes = heap.value;
        if (bytes > MEMORY_HARD_LIMIT_BYTES) {
          log.error({ sid, username: s.username, bytes }, 'chromium memory hard-limit exceeded — force destroy');
          void this.destroy(sid);
        } else if (bytes > MEMORY_WARN_BYTES) {
          log.warn({ sid, username: s.username, bytes }, 'chromium memory above soft warn threshold');
        }
      } catch {
        // CDP detached during the sample window — sweepIdle will tidy up.
      }
    }
  }

  private sweepIdle(): void {
    const now = Date.now();
    for (const [sid, s] of this.sessions) {
      if (now - s.lastActivityAt > IDLE_TIMEOUT_MS) {
        log.info({ sid, idleMs: now - s.lastActivityAt }, 'idle timeout');
        this.destroy(sid).catch(err => log.warn({ err, sid }, 'idle destroy failed'));
      }
    }
  }
}

export const browserChromeSessions = new SessionManager();

// ── JWT helpers for WS auth ────────────────────────────────────────────────
// HTTP endpoints use Bearer admin (via requireBearerAdmin); WS upgrade can't
// carry headers reliably across browsers / proxies, so we issue a short-lived
// JWT bound to {sid, username} returned by POST /_session.

export function mintSessionToken(sid: string, username: string): string {
  const config = getConfig();
  return jwt.sign(
    { sid, username, typ: 'browser-chrome' },
    config.jwtSecret,
    { expiresIn: '1h' },
  );
}

export function verifySessionToken(token: string): { sid: string; username: string } | null {
  try {
    const config = getConfig();
    const decoded = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    if (decoded.typ !== 'browser-chrome') return null;
    if (typeof decoded.sid !== 'string' || typeof decoded.username !== 'string') return null;
    return { sid: decoded.sid, username: decoded.username };
  } catch {
    return null;
  }
}
