export interface Project {
  id: string;
  name: string;
  folderPath: string;
  permissionMode: 'limited' | 'unlimited';
  createdAt: string;
  status: 'running' | 'stopped' | 'restarting';
}


export interface Config {
  username: string;
  passwordHash: string;
  jwtSecret: string;
}
