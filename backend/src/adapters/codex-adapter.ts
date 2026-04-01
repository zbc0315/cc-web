import type { CliToolAdapter, ToolModel, ToolSkillsData, UsageInfo } from './types';
import type { SessionMessage, ChatBlock } from '../session-manager';

export class CodexAdapter implements CliToolAdapter {
  readonly tool = 'codex';

  buildCommand(permissionMode: 'limited' | 'unlimited', _continueSession: boolean): string {
    // Codex does not support --continue
    return permissionMode === 'unlimited'
      ? 'codex --ask-for-approval never --sandbox danger-full-access'
      : 'codex';
  }

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
