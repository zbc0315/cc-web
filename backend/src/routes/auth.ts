import { Router, Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { getConfig } from '../config';

const router = Router();

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
