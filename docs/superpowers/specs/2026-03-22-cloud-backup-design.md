# Cloud Backup Design

## Problem

ccweb users need a way to back up their project files to cloud storage. Currently there is no backup mechanism — data only exists locally.

## Solution

Integrate OneDrive, Dropbox, and Google Drive as backup targets via a unified CloudProvider abstraction. Support both manual and scheduled incremental backups. All projects are backed up to all configured cloud accounts simultaneously.

## Requirements

- **Cloud providers**: Google Drive, OneDrive, Dropbox
- **Trigger**: Manual (per-project button) + automatic (configurable interval)
- **Auth**: User registers their own OAuth2 app per provider, fills in Client ID/Secret in ccweb settings
- **Backup content**: Entire project folder (with configurable exclude patterns)
- **Backup strategy**: Incremental — only upload changed files since last backup
- **Scope**: Global config supports multiple cloud accounts; all projects backup to every configured account
- **Cloud folder structure**: `/.ccweb-backup/{project-name}/` in each cloud drive's root

## Architecture

```
Frontend Settings Page
    │
    ├── Cloud account management (CRUD)
    │     └── OAuth2 authorization flow
    ├── Backup strategy config (interval, exclude patterns)
    └── Manual backup / restore buttons
    │
    ▼
Backend API
    ├── /api/backup/providers       — Cloud account CRUD
    ├── /api/backup/auth/callback   — OAuth2 callback
    ├── /api/backup/run/:projectId  — Manual trigger backup
    ├── /api/backup/restore/:projectId — Restore from cloud
    ├── /api/backup/status          — Backup status query
    └── /api/backup/schedule        — Schedule config
    │
    ▼
BackupEngine
    ├── Incremental detection (file hash/mtime comparison)
    ├── Parallel upload to all configured providers
    └── State persistence (.ccweb/backup-state.json per project)
    │
    ▼
CloudProvider interface
    ├── GoogleDriveProvider
    ├── OneDriveProvider
    └── DropboxProvider
```

## CloudProvider Interface

```typescript
interface RemoteFile {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedTime: string;
}

interface CloudProviderConfig {
  id: string;                // UUID
  type: 'google-drive' | 'onedrive' | 'dropbox';
  label: string;             // User-defined name
  clientId: string;
  clientSecret: string;
  tokens?: {
    access_token: string;
    refresh_token: string;
    expiry: string;
  };
}

interface CloudProvider {
  config: CloudProviderConfig;

  // Auth
  getAuthUrl(redirectUri: string): string;
  handleCallback(code: string, redirectUri: string): Promise<CloudProviderConfig['tokens']>;
  refreshToken(): Promise<void>;
  isAuthorized(): boolean;

  // File operations (paths relative to .ccweb-backup/)
  listFiles(remotePath: string): Promise<RemoteFile[]>;
  uploadFile(localPath: string, remotePath: string): Promise<void>;
  deleteFile(remotePath: string): Promise<void>;
  mkdir(remotePath: string): Promise<void>;
  downloadFile(remotePath: string, localPath: string): Promise<void>;
}
```

## Incremental Backup Mechanism

Each project maintains a file snapshot in `.ccweb/backup-state.json`:

```json
{
  "lastBackupTime": "2026-03-22T10:00:00Z",
  "files": {
    "src/index.ts": { "mtime": 1711094400000, "size": 2048, "hash": "sha256:abc..." }
  }
}
```

Backup flow:
1. Scan project directory, skip excluded patterns (`node_modules`, `.git`, `dist`, `*.log`)
2. Compare mtime + size against `backup-state.json`; for changed files, compute sha256 to confirm
3. Upload changed/new files to `.ccweb-backup/{project-name}/` on all configured cloud accounts (in parallel across providers)
4. Delete remote files that no longer exist locally
5. Update `backup-state.json`

## Data Storage

### Global backup config (`~/.ccweb/backup-config.json`)

```json
{
  "providers": [
    {
      "id": "uuid-1",
      "type": "google-drive",
      "label": "My Google Drive",
      "clientId": "...",
      "clientSecret": "...",
      "tokens": { "access_token": "...", "refresh_token": "...", "expiry": "..." }
    }
  ],
  "schedule": {
    "enabled": false,
    "intervalMinutes": 60
  },
  "excludePatterns": ["node_modules", ".git", "dist", "*.log"]
}
```

Tokens are stored encrypted at rest is a future enhancement — for now stored as plain JSON (same pattern as existing `config.json` with password hashes and JWT secrets).

### Per-project backup state (`.ccweb/backup-state.json`)

Tracks file hashes and mtimes for incremental detection. Lives alongside existing `.ccweb/project.json` and `.ccweb/sessions/`.

## OAuth2 Flow

