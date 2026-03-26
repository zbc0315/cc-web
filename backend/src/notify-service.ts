import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from './config';
import { EventEmitter } from 'events';

export interface NotifyConfig {
  webhookUrl?: string;
  webhookEnabled: boolean;
}

const NOTIFY_CONFIG_FILE = path.join(DATA_DIR, 'notify-config.json');

export function getNotifyConfig(): NotifyConfig {
  try {
    if (!fs.existsSync(NOTIFY_CONFIG_FILE)) return { webhookEnabled: false };
    return JSON.parse(fs.readFileSync(NOTIFY_CONFIG_FILE, 'utf-8')) as NotifyConfig;
  } catch {
    return { webhookEnabled: false };
  }
}

export function saveNotifyConfig(config: NotifyConfig): void {
  const tmpPath = NOTIFY_CONFIG_FILE + `.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
  fs.renameSync(tmpPath, NOTIFY_CONFIG_FILE);
}

class NotifyService extends EventEmitter {
  async onProjectStopped(projectId: string, projectName: string): Promise<void> {
    this.emit('stopped', { projectId, projectName });

    const config = getNotifyConfig();
    if (!config.webhookEnabled || !config.webhookUrl) return;
    try {
      await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'project_stopped',
          projectId,
          projectName,
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      console.warn('[NotifyService] Webhook delivery failed:', err instanceof Error ? err.message : String(err));
    }
  }
}

export const notifyService = new NotifyService();
