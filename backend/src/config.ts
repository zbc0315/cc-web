import * as fs from 'fs';
import * as path from 'path';
import { Project, Config } from './types';

export interface GlobalShortcut {
  id: string;
  label: string;
  command: string;
  parentId?: string; // inheritance: if set, parent's command is sent first
}

export const DATA_DIR = process.env.CCWEB_DATA_DIR || path.join(__dirname, '../../data');

/** Atomic write: write to temp file then rename, preventing corruption on crash */
function atomicWriteSync(filePath: string, data: string): void {
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

export function getConfig(): Config {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error('Config file not found. Please run: npm run setup');
  }
  const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
  return JSON.parse(raw) as Config;
}

export function getProjects(): Project[] {
  if (!fs.existsSync(PROJECTS_FILE)) return [];
  const raw = fs.readFileSync(PROJECTS_FILE, 'utf-8');
  return JSON.parse(raw) as Project[];
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

export function getGlobalShortcuts(): GlobalShortcut[] {
  if (!fs.existsSync(SHORTCUTS_FILE)) return [];
  return JSON.parse(fs.readFileSync(SHORTCUTS_FILE, 'utf-8')) as GlobalShortcut[];
}

export function saveGlobalShortcuts(shortcuts: GlobalShortcut[]): void {
  atomicWriteSync(SHORTCUTS_FILE, JSON.stringify(shortcuts, null, 2));
}

// ── .ccweb/ per-project config ────────────────────────────────────────────────

const CCWEB_DIR = '.ccweb';
const PROJECT_CONFIG_FILE = 'project.json';

export interface ProjectConfig {
  id: string;
  name: string;
  permissionMode: 'limited' | 'unlimited';
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

/** Update .ccweb/project.json (partial update) */
export function updateProjectConfig(folderPath: string, updates: Partial<ProjectConfig>): void {
  const existing = readProjectConfig(folderPath);
  if (!existing) return;
  const merged = { ...existing, ...updates };
  const dir = ccwebDir(folderPath);
  atomicWriteSync(path.join(dir, PROJECT_CONFIG_FILE), JSON.stringify(merged, null, 2));
}