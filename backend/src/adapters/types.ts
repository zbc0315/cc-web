import type { ChatBlock } from '../session-manager';

export interface UsageBucket {
  utilization?: number;
  resetAt?: string;
}

export interface UsageInfo {
  planName?: string;
  fiveHour?: UsageBucket;
  sevenDay?: UsageBucket;
  sevenDaySonnet?: UsageBucket;
  sevenDayOpus?: UsageBucket;
}

export interface ToolModel {
  key: string;   // e.g. 'opus', 'gpt-4.1'
  label: string; // e.g. 'Opus', 'GPT-4.1'
}

export interface ToolSkillItem {
  command: string;
  description: string;
}

export interface ToolSkillsData {
  builtin: ToolSkillItem[];
  custom: ToolSkillItem[];
  /** Commands discovered from installed Claude Code plugins. Each entry is
   *  prefixed with `/<plugin>:` to match Claude Code's namespacing. */
  plugins: ToolSkillItem[];
  mcp: ToolSkillItem[];
}

export interface CliToolAdapter {
  readonly tool: string;

  // ── Command building ──────────────────────────────────────────────
  buildCommand(permissionMode: 'limited' | 'unlimited', continueSession: boolean): string;
  supportsContinue(): boolean;

  // ── Session reading ───────────────────────────────────────────────
  /** Directory where this tool stores session logs for a project, or null if unsupported */
  getSessionDir(folderPath: string): string | null;
  /** Return all session files matching a project folder (for tools that don't store per-project) */
  getSessionFilesForProject?(folderPath: string): string[];
  /** File extension for session files: '.jsonl' (default) or '.json' for whole-file JSON tools */
  getSessionFileExtension?(): string;
  /** Parse a single JSONL line into a ChatBlock (for line-by-line tools) */
  parseLineBlocks(line: string): ChatBlock | null;
  /** Parse an entire session file into ChatBlocks (for whole-file JSON tools like Gemini) */
  parseSessionFile?(content: string): ChatBlock[];

  // ── Hooks ─────────────────────────────────────────────────────────
  /** Settings file path where hooks should be installed, or null if unsupported */
  getHooksSettingsPath(): string | null;
  getHookEvents(): string[];
  buildHookCommand(event: string, portFile: string): string | null;

  // ── Model & skills ────────────────────────────────────────────────
  getCurrentModel(): string | null;
  getAvailableModels(): ToolModel[];
  getSkills(projectPath?: string): ToolSkillsData | null;

  // ── Usage ────────────────────────────────────────────────────────
  queryUsage(): Promise<UsageInfo>;
  clearUsageCache(): void;

  // ── Project instructions file ─────────────────────────────────────
  /**
   * Filename (not path) this tool reads for project-level agent instructions.
   * Memory Prompts / Agent Prompts are inserted into `<projectDir>/<this>`.
   *
   *   claude  → 'CLAUDE.md'
   *   codex   → 'AGENTS.md'
   *   gemini/opencode/qwen → 'AGENTS.md' (industry convention)
   *   terminal → null  (no agent instructions semantic)
   */
  getProjectInstructionsFilename(): string | null;
}
