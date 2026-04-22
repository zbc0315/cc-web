import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { CliToolAdapter, ToolModel, ToolSkillItem, ToolSkillsData, UsageInfo } from './types';
import type { ChatBlock, ChatBlockItem } from '../session-manager';
import { queryUsage as claudeQueryUsage, clearUsageCache as claudeClearUsageCache } from '../usage-terminal';
import { modLogger } from '../logger';

const log = modLogger('adapter');

// ── JSONL record types (Claude Code internal format) ─────────────────────────

interface ContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | string;
  text?: string;
  thinking?: string;
  content?: string;
  name?: string;
  input?: unknown;
}

interface ClaudeRecord {
  type: 'user' | 'assistant' | string;
  uuid?: string;
  timestamp?: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function encodeProjectPath(folderPath: string): string {
  return folderPath.replace(/[\/ _]/g, '-');
}

function extractText(content: string | ContentBlock[] | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content.trim();
  return content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!.trim())
    .join('\n')
    .trim();
}

function isInternalUserMessage(content: string): boolean {
  return content.startsWith('<command-') || content.startsWith('/');
}

const CCWEB_MARKER = '# ccweb-hook';

/** Deep-cap string values inside an arbitrary JSON-like value so a massive
 *  `Write({file_path, content})` doesn't balloon the WS payload.  Structure is
 *  preserved; only individual string leaves are capped.  Non-string, non-object
 *  values pass through unchanged. */
