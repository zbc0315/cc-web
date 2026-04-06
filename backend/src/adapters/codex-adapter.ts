import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { CliToolAdapter, ToolModel, ToolSkillsData, UsageInfo } from './types';
import type { SessionMessage, ChatBlock, ChatBlockItem } from '../session-manager';

// Codex JSONL record types
interface CodexRecord {
  type: 'session_meta' | 'response_item' | 'event_msg' | 'turn_context' | string;
  timestamp?: string;
  payload?: {
    type?: string;
    role?: string;
    id?: string;
    cwd?: string;
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      arguments?: string;
      call_id?: string;
      output?: string;
    }>;
    [key: string]: unknown;
  };
}

const CODEX_HOME = path.join(os.homedir(), '.codex');
const SESSIONS_DIR = path.join(CODEX_HOME, 'sessions');

export class CodexAdapter implements CliToolAdapter {
  readonly tool = 'codex';

  buildCommand(permissionMode: 'limited' | 'unlimited', _continueSession: boolean): string {
    return permissionMode === 'unlimited'
      ? 'codex --ask-for-approval never --sandbox danger-full-access'
      : 'codex';
  }

  supportsContinue(): boolean { return false; }

  /**
   * Codex stores sessions in ~/.codex/sessions/{Y}/{M}/{D}/.
   * Unlike Claude, sessions are NOT per-project — we need to filter by cwd.
   * Return the sessions root; compensationSync will scan and filter by cwd.
   */
  getSessionDir(_folderPath: string): string | null {
    return fs.existsSync(SESSIONS_DIR) ? SESSIONS_DIR : null;
  }

  /**
   * Find all JSONL files for a given project folder (by matching cwd in session_meta).
   */
  getSessionFilesForProject(folderPath: string): string[] {
    if (!fs.existsSync(SESSIONS_DIR)) return [];
    const resolved = path.resolve(folderPath);
    const results: string[] = [];

    // Scan year/month/day directories
    try {
      for (const year of fs.readdirSync(SESSIONS_DIR)) {
        const yearDir = path.join(SESSIONS_DIR, year);
        if (!fs.statSync(yearDir).isDirectory()) continue;
        for (const month of fs.readdirSync(yearDir)) {
          const monthDir = path.join(yearDir, month);
          if (!fs.statSync(monthDir).isDirectory()) continue;
          for (const day of fs.readdirSync(monthDir)) {
            const dayDir = path.join(monthDir, day);
            if (!fs.statSync(dayDir).isDirectory()) continue;
            for (const file of fs.readdirSync(dayDir)) {
              if (!file.endsWith('.jsonl')) continue;
              const filePath = path.join(dayDir, file);
              try {
                const firstLine = fs.readFileSync(filePath, 'utf-8').split('\n')[0];
                const record: CodexRecord = JSON.parse(firstLine);
                if (record.type === 'session_meta') {
                  const cwd = path.resolve(record.payload?.cwd || '');
                  if (cwd === resolved || cwd.startsWith(resolved + path.sep)) {
                    results.push(filePath);
                  }
                }
              } catch { /* skip unreadable */ }
            }
          }
        }
      }
    } catch { /* dir not readable */ }
    return results;
  }

  parseLine(line: string): SessionMessage | null {
    let record: CodexRecord;
    try { record = JSON.parse(line); } catch { return null; }

    if (record.type !== 'response_item') return null;
    const payload = record.payload;
    if (!payload || !payload.role || !payload.content) return null;
    if (payload.role !== 'user' && payload.role !== 'assistant') return null;

    // Extract text
    const texts: string[] = [];
    for (const block of payload.content) {
      if (block.type === 'input_text' || block.type === 'output_text') {
        const text = block.text || '';
        // Skip system/environment context blocks
        if (text.startsWith('<environment_context>') || text.startsWith('<permissions') || text.startsWith('<skills_instructions>')) continue;
        if (text.trim()) texts.push(text.trim());
      }
    }
    if (texts.length === 0) return null;
    const content = texts.join('\n');
    if (content.length < 5 && payload.role === 'assistant') return null;

    return {
      role: payload.role as 'user' | 'assistant',
      content,
      timestamp: record.timestamp || '',
    };
  }

  parseLineBlocks(line: string): ChatBlock | null {
    let record: CodexRecord;
    try { record = JSON.parse(line); } catch { return null; }

    if (record.type !== 'response_item') return null;
    const payload = record.payload;
    if (!payload || !payload.role || !payload.content) return null;
    if (payload.role !== 'user' && payload.role !== 'assistant') return null;

    const blocks: ChatBlockItem[] = [];
    for (const block of payload.content) {
      if (block.type === 'input_text') {
        const text = block.text || '';
        if (text.startsWith('<environment_context>') || text.startsWith('<permissions') || text.startsWith('<skills_instructions>')) continue;
        if (text.trim()) blocks.push({ type: 'text', content: text.trim() });
      } else if (block.type === 'output_text') {
        const text = block.text || '';
        if (text.trim()) blocks.push({ type: 'text', content: text.trim() });
      } else if (block.type === 'function_call') {
        const name = block.name || 'unknown';
        const args = block.arguments || '';
        const truncArgs = args.length > 60 ? args.slice(0, 60) + '...' : args;
        blocks.push({ type: 'tool_use', content: `${name}(${truncArgs})` });
      } else if (block.type === 'function_call_output') {
        const output = block.output || '';
        const truncOutput = output.length > 100 ? output.slice(0, 100) + '...' : output;
        blocks.push({ type: 'tool_result', content: truncOutput });
      }
    }

    if (blocks.length === 0) return null;
    return {
      role: payload.role as 'user' | 'assistant',
      timestamp: record.timestamp || '',
      blocks,
    };
  }

  getHooksSettingsPath(): string | null { return null; }
  getHookEvents(): string[] { return []; }
  buildHookCommand(): string | null { return null; }

  getCurrentModel(): string | null { return null; }
  getAvailableModels(): ToolModel[] { return []; }
  getSkills(): ToolSkillsData | null { return null; }

  async queryUsage(): Promise<UsageInfo> { return {}; }
  clearUsageCache(): void {}
}
