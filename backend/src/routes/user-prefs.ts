import { Router, Response } from 'express';
import type { AuthRequest } from '../auth';
import { getUserPref, setUserPref } from '../user-prefs';

/**
 * User preference endpoints — thin REST façade over `user-prefs.ts`.
 *
 * Currently only exposes `language`; we add keys here individually rather
 * than a generic get/set because (a) the allow-list guards against clients
 * writing arbitrary keys into the on-disk blob, and (b) each key's value
 * shape is small and worth typing.
 */

const router = Router();

// Allow-list of language codes the frontend can ship.  Keep in sync with
// `frontend/src/lib/i18n.ts` supported languages.
const SUPPORTED_LANGUAGES = new Set(['zh', 'en']);

// GET /api/user-prefs/language  → { language: 'zh' | 'en' | null }
router.get('/language', (req: AuthRequest, res: Response): void => {
  const username = req.user?.username;
  if (!username) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const language = getUserPref<string>(username, 'language') ?? null;
  res.json({ language });
});

// PUT /api/user-prefs/language  body: { language }
router.put('/language', (req: AuthRequest, res: Response): void => {
  const username = req.user?.username;
  if (!username) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const { language } = (req.body ?? {}) as { language?: unknown };
  if (typeof language !== 'string' || !SUPPORTED_LANGUAGES.has(language)) {
    res.status(400).json({ error: 'Unsupported language' });
    return;
  }
  setUserPref(username, 'language', language);
  res.json({ language });
});

export default router;
