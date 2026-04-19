import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { DATA_DIR, atomicWriteSync, getConfig } from './config';

/**
 * Per-user rsync sync configuration.
 *
 * Layout: one file per user at `<DATA_DIR>/sync-config/<sha1(username)>.json`.
 * The filename is a hash of the real username so usernames containing `.`,
 * spaces, or any non-[A-Za-z0-9_-] character don't round-trip lossily (the
 * earlier simple-sanitize approach collided `tom.admin` with `tom_admin` and
 * broke scheduler lookup).  The real username is stored inside the JSON as
 * `username` so `listUsersWithSyncConfig()` can return the actual strings.
 *
 * Passwords are encrypted with AES-256-GCM using a key derived from the
 * server's JWT secret.  A 4-byte fingerprint of the derived key is stored
 * alongside `passwordEnc` so a jwtSecret rotation (e.g. user re-runs setup,
 * config.json regenerated) is detected at read time and the public config
 * exposes `passwordNeedsReset: true` instead of silently returning the
 * wedged ciphertext.
 */

export type SyncDirection = 'push' | 'pull' | 'bidirectional';
export type AuthMethod = 'key' | 'password';

export interface SyncConfig {
  username: string;          // real username, stored inside the file
  host: string;
  port: number;
  user: string;
  authMethod: AuthMethod;
  keyPath?: string;
  passwordEnc?: string;      // AES-256-GCM ciphertext (base64)
  passwordFp?: string;       // 8-hex-char fingerprint of the key used to encrypt
  remoteRoot: string;        // absolute path on remote, no trailing slash
  direction: SyncDirection;
  defaultExcludes: string[];
  schedule: { enabled: boolean; cron: string };
  projectExcludes: Record<string, string[]>;
}

const DEFAULT_EXCLUDES = [
  '.git/',                   // full .git (prev only excluded objects/, which left a broken repo)
  'node_modules/',
  'dist/',
  'build/',
  '.next/',
  '.venv/',
  '__pycache__/',
  '.DS_Store',
  '*.log',
  '*.tmp',
];

export const DEFAULT_CONFIG: Omit<SyncConfig, 'username'> = {
  host: '',
  port: 22,
  user: '',
  authMethod: 'key',
  remoteRoot: '',
  direction: 'push',
  defaultExcludes: DEFAULT_EXCLUDES,
  schedule: { enabled: false, cron: '0 3 * * *' },
  projectExcludes: {},
};

const SYNC_DIR = path.join(DATA_DIR, 'sync-config');

function ensureDir(): void {
  if (!fs.existsSync(SYNC_DIR)) fs.mkdirSync(SYNC_DIR, { recursive: true, mode: 0o700 });
}

function userFile(username: string): string {
  // Hash-based filenames: usernames may contain any unicode. sha1 is fine
  // here because this is a lookup key, not a security token.
  const hash = crypto.createHash('sha1').update(`ccweb-sync-user:${username}`).digest('hex');
  return path.join(SYNC_DIR, `${hash}.json`);
}

// ── Crypto ───────────────────────────────────────────────────────────────────

function getKey(): Buffer {
  const secret = getConfig().jwtSecret;
  return crypto.createHash('sha256').update(`ccweb-sync:${secret}`).digest();
}

function keyFingerprint(): string {
  return getKey().subarray(0, 4).toString('hex');
}

export function encryptPassword(plain: string): { enc: string; fp: string } {
  if (!plain) return { enc: '', fp: '' };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    enc: Buffer.concat([iv, tag, enc]).toString('base64'),
    fp: keyFingerprint(),
  };
}

export function decryptPassword(blob: string, expectedFp?: string): string {
  if (!blob) return '';
  if (expectedFp && expectedFp !== keyFingerprint()) return ''; // key rotated — refuse
  try {
    const buf = Buffer.from(blob, 'base64');
    if (buf.length < 28) return '';
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

/** Reject paths that would let a user inject ssh options through rsync's
 *  `-e` string tokenization or ssh's own getopt (keyPath beginning with `-`
 *  is read as another option). */
const INVALID_KEYPATH = /[\s'"\\\x00]|^-/;

export function isValidKeyPath(p: string | undefined | null): boolean {
  if (!p) return true; // missing is OK (caller decides whether required)
  return !INVALID_KEYPATH.test(p) && p.length < 512;
}

/** A project folder name used on the remote must not contain path separators
 *  or start with `.`/`-` so `rsync ... remote:root/<name>/` stays inside
 *  `remoteRoot`.  `path.posix.join` does not protect against `..`. */
export function sanitizeFolderName(raw: string): string | null {
  if (!raw) return null;
  if (raw.includes('/') || raw.includes('\\') || raw.includes('\0')) return null;
  if (raw === '.' || raw === '..') return null;
  if (raw.startsWith('.') || raw.startsWith('-')) return null;
  if (raw.length > 128) return null;
  return raw;
}

// ── Read / Write ─────────────────────────────────────────────────────────────

export function getSyncConfig(username: string): SyncConfig {
  ensureDir();
  const file = userFile(username);
  if (!fs.existsSync(file)) return { username, ...DEFAULT_CONFIG };
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SyncConfig>;
    // username comes from the argument (authoritative) — if the file's
    // `username` field is missing / stale / tampered, the argument wins.
    const { username: _ignored, ...rest } = parsed;
    return { ...DEFAULT_CONFIG, ...rest, username };
  } catch {
    return { username, ...DEFAULT_CONFIG };
  }
}

export function setSyncConfig(cfg: SyncConfig): void {
  ensureDir();
  atomicWriteSync(userFile(cfg.username), JSON.stringify(cfg, null, 2));
  try { fs.chmodSync(userFile(cfg.username), 0o600); } catch { /* ignore */ }
}

export function listUsersWithSyncConfig(): string[] {
  ensureDir();
  try {
    const files = fs.readdirSync(SYNC_DIR).filter((f) => f.endsWith('.json'));
    const users: string[] = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(SYNC_DIR, f), 'utf-8');
        const obj = JSON.parse(raw) as { username?: string };
        if (typeof obj.username === 'string' && obj.username) users.push(obj.username);
      } catch { /* skip corrupt entries */ }
    }
    return users;
  } catch {
    return [];
  }
}

/**
 * Client-safe projection. Never leaks the password ciphertext. Sets
 * `passwordNeedsReset` when the stored ciphertext was encrypted with a key
 * the server no longer holds (jwtSecret rotated) — the UI should prompt for
 * re-entry instead of silently rendering `passwordSet: true`.
 */
export function publicConfig(cfg: SyncConfig): Omit<SyncConfig, 'passwordEnc' | 'passwordFp'> & {
  passwordSet: boolean;
  passwordNeedsReset: boolean;
} {
  const { passwordEnc, passwordFp, ...rest } = cfg;
  const set = !!passwordEnc;
  const wedged = set && !!passwordFp && passwordFp !== keyFingerprint();
  return { ...rest, passwordSet: set && !wedged, passwordNeedsReset: wedged };
}
