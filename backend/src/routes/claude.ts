import { Router } from 'express';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const router = Router();

router.get('/model', (_req, res) => {
  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const raw = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    res.json({ model: settings.model || 'sonnet' });
  } catch {
    res.json({ model: 'sonnet' });
  }
});

export default router;
