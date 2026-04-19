export type CliTool = 'claude' | 'opencode' | 'codex' | 'qwen' | 'gemini' | 'terminal';

export interface ProjectShare {
  username: string;
  permission: 'view' | 'edit';
}

export interface Project {
  id: string;
  name: string;
  folderPath: string;
  permissionMode: 'limited' | 'unlimited';
  cliTool: CliTool;
  createdAt: string;
  status: 'running' | 'stopped' | 'restarting';
  archived?: boolean;
  owner?: string; // username of the owner; undefined = legacy (visible to admin)
  shares?: ProjectShare[]; // shared users and their permissions
  tags?: string[]; // user-defined labels for filtering
}


export interface Config {
  username: string;
  passwordHash: string;
  jwtSecret: string;
}

/**
 * Agent Prompt — a saved prompt snippet that the user can "plug into" the
 * project's CLAUDE.md via a click, and "unplug" later by exact text match.
 * Stored per-user globally (~/.ccweb/agent-prompts[-user].json) or per-project
 * ({projectFolder}/.ccweb/agent-prompts.json).
 */
export interface AgentPrompt {
  id: string;
  label: string;
  command: string;
  createdAt: string;
}
