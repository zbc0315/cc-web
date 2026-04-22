import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { getConfig } from './config';
import { modLogger, als } from './logger';

const log = modLogger('auth');

/**
 * Populate ALS context with the identified user so downstream log events
 * tagged via the shared mutable store pick it up (see request-log.ts I1 fix).
 * Safe noop outside ALS scope.
 */
function tagUserInAls(username: string): void {
  const ctx = als.getStore() as { user?: string } | undefined;
  if (ctx && !ctx.user) ctx.user = username;
}

export interface AuthRequest extends Request {
  user?: { username: string };
}

/**
 * Check if request originates from localhost.
 * Uses socket.remoteAddress directly — not req.ip — so this is NOT affected by
 * X-Forwarded-For even if `trust proxy` is enabled. A reverse proxy terminating
 * on the same host will still show as 127.0.0.1, which is acceptable: operator
 * opted in to that deployment.
 */
export function isLocalRequest(req: Request): boolean {
  const ip = req.socket.remoteAddress || '';
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1'
  );
}

export function verifyToken(token: string): { username: string } | null {
  try {
    const config = getConfig();
    const decoded = jwt.verify(token, config.jwtSecret) as { username: string };
    return { username: decoded.username };
  } catch {
    return null;
  }
}

/** Generate a JWT for local access (no credentials needed).
 * Requires config.json — callers (currently only `/api/auth/local-token`) must handle the throw.
 * Previously fell back to a constant-secret token; removed because any attacker who can coerce
 * the verifier into the same fallback path would forge admin tokens.
 */
export function generateLocalToken(): string {
  const config = getConfig();
  return jwt.sign({ username: config.username }, config.jwtSecret, { expiresIn: '30d' });
}

let _firstRunWarned = false;

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  // Local access: auto-authenticate without token
  if (isLocalRequest(req)) {
    try {
      const config = getConfig();
      req.user = { username: config.username };
    } catch {
      // Config not yet created (e.g. first launch without `ccweb setup`).
      // Treat localhost as admin — use the sentinel '__local_admin__' which
      // isAdminUser() recognises when config.json is absent.
      // IMPORTANT: this path bypasses JWT entirely. Log loudly once so operators
      // running ccweb behind a reverse proxy (where every request may appear
      // loopback after proxy termination) notice they should complete setup.
      if (!_firstRunWarned) {
        log.warn(
          'no config.json — localhost treated as admin via __local_admin__ sentinel. Run `ccweb setup`; until then all localhost bypasses auth.',
        );
        _firstRunWarned = true;
      }
      req.user = { username: '__local_admin__' };
    }
    tagUserInAls(req.user.username);
    next();
    return;
  }

  // Remote access: require Bearer token (header or query param for <img>/<audio> etc.)
  const authHeader = req.headers['authorization'];
  const queryToken = req.query['token'] as string | undefined;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  req.user = user;
  tagUserInAls(user.username);
  next();
}
