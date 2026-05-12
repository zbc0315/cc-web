import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FlowDef, FlowState, TaskTodo, TaskTodoEntry } from './types';

/**
 * Path conventions and CRUD for the three flow JSON files.
 *
 * All paths are resolved against the project folder. Filename sanitization
 * prevents `../` escapes when looking up flow defs by name.
 */

function ccwebDir(folderPath: string): string {
  return path.join(folderPath, '.ccweb');
}

export function flowsDir(folderPath: string): string {
  return path.join(ccwebDir(folderPath), 'flows');
}

export function taskTodoPath(folderPath: string): string {
  return path.join(ccwebDir(folderPath), 'task_todo.json');
}

export function flowStatePath(folderPath: string): string {
  return path.join(ccwebDir(folderPath), 'flow_state.json');
}

/** Static check: `rel` is a safe in-project relative path (no absolute, no
 *  `..` segments after normalization, no NUL). Suitable for design-time
 *  validation (validateFlowDef) where folderPath isn't necessarily known. */
export function isSafeRelPath(rel: unknown): rel is string {
  if (!rel || typeof rel !== 'string') return false;
  if (rel.includes('\0')) return false;
  if (path.isAbsolute(rel)) return false;
  const n = path.normalize(rel);
  if (n === '..' || n.startsWith('..' + path.sep) || n.startsWith('../')) return false;
  return true;
}

/** Resolve `rel` against `folderPath` and verify the result stays within
 *  the folder (defends against `..` traversal and absolute-path injection).
 *  Returns the absolute path on success, or null on rejection.
 *  Prefix check uses `path.sep` so `/foo-other` can't match `/foo`. */
export function safeProjectPath(folderPath: string, rel: string): string | null {
  if (!isSafeRelPath(rel)) return null;
  const resolved = path.resolve(folderPath, rel);
  if (resolved !== folderPath && !resolved.startsWith(folderPath + path.sep)) return null;
  return resolved;
}

/** Reject filenames that contain path separators / parent-dir tokens / NUL.
 *  Returned name has `.json` appended if missing. */
export function sanitizeFlowFilename(name: string): string | null {
  if (!name || typeof name !== 'string') return null;
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return null;
  if (name === '.' || name === '..') return null;
  return name.endsWith('.json') ? name : `${name}.json`;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

// ── Flow definitions ───────────────────────────────────────────────────────

export function listFlowDefs(folderPath: string): string[] {
  const dir = flowsDir(folderPath);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
      .sort();
  } catch {
    return [];
  }
}

export function loadFlowDef(folderPath: string, filename: string): FlowDef | null {
  const safe = sanitizeFlowFilename(filename);
  if (!safe) return null;
  return readJson<FlowDef>(path.join(flowsDir(folderPath), safe));
}

export function saveFlowDef(folderPath: string, filename: string, def: FlowDef): boolean {
  const safe = sanitizeFlowFilename(filename);
  if (!safe) return false;
  writeJsonAtomic(path.join(flowsDir(folderPath), safe), def);
  return true;
}

export function deleteFlowDef(folderPath: string, filename: string): boolean {
  const safe = sanitizeFlowFilename(filename);
  if (!safe) return false;
  try {
    fs.unlinkSync(path.join(flowsDir(folderPath), safe));
    return true;
  } catch {
    return false;
  }
}

// ── Flow state ─────────────────────────────────────────────────────────────

export function loadFlowState(folderPath: string): FlowState | null {
  return readJson<FlowState>(flowStatePath(folderPath));
}

export function saveFlowState(folderPath: string, state: FlowState): void {
  writeJsonAtomic(flowStatePath(folderPath), state);
}

export function clearFlowState(folderPath: string): void {
  try {
    fs.unlinkSync(flowStatePath(folderPath));
  } catch {
    /* ignore */
  }
}

// ── Task todo ──────────────────────────────────────────────────────────────

export function readTaskTodo(folderPath: string): TaskTodo {
  return readJson<TaskTodo>(taskTodoPath(folderPath)) ?? { tasks: [] };
}

export function writeTaskTodo(folderPath: string, todo: TaskTodo): void {
  writeJsonAtomic(taskTodoPath(folderPath), todo);
}

/** Append a task entry with finish:false. Returns the array index of the
 *  new entry — the runner uses index (not id) for completion-watching to
 *  handle loop re-entries where the same node id appears multiple times. */
export function appendTaskTodo(
  folderPath: string,
  entry: TaskTodoEntry,
): number {
  const todo = readTaskTodo(folderPath);
  todo.tasks.push(entry);
  writeTaskTodo(folderPath, todo);
  return todo.tasks.length - 1;
}

export function resetTaskTodo(folderPath: string): void {
  writeTaskTodo(folderPath, { tasks: [] });
}

// ── Per-user global flow definitions ───────────────────────────────────────
// Stored at ~/.ccweb/users/<username>/flows/<name>.json. The flow definition
// itself is identical to a project-level def; only the storage location differs.
// At run time a global flow is bound to a project — relative file paths in
// {{file:rel}}, inputs/outputs, branches are still resolved against the bound
// project's folderPath.

/** Allow only safe username chars to namespace a directory. Mirrors the same
 *  conservative regex ccweb's auth layer accepts. Rejects anything that could
 *  break out of ~/.ccweb/users/ via slashes, dots, or NUL. */
function isSafeUsername(username: unknown): username is string {
  if (!username || typeof username !== 'string') return false;
  if (username.length === 0 || username.length > 64) return false;
  return /^[A-Za-z0-9_.@-]+$/.test(username) && !username.startsWith('.') && !username.startsWith('-');
}

export function globalFlowsDir(username: string): string | null {
  if (!isSafeUsername(username)) return null;
  return path.join(os.homedir(), '.ccweb', 'users', username, 'flows');
}

export function listGlobalFlowDefs(username: string): string[] {
  const dir = globalFlowsDir(username);
  if (!dir) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
      .sort();
  } catch {
    return [];
  }
}

export function loadGlobalFlowDef(username: string, filename: string): FlowDef | null {
  const dir = globalFlowsDir(username);
  if (!dir) return null;
  const safe = sanitizeFlowFilename(filename);
  if (!safe) return null;
  return readJson<FlowDef>(path.join(dir, safe));
}

export function saveGlobalFlowDef(username: string, filename: string, def: FlowDef): boolean {
  const dir = globalFlowsDir(username);
  if (!dir) return false;
  const safe = sanitizeFlowFilename(filename);
  if (!safe) return false;
  writeJsonAtomic(path.join(dir, safe), def);
  return true;
}

export function deleteGlobalFlowDef(username: string, filename: string): boolean {
  const dir = globalFlowsDir(username);
  if (!dir) return false;
  const safe = sanitizeFlowFilename(filename);
  if (!safe) return false;
  try {
    fs.unlinkSync(path.join(dir, safe));
    return true;
  } catch {
    return false;
  }
}
