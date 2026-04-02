// backend/src/routes/share.ts
import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AuthRequest, verifyToken, isLocalRequest } from '../auth';
import { DATA_DIR, getConfig, getProject, getProjects, isAdminUser, isProjectOwner } from '../config';

const router = Router();
const SHARES_FILE = path.join(DATA_DIR, 'session-shares.json');

interface ShareEntry {
  token: string;
  projectId: string;
  sessionId: string;
  createdAt: string;
  expiresAt?: string;
}

function loadShares(): ShareEntry[] {
  try {
    if (!fs.existsSync(SHARES_FILE)) return [];
    return JSON.parse(fs.readFileSync(SHARES_FILE, 'utf-8')) as ShareEntry[];
  } catch {
    return [];
  }
}

function saveShares(shares: ShareEntry[]): void {
  const tmp = SHARES_FILE + `.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(shares, null, 2), 'utf-8');
  fs.renameSync(tmp, SHARES_FILE);
}

// POST /api/sessions/:sessionId/share   body: { expiryDays?: number }
// Requires auth (manual JWT check since this route is mounted without authMiddleware)
router.post('/sessions/:sessionId/share', async (req: AuthRequest, res: Response): Promise<void> => {
  // Auth: localhost auto-auth or JWT
  if (isLocalRequest(req)) {
    const config = getConfig();
    req.user = { username: config.username };
  } else {
    const authHeader = req.headers['authorization'];
    const jwtToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!jwtToken) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const user = verifyToken(jwtToken);
    if (!user) { res.status(401).json({ error: 'Invalid token' }); return; }
    req.user = user;
  }

  const { sessionId } = req.params;
  // Validate sessionId is a safe filename (no path traversal)
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    res.status(400).json({ error: 'Invalid session ID format' }); return;
  }
  const { expiryDays } = req.body as { expiryDays?: unknown };

  // Find which project this session belongs to (scan projects accessible to caller)
  const projects = getProjects();
  let foundProjectId: string | null = null;

  for (const p of projects) {
    if (!isProjectOwner(p, req.user.username) && !isAdminUser(req.user.username)) continue;
    const sessionFile = path.join(p.folderPath, '.ccweb', 'sessions', `${sessionId}.json`);
    if (fs.existsSync(sessionFile)) {
      foundProjectId = p.id;
      break;
    }
  }

  if (!foundProjectId) {
    res.status(404).json({ error: 'Session not found or access denied' }); return;
  }

  const token = crypto.randomBytes(24).toString('base64url');
  const entry: ShareEntry = {
    token,
    projectId: foundProjectId,
    sessionId,
    createdAt: new Date().toISOString(),
    ...(typeof expiryDays === 'number' && expiryDays > 0
      ? { expiresAt: new Date(Date.now() + expiryDays * 86400000).toISOString() }
      : {}),
  };

  const shares = loadShares();
  shares.push(entry);
  saveShares(shares);

  res.json({ token, shareUrl: `/share/${token}` });
});

// GET /api/share/:token — NO AUTH REQUIRED — returns session data
router.get('/share/:token', (req: Request, res: Response): void => {
  // Validate token format (base64url, 32 chars)
  const { token } = req.params;
  if (!token || !/^[A-Za-z0-9_-]{32}$/.test(token)) {
    res.status(404).json({ error: 'Share link not found' }); return;
  }

  const shares = loadShares();
  const entry = shares.find((s) => s.token === token);
  if (!entry) { res.status(404).json({ error: 'Share link not found or expired' }); return; }

  if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
    res.status(410).json({ error: 'Share link has expired' }); return;
  }

  const project = getProject(entry.projectId);
  if (!project) { res.status(404).json({ error: 'Project no longer exists' }); return; }

  if (!/^[A-Za-z0-9_-]+$/.test(entry.sessionId)) {
    res.status(500).json({ error: 'Invalid stored session ID' }); return;
  }
  const sessionFile = path.join(project.folderPath, '.ccweb', 'sessions', `${entry.sessionId}.json`);
  try {
    const raw = fs.readFileSync(sessionFile, 'utf-8');
    const session = JSON.parse(raw) as unknown;
    res.json({ session, projectName: project.name });
  } catch {
    res.status(404).json({ error: 'Session data not found' });
  }
});

export default router;
