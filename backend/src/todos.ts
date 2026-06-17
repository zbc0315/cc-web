import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { DATA_DIR, atomicWriteSync } from './config';
import { modLogger } from './logger';

const log = modLogger('todos');

/**
 * Per-user, per-project hierarchical TODO store. One file per user (sha1 of the
 * username, like dev-time / sync-state), holding a flat todo array per project
 * id; hierarchy is derived from each todo's `parentId`.
 *
 *   <DATA_DIR>/todos/<sha1(username)>.json
 *   { "<projectId>": Todo[], ... }
 *
 * The project "blocks" themselves are NOT persisted — the route derives one
 * block per project at read time, so new and existing projects automatically
 * get a (possibly empty) todo block with no project-creation coupling.
 */

export type TodoStatus = 'todo' | 'doing' | 'done';
const VALID_STATUS: TodoStatus[] = ['todo', 'doing', 'done'];

export interface Todo {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  description: string;          // markdown
  status: TodoStatus;
  plannedDate: string | null;   // YYYY-MM-DD
  actualDate: string | null;    // YYYY-MM-DD
  createdAt: string;            // ISO
  updatedAt: string;            // ISO
}

export interface TodoInput {
  projectId: string;
  parentId?: string | null;
  title: string;
  description?: string;
  status?: TodoStatus;
  plannedDate?: string | null;
  actualDate?: string | null;
}

// Only these fields are patchable — notably NOT parentId, so nodes can't be
// re-parented (or moved cross-project) through PUT.
export type TodoPatch = Partial<Pick<Todo, 'title' | 'description' | 'status' | 'plannedDate' | 'actualDate'>>;

type UserTodos = Record<string, Todo[]>;

const DIR = path.join(DATA_DIR, 'todos');
const MAX_TITLE = 500;
const MAX_DESC = 20000;

function ensureDir(): void {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
}

function userFile(username: string): string {
  const hash = crypto.createHash('sha1').update(`ccweb-todos-user:${username}`).digest('hex');
  return path.join(DIR, `${hash}.json`);
}

function read(username: string): UserTodos {
  ensureDir();
  const file = userFile(username);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as UserTodos;
  } catch {
    return {};
  }
}

function write(username: string, data: UserTodos): void {
  ensureDir();
  atomicWriteSync(userFile(username), JSON.stringify(data));
  try { fs.chmodSync(userFile(username), 0o600); } catch { /* ignore */ }
}

function nowIso(): string {
  return new Date().toISOString();
}

function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Accept a YYYY-MM-DD string, else null (covers empty / bad / non-string). */
function normDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function normTitle(v: unknown): string {
  const s = (typeof v === 'string' ? v : '').trim().slice(0, MAX_TITLE);
  return s || '(untitled)';
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getAllTodos(username: string): UserTodos {
  return read(username);
}

export function createTodo(username: string, input: TodoInput): Todo {
  const data = read(username);
  const list = data[input.projectId] ?? (data[input.projectId] = []);
  const parentId = input.parentId ?? null;
  if (parentId && !list.some((t) => t.id === parentId)) throw new Error('BAD_PARENT');

  const now = nowIso();
  const todo: Todo = {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    parentId,
    title: normTitle(input.title),
    description: (typeof input.description === 'string' ? input.description : '').slice(0, MAX_DESC),
    status: VALID_STATUS.includes(input.status as TodoStatus) ? (input.status as TodoStatus) : 'todo',
    plannedDate: normDate(input.plannedDate),
    actualDate: normDate(input.actualDate),
    createdAt: now,
    updatedAt: now,
  };
  // Convenience: marking done with no explicit actual date stamps today.
  if (todo.status === 'done' && !todo.actualDate) todo.actualDate = localDate();

  list.push(todo);
  write(username, data);
  return todo;
}

export function updateTodo(username: string, projectId: string, id: string, patch: TodoPatch): Todo | null {
  const data = read(username);
  const list = data[projectId];
  if (!list) return null;
  const t = list.find((x) => x.id === id);
  if (!t) return null;

  if (patch.title !== undefined) t.title = normTitle(patch.title);
  if (patch.description !== undefined) {
    t.description = (typeof patch.description === 'string' ? patch.description : '').slice(0, MAX_DESC);
  }
  if (patch.status !== undefined && VALID_STATUS.includes(patch.status)) {
    t.status = patch.status;
    // Keep actualDate consistent with "done": stamp today on completion, clear
    // it when leaving done — unless the caller set actualDate explicitly.
    if (patch.actualDate === undefined) {
      if (t.status === 'done') { if (!t.actualDate) t.actualDate = localDate(); }
      else t.actualDate = null;
    }
  }
  if (patch.plannedDate !== undefined) t.plannedDate = normDate(patch.plannedDate);
  if (patch.actualDate !== undefined) t.actualDate = normDate(patch.actualDate);
  t.updatedAt = nowIso();

  write(username, data);
  return t;
}

/** Delete a todo and all of its descendants. Returns true if anything removed. */
export function deleteTodo(username: string, projectId: string, id: string): boolean {
  const data = read(username);
  const list = data[projectId];
  if (!list) return false;

  const remove = new Set<string>([id]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of list) {
      if (t.parentId && remove.has(t.parentId) && !remove.has(t.id)) { remove.add(t.id); changed = true; }
    }
  }
  const next = list.filter((t) => !remove.has(t.id));
  if (next.length === list.length) return false;
  data[projectId] = next;
  write(username, data);
  log.info({ projectId, removed: remove.size }, 'deleted todo subtree');
  return true;
}
