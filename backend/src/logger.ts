/*
 * ccweb 结构化日志（pino + pino-roll + ALS）
 *
 * === 红线（hard rules；违反视同引入安全 bug） ===
 *   1. PTY 字节流（input 或 output）永不入日志，无论截断、preview、还是 hex。
 *      terminal-manager.writeRaw / xterm output 都在此范围。理由：用户在 Claude TUI
 *      粘贴的可能是 API key / token / 密码，PTY 字节流是"用户秘密污染"的。
 *   2. 聊天消息 body 永不整段入日志；仅 { len, preview: text.slice(0, 80) }。
 *   3. 文件内容永不入日志；仅 { path, size }。
 *   4. REDACT_KEYS 白名单外的可疑字段按 "宁愿 redact 不冒险" 处理。
 *
 * === 用法 ===
 *   启动时：  await initLogger(); installFatalHandlers();
 *   模块：    const log = modLogger('terminal'); log.info({ projectId }, 'started');
 *   HTTP:     als.run({ reqId, user }, () => next())  —— middleware 里一行，下游自动带
 *   子进程:   子进程 runId 由调用方生成并塞进 mixin（见 sync / update 模块）
 *   退出:     SIGTERM 走 flushLogger() + server.close() + process.exit(0)
 *             uncaught 异常由 installFatalHandlers 接管，保证 rollStream.flushSync 后才退
 *
 * === 运行期 toggle ===
 *   kill -USR1 $(cat ~/.ccweb/ccweb.pid)   在 info / debug 之间切换级别，无需重启
 */

import pino from 'pino';
import pinoRoll from 'pino-roll';
import { AsyncLocalStorage } from 'async_hooks';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ────────────────── 常量 ──────────────────

const LOGS_DIR = path.join(os.homedir(), '.ccweb', 'logs');

const VERSION: string = (() => {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'),
    );
    return `v${pkg.version}`;
  } catch {
    return 'v?';
  }
})();

const DEFAULT_MAX_MB = parseInt(process.env.CCWEB_LOG_MAX_MB_PER_DAY || '20', 10);
const DEFAULT_RETAIN = parseInt(process.env.CCWEB_LOG_RETAIN_DAYS || '7', 10);
const DEFAULT_LEVEL = process.env.CCWEB_LOG_LEVEL || 'info';

/** Fields whose values are always replaced with '***'. */
const REDACT_KEYS: string[] = [
  'password',
  'passwordHash',
  'token',
  'jwtSecret',
  'approvalSecret',
  'authorization',
  'apiKey',
  'SSHPASS',
  'hubToken',
  'publishToken',
  'oauthToken',
  'accessToken',
  'refreshToken',
  '*.password',
  '*.token',
  '*.secret',
  'req.headers.authorization',
  'req.headers.cookie',
];

/**
 * Regex redactors applied to every string value we encounter — AND to nested
 * err.message / err.stack (pino's built-in err serializer unpacks Error into
 * `{type, message, stack}`, which bypasses both REDACT_KEYS and the shallow
 * top-level sweep unless we handle err explicitly).
 *
 * Threshold for hex redaction is 64 chars (SHA-256 / generated 32-byte hex
 * secrets). 40-hex would false-positive on git SHAs and unlucky directory
 * names (reviewer C2).
 *
 * GitHub PAT prefixes cover ghp_/gho_/ghu_/ghs_/ghr_ (legacy) and
 * github_pat_ (fine-grained). skillhub routes user PATs through this
 * logger when ops throw (reviewer N6 — zero-cost defence).
 */
