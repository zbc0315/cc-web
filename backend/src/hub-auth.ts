import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { DATA_DIR, atomicWriteSync } from './config';
import { encryptSecret, decryptSecret } from './crypto-at-rest';

/**
 * Per-user GitHub PAT storage for one-click ccweb-hub submissions.
 *
 * Shape on disk (one file per user):
 *   `<DATA_DIR>/hub-auth/<sha1(username)>.json`
 *   { username, tokenEnc, tokenFp }
 *
 * `tokenEnc` is AES-256-GCM encrypted via `crypto-at-rest` with label `"hub"`.
 * The token itself is user-supplied (GitHub fine-grained PAT the user creates
 * themselves), scoped to the ccweb-hub repo's Issues:write permission.  Each
 * user's token is independent — leaking one does not grant access to others.
 *
 * ccweb itself NEVER ships with a token. A bundled token would be extractable
 * from `backend/dist/` by every installed user (CLAUDE.md pitfalls #30).
 */

const AUTH_DIR = path.join(DATA_DIR, 'hub-auth');

interface HubAuth {
  username: string;
  tokenEnc: string;
  tokenFp: string;
}

function ensureDir(): void {
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
}

function userFile(username: string): string {
  const hash = crypto.createHash('sha1').update(`ccweb-hub-user:${username}`).digest('hex');
  return path.join(AUTH_DIR, `${hash}.json`);
}

function read(username: string): HubAuth | null {
  try {
    const raw = fs.readFileSync(userFile(username), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<HubAuth>;
    if (
      typeof parsed.username === 'string' &&
      typeof parsed.tokenEnc === 'string' &&
      typeof parsed.tokenFp === 'string'
    ) {
      return { username: parsed.username, tokenEnc: parsed.tokenEnc, tokenFp: parsed.tokenFp };
    }
    return null;
  } catch {
    return null;
  }
}

export function hasHubToken(username: string): boolean {
  const auth = read(username);
  return !!(auth && auth.tokenEnc);
}

/** Returns plaintext token (or null if none / wedged by jwtSecret rotation). */
export function getHubToken(username: string): string | null {
  const auth = read(username);
  if (!auth) return null;
  const plain = decryptSecret('hub', auth.tokenEnc, auth.tokenFp);
  return plain || null;
}

/** Public-facing status. `needsReset` = token stored but key fingerprint no
 *  longer matches → jwtSecret rotated; UI should prompt the user to re-enter. */
export function getHubTokenStatus(username: string): { configured: boolean; needsReset: boolean } {
  const auth = read(username);
  if (!auth || !auth.tokenEnc) return { configured: false, needsReset: false };
  const plain = decryptSecret('hub', auth.tokenEnc, auth.tokenFp);
  if (plain) return { configured: true, needsReset: false };
  return { configured: false, needsReset: true };
}

export function setHubToken(username: string, plainToken: string): void {
  ensureDir();
  const { enc, fp } = encryptSecret('hub', plainToken);
  atomicWriteSync(userFile(username), JSON.stringify({ username, tokenEnc: enc, tokenFp: fp } satisfies HubAuth, null, 2));
  try { fs.chmodSync(userFile(username), 0o600); } catch { /* ignore */ }
}

export function clearHubToken(username: string): void {
  try { fs.unlinkSync(userFile(username)); } catch { /* ignore missing */ }
}
