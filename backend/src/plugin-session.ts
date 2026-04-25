/**
 * Plugin session tokens — HMAC-signed authorization for the /api/plugin-bridge surface.
 *
 * Why: the previous bridge identified the calling plugin by an `x-plugin-id` header,
 * which any authenticated user could forge via curl to gain that plugin's manifest
 * permissions (terminal:send, session:read, ...). This module replaces the header
 * with a short-lived JWT signed by the server's jwtSecret, so the caller must have
 * first obtained the token from `POST /api/plugins/:id/session` (which is gated on
 * a valid user JWT + installed-and-enabled plugin).
 *
 * Token typ is namespaced to prevent cross-use with the main user-auth JWTs.
 */
import * as jwt from 'jsonwebtoken';
import { getConfig } from './config';
import { pluginManager } from './plugin-manager';

const TOKEN_TYP = 'ccweb-plugin-session' as const;
const TOKEN_TTL_SECONDS = 2 * 60 * 60; // 2 hours

export interface PluginSessionPayload {
  typ: typeof TOKEN_TYP;
  pid: string;   // plugin id
  usr: string;   // issuing user
  scp: string[]; // scopes frozen at issue time (plugin manifest permissions)
}

export function issuePluginSessionToken(pluginId: string, username: string): string {
  const plugin = pluginManager.get(pluginId);
  if (!plugin) throw new Error('Plugin not installed');
  if (!plugin.registry.enabled) throw new Error('Plugin disabled');

  const secret = getConfig().jwtSecret;
  const payload = {
    typ: TOKEN_TYP,
    pid: pluginId,
    usr: username,
    scp: plugin.manifest.permissions,
  };
  return jwt.sign(payload, secret, { expiresIn: TOKEN_TTL_SECONDS });
}

export function verifyPluginSessionToken(token: string): PluginSessionPayload | null {
  try {
    const secret = getConfig().jwtSecret;
    const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
    if (decoded.typ !== TOKEN_TYP) return null;
    if (typeof decoded.pid !== 'string' || typeof decoded.usr !== 'string' || !Array.isArray(decoded.scp)) return null;
    return {
      typ: TOKEN_TYP,
      pid: decoded.pid,
      usr: decoded.usr,
      scp: decoded.scp.filter((s): s is string => typeof s === 'string'),
    };
  } catch {
    return null;
  }
}

export const PLUGIN_SESSION_TTL_SECONDS = TOKEN_TTL_SECONDS;
