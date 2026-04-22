import type { CliToolAdapter, ToolModel, ToolSkillsData, UsageInfo } from './types';
import type { ChatBlock } from '../session-manager';

export class QwenAdapter implements CliToolAdapter {
  readonly tool = 'qwen';

  buildCommand(permissionMode: 'limited' | 'unlimited', _continueSession: boolean): string {
    // qwen-code does not support --continue
    return permissionMode === 'unlimited' ? 'qwen-code --yolo' : 'qwen-code';
  }

  supportsContinue(): boolean { return false; }

  getSessionDir(): string | null { return null; }
  parseLineBlocks(): ChatBlock | null { return null; }

  getHooksSettingsPath(): string | null { return null; }
  getHookEvents(): string[] { return []; }
  buildHookCommand(): string | null { return null; }

  getCurrentModel(): string | null { return null; }
  getAvailableModels(): ToolModel[] { return []; }
  getSkills(): ToolSkillsData | null { return null; }

  async queryUsage(): Promise<UsageInfo> { return {}; }
  clearUsageCache(): void {}

  getProjectInstructionsFilename(): string { return 'AGENTS.md'; }
}
