import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { CliToolAdapter, ToolModel, ToolSkillsData, ToolSkillItem, UsageInfo } from './types';
import type { ChatBlock, ChatBlockItem } from '../session-manager';

// Codex JSONL record types
interface CodexRecord {
  type: 'session_meta' | 'response_item' | 'event_msg' | 'turn_context' | string;
  timestamp?: string;
  payload?: {
    type?: string;
    role?: string;
    id?: string;
    cwd?: string;
    // Codex may carry function_call / function_call_output as SIBLING fields
    // of payload (seen in real rollouts), not nested under content[].
    name?: string;
    arguments?: string;
    call_id?: string;
    output?: string;
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
const SKILLS_DIR = path.join(CODEX_HOME, 'skills');
const CONFIG_TOML = path.join(CODEX_HOME, 'config.toml');

/** Deep-cap string values inside a JSON-like value so a massive
 *  exec_command output doesn't balloon WS payloads. Mirrors claude-adapter. */
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

export class CodexAdapter implements CliToolAdapter {
  readonly tool = 'codex';

  buildCommand(permissionMode: 'limited' | 'unlimited', continueSession: boolean): string {
    // `codex resume --last` recovers the most recent session (equivalent to
    // Claude's --continue). Approval / sandbox flags accept positions after
    // the `resume` subcommand (verified against `codex resume --help` on 0.122).
    const base = continueSession ? 'codex resume --last' : 'codex';
    return permissionMode === 'unlimited'
      ? `${base} --ask-for-approval never --sandbox danger-full-access`
      : base;
  }

  supportsContinue(): boolean { return true; }

  /**
   * Codex stores sessions in ~/.codex/sessions/{Y}/{M}/{D}/.
   * Unlike Claude, sessions are NOT per-project — callers must scope via
   * `getSessionFilesForProject`, which matches by `cwd` from session_meta.
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


  parseLineBlocks(line: string): ChatBlock | null {
    let record: CodexRecord;
    try { record = JSON.parse(line); } catch { return null; }

    if (record.type !== 'response_item') return null;
    const payload = record.payload;
    if (!payload) return null;
    const ts = record.timestamp || '';

    // Codex real rollouts show two distinct response_item shapes:
    //
    // 1. payload.type = 'message' with role + content[{type: input_text|output_text, text}]
    // 2. payload.type = 'function_call' with name + arguments + call_id at payload top level
    //    (NOT nested inside content[] — prior versions of this adapter assumed nesting
    //     and produced zero tool_use blocks on real 0.12x sessions)
    // 3. payload.type = 'function_call_output' with output + call_id at payload top level

    // Shape (2) — tool call
    if (payload.type === 'function_call') {
      const name = (payload.name as string) || 'unknown';
      const argsRaw = (payload.arguments as string) || '';
      let parsedInput: unknown = undefined;
      try { parsedInput = argsRaw ? JSON.parse(argsRaw) : undefined; }
      catch { parsedInput = argsRaw; } // fall back to raw string if not valid JSON
      const cappedInput = capStrings(parsedInput, 4000);
      const jsonStr = cappedInput !== undefined ? JSON.stringify(cappedInput) : '';
      return {
        role: 'assistant',
        timestamp: ts,
        blocks: [{
          type: 'tool_use',
          // Legacy `name(args-truncated)` shape for backwards compat w/ older
          // frontend renderers that only read .content
          content: `${name}(${jsonStr.slice(0, 200)})`,
          tool: name,
          input: cappedInput,
        }],
      };
    }

    // Shape (3) — tool result. output is always string; simpler cap.
    if (payload.type === 'function_call_output') {
      const outputRaw = (payload.output as string) || '';
      const text = outputRaw.length > 4000
        ? outputRaw.slice(0, 4000) + `…[truncated ${outputRaw.length - 4000} chars]`
        : outputRaw;
      return {
        role: 'assistant',
        timestamp: ts,
        blocks: [{ type: 'tool_result', content: text }],
      };
    }

    // Shape (1) — plain message (user / assistant text)
    if (!payload.role || !payload.content) return null;
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
      }
    }

    if (blocks.length === 0) return null;
    return {
      role: payload.role as 'user' | 'assistant',
      timestamp: ts,
      blocks,
    };
  }

  getHooksSettingsPath(): string | null { return null; }
  getHookEvents(): string[] { return []; }
  buildHookCommand(): string | null { return null; }

  /**
   * Read the `model = "..."` line from ~/.codex/config.toml. config.toml is
   * TOML but we only need one scalar at the top level — simple regex avoids
   * pulling in a TOML parser dep.
   */
  getCurrentModel(): string | null {
    try {
      if (!fs.existsSync(CONFIG_TOML)) return null;
      const content = fs.readFileSync(CONFIG_TOML, 'utf-8');
      // Match top-level `model = "gpt-5.4"` — reject lines under [sections]
      // by taking only content up to the first `[` table header.
      // TOML allows both single and double quoted strings; accept either.
      const topLevel = content.split(/^\[/m)[0];
      const m = topLevel.match(/^\s*model\s*=\s*['"]([^'"]+)['"]/m);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  /** Codex 0.122's documented model families. Users can still override via
   *  `/model` slash or `-m` flag — this list just seeds the picker UI. */
  getAvailableModels(): ToolModel[] {
    return [
      { key: 'gpt-5.4',       label: 'GPT-5.4 (default)' },
      { key: 'gpt-5.3',       label: 'GPT-5.3' },
      { key: 'gpt-5.3-codex', label: 'GPT-5.3-codex' },
      { key: 'o3',            label: 'o3' },
    ];
  }

  /**
   * Codex Skills live at `~/.codex/skills/<name>/SKILL.md` (user-installed)
   * and `~/.codex/skills/.system/<name>/SKILL.md` (bundled). Each SKILL.md
   * starts with YAML-ish frontmatter containing `name` + `description`.
   *
   * We surface them as `builtin` (.system/) and `custom` (top-level).
   * Codex doesn't have the Claude-style `~/.codex/commands/*.md` user slash
   * commands — Skills are the closest analogue.
   */
  getSkills(): ToolSkillsData | null {
    if (!fs.existsSync(SKILLS_DIR)) return null;
    const scan = (dir: string): ToolSkillItem[] => {
      if (!fs.existsSync(dir)) return [];
      const out: ToolSkillItem[] = [];
      let entries: string[] = [];
      try { entries = fs.readdirSync(dir); } catch { return []; }
      for (const name of entries) {
        if (name.startsWith('.')) continue; // skip .system/ here; caller separates
        const skillMd = path.join(dir, name, 'SKILL.md');
        if (!fs.existsSync(skillMd)) continue;
        let description = '';
        try {
          const content = fs.readFileSync(skillMd, 'utf-8');
          // Frontmatter: `description: "..."` line. Quotes are optional in
          // YAML but codex's bundled skills wrap in double quotes — strip
          // matched leading/trailing ' or " so the UI doesn't show them.
          const m = content.match(/^description:\s*(.+)$/m);
          if (m) description = m[1].trim().replace(/^["']|["']$/g, '').slice(0, 200);
        } catch { /* best effort */ }
        out.push({ command: `/${name}`, description });
      }
      out.sort((a, b) => a.command.localeCompare(b.command));
      return out;
    };

    return {
      builtin: scan(path.join(SKILLS_DIR, '.system')),
      custom: scan(SKILLS_DIR),
      plugins: [],  // Codex plugins are managed separately via `codex marketplace`
      mcp: [],
    };
  }

  async queryUsage(): Promise<UsageInfo> { return {}; }
  getProjectInstructionsFilename(): string { return 'AGENTS.md'; }

  clearUsageCache(): void {}
}
