import { Router, Response, NextFunction } from 'express';
import * as dns from 'dns/promises';
import * as net from 'net';
import * as jwt from 'jsonwebtoken';
import { AuthRequest, verifyToken } from '../auth';
import { getConfig, isAdminUser } from '../config';
import { modLogger } from '../logger';

const log = modLogger('browser-proxy');

const router: Router = Router();

const BLOCKED_PORTS = new Set([
  22, 23, 25, 110, 143, 465, 587, 993, 995,
  2049, 3389, 5432, 5984, 6379, 9200, 11211, 27017,
]);

const STRIPPED_RESPONSE_HEADERS = new Set([
  'x-frame-options',
  'frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'set-cookie',
  'content-length',
  'transfer-encoding',
  'content-encoding',
  // P1 (codex review): upstream must not be able to clobber ccweb's
  // own cookies/storage or register service workers on the daemon origin.
  'clear-site-data',
  'service-worker-allowed',
  'permissions-policy',
  'feature-policy',
]);

// CSP sandbox without allow-same-origin forces an opaque origin even for
// same-origin iframes — proxied page JS cannot reach ccweb's localStorage
// / IndexedDB / cookies. Pair with the `<iframe sandbox>` attribute on the
// frontend so a direct GET to /api/browser-proxy/... in another tab is
// also opaque.
const PROXY_HTML_CSP = "sandbox allow-scripts allow-forms allow-popups";

const MAX_PROXY_SIZE = 16 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;

// Cloud metadata services + IPv4 link-local that should NEVER be reachable.
// 169.254.169.254 = AWS/GCP/Azure metadata. 169.254.170.2 = ECS task role.
const BLOCKED_IPS = new Set(['169.254.169.254', '169.254.170.2']);
const BLOCKED_HOSTS = new Set(['metadata.google.internal', 'metadata']);

// Session token presented as ?_bp_tok=<jwt> on every proxy GET. Cookies
// would have been cleaner but a sandboxed iframe (no allow-same-origin)
// is treated as opaque origin → SameSite=Lax cookies are NOT sent on
// subresource requests originating inside the iframe. The query-param
// approach trades access-log exposure for working sandboxed iframes.
// Token is stripped before the URL is forwarded upstream so it never
// reaches the proxied site.
const TOKEN_QUERY_PARAM = '_bp_tok';
const SESSION_MAX_AGE_SEC = 60 * 60;

interface ParsedHostport {
  host: string;
  port: number;
}

export function parseHostport(raw: string): ParsedHostport | null {
  // v0: http only. IPv6 literals out of scope (path-segment ambiguity).
  const m = raw.match(/^([a-zA-Z0-9.\-_]+):(\d{1,5})$/);
  if (!m) return null;
  const host = m[1].toLowerCase();
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (BLOCKED_PORTS.has(port)) return null;
  return { host, port };
}

/**
 * Allowlist check on a literal IPv4/IPv6 address. Unlike notify-service's
 * isPrivateAddress (which is a deny-list for outbound webhooks and uses
 * loose startsWith on the *hostname*), this is strictly numeric and refuses
 * the cloud-metadata link-local addresses even though they're RFC1918.
 */
export function isAllowedProxyIp(addr: string): boolean {
  const a = addr.replace(/^\[|\]$/g, '').toLowerCase();
  const mapped = a.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isAllowedProxyIp(mapped[1]);
  // Reject anything that isn't a real IP — without this `10.evil.com`
  // would match the `/^10\./` prefix below and slip through.
  if (!net.isIP(a)) return false;
  if (BLOCKED_IPS.has(a)) return false;
  if (a === '0.0.0.0' || a === '::1') return true;
  if (/^127\./.test(a)) return true;
  if (/^10\./.test(a)) return true;
  if (/^192\.168\./.test(a)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) return true;
  if (/^fc/.test(a) || /^fd/.test(a)) return true; // ULA v6
  return false;
}

/**
 * Resolve hostname to a single IP (or accept literal IP) and confirm it's
 * in the allowed private range. Returns the resolved IP to pin against
 * DNS-rebinding TOCTOU: callers fetch by IP, not by hostname.
 */
export async function resolveAllowedTarget(host: string): Promise<string | null> {
  const h = host.replace(/\.$/, '').toLowerCase();
  if (BLOCKED_HOSTS.has(h)) return null;
  if (h === 'localhost') return '127.0.0.1';
  if (net.isIP(h)) return isAllowedProxyIp(h) ? h : null;
  try {
    const records = await dns.lookup(h, { all: true, verbatim: true });
    if (records.length === 0) return null;
    if (!records.every((r) => isAllowedProxyIp(r.address))) return null;
    return records[0].address;
  } catch {
    return null;
  }
}

