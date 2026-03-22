import { Project, CliTool } from '../types';

const BASE_URL = import.meta.env.DEV ? 'http://localhost:3001' : '';

// Token management
export function getToken(): string | null {
  return localStorage.getItem('cc_web_token');
}

export function setToken(token: string): void {
  localStorage.setItem('cc_web_token', token);
}

export function clearToken(): void {
  localStorage.removeItem('cc_web_token');
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  requiresAuth = true,
  signal?: AbortSignal
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (requiresAuth) {
    const token = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const errBody = (await res.json()) as { error?: string };
      if (errBody.error) errMsg = errBody.error;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }

  return res.json() as Promise<T>;
}

export async function login(username: string, password: string): Promise<string> {
  const data = await request<{ token: string }>(
    'POST',
    '/api/auth/login',
    { username, password },
    false
  );
  return data.token;
}

/** Check if we're on localhost */
export function isLocalAccess(): boolean {
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/** Get a token without credentials (localhost only) */
export async function getLocalToken(): Promise<string> {
  const data = await request<{ token: string }>('GET', '/api/auth/local-token', undefined, false);
  return data.token;
}

export async function getProjects(): Promise<Project[]> {
  return request<Project[]>('GET', '/api/projects');
}

export async function createProject(data: {
  name: string;
  folderPath: string;
  permissionMode: 'limited' | 'unlimited';
  cliTool: CliTool;
}): Promise<Project> {
  return request<Project>('POST', '/api/projects', data);
}

export async function openProject(folderPath: string): Promise<Project> {
  return request<Project>('POST', '/api/projects/open', { folderPath });
}

export async function deleteProject(id: string): Promise<void> {
  await request<{ success: boolean }>('DELETE', `/api/projects/${id}`);
}

export async function stopProject(id: string): Promise<Project> {
  return request<Project>('PATCH', `/api/projects/${id}/stop`);
}

export async function startProject(id: string): Promise<Project> {
  return request<Project>('PATCH', `/api/projects/${id}/start`);
}

export async function archiveProject(id: string): Promise<Project> {
  return request<Project>('PATCH', `/api/projects/${id}/archive`);
}

export async function unarchiveProject(id: string): Promise<Project> {
  return request<Project>('PATCH', `/api/projects/${id}/unarchive`);
}

export interface SessionSummary {
  id: string;
  projectId: string;
  startedAt: string;
  messageCount: number;
  isCurrent: boolean;
}

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface Session extends SessionSummary {
  messages: SessionMessage[];
}

export async function getSessions(projectId: string, signal?: AbortSignal): Promise<SessionSummary[]> {
  return request<SessionSummary[]>('GET', `/api/projects/${projectId}/sessions`, undefined, true, signal);
}

export async function getSession(projectId: string, sessionId: string, signal?: AbortSignal): Promise<Session> {
  return request<Session>('GET', `/api/projects/${projectId}/sessions/${sessionId}`, undefined, true, signal);
}

export async function getProjectsActivity(signal?: AbortSignal): Promise<Record<string, number>> {
  return request<Record<string, number>>('GET', '/api/projects/activity', undefined, true, signal);
}

export interface UsageBucket {
  utilization?: number;
  resetAt?: string;
}

export interface UsageData {
  planName?: string;
  fiveHour?: UsageBucket;
  sevenDay?: UsageBucket;
  sevenDaySonnet?: UsageBucket;
  sevenDayOpus?: UsageBucket;
}

export interface GlobalShortcut {
  id: string;
  label: string;
  command: string;
  parentId?: string;
}

export async function getGlobalShortcuts(): Promise<GlobalShortcut[]> {
  return request<GlobalShortcut[]>('GET', '/api/shortcuts');
}

export async function createGlobalShortcut(data: { label: string; command: string; parentId?: string }): Promise<GlobalShortcut> {
  return request<GlobalShortcut>('POST', '/api/shortcuts', data);
}

export async function updateGlobalShortcut(id: string, data: { label: string; command: string; parentId?: string | null }): Promise<GlobalShortcut> {
  return request<GlobalShortcut>('PUT', `/api/shortcuts/${id}`, data);
}

export async function deleteGlobalShortcut(id: string): Promise<void> {
  await request<{ success: boolean }>('DELETE', `/api/shortcuts/${id}`);
}

// ── Project Shortcuts API ─────────────────────────────────────────────────────

export interface ProjectShortcut {
  id: string;
  label: string;
  command: string;
}

export async function getProjectShortcuts(projectId: string): Promise<ProjectShortcut[]> {
  return request<ProjectShortcut[]>('GET', `/api/shortcuts/project/${projectId}`);
}

export async function createProjectShortcut(projectId: string, data: { label: string; command: string }): Promise<ProjectShortcut> {
  return request<ProjectShortcut>('POST', `/api/shortcuts/project/${projectId}`, data);
}

export async function updateProjectShortcut(projectId: string, id: string, data: { label: string; command: string }): Promise<ProjectShortcut> {
  return request<ProjectShortcut>('PUT', `/api/shortcuts/project/${projectId}/${id}`, data);
}

export async function deleteProjectShortcut(projectId: string, id: string): Promise<void> {
  await request<{ success: boolean }>('DELETE', `/api/shortcuts/project/${projectId}/${id}`);
}

export async function getUsage(): Promise<UsageData | null> {
  return request<UsageData | null>('GET', '/api/projects/usage');
}

export async function refreshUsage(): Promise<UsageData | null> {
  return request<UsageData | null>('GET', '/api/projects/usage?refresh=true');
}

export interface FilesystemEntry {
  name: string;
  type: 'dir' | 'file';
  path: string;
}

export interface FilesystemResponse {
  path: string;
  parent: string | null;
  entries: FilesystemEntry[];
}

export async function browseFilesystem(path?: string): Promise<FilesystemResponse> {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  return request<FilesystemResponse>('GET', `/api/filesystem${query}`);
}

export async function createFolder(parentPath: string, name: string): Promise<{ path: string }> {
  return request<{ path: string }>('POST', '/api/filesystem/mkdir', { path: parentPath, name });
}

export interface FileContent {
  path: string;
  binary: boolean;
  tooLarge: boolean;
  size: number;
  content: string | null;
}

export async function readFile(filePath: string): Promise<FileContent> {
  return request<FileContent>('GET', `/api/filesystem/file?path=${encodeURIComponent(filePath)}`);
}

export async function writeFile(filePath: string, content: string): Promise<{ path: string; size: number }> {
  return request<{ path: string; size: number }>('PUT', '/api/filesystem/file', { path: filePath, content });
}

// ── Update API ────────────────────────────────────────────────────────────────

export interface RunningProjectInfo {
  id: string;
  name: string;
  status: string;
}

export interface CheckRunningResponse {
  runningCount: number;
  projects: RunningProjectInfo[];
}

export interface ProjectUpdateResult {
  id: string;
  name: string;
  status: 'skipped' | 'command_sent' | 'waiting_idle' | 'stopped' | 'error';
  message?: string;
}

export interface PrepareUpdateResponse {
  success: boolean;
  results: ProjectUpdateResult[];
  message?: string;
}

export async function checkRunningProjects(): Promise<CheckRunningResponse> {
  return request<CheckRunningResponse>('GET', '/api/update/check-running');
}

export async function prepareForUpdate(): Promise<PrepareUpdateResponse> {
  return request<PrepareUpdateResponse>('POST', '/api/update/prepare');
}

// ── Backup API ────────────────────────────────────────────────────────────────

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

// ── Sound API ─────────────────────────────────────────────────────────────────

export interface SoundPreset {
  id: string;
  name: string;
  type: 'strike' | 'ambient';
  defaultMode: 'loop' | 'interval';
  downloaded: boolean;
}

export interface SoundConfig {
  enabled: boolean;
  source: string;
  playMode: 'loop' | 'interval' | 'auto';
  volume: number;
  intervalRange: [number, number];
}

export interface AvailableSound {
  name: string;
  source: string;
  type?: string;
  defaultMode?: string;
}

export async function getSoundPresets(): Promise<SoundPreset[]> {
  return request<SoundPreset[]>('GET', '/api/sounds/presets');
}

export async function downloadSoundPreset(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('POST', `/api/sounds/download/${id}`);
}

export async function getAvailableSounds(projectId?: string): Promise<AvailableSound[]> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  return request<AvailableSound[]>('GET', `/api/sounds/list${query}`);
}

export function getSoundFileUrl(source: string, projectId?: string): string {
  const [scope, name] = source.split(':');
  if (scope === 'preset') return `${BASE_URL}/api/sounds/file/${name}.mp3`;
  if (scope === 'project' && projectId) return `${BASE_URL}/api/sounds/project/${projectId}/${name}`;
  return `${BASE_URL}/api/sounds/file/${name}`;
}

export async function uploadSound(file: File, scope: 'global' | 'project', projectId?: string): Promise<{ name: string }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('scope', scope);
  if (projectId) formData.append('projectId', projectId);

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}/api/sounds/upload`, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json() as Promise<{ name: string }>;
}

export async function saveProjectSoundConfig(projectId: string, sound: SoundConfig): Promise<void> {
  await request<any>('PATCH', `/api/projects/${projectId}`, { sound });
}