import { CliTool } from '@/types';

export interface CliToolMeta {
  tool: CliTool;
  label: string;
  /** Whether the CLI's launch flag for resuming a previous session is wired up
   *  in the backend adapter. Mirrors `adapter.supportsContinue()` —
   *  must stay in sync with backend/src/adapters/*. */
  supportsContinue: boolean;
}

export const CLI_TOOLS: CliToolMeta[] = [
  { tool: 'claude',   label: 'Claude Code',  supportsContinue: true  },
  { tool: 'codex',    label: 'Codex',        supportsContinue: true  },
  { tool: 'gemini',   label: 'Gemini CLI',   supportsContinue: true  },
  { tool: 'opencode', label: 'OpenCode',     supportsContinue: false },
  { tool: 'qwen',     label: 'Qwen Code',    supportsContinue: false },
  { tool: 'terminal', label: 'Bare Shell',   supportsContinue: false },
];

export function cliToolLabel(tool: CliTool | undefined): string {
  return CLI_TOOLS.find((m) => m.tool === tool)?.label ?? String(tool ?? '');
}

export function cliToolSupportsContinue(tool: CliTool): boolean {
  return CLI_TOOLS.find((m) => m.tool === tool)?.supportsContinue ?? false;
}
