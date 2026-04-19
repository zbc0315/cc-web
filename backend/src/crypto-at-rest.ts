import * as crypto from 'crypto';
import { getConfig } from './config';

/**
 * Shared AES-256-GCM encrypt/decrypt for any small secret stored on disk
 * (rsync passwords, GitHub PATs, etc.).
 *
 * Each caller provides a `label` (e.g. `'sync'`, `'hub'`) that namespaces
 * the key derivation — so a secret encrypted for one subsystem cannot be
 * decrypted by another, even on the same ccweb install.  This is defense
 * in depth against a bug in subsystem X leaking the plaintext of Y.
 *
 * The effective key is `SHA-256("ccweb-<label>:" + jwtSecret)`.  Because
 * `jwtSecret` lives in `config.json`, moving a ccweb install to a different
 * machine (different jwtSecret) makes all at-rest secrets unreadable —
 * the right "fail open, force re-entry" behavior.  Each encrypted blob is
 * paired with a 4-byte fingerprint so callers can detect the rotation
 * case and surface "needs re-entry" rather than return empty plaintext.
 */

function getKey(label: string): Buffer {
  const secret = getConfig().jwtSecret;
  return crypto.createHash('sha256').update(`ccweb-${label}:${secret}`).digest();
}

export function keyFingerprint(label: string): string {
  return getKey(label).subarray(0, 4).toString('hex');
}

export interface EncryptedSecret {
  enc: string;  // base64(iv || tag || ciphertext)
  fp: string;   // 8-hex-char key fingerprint
}

export function encryptSecret(label: string, plain: string): EncryptedSecret {
  if (!plain) return { enc: '', fp: '' };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(label), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    enc: Buffer.concat([iv, tag, enc]).toString('base64'),
    fp: keyFingerprint(label),
  };
}

export function decryptSecret(label: string, blob: string, expectedFp?: string): string {
  if (!blob) return '';
  if (expectedFp && expectedFp !== keyFingerprint(label)) return '';
  try {
    const buf = Buffer.from(blob, 'base64');
    if (buf.length < 28) return '';
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(label), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
