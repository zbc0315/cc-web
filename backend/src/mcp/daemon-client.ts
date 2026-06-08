/**
 * HTTP client for the running ccweb daemon, used by the MCP server.
 *
 * Token acquisition:
 *   The MCP server runs as a child of the user's CLI on the same machine, so
 *   it can hit /api/auth/local-token without credentials (isLocalRequest gate).
 *   Token TTL = 30d (matches generateLocalToken), refresh on 401.
 *
 * Port discovery:
 *   Reads ~/.ccweb/ccweb.port (written by daemon on listen). Falls back to
 *   CCWEB_PORT env then 3001. The .port file gets refreshed on every daemon
 *   start so the value is reliable as long as daemon is running.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function dataDir(): string {
  return process.env.CCWEB_DATA_DIR || path.join(os.homedir(), '.ccweb');
}

function resolvePort(): number {
  const envPort = parseInt(process.env.CCWEB_PORT || '', 10);
  if (Number.isFinite(envPort) && envPort > 0) return envPort;
  try {
    const raw = fs.readFileSync(path.join(dataDir(), 'ccweb.port'), 'utf8').trim();
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  } catch { /* ignore */ }
  return 3001;
}

export class DaemonClient {
  private port: number;
  private token: string | null = null;
  private baseUrl: string;

  constructor() {
    this.port = resolvePort();
    this.baseUrl = `http://127.0.0.1:${this.port}`;
  }

  /** Fetch a fresh local token. Throws if daemon is unreachable or rejects. */
  private async fetchToken(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/auth/local-token`);
    if (!res.ok) {
      throw new Error(`Failed to obtain local token: HTTP ${res.status} ${await res.text().catch(() => '')}`);
    }
    const data = (await res.json()) as { token?: string };
    if (!data.token) throw new Error('Daemon returned no token');
    return data.token;
  }

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token;
    this.token = await this.fetchToken();
    return this.token;
  }

  /**
   * JSON-in / JSON-out request. Retries once on 401 (token expired between
   * MCP-server start and the call).
   */
  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const exec = async (): Promise<Response> => {
      const token = await this.ensureToken();
      return fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    };

    let res = await exec();
    if (res.status === 401) {
      this.token = null;
      res = await exec();
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json() as { error?: string }).error || ''; } catch { /* ignore */ }
      throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    // 204 / empty body
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
}

let _instance: DaemonClient | null = null;
export function getDaemonClient(): DaemonClient {
  if (!_instance) _instance = new DaemonClient();
  return _instance;
}
