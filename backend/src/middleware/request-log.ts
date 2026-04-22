/*
 * Express middleware：生成 reqId，放入 AsyncLocalStorage，log HTTP 请求摘要。
 *
 * 目的：让 HTTP → WS → PTY 的因果链可通过 reqId 串起来（reviewer Important #7）。
 * 下游任何 logger 调用（包括 AsyncLocalStorage 跨越的 setImmediate / await）
 * 自动带上 reqId，无需显式传参。
 *
 * 不打印 body / query / headers——只 method/path/status/duration/user。
 */

import type { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { als, modLogger } from '../logger';

// modLogger returns a lazy Proxy when called before initLogger, so
// module-top-level use is safe.
const log = modLogger('server');

/**
 * 噪声路径：不值得每次都记一条。使用 req.originalUrl 的完整路径匹配
 * （在 path 被 Express sub-router mutate 前快照）。
 */
const SILENCED = new RegExp(
  [
    '^/health$',
    '^/api/health$',
    '^/api/auth/local-token$',      // localhost 预认证，每次挂载
    '^/api/tool/skills/check',      // 前端高频轮询
    '^/api/user-prefs/language',    // 每个页面加载都拉一次
    '^/api/claude/usage',           // dashboard 轮询
    '^/manifest\\.json$',
    '^/favicon',
    '^/assets/',                    // 前端静态资源
    '^/plugin-sdk/',
    '^/$',                          // SPA 路由回 index.html，刷新噪声大
  ].join('|'),
);

export function requestLog(req: Request, res: Response, next: NextFunction): void {
  const reqId = crypto.randomUUID().slice(0, 8);
  const start = Date.now();
  // Snapshot originalUrl (immutable); req.path is mutated by Express sub-routers
  // so by the time res.on('finish') fires it only holds the post-mount segment.
  const fullPath = (req.originalUrl || req.url).split('?')[0];

  // Reviewer I1: `requestLog` runs BEFORE `authMiddleware`, so `req.user` is
  // always undefined at middleware entry. We pass a MUTABLE context object
  // into ALS — `authMiddleware` (and anywhere else that identifies the user)
  // can populate `ctx.user` later, and downstream log events see it via the
  // same object reference. The http summary below reads user at finish time.
  const ctx: { reqId: string; user?: string } = { reqId };

  als.run(ctx, () => {
    res.on('finish', () => {
      if (SILENCED.test(fullPath)) return;
      // Pull user as set by any downstream auth middleware.
      const userAtEnd = (req as Request & { user?: { username?: string } }).user?.username;
      if (userAtEnd && !ctx.user) ctx.user = userAtEnd;
      const ms = Date.now() - start;
      const level =
        res.statusCode >= 500 ? 'error' :
        res.statusCode >= 400 ? 'warn'  :
        'info';
      log[level](
        { method: req.method, path: fullPath, status: res.statusCode, ms, user: userAtEnd },
        'http',
      );
    });
    next();
  });
}
