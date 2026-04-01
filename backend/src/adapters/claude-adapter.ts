import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { CliToolAdapter, ToolModel, ToolSkillsData, UsageInfo } from './types';
import type { SessionMessage, ChatBlock, ChatBlockItem } from '../session-manager';
import { queryUsage as claudeQueryUsage, clearUsageCache as claudeClearUsageCache } from '../usage-terminal';

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

  parseLine(line: string): SessionMessage | null {
    let record: ClaudeRecord;
    try { record = JSON.parse(line) as ClaudeRecord; } catch { return null; }

    if (record.type === 'user' && record.message?.role === 'user') {
      const text = extractText(record.message.content);
      if (!text || isInternalUserMessage(text)) return null;
      return { role: 'user', content: text, timestamp: record.timestamp ?? new Date().toISOString() };
    }

    if (record.type === 'assistant' && record.message?.role === 'assistant') {
      const text = extractText(record.message.content);
      if (!text || text.length < 5) return null;
      return { role: 'assistant', content: text, timestamp: record.timestamp ?? new Date().toISOString() };
    }

    return null;
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
          const input = b.input ? JSON.stringify(b.input).slice(0, 200) : '';
          blocks.push({ type: 'tool_use', content: `${name}(${input})` });
        } else if (b.type === 'tool_result') {
          const text = b.content ?? b.text;
          if (text?.trim()) blocks.push({ type: 'tool_result', content: typeof text === 'string' ? text.trim() : JSON.stringify(text).slice(0, 200) });
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
    return ['PreToolUse', 'PostToolUse', 'Stop'];
  }

  buildHookCommand(event: string, portFile: string): string | null {
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
    return [
      { key: 'sonnet', label: 'Sonnet' },
      { key: 'opus', label: 'Opus' },
      { key: 'haiku', label: 'Haiku' },
    ];
  }

  getSkills(): ToolSkillsData | null {
    const builtin = [
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
      { command: '/bug', description: 'Report a bug to Anthropic' },
      { command: '/release-notes', description: 'View recent release notes' },
      { command: '/pr_comments', description: 'View PR review comments' },
      { command: '/logout', description: 'Sign out of Claude account' },
      { command: '/login', description: 'Sign in to Claude account' },
    ];

    const custom: { command: string; description: string }[] = [];
    const mcp: { command: string; description: string }[] = [];

    try {
      const commandsDir = path.join(os.homedir(), '.claude', 'commands');
      const files = fs.readdirSync(commandsDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const name = file.replace(/\.md$/, '');
          const content = fs.readFileSync(path.join(commandsDir, file), 'utf-8');
          const firstLine = content.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').trim() || name;
          custom.push({ command: `/${name}`, description: firstLine });
        }
      }
    } catch { /* no commands dir */ }

    try {
      const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (settings.mcpServers && typeof settings.mcpServers === 'object') {
        for (const name of Object.keys(settings.mcpServers as Record<string, unknown>)) {
          mcp.push({ command: name, description: 'MCP Server' });
        }
      }
    } catch { /* no settings */ }

    return { builtin, custom, mcp };
  }

  // ── Usage ──────────────────────────────────────────────────────────────
  async queryUsage(): Promise<UsageInfo> {
    return claudeQueryUsage();
  }

  clearUsageCache(): void {
    claudeClearUsageCache();
  }
}
