import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from './config';
import { Router } from 'express';
import { modLogger } from './logger';

const log = modLogger('plugin');

// ── Types ────────────────────────────────────────────────────────────────────

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  icon?: string;
  type: 'float';
  float: {
    defaultWidth: number;
    defaultHeight: number;
    minWidth?: number;
    minHeight?: number;
    resizable?: boolean;
    scope: {
      allowed: PluginScope[];
      default: PluginScope;
    };
    clickable: {
      allowed: boolean[];
      default: boolean;
    };
  };
  permissions: string[];
  backend?: { entry: string };
  frontend: { entry: string };
}

export type PluginScope = 'global' | 'dashboard' | 'project' | 'project:specific';

export interface PluginUserConfig {
  scope?: PluginScope;
  clickable?: boolean;
  projectIds?: string[];
  floatPosition?: { x: number; y: number };
  floatSize?: { w: number; h: number };
}

export interface PluginRegistryEntry {
  id: string;
  version: string;
  enabled: boolean;
  installedAt: string;
  userConfig: PluginUserConfig;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  registry: PluginRegistryEntry;
  router?: Router;
  dir: string;
}

// ── Paths ────────────────────────────────────────────────────────────────────

const PLUGINS_DIR = path.join(DATA_DIR, 'plugins');
const REGISTRY_FILE = path.join(DATA_DIR, 'plugin-registry.json');
const PLUGIN_DATA_DIR = path.join(DATA_DIR, 'plugin-data');