function capStrings(val: unknown, maxStrLen: number): unknown {
  if (typeof val === 'string') {
    if (val.length <= maxStrLen) return val;
    return val.slice(0, maxStrLen) + `…[truncated ${val.length - maxStrLen} chars]`;
  }
  if (Array.isArray(val)) return val.map((v) => capStrings(v, maxStrLen));
  if (val && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) out[k] = capStrings(v, maxStrLen);
    return out;
  }
  return val;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export class ClaudeAdapter implements CliToolAdapter {
  readonly tool = 'claude';

  // ── Command ─────────────────────────────────────────────────────────────
  buildCommand(permissionMode: 'limited' | 'unlimited', continueSession: boolean): string {
    const cont = continueSession ? ' --continue' : '';
    return permissionMode === 'unlimited'
      ? `claude --dangerously-skip-permissions${cont}`
      : `claude${cont}`;
  }

  supportsContinue(): boolean {
    return true;
  }

  // ── Session ─────────────────────────────────────────────────────────────
  getSessionDir(folderPath: string): string | null {
    return path.join(os.homedir(), '.claude', 'projects', encodeProjectPath(folderPath));
  }

  parseLineBlocks(line: string): ChatBlock | null {
    let record: ClaudeRecord;
    try { record = JSON.parse(line) as ClaudeRecord; } catch { return null; }
    const ts = record.timestamp ?? new Date().toISOString();

    if (record.type === 'user' && record.message?.role === 'user') {
      const text = extractText(record.message.content);
      if (!text || isInternalUserMessage(text)) return null;
      return { role: 'user', timestamp: ts, blocks: [{ type: 'text', content: text }] };
    }

    if (record.type === 'assistant' && record.message?.role === 'assistant') {
      const content = record.message.content;
      if (!content) return null;
      if (typeof content === 'string') {
        const trimmed = content.trim();
        return trimmed ? { role: 'assistant', timestamp: ts, blocks: [{ type: 'text', content: trimmed }] } : null;
      }
      const blocks: ChatBlockItem[] = [];
      for (const b of content) {
        if (b.type === 'text' && b.text?.trim()) {
          blocks.push({ type: 'text', content: b.text.trim() });
        } else if (b.type === 'thinking') {
          const text = b.thinking ?? b.text;
          if (text?.trim()) blocks.push({ type: 'thinking', content: text.trim() });
        } else if (b.type === 'tool_use') {
          const name = b.name ?? 'tool';
          const cappedInput = capStrings(b.input, 4000);
          const jsonStr = cappedInput !== undefined ? JSON.stringify(cappedInput) : '';
          blocks.push({
            type: 'tool_use',
            // Keep legacy `name(args-truncated)` shape for backwards compat
            // with older frontends that just render fenced markdown.
            content: `${name}(${jsonStr.slice(0, 200)})`,
            tool: name,
            input: cappedInput,
          });
        } else if (b.type === 'tool_result') {
          const text = b.content ?? b.text;
          if (text?.trim()) {
            const full = typeof text === 'string' ? text.trim() : JSON.stringify(text);
            const cap = 4000;
            const truncated = full.length > cap ? full.slice(0, cap) + `\n…[truncated ${full.length - cap} chars]` : full;
            blocks.push({
              type: 'tool_result',
              content: full.slice(0, 200),  // legacy short form
              output: truncated,            // richer form for block-aware renderers
            });
          }
        }
      }
      return blocks.length > 0 ? { role: 'assistant', timestamp: ts, blocks } : null;
    }

    return null;
  }

  // ── Hooks ───────────────────────────────────────────────────────────────
  getHooksSettingsPath(): string | null {
    return path.join(os.homedir(), '.claude', 'settings.json');
  }

  getHookEvents(): string[] {
    return ['PreToolUse', 'PostToolUse', 'Stop', 'PermissionRequest'];
  }

  buildHookCommand(event: string, portFile: string): string | null {
    if (event === 'PermissionRequest') {
      // Resolve the hook script relative to this file's runtime location.
      // dist path is backend/dist/adapters → repo root is ../../..
      const scriptPath = path.resolve(__dirname, '..', '..', '..', 'bin', 'ccweb-approval-hook.js');
      // Use process.execPath (node) to avoid shell PATH surprises.
      return `${process.execPath} ${scriptPath}  ${CCWEB_MARKER}`;
    }
    const baseBody = [
      `\\"event\\":\\"${event}\\"`,
      `\\"dir\\":\\"$CLAUDE_PROJECT_DIR\\"`,
    ];
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

  // ── Model & skills ──────────────────────────────────────────────────────
  getCurrentModel(): string | null {
    try {
      const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(raw);
      return settings.model || 'opus';
    } catch {
      return 'opus';
    }
  }

  getAvailableModels(): ToolModel[] {
    // Claude Code 2.1.x accepts these aliases (verified against `claude --help`
    // and `https://docs.claude.com/en/docs/claude-code/model-config`).  Users
    // wanting `opus[1m]` / `sonnet[1m]` or a full model ID (`claude-opus-4-7`)
    // can still type them directly in the input box — these five are just the
    // quick-pick list.
    return [
      { key: 'default',  label: 'Default (按订阅)' },
      { key: 'opus',     label: 'Opus' },
      { key: 'sonnet',   label: 'Sonnet' },
      { key: 'haiku',    label: 'Haiku' },
      { key: 'opusplan', label: 'Opus Plan (计划+执行)' },
    ];
  }

  getSkills(projectPath?: string): ToolSkillsData | null {
    const builtin: ToolSkillItem[] = [
      { command: '/help', description: 'Show available commands and usage' },
      { command: '/clear', description: 'Clear conversation history and free context' },
      { command: '/memory', description: 'Edit CLAUDE.md memory files' },
      { command: '/model', description: 'Switch AI model (sonnet/opus/haiku)' },
      { command: '/cost', description: 'Show token usage and cost for this session' },
      { command: '/status', description: 'Show account and system status' },
      { command: '/doctor', description: 'Check Claude Code installation health' },
      { command: '/review', description: 'Request code review' },
      { command: '/terminal', description: 'Run a bash command in the terminal' },
      { command: '/vim', description: 'Open file in vim-like editor mode' },
      { command: '/init', description: 'Initialize project CLAUDE.md' },
      { command: '/compact', description: 'Compact context to save tokens' },
      { command: '/resume', description: 'Resume a previous conversation' },
      { command: '/bug', description: 'Report a bug to Anthropic' },
      { command: '/release-notes', description: 'View recent release notes' },
      { command: '/pr_comments', description: 'View PR review comments' },
      { command: '/logout', description: 'Sign out of Claude account' },
      { command: '/login', description: 'Sign in to Claude account' },
    ];

    const custom: ToolSkillItem[] = [];
    const plugins: ToolSkillItem[] = [];
    const mcp: ToolSkillItem[] = [];
    const seenCommands = new Set<string>();

    const scanCommandsDir = (dir: string, prefix: string) => {
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (!file.endsWith('.md')) continue;
          const name = file.replace(/\.md$/, '');
          const cmd = `/${name}`;
          if (seenCommands.has(cmd)) continue;
          seenCommands.add(cmd);
          let desc = name;
          try {
            const content = fs.readFileSync(path.join(dir, file), 'utf-8');
            desc = content.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').trim() || name;
          } catch { /* fall back to name */ }
          custom.push({ command: cmd, description: `${prefix}${desc}` });
        }
      } catch { /* dir missing — normal */ }
    };

    const scanSkillsDir = (dir: string, prefix: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const ent of entries) {
          if (!ent.isDirectory()) continue;
          const skillFile = path.join(dir, ent.name, 'SKILL.md');
          if (!fs.existsSync(skillFile)) continue;
          const cmd = `/${ent.name}`;
          if (seenCommands.has(cmd)) continue;
          seenCommands.add(cmd);
          let desc = ent.name;
          try {
            const content = fs.readFileSync(skillFile, 'utf-8');
            // Prefer YAML frontmatter `description:` if present
            const fm = content.match(/^---\n([\s\S]*?)\n---/);
            if (fm) {
              const d = fm[1].split('\n').find((l) => /^description:/i.test(l));
              if (d) desc = d.replace(/^description:\s*/i, '').trim();
            } else {
              desc = content.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').trim() || ent.name;
            }
          } catch { /* fall back to name */ }
          custom.push({ command: cmd, description: `${prefix}${desc}` });
        }
      } catch { /* dir missing — normal */ }
    };

    // Project-level first (higher priority for dedup + user intuition)
    if (projectPath) {
      scanCommandsDir(path.join(projectPath, '.claude', 'commands'), '[项目] ');
      scanSkillsDir(path.join(projectPath, '.claude', 'skills'), '[项目] ');
    }
    scanCommandsDir(path.join(os.homedir(), '.claude', 'commands'), '');
    scanSkillsDir(path.join(os.homedir(), '.claude', 'skills'), '');

    // ── Plugins ───────────────────────────────────────────────────────
    // Claude Code installs plugins under `~/.claude/plugins/<name>/`.
    // Each plugin can have a `.claude-plugin/plugin.json` manifest
    // declaring `name` (namespace prefix) + `description`.  Commands
    // come from the plugin's own `skills/<skill>/SKILL.md` or
    // `commands/*.md` files, emitted as `/<plugin-name>:<command>`
    // per Claude Code's documented namespacing.
    const pluginsRoot = path.join(os.homedir(), '.claude', 'plugins');
    // Whitelist for plugin namespace chars; anything else falls back to the
    // filesystem directory name.  This prevents an adversarial plugin.json
    // from injecting newlines / spaces / separators into `/<ns>:<cmd>`.
    const NS_RE = /^[a-zA-Z0-9_.-]+$/;
    const seenPluginNs = new Set<string>();
    try {
      const entries = fs.readdirSync(pluginsRoot, { withFileTypes: true });
      for (const ent of entries) {
        // Skip symlinked plugin roots.  Plugin install flows use real directories;
        // a symlink here would let a plugin point at ~/.ssh etc. and cause the
        // scanner to enumerate its contents.
        if (!ent.isDirectory() || ent.isSymbolicLink()) continue;
        const pluginDir = path.join(pluginsRoot, ent.name);
        // Read manifest for the namespace name; fall back to dir name.
        let pluginName = ent.name;
        try {
          const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
          if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { name?: string };
            const raw = typeof manifest.name === 'string' ? manifest.name.trim() : '';
            if (raw && NS_RE.test(raw)) pluginName = raw;
          }
        } catch { /* malformed manifest → fall back to dir name */ }

        // Conflict detection: two plugins with the same namespace would silently
        // drop one's commands via `seenCommands`. Warn so the operator can
        // rename a fork rather than wonder why commands vanished.
        if (seenPluginNs.has(pluginName)) {
          log.warn({ pluginName, pluginDir: ent.name }, 'duplicate plugin namespace; second-fork commands dropped from slash panel');
        }
        seenPluginNs.add(pluginName);

        const pluginCmdSeen = new Set<string>();
        const addPluginItem = (shortName: string, desc: string) => {
          const full = `/${pluginName}:${shortName}`;
          if (seenCommands.has(full) || pluginCmdSeen.has(full)) return;
          pluginCmdSeen.add(full);
          seenCommands.add(full);
          plugins.push({ command: full, description: desc });
        };

        // Helper: safe non-symlink directory iteration.
        const safeDirentList = (dir: string): fs.Dirent[] => {
          try {
            return fs.readdirSync(dir, { withFileTypes: true })
              .filter((e) => !e.isSymbolicLink());
          } catch { return []; }
        };

        for (const skill of safeDirentList(path.join(pluginDir, 'skills'))) {
          if (!skill.isDirectory()) continue;
          const skillFile = path.join(pluginDir, 'skills', skill.name, 'SKILL.md');
          // lstat guards against the SKILL.md itself being a symlink to /etc
          let stat: fs.Stats | undefined;
          try { stat = fs.lstatSync(skillFile); } catch { continue; }
          if (stat.isSymbolicLink() || !stat.isFile()) continue;
          let desc = skill.name;
          try {
            const content = fs.readFileSync(skillFile, 'utf-8');
            const fm = content.match(/^---\n([\s\S]*?)\n---/);
            if (fm) {
              const d = fm[1].split('\n').find((l) => /^description:/i.test(l));
              if (d) desc = d.replace(/^description:\s*/i, '').trim();
            } else {
              desc = content.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').trim() || skill.name;
            }
          } catch { /* use skill name */ }
          addPluginItem(skill.name, desc);
        }
        for (const file of safeDirentList(path.join(pluginDir, 'commands'))) {
          if (!file.isFile() || !file.name.endsWith('.md')) continue;
          const name = file.name.replace(/\.md$/, '');
          let desc = name;
          try {
            const content = fs.readFileSync(path.join(pluginDir, 'commands', file.name), 'utf-8');
            desc = content.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').trim() || name;
          } catch { /* use name */ }
          addPluginItem(name, desc);
        }
      }
    } catch { /* no plugins root — normal if user has no plugins installed */ }

    try {
      const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (settings.mcpServers && typeof settings.mcpServers === 'object') {
        for (const name of Object.keys(settings.mcpServers as Record<string, unknown>)) {
          mcp.push({ command: name, description: 'MCP Server' });
        }
      }
    } catch { /* no settings */ }

    return { builtin, custom, plugins, mcp };
  }

  // ── Usage ──────────────────────────────────────────────────────────────
  async queryUsage(): Promise<UsageInfo> {
    return claudeQueryUsage();
  }

  clearUsageCache(): void {
    claudeClearUsageCache();
  }
}
