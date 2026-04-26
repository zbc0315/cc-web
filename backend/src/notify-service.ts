import * as fs from 'fs';
import * as path from 'path';
import * as dns from 'dns/promises';
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

function isPrivateAddress(addr: string): boolean {
  const a = addr.replace(/^\[|\]$/g, '').toLowerCase();
  if (a === 'localhost' || a === '0.0.0.0' || a === '127.0.0.1' || a === '::1') return true;
  if (a.startsWith('10.') || a.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) return true;
  if (a.startsWith('169.254.')) return true;                   // link-local
  if (a.startsWith('fe80') || a.startsWith('fc') || a.startsWith('fd')) return true;  // ULA / link-local v6
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — extract the embedded v4 and re-test,
  // catching ::ffff:172.16.x.x / ::ffff:169.254.x.x SSRF bypasses that the
  // earlier prefix-only check missed.
  const mapped = a.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped && isPrivateAddress(mapped[1])) return true;
  if (a === 'metadata.google.internal') return true;
  return false;
}

async function isWebhookUrlSafe(rawUrl: string): Promise<boolean> {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return false; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  // Reject obvious literal-private hosts before the DNS roundtrip.
  if (isPrivateAddress(host)) return false;
  // Resolve DNS so a public hostname pointing at RFC1918 / loopback is also rejected.
  // A literal IP just resolves to itself; an attacker hostname `whatever.example.com`
  // with an A record of `192.168.0.1` is now blocked too.
  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    for (const r of records) {
      if (isPrivateAddress(r.address)) return false;
    }
  } catch {
    // DNS failure: refuse rather than fetch a host we can't classify.
    return false;
  }
  return true;
}

class NotifyService extends EventEmitter {
  async onProjectStopped(projectId: string, projectName: string): Promise<void> {
    this.emit('stopped', { projectId, projectName });

    const config = getNotifyConfig();
    if (!config.webhookEnabled || !config.webhookUrl) return;
    // SSRF guard: literal-private + DNS-resolved private both rejected.
    if (!(await isWebhookUrlSafe(config.webhookUrl))) return;
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
