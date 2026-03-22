// backend/src/backup/types.ts

export type ProviderType = 'google-drive' | 'onedrive' | 'dropbox';

export interface ProviderTokens {
  access_token: string;
  refresh_token: string;
  expiry: string; // ISO 8601
}

export interface ProviderConfig {
  id: string;
  type: ProviderType;
  label: string;
  clientId: string;
  clientSecret: string;
  tokens?: ProviderTokens;
}

export interface BackupSchedule {
  enabled: boolean;
  intervalMinutes: number;
}

export interface BackupConfig {
  providers: ProviderConfig[];
  schedule: BackupSchedule;
  excludePatterns: string[];
}

export interface RemoteFile {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedTime: string;
}

export interface FileSnapshot {
  mtime: number;
  size: number;
  hash: string; // sha256:xxx
}

export interface BackupState {
  lastBackupTime: string | null;
  files: Record<string, FileSnapshot>;
}

export interface BackupHistoryEntry {
  id: string;
  projectId: string;
  projectName: string;
  providerId: string;
  providerType: ProviderType;
  providerLabel: string;
  startTime: string;
  endTime: string;
  status: 'success' | 'failed' | 'partial';
  filesUploaded: number;
  filesDeleted: number;
  filesTotal: number;
  error?: string;
}

export interface CloudProvider {
  config: ProviderConfig;
  getAuthUrl(redirectUri: string): string;
  handleCallback(code: string, redirectUri: string): Promise<ProviderTokens>;
  refreshToken(): Promise<ProviderTokens>;
  isAuthorized(): boolean;
  ensureAuth(): Promise<void>;
  listFiles(remotePath: string): Promise<RemoteFile[]>;
  uploadFile(localPath: string, remotePath: string): Promise<void>;
  deleteFile(remotePath: string): Promise<void>;
  mkdir(remotePath: string): Promise<void>;
  downloadFile(remotePath: string, localPath: string): Promise<void>;
}
