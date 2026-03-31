import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import AdmZip from 'adm-zip';
import { pluginManager } from '../plugin-manager';

const router = Router();

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

router.post('/install', async (req, res) => {
  const { downloadUrl, pluginId } = req.body as { downloadUrl?: string; pluginId?: string };
  if (!downloadUrl) {
    return res.status(400).json({ error: 'downloadUrl required' });
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

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const plugin = pluginManager.get(id);
  if (!plugin) return res.status(404).json({ error: 'Plugin not found' });

  pluginManager.uninstall(id);
  res.json({ success: true });
});

// ── Update (re-install from Hub) ─────────────────────────────────────────────

router.post('/:id/update', async (req, res) => {
  const { downloadUrl } = req.body as { downloadUrl?: string };
  if (!downloadUrl) return res.status(400).json({ error: 'downloadUrl required' });

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

router.put('/:id/config', (req, res) => {
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

router.put('/:id/enabled', (req, res) => {
  const { id } = req.params;
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled (boolean) required' });
  pluginManager.setEnabled(id, enabled);
  res.json({ success: true });
});

// ── Plugin private data ──────────────────────────────────────────────────────

router.get('/:id/data', (req, res) => {
  res.json(pluginManager.readData(req.params.id));
});

router.put('/:id/data', (req, res) => {
  pluginManager.writeData(req.params.id, req.body);
  res.json({ success: true });
});

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
