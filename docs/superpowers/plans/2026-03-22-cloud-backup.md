# Cloud Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cloud backup support (Google Drive, OneDrive, Dropbox) with incremental sync, manual + scheduled triggers, and multi-provider parallel upload.

**Architecture:** Unified `CloudProvider` interface with per-provider implementations. `BackupEngine` handles incremental detection (mtime+hash) and parallel upload. Backend exposes REST API for config, trigger, and status. Frontend adds Settings page (cloud accounts, schedule, history) and per-project backup button.

**Tech Stack:** googleapis, @microsoft/microsoft-graph-client, @azure/msal-node, dropbox, Node.js crypto (sha256), Express routes, React + shadcn/ui

**Spec:** `docs/superpowers/specs/2026-03-22-cloud-backup-design.md`

---

## File Structure

### New files (backend)

| File | Responsibility |
|------|---------------|
| `backend/src/backup/types.ts` | CloudProvider interface, RemoteFile, config types, BackupStatus |
| `backend/src/backup/config.ts` | Read/write `~/.ccweb/backup-config.json` (atomic writes) |
| `backend/src/backup/providers/google-drive.ts` | Google Drive CloudProvider implementation |
| `backend/src/backup/providers/onedrive.ts` | OneDrive CloudProvider implementation |
| `backend/src/backup/providers/dropbox.ts` | Dropbox CloudProvider implementation |
| `backend/src/backup/providers/index.ts` | Factory: `createProvider(config) → CloudProvider` |
| `backend/src/backup/engine.ts` | BackupEngine — scan, diff, upload, state management |
| `backend/src/backup/scheduler.ts` | setInterval-based scheduled backup |
| `backend/src/routes/backup.ts` | REST API for backup operations |

### New files (frontend)

| File | Responsibility |
|------|---------------|
| `frontend/src/pages/SettingsPage.tsx` | Settings page with 3 tabs |
| `frontend/src/components/BackupProviderCard.tsx` | Cloud account card (status, actions) |
| `frontend/src/components/BackupHistoryTable.tsx` | Recent backup events table |
| `frontend/src/components/AddProviderDialog.tsx` | Dialog: select type, enter credentials, authorize |

### Modified files

| File | Change |
|------|--------|
| `backend/package.json` | Add googleapis, @microsoft/microsoft-graph-client, @azure/msal-node, dropbox |
| `backend/src/index.ts` | Mount backup routes, start scheduler |
| `frontend/src/App.tsx` | Add `/settings` route |
| `frontend/src/pages/DashboardPage.tsx` | Add Settings button in top bar |
| `frontend/src/pages/ProjectPage.tsx` | Add Backup button |
| `frontend/src/lib/api.ts` | Add backup API functions |

---

## Task 1: Backend types and config

**Files:**
- Create: `backend/src/backup/types.ts`
- Create: `backend/src/backup/config.ts`

- [ ] **Step 1: Create types.ts with all type definitions**

```typescript
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
  intervalMinutes: number; // 30, 60, 360, 720, 1440
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
  ensureAuth(): Promise<void>; // refresh if expired
  listFiles(remotePath: string): Promise<RemoteFile[]>;
  uploadFile(localPath: string, remotePath: string): Promise<void>;
  deleteFile(remotePath: string): Promise<void>;
  mkdir(remotePath: string): Promise<void>;
  downloadFile(remotePath: string, localPath: string): Promise<void>;
}
```

- [ ] **Step 2: Create config.ts for backup config persistence**

```typescript
// backend/src/backup/config.ts

import * as fs from 'fs';
import * as path from 'path';

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
  excludePatterns: ['node_modules', '.git', 'dist', 'build', '*.log', '.DS_Store', '*.tmp'],
};

export function getBackupConfig(): BackupConfig {
  if (!fs.existsSync(BACKUP_CONFIG_FILE)) return { ...DEFAULT_CONFIG, providers: [] };
  try {
    return JSON.parse(fs.readFileSync(BACKUP_CONFIG_FILE, 'utf-8')) as BackupConfig;
  } catch {
    return { ...DEFAULT_CONFIG, providers: [] };
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
  history.unshift(entry); // newest first
  // Keep only last 100 entries
  if (history.length > 100) history.length = 100;
  atomicWriteSync(BACKUP_HISTORY_FILE, JSON.stringify(history, null, 2));
}

// Per-project backup state: .ccweb/backup-state.json
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
```

Import `BackupConfig`, `BackupHistoryEntry`, `BackupState` from `./types` at the top.

- [ ] **Step 3: Commit**

```bash
git add backend/src/backup/types.ts backend/src/backup/config.ts
git commit -m "feat(backup): add types and config persistence"
```

---

## Task 2: Google Drive provider

**Files:**
- Create: `backend/src/backup/providers/google-drive.ts`

- [ ] **Step 1: Install googleapis dependency**

```bash
cd backend && npm install googleapis
```

- [ ] **Step 2: Implement GoogleDriveProvider**

