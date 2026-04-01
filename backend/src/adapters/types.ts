import type { ChatBlock, ChatBlockItem, SessionMessage } from '../session-manager';

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
  parseLine(line: string): SessionMessage | null;
  parseLineBlocks(line: string): ChatBlock | null;

  // ── Hooks ─────────────────────────────────────────────────────────
  /** Settings file path where hooks should be installed, or null if unsupported */
  getHooksSettingsPath(): string | null;
  getHookEvents(): string[];
  buildHookCommand(event: string, portFile: string): string | null;

  // ── Model & skills ────────────────────────────────────────────────
  getCurrentModel(): string | null;
  getAvailableModels(): ToolModel[];
  getSkills(): ToolSkillsData | null;

  // ── Usage ────────────────────────────────────────────────────────
  queryUsage(): Promise<UsageInfo>;
  clearUsageCache(): void;
}
