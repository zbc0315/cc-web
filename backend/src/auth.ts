import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { getConfig } from './config';

export interface AuthRequest extends Request {
  user?: { username: string };
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

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
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
