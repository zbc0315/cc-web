import { Router, Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { getConfig, getRegisteredUsers } from '../config';
import { isLocalRequest, generateLocalToken } from '../auth';
import { loginEvents, recordLoginAudit } from '../login-events';
import { modLogger } from '../logger';

const log = modLogger('auth');

const router = Router();

// ── Brute-force throttling ──────────────────────────────────────────────────
// Two independent counters, both with a 15-minute sliding window:
//   • per-IP  (MAX_IP_ATTEMPTS)   — stops a single host hammering credentials.
//   • per-user (MAX_USER_ATTEMPTS)— caps *distributed* guessing: an attacker
//     rotating through many IPs is still bounded to a handful of guesses
//     against any one account, which the per-IP limiter alone cannot do.
// A login is blocked if EITHER counter is tripped.
//
// Tradeoff (documented, accepted): the per-user counter lets an attacker lock
// the legitimate user out for up to 15 min by deliberately failing logins.
// With effectively a single account this is a real DoS lever, but the admin
// can always reach the daemon locally (GET /api/auth/local-token bypasses
// /login entirely), the lockout is short, and the alternative — no cap on
// distributed brute force — is worse for the stated goal.
const ipAttempts = new Map<string, { count: number; resetAt: number }>();
const userAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_IP_ATTEMPTS = 5;
const MAX_USER_ATTEMPTS = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Prune expired entries periodically (every 5 min) instead of on every request
setInterval(() => {
  const now = Date.now();
  for (const map of [ipAttempts, userAttempts]) {
    for (const [key, val] of map) {
      if (now > val.resetAt) map.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

function isTripped(map: Map<string, { count: number; resetAt: number }>, key: string, max: number): boolean {
  const now = Date.now();
  const entry = map.get(key);
  if (!entry || now > entry.resetAt) return false;
  return entry.count >= max;
}

function recordFail(map: Map<string, { count: number; resetAt: number }>, key: string): void {
  const now = Date.now();
  const entry = map.get(key);
  if (!entry || now > entry.resetAt) {
    map.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  } else {
    entry.count++;
  }
}

// GET /api/auth/local-token — returns JWT without credentials (localhost only)
router.get('/local-token', (req: Request, res: Response): void => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'Local access only' });
    return;
  }
  try {
    const token = generateLocalToken();
    res.json({ token });
  } catch {
    res.status(500).json({ error: 'Server configuration error' });
  }
});

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const userAgent = (req.headers['user-agent'] || 'unknown').toString().slice(0, 300);

  if (isTripped(ipAttempts, ip, MAX_IP_ATTEMPTS)) {
    res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    return;
  }

  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  // Normalized key for the per-account counter ONLY (the credential lookup
  // below stays exact). Without this, an attacker could fragment the account
  // counter — and dodge the cap — with case/whitespace variants ("Admin",
  // " admin").
  const userKey = username.trim().toLowerCase();

  // Account-scoped throttle: block before touching the password hash so a
  // distributed (IP-rotating) attack against this username is capped too.
  if (isTripped(userAttempts, userKey, MAX_USER_ATTEMPTS)) {
    log.warn({ user: username, ip }, 'login blocked — account temporarily throttled');
    res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    return;
  }

  let config;
  try {
    config = getConfig();
  } catch (err) {
    res.status(500).json({ error: 'Server configuration error. Run npm run setup first.' });
    return;
  }

  // Check admin user (config.json) and registered users (users.json)
  let passwordHash: string | null = null;
  if (username === config.username) {
    passwordHash = config.passwordHash;
  } else {
    const registeredUser = getRegisteredUsers().find((u) => u.username === username);
    if (registeredUser) {
      passwordHash = registeredUser.passwordHash;
    }
  }

  if (!passwordHash) {
    recordFail(ipAttempts, ip);
    recordFail(userAttempts, userKey);
    recordLoginAudit({ username, ip, userAgent, at: new Date().toISOString(), result: 'fail' });
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, passwordHash);
  if (!valid) {
    recordFail(ipAttempts, ip);
    recordFail(userAttempts, userKey);
    recordLoginAudit({ username, ip, userAgent, at: new Date().toISOString(), result: 'fail' });
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  // Successful login — clear throttle counters for this IP + account
  ipAttempts.delete(ip);
  userAttempts.delete(userKey);
  log.info({ user: username, ip, userAgent }, 'successful login');

  // Durable audit trail + real-time alert to the user's other live sessions.
  const at = new Date().toISOString();
  recordLoginAudit({ username, ip, userAgent, at, result: 'success' });
  loginEvents.emit('login', { username, ip, userAgent, at });

  const token = jwt.sign({ username }, config.jwtSecret, { expiresIn: '30d' });
  res.json({ token });
});

export default router;
