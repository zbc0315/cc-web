import { Router, Response } from 'express';
import { AuthRequest } from '../auth';
import { getNotifyConfig, saveNotifyConfig, NotifyConfig } from '../notify-service';
import { isAdminUser } from '../config';

const router = Router();

router.get('/config', (req: AuthRequest, res: Response): void => {
  res.json(getNotifyConfig());
});

router.put('/config', (req: AuthRequest, res: Response): void => {
  if (!isAdminUser(req.user?.username)) {
    res.status(403).json({ error: 'Admin only' });
    return;
  }
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
