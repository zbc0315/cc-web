import { Router, Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { getConfig } from '../config';
import { isLocalRequest, generateLocalToken } from '../auth';

const router = Router();

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
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  let config;
  try {
    config = getConfig();
  } catch (err) {
    res.status(500).json({ error: 'Server configuration error. Run npm run setup first.' });
    return;
  }

  if (username !== config.username) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, config.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = jwt.sign({ username }, config.jwtSecret, { expiresIn: '30d' });
  res.json({ token });
});

export default router;