function appendToken(url: string, token: string): string {
  // Preserve fragment, insert token into query string.
  const hashIdx = url.indexOf('#');
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : '';
  const beforeHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const sep = beforeHash.includes('?') ? '&' : '?';
  return `${beforeHash}${sep}${TOKEN_QUERY_PARAM}=${encodeURIComponent(token)}${hash}`;
}

/**
 * Strip `_bp_tok=<jwt>` from a subPath string ("/foo/bar?x=1&_bp_tok=...&y=2#z")
 * so the upstream never sees the session token. Idempotent: missing token
 * is a no-op. Handles token in any query position and an empty resulting
 * query (leaves no orphan "?").
 */
export function stripTokenFromSubPath(subPath: string): string {
  const hashIdx = subPath.indexOf('#');
  const hash = hashIdx >= 0 ? subPath.slice(hashIdx) : '';
  const beforeHash = hashIdx >= 0 ? subPath.slice(0, hashIdx) : subPath;
  const qIdx = beforeHash.indexOf('?');
  if (qIdx < 0) return subPath;
  const pathPart = beforeHash.slice(0, qIdx);
  const queryPart = beforeHash.slice(qIdx + 1);
  const kept = queryPart
    .split('&')
    .filter((kv) => kv !== '' && !kv.startsWith(`${TOKEN_QUERY_PARAM}=`) && kv !== TOKEN_QUERY_PARAM);
  const newQuery = kept.length > 0 ? `?${kept.join('&')}` : '';
  return `${pathPart}${newQuery}${hash}`;
}

/**
 * Rewrite root-relative absolute paths (src/href/action="/...") through
 * this proxy. Also strip any upstream `<base href="...">` so the original
 * declaration cannot redirect relative resolution back out to the bare
 * ccweb origin. Each rewritten URL carries the session token so the iframe
 * can fetch it without relying on cookies that the sandbox would drop.
 * Protocol-relative and relative paths are untouched — relative URLs are
 * resolved by the browser against the iframe URL (which already has the
 * token in its query), and the browser preserves that query on the resolved
 * URL? No — relative resolution does NOT inherit query. So relative paths
 * within the page will appear without the token. They will fail. v0 limit.
 */
export function rewriteHtml(html: string, prefix: string, token: string): string {
  return html
    .replace(/<base\b[^>]*>/gi, '')
    .replace(
      /\b(src|href|action)\s*=\s*(["'])\/(?!\/)([^"']*)\2/gi,
      (_, attr: string, quote: string, rest: string) => {
        const rewritten = appendToken(`${prefix}/${rest}`, token);
        return `${attr}=${quote}${rewritten}${quote}`;
      },
    );
}

export function rewriteLocationHeader(
  loc: string,
  parsed: ParsedHostport,
  mountPrefix: string,
  token: string,
): string {
  try {
    const absUrl = new URL(loc);
    // Same scheme + same host + same port → safe to rewrite. Different
    // scheme on the same host (e.g. http page issuing https:// redirect)
    // is treated as cross-target and left untouched.
    const expectedProto = 'http:';
    const sameProto = absUrl.protocol === expectedProto;
    const sameHost = absUrl.hostname.toLowerCase() === parsed.host;
    const samePort = Number(absUrl.port || 80) === parsed.port;
    if (sameProto && sameHost && samePort) {
      return appendToken(`${mountPrefix}${absUrl.pathname}${absUrl.search}${absUrl.hash}`, token);
    }
    return loc;
  } catch {
    if (loc.startsWith('/') && !loc.startsWith('//')) {
      return appendToken(`${mountPrefix}${loc}`, token);
    }
    return loc;
  }
}

function hasValidSessionToken(req: AuthRequest): boolean {
  const token = req.query[TOKEN_QUERY_PARAM];
  if (typeof token !== 'string' || !token) return false;
  try {
    const config = getConfig();
    const decoded = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    return decoded.typ === 'browser-proxy' && typeof decoded.username === 'string';
  } catch {
    return false;
  }
}

/**
 * Explicit-Bearer admin gate. Deliberately does NOT fall back to localhost
 * auto-auth: any same-machine browser can blind-CSRF /_session if we trust
 * the socket address, which would let a malicious page mint cookies and
 * then drive arbitrary GETs through /api/browser-proxy/. Caller must
 * present a real admin JWT (the frontend already has one via
 * /api/auth/local-token or /api/auth/login).
 */
function requireBearerAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Bearer token required' });
    return;
  }
  const user = verifyToken(authHeader.slice(7));
  if (!user || !isAdminUser(user.username)) {
    res.status(403).json({ error: 'Admin only' });
    return;
  }
  req.user = user;
  next();
}

