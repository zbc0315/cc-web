import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import AdmZip from 'adm-zip';
import { pluginManager } from '../plugin-manager';
import { requireAdmin } from '../middleware/authz';
import { issuePluginSessionToken, PLUGIN_SESSION_TTL_SECONDS } from '../plugin-session';
import type { AuthRequest } from '../auth';

const router = Router();

/** Block SSRF: only allow HTTPS downloads from trusted hosts. */
function isAllowedDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const allowedHosts = ['raw.githubusercontent.com', 'github.com', 'objects.githubusercontent.com'];
    return allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h));
  } catch { return false; }
}

// ── List installed plugins ───────────────────────────────────────────────────

router.get('/', (_req, res) => {
  const plugins = pluginManager.getAll();
  res.json(
    plugins.map((p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      author: p.manifest.author,
      description: p.manifest.description,
      icon: p.manifest.icon,
      type: p.manifest.type,
      float: p.manifest.float,
      permissions: p.manifest.permissions,
      hasBackend: !!p.manifest.backend,
      enabled: p.registry.enabled,
      installedAt: p.registry.installedAt,
      userConfig: p.registry.userConfig,
    })),
  );
});

// ── Install plugin from Hub (download zip, extract, install) ─────────────────

router.post('/install', requireAdmin, async (req, res) => {
  const { downloadUrl } = req.body as { downloadUrl?: string };
  if (!downloadUrl) {
    return res.status(400).json({ error: 'downloadUrl required' });
  }
  if (!isAllowedDownloadUrl(downloadUrl)) {
    return res.status(400).json({ error: 'Download URL must be HTTPS from github.com' });
  }

  const tmpDir = path.join(os.tmpdir(), `ccweb-plugin-${Date.now()}`);

  try {
    // Download zip
    const response = await fetch(downloadUrl, { redirect: 'follow' });
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());

    // Extract zip using adm-zip (pure JS, no external dependency)
    const extractDir = path.join(tmpDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });
    const zip = new AdmZip(buffer);
    zip.extractAllTo(extractDir, true);

    // Find manifest.json (may be in a subdirectory)
    const manifestDir = findManifestDir(extractDir);
    if (!manifestDir) {
      return res.status(400).json({ error: 'No manifest.json found in archive' });
    }

    const manifest = pluginManager.install(manifestDir);
    res.json({ success: true, plugin: { id: manifest.id, name: manifest.name, version: manifest.version } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Install failed';
    res.status(500).json({ error: message });
  } finally {
    // Cleanup tmp
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  }
});

// ── Uninstall ────────────────────────────────────────────────────────────────

router.delete('/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const plugin = pluginManager.get(id);
  if (!plugin) return res.status(404).json({ error: 'Plugin not found' });

  pluginManager.uninstall(id);
  res.json({ success: true });
});

// ── Update (re-install from Hub) ─────────────────────────────────────────────

router.post('/:id/update', requireAdmin, async (req, res) => {
  const { downloadUrl } = req.body as { downloadUrl?: string };
  if (!downloadUrl) return res.status(400).json({ error: 'downloadUrl required' });
  if (!isAllowedDownloadUrl(downloadUrl)) {
    return res.status(400).json({ error: 'Download URL must be HTTPS from github.com' });
  }

  const tmpDir = path.join(os.tmpdir(), `ccweb-plugin-${Date.now()}`);
  try {
    const response = await fetch(downloadUrl, { redirect: 'follow' });
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());

    const extractDir = path.join(tmpDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });
    const zip = new AdmZip(buffer);
    zip.extractAllTo(extractDir, true);

    const manifestDir = findManifestDir(extractDir);
    if (!manifestDir) return res.status(400).json({ error: 'No manifest.json found' });

    const manifest = pluginManager.install(manifestDir);
    res.json({ success: true, plugin: { id: manifest.id, name: manifest.name, version: manifest.version } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Update failed';
    res.status(500).json({ error: message });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  }
});

// ── User config ──────────────────────────────────────────────────────────────

router.put('/:id/config', requireAdmin, (req, res) => {
  const { id } = req.params;
  try {
    const entry = pluginManager.updateUserConfig(id, req.body);
    if (!entry) return res.status(404).json({ error: 'Plugin not found' });
    res.json(entry);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid config';
    res.status(400).json({ error: message });
  }
});

// ── Enable / disable ─────────────────────────────────────────────────────────

router.put('/:id/enabled', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled (boolean) required' });
  pluginManager.setEnabled(id, enabled);
  res.json({ success: true });
});

// ── Plugin session token (used by /api/plugin-bridge/* authorization) ───────

router.post('/:id/session', (req, res) => {
  const authReq = req as AuthRequest;
  const username = authReq.user?.username;
  if (!username) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const token = issuePluginSessionToken(req.params.id, username);
    res.json({ token, expiresIn: PLUGIN_SESSION_TTL_SECONDS });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to issue token';
    res.status(404).json({ error: message });
  }
});

// Plugin private data is served by /api/plugin-bridge/storage/:pluginId —
// the duplicate routes that used to live here were redundant and unauthenticated.

// ── Helper ───────────────────────────────────────────────────────────────────

function findManifestDir(dir: string): string | null {
  if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
  // Check one level deep (zip might contain a wrapper folder)
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const sub = path.join(dir, entry.name);
      if (fs.existsSync(path.join(sub, 'manifest.json'))) return sub;
    }
  }
  return null;
}

export default router;
