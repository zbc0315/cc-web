export type CliTool = 'claude' | 'opencode' | 'codex' | 'qwen';
export type ProjectMode = 'terminal' | 'chat';

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
  mode?: ProjectMode; // undefined equals 'terminal'
}


export interface Config {
  username: string;
  passwordHash: string;
  jwtSecret: string;
}
