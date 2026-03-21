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
  const config = getConfig();
  return jwt.sign({ username: config.username }, config.jwtSecret, { expiresIn: '30d' });
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  // Local access: auto-authenticate without token
  if (isLocalRequest(req)) {
    try {
      const config = getConfig();
      req.user = { username: config.username };
    } catch {
      req.user = { username: 'local' };
    }
    next();
    return;
  }

  // Remote access: require Bearer token
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const token = authHeader.slice(7);
  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  req.user = user;
  next();
}
