import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { CliToolAdapter, ToolModel, ToolSkillsData, UsageInfo } from './types';
import type { ChatBlock, ChatBlockItem } from '../session-manager';

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

function extractParts(parts: GeminiPart[] | { parts?: GeminiPart[] } | undefined): GeminiPart[] {
  if (!parts) return [];
  return Array.isArray(parts) ? parts : (parts.parts ?? []);
}

function extractPartsText(parts: GeminiPart[] | { parts?: GeminiPart[] } | undefined): string {
  return extractParts(parts)
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text!.trim())
    .join('\n')
    .trim();
}

function partsToBlocks(parts: GeminiPart[] | { parts?: GeminiPart[] } | undefined): ChatBlockItem[] {
  const arr = extractParts(parts);
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

/** Parse a Gemini session JSON string into an array of ChatBlocks (all messages). */
function parseGeminiSessionContent(content: string): ChatBlock[] {
  let session: GeminiSession;
  try { session = JSON.parse(content); } catch { return []; }
  if (!session.messages || !Array.isArray(session.messages)) return [];

  const blocks: ChatBlock[] = [];
  for (const msg of session.messages) {
    const ts = msg.timestamp ?? session.startTime ?? '';
    // Prefer displayContent over content if available
    const source = msg.displayContent ?? msg.content;
    if (msg.type === 'user') {
      const items = partsToBlocks(source);
      if (items.length > 0) blocks.push({ role: 'user', timestamp: ts, blocks: items });
    } else if (msg.type === 'gemini') {
      const items = partsToBlocks(source);
      if (items.length > 0) blocks.push({ role: 'assistant', timestamp: ts, blocks: items });
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
    // Always return the path (like Claude adapter) — callers check existence themselves
    return getChatsDir(folderPath);
  }

  getSessionFileExtension(): string {
    return '.json';
  }

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

  /** Parse the entire session JSON file into all ChatBlocks. */
  parseSessionFile(content: string): ChatBlock[] {
    return parseGeminiSessionContent(content);
  }

  parseLineBlocks(_line: string): ChatBlock | null {
    return null;
  }

  // ── Hooks ───────────────────────────────────────────────────────────────
  getHooksSettingsPath(): string | null {
    return path.join(GEMINI_HOME, 'settings.json');
  }

  getHookEvents(): string[] {
    return ['AfterAgent', 'SessionEnd'];
  }

  /**
   * Gemini CLI hooks receive JSON on stdin and write JSON to stdout.
   * We build a small shell pipeline: read stdin, extract fields with jq,
   * then curl the ccweb API. This avoids relying on env vars that may not exist.
   */
  buildHookCommand(event: string, portFile: string): string | null {
    // Gemini hooks pass input on stdin as JSON.
    // Use jq to extract project dir, then curl ccweb.
    return (
      `jq -r '{ event: "${event}", dir: (.cwd // .projectDir // ""), session: (.sessionId // "") }' | ` +
      `curl -sf -X POST "http://localhost:$(cat ${portFile})/api/hooks" ` +
      `-H "Content-Type: application/json" -d @- || true  ${CCWEB_MARKER}`
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
      { command: '/tools', description: 'List available tools' },
      { command: '/stats', description: 'Show session statistics' },
      { command: '/quit', description: 'Exit Gemini CLI' },
    ];

    return { builtin, custom: [], mcp: [] };
  }

  // ── Usage ──────────────────────────────────────────────────────────────
  async queryUsage(): Promise<UsageInfo> {
    return {};
  }

  clearUsageCache(): void {}
}