function ensureDirs(): void {
  for (const d of [PLUGINS_DIR, PLUGIN_DATA_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

// ── Registry persistence ─────────────────────────────────────────────────────

function readRegistry(): PluginRegistryEntry[] {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8')) as PluginRegistryEntry[];
  } catch {
    return [];
  }
}

function writeRegistry(entries: PluginRegistryEntry[]): void {
  const tmp = REGISTRY_FILE + `.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf-8');
  fs.renameSync(tmp, REGISTRY_FILE);
}

// ── PluginManager ────────────────────────────────────────────────────────────

class PluginManager {
  private plugins = new Map<string, LoadedPlugin>();

  /** Auto-install bundled plugins from package's plugins/ dir on first run */
  installBundled(): void {
    ensureDirs();
    const bundledDir = path.join(__dirname, '../../plugins');
    if (!fs.existsSync(bundledDir)) return;

    const registry = readRegistry();
    for (const dirname of fs.readdirSync(bundledDir)) {
      const srcDir = path.join(bundledDir, dirname);
      if (!fs.statSync(srcDir).isDirectory()) continue;
      const manifestPath = path.join(srcDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PluginManifest;
        const existing = registry.find((r) => r.id === manifest.id);
        if (existing && existing.version === manifest.version) continue; // already installed same version
        log.info({ pluginId: manifest.id, version: manifest.version }, 'installing bundled plugin');
        this.install(srcDir);
      } catch (err) {
        log.error({ err, pluginDir: dirname }, 'bundled plugin install failed');
      }
    }
  }

  /** Scan plugins dir, load manifests and backend routers */
  loadAll(): void {
    ensureDirs();
    const registry = readRegistry();
    if (!fs.existsSync(PLUGINS_DIR)) return;

    for (const dirname of fs.readdirSync(PLUGINS_DIR)) {
      const pluginDir = path.join(PLUGINS_DIR, dirname);
      if (!fs.statSync(pluginDir).isDirectory()) continue;

      const manifestPath = path.join(pluginDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PluginManifest;
        const entry = registry.find((r) => r.id === manifest.id);
        if (!entry) continue; // not in registry = orphaned folder

        let router: Router | undefined;
        if (manifest.backend?.entry) {
          try {
            const backendPath = path.join(pluginDir, manifest.backend.entry);
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const mod = require(backendPath);
            router = mod.router || mod.default?.router;
            if (mod.onStart) mod.onStart();
          } catch (err) {
            log.error({ err, pluginId: manifest.id }, 'plugin backend load failed');
          }
        }

        this.plugins.set(manifest.id, { manifest, registry: entry, router, dir: pluginDir });
      } catch (err) {
        log.error({ err, pluginDir: dirname }, 'plugin manifest load failed');
      }
    }

    log.info({ count: this.plugins.size }, 'plugins loaded');
  }

  getAll(): LoadedPlugin[] {
    return [...this.plugins.values()];
  }

  get(id: string): LoadedPlugin | undefined {
    return this.plugins.get(id);
  }

  getRegistry(): PluginRegistryEntry[] {
    return readRegistry();
  }

  /** Install a plugin from extracted directory */
  install(sourceDir: string): PluginManifest {
    ensureDirs();
    const manifestPath = path.join(sourceDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error('manifest.json not found');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PluginManifest;
    if (!manifest.id || !manifest.name || !manifest.version) {
      throw new Error('Invalid manifest: id, name, version required');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(manifest.id)) {
      throw new Error('Invalid manifest.id: only alphanumeric, hyphens, and underscores allowed');
    }

    const destDir = path.join(PLUGINS_DIR, manifest.id);

    // Remove old version if exists
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true });
    }

    // Copy plugin files
    copyDirSync(sourceDir, destDir);

    // Update registry (preserve userConfig on update)
    const registry = readRegistry();
    const existing = registry.find((r) => r.id === manifest.id);
    const entry: PluginRegistryEntry = {
      id: manifest.id,
      version: manifest.version,
      enabled: true,
      installedAt: new Date().toISOString(),
      userConfig: existing?.userConfig ?? {},
    };
    const newRegistry = registry.filter((r) => r.id !== manifest.id);
    newRegistry.push(entry);
    writeRegistry(newRegistry);

    // Load backend if present
    let router: Router | undefined;
    if (manifest.backend?.entry) {
      try {
        const backendPath = path.join(destDir, manifest.backend.entry);
        // Clear require cache for hot-reload on update
        delete require.cache[require.resolve(backendPath)];
        const mod = require(backendPath);
        router = mod.router || mod.default?.router;
        if (mod.onStart) mod.onStart();
      } catch (err) {
        log.error({ err, pluginId: manifest.id }, 'plugin backend reload failed');
      }
    }

    this.plugins.set(manifest.id, { manifest, registry: entry, router, dir: destDir });
    return manifest;
  }

  /** Uninstall a plugin */
  uninstall(id: string): void {
    const plugin = this.plugins.get(id);
    if (plugin) {
      // Call onStop if backend has it
      if (plugin.manifest.backend?.entry) {
        try {
          const mod = require(path.join(plugin.dir, plugin.manifest.backend.entry));
          if (mod.onStop) mod.onStop();
        } catch { /* best effort */ }
      }
      this.plugins.delete(id);
    }

    // Remove files
    const destDir = path.join(PLUGINS_DIR, id);
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true });
    }

    // Remove plugin data
    const dataDir = path.join(PLUGIN_DATA_DIR, id);
    if (fs.existsSync(dataDir)) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }

    // Remove from registry
    const registry = readRegistry().filter((r) => r.id !== id);
    writeRegistry(registry);
  }

  /** Update user config for a plugin */
  updateUserConfig(id: string, config: Partial<PluginUserConfig>): PluginRegistryEntry | null {
    const registry = readRegistry();
    const entry = registry.find((r) => r.id === id);
    if (!entry) return null;

    // Validate against manifest constraints
    const plugin = this.plugins.get(id);
    if (plugin) {
      const { float } = plugin.manifest;
      if (config.scope && !float.scope.allowed.includes(config.scope)) {
        throw new Error(`Scope "${config.scope}" not allowed. Allowed: ${float.scope.allowed.join(', ')}`);
      }
      if (config.clickable !== undefined && !float.clickable.allowed.includes(config.clickable)) {
        throw new Error(`Clickable "${config.clickable}" not allowed`);
      }
    }

    entry.userConfig = { ...entry.userConfig, ...config };
    writeRegistry(registry);

    // Update in-memory
    if (plugin) plugin.registry = entry;
    return entry;
  }

  /** Toggle plugin enabled/disabled */
  setEnabled(id: string, enabled: boolean): void {
    const registry = readRegistry();
    const entry = registry.find((r) => r.id === id);
    if (!entry) return;
    entry.enabled = enabled;
    writeRegistry(registry);
    const plugin = this.plugins.get(id);
    if (plugin) plugin.registry = entry;
  }

  /** Get plugin data dir (creates if missing) */
  getDataDir(id: string): string {
    const dir = path.join(PLUGIN_DATA_DIR, id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Read plugin private data */
  readData(id: string): Record<string, unknown> {
    const file = path.join(this.getDataDir(id), 'data.json');
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      return {};
    }
  }

  /** Write plugin private data */
  writeData(id: string, data: Record<string, unknown>): void {
    const file = path.join(this.getDataDir(id), 'data.json');
    const tmp = file + `.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
  }

  /** Get frontend dir for serving static files */
  getFrontendDir(id: string): string | null {
    const plugin = this.plugins.get(id);
    if (!plugin) return null;
    return path.join(plugin.dir, 'frontend');
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const pluginManager = new PluginManager();
