import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Project, Config, CliTool } from './types';

export interface GlobalShortcut {
  id: string;
  label: string;
  command: string;
  parentId?: string; // inheritance: if set, parent's command is sent first
}

export const DATA_DIR = process.env.CCWEB_DATA_DIR || path.join(__dirname, '../../data');

/** Atomic write: write to temp file then rename, preventing corruption on crash */
export function atomicWriteSync(filePath: string, data: string): void {
  const tmpPath = filePath + `.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, data, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const SHORTCUTS_FILE = path.join(DATA_DIR, 'global-shortcuts.json');

export function initDataDirs(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(PROJECTS_FILE)) {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
}

// Cache getConfig() — config.json rarely changes, avoid repeated disk reads
let _configCache: Config | null = null;
let _configMtime = 0;

export function getConfig(): Config {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error('Config file not found. Please run: npm run setup');
  }
  const mtime = fs.statSync(CONFIG_FILE).mtimeMs;
  if (_configCache && mtime === _configMtime) return _configCache;
  const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
  _configCache = JSON.parse(raw) as Config;
  _configMtime = mtime;
  return _configCache;
}

export function getAdminUsername(): string | undefined {
  try { return getConfig().username; } catch { return undefined; }
}

export function isAdminUser(username?: string): boolean {
  if (!username) return false;
  // When config.json doesn't exist (no setup yet), localhost auth uses this sentinel.
  // Treat it as admin so filesystem defaults to ~/Projects instead of ~/Projects__local_admin__.
  if (username === '__local_admin__' && getAdminUsername() === undefined) return true;
  return username === getAdminUsername();
}

export function isProjectOwner(project: Project, username?: string): boolean {
  if (!username) return false;
  if (project.owner) return project.owner === username;
  return isAdminUser(username);
}

/** Get the workspace root folder for a user. Admin → ~/Projects, others → ~/Projects{username} */
export function getUserWorkspace(username?: string): string {
  const home = os.homedir();
  if (!username || isAdminUser(username)) return path.join(home, 'Projects');
  return path.join(home, `Projects${username}`);
}

export interface UserEntry {
  username: string;
  passwordHash: string;
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');

/** Get all registered users (from users.json) */
export function getRegisteredUsers(): UserEntry[] {
  if (!fs.existsSync(USERS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')) as UserEntry[];
  } catch {
    return [];
  }
}

export function getProjects(): Project[] {
  if (!fs.existsSync(PROJECTS_FILE)) return [];
  try {
    const raw = fs.readFileSync(PROJECTS_FILE, 'utf-8');
    return JSON.parse(raw) as Project[];
  } catch (err) {
    console.error('[Config] Failed to parse projects.json — returning empty list:', err);
    return [];
  }
}

export function saveProjects(projects: Project[]): void {
  atomicWriteSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

export function getProject(id: string): Project | undefined {
  return getProjects().find((p) => p.id === id);
}

export function saveProject(project: Project): void {
  const projects = getProjects();
  const index = projects.findIndex((p) => p.id === project.id);
  if (index >= 0) {
    projects[index] = project;
  } else {
    projects.push(project);
  }
  saveProjects(projects);
}

export function deleteProject(id: string): void {
  saveProjects(getProjects().filter((p) => p.id !== id));
}

/** Get the shortcuts file path for a given user. Undefined/admin uses the legacy file. */
function shortcutsFileForUser(username?: string): string {
  if (!username || isAdminUser(username)) return SHORTCUTS_FILE;
  const safe = username.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DATA_DIR, `global-shortcuts-${safe}.json`);
}

export function getGlobalShortcuts(username?: string): GlobalShortcut[] {
  const file = shortcutsFileForUser(username);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as GlobalShortcut[];
  } catch {
    return [];
  }
}

export function saveGlobalShortcuts(shortcuts: GlobalShortcut[], username?: string): void {
  const file = shortcutsFileForUser(username);
  atomicWriteSync(file, JSON.stringify(shortcuts, null, 2));
}

// ── .ccweb/ per-project config ────────────────────────────────────────────────

const CCWEB_DIR = '.ccweb';
const PROJECT_CONFIG_FILE = 'project.json';

export interface ProjectConfig {
  id: string;
  name: string;
  permissionMode: 'limited' | 'unlimited';
  cliTool: CliTool;
  createdAt: string;
}

export function ccwebDir(folderPath: string): string {
  return path.join(folderPath, CCWEB_DIR);
}

export function ccwebSessionsDir(folderPath: string): string {
  return path.join(folderPath, CCWEB_DIR, 'sessions');
}

/** Write .ccweb/project.json into the project folder */
export function writeProjectConfig(folderPath: string, project: Project): void {
  const dir = ccwebDir(folderPath);
  fs.mkdirSync(dir, { recursive: true });
  const config: ProjectConfig = {
    id: project.id,
    name: project.name,
    permissionMode: project.permissionMode,
    cliTool: project.cliTool,
    createdAt: project.createdAt,
  };
  atomicWriteSync(path.join(dir, PROJECT_CONFIG_FILE), JSON.stringify(config, null, 2));
}

/** Read .ccweb/project.json from a project folder. Returns null if not found. */
export function readProjectConfig(folderPath: string): ProjectConfig | null {
  const file = path.join(ccwebDir(folderPath), PROJECT_CONFIG_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as ProjectConfig;
  } catch {
    return null;
  }
}

// ── .ccweb/ per-project shortcuts ────────────────────────────────────────────

export interface ProjectShortcut {
  id: string;
  label: string;
  command: string;
}

const PROJECT_SHORTCUTS_FILE = 'shortcuts.json';

export function readProjectShortcuts(folderPath: string): ProjectShortcut[] {
  const file = path.join(ccwebDir(folderPath), PROJECT_SHORTCUTS_FILE);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as ProjectShortcut[];
  } catch {
    return [];
  }
}

export function saveProjectShortcuts(folderPath: string, shortcuts: ProjectShortcut[]): void {
  const dir = ccwebDir(folderPath);
  fs.mkdirSync(dir, { recursive: true });
  atomicWriteSync(path.join(dir, PROJECT_SHORTCUTS_FILE), JSON.stringify(shortcuts, null, 2));
}

/** Update .ccweb/project.json (partial update) */
export function updateProjectConfig(folderPath: string, updates: Partial<ProjectConfig>): void {
  const existing = readProjectConfig(folderPath);
  if (!existing) return;
  const merged = { ...existing, ...updates };
  const dir = ccwebDir(folderPath);
  atomicWriteSync(path.join(dir, PROJECT_CONFIG_FILE), JSON.stringify(merged, null, 2));
}