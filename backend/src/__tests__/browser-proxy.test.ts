import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import * as http from 'http';
import * as jwt from 'jsonwebtoken';
import { AddressInfo } from 'net';
import browserProxyRouter, {
  parseHostport,
  isAllowedProxyIp,
  resolveAllowedTarget,
  rewriteHtml,
  rewriteLocationHeader,
} from '../routes/browser-proxy';
import { getConfig } from '../config';

// Mint a valid browser-proxy session cookie using the real jwt secret —
// the test machine has a config.json so getConfig() works. CI without
// config would skip these e2e tests.
function mintProxyCookie(): string {
  const config = getConfig();
  const token = jwt.sign({ username: 'test', typ: 'browser-proxy' }, config.jwtSecret, { expiresIn: '1h' });
  return `ccweb_bp=${encodeURIComponent(token)}`;
}

describe('parseHostport', () => {
  it('接受 host:port (http only)', () => {
    expect(parseHostport('127.0.0.1:8080')).toEqual({ host: '127.0.0.1', port: 8080 });
    expect(parseHostport('localhost:3000')).toEqual({ host: 'localhost', port: 3000 });
    expect(parseHostport('192.168.50.247:5173')).toEqual({ host: '192.168.50.247', port: 5173 });
  });

  it('拒绝 s: 前缀 (v0 仅 http)', () => {
    expect(parseHostport('s:127.0.0.1:8443')).toBeNull();
  });

  it('拒绝缺端口 / 非法端口 / 黑名单端口', () => {
    expect(parseHostport('127.0.0.1')).toBeNull();
    expect(parseHostport('127.0.0.1:')).toBeNull();
    expect(parseHostport('127.0.0.1:0')).toBeNull();
    expect(parseHostport('127.0.0.1:99999')).toBeNull();
    expect(parseHostport('127.0.0.1:22')).toBeNull();
    expect(parseHostport('127.0.0.1:3389')).toBeNull();
    expect(parseHostport('127.0.0.1:6379')).toBeNull();
  });

  it('拒绝非法字符 (IPv6 brackets / 空格 / @ )', () => {
    expect(parseHostport('[::1]:8080')).toBeNull();
    expect(parseHostport('user@host:8080')).toBeNull();
    expect(parseHostport('host with space:8080')).toBeNull();
  });
});

describe('isAllowedProxyIp', () => {
  it('IPv4 字面量 RFC1918 / loopback 放行', () => {
    expect(isAllowedProxyIp('127.0.0.1')).toBe(true);
    expect(isAllowedProxyIp('127.5.5.5')).toBe(true);
    expect(isAllowedProxyIp('0.0.0.0')).toBe(true);
    expect(isAllowedProxyIp('10.0.0.5')).toBe(true);
    expect(isAllowedProxyIp('192.168.1.1')).toBe(true);
    expect(isAllowedProxyIp('172.16.5.5')).toBe(true);
    expect(isAllowedProxyIp('172.31.255.255')).toBe(true);
  });

  it('IPv4 公网 IP 拒绝', () => {
    expect(isAllowedProxyIp('1.1.1.1')).toBe(false);
    expect(isAllowedProxyIp('8.8.8.8')).toBe(false);
    expect(isAllowedProxyIp('172.32.0.1')).toBe(false);
    expect(isAllowedProxyIp('172.15.0.1')).toBe(false);
  });

  it('Cloud metadata IP 拒绝（即便是 link-local 段）', () => {
    expect(isAllowedProxyIp('169.254.169.254')).toBe(false);
    expect(isAllowedProxyIp('169.254.170.2')).toBe(false);
  });

  it('IPv4-mapped IPv6 不能绕过', () => {
    expect(isAllowedProxyIp('::ffff:8.8.8.8')).toBe(false);
    expect(isAllowedProxyIp('::ffff:127.0.0.1')).toBe(true);
    expect(isAllowedProxyIp('::ffff:169.254.169.254')).toBe(false);
  });

  it('IPv6 ULA / loopback 放行', () => {
    expect(isAllowedProxyIp('::1')).toBe(true);
    expect(isAllowedProxyIp('fc00::1')).toBe(true);
    expect(isAllowedProxyIp('fd00::1')).toBe(true);
  });

  it('Hostname 字符串不当 IP 判断（防 10.evil.com 绕过）', () => {
    // Pure-string hostnames must be rejected here; allowance only happens
    // after DNS resolution in resolveAllowedTarget.
    expect(isAllowedProxyIp('10.evil.com')).toBe(false);
    expect(isAllowedProxyIp('192.168.evil.com')).toBe(false);
    expect(isAllowedProxyIp('fc.evil.com')).toBe(false);
  });
});

