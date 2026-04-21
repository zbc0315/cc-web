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

export async function getProjectOrder(): Promise<string[]> {
  const data = await request<{ order: string[] }>('GET', '/api/projects/order');
  return data.order;
}

export async function setProjectOrder(order: string[]): Promise<void> {
  await request<{ ok: true }>('PUT', '/api/projects/order', { order });
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

// ── Memory Prompts (filesystem-backed, marker-wrapped) ────────────────────

export interface MemoryPromptItem {
  filename: string;  // "my-memory.md"
  name: string;      // "my-memory"
  preview: string;
  inserted: boolean;
  lineCount: number;
}

export interface MemoryPromptsResponse {
  items: MemoryPromptItem[];
  claudeMdLineCount: number;
}

export async function getMemoryPrompts(projectId: string): Promise<MemoryPromptsResponse> {
  return request<MemoryPromptsResponse>(
    'GET',
    `/api/memory/project/${encodeURIComponent(projectId)}`,
  );
}

export async function toggleMemoryInClaudeMd(
  projectId: string,
  filename: string,
  action: 'insert' | 'remove',
): Promise<{ ok: boolean; changed: boolean; inserted: boolean; reason?: string; claudeMdLineCount?: number }> {
  return request(
    'POST',
    `/api/memory/project/${encodeURIComponent(projectId)}/toggle`,
    { filename, action },
  );
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

// ── CCWeb Hub API ────────────────────────────────────────────────────────────

/** Unified item from ccweb-hub covering both Quick Prompts and Agent Prompts. */
export interface HubItem {
  id: string;                          // "<kind>/<slug>"
  kind: 'quick-prompt' | 'agent-prompt';
  label: string;
  body: string;
  author?: string;
  tags?: string[];
  description?: string;
  file: string;                        // e.g. "quick-prompts/code-review.md"
}

export async function getHubItems(): Promise<HubItem[]> {
  return request<HubItem[]>('GET', '/api/skillhub/items');
}

/** Whether the current user has a GitHub PAT stored for one-click submit. */
export interface HubAuthStatus {
  configured: boolean;
  needsReset: boolean;
}

export async function getHubAuthStatus(): Promise<HubAuthStatus> {
  return request<HubAuthStatus>('GET', '/api/skillhub/auth');
}

export async function setHubToken(token: string): Promise<HubAuthStatus> {
  return request<HubAuthStatus & { ok: true }>('PUT', '/api/skillhub/auth', { token });
}

export async function clearHubToken(): Promise<void> {
  await request<{ ok: true }>('DELETE', '/api/skillhub/auth');
}

export async function submitToHub(data: {
  kind: 'quick-prompt' | 'agent-prompt';
  label: string;
  body: string;
  description?: string;
  tags?: string[];
  author?: string;
}): Promise<{ ok: true; issueNumber: number; issueUrl: string }> {
  return request('POST', '/api/skillhub/submit', data);
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

// ── User preferences ──────────────────────────────────────────────────────────

export async function getLanguagePref(): Promise<{ language: string | null }> {
  return request<{ language: string | null }>('GET', '/api/user-prefs/language');
}

export async function setLanguagePref(language: string): Promise<{ language: string }> {
  return request<{ language: string }>('PUT', '/api/user-prefs/language', { language });
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
  /** Commands from installed Claude Code plugins. Prefixed with `/<plugin>:`. */
  plugins: ClaudeSkillItem[];
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

/** Persist the chosen model into the tool's config file (e.g. `~/.claude/settings.json`).
 *  In-session switching is separate (sending `/model <alias>` to the TUI); this
 *  write ensures the next session starts with the chosen alias. */
export async function setToolModel(tool: string, model: string): Promise<{ ok: boolean; model: string }> {
  return request<{ ok: boolean; model: string }>('PUT', `/api/tool/model?tool=${encodeURIComponent(tool)}`, { model });
}

export async function getToolModels(tool: string): Promise<ToolModel[]> {
  return request<ToolModel[]>('GET', `/api/tool/models?tool=${encodeURIComponent(tool)}`);
}

export async function getToolSkills(tool: string, projectId?: string): Promise<ClaudeSkillsData> {
  const qs = projectId
    ? `?tool=${encodeURIComponent(tool)}&projectId=${encodeURIComponent(projectId)}`
    : `?tool=${encodeURIComponent(tool)}`;
  return request<ClaudeSkillsData>('GET', `/api/tool/skills${qs}`);
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

// ── Sync (rsync) ────────────────────────────────────────────────────────────

export type SyncDirection = 'push' | 'pull' | 'bidirectional';
export type SyncAuthMethod = 'key' | 'password';

export interface SyncConfigPublic {
  host: string;
  port: number;
  user: string;
  authMethod: SyncAuthMethod;
  keyPath?: string;
  passwordSet: boolean;
  remoteRoot: string;
  direction: SyncDirection;
  defaultExcludes: string[];
  schedule: { enabled: boolean; cron: string };
  projectExcludes: Record<string, string[]>;
}

export interface SyncResult {
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  bytes: number;
  filesTransferred: number;
  logTail: string;
  skipped?: true;
  reason?: string;
}

export async function getSyncConfig(): Promise<SyncConfigPublic> {
  return request<SyncConfigPublic>('GET', '/api/sync/config');
}

export async function updateSyncConfig(patch: Partial<SyncConfigPublic> & { password?: string }): Promise<SyncConfigPublic> {
  return request<SyncConfigPublic>('PUT', '/api/sync/config', patch);
}

export async function resetSyncConfig(): Promise<SyncConfigPublic> {
  return request<SyncConfigPublic>('POST', '/api/sync/reset');
}

export async function testSyncConnection(): Promise<{ ok: boolean; message: string }> {
  return request('POST', '/api/sync/test');
}

export async function syncProjectOnce(projectId: string, direction?: SyncDirection): Promise<SyncResult> {
  return request<SyncResult>('POST', `/api/sync/project/${encodeURIComponent(projectId)}`, direction ? { direction } : {});
}

export async function syncAll(): Promise<{ total: number; results: Array<{ projectId: string; name: string; ok: boolean; skipped?: boolean; reason?: string; bytes: number }>; cancelled?: boolean }> {
  return request('POST', '/api/sync/all');
}

export async function getSyncStatus(): Promise<{ inFlight: string[] }> {
  return request('GET', '/api/sync/status');
}

export async function cancelSyncProject(projectId: string): Promise<{ cancelled: boolean }> {
  return request('POST', `/api/sync/cancel/${encodeURIComponent(projectId)}`);
}

export async function cancelSyncAll(): Promise<{ cancelled: string[] }> {
  return request('POST', '/api/sync/cancel-all');
}
