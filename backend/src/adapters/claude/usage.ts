/**
 * Claude Code CLI-specific usage query.
 *
 * Reads OAuth credentials from the macOS login Keychain service
 * `Claude Code-credentials`, calls the Anthropic subscription API, and
 * returns 5h / 7d / 7d-Sonnet / 7d-Opus utilization buckets.
 *
 * Kept Claude-only on purpose: Codex, Gemini, OpenCode, Qwen each have their
 * own billing / quota model and don't expose a compatible endpoint. This
 * file lives under `adapters/claude/` so its scope is unambiguous.
 */

import * as https from 'https';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import { modLogger } from '../../logger';

const log = modLogger('adapter');

export interface UsageBucket {
  utilization?: number;
  resetAt?: string;
}

export interface UsageInfo {
  planName?: string;
  fiveHour?: UsageBucket;
  sevenDay?: UsageBucket;
  sevenDaySonnet?: UsageBucket;
  sevenDayOpus?: UsageBucket;
}

const CACHE_TTL_MS = 5 * 60_000;

interface CacheEntry {
  data: UsageInfo;
  at: number;
}

let memCache: CacheEntry | null = null;

// ── Keychain helpers ────────────────────────────────────────────────────────

interface OAuthCredentials {
  accessToken: string;
  subscriptionType?: string;
}

interface CredentialsFile {
  claudeAiOauth?: {
    accessToken?: string;
    subscriptionType?: string;
    expiresAt?: number;
  };
}

function getHashedServiceName(homeDir: string): string {
  const configDir = path.join(homeDir, '.claude');
  const normalized = configDir.replace(/\\/g, '/').toLowerCase();
  const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 8);
  return `Claude Code-credentials-${hash}`;
}

function tryKeychainService(serviceName: string): OAuthCredentials | null {
  try {
    const raw = execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-s', serviceName, '-w'],
      { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString().trim();

    if (!raw) return null;
    const data: CredentialsFile = JSON.parse(raw);
    const token = data.claudeAiOauth?.accessToken;
    if (!token) return null;

    const expiresAt = data.claudeAiOauth?.expiresAt;
    if (expiresAt && expiresAt < Date.now()) return null;

    return { accessToken: token, subscriptionType: data.claudeAiOauth?.subscriptionType };
  } catch {
    return null;
  }
}

function readCredentials(): OAuthCredentials | null {
  const homeDir = os.homedir();

  // Try hashed service name (Claude Code 2.x)
  const hashed = tryKeychainService(getHashedServiceName(homeDir));
  if (hashed) return hashed;

  // Try legacy service name
  const legacy = tryKeychainService('Claude Code-credentials');
  if (legacy) return legacy;

  // Fall back to .credentials.json
  try {
    const credPath = path.join(homeDir, '.claude', '.credentials.json');
    const data: CredentialsFile = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    const token = data.claudeAiOauth?.accessToken;
    if (!token) return null;
    return { accessToken: token, subscriptionType: data.claudeAiOauth?.subscriptionType };
  } catch {
    return null;
  }
}

// ── API call ────────────────────────────────────────────────────────────────

interface UsageApiBucket {
  utilization?: number;
  resets_at?: string | null;
}

interface UsageApiResponse {
  five_hour?: UsageApiBucket;
  seven_day?: UsageApiBucket;
  seven_day_sonnet?: UsageApiBucket | null;
  seven_day_opus?: UsageApiBucket | null;
}

function fetchApi(accessToken: string): Promise<UsageApiResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/api/oauth/usage',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'claude-code/2.1',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
            return;
          }
          try { resolve(JSON.parse(body) as UsageApiResponse); }
          catch { reject(new Error('Invalid JSON response')); }
        });
      }
    );
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.end();
  });
}

const PLAN_NAMES: Record<string, string> = {
  pro: 'Pro',
  max: 'Max',
  max_5x: 'Max 5×',
  max_20x: 'Max 20×',
  claude_max: 'Max',
  free: 'Free',
};

function getPlanName(subscriptionType?: string): string | undefined {
  if (!subscriptionType) return undefined;
  const key = subscriptionType.toLowerCase();
  return PLAN_NAMES[key] ?? (subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1));
}

function clamp(v: number | undefined): number | undefined {
  if (v == null || !Number.isFinite(v)) return undefined;
  return Math.round(Math.max(0, Math.min(100, v)));
}

// ── Public API ──────────────────────────────────────────────────────────────

let queryInProgress: Promise<UsageInfo> | null = null;

export async function queryUsage(): Promise<UsageInfo> {
  if (memCache && Date.now() - memCache.at < CACHE_TTL_MS) return memCache.data;
  if (queryInProgress) return queryInProgress;

  queryInProgress = _fetch().finally(() => { queryInProgress = null; });
  return queryInProgress;
}

async function _fetch(): Promise<UsageInfo> {
  const creds = readCredentials();
  if (!creds) {
    log.warn({ api: 'usage' }, 'no claude credentials found');
    return {};
  }

  try {
    const resp = await fetchApi(creds.accessToken);

    function toBucket(b?: UsageApiBucket | null): UsageBucket | undefined {
      if (!b || b.utilization == null) return undefined;
      return { utilization: clamp(b.utilization), resetAt: b.resets_at ?? undefined };
    }

    const info: UsageInfo = {
      planName: getPlanName(creds.subscriptionType),
      fiveHour: toBucket(resp.five_hour),
      sevenDay: toBucket(resp.seven_day),
      sevenDaySonnet: toBucket(resp.seven_day_sonnet),
      sevenDayOpus: toBucket(resp.seven_day_opus),
    };
    memCache = { data: info, at: Date.now() };
    log.debug({ api: 'usage', planName: info.planName }, 'usage fetched');
    return info;
  } catch (err) {
    log.warn({ err, api: 'usage' }, 'usage fetch failed');
    return {};
  }
}

export function clearUsageCache(): void {
  memCache = null;
}

// Legacy export for compatibility
export const usageTerminal = { queryUsage, clearUsageCache };