```typescript
// backend/src/backup/providers/google-drive.ts

import { google, drive_v3 } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import { CloudProvider, ProviderConfig, ProviderTokens, RemoteFile } from '../types';

export class GoogleDriveProvider implements CloudProvider {
  config: ProviderConfig;
  private oauth2Client;
  private drive: drive_v3.Drive;
  // Cache folder IDs to avoid repeated lookups
  private folderIdCache = new Map<string, string>();

  constructor(config: ProviderConfig) {
    this.config = config;
    this.oauth2Client = new google.auth.OAuth2(config.clientId, config.clientSecret);
    if (config.tokens) {
      this.oauth2Client.setCredentials({
        access_token: config.tokens.access_token,
        refresh_token: config.tokens.refresh_token,
        expiry_date: new Date(config.tokens.expiry).getTime(),
      });
    }
    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
  }

  getAuthUrl(redirectUri: string): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/drive.file'],
      redirect_uri: redirectUri,
      state: this.config.id,
    });
  }

  async handleCallback(code: string, redirectUri: string): Promise<ProviderTokens> {
    this.oauth2Client = new google.auth.OAuth2(this.config.clientId, this.config.clientSecret, redirectUri);
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
    const result: ProviderTokens = {
      access_token: tokens.access_token!,
      refresh_token: tokens.refresh_token!,
      expiry: new Date(tokens.expiry_date!).toISOString(),
    };
    this.config.tokens = result;
    return result;
  }

  async refreshToken(): Promise<ProviderTokens> {
    const { credentials } = await this.oauth2Client.refreshAccessToken();
    this.oauth2Client.setCredentials(credentials);
    const result: ProviderTokens = {
      access_token: credentials.access_token!,
      refresh_token: credentials.refresh_token || this.config.tokens!.refresh_token,
      expiry: new Date(credentials.expiry_date!).toISOString(),
    };
    this.config.tokens = result;
    return result;
  }

  isAuthorized(): boolean {
    return !!this.config.tokens?.refresh_token;
  }

  async ensureAuth(): Promise<void> {
    if (!this.config.tokens) throw new Error('Not authorized');
    const expiry = new Date(this.config.tokens.expiry).getTime();
    if (Date.now() > expiry - 60000) { // refresh 1 min before expiry
      await this.refreshToken();
    }
  }

  // Get or create a folder by path (e.g. ".ccweb-backup/my-project")
  // Returns the Google Drive folder ID
  private async getOrCreateFolder(folderPath: string): Promise<string> {
    if (this.folderIdCache.has(folderPath)) return this.folderIdCache.get(folderPath)!;

    const parts = folderPath.split('/').filter(Boolean);
    let parentId = 'root';

    for (const part of parts) {
      const cacheKey = parentId + '/' + part;
      if (this.folderIdCache.has(cacheKey)) {
        parentId = this.folderIdCache.get(cacheKey)!;
        continue;
      }

      // Search for existing folder
      const res = await this.drive.files.list({
        q: `name='${part}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id)',
      });

      if (res.data.files && res.data.files.length > 0) {
        parentId = res.data.files[0].id!;
      } else {
        // Create folder
        const created = await this.drive.files.create({
          requestBody: {
            name: part,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId],
          },
          fields: 'id',
        });
        parentId = created.data.id!;
      }
      this.folderIdCache.set(cacheKey, parentId);
    }

    this.folderIdCache.set(folderPath, parentId);
    return parentId;
  }

  // Find a file ID by path
  private async findFileId(remotePath: string): Promise<string | null> {
    const dir = path.dirname(remotePath);
    const name = path.basename(remotePath);
    const parentId = await this.getOrCreateFolder(dir === '.' ? '' : dir);

    const res = await this.drive.files.list({
      q: `name='${name}' and '${parentId}' in parents and trashed=false`,
      fields: 'files(id)',
    });
    return res.data.files?.[0]?.id || null;
  }

  async listFiles(remotePath: string): Promise<RemoteFile[]> {
    await this.ensureAuth();
    const folderId = await this.getOrCreateFolder(remotePath);
    const result: RemoteFile[] = [];
    let pageToken: string | undefined;

    do {
      const res = await this.drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime)',
        pageToken,
      });
      for (const f of res.data.files || []) {
        result.push({
          name: f.name!,
          path: remotePath + '/' + f.name!,
          isDirectory: f.mimeType === 'application/vnd.google-apps.folder',
          size: parseInt(f.size || '0', 10),
          modifiedTime: f.modifiedTime || '',
        });
      }
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);

    return result;
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    await this.ensureAuth();
    const dir = path.dirname(remotePath);
    const name = path.basename(remotePath);
    const parentId = await this.getOrCreateFolder(dir === '.' ? '' : dir);

    // Check if file already exists (update vs create)
    const existingId = await this.findFileId(remotePath);

    if (existingId) {
      await this.drive.files.update({
        fileId: existingId,
        media: { body: fs.createReadStream(localPath) },
      });
    } else {
      await this.drive.files.create({
        requestBody: { name, parents: [parentId] },
        media: { body: fs.createReadStream(localPath) },
      });
    }
  }

  async deleteFile(remotePath: string): Promise<void> {
    await this.ensureAuth();
    const fileId = await this.findFileId(remotePath);
    if (fileId) {
      await this.drive.files.delete({ fileId });
    }
  }

  async mkdir(remotePath: string): Promise<void> {
    await this.ensureAuth();
    await this.getOrCreateFolder(remotePath);
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    await this.ensureAuth();
    const fileId = await this.findFileId(remotePath);
    if (!fileId) throw new Error(`File not found: ${remotePath}`);

    const res = await this.drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );
    const dest = fs.createWriteStream(localPath);
    await new Promise<void>((resolve, reject) => {
      (res.data as NodeJS.ReadableStream).pipe(dest);
      dest.on('finish', resolve);
      dest.on('error', reject);
    });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/backup/providers/google-drive.ts backend/package.json backend/package-lock.json
git commit -m "feat(backup): add Google Drive provider"
```

---

## Task 3: OneDrive provider

**Files:**
- Create: `backend/src/backup/providers/onedrive.ts`

- [ ] **Step 1: Install OneDrive dependencies**

```bash
cd backend && npm install @microsoft/microsoft-graph-client @azure/msal-node isomorphic-fetch
```

Note: `@microsoft/microsoft-graph-client` requires a fetch polyfill in Node.js — `isomorphic-fetch` or use native fetch if Node >= 18.

- [ ] **Step 2: Implement OneDriveProvider**

```typescript
// backend/src/backup/providers/onedrive.ts

import { ConfidentialClientApplication } from '@azure/msal-node';
import { Client } from '@microsoft/microsoft-graph-client';
import * as fs from 'fs';
import * as path from 'path';
import { CloudProvider, ProviderConfig, ProviderTokens, RemoteFile } from '../types';

