import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FlowDef, FlowState, WorkflowData } from './types';
import { WORKFLOW_DATA_PATH } from './types';

/**
 * Path conventions and CRUD for the flow JSON files (schemaVersion 2).
 *
 *  - <project>/.ccweb/flows/<name>.json    flow definitions
 *  - <project>/.ccweb/workflow_data.json   unified data (constants + variables + task_progress)
 *  - <project>/.ccweb/flow_state.json      runtime status (runner-only)
 *
 *  + ~/.ccweb/users/<username>/flows/<name>.json   per-user global flow templates
 */

function ccwebDir(folderPath: string): string {
  return path.join(folderPath, '.ccweb');
}

export function flowsDir(folderPath: string): string {
  return path.join(ccwebDir(folderPath), 'flows');
}

export function workflowDataPath(folderPath: string): string {
  return path.join(folderPath, WORKFLOW_DATA_PATH);
}

export function flowStatePath(folderPath: string): string {
  return path.join(ccwebDir(folderPath), 'flow_state.json');
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

// ── workflow_data.json ─────────────────────────────────────────────────────

/** Read the unified data file, returning a fresh empty shape on miss/parse
 *  error. Callers should never see null — partial corruption recovers to the
 *  zero state rather than crashing the runner mid-flight. */
export function readWorkflowData(folderPath: string): WorkflowData {
  const data = readJson<WorkflowData>(workflowDataPath(folderPath));
  if (!data || typeof data !== 'object') {
    return { constants: {}, variables: {}, task_progress: [] };
  }
  return {
    constants: data.constants && typeof data.constants === 'object' ? data.constants : {},
    variables: data.variables && typeof data.variables === 'object' ? data.variables : {},
    task_progress: Array.isArray(data.task_progress) ? data.task_progress : [],
  };
}

export function writeWorkflowData(folderPath: string, data: WorkflowData): void {
  writeJsonAtomic(workflowDataPath(folderPath), data);
}

/** Initialize workflow_data at flow start:
 *  - constants ← FlowDef.constants (overwrites; constants are immutable per run)
 *  - variables ← FlowDef.variables[].initialValue where present (others left
 *    undefined / missing); preserves any pre-existing variable keys not
 *    declared in this flow (defensive — shouldn't happen in practice but
 *    avoids data loss if a partial def reload races with persistence)
 *  - task_progress ← [] (reset for new run)
 */
export function initWorkflowData(folderPath: string, def: FlowDef): WorkflowData {
  const existing = readWorkflowData(folderPath);
  const constants: Record<string, unknown> = {};
  for (const c of def.constants ?? []) {
    constants[c.name] = c.value;
  }
  const variables: Record<string, unknown> = { ...existing.variables };
  for (const v of def.variables ?? []) {
    if (v.initialValue !== undefined) {
      variables[v.name] = v.initialValue;
    }
  }
  const next: WorkflowData = { constants, variables, task_progress: [] };
  writeWorkflowData(folderPath, next);
  return next;
}

/** Append a task progress entry, return its index. Used by runner for LLM
 *  nodes — the LLM signals completion by flipping `task_progress[index].finish`
 *  to true via Edit/Write. */
export function appendTaskProgress(
  folderPath: string,
  entry: Omit<import('./types').TaskProgressEntry, 'startedAt'> & { startedAt?: number },
): number {
  const data = readWorkflowData(folderPath);
  data.task_progress.push({
    ...entry,
    startedAt: entry.startedAt ?? Date.now(),
  });
  writeWorkflowData(folderPath, data);
  return data.task_progress.length - 1;
}

// ── Per-user global flow definitions ───────────────────────────────────────
// Stored at ~/.ccweb/users/<username>/flows/<name>.json. The flow definition
// itself is identical to a project-level def; only the storage location differs.
// At run time a global flow is bound to a project — relative-path concepts
// no longer exist in v2, so the only project-scoped resource is the project's
// own workflow_data.json which the running flow reads/writes.

/** Allow only safe username chars to namespace a directory. */
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
