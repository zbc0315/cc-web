import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { CliToolAdapter, ToolModel, ToolSkillsData, UsageInfo } from './types';
import type { SessionMessage, ChatBlock, ChatBlockItem } from '../session-manager';

// ── Gemini CLI session types ────────────────────────────────────────────────

interface GeminiPart {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response?: unknown };
}

interface GeminiMessage {
  id?: string;
  type: 'user' | 'gemini' | 'info' | 'error' | 'warning';
  timestamp?: string;
  content?: GeminiPart[] | { parts?: GeminiPart[] };
  displayContent?: GeminiPart[] | { parts?: GeminiPart[] };
  toolCalls?: Array<{ name: string; args?: Record<string, unknown> }>;
  thoughts?: Array<{ text?: string; timestamp?: string }>;
  tokens?: { input?: number; output?: number; total?: number } | null;
  model?: string;
}

interface GeminiSession {
  sessionId: string;
  projectHash?: string;
  startTime?: string;
  lastUpdated?: string;
  messages?: GeminiMessage[];
  summary?: string;
  directories?: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const GEMINI_HOME = path.join(os.homedir(), '.gemini');
const CCWEB_MARKER = '# ccweb-hook';

/** Replicate Gemini CLI's project hash (SHA-256 of normalized path, first 16 hex chars) */
function getProjectHash(folderPath: string): string {
  const normalized = path.resolve(folderPath);
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function getChatsDir(folderPath: string): string {
  return path.join(GEMINI_HOME, 'tmp', getProjectHash(folderPath), 'chats');
}

function extractPartsText(parts: GeminiPart[] | { parts?: GeminiPart[] } | undefined): string {
  if (!parts) return '';
  const arr = Array.isArray(parts) ? parts : (parts.parts ?? []);
  return arr
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text!.trim())
    .join('\n')
    .trim();
}

function extractPartsBlocks(parts: GeminiPart[] | { parts?: GeminiPart[] } | undefined): ChatBlockItem[] {
  if (!parts) return [];
  const arr = Array.isArray(parts) ? parts : (parts.parts ?? []);
  const blocks: ChatBlockItem[] = [];
  for (const p of arr) {
    if (p.thought && p.text?.trim()) {
      blocks.push({ type: 'thinking', content: p.text.trim() });
    } else if (p.text?.trim()) {
      blocks.push({ type: 'text', content: p.text.trim() });
    } else if (p.functionCall) {
      const args = p.functionCall.args ? JSON.stringify(p.functionCall.args).slice(0, 200) : '';
      blocks.push({ type: 'tool_use', content: `${p.functionCall.name}(${args})` });
    } else if (p.functionResponse) {
      const out = p.functionResponse.response
        ? JSON.stringify(p.functionResponse.response).slice(0, 200)
        : '';
      blocks.push({ type: 'tool_result', content: out });
    }
  }
  return blocks;
}

// ── Adapter ─────────────────────────────────────────────────────────────────

export class GeminiAdapter implements CliToolAdapter {
  readonly tool = 'gemini';

  // ── Command ─────────────────────────────────────────────────────────────
  buildCommand(permissionMode: 'limited' | 'unlimited', continueSession: boolean): string {
    const cont = continueSession ? ' --resume' : '';
    return permissionMode === 'unlimited'
      ? `gemini --yolo${cont}`
      : `gemini${cont}`;
  }

  supportsContinue(): boolean {
    return true;
  }

  // ── Session ─────────────────────────────────────────────────────────────
  getSessionDir(folderPath: string): string | null {
    const dir = getChatsDir(folderPath);
    return fs.existsSync(dir) ? dir : null;
  }

  /**
   * Gemini stores sessions as JSON (not JSONL) in ~/.gemini/tmp/<hash>/chats/.
   * Return all session JSON files for the project.
   */
  getSessionFilesForProject(folderPath: string): string[] {
    const dir = getChatsDir(folderPath);
    if (!fs.existsSync(dir)) return [];
    try {
      return fs.readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => path.join(dir, f));
    } catch {
      return [];
    }
  }

