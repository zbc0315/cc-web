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
  owner?: string; // username of the owner; undefined = legacy (visible to admin)
  shares?: ProjectShare[]; // shared users and their permissions
  tags?: string[]; // user-defined labels for filtering
}


export interface Config {
  username: string;
  passwordHash: string;
  jwtSecret: string;
}
