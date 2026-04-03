// backend/src/backup/config.ts

import * as fs from 'fs';
import * as path from 'path';
import { BackupConfig, BackupHistoryEntry, BackupState, ProviderType, BuiltInOAuth } from './types';

const DATA_DIR = process.env.CCWEB_DATA_DIR || path.join(__dirname, '../../../data');
const BACKUP_CONFIG_FILE = path.join(DATA_DIR, 'backup-config.json');
const BACKUP_HISTORY_FILE = path.join(DATA_DIR, 'backup-history.json');

function atomicWriteSync(filePath: string, data: string): void {
  const tmpPath = filePath + `.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, data, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

const DEFAULT_CONFIG: BackupConfig = {
  providers: [],
  schedule: { enabled: false, intervalMinutes: 60 },
  excludePatterns: ['node_modules', '.git', 'dist', 'build', '*.log', '.DS_Store', '*.tmp', '.venv', '__pycache__', '.env'],
};

export function getBackupConfig(): BackupConfig {
  if (!fs.existsSync(BACKUP_CONFIG_FILE)) {
    return {
      ...DEFAULT_CONFIG,
      providers: [],
      schedule: { ...DEFAULT_CONFIG.schedule },
      excludePatterns: [...DEFAULT_CONFIG.excludePatterns],
    };
  }
  try {
    return JSON.parse(fs.readFileSync(BACKUP_CONFIG_FILE, 'utf-8')) as BackupConfig;
  } catch {
    return {
      ...DEFAULT_CONFIG,
      providers: [],
      schedule: { ...DEFAULT_CONFIG.schedule },
      excludePatterns: [...DEFAULT_CONFIG.excludePatterns],
    };
  }
}

export function saveBackupConfig(config: BackupConfig): void {
  atomicWriteSync(BACKUP_CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getBackupHistory(): BackupHistoryEntry[] {
  if (!fs.existsSync(BACKUP_HISTORY_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(BACKUP_HISTORY_FILE, 'utf-8')) as BackupHistoryEntry[];
  } catch {
    return [];
  }
}

export function addBackupHistory(entry: BackupHistoryEntry): void {
  const history = getBackupHistory();
  history.unshift(entry);
  if (history.length > 100) history.length = 100;
  atomicWriteSync(BACKUP_HISTORY_FILE, JSON.stringify(history, null, 2));
}

export function getBuiltInOAuth(type: ProviderType): BuiltInOAuth | null {
  const config = getBackupConfig();
  return config.builtInOAuth?.[type] ?? null;
}

export function setBuiltInOAuth(type: ProviderType, oauth: BuiltInOAuth): void {
  const config = getBackupConfig();
  if (!config.builtInOAuth) config.builtInOAuth = {};
  config.builtInOAuth[type] = oauth;
  saveBackupConfig(config);
}

export function getBackupState(projectFolderPath: string): BackupState {
  const file = path.join(projectFolderPath, '.ccweb', 'backup-state.json');
  if (!fs.existsSync(file)) return { lastBackupTime: null, files: {} };
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as BackupState;
  } catch {
    return { lastBackupTime: null, files: {} };
  }
}

export function saveBackupState(projectFolderPath: string, state: BackupState): void {
  const dir = path.join(projectFolderPath, '.ccweb');
  fs.mkdirSync(dir, { recursive: true });
  atomicWriteSync(path.join(dir, 'backup-state.json'), JSON.stringify(state, null, 2));
}