  /**
   * Gemini sessions are JSON files, not JSONL.
   * parseLine is called per-line for JSONL; for Gemini we receive the whole file content.
   * We try to parse as the full session JSON and extract messages.
   * For compatibility with the JSONL scanning pipeline, each line won't parse individually,
   * so this returns null for individual lines. The information system uses getSessionFilesForProject.
   */
  parseLine(line: string): SessionMessage | null {
    // Try to parse as a complete Gemini session JSON
    let session: GeminiSession;
    try { session = JSON.parse(line); } catch { return null; }
    if (!session.messages || !Array.isArray(session.messages)) return null;

    // Return the first meaningful user or gemini message as a preview
    for (const msg of session.messages) {
      if (msg.type === 'user') {
        const text = extractPartsText(msg.content);
        if (text && text.length >= 3) {
          return { role: 'user', content: text, timestamp: msg.timestamp ?? session.startTime ?? '' };
        }
      }
      if (msg.type === 'gemini') {
        const text = extractPartsText(msg.content);
        if (text && text.length >= 5) {
          return { role: 'assistant', content: text, timestamp: msg.timestamp ?? '' };
        }
      }
    }
    return null;
  }

  parseLineBlocks(line: string): ChatBlock | null {
    // Same as parseLine — only works on full session JSON
    let session: GeminiSession;
    try { session = JSON.parse(line); } catch { return null; }
    if (!session.messages || !Array.isArray(session.messages)) return null;

    for (const msg of session.messages) {
      if (msg.type === 'user') {
        const blocks = extractPartsBlocks(msg.content);
        if (blocks.length > 0) {
          return { role: 'user', timestamp: msg.timestamp ?? session.startTime ?? '', blocks };
        }
      }
      if (msg.type === 'gemini') {
        const blocks = extractPartsBlocks(msg.content);
        if (blocks.length > 0) {
          return { role: 'assistant', timestamp: msg.timestamp ?? '', blocks };
        }
      }
    }
    return null;
  }

  // ── Hooks ───────────────────────────────────────────────────────────────
  getHooksSettingsPath(): string | null {
    return path.join(GEMINI_HOME, 'settings.json');
  }

  getHookEvents(): string[] {
    return ['AfterAgent', 'SessionEnd'];
  }

  buildHookCommand(event: string, portFile: string): string | null {
    const body = [
      `\\"event\\":\\"${event}\\"`,
      `\\"dir\\":\\"$GEMINI_PROJECT_DIR\\"`,
      `\\"session\\":\\"$GEMINI_SESSION_ID\\"`,
    ].join(',');
    return (
      `curl -sf -X POST "http://localhost:$(cat ${portFile})/api/hooks"` +
      ` -H "Content-Type: application/json"` +
      ` -d "{${body}}" || true  ${CCWEB_MARKER}`
    );
  }

  // ── Model & skills ──────────────────────────────────────────────────────
  getCurrentModel(): string | null {
    try {
      const settingsPath = path.join(GEMINI_HOME, 'settings.json');
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(raw);
      return settings.model || 'gemini-2.5-pro';
    } catch {
      return 'gemini-2.5-pro';
    }
  }

  getAvailableModels(): ToolModel[] {
    return [
      { key: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { key: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { key: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    ];
  }

  getSkills(): ToolSkillsData | null {
    const builtin = [
      { command: '/help', description: 'Show available commands and usage' },
      { command: '/chat', description: 'Start a new conversation' },
      { command: '/resume', description: 'Resume a previous session' },
      { command: '/restore', description: 'Restore a checkpoint' },
      { command: '/model', description: 'Switch AI model' },
      { command: '/settings', description: 'View or change settings' },
      { command: '/hooks', description: 'Manage hooks' },
      { command: '/compress', description: 'Compress context window' },
      { command: '/plan', description: 'Enter plan mode' },
      { command: '/tools', description: 'List available tools' },
      { command: '/stats', description: 'Show session statistics' },
      { command: '/quit', description: 'Exit Gemini CLI' },
    ];

    return { builtin, custom: [], mcp: [] };
  }

  // ── Usage ──────────────────────────────────────────────────────────────
  async queryUsage(): Promise<UsageInfo> {
    // Gemini CLI uses Google API credits / free tier — no standard usage endpoint
    return {};
  }

  clearUsageCache(): void {}
}
