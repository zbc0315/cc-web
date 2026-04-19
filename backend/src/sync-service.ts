import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { DATA_DIR } from './config';
import {
  getSyncConfig, decryptPassword, sanitizeFolderName,
  type SyncConfig, type SyncDirection,
} from './sync-config';

/**
 * rsync-driven sync service.
 *
 * Design choices worth noting:
 *
 * - **SSH options go through a wrapper script**, not through `rsync -e "ssh -p 22 -i …"`.
 *   Rsync parses the `-e` value by splitting on whitespace, so any keyPath with a space
 *   or an attacker-crafted `-oProxyCommand=…` would escalate self-config to code execution
 *   as the ccweb process.  A wrapper `sh -c 'exec ssh <hardcoded opts> "$@"'` file written
 *   with user values quoted by `shell-quote` equivalent semantics removes this vector
 *   entirely.
 * - **Password auth** uses `sshpass -e` wrapping the same script.  `SSHPASS` env stays
 *   in the parent and is inherited by child only — never appears in argv or logs.
 * - **Concurrency**: one in-flight sync per (user, project); subsequent calls return
 *   `{ skipped: true }`.
 * - **Logs**: written via createWriteStream (ordered); file truncated to keep the last
 *   ~20 runs, preventing long-term growth (--stats is used so a run is ~20 lines, not
 *   the hundreds of lines --progress emitted).
 * - **bidirectional**: is NOT a safe two-way sync (rsync can't).  The push leg is run
 *   without --delete and with -u (update-if-newer), so remote-newer files survive the
 *   pull leg that follows.  Deletions must be handled manually.
 */

export interface SyncResult {
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  bytes: number;
  filesTransferred: number;
  logTail: string;
  skipped?: true;
  reason?: string;
}

const LOGS_DIR = path.join(DATA_DIR, 'sync-logs');
const WRAP_DIR = path.join(DATA_DIR, 'sync-ssh');
const LOG_MAX_BYTES = 2 * 1024 * 1024; // 2 MB per project

const inFlight = new Map<string, Promise<SyncResult>>();

function inFlightKey(username: string, projectId: string): string {
  return `${username}::${projectId}`;
}

function userSlug(username: string): string {
  return crypto.createHash('sha1').update(`ccweb-sync-user:${username}`).digest('hex');
}

function ensureLogDir(username: string): string {
  const dir = path.join(LOGS_DIR, userSlug(username));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function ensureWrapDir(): string {
  if (!fs.existsSync(WRAP_DIR)) fs.mkdirSync(WRAP_DIR, { recursive: true, mode: 0o700 });
  return WRAP_DIR;
}

function resolveKeyPath(p: string | undefined): string | null {
  if (!p) return null;
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

/** Test that `sshpass` is on PATH; needed only for password auth. */
function hasSshpass(): boolean {
  try {
    execSync('command -v sshpass', { stdio: 'ignore', shell: '/bin/sh' });
    return true;
  } catch {
    return false;
  }
}

// ── SSH wrapper script ───────────────────────────────────────────────────────

/**
 * POSIX shell single-quoting: wrap in `'…'` and replace any embedded `'`
 * with `'\''`.  Safe for all byte strings.
 */
function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Write (or refresh) a per-user SSH wrapper script.  Rsync's `-e` takes a
 * single token that it splits on whitespace; by passing it a path to this
 * script, the rsync subprocess exec's the script as a *command*, passing the
 * `[user@host, remote-command...]` tail as positional args.  The script
 * itself hardcodes all SSH options in shell-quoted form, so no user value is
 * ever re-tokenized by anything between us and ssh.
 *
 * For password auth the same script prepends `sshpass -e`; SSHPASS is read
 * from the inherited env at run time.
 *
 * Returns the absolute path to the script, written 0700.
 */
function writeSshWrapper(cfg: SyncConfig): string {
  ensureWrapDir();
  const knownHostsFile = path.join(os.homedir(), '.ssh', 'known_hosts_ccweb');
  const parts: string[] = [];
  if (cfg.authMethod === 'password') parts.push('sshpass', '-e');
  parts.push('ssh');
  parts.push('-p', String(cfg.port));
  parts.push('-o', 'StrictHostKeyChecking=accept-new');
  parts.push('-o', `UserKnownHostsFile=${knownHostsFile}`);
  parts.push('-o', 'BatchMode=yes');
  parts.push('-o', 'ConnectTimeout=20');
  if (cfg.authMethod === 'key') {
    const keyPath = resolveKeyPath(cfg.keyPath);
    if (keyPath) {
      parts.push('-i', keyPath);
      parts.push('-o', 'IdentitiesOnly=yes');
    }
  }
  // Quote every component once, here, and never string-concat user data again
  const quoted = parts.map(shSingleQuote).join(' ');
  const script = `#!/bin/sh\nexec ${quoted} "$@"\n`;
  const file = path.join(WRAP_DIR, `${userSlug(cfg.username)}.sh`);
  fs.writeFileSync(file, script, { mode: 0o700 });
  return file;
}

// ── Log rotation ────────────────────────────────────────────────────────────

function rotateLogIfLarge(logFile: string): void {
  try {
    const stat = fs.statSync(logFile);
    if (stat.size > LOG_MAX_BYTES) {
      // Keep the last half by reading tail and overwriting; avoids
      // renaming (which would leave a .old file on disk forever).
      const fd = fs.openSync(logFile, 'r');
      const halfSize = Math.floor(LOG_MAX_BYTES / 2);
      const buf = Buffer.alloc(halfSize);
      fs.readSync(fd, buf, 0, halfSize, stat.size - halfSize);
      fs.closeSync(fd);
      // Align to next newline so we don't start mid-line
      const nl = buf.indexOf(0x0a);
      const tail = nl >= 0 ? buf.subarray(nl + 1) : buf;
      fs.writeFileSync(logFile, Buffer.concat([Buffer.from('===== (older entries rotated) =====\n'), tail]));
    }
  } catch { /* missing file or read failure — no-op */ }
}

// ── rsync command ───────────────────────────────────────────────────────────

interface RsyncPlan {
  args: string[];
  env: Record<string, string>;
}

function buildRsyncArgs(
  cfg: SyncConfig,
  localPath: string,
  folderName: string,
  excludes: string[],
  direction: 'push' | 'pull',
  bidirectionalLeg: boolean,
): RsyncPlan {
  const wrapper = writeSshWrapper(cfg);
  const args: string[] = ['-az', '--stats'];
  args.push('-e', wrapper);

  for (const pat of excludes) {
    const trimmed = pat.trim();
    if (trimmed) args.push('--exclude', trimmed);
  }

  const localSpec = localPath.endsWith('/') ? localPath : localPath + '/';
  // path.posix.join on sanitized name; folderName is already validated to
  // contain no `..` / separators.
  const remoteSpec = `${cfg.user}@${cfg.host}:${path.posix.join(cfg.remoteRoot, folderName)}/`;

  if (direction === 'push') {
    // Only the pure-push path uses --delete (mirror semantics). The push leg
    // of "bidirectional" must not delete remote-newer files the pull leg is
    // about to bring back.
    if (!bidirectionalLeg) args.push('--delete');
    else args.push('-u');
    args.push(localSpec, remoteSpec);
  } else {
    // pull: never --delete (protects local work-in-progress)
    args.push(remoteSpec, localSpec);
  }

  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  if (cfg.authMethod === 'password' && cfg.passwordEnc) {
    const pw = decryptPassword(cfg.passwordEnc, cfg.passwordFp);
    if (pw) env.SSHPASS = pw;
  }

  return { args, env };
}

async function runOne(
  cfg: SyncConfig,
  projectId: string,
  folderName: string,
  localPath: string,
  direction: 'push' | 'pull',
  bidirectionalLeg: boolean,
): Promise<SyncResult> {
  const excludes = [...cfg.defaultExcludes, ...(cfg.projectExcludes[projectId] ?? [])];
  const { args, env } = buildRsyncArgs(cfg, localPath, folderName, excludes, direction, bidirectionalLeg);

  if (cfg.authMethod === 'password' && !env.SSHPASS) {
    return { ok: false, exitCode: null, durationMs: 0, bytes: 0, filesTransferred: 0, logTail: '', reason: 'password-decrypt-failed' };
  }

  const logDir = ensureLogDir(cfg.username);
  const logFile = path.join(logDir, `${projectId}.log`);
  rotateLogIfLarge(logFile);

  const startStamp = new Date().toISOString();
  const header = `\n===== ${startStamp}  ${direction.toUpperCase()}${bidirectionalLeg ? '(bidi)' : ''}  ${folderName} =====\n`;

  const started = Date.now();

  return await new Promise<SyncResult>((resolve) => {
    let combined = '';
    const logStream = fs.createWriteStream(logFile, { flags: 'a', mode: 0o600 });
    logStream.write(header);
    const child = spawn('rsync', args, { env, cwd: os.homedir(), stdio: ['ignore', 'pipe', 'pipe'] });
    const onData = (buf: Buffer) => {
      const s = buf.toString();
      combined += s;
      logStream.write(s);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      logStream.write(`spawn error: ${err.message}\n`);
      logStream.end();
      resolve({ ok: false, exitCode: null, durationMs: Date.now() - started, bytes: 0, filesTransferred: 0, logTail: err.message, reason: 'spawn-failed' });
    });
    child.on('close', (code) => {
      logStream.end();
      const ok = code === 0;
      // --stats output: "Total transferred file size: N bytes" and "Number of regular files transferred: N"
      const bytesMatch = combined.match(/total transferred file size:\s*([\d,]+)\s*bytes/i);
      const filesMatch = combined.match(/number of regular files transferred:\s*([\d,]+)/i);
      const bytes = bytesMatch ? parseInt(bytesMatch[1].replace(/,/g, ''), 10) : 0;
      const files = filesMatch ? parseInt(filesMatch[1].replace(/,/g, ''), 10) : 0;
      const logTail = combined.split('\n').slice(-30).join('\n');
      resolve({ ok, exitCode: code, durationMs: Date.now() - started, bytes, filesTransferred: files, logTail });
    });
  });
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Sync one project. Bidirectional runs the push leg without --delete (so the
 * following pull can restore remote-newer files), then the pull leg.
 */
export async function syncProject(
  username: string,
  projectId: string,
  projectName: string,
  localPath: string,
  overrideDirection?: SyncDirection,
): Promise<SyncResult> {
  const key = inFlightKey(username, projectId);
  if (inFlight.has(key)) {
    return { ok: false, exitCode: null, durationMs: 0, bytes: 0, filesTransferred: 0, logTail: '', skipped: true, reason: 'already-syncing' };
  }

  const cfg = getSyncConfig(username);

  // Preflight validation — fail fast with a clear reason instead of spawning
  // rsync and watching it error cryptically.
  if (!cfg.host || !cfg.user || !cfg.remoteRoot) {
    return { ok: false, exitCode: null, durationMs: 0, bytes: 0, filesTransferred: 0, logTail: '', reason: 'incomplete-config' };
  }
  if (cfg.authMethod === 'key' && !cfg.keyPath) {
    return { ok: false, exitCode: null, durationMs: 0, bytes: 0, filesTransferred: 0, logTail: '', reason: 'missing-key-path' };
  }
  if (cfg.authMethod === 'password' && !hasSshpass()) {
    return { ok: false, exitCode: null, durationMs: 0, bytes: 0, filesTransferred: 0, logTail: '', reason: 'sshpass-not-installed' };
  }
  if (!fs.existsSync(localPath)) {
    return { ok: false, exitCode: null, durationMs: 0, bytes: 0, filesTransferred: 0, logTail: '', reason: 'local-path-missing' };
  }

  // Folder name on the remote: prefer the project display name, fall back to
  // basename then projectId. Must be sanitized or we'd let a project name
  // containing `..` escape the remote root.
  const rawName = projectName || path.basename(localPath) || projectId;
  const folderName = sanitizeFolderName(rawName) ?? projectId;

  const direction = overrideDirection ?? cfg.direction;

  const job = (async (): Promise<SyncResult> => {
    if (direction === 'bidirectional') {
      const push = await runOne(cfg, projectId, folderName, localPath, 'push', true);
      if (!push.ok) return push;
      const pull = await runOne(cfg, projectId, folderName, localPath, 'pull', true);
      return {
        ok: pull.ok,
        exitCode: pull.exitCode,
        durationMs: push.durationMs + pull.durationMs,
        bytes: push.bytes + pull.bytes,
        filesTransferred: push.filesTransferred + pull.filesTransferred,
        logTail: `[PUSH]\n${push.logTail}\n[PULL]\n${pull.logTail}`,
      };
    }
    return runOne(cfg, projectId, folderName, localPath, direction, false);
  })();

  inFlight.set(key, job);
  try {
    return await job;
  } finally {
    inFlight.delete(key);
  }
}

export function isSyncing(username: string, projectId: string): boolean {
  return inFlight.has(inFlightKey(username, projectId));
}

export function listInFlight(username: string): string[] {
  const prefix = `${username}::`;
  const out: string[] = [];
  for (const k of inFlight.keys()) {
    if (k.startsWith(prefix)) out.push(k.slice(prefix.length));
  }
  return out;
}

/**
 * Non-destructive connection test: runs `rsync --version` through the same
 * wrapper script rsync would use, so if this succeeds a real sync's
 * SSH setup will also succeed. Uses the test `exit 0` on the remote instead
 * of `--version` (which doesn't touch ssh at all).
 */
export async function testConnection(username: string): Promise<{ ok: boolean; message: string }> {
  const cfg = getSyncConfig(username);
  if (!cfg.host || !cfg.user) return { ok: false, message: '未配置 host/user' };
  if (cfg.authMethod === 'password' && !hasSshpass()) {
    return { ok: false, message: '未安装 sshpass（密码认证需要）。请用 key 认证或安装 sshpass。' };
  }
  if (cfg.authMethod === 'password' && cfg.passwordEnc) {
    const pw = decryptPassword(cfg.passwordEnc, cfg.passwordFp);
    if (!pw) return { ok: false, message: '密码解密失败（服务端密钥可能已轮换）。请重新输入密码。' };
  }

  const wrapper = writeSshWrapper(cfg);
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  if (cfg.authMethod === 'password' && cfg.passwordEnc) {
    const pw = decryptPassword(cfg.passwordEnc, cfg.passwordFp);
    if (pw) env.SSHPASS = pw;
  }

  return await new Promise<{ ok: boolean; message: string }>((resolve) => {
    let err = '';
    // Invoke the wrapper directly — same exec path as rsync's -e would.
    const child = spawn(wrapper, [`${cfg.user}@${cfg.host}`, 'true'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    const timeout = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      resolve({ ok: false, message: '连接超时（30s）' });
    }, 30_000);
    child.stderr.on('data', (b: Buffer) => { err += b.toString(); });
    child.on('error', (e) => { clearTimeout(timeout); resolve({ ok: false, message: `spawn 失败: ${e.message}` }); });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ ok: true, message: '连接成功' });
      else resolve({ ok: false, message: err.trim() || `ssh 退出码 ${code}` });
    });
  });
}
