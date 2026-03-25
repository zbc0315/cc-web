/**
 * HooksManager — manages ccweb entries in ~/.claude/settings.json
 *
 * install() is idempotent: always calls uninstall() first, then adds fresh hooks.
 * This handles the crash-without-cleanup scenario correctly.
 *
 * Hook commands include "# ccweb-hook" marker at the end so uninstall()
 * can precisely identify and remove them without touching user-defined hooks.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CLAUDE_SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');
const CCWEB_MARKER = '# ccweb-hook';

const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'Stop'] as const;
type HookEvent = typeof HOOK_EVENTS[number];

/**
 * Build the curl command for each hook event.
 * Note: Stop event does NOT have CLAUDE_SESSION_ID available, so we omit it.
 */
function buildCommand(event: HookEvent, portFile: string): string {
  const baseBody = [
    `\\"event\\":\\"${event}\\"`,
    `\\"dir\\":\\"$CLAUDE_PROJECT_DIR\\"`,
  ];

  // PreToolUse and PostToolUse have CLAUDE_TOOL_NAME and CLAUDE_SESSION_ID
  if (event === 'PreToolUse' || event === 'PostToolUse') {
    baseBody.push(`\\"tool\\":\\"$CLAUDE_TOOL_NAME\\"`);
    baseBody.push(`\\"session\\":\\"$CLAUDE_SESSION_ID\\"`);
  }

  const body = baseBody.join(',');

  return (
    `curl -sf -X POST "http://localhost:$(cat ${portFile})/api/hooks"` +
    ` -H "Content-Type: application/json"` +
    ` -d "{${body}}" || true  ${CCWEB_MARKER}`
  );
}

function readSettings(): Record<string, unknown> {
  if (!fs.existsSync(CLAUDE_SETTINGS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function atomicWrite(data: Record<string, unknown>): void {
  const dir = path.dirname(CLAUDE_SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = CLAUDE_SETTINGS_FILE + `.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, CLAUDE_SETTINGS_FILE);
}

class HooksManager {
  private portFile: string;

  constructor(portFile: string) {
    this.portFile = portFile;
  }

  /** Remove all ccweb hook entries (identified by CCWEB_MARKER) */
  uninstall(): void {
    const settings = readSettings();
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
    let changed = false;

    for (const event of HOOK_EVENTS) {
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

    if (changed) {
      settings.hooks = hooks;
      atomicWrite(settings);
      console.log('[HooksManager] Uninstalled ccweb hooks');
    }
  }

  /** Idempotent install: remove stale entries first, then add fresh hooks */
  install(): void {
    this.uninstall(); // always clean first — handles crash-without-cleanup

    const settings = readSettings();
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

    for (const event of HOOK_EVENTS) {
      const list = (hooks[event] ?? []) as Array<{ hooks: Array<{ type: string; command: string }> }>;
      list.push({ hooks: [{ type: 'command', command: buildCommand(event, this.portFile) }] });
      hooks[event] = list;
    }

    settings.hooks = hooks;
    atomicWrite(settings);
    console.log('[HooksManager] Installed ccweb hooks');
  }

  isInstalled(): boolean {
    const settings = readSettings();
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
    const list = (hooks['PreToolUse'] ?? []) as Array<{ hooks?: Array<{ command?: string }> }>;
    return list.some((g) => g.hooks?.some((h) => h.command?.includes(CCWEB_MARKER)));
  }
}

export { HooksManager };
