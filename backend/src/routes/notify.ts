import { Router, Response } from 'express';
import { AuthRequest } from '../auth';
import { getNotifyConfig, saveNotifyConfig, NotifyConfig } from '../notify-service';
import { requireAdmin } from '../middleware/authz';

const router = Router();

router.get('/config', requireAdmin, (_req: AuthRequest, res: Response): void => {
  res.json(getNotifyConfig());
});

router.put('/config', requireAdmin, (req: AuthRequest, res: Response): void => {
  const body = req.body as Record<string, unknown>;
  const webhookUrl = typeof body.webhookUrl === 'string' ? body.webhookUrl : undefined;
  const webhookEnabled = typeof body.webhookEnabled === 'boolean' ? body.webhookEnabled : undefined;
  const current = getNotifyConfig();
  const updated: NotifyConfig = {
    webhookEnabled: webhookEnabled ?? current.webhookEnabled,
    webhookUrl: webhookUrl !== undefined ? webhookUrl : current.webhookUrl,
  };
  saveNotifyConfig(updated);
  res.json(updated);
});

export default router;
