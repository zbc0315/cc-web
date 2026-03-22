import { Router, Response, Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest } from '../auth';
import { ProviderConfig, ProviderType } from '../backup/types';
import { getBackupConfig, saveBackupConfig, getBackupHistory } from '../backup/config';
import { createProvider } from '../backup/providers';
import { runBackup } from '../backup/engine';
import { restartScheduler } from '../backup/scheduler';

const router = Router();
export default router;

// OAuth callback router — must be mounted WITHOUT auth middleware
export const backupAuthCallbackRouter = Router();

// ── Provider CRUD ──────────────────────────────────────────────────────────────

// GET /api/backup/providers — list all providers (strip secrets/tokens)
router.get('/providers', (_req: AuthRequest, res: Response): void => {
  const config = getBackupConfig();
  const providers = config.providers.map((p) => ({
    id: p.id,
    type: p.type,
    label: p.label,
    clientId: p.clientId,
    clientSecret: '***',
    authorized: !!p.tokens,
  }));
  res.json(providers);
});

// POST /api/backup/providers — add new provider
router.post('/providers', (req: AuthRequest, res: Response): void => {
  const { type, label, clientId, clientSecret } = req.body as {
    type?: ProviderType;
    label?: string;
    clientId?: string;
    clientSecret?: string;
  };

  if (!type || !label || !clientId || !clientSecret) {
    res.status(400).json({ error: 'type, label, clientId, and clientSecret are required' });
    return;
  }

  const validTypes: ProviderType[] = ['google-drive', 'onedrive', 'dropbox'];
  if (!validTypes.includes(type)) {
    res.status(400).json({ error: `Invalid provider type. Must be one of: ${validTypes.join(', ')}` });
    return;
  }

  const config = getBackupConfig();
  const newProvider: ProviderConfig = {
    id: uuidv4(),
    type,
    label: label.trim(),
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim(),
  };
  config.providers.push(newProvider);
  saveBackupConfig(config);

  res.status(201).json({
    id: newProvider.id,
    type: newProvider.type,
    label: newProvider.label,
    authorized: false,
  });
});

// DELETE /api/backup/providers/:id — remove provider
router.delete('/providers/:id', (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const config = getBackupConfig();
  const filtered = config.providers.filter((p) => p.id !== id);
  if (filtered.length === config.providers.length) {
    res.status(404).json({ error: 'Provider not found' });
    return;
  }
  config.providers = filtered;
  saveBackupConfig(config);
  res.json({ success: true });
});

// ── OAuth2 ────────────────────────────────────────────────────────────────────

// GET /api/backup/auth/:id/url — generate OAuth2 authorization URL
router.get('/auth/:id/url', (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const config = getBackupConfig();
  const providerConfig = config.providers.find((p) => p.id === id);
  if (!providerConfig) {
    res.status(404).json({ error: 'Provider not found' });
    return;
  }

  try {
    const port = req.socket.localPort || 3001;
    const redirectUri = `http://localhost:${port}/api/backup/auth/callback`;
    const provider = createProvider(providerConfig);
    const url = provider.getAuthUrl(redirectUri);
    res.json({ url, redirectUri });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/backup/auth/callback — OAuth2 redirect callback (also registered on backupAuthCallbackRouter)
async function handleAuthCallback(req: Request, res: Response): Promise<void> {
  const { code, state } = req.query as { code?: string; state?: string };

  if (!code || !state) {
    res.redirect('/?backup_auth=error&reason=missing_params');
    return;
  }

  const config = getBackupConfig();
  const providerConfig = config.providers.find((p) => p.id === state);
  if (!providerConfig) {
    res.redirect('/?backup_auth=error&reason=provider_not_found');
    return;
  }

  try {
    const port = req.socket.localPort || 3001;
    const redirectUri = `http://localhost:${port}/api/backup/auth/callback`;
    const provider = createProvider(providerConfig);
    const tokens = await provider.handleCallback(code, redirectUri);

    // Save tokens to provider config
    const idx = config.providers.findIndex((p) => p.id === state);
    if (idx >= 0) {
      config.providers[idx] = { ...providerConfig, tokens };
      saveBackupConfig(config);
    }

    res.redirect('/?backup_auth=success');
  } catch (err) {
    console.error('[Backup] OAuth callback error:', err);
    res.redirect('/?backup_auth=error&reason=token_exchange_failed');
  }
}

router.get('/auth/callback', handleAuthCallback);
backupAuthCallbackRouter.get('/callback', handleAuthCallback);

// ── Backup operations ─────────────────────────────────────────────────────────

// POST /api/backup/run/:projectId — trigger manual backup
router.post('/run/:projectId', async (req: AuthRequest, res: Response): Promise<void> => {
  const { projectId } = req.params;
  try {
    const results = await runBackup(projectId);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/backup/schedule — get schedule config
router.get('/schedule', (_req: AuthRequest, res: Response): void => {
  const config = getBackupConfig();
  res.json(config.schedule);
});

// PUT /api/backup/schedule — update schedule
router.put('/schedule', (req: AuthRequest, res: Response): void => {
  const { enabled, intervalMinutes } = req.body as {
    enabled?: boolean;
    intervalMinutes?: number;
  };

  const config = getBackupConfig();
  if (typeof enabled === 'boolean') config.schedule.enabled = enabled;
  if (typeof intervalMinutes === 'number' && intervalMinutes > 0) {
    config.schedule.intervalMinutes = intervalMinutes;
  }
  saveBackupConfig(config);
  restartScheduler();
  res.json(config.schedule);
});

// GET /api/backup/excludes — get exclude patterns
router.get('/excludes', (_req: AuthRequest, res: Response): void => {
  const config = getBackupConfig();
  res.json({ patterns: config.excludePatterns });
});

// PUT /api/backup/excludes — update exclude patterns
router.put('/excludes', (req: AuthRequest, res: Response): void => {
  const { patterns } = req.body as { patterns?: string[] };
  if (!Array.isArray(patterns)) {
    res.status(400).json({ error: 'patterns must be an array of strings' });
    return;
  }
  const config = getBackupConfig();
  config.excludePatterns = patterns.filter((p) => typeof p === 'string');
  saveBackupConfig(config);
  res.json({ patterns: config.excludePatterns });
});

// GET /api/backup/history — get backup history
router.get('/history', (_req: AuthRequest, res: Response): void => {
  res.json(getBackupHistory());
});