/**
 * Issues a short-lived JWT that the frontend attaches as ?_bp_tok=... to
 * the iframe src. We deliberately do NOT use a cookie here — sandboxed
 * iframes (no allow-same-origin) are treated as opaque origins, and Lax
 * cookies are not sent on subresource requests originating inside such
 * iframes. The query-param token is the only way to authenticate iframe
 * subresource fetches without relaxing the sandbox.
 */
router.post('/_session', requireBearerAdmin, (req: AuthRequest, res: Response): void => {
  const config = getConfig();
  const token = jwt.sign(
    { username: req.user?.username, typ: 'browser-proxy' },
    config.jwtSecret,
    { expiresIn: `${SESSION_MAX_AGE_SEC}s` },
  );
  res.json({ token, maxAge: SESSION_MAX_AGE_SEC });
});

async function handle(req: AuthRequest, res: Response): Promise<void> {
  // Trust ONLY the query-param session token. Route mounted without
  // authMiddleware so localhost auto-auth / any CSRF-able header cannot
  // reach the proxy. Token can only be issued by POST /_session which
  // requires explicit Bearer admin.
  if (!hasValidSessionToken(req)) {
    res.status(403).send('Browser proxy session required — call POST /_session first');
    return;
  }
  const sessionToken = req.query[TOKEN_QUERY_PARAM] as string;

  const hostportRaw = req.params['hostport'];
  if (!hostportRaw) { res.status(400).send('hostport required'); return; }

  const parsed = parseHostport(hostportRaw);
  if (!parsed) {
    res.status(400).send('Invalid hostport (expected host:port, http only, ports 1-65535 except blocked)');
    return;
  }

  const resolvedIp = await resolveAllowedTarget(parsed.host);
  if (!resolvedIp) {
    res.status(403).send('Target not allowed — must resolve to RFC1918 / loopback (excluding cloud-metadata)');
    return;
  }

  // req.url is mount-relative. Strip hostport segment + the session-token
  // query param before forwarding to upstream (token must NEVER leak to
  // the proxied site).
  const afterMount = req.url.replace(/^\/+/, '');
  const slashIdx = afterMount.indexOf('/');
  const rawSubPath = slashIdx >= 0 ? afterMount.slice(slashIdx) : '/';
  const subPath = stripTokenFromSubPath(rawSubPath);

  // Fetch by resolved IP — pins the connection to the address we just
  // validated, so DNS rebinding between validation and fetch is harmless.
  const targetUrl = `http://${resolvedIp}:${parsed.port}${subPath}`;
  const mountPrefix = `/api/browser-proxy/${hostportRaw}`;

  try {
    const upstream = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        // Send original hostname as Host so vhost-aware servers route correctly.
        'Host': `${parsed.host}:${parsed.port}`,
        'User-Agent': req.headers['user-agent'] || 'ccweb-browser-proxy',
        'Accept': (req.headers['accept'] as string) || '*/*',
        'Accept-Language': (req.headers['accept-language'] as string) || 'en',
      },
    });

    const declaredLen = Number(upstream.headers.get('content-length') || '0');
    if (declaredLen > MAX_PROXY_SIZE) {
      res.status(413).send('Upstream response too large for proxy');
      return;
    }

    res.status(upstream.status);

    upstream.headers.forEach((value, name) => {
      const lower = name.toLowerCase();
      if (STRIPPED_RESPONSE_HEADERS.has(lower)) return;
      if (lower === 'location') {
        res.setHeader('Location', rewriteLocationHeader(value, parsed, mountPrefix, sessionToken));
        return;
      }
      res.setHeader(name, value);
    });

    const contentType = upstream.headers.get('content-type') || '';
    const isHtml = contentType.includes('text/html');

    // Stream-aware cap: read in chunks, abort if we exceed limit before
    // the whole body lands in memory. Compatible with chunked responses
    // that don't declare Content-Length.
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (upstream.body) {
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_PROXY_SIZE) {
          reader.cancel().catch(() => {});
          if (!res.headersSent) res.status(413);
          res.end();
          return;
        }
        chunks.push(value);
      }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));

    if (isHtml) {
      res.setHeader('Content-Security-Policy', PROXY_HTML_CSP);
      const rewritten = rewriteHtml(buf.toString('utf-8'), mountPrefix, sessionToken);
      const out = Buffer.from(rewritten, 'utf-8');
      res.setHeader('Content-Length', String(out.byteLength));
      res.end(out);
    } else {
      res.setHeader('Content-Length', String(buf.byteLength));
      res.end(buf);
    }
  } catch (err) {
    const name = (err as Error | undefined)?.name;
    const reason = name === 'TimeoutError' ? 'Upstream timeout' : 'Upstream fetch failed';
    log.warn({ err, targetUrl }, 'browser-proxy upstream error');
    if (!res.headersSent) {
      res.status(502).send(reason);
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}

router.get('/:hostport', handle);
router.get('/:hostport/*', handle);

export default router;
