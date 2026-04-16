import { CliTool } from '../types';
import { CliToolAdapter } from './types';
import { ClaudeAdapter } from './claude-adapter';
import { OpencodeAdapter } from './opencode-adapter';
import { CodexAdapter } from './codex-adapter';
import { QwenAdapter } from './qwen-adapter';
import { GeminiAdapter } from './gemini-adapter';
import { TerminalAdapter } from './terminal-adapter';

const adapters: Record<CliTool, CliToolAdapter> = {
  claude: new ClaudeAdapter(),
  opencode: new OpencodeAdapter(),
  codex: new CodexAdapter(),
  qwen: new QwenAdapter(),
  gemini: new GeminiAdapter(),
  terminal: new TerminalAdapter(),
};

export function getAdapter(tool: CliTool): CliToolAdapter {
  return adapters[tool] ?? adapters.claude;
}

export type { CliToolAdapter, ToolModel, ToolSkillsData, ToolSkillItem, UsageInfo, UsageBucket } from './types';
