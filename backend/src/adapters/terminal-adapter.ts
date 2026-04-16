import type { CliToolAdapter, ToolModel, ToolSkillsData, UsageInfo } from './types';
import type { SessionMessage, ChatBlock } from '../session-manager';

/**
 * Terminal-only adapter — spawns a plain shell with no LLM CLI.
 * Used for SSH-like terminal access via the browser.
 */
export class TerminalAdapter implements CliToolAdapter {
  readonly tool = 'terminal';

  /** Return empty string — terminal-manager will detect this and spawn a bare shell */
  buildCommand(): string { return ''; }

  supportsContinue(): boolean { return false; }

  getSessionDir(): string | null { return null; }
  parseLine(): SessionMessage | null { return null; }
  parseLineBlocks(): ChatBlock | null { return null; }

  getHooksSettingsPath(): string | null { return null; }
  getHookEvents(): string[] { return []; }
  buildHookCommand(): string | null { return null; }

  getCurrentModel(): string | null { return null; }
  getAvailableModels(): ToolModel[] { return []; }
  getSkills(): ToolSkillsData | null { return null; }

  async queryUsage(): Promise<UsageInfo> { return {}; }
  clearUsageCache(): void {}
}
