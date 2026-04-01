import type { CliToolAdapter, ToolModel, ToolSkillsData, UsageInfo } from './types';
import type { SessionMessage, ChatBlock } from '../session-manager';

export class OpencodeAdapter implements CliToolAdapter {
  readonly tool = 'opencode';

  buildCommand(permissionMode: 'limited' | 'unlimited', _continueSession: boolean): string {
    // opencode does not support --continue or --dangerously-skip-permissions
    return permissionMode === 'unlimited' ? 'opencode --yolo' : 'opencode';
  }

  supportsContinue(): boolean { return false; }

  // OpenCode uses SQLite — session reading not yet supported
  getSessionDir(): string | null { return null; }
  parseLine(): SessionMessage | null { return null; }
  parseLineBlocks(): ChatBlock | null { return null; }

  // Hooks: not yet investigated for opencode
  getHooksSettingsPath(): string | null { return null; }
  getHookEvents(): string[] { return []; }
  buildHookCommand(): string | null { return null; }

  getCurrentModel(): string | null { return null; }
  getAvailableModels(): ToolModel[] { return []; }
  getSkills(): ToolSkillsData | null { return null; }

  async queryUsage(): Promise<UsageInfo> { return {}; }
  clearUsageCache(): void {}
}
