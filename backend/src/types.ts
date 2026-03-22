export type CliTool = 'claude' | 'opencode' | 'codex' | 'qwen';

export interface Project {
  id: string;
  name: string;
  folderPath: string;
  permissionMode: 'limited' | 'unlimited';
  cliTool: CliTool;
  createdAt: string;
  status: 'running' | 'stopped' | 'restarting';
}


export interface Config {
  username: string;
  passwordHash: string;
  jwtSecret: string;
}
