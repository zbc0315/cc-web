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
  const { webhookUrl, webhookEnabled } = req.body as Partial<NotifyConfig>;
  const current = getNotifyConfig();
  const updated: NotifyConfig = {
    webhookEnabled: webhookEnabled ?? current.webhookEnabled,
    webhookUrl: webhookUrl !== undefined ? webhookUrl : current.webhookUrl,
  };
  saveNotifyConfig(updated);
  res.json(updated);
});

export default router;
