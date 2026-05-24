import { chromium, type Browser, type BrowserContext, type Page, type CDPSession } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import * as jwt from 'jsonwebtoken';
import { getConfig } from '../config';
import { modLogger } from '../logger';

const log = modLogger('browser-chrome');

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
}

const MAX_SESSIONS = 3;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_VIEWPORT = { w: 1280, h: 800 };

class SessionManager extends EventEmitter {
  private sessions = new Map<string, Session>();
  private idleTimer: NodeJS.Timeout | null = null;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.idleTimer = setInterval(() => this.sweepIdle(), 30 * 1000);
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
      throw new Error(`Max ${MAX_SESSIONS} browser sessions reached`);
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

  async destroyAll(): Promise<void> {
    const sids = Array.from(this.sessions.keys());
    await Promise.all(sids.map(sid => this.destroy(sid)));
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = null;
    this.started = false;
  }

  size(): number {
    return this.sessions.size;
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
