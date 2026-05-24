import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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

const uploadHandler = multer({
  dest: path.join(os.tmpdir(), 'ccweb-browser-chrome-uploads'),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file
});

// multer/busboy decodes filename as latin-1, but browsers send UTF-8 — same
// reasoning as routes/filesystem.ts upload. Re-encode to recover CJK names.
function decodeUploadName(name: string): string {
  return Buffer.from(name, 'latin1').toString('utf8');
}

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
 * POST /:sid/upload — multipart upload bridged into chromium's pending
 * file chooser dialog. The page must have triggered a filechooser event
 * within the last ~30s (playwright's default chooser timeout); otherwise
 * we return 410.
 *
 * Authenticated via `?token=...` for the same reason as /download: the
 * frontend uses fetch with multipart body, where attaching Authorization
 * is fine, but keeping the auth model consistent with download avoids
 * having to support both styles.
 */
router.post('/:sid/upload', uploadHandler.array('files', 20), async (req: Request, res: Response): Promise<void> => {
  const sid = req.params['sid'];
  const token = req.query['token'];
  if (typeof token !== 'string' || !token) { res.status(401).json({ error: 'token required' }); return; }
  const claim = verifySessionToken(token);
  if (!claim || claim.sid !== sid) { res.status(403).json({ error: 'Invalid token' }); return; }
  const session = browserChromeSessions.get(sid, claim.username);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
  const pending = session.pendingChooser;
  if (!pending) { res.status(410).json({ error: 'No pending file chooser — chromium dialog may have timed out' }); return; }

  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }

  // multer writes each file to a tmp path with a random name; chromium
  // setFiles takes file system paths (or in-memory Buffer descriptors).
  // We rename to preserve the user's original filename so the page sees
  // the right name in <input>.files[].name.
  const renamed: string[] = [];
  try {
    for (const f of files) {
      const decoded = decodeUploadName(f.originalname || 'file');
      const safe = decoded.replace(/[\/\\\0]/g, '_');
      const dest = path.join(path.dirname(f.path), `${path.basename(f.path)}-${safe}`);
      fs.renameSync(f.path, dest);
      renamed.push(dest);
    }
    await pending.chooser.setFiles(renamed);
    session.pendingChooser = null;
    res.json({ ok: true, count: renamed.length });
  } catch (err) {
    log.warn({ err, sid }, 'setFiles failed');
    res.status(500).json({ error: 'Upload bridge failed', detail: (err as Error).message });
  } finally {
    // Always clean up tmp files (chromium has already read them into the
    // page context if setFiles succeeded; if not, they're not needed either).
    for (const p of renamed) {
      try { fs.unlinkSync(p); } catch { /* already gone */ }
    }
  }
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
