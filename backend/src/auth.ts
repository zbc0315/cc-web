import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { getConfig } from './config';

export interface AuthRequest extends Request {
  user?: { username: string };
}

/** Check if request originates from localhost */
export function isLocalRequest(req: Request): boolean {
  const ip = req.ip || req.socket.remoteAddress || '';
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

/** Generate a JWT for local access (no credentials needed) */
export function generateLocalToken(): string {
  try {
    const config = getConfig();
    return jwt.sign({ username: config.username }, config.jwtSecret, { expiresIn: '30d' });
  } catch {
    // No config.json yet — generate a temporary token with a fixed secret.
    // This only works for localhost auto-auth; remote access still requires setup.
    return jwt.sign({ username: '__local_admin__' }, 'ccweb-local-fallback', { expiresIn: '1d' });
  }
}

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
      req.user = { username: '__local_admin__' };
    }
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
  next();
}
