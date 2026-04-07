export type CliTool = 'claude' | 'opencode' | 'codex' | 'qwen' | 'gemini';

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
  owner?: string;
  shares?: ProjectShare[];
  tags?: string[];
  _sharedPermission?: 'view' | 'edit'; // set by backend for shared projects
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}