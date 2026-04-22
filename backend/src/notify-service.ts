import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from './config';
import { EventEmitter } from 'events';
import { modLogger } from './logger';

const log = modLogger('notify');

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
    // Block SSRF: only allow http(s) with non-private hostnames
    try {
      const parsed = new URL(config.webhookUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) return;
      const host = parsed.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
      if (host === 'localhost' || host === '0.0.0.0' ||
          host === '127.0.0.1' || host === '::1' ||
          host.startsWith('10.') || host.startsWith('192.168.') ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
          host.startsWith('169.254.') ||
          host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd') ||
          host.includes('::ffff:127.') || host.includes('::ffff:10.') || host.includes('::ffff:192.168.') ||
          host === 'metadata.google.internal') return;
    } catch { return; }
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
      log.warn({ err }, 'webhook delivery failed');
    }
  }
}

export const notifyService = new NotifyService();
