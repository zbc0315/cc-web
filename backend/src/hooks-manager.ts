/**
 * HooksManager — manages ccweb entries in CLI tool settings files
 *
 * install() is idempotent: always calls uninstall() first, then adds fresh hooks.
 * This handles the crash-without-cleanup scenario correctly.
 *
 * Hook commands include "# ccweb-hook" marker at the end so uninstall()
 * can precisely identify and remove them without touching user-defined hooks.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getAdapter } from './adapters';
import type { CliToolAdapter } from './adapters';
import type { CliTool } from './types';

const CCWEB_MARKER = '# ccweb-hook';

function readSettings(settingsPath: string): Record<string, unknown> | null {
  if (!fs.existsSync(settingsPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    console.warn(`[HooksManager] ${settingsPath} contains invalid JSON — hook management skipped to avoid data loss`);
    return null; // null signals corruption to callers
  }
}

function atomicWrite(settingsPath: string, data: Record<string, unknown>): void {
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = settingsPath + `.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, settingsPath);
}

class HooksManager {
  private portFile: string;

  constructor(portFile: string) {
    this.portFile = portFile;
  }

  /** Remove all ccweb hook entries (identified by CCWEB_MARKER) for a specific adapter */
  private uninstallForAdapter(adapter: CliToolAdapter): void {
    const settingsPath = adapter.getHooksSettingsPath();
    if (!settingsPath) return;

    const settings = readSettings(settingsPath);
    if (settings === null) return; // corrupted — skip to avoid data loss
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
    let changed = false;

    for (const event of adapter.getHookEvents()) {
      const list = (hooks[event] ?? []) as Array<{ hooks?: Array<{ command?: string }> }>;
      const cleaned = list
        .map((group) => ({
          ...group,
          hooks: (group.hooks ?? []).filter((h) => !h.command?.includes(CCWEB_MARKER)),
        }))
        .filter((group) => (group.hooks?.length ?? 0) > 0);

      if (JSON.stringify(cleaned) !== JSON.stringify(list)) {
        hooks[event] = cleaned;
        changed = true;
      }
    }

    // Clean up statusLine if it was set by ccweb
    if (adapter.tool === 'claude' && settings.statusLine) {
      const sl = settings.statusLine as { command?: string };
      if (sl.command?.includes('/api/hooks/context')) {
        delete settings.statusLine;
        changed = true;
      }
    }

    if (changed) {
      settings.hooks = hooks;
      atomicWrite(settingsPath, settings);
      console.log(`[HooksManager] Uninstalled ccweb hooks for ${adapter.tool}`);
    }
  }

  /** Install hooks for a specific adapter */
  private installForAdapter(adapter: CliToolAdapter): void {
    this.uninstallForAdapter(adapter); // always clean first — handles crash-without-cleanup

    const settingsPath = adapter.getHooksSettingsPath();
    if (!settingsPath) return;

    const settings = readSettings(settingsPath);
    if (settings === null) return; // corrupted — skip to avoid data loss
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

    for (const event of adapter.getHookEvents()) {
      const command = adapter.buildHookCommand(event, this.portFile);
      if (!command) continue;
      const list = (hooks[event] ?? []) as Array<{ hooks: Array<{ type: string; command: string; timeout?: number }> }>;
      // PermissionRequest holds the tool until the user decides — allow effectively unbounded wait.
      const hookEntry: { type: string; command: string; timeout?: number } = { type: 'command', command };
      if (event === 'PermissionRequest') hookEntry.timeout = 86400; // 24h, i.e. "no practical limit"
      list.push({ hooks: [hookEntry] });
      hooks[event] = list;
    }

    settings.hooks = hooks;

    // Install status line for context tracking (Claude only)
    if (adapter.tool === 'claude') {
      const statusLineCmd =
        `jq -r '{dir: .cwd, context_window: .context_window}' | ` +
        `curl -sf -X POST "http://localhost:$(cat ${this.portFile})/api/hooks/context" ` +
        `-H "Content-Type: application/json" -d @- || true`;
      settings.statusLine = { type: 'command', command: statusLineCmd };
    }

    atomicWrite(settingsPath, settings);
    console.log(`[HooksManager] Installed ccweb hooks for ${adapter.tool}`);
  }

  /** Remove all ccweb hook entries from all supported tools */
  uninstall(): void {
    for (const tool of ['claude', 'opencode', 'codex', 'qwen', 'gemini', 'terminal'] as CliTool[]) {
      this.uninstallForAdapter(getAdapter(tool));
    }
  }

  /** Idempotent install: remove stale entries first, then add fresh hooks for all supported tools */
  install(): void {
    for (const tool of ['claude', 'opencode', 'codex', 'qwen', 'gemini', 'terminal'] as CliTool[]) {
      this.installForAdapter(getAdapter(tool));
    }
  }

  isInstalled(): boolean {
    // Check the primary tool (Claude) — if its hooks are installed, consider all installed
    const adapter = getAdapter('claude');
    const settingsPath = adapter.getHooksSettingsPath();
    if (!settingsPath) return false;
    const settings = readSettings(settingsPath);
    if (settings === null) return false;
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
    const events = adapter.getHookEvents();
    if (events.length === 0) return false;
    const list = (hooks[events[0]] ?? []) as Array<{ hooks?: Array<{ command?: string }> }>;
    return list.some((g) => g.hooks?.some((h) => h.command?.includes(CCWEB_MARKER)));
  }
}

export { HooksManager };