const REGEX_REDACTORS: Array<[RegExp, string]> = [
  [/Bearer [A-Za-z0-9._\-]+/g, 'Bearer ***'],
  [/npm_[A-Za-z0-9]{20,}/g, 'npm_***'],
  [/\b(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{20,}\b/g, 'gh_***'],
  [/\b[a-f0-9]{64,}\b/gi, 'hex:***'],
];

function redactString(s: string): string {
  let out = s;
  for (const [re, rep] of REGEX_REDACTORS) out = out.replace(re, rep);
  return out;
}

/**
 * Recursively redact message/stack along the `err.cause` chain.
 *
 * Reviewer Critical #1: pino's err serializer expands `{cause}` into its own
 * nested `{type, message, stack}` object in the final output; the parent's
 * `err.stack` also contains a "Caused by:" block with the child stack joined.
 * Single-level redact (obj.err.message + obj.err.stack) misses cause.message
 * / cause.stack as separate fields. Depth cap 3 prevents infinite loops on
 * self-referential causes and caps CPU on malicious err graphs.
 */
function redactErrDeep(err: unknown, depth = 0): void {
  if (!err || typeof err !== 'object' || depth > 3) return;
  const e = err as { message?: unknown; stack?: unknown; cause?: unknown };
  if (typeof e.message === 'string') e.message = redactString(e.message);
  if (typeof e.stack === 'string') e.stack = redactString(e.stack);
  if (e.cause) redactErrDeep(e.cause, depth + 1);
}

// ────────────────── ALS (request context) ──────────────────

export interface LogContext {
  reqId?: string;
  user?: string;
  projectId?: string;
  wsId?: string;
  /** 跨 process 的相关性 id（sync/update 子系统），由调用方生成。 */
  runId?: string;
}

export const als = new AsyncLocalStorage<LogContext>();

export function runWithContext<T>(ctx: LogContext, fn: () => T): T {
  return als.run(ctx, fn);
}

// ────────────────── Logger 实例（延迟初始化）──────────────────

let logger: pino.Logger | null = null;
// pino-roll returns a SonicBoom stream; we hold it for flushSync on fatal exit.
let rollStream: (pino.DestinationStream & { flushSync?: () => void }) | null = null;

function ensureDir(): void {
  try {
    fs.mkdirSync(LOGS_DIR, { mode: 0o700, recursive: true });
    // chmod even if dir existed (recreated between versions)
    fs.chmodSync(LOGS_DIR, 0o700);
  } catch {
    /* best effort */
  }
}

export async function initLogger(): Promise<pino.Logger> {
  if (logger) return logger;
  ensureDir();

  rollStream = await pinoRoll({
    file: path.join(LOGS_DIR, 'ccweb'),
    dateFormat: 'yyyy-MM-dd',
    extension: '.log',
    frequency: 'daily',
    size: `${DEFAULT_MAX_MB}m`,
    limit: { count: DEFAULT_RETAIN },
    mkdir: true,
    // sonic-boom passthrough: create log files 0600 (owner-only)
    mode: 0o600,
  });

  logger = pino(
    {
      level: DEFAULT_LEVEL,
      base: { ver: VERSION, pid: process.pid },
      timestamp: pino.stdTimeFunctions.isoTime,
      messageKey: 'msg',
      errorKey: 'err',
      formatters: {
        level: (label) => ({ lvl: label }),
        log: (obj: Record<string, unknown>) => {
          // ALS injection: HTTP/WS handlers put reqId/user into ALS;
          // any log event downstream in the same async chain auto-tags.
          const ctx = als.getStore();
          if (ctx) {
            if (ctx.reqId && !obj.reqId) obj.reqId = ctx.reqId;
            if (ctx.user && !obj.user) obj.user = ctx.user;
            if (ctx.projectId && !obj.projectId) obj.projectId = ctx.projectId;
            if (ctx.wsId && !obj.wsId) obj.wsId = ctx.wsId;
            if (ctx.runId && !obj.runId) obj.runId = ctx.runId;
          }
          // Shallow regex sweep over string values.
          for (const k of Object.keys(obj)) {
            const v = obj[k];
            if (typeof v === 'string') obj[k] = redactString(v);
          }
          // Deep sweep on serialized Error along the `cause` chain.
          // pino's err serializer expands nested err.cause into its own
          // {type, message, stack} sub-object; the parent stack also
          // contains a "Caused by:" block. Single-level redact misses
          // cause.message / cause.stack as separate fields.
          // Reviewer C1 + new: undici (node fetch) errors surface TLS /
          // DNS cause with stack occasionally bearing cert fingerprints /
          // cookie headers / token fragments. Depth 3 caps self-ref loops.
          if (obj.err) redactErrDeep(obj.err);
          return obj;
        },
      },
      redact: {
        paths: REDACT_KEYS,
        censor: '***',
      },
    },
    rollStream,
  );

  // Runtime level toggle without restart.
  process.on('SIGUSR1', () => {
    if (!logger) return;
    logger.level = logger.level === 'debug' ? 'info' : 'debug';
    logger.info({ mod: 'server', level: logger.level }, 'log level toggled');
  });

  return logger;
}

/** Get the base logger. Caller MUST initLogger() first. */
export function getLogger(): pino.Logger {
  if (!logger) throw new Error('logger not initialized — call initLogger() first');
  return logger;
}

/**
 * Module-scoped child logger.
 *
 * Safe to call at module top level: returns a lazy Proxy that defers the
 * actual `logger.child({ mod })` call until the first `.info/.warn/...`.
 * This lets any module do `const log = modLogger('x')` regardless of
 * import order relative to `initLogger()`.
 *
 * If called after init, child is created eagerly (no Proxy cost).
 *
 * Pre-init calls fall back to a console-shim — bootstrap-phase events
 * still surface via daemon stdout → `~/.ccweb/ccweb.log` (plan §11). Once
 * pino is ready, the Proxy swaps to the real child for the next call.
 */
export function modLogger(mod: string): pino.Logger {
  if (logger) return logger.child({ mod });

  // Pre-init fallback: shim mapping pino-style calls to console.
  // Never throws — bootstrap code does not break if it logs before pino.
  const bootstrapShim = {
    fatal: (obj: unknown, msg?: string) => console.error(`[boot ${mod}] fatal`, msg ?? '', obj),
    error: (obj: unknown, msg?: string) => console.error(`[boot ${mod}] ${msg ?? ''}`, obj),
    warn:  (obj: unknown, msg?: string) => console.warn (`[boot ${mod}] ${msg ?? ''}`, obj),
    info:  (obj: unknown, msg?: string) => console.log  (`[boot ${mod}] ${msg ?? ''}`, obj),
    debug: () => { /* drop debug pre-init — too noisy */ },
    trace: () => { /* drop trace pre-init */ },
    child: () => bootstrapShim,
  } as unknown as pino.Logger;

  let cached: pino.Logger | null = null;
  const resolve = (): pino.Logger => {
    if (cached) return cached;
    if (!logger) return bootstrapShim; // still pre-init — route to console
    cached = logger.child({ mod });
    return cached;
  };
  // Proxy every access through resolve(). Bind functions back to the target
  // so `this` stays correct on both shim and real child.
  return new Proxy({} as pino.Logger, {
    get(_target, prop: string | symbol): unknown {
      const target = resolve();
      const val = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof val === 'function' ? (val as Function).bind(target) : val;
    },
    set(_target, prop: string | symbol, value: unknown): boolean {
      const target = resolve();
      (target as unknown as Record<string | symbol, unknown>)[prop] = value;
      return true;
    },
  });
}

// ────────────────── Fatal handlers ──────────────────

/**
 * Install process-level uncaughtException / unhandledRejection handlers
 * that write the fatal record, then call flushSync on the pino-roll stream
 * (sonic-boom) before exit. Without the flushSync, sonic-boom's async buffer
 * would drop the very stack trace we most need to investigate
 * (reviewer Critical #1).
 *
 * Note: pino v10 removed `pino.final` — the recommended pattern is direct
 * flushSync on the sonic-boom destination (pino-roll returns a SonicBoom).
 */
export function installFatalHandlers(): void {
  const base = logger;
  if (!base) throw new Error('logger not initialized');

  const handler = (err: Error, origin: string): void => {
    try {
      base.fatal({ err, origin, mod: 'server' }, 'fatal — process exiting');
    } catch {
      /* don't let logging fail stop exit */
    }
    try {
      if (rollStream && typeof rollStream.flushSync === 'function') {
        rollStream.flushSync();
      }
    } catch {
      /* flush best-effort */
    }
    process.exit(1);
  };

  process.on('uncaughtException', (err) => handler(err, 'uncaughtException'));
  process.on('unhandledRejection', (reason: unknown) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    handler(err, 'unhandledRejection');
  });
}

/**
 * Graceful flush — for SIGTERM / planned shutdown. Non-fatal path.
 * Returns a promise that resolves after pino has flushed.
 */
export function flushLogger(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!logger) {
      resolve();
      return;
    }
    logger.flush(() => resolve());
  });
}