export class OneDriveProvider implements CloudProvider {
  config: ProviderConfig;
  private msalApp: ConfidentialClientApplication;
  private graphClient: Client | null = null;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.msalApp = new ConfidentialClientApplication({
      auth: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        authority: 'https://login.microsoftonline.com/consumers',
      },
    });
    if (config.tokens) {
      this.initGraphClient(config.tokens.access_token);
    }
  }

  private initGraphClient(accessToken: string): void {
    this.graphClient = Client.init({
      authProvider: (done) => done(null, accessToken),
    });
  }

  getAuthUrl(redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'Files.ReadWrite offline_access',
      state: this.config.id,
    });
    return `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?${params}`;
  }

  async handleCallback(code: string, redirectUri: string): Promise<ProviderTokens> {
    const tokenRes = await this.msalApp.acquireTokenByCode({
      code,
      scopes: ['Files.ReadWrite', 'offline_access'],
      redirectUri,
    });
    // MSAL caches tokens internally; we also store them
    // For refresh token, we need to use the raw HTTP endpoint since MSAL handles it internally
    // Use raw fetch for the token endpoint to get refresh_token
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: 'Files.ReadWrite offline_access',
    });
    const res = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
    const tokens: ProviderTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };
    this.config.tokens = tokens;
    this.initGraphClient(tokens.access_token);
    return tokens;
  }

  async refreshToken(): Promise<ProviderTokens> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: this.config.tokens!.refresh_token,
      grant_type: 'refresh_token',
      scope: 'Files.ReadWrite offline_access',
    });
    const res = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
    const tokens: ProviderTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || this.config.tokens!.refresh_token,
      expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };
    this.config.tokens = tokens;
    this.initGraphClient(tokens.access_token);
    return tokens;
  }

  isAuthorized(): boolean {
    return !!this.config.tokens?.refresh_token;
  }

  async ensureAuth(): Promise<void> {
    if (!this.config.tokens) throw new Error('Not authorized');
    const expiry = new Date(this.config.tokens.expiry).getTime();
    if (Date.now() > expiry - 60000) {
      await this.refreshToken();
    }
  }

  private get client(): Client {
    if (!this.graphClient) throw new Error('Not authorized');
    return this.graphClient;
  }

  // OneDrive paths use :/path/to/file: syntax
  private encodePath(remotePath: string): string {
    return `/me/drive/root:/${remotePath}:`;
  }

  async listFiles(remotePath: string): Promise<RemoteFile[]> {
    await this.ensureAuth();
    const result: RemoteFile[] = [];
    let url = `${this.encodePath(remotePath)}/children`;

    const res = await this.client.api(url).get();
    for (const item of res.value || []) {
      result.push({
        name: item.name,
        path: remotePath + '/' + item.name,
        isDirectory: !!item.folder,
        size: item.size || 0,
        modifiedTime: item.lastModifiedDateTime || '',
      });
    }
    return result;
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    await this.ensureAuth();
    const content = fs.readFileSync(localPath);
    // For files < 4MB, use simple upload; larger files need upload session
    if (content.length < 4 * 1024 * 1024) {
      await this.client.api(`${this.encodePath(remotePath)}/content`).put(content);
    } else {
      // Create upload session for large files
      const session = await this.client.api(`${this.encodePath(remotePath)}/createUploadSession`).post({});
      const uploadUrl = session.uploadUrl;
      const chunkSize = 10 * 1024 * 1024; // 10MB chunks
      for (let i = 0; i < content.length; i += chunkSize) {
        const end = Math.min(i + chunkSize, content.length);
        const chunk = content.subarray(i, end);
        await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Range': `bytes ${i}-${end - 1}/${content.length}`,
            'Content-Length': String(chunk.length),
          },
          body: chunk,
        });
      }
    }
  }

  async deleteFile(remotePath: string): Promise<void> {
    await this.ensureAuth();
    try {
      await this.client.api(this.encodePath(remotePath)).delete();
    } catch (err: any) {
      if (err.statusCode !== 404) throw err;
    }
  }

  async mkdir(remotePath: string): Promise<void> {
    await this.ensureAuth();
    const parts = remotePath.split('/').filter(Boolean);
    let currentPath = '';
    for (const part of parts) {
      const parentPath = currentPath ? this.encodePath(currentPath) : '/me/drive/root';
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      try {
        await this.client.api(`${parentPath}/children`).post({
          name: part,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail',
        });
      } catch (err: any) {
        if (err.statusCode !== 409) throw err; // 409 = already exists, ok
      }
    }
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    await this.ensureAuth();
    const stream = await this.client.api(`${this.encodePath(remotePath)}/content`).getStream();
    const dest = fs.createWriteStream(localPath);
    await new Promise<void>((resolve, reject) => {
      stream.pipe(dest);
      dest.on('finish', resolve);
      dest.on('error', reject);
    });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/backup/providers/onedrive.ts backend/package.json backend/package-lock.json
git commit -m "feat(backup): add OneDrive provider"
```

---

## Task 4: Dropbox provider

**Files:**
- Create: `backend/src/backup/providers/dropbox.ts`

- [ ] **Step 1: Install dropbox dependency**

```bash
cd backend && npm install dropbox
```

- [ ] **Step 2: Implement DropboxProvider**

```typescript
// backend/src/backup/providers/dropbox.ts

import { Dropbox, DropboxAuth } from 'dropbox';
import * as fs from 'fs';
import { CloudProvider, ProviderConfig, ProviderTokens, RemoteFile } from '../types';

export class DropboxProvider implements CloudProvider {
  config: ProviderConfig;
  private dbxAuth: DropboxAuth;
  private dbx: Dropbox;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.dbxAuth = new DropboxAuth({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });
    if (config.tokens) {
      this.dbxAuth.setAccessToken(config.tokens.access_token);
      this.dbxAuth.setRefreshToken(config.tokens.refresh_token);
      this.dbxAuth.setAccessTokenExpiresAt(new Date(config.tokens.expiry));
    }
    this.dbx = new Dropbox({ auth: this.dbxAuth });
  }

  getAuthUrl(redirectUri: string): string {
    // Dropbox SDK's getAuthenticationUrl is async in v10+
    // Build URL manually for simplicity
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      state: this.config.id,
      token_access_type: 'offline',
    });
    return `https://www.dropbox.com/oauth2/authorize?${params}`;
  }

  async handleCallback(code: string, redirectUri: string): Promise<ProviderTokens> {
    // Exchange code for tokens via Dropbox OAuth2 token endpoint
    const body = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
    const tokens: ProviderTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };
    this.config.tokens = tokens;
    this.dbxAuth.setAccessToken(tokens.access_token);
    this.dbxAuth.setRefreshToken(tokens.refresh_token);
    this.dbx = new Dropbox({ auth: this.dbxAuth });
    return tokens;
  }

  async refreshToken(): Promise<ProviderTokens> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.config.tokens!.refresh_token,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json() as { access_token: string; expires_in: number };
    const tokens: ProviderTokens = {
      access_token: data.access_token,
      refresh_token: this.config.tokens!.refresh_token,
      expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };
    this.config.tokens = tokens;
    this.dbxAuth.setAccessToken(tokens.access_token);
    this.dbx = new Dropbox({ auth: this.dbxAuth });
    return tokens;
  }

  isAuthorized(): boolean {
    return !!this.config.tokens?.refresh_token;
  }

  async ensureAuth(): Promise<void> {
    if (!this.config.tokens) throw new Error('Not authorized');
    const expiry = new Date(this.config.tokens.expiry).getTime();
    if (Date.now() > expiry - 60000) {
      await this.refreshToken();
    }
  }

  // Dropbox paths must start with / or be empty string for root
  private normPath(remotePath: string): string {
    const p = '/' + remotePath.replace(/^\/+/, '');
    return p === '/' ? '' : p;
  }

  async listFiles(remotePath: string): Promise<RemoteFile[]> {
    await this.ensureAuth();
    const result: RemoteFile[] = [];
    let res = await this.dbx.filesListFolder({ path: this.normPath(remotePath) });

    for (const entry of res.result.entries) {
      result.push({
        name: entry.name,
        path: remotePath + '/' + entry.name,
        isDirectory: entry['.tag'] === 'folder',
        size: entry['.tag'] === 'file' ? (entry as any).size : 0,
        modifiedTime: entry['.tag'] === 'file' ? (entry as any).server_modified : '',
      });
    }

    while (res.result.has_more) {
      res = await this.dbx.filesListFolderContinue({ cursor: res.result.cursor });
      for (const entry of res.result.entries) {
        result.push({
          name: entry.name,
          path: remotePath + '/' + entry.name,
          isDirectory: entry['.tag'] === 'folder',
          size: entry['.tag'] === 'file' ? (entry as any).size : 0,
          modifiedTime: entry['.tag'] === 'file' ? (entry as any).server_modified : '',
        });
      }
    }

    return result;
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    await this.ensureAuth();
    const content = fs.readFileSync(localPath);

    if (content.length < 150 * 1024 * 1024) { // < 150MB: simple upload
      await this.dbx.filesUpload({
        path: this.normPath(remotePath),
        contents: content,
        mode: { '.tag': 'overwrite' },
      });
    } else {
      // Large file: use upload session
      const session = await this.dbx.filesUploadSessionStart({
        close: false,
        contents: Buffer.alloc(0),
      });
      const sessionId = session.result.session_id;
      const chunkSize = 8 * 1024 * 1024;
      let offset = 0;

      while (offset < content.length) {
        const end = Math.min(offset + chunkSize, content.length);
        const chunk = content.subarray(offset, end);
        const isLast = end === content.length;

        if (isLast) {
          await this.dbx.filesUploadSessionFinish({
            cursor: { session_id: sessionId, offset },
            commit: { path: this.normPath(remotePath), mode: { '.tag': 'overwrite' } },
            contents: chunk,
          });
        } else {
          await this.dbx.filesUploadSessionAppendV2({
            cursor: { session_id: sessionId, offset },
            close: false,
            contents: chunk,
          });
        }
        offset = end;
      }
    }
  }

  async deleteFile(remotePath: string): Promise<void> {
    await this.ensureAuth();
    try {
      await this.dbx.filesDeleteV2({ path: this.normPath(remotePath) });
    } catch (err: any) {
      if (err?.error?.error?.['.tag'] !== 'path_lookup') throw err;
    }
  }

  async mkdir(remotePath: string): Promise<void> {
    await this.ensureAuth();
    try {
      await this.dbx.filesCreateFolderV2({ path: this.normPath(remotePath) });
    } catch (err: any) {
      // Ignore "folder already exists"
      if (err?.error?.error?.['.tag'] !== 'path' ||
          err?.error?.error?.path?.['.tag'] !== 'conflict') throw err;
    }
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    await this.ensureAuth();
    const res = await this.dbx.filesDownload({ path: this.normPath(remotePath) });
    const buffer = (res.result as any).fileBinary;
    fs.writeFileSync(localPath, buffer);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/backup/providers/dropbox.ts backend/package.json backend/package-lock.json
git commit -m "feat(backup): add Dropbox provider"
```

---

## Task 5: Provider factory

**Files:**
- Create: `backend/src/backup/providers/index.ts`

- [ ] **Step 1: Create provider factory**

```typescript
// backend/src/backup/providers/index.ts

import { CloudProvider, ProviderConfig } from '../types';
import { GoogleDriveProvider } from './google-drive';
import { OneDriveProvider } from './onedrive';
import { DropboxProvider } from './dropbox';

export function createProvider(config: ProviderConfig): CloudProvider {
  switch (config.type) {
    case 'google-drive':
      return new GoogleDriveProvider(config);
    case 'onedrive':
      return new OneDriveProvider(config);
    case 'dropbox':
      return new DropboxProvider(config);
    default:
      throw new Error(`Unknown provider type: ${(config as any).type}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/backup/providers/index.ts
git commit -m "feat(backup): add provider factory"
```

---

## Task 6: Backup engine

**Files:**
- Create: `backend/src/backup/engine.ts`

- [ ] **Step 1: Implement BackupEngine**

The engine handles:
- Scanning project directory (respecting exclude patterns)
- Computing file hashes for change detection
- Uploading changed files to all providers in parallel
- Deleting orphaned remote files
- Updating backup state

```typescript
// backend/src/backup/engine.ts

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { minimatch } from 'minimatch';
import { v4 as uuidv4 } from 'uuid';
import {
  CloudProvider, BackupState, FileSnapshot,
  BackupHistoryEntry, ProviderConfig,
} from './types';
import {
  getBackupConfig, getBackupState, saveBackupState,
  saveBackupConfig, addBackupHistory,
} from './config';
import { createProvider } from './providers';
import { getProjects } from '../config';

function computeHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return 'sha256:' + crypto.createHash('sha256').update(content).digest('hex');
}

function shouldExclude(relativePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    // Match against each path segment and the full path
    const segments = relativePath.split('/');
    return segments.some((seg) => minimatch(seg, pattern)) || minimatch(relativePath, pattern);
  });
}

function scanDirectory(
  dirPath: string,
  excludePatterns: string[],
  basePath: string = dirPath
): Map<string, { mtime: number; size: number }> {
  const files = new Map<string, { mtime: number; size: number }>();

  function walk(currentPath: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const relativePath = path.relative(basePath, fullPath);

      if (shouldExclude(relativePath, excludePatterns)) continue;

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        files.set(relativePath, { mtime: stat.mtimeMs, size: stat.size });
      }
    }
  }

  walk(dirPath);
  return files;
}

export interface BackupProgress {
  projectId: string;
  projectName: string;
  providerId: string;
  providerLabel: string;
  status: 'scanning' | 'uploading' | 'deleting' | 'done' | 'error';
  filesUploaded: number;
  filesDeleted: number;
  filesTotal: number;
  error?: string;
}

export type ProgressCallback = (progress: BackupProgress) => void;

export async function runBackup(
  projectId: string,
  onProgress?: ProgressCallback
): Promise<BackupHistoryEntry[]> {
  const config = getBackupConfig();
  const authorizedProviders = config.providers.filter((p) => p.tokens);
  if (authorizedProviders.length === 0) {
    throw new Error('No authorized cloud providers configured');
  }

  const project = getProjects().find((p) => p.id === projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const folderPath = project.folderPath;
  if (!fs.existsSync(folderPath)) throw new Error(`Project folder not found: ${folderPath}`);

  // 1. Scan local files
  const localFiles = scanDirectory(folderPath, config.excludePatterns);
  const prevState = getBackupState(folderPath);

  // 2. Detect changes
  const toUpload: string[] = [];
  const newSnapshots: Record<string, FileSnapshot> = {};

  for (const [relPath, { mtime, size }] of localFiles) {
    const prev = prevState.files[relPath];
    if (prev && prev.mtime === mtime && prev.size === size) {
      // Unchanged — keep previous snapshot
      newSnapshots[relPath] = prev;
    } else {
      // Changed or new — compute hash
      const fullPath = path.join(folderPath, relPath);
      const hash = computeHash(fullPath);
      if (prev && prev.hash === hash) {
        // mtime changed but content identical — just update mtime
        newSnapshots[relPath] = { mtime, size, hash };
      } else {
        toUpload.push(relPath);
        newSnapshots[relPath] = { mtime, size, hash };
      }
    }
  }

  // 3. Detect deletions (files in previous state but not in current scan)
  const toDelete: string[] = [];
  for (const relPath of Object.keys(prevState.files)) {
    if (!localFiles.has(relPath)) {
      toDelete.push(relPath);
    }
  }

  const totalFiles = toUpload.length + toDelete.length;

  // 4. Upload to all providers in parallel
  const results: BackupHistoryEntry[] = [];

  await Promise.all(
    authorizedProviders.map(async (providerConfig) => {
      const provider = createProvider(providerConfig);
      const remotBase = `.ccweb-backup/${project.name}`;
      const startTime = new Date().toISOString();
      let filesUploaded = 0;
      let filesDeleted = 0;
      let status: 'success' | 'failed' | 'partial' = 'success';
      let error: string | undefined;

      try {
        // Ensure base directory exists
        await provider.mkdir(remotBase);

        // Upload changed files
        for (const relPath of toUpload) {
          try {
            const localPath = path.join(folderPath, relPath);
            const remotePath = `${remotBase}/${relPath}`;
            // Ensure parent directory exists
            const remoteDir = path.dirname(remotePath);
            await provider.mkdir(remoteDir);
            await provider.uploadFile(localPath, remotePath);
            filesUploaded++;
            onProgress?.({
              projectId, projectName: project.name,
              providerId: providerConfig.id, providerLabel: providerConfig.label,
              status: 'uploading', filesUploaded, filesDeleted, filesTotal: totalFiles,
            });
          } catch (err) {
            console.error(`[Backup] Upload failed for ${relPath} to ${providerConfig.label}:`, err);
            status = 'partial';
          }
        }

        // Delete orphaned remote files
        for (const relPath of toDelete) {
          try {
            await provider.deleteFile(`${remotBase}/${relPath}`);
            filesDeleted++;
          } catch (err) {
            console.error(`[Backup] Delete failed for ${relPath} on ${providerConfig.label}:`, err);
            status = 'partial';
          }
        }

        // Save updated tokens if they were refreshed
        if (provider.config.tokens !== providerConfig.tokens) {
          const cfg = getBackupConfig();
          const idx = cfg.providers.findIndex((p) => p.id === providerConfig.id);
          if (idx >= 0) {
            cfg.providers[idx].tokens = provider.config.tokens;
            saveBackupConfig(cfg);
          }
        }
      } catch (err) {
        status = 'failed';
        error = err instanceof Error ? err.message : String(err);
        console.error(`[Backup] Failed for provider ${providerConfig.label}:`, err);
      }

      const entry: BackupHistoryEntry = {
        id: uuidv4(),
        projectId, projectName: project.name,
        providerId: providerConfig.id,
        providerType: providerConfig.type,
        providerLabel: providerConfig.label,
        startTime, endTime: new Date().toISOString(),
        status, filesUploaded, filesDeleted, filesTotal: totalFiles,
        error,
      };
      addBackupHistory(entry);
      results.push(entry);

      onProgress?.({
        projectId, projectName: project.name,
        providerId: providerConfig.id, providerLabel: providerConfig.label,
        status: 'done', filesUploaded, filesDeleted, filesTotal: totalFiles,
      });
    })
  );

  // 5. Save backup state (only if at least one provider succeeded)
  if (results.some((r) => r.status !== 'failed')) {
    const newState: BackupState = {
      lastBackupTime: new Date().toISOString(),
      files: newSnapshots,
    };
    saveBackupState(folderPath, newState);
  }

  return results;
}

export async function runBackupAll(onProgress?: ProgressCallback): Promise<BackupHistoryEntry[]> {
  const projects = getProjects().filter((p) => !p.archived);
  const allResults: BackupHistoryEntry[] = [];
  for (const project of projects) {
    try {
      const results = await runBackup(project.id, onProgress);
      allResults.push(...results);
    } catch (err) {
      console.error(`[Backup] Failed for project ${project.name}:`, err);
    }
  }
  return allResults;
}
```

- [ ] **Step 2: Install minimatch dependency**

```bash
cd backend && npm install minimatch && npm install -D @types/minimatch
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/backup/engine.ts backend/package.json backend/package-lock.json
git commit -m "feat(backup): add backup engine with incremental sync"
```

---

## Task 7: Scheduler

**Files:**
- Create: `backend/src/backup/scheduler.ts`

- [ ] **Step 1: Implement scheduler**

```typescript
// backend/src/backup/scheduler.ts

import { getBackupConfig } from './config';
import { runBackupAll, ProgressCallback } from './engine';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startScheduler(onProgress?: ProgressCallback): void {
  stopScheduler();
  const config = getBackupConfig();
  if (!config.schedule.enabled) return;

  const intervalMs = config.schedule.intervalMinutes * 60 * 1000;
  console.log(`[Backup] Scheduler started: every ${config.schedule.intervalMinutes} minutes`);

  timer = setInterval(async () => {
    if (running) {
      console.log('[Backup] Skipping scheduled backup — previous one still running');
      return;
    }
    running = true;
    try {
      console.log('[Backup] Scheduled backup starting...');
      const results = await runBackupAll(onProgress);
      const ok = results.filter((r) => r.status === 'success').length;
      const fail = results.filter((r) => r.status === 'failed').length;
      console.log(`[Backup] Scheduled backup done: ${ok} success, ${fail} failed`);
    } catch (err) {
      console.error('[Backup] Scheduled backup error:', err);
    } finally {
      running = false;
    }
  }, intervalMs);
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[Backup] Scheduler stopped');
  }
}

export function restartScheduler(onProgress?: ProgressCallback): void {
  stopScheduler();
  startScheduler(onProgress);
}

export function isSchedulerRunning(): boolean {
  return timer !== null;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/backup/scheduler.ts
git commit -m "feat(backup): add scheduled backup"
```

---

## Task 8: Backup API routes

**Files:**
- Create: `backend/src/routes/backup.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Create backup routes**

```typescript
// backend/src/routes/backup.ts

import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest } from '../auth';
import { ProviderConfig, ProviderType } from '../backup/types';
import {
  getBackupConfig, saveBackupConfig, getBackupHistory,
} from '../backup/config';
import { createProvider } from '../backup/providers';
import { runBackup } from '../backup/engine';
import { restartScheduler } from '../backup/scheduler';

const router = Router();

// ── Provider CRUD ────────────────────────────────────────────────────────────

// GET /api/backup/providers — list all configured providers
router.get('/providers', (_req: AuthRequest, res: Response): void => {
  const config = getBackupConfig();
  // Strip tokens from response (only return auth status)
  const providers = config.providers.map((p) => ({
    ...p,
    clientSecret: '***',
    tokens: p.tokens ? { authorized: true, expiry: p.tokens.expiry } : undefined,
    authorized: !!p.tokens,
  }));
  res.json(providers);
});

// POST /api/backup/providers — add a new provider
router.post('/providers', (req: AuthRequest, res: Response): void => {
  const { type, label, clientId, clientSecret } = req.body as {
    type?: ProviderType; label?: string; clientId?: string; clientSecret?: string;
  };
  if (!type || !label || !clientId || !clientSecret) {
    res.status(400).json({ error: 'type, label, clientId, clientSecret are required' });
    return;
  }
  if (!['google-drive', 'onedrive', 'dropbox'].includes(type)) {
    res.status(400).json({ error: 'Invalid provider type' });
    return;
  }

  const config = getBackupConfig();
  const provider: ProviderConfig = {
    id: uuidv4(), type, label, clientId, clientSecret,
  };
  config.providers.push(provider);
  saveBackupConfig(config);
  res.status(201).json({ id: provider.id, type, label, authorized: false });
});

// DELETE /api/backup/providers/:id — remove a provider
router.delete('/providers/:id', (req: AuthRequest, res: Response): void => {
  const config = getBackupConfig();
  const idx = config.providers.findIndex((p) => p.id === req.params.id);
  if (idx < 0) { res.status(404).json({ error: 'Provider not found' }); return; }
  config.providers.splice(idx, 1);
  saveBackupConfig(config);
  res.json({ success: true });
});

// ── OAuth2 ───────────────────────────────────────────────────────────────────

// GET /api/backup/auth/:id/url — get OAuth2 authorization URL
router.get('/auth/:id/url', (req: AuthRequest, res: Response): void => {
  const config = getBackupConfig();
  const providerConfig = config.providers.find((p) => p.id === req.params.id);
  if (!providerConfig) { res.status(404).json({ error: 'Provider not found' }); return; }

  const port = req.socket.localPort || 3001;
  const redirectUri = `http://localhost:${port}/api/backup/auth/callback`;
  const provider = createProvider(providerConfig);
  const url = provider.getAuthUrl(redirectUri);
  res.json({ url });
});

// GET /api/backup/auth/callback — OAuth2 redirect callback
router.get('/auth/callback', async (req: AuthRequest, res: Response): Promise<void> => {
  const { code, state } = req.query as { code?: string; state?: string };
  if (!code || !state) {
    res.status(400).send('Missing code or state parameter');
    return;
  }

  const config = getBackupConfig();
  const providerConfig = config.providers.find((p) => p.id === state);
  if (!providerConfig) {
    res.status(404).send('Provider not found');
    return;
  }

  try {
    const port = req.socket.localPort || 3001;
    const redirectUri = `http://localhost:${port}/api/backup/auth/callback`;
    const provider = createProvider(providerConfig);
    const tokens = await provider.handleCallback(code, redirectUri);

    // Save tokens to config
    providerConfig.tokens = tokens;
    saveBackupConfig(config);

    // Redirect to settings page with success indicator
    res.redirect('/?backup_auth=success');
  } catch (err) {
    console.error('[Backup] OAuth callback error:', err);
    res.redirect('/?backup_auth=error');
  }
});

// ── Backup operations ────────────────────────────────────────────────────────

// POST /api/backup/run/:projectId — trigger manual backup
router.post('/run/:projectId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const results = await runBackup(req.params.projectId);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Schedule ─────────────────────────────────────────────────────────────────

// GET /api/backup/schedule — get schedule config
router.get('/schedule', (_req: AuthRequest, res: Response): void => {
  const config = getBackupConfig();
  res.json(config.schedule);
});

// PUT /api/backup/schedule — update schedule config
router.put('/schedule', (req: AuthRequest, res: Response): void => {
  const { enabled, intervalMinutes } = req.body as { enabled?: boolean; intervalMinutes?: number };
  const config = getBackupConfig();
  if (typeof enabled === 'boolean') config.schedule.enabled = enabled;
  if (typeof intervalMinutes === 'number' && intervalMinutes > 0) {
    config.schedule.intervalMinutes = intervalMinutes;
  }
  saveBackupConfig(config);
  restartScheduler();
  res.json(config.schedule);
});

// ── Exclude patterns ─────────────────────────────────────────────────────────

// GET /api/backup/excludes — get exclude patterns
router.get('/excludes', (_req: AuthRequest, res: Response): void => {
  const config = getBackupConfig();
  res.json(config.excludePatterns);
});

// PUT /api/backup/excludes — update exclude patterns
router.put('/excludes', (req: AuthRequest, res: Response): void => {
  const { patterns } = req.body as { patterns?: string[] };
  if (!Array.isArray(patterns)) { res.status(400).json({ error: 'patterns must be an array' }); return; }
  const config = getBackupConfig();
  config.excludePatterns = patterns;
  saveBackupConfig(config);
  res.json(patterns);
});

// ── History ──────────────────────────────────────────────────────────────────

// GET /api/backup/history — get backup history
router.get('/history', (_req: AuthRequest, res: Response): void => {
  res.json(getBackupHistory());
});

export default router;
```

- [ ] **Step 2: Mount backup routes in index.ts**

In `backend/src/index.ts`, after the existing route imports, add:

```typescript
import backupRouter from './routes/backup';
import { startScheduler } from './backup/scheduler';
```

After existing `app.use` route registrations, add:

```typescript
app.use('/api/backup', authMiddleware, backupRouter);
```

Inside `server.listen` callback, after `terminalManager.resumeAll()`, add:

```typescript
startScheduler();
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/backup.ts backend/src/index.ts
git commit -m "feat(backup): add backup API routes and mount scheduler"
```

---

## Task 9: Frontend API functions

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add backup API functions to api.ts**

Append to `frontend/src/lib/api.ts`:

```typescript
// ── Backup API ───────────────────────────────────────────────────────────────

export interface BackupProvider {
  id: string;
  type: 'google-drive' | 'onedrive' | 'dropbox';
  label: string;
  clientId: string;
  clientSecret: string;
  authorized: boolean;
  tokens?: { authorized: boolean; expiry: string };
}

export interface BackupSchedule {
  enabled: boolean;
  intervalMinutes: number;
}

export interface BackupHistoryEntry {
  id: string;
  projectId: string;
  projectName: string;
  providerId: string;
  providerType: string;
  providerLabel: string;
  startTime: string;
  endTime: string;
  status: 'success' | 'failed' | 'partial';
  filesUploaded: number;
  filesDeleted: number;
  filesTotal: number;
  error?: string;
}

export async function getBackupProviders(): Promise<BackupProvider[]> {
  return request<BackupProvider[]>('GET', '/api/backup/providers');
}

export async function addBackupProvider(data: {
  type: string; label: string; clientId: string; clientSecret: string;
}): Promise<{ id: string }> {
  return request<{ id: string }>('POST', '/api/backup/providers', data);
}

export async function deleteBackupProvider(id: string): Promise<void> {
  await request<{ success: boolean }>('DELETE', `/api/backup/providers/${id}`);
}

export async function getBackupAuthUrl(providerId: string): Promise<{ url: string }> {
  return request<{ url: string }>('GET', `/api/backup/auth/${providerId}/url`);
}

export async function triggerBackup(projectId: string): Promise<{ results: BackupHistoryEntry[] }> {
  return request<{ results: BackupHistoryEntry[] }>('POST', `/api/backup/run/${projectId}`);
}

export async function getBackupSchedule(): Promise<BackupSchedule> {
  return request<BackupSchedule>('GET', '/api/backup/schedule');
}

export async function updateBackupSchedule(data: Partial<BackupSchedule>): Promise<BackupSchedule> {
  return request<BackupSchedule>('PUT', '/api/backup/schedule', data);
}

export async function getBackupExcludes(): Promise<string[]> {
  return request<string[]>('GET', '/api/backup/excludes');
}

export async function updateBackupExcludes(patterns: string[]): Promise<string[]> {
  return request<string[]>('PUT', '/api/backup/excludes', { patterns });
}

export async function getBackupHistory(): Promise<BackupHistoryEntry[]> {
  return request<BackupHistoryEntry[]>('GET', '/api/backup/history');
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(backup): add frontend backup API client functions"
```

---

## Task 10: Settings page and components

**Files:**
- Create: `frontend/src/pages/SettingsPage.tsx`
- Create: `frontend/src/components/AddProviderDialog.tsx`
- Create: `frontend/src/components/BackupProviderCard.tsx`
- Create: `frontend/src/components/BackupHistoryTable.tsx`

- [ ] **Step 1: Create AddProviderDialog**

A dialog component for adding a new cloud provider. User selects type, enters label, Client ID, Client Secret.

```typescript
// frontend/src/components/AddProviderDialog.tsx
// Dialog with form: type select (google-drive/onedrive/dropbox), label input, clientId input, clientSecret input
// On submit: call addBackupProvider(), then call getBackupAuthUrl() and window.open() the auth URL
// Uses shadcn Dialog, Input, Label, Select, Button
```

Full implementation with shadcn/ui `Dialog`, `Select`, `Input`, `Label`, `Button`. On submit:
1. `addBackupProvider({ type, label, clientId, clientSecret })`
2. `getBackupAuthUrl(id)` → `window.open(url, '_blank')`
3. Close dialog, refresh parent's provider list

- [ ] **Step 2: Create BackupProviderCard**

Card component showing provider info: type icon, label, auth status (green/red badge), "Re-authorize" and "Delete" buttons.

```typescript
// frontend/src/components/BackupProviderCard.tsx
// Props: provider: BackupProvider, onDelete, onReauth
// Uses shadcn Card, Badge, Button; lucide-react icons (Cloud, Trash2)
// Type-specific icons: google-drive → HardDrive, onedrive → Cloud, dropbox → Inbox
```

- [ ] **Step 3: Create BackupHistoryTable**

Table showing recent backup events: time, project, provider, status, files count, duration.

```typescript
// frontend/src/components/BackupHistoryTable.tsx
// Props: history: BackupHistoryEntry[]
// Uses shadcn Table components
// Status column: success=green badge, failed=red, partial=yellow
// Duration: computed from endTime - startTime
```

- [ ] **Step 4: Create SettingsPage with 3 tabs**

```typescript
// frontend/src/pages/SettingsPage.tsx
// Three tabs using shadcn Tabs:
// 1. 云盘账号 (Cloud Accounts) — provider list + add button
// 2. 备份策略 (Backup Strategy) — exclude patterns + schedule toggle + interval select
// 3. 备份记录 (Backup History) — history table
// Back button (← icon) in header to return to dashboard
// Uses useEffect to fetch providers, schedule, excludes, history on mount
```

Full implementation: `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` from shadcn. State management for each tab's data. CRUD operations for providers, schedule updates, exclude pattern editing (tag-style with X to remove, input to add).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SettingsPage.tsx frontend/src/components/AddProviderDialog.tsx frontend/src/components/BackupProviderCard.tsx frontend/src/components/BackupHistoryTable.tsx
git commit -m "feat(backup): add Settings page with cloud accounts, strategy, and history tabs"
```

---

## Task 11: Router and dashboard integration

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Modify: `frontend/src/pages/ProjectPage.tsx`

- [ ] **Step 1: Add /settings route to App.tsx**

Import `SettingsPage` and add route inside `<Routes>`:

```tsx
<Route path="/settings" element={
  <PrivateRoute>
    <SettingsPage />
  </PrivateRoute>
} />
```

- [ ] **Step 2: Add Settings button to DashboardPage**

In the DashboardPage header/toolbar area, add a Settings button:

```tsx
import { Settings } from 'lucide-react';

// In the header area, next to existing controls:
<Button variant="ghost" size="icon" onClick={() => navigate('/settings')} title="设置">
  <Settings className="h-5 w-5" />
</Button>
```

- [ ] **Step 3: Add Backup button to ProjectPage**

In the ProjectPage header, add a backup button:

```tsx
import { CloudUpload } from 'lucide-react';
import { triggerBackup } from '@/lib/api';

// State:
const [backingUp, setBackingUp] = useState(false);

// Handler:
const handleBackup = async () => {
  setBackingUp(true);
  try {
    await triggerBackup(projectId);
    // show success toast or notification
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Backup failed');
  } finally {
    setBackingUp(false);
  }
};

// In header:
<Button variant="ghost" size="icon" onClick={handleBackup} disabled={backingUp} title="备份">
  {backingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
</Button>
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/pages/DashboardPage.tsx frontend/src/pages/ProjectPage.tsx
git commit -m "feat(backup): integrate settings route and backup buttons"
```

---

## Task 12: Build, verify, and final commit

- [ ] **Step 1: Install all backend dependencies**

```bash
cd backend && npm install googleapis @microsoft/microsoft-graph-client @azure/msal-node dropbox minimatch && npm install -D @types/minimatch
```

- [ ] **Step 2: Build and fix any TypeScript errors**

```bash
npm run build
```

Fix any compilation errors that arise.

- [ ] **Step 3: Test OAuth flow manually**

1. Start dev server: `npm run dev:backend` + `npm run dev:frontend`
2. Navigate to Settings page
3. Add a provider with test credentials
4. Verify auth URL is generated correctly
5. Verify callback endpoint works

- [ ] **Step 4: Version bump to v1.5.13**

Update version in `package.json`, `UpdateButton.tsx`, `README.md`.

- [ ] **Step 5: Final build and commit**

```bash
npm run build
git add -A
git commit -m "v1.5.13: Add cloud backup (Google Drive, OneDrive, Dropbox)"
```
