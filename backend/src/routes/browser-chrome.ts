import { Router, Request, Response, NextFunction } from 'express';
import { AuthRequest, verifyToken } from '../auth';
import { isAdminUser } from '../config';
import {
  browserChromeSessions,
  mintSessionToken,
  verifySessionToken,
  SessionLimitError,
  DOWNLOAD_TTL_MS,
} from '../browser-chrome/session-manager';
import { resolveAllowedTarget } from './browser-proxy';
import { modLogger } from '../logger';

const log = modLogger('browser-chrome:route');
const router: Router = Router();

function requireBearerAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  const h = req.headers['authorization'];
  if (!h?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Bearer token required' });
    return;
  }
  const user = verifyToken(h.slice(7));
  if (!user || !isAdminUser(user.username)) {
    res.status(403).json({ error: 'Admin only' });
    return;
  }
  req.user = user;
  next();
}

/**
 * POST /_session — create or reuse a per-user chromium session.
 * Returns { sid, token, viewport, url }. The token is required to open the
 * WebSocket stream (cannot use Authorization header in WS upgrade reliably).
 */
router.post('/_session', requireBearerAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const session = await browserChromeSessions.getOrCreate(req.user!.username);
    const token = mintSessionToken(session.sid, session.username);
    res.json({
      sid: session.sid,
      token,
      viewport: session.viewport,
      url: session.url,
    });
  } catch (err) {
    if (err instanceof SessionLimitError) {
      res.status(429).json({ error: err.message, limit: err.limit });
      return;
    }
    log.warn({ err }, 'create session failed');
    const msg = err instanceof Error ? err.message : 'Session create failed';
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /:sid/nav { url } — navigate the session's page. SSRF guard reuses
 * the same allowlist as browser-proxy (RFC1918 + loopback only).
 */
router.post('/:sid/nav', requireBearerAdmin, async (req: AuthRequest, res: Response) => {
  const sid = req.params['sid'];
  const url = (req.body?.url as string | undefined)?.trim();
  if (!url) {
    res.status(400).json({ error: 'url required' });
    return;
  }

  let parsed: URL;
  try { parsed = new URL(url); } catch {
    res.status(400).json({ error: 'Invalid URL' });
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    res.status(400).json({ error: 'Only http: / https:' });
    return;
  }
  const allowedIp = await resolveAllowedTarget(parsed.hostname);
  if (!allowedIp) {
    res.status(403).json({ error: 'Target not allowed — must resolve to RFC1918 / loopback' });
    return;
  }

  const session = browserChromeSessions.get(sid, req.user!.username);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  try {
    await session.page.goto(url, { timeout: 15_000, waitUntil: 'load' });
    session.url = session.page.url();
    const title = await session.page.title().catch(() => '');
    res.json({ ok: true, url: session.url, title });
  } catch (err) {
    log.warn({ err, url }, 'nav failed');
    res.status(502).json({ error: 'Navigation failed', detail: (err as Error).message });
  }
});

/**
 * GET /:sid/download/:dlId — serve a chromium-initiated download to the
 * user. Authenticated via `?token=...` (the same browser-chrome session
 * JWT issued by /_session) because `<a download>` can't attach headers.
 * The buffer is deleted after first serve to free memory; subsequent
 * requests return 410.
 */
router.get('/:sid/download/:dlId', (req: Request, res: Response): void => {
  const sid = req.params['sid'];
  const dlId = req.params['dlId'];
  const token = req.query['token'];
  if (typeof token !== 'string' || !token) { res.status(401).send('token required'); return; }
  const claim = verifySessionToken(token);
  if (!claim || claim.sid !== sid) { res.status(403).send('Invalid token'); return; }
  const session = browserChromeSessions.get(sid, claim.username);
  if (!session) { res.status(404).send('Session not found'); return; }
  const dl = session.downloads.get(dlId);
  if (!dl) { res.status(410).send('Download expired or already served'); return; }
  if (Date.now() - dl.createdAt > DOWNLOAD_TTL_MS) {
    session.downloads.delete(dlId);
    res.status(410).send('Download expired');
    return;
  }
  // RFC 5987 — emit both ASCII fallback and UTF-8 encoded so Chinese /
  // emoji / spaces save with their real names instead of percent escapes.
  const ascii = dl.filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '\\"');
  const encoded = encodeURIComponent(dl.filename).replace(/'/g, '%27');
  res.setHeader('Content-Type', dl.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`);
  res.setHeader('Content-Length', String(dl.buffer.byteLength));
  res.end(dl.buffer);
  // Free memory immediately after serving — frontend only triggers <a>
  // click once. If user wants the file again they re-download.
  session.downloads.delete(dlId);
});

/**
 * DELETE /:sid — explicit session teardown. Otherwise SessionManager idle
 * sweep eventually destroys it after 5 minutes of inactivity.
 */
router.delete('/:sid', requireBearerAdmin, async (req: AuthRequest, res: Response) => {
  const sid = req.params['sid'];
  const session = browserChromeSessions.get(sid, req.user!.username);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  await browserChromeSessions.destroy(sid);
  res.status(204).end();
});

export default router;
