import { Project, CliTool } from '../types';
import { getTokenFromStore, setTokenFromStore, clearTokenFromStore } from './stores';

const BASE_URL = '';

// Token management — delegates to Zustand auth store
export function getToken(): string | null {
  return getTokenFromStore();
}

export function setToken(token: string): void {
  setTokenFromStore(token);
}

export function clearToken(): void {
  clearTokenFromStore();
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
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
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

export async function getWorkspace(): Promise<string> {
  const data = await request<{ workspace: string }>('GET', '/api/projects/workspace');
  return data.workspace;
}

export async function getProjects(): Promise<Project[]> {
  return request<Project[]>('GET', '/api/projects');
}

export async function getAllUsers(): Promise<string[]> {
  return request<string[]>('GET', '/api/projects/users');
}

export async function updateProjectShares(projectId: string, shares: { username: string; permission: 'view' | 'edit' }[]): Promise<Project> {
  return request<Project>('PUT', `/api/projects/${projectId}/shares`, { shares });
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

export interface SemanticStatus {
  phase: 'thinking' | 'tool_use' | 'tool_result' | 'text';
  detail?: string;
  updatedAt: number;
}

export interface ProjectActivity {
  lastActivityAt: number;
  semantic?: SemanticStatus;
}

export async function getProjectsActivity(signal?: AbortSignal): Promise<Record<string, ProjectActivity>> {
  return request<Record<string, ProjectActivity>>('GET', '/api/projects/activity', undefined, true, signal);
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

// ── Agent Prompts API ────────────────────────────────────────────────────────

export interface AgentPrompt {
  id: string;
  label: string;
  command: string;
  createdAt: string;
}

export type AgentPromptWithState = AgentPrompt & { inserted: boolean };

export async function getGlobalPrompts(): Promise<AgentPrompt[]> {
  return request<AgentPrompt[]>('GET', '/api/prompts');
}

export async function createGlobalPrompt(data: { label: string; command: string }): Promise<AgentPrompt> {
  return request<AgentPrompt>('POST', '/api/prompts', data);
}

export async function updateGlobalPrompt(id: string, data: { label: string; command: string }): Promise<AgentPrompt> {
  return request<AgentPrompt>('PUT', `/api/prompts/${id}`, data);
}

export async function deleteGlobalPrompt(id: string): Promise<void> {
  await request<{ success: boolean }>('DELETE', `/api/prompts/${id}`);
}

export async function getProjectPrompts(
  projectId: string,
): Promise<{ global: AgentPromptWithState[]; project: AgentPromptWithState[] }> {
  return request('GET', `/api/prompts/project/${projectId}`);
}

export async function createProjectPrompt(
  projectId: string,
  data: { label: string; command: string },
): Promise<AgentPrompt> {
  return request<AgentPrompt>('POST', `/api/prompts/project/${projectId}`, data);
}

export async function updateProjectPrompt(
  projectId: string,
  id: string,
  data: { label: string; command: string },
): Promise<AgentPrompt> {
  return request<AgentPrompt>('PUT', `/api/prompts/project/${projectId}/${id}`, data);
}

export async function deleteProjectPrompt(projectId: string, id: string): Promise<void> {
  await request<{ success: boolean }>('DELETE', `/api/prompts/project/${projectId}/${id}`);
}

export interface PromptToggleResult {
  action: 'insert' | 'remove';
  changed: boolean;
  inserted: boolean;
  reason?: 'not-found' | 'not-present';
  removed?: 1;
}

export async function togglePromptInClaudeMd(
  projectId: string,
  text: string,
  action: 'insert' | 'remove',
): Promise<PromptToggleResult> {
  return request<PromptToggleResult>(
    'POST',
    `/api/prompts/project/${projectId}/toggle`,
    { text, action },
  );
}

// ── SkillHub API ─────────────────────────────────────────────────────────────

export interface SkillHubItem {
  id: string;
  label: string;
  command: string;
  description: string;
  author: string;
  tags: string[];
  downloads: number;
  createdAt: string;
  parentId?: string;
}

export async function getSkillHubSkills(): Promise<SkillHubItem[]> {
  return request<SkillHubItem[]>('GET', '/api/skillhub/skills');
}

export async function submitSkillToHub(data: { label: string; command: string; description: string; author: string; tags: string[]; parentId?: string }): Promise<void> {
  await request<{ success: boolean }>('POST', '/api/skillhub/submit', data);
}

export async function downloadSkillFromHub(id: string): Promise<GlobalShortcut> {
  return request<GlobalShortcut>('POST', `/api/skillhub/download/${id}`);
}

// ── Usage API ────────────────────────────────────────────────────────────────

export async function getUsage(tool = 'claude'): Promise<UsageData | null> {
  return request<UsageData | null>('GET', `/api/projects/usage?tool=${encodeURIComponent(tool)}`);
}

export async function refreshUsage(tool = 'claude'): Promise<UsageData | null> {
  return request<UsageData | null>('GET', `/api/projects/usage?refresh=true&tool=${encodeURIComponent(tool)}`);
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

export function getRawFileUrl(filePath: string): string {
  return `${BASE_URL}/api/filesystem/raw?path=${encodeURIComponent(filePath)}`;
}

export async function uploadFiles(targetDir: string, files: File[]): Promise<{ uploaded: { name: string; path: string; size: number }[]; errors: string[] }> {
  const formData = new FormData();
  formData.append('path', targetDir);
  for (const file of files) formData.append('files', file);

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}/api/filesystem/upload`, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error || `Upload failed: ${res.status}`);
  }
  return res.json() as Promise<{ uploaded: { name: string; path: string; size: number }[]; errors: string[] }>;
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

export async function deletePath(filePath: string): Promise<{ deleted: string }> {
  return request<{ deleted: string }>('DELETE', `/api/filesystem?path=${encodeURIComponent(filePath)}`);
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
  status: 'skipped' | 'command_sent' | 'waiting_idle' | 'stopped' | 'ready' | 'error';
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

export interface CheckVersionResponse {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

export async function checkVersion(): Promise<CheckVersionResponse> {
  return request<CheckVersionResponse>('GET', '/api/update/check-version');
}

export async function prepareForUpdate(): Promise<PrepareUpdateResponse> {
  return request<PrepareUpdateResponse>('POST', '/api/update/prepare');
}

export interface UpdateExecuteResponse {
  status: string;
  previousVersion?: string;
}

export async function executeUpdate(): Promise<UpdateExecuteResponse> {
  return request<UpdateExecuteResponse>('POST', '/api/update/execute');
}

export interface UpdateStatus {
  success: boolean;
  error?: string;
  completedAt?: number;
  previousVersion?: string;
  newVersion?: string;
}

export async function getUpdateStatus(): Promise<UpdateStatus | null> {
  return request<UpdateStatus | null>('GET', '/api/update/status');
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

export async function getBuiltInOAuthTypes(): Promise<{ available: string[] }> {
  return request<{ available: string[] }>('GET', '/api/backup/built-in-oauth');
}

export async function getBackupProviders(): Promise<BackupProvider[]> {
  return request<BackupProvider[]>('GET', '/api/backup/providers');
}

export async function addBackupProvider(data: {
  type: string; label: string; clientId?: string; clientSecret?: string;
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

// ── Notify API ────────────────────────────────────────────────────────────────

export interface NotifyConfig {
  webhookUrl?: string;
  webhookEnabled: boolean;
}

export async function getNotifyConfig(): Promise<NotifyConfig> {
  return request<NotifyConfig>('GET', '/api/notify/config');
}

export async function updateNotifyConfig(config: Partial<NotifyConfig>): Promise<NotifyConfig> {
  return request<NotifyConfig>('PUT', '/api/notify/config', config);
}

// ── Git API ───────────────────────────────────────────────────────────────────

export interface GitStatus {
  isRepo: boolean;
  branch?: string;
  staged?: string[];
  modified?: string[];
  untracked?: string[];
  deleted?: string[];
  ahead?: number;
  behind?: number;
}

export async function getGitStatus(projectId: string): Promise<GitStatus> {
  return request<GitStatus>('GET', `/api/projects/${projectId}/git/status`);
}

export async function getGitDiff(projectId: string, file?: string): Promise<{ diff: string }> {
  const qs = file ? `?file=${encodeURIComponent(file)}` : '';
  return request<{ diff: string }>('GET', `/api/projects/${projectId}/git/diff${qs}`);
}

export async function gitAdd(projectId: string, files: string[]): Promise<void> {
  await request<void>('POST', `/api/projects/${projectId}/git/add`, { files });
}

export async function gitCommit(projectId: string, message: string): Promise<void> {
  await request<void>('POST', `/api/projects/${projectId}/git/commit`, { message });
}

export interface GitCommit {
  hash: string;
  hashShort: string;
  message: string;
  author: string;
  date: string;
  parents: string[];
  branches: string[];
}

export async function getGitLog(projectId: string, limit = 50, skip = 0): Promise<{ commits: GitCommit[]; total: number }> {
  return request<{ commits: GitCommit[]; total: number }>('GET', `/api/projects/${projectId}/git/log?limit=${limit}&skip=${skip}`);
}

// ── Rename API ───────────────────────────────────────────────────────────────

export async function renameProject(projectId: string, name: string): Promise<Project> {
  return request<Project>('PATCH', `/api/projects/${projectId}/rename`, { name });
}

// ── Tags API ──────────────────────────────────────────────────────────────────

export async function updateProjectTags(projectId: string, tags: string[]): Promise<Project> {
  return request<Project>('PATCH', `/api/projects/${projectId}/tags`, { tags });
}

// ── Chat history API (unified chat data source) ─────────────────────────────
//
// Returns ChatBlock[] with stable ids (sha1 of jsonlPath+line) from the CLI's
// native JSONL tail. Consumed by useChatHistory.

import type { ChatMessage } from './websocket';

export interface ChatHistoryResponse {
  blocks: ChatMessage[]; // each block has a stable `id` from sha1(jsonlPath+line)
  hasMore: boolean;
}

export async function getChatHistory(
  projectId: string,
  options: { limit?: number; before?: string } = {},
): Promise<ChatHistoryResponse> {
  const params = new URLSearchParams();
  if (options.limit != null) params.set('limit', String(options.limit));
  if (options.before) params.set('before', options.before);
  const qs = params.toString();
  return request<ChatHistoryResponse>(
    'GET',
    `/api/projects/${projectId}/chat-history${qs ? '?' + qs : ''}`,
  );
}


export async function getProjectDiskSize(projectId: string): Promise<{ bytes: number }> {
  return request<{ bytes: number }>('GET', `/api/projects/${projectId}/disk-size`);
}

export async function getClaudeModel(): Promise<{ model: string }> {
  return request<{ model: string }>('GET', '/api/claude/model');
}

export interface ClaudeSkillItem {
  command: string;
  description: string;
}

export interface ClaudeSkillsData {
  builtin: ClaudeSkillItem[];
  custom: ClaudeSkillItem[];
  mcp: ClaudeSkillItem[];
}

export async function getClaudeSkills(): Promise<ClaudeSkillsData> {
  return request<ClaudeSkillsData>('GET', '/api/claude/skills');
}

// ── Tool-agnostic API (adapter-aware) ───────────────────────────────────────

export interface ToolModel {
  key: string;
  label: string;
}

export async function getToolModel(tool: string): Promise<{ model: string | null }> {
  return request<{ model: string | null }>('GET', `/api/tool/model?tool=${encodeURIComponent(tool)}`);
}

export async function getToolModels(tool: string): Promise<ToolModel[]> {
  return request<ToolModel[]>('GET', `/api/tool/models?tool=${encodeURIComponent(tool)}`);
}

export async function getToolSkills(tool: string): Promise<ClaudeSkillsData> {
  return request<ClaudeSkillsData>('GET', `/api/tool/skills?tool=${encodeURIComponent(tool)}`);
}

// ── Plugin API ───────────────────────────────────────────────────────────────

export type PluginScope = 'global' | 'dashboard' | 'project' | 'project:specific';

export interface PluginUserConfig {
  scope?: PluginScope;
  clickable?: boolean;
  projectIds?: string[];
  floatPosition?: { x: number; y: number };
  floatSize?: { w: number; h: number };
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  icon?: string;
  type: 'float';
  float: {
    defaultWidth: number;
    defaultHeight: number;
    minWidth?: number;
    minHeight?: number;
    resizable?: boolean;
    scope: { allowed: PluginScope[]; default: PluginScope };
    clickable: { allowed: boolean[]; default: boolean };
  };
  permissions: string[];
  hasBackend: boolean;
  enabled: boolean;
  installedAt: string;
  userConfig: PluginUserConfig;
}

export async function getInstalledPlugins(): Promise<PluginInfo[]> {
  return request<PluginInfo[]>('GET', '/api/plugins');
}

export async function installPlugin(downloadUrl: string): Promise<{ success: boolean; plugin: { id: string; name: string; version: string } }> {
  return request('POST', '/api/plugins/install', { downloadUrl });
}

export async function uninstallPlugin(id: string): Promise<void> {
  await request('DELETE', `/api/plugins/${id}`);
}

export async function updatePlugin(id: string, downloadUrl: string): Promise<{ success: boolean; plugin: { id: string; name: string; version: string } }> {
  return request('POST', `/api/plugins/${id}/update`, { downloadUrl });
}

export async function updatePluginConfig(id: string, config: Partial<PluginUserConfig>): Promise<PluginUserConfig> {
  return request('PUT', `/api/plugins/${id}/config`, config);
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  await request('PUT', `/api/plugins/${id}/enabled`, { enabled });
}

// ── Plan-Control ──

export interface PlanTreeNode {
  id: string;
  type: 'task' | 'if' | 'elif' | 'else' | 'for' | 'loop' | 'call' | 'func' | 'var';
  label: string;
  line: number;
  node_id?: string;
  status?: 'pending' | 'running' | 'success' | 'failed' | 'blocked' | 'skipped';
  children: PlanTreeNode[];
}

export interface PlanStatusResponse {
  initialized: boolean;
  hasMainPc: boolean;
  state: {
    status: string;
    current_line: number;
    executed_tasks: number;
    estimated_tasks: number;
    error?: string;
  } | null;
}

export interface PlanCheckResponse {
  valid: boolean;
  errors: { line: number; message: string }[];
}

export interface PlanNodeRecord {
  id: string;
  line: number;
  code: string;
  resolved_code: string;
  prompt: string;
  started_at: string;
  completed_at: string | null;
  nudge_count: number;
  status: string | null;
  result: unknown;
  summary: string | null;
}

export async function getPlanStatus(projectId: string): Promise<PlanStatusResponse> {
  return request<PlanStatusResponse>('GET', `/api/projects/${projectId}/plan/status`);
}

export async function initPlanControl(projectId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('POST', `/api/projects/${projectId}/plan/init`);
}

export async function checkPlanSyntax(projectId: string): Promise<PlanCheckResponse> {
  return request<PlanCheckResponse>('POST', `/api/projects/${projectId}/plan/check`);
}

export async function startPlan(projectId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('POST', `/api/projects/${projectId}/plan/start`);
}

export async function pausePlan(projectId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('POST', `/api/projects/${projectId}/plan/pause`);
}

export async function resumePlan(projectId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('POST', `/api/projects/${projectId}/plan/resume`);
}

export async function stopPlan(projectId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('POST', `/api/projects/${projectId}/plan/stop`);
}

export async function getPlanNodes(projectId: string): Promise<PlanNodeRecord[]> {
  return request<PlanNodeRecord[]>('GET', `/api/projects/${projectId}/plan/nodes`);
}

export async function getPlanTree(projectId: string): Promise<{ tree: PlanTreeNode[] | null }> {
  return request<{ tree: PlanTreeNode[] | null }>('GET', `/api/projects/${projectId}/plan/tree`);
}


// ── Approval (Claude Code PermissionRequest) ─────────────────────────────────

export interface PendingApproval {
  projectId: string;
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  sessionId: string;
  createdAt: number;
}

export async function getPendingApprovals(projectId: string): Promise<{ pending: PendingApproval[] }> {
  return request('GET', `/api/approval/${encodeURIComponent(projectId)}/pending`);
}

export async function decideApproval(projectId: string, toolUseId: string, behavior: 'allow' | 'deny', message?: string): Promise<{ ok: boolean }> {
  return request('POST', `/api/approval/${encodeURIComponent(projectId)}/${encodeURIComponent(toolUseId)}/decide`, { behavior, message });
}