describe('resolveAllowedTarget', () => {
  it('字面量 IP 放行返回原 IP', async () => {
    expect(await resolveAllowedTarget('127.0.0.1')).toBe('127.0.0.1');
    expect(await resolveAllowedTarget('192.168.1.1')).toBe('192.168.1.1');
  });

  it('字面量公网 IP 返回 null', async () => {
    expect(await resolveAllowedTarget('1.1.1.1')).toBeNull();
    expect(await resolveAllowedTarget('8.8.8.8')).toBeNull();
  });

  it('localhost 直接映射 127.0.0.1', async () => {
    expect(await resolveAllowedTarget('localhost')).toBe('127.0.0.1');
  });

  it('cloud metadata hostname 字面拒绝', async () => {
    expect(await resolveAllowedTarget('metadata.google.internal')).toBeNull();
    expect(await resolveAllowedTarget('metadata')).toBeNull();
  });

  it('cloud metadata IP 拒绝', async () => {
    expect(await resolveAllowedTarget('169.254.169.254')).toBeNull();
  });
});

describe('rewriteHtml', () => {
  const prefix = '/api/browser-proxy/127.0.0.1:8080';

  it('重写 src/href/action 的 root-absolute path', () => {
    const input = '<script src="/main.js"></script><a href="/about">x</a><form action="/login">';
    const out = rewriteHtml(input, prefix);
    expect(out).toContain('src="/api/browser-proxy/127.0.0.1:8080/main.js"');
    expect(out).toContain('href="/api/browser-proxy/127.0.0.1:8080/about"');
    expect(out).toContain('action="/api/browser-proxy/127.0.0.1:8080/login"');
  });

  it('strip 上游 <base href> 避免覆盖代理路径', () => {
    const input = '<head><base href="/"><base href="https://other.example/"></head><body></body>';
    expect(rewriteHtml(input, prefix)).toBe('<head></head><body></body>');
  });

  it('protocol-relative (//) 不改', () => {
    const input = '<img src="//cdn.example.com/x.png">';
    expect(rewriteHtml(input, prefix)).toBe(input);
  });

  it('相对路径不改', () => {
    const input = '<img src="foo/bar.png"><a href="../other">x</a>';
    expect(rewriteHtml(input, prefix)).toBe(input);
  });

  it('绝对 URL 不改', () => {
    const input = '<a href="https://example.com/path">x</a>';
    expect(rewriteHtml(input, prefix)).toBe(input);
  });

  it('单引号 attribute 也支持', () => {
    const input = "<a href='/foo'>";
    expect(rewriteHtml(input, prefix)).toContain("href='/api/browser-proxy/127.0.0.1:8080/foo'");
  });
});

describe('rewriteLocationHeader', () => {
  const parsed = { host: '127.0.0.1', port: 8080 };
  const prefix = '/api/browser-proxy/127.0.0.1:8080';

  it('absolute redirect 同 scheme/host/port → 重写为 proxy URL', () => {
    expect(rewriteLocationHeader('http://127.0.0.1:8080/new-path?x=1', parsed, prefix))
      .toBe('/api/browser-proxy/127.0.0.1:8080/new-path?x=1');
  });

  it('absolute redirect 不同 scheme → 原样保留（防协议混淆）', () => {
    expect(rewriteLocationHeader('https://127.0.0.1:8080/foo', parsed, prefix))
      .toBe('https://127.0.0.1:8080/foo');
  });

  it('absolute redirect 不同 host → 原样保留', () => {
    expect(rewriteLocationHeader('http://other.example/foo', parsed, prefix))
      .toBe('http://other.example/foo');
  });

  it('root-relative redirect → 加前缀', () => {
    expect(rewriteLocationHeader('/foo?x=1', parsed, prefix))
      .toBe('/api/browser-proxy/127.0.0.1:8080/foo?x=1');
  });

  it('protocol-relative (//) → 不改', () => {
    expect(rewriteLocationHeader('//cdn.example/x', parsed, prefix))
      .toBe('//cdn.example/x');
  });

  it('纯相对路径 → 不改', () => {
    expect(rewriteLocationHeader('foo/bar', parsed, prefix))
      .toBe('foo/bar');
  });
});

describe('e2e: browser-proxy router 跑通本地 dummy server', () => {
  let upstream: http.Server;
  let upstreamPort = 0;
  let proxy: http.Server;
  let proxyPort = 0;

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      if (req.url === '/index.html') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Frame-Options': 'DENY',
          'Content-Security-Policy': "frame-ancestors 'none'",
          'Clear-Site-Data': '"cookies"',
        });
        res.end('<!doctype html><base href="/"><body><a href="/about">x</a><script src="/m.js"></script></body>');
      } else if (req.url === '/m.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end('console.log(1);');
      } else if (req.url === '/redir') {
        res.writeHead(302, { 'Location': '/landed' });
        res.end();
      } else {
        res.writeHead(404);
        res.end('nope');
      }
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    upstreamPort = (upstream.address() as AddressInfo).port;

    const app = express();
    // Router handles its own auth (cookie-only); no middleware needed.
    app.use('/api/browser-proxy', browserProxyRouter);
    proxy = http.createServer(app);
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    proxyPort = (proxy.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  });

  const withCookie = (path: string, init?: RequestInit) => fetch(
    `http://127.0.0.1:${proxyPort}${path}`,
    { ...(init ?? {}), headers: { ...(init?.headers ?? {}), Cookie: mintProxyCookie() } },
  );

  it('无 cookie → 403 (session required)', async () => {
    const r = await fetch(`http://127.0.0.1:${proxyPort}/api/browser-proxy/127.0.0.1:${upstreamPort}/index.html`);
    expect(r.status).toBe(403);
  });

  it('伪造的 cookie (错 typ 或错 secret) → 403', async () => {
    const config = getConfig();
    const wrongTyp = jwt.sign({ username: 'x', typ: 'user' }, config.jwtSecret, { expiresIn: '1h' });
    const r1 = await fetch(`http://127.0.0.1:${proxyPort}/api/browser-proxy/127.0.0.1:${upstreamPort}/index.html`, {
      headers: { Cookie: `ccweb_bp=${encodeURIComponent(wrongTyp)}` },
    });
    expect(r1.status).toBe(403);

    const wrongSecret = jwt.sign({ username: 'x', typ: 'browser-proxy' }, 'not-the-secret', { expiresIn: '1h' });
    const r2 = await fetch(`http://127.0.0.1:${proxyPort}/api/browser-proxy/127.0.0.1:${upstreamPort}/index.html`, {
      headers: { Cookie: `ccweb_bp=${encodeURIComponent(wrongSecret)}` },
    });
    expect(r2.status).toBe(403);
  });

  it('代理 HTML：strip X-Frame / CSP / Clear-Site-Data + rewrite path + 注入 CSP sandbox', async () => {
    const r = await withCookie(`/api/browser-proxy/127.0.0.1:${upstreamPort}/index.html`);
    expect(r.status).toBe(200);
    expect(r.headers.get('x-frame-options')).toBeNull();
    expect(r.headers.get('content-security-policy')).toContain('sandbox');
    expect(r.headers.get('content-security-policy')).not.toContain('allow-same-origin');
    expect(r.headers.get('content-security-policy')).not.toContain('allow-popups-to-escape-sandbox');
    expect(r.headers.get('clear-site-data')).toBeNull();
    const body = await r.text();
    expect(body).toContain(`href="/api/browser-proxy/127.0.0.1:${upstreamPort}/about"`);
    expect(body).toContain(`src="/api/browser-proxy/127.0.0.1:${upstreamPort}/m.js"`);
    expect(body).not.toContain('<base');
  });

  it('代理 JS：原样透传不重写', async () => {
    const r = await withCookie(`/api/browser-proxy/127.0.0.1:${upstreamPort}/m.js`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('console.log(1);');
  });

  it('代理 redirect：root-relative Location 加前缀', async () => {
    const r = await withCookie(`/api/browser-proxy/127.0.0.1:${upstreamPort}/redir`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(`/api/browser-proxy/127.0.0.1:${upstreamPort}/landed`);
  });

  it('拒绝公网字面量 IP (403)', async () => {
    const r = await withCookie('/api/browser-proxy/1.1.1.1:80/');
    expect(r.status).toBe(403);
  });

  it('拒绝 cloud metadata IP (403)', async () => {
    const r = await withCookie('/api/browser-proxy/169.254.169.254:80/');
    expect(r.status).toBe(403);
  });

  it('拒绝非法 hostport (400)', async () => {
    const r = await withCookie('/api/browser-proxy/not-a-host');
    expect(r.status).toBe(400);
  });

  it('拒绝黑名单端口 (400)', async () => {
    const r = await withCookie('/api/browser-proxy/127.0.0.1:22/');
    expect(r.status).toBe(400);
  });

  it('_session 无 Bearer token → 401', async () => {
    const r = await fetch(`http://127.0.0.1:${proxyPort}/api/browser-proxy/_session`, { method: 'POST' });
    expect(r.status).toBe(401);
  });

  it('_session 非 admin Bearer → 403', async () => {
    const config = getConfig();
    const userToken = jwt.sign({ username: 'definitely-not-admin', typ: 'user' }, config.jwtSecret, { expiresIn: '1h' });
    const r = await fetch(`http://127.0.0.1:${proxyPort}/api/browser-proxy/_session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(r.status).toBe(403);
  });
});