1. User fills in Client ID/Secret in Settings page, selects provider type, clicks "Authorize"
2. Backend generates authorization URL with scopes:
   - Google Drive: `https://www.googleapis.com/auth/drive.file`
   - OneDrive: `Files.ReadWrite`
   - Dropbox: `files.content.write files.content.read`
3. Frontend opens new window to authorization URL
4. User authorizes on provider's consent page
5. Provider redirects to `http://localhost:{port}/api/backup/auth/callback?code=xxx&state=providerId`
6. Backend exchanges code for access_token + refresh_token, saves to config
7. Frontend polls `/api/backup/providers` or receives WebSocket notification to detect authorization completion

Token refresh is handled automatically before each backup operation when the token is expired.

## Scheduled Backup

Backend uses `setInterval` based on `schedule.intervalMinutes`. On server startup, if `schedule.enabled` is true, the scheduler starts. Each tick triggers incremental backup for all registered projects to all configured providers.

The scheduler is managed via:
- `POST /api/backup/schedule` — update schedule config (enable/disable, change interval)
- Config changes restart the interval timer

## Frontend UI

### Settings Page (`/settings`)

New page accessible from Dashboard via a "Settings" (设置) button in the top bar.

Three tabs:
- **云盘账号 (Cloud Accounts)**: List of configured providers as cards. Each card shows type icon, label, auth status. Actions: add, delete, re-authorize. "Add Account" opens a dialog: select type → fill Client ID/Secret → click Authorize.
- **备份策略 (Backup Strategy)**: Exclude patterns editor (tag-style input), scheduled backup toggle with interval selector (dropdown: 30min/1h/6h/12h/24h).
- **备份记录 (Backup History)**: Table of recent backup events with timestamp, project name, files uploaded, status (success/failed/partial), duration.

### Project Page Enhancement

Add a "Backup" (备份) button in the project page header. Click triggers manual backup for that single project. Shows a progress indicator during backup.

### Dashboard Enhancement

Add a "Settings" (设置) button in the Dashboard top bar, next to existing controls.

### Routing

Add `/settings` route to `App.tsx` router, protected by `PrivateRoute`.

## New Files

| File | Purpose |
|------|---------|
| `backend/src/backup/types.ts` | CloudProvider interface, RemoteFile, config types |
| `backend/src/backup/engine.ts` | BackupEngine — scan, diff, parallel upload, state management |
| `backend/src/backup/providers/google-drive.ts` | Google Drive CloudProvider implementation |
| `backend/src/backup/providers/onedrive.ts` | OneDrive CloudProvider implementation |
| `backend/src/backup/providers/dropbox.ts` | Dropbox CloudProvider implementation |
| `backend/src/backup/scheduler.ts` | Scheduled backup timer management |
| `backend/src/backup/config.ts` | Read/write backup-config.json |
| `backend/src/routes/backup.ts` | Backup REST API routes |
| `frontend/src/pages/SettingsPage.tsx` | Settings page with tabs |
| `frontend/src/components/BackupProviderCard.tsx` | Cloud account card component |
| `frontend/src/components/BackupHistoryTable.tsx` | Backup history table |

## Modified Files

| File | Change |
|------|--------|
| `backend/src/index.ts` | Mount `/api/backup` routes, start scheduler on boot |
| `frontend/src/App.tsx` | Add `/settings` route |
| `frontend/src/pages/DashboardPage.tsx` | Add Settings button |
| `frontend/src/pages/ProjectPage.tsx` | Add Backup button |
| `frontend/src/lib/api.ts` | Add backup API client functions |

## Dependencies to Install

### Backend
- `googleapis` — Google Drive API
- `@microsoft/microsoft-graph-client` — OneDrive (Microsoft Graph)
- `@azure/msal-node` — OneDrive OAuth2
- `dropbox` — Dropbox API

### Frontend
No new dependencies (uses existing shadcn/ui components).

## Default Exclude Patterns

```json
["node_modules", ".git", "dist", "build", "*.log", ".DS_Store", "*.tmp"]
```

Users can customize via the Settings page.

## Error Handling

- If one provider fails during multi-provider backup, continue with others and report partial failure
- Token refresh failures prompt user to re-authorize (shown in provider card status)
- Large file uploads use chunked/resumable upload where supported (Google Drive, OneDrive support this natively)
- Network errors are retried up to 3 times with exponential backoff

## Backup Status Reporting

Backup status is reported via WebSocket to connected clients:

```json
{ "type": "backup_progress", "projectId": "...", "provider": "google-drive", "progress": 0.75, "filesUploaded": 15, "filesTotal": 20 }
{ "type": "backup_complete", "projectId": "...", "provider": "google-drive", "status": "success", "duration": 12345 }
```
