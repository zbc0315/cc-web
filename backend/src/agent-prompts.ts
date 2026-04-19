/**
 * Agent Prompts — storage + CLAUDE.md insert/remove helpers.
 *
 * Two scopes:
 *   - Global: ~/.ccweb/agent-prompts[-<username>].json (per-user isolation,
 *     same pattern as global-shortcuts-<user>.json)
 *   - Project: {projectFolder}/.ccweb/agent-prompts.json
 *
 * CLAUDE.md operations are always targeted at a specific project folder and
 * are decoupled from prompt storage — the frontend passes the raw prompt text
 * to /toggle, so insertion/removal doesn't care whether the text originated
 * from a global or project prompt.
 *
 * Line-ending normalisation: file content is normalised to LF on read, and
 * written back with LF. This avoids \r\n-vs-\n mismatches silently breaking
 * the "exact text match" contract when a file has been edited on Windows.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { atomicWriteSync, isAdminUser, ccwebDir, DATA_DIR } from './config';
import { AgentPrompt } from './types';

const CLAUDE_MD = 'CLAUDE.md';
const PROJECT_PROMPTS_FILE = 'agent-prompts.json';

// ── Global prompts (per user) ────────────────────────────────────────────────

function globalPromptsFile(username?: string): string {
  if (!username || isAdminUser(username)) {
    return path.join(DATA_DIR, 'agent-prompts.json');
  }
  const safe = username.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DATA_DIR, `agent-prompts-${safe}.json`);
}

export function readGlobalPrompts(username?: string): AgentPrompt[] {
  const file = globalPromptsFile(username);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(parsed) ? parsed as AgentPrompt[] : [];
  } catch (err) {
    console.warn(`[agent-prompts] Failed to parse ${file}:`, err);
    return [];
  }
}

export function writeGlobalPrompts(list: AgentPrompt[], username?: string): void {
  const file = globalPromptsFile(username);
  atomicWriteSync(file, JSON.stringify(list, null, 2));
}

// ── Project prompts ──────────────────────────────────────────────────────────

function projectPromptsFile(folderPath: string): string {
  return path.join(ccwebDir(folderPath), PROJECT_PROMPTS_FILE);
}

export function readProjectPrompts(folderPath: string): AgentPrompt[] {
  const file = projectPromptsFile(folderPath);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(parsed) ? parsed as AgentPrompt[] : [];
  } catch (err) {
    console.warn(`[agent-prompts] Failed to parse ${file}:`, err);
    return [];
  }
}

export function writeProjectPrompts(folderPath: string, list: AgentPrompt[]): void {
  const dir = ccwebDir(folderPath);
  fs.mkdirSync(dir, { recursive: true });
  atomicWriteSync(path.join(dir, PROJECT_PROMPTS_FILE), JSON.stringify(list, null, 2));
}

// ── CLAUDE.md operations ─────────────────────────────────────────────────────

function claudeMdPath(folderPath: string): string {
  return path.join(folderPath, CLAUDE_MD);
}

/** Read CLAUDE.md, normalising CRLF → LF. Returns empty string if the file
 *  doesn't exist (treated as "no content yet"). */
export function readClaudeMd(folderPath: string): string {
  const file = claudeMdPath(folderPath);
  if (!fs.existsSync(file)) return '';
  const raw = fs.readFileSync(file, 'utf-8');
  return raw.replace(/\r\n/g, '\n');
}

export function writeClaudeMd(folderPath: string, content: string): void {
  const file = claudeMdPath(folderPath);
  atomicWriteSync(file, content);
}

/** Exact substring check (after LF normalisation). */
export function isInserted(claudeMd: string, command: string): boolean {
  return claudeMd.includes(command);
}

/**
 * Append the command to CLAUDE.md separated by a blank line. Idempotent:
 * if the exact text already appears anywhere in the file, no changes are made.
 *
 * Returns { changed: true } if the file was written, { changed: false } if
 * the text was already present.
 */
export function insertIntoClaudeMd(
  folderPath: string,
  command: string,
): { changed: boolean } {
  const current = readClaudeMd(folderPath);
  if (current.includes(command)) return { changed: false };

  // Ensure a blank-line separator between prior content and the new block.
  let next: string;
  if (current.length === 0) {
    next = command + '\n';
  } else {
    const needsTrailingNewline = !current.endsWith('\n');
    const leader = needsTrailingNewline ? '\n\n' : '\n';
    next = current + leader + command + '\n';
  }
  writeClaudeMd(folderPath, next);
  return { changed: true };
}

/**
 * Remove the command from CLAUDE.md via exact text match. Attempts two
 * patterns in order:
 *   1. '\n\n' + command + '\n'   — the exact form we insert
 *   2. command                    — plain match anywhere (covers manual-insert
 *                                    variants)
 * If neither matches, returns { changed: false, reason: 'not-found' } so the
 * caller can surface a "please delete manually" prompt to the user.
 *
 * Returns { changed: false, reason: 'not-present' } if the text simply isn't
 * in the file (e.g. already removed / never inserted) — distinguishable from
 * 'not-found' by callers that want to stay silent in that case.
 */
export function removeFromClaudeMd(
  folderPath: string,
  command: string,
):
  | { changed: true; removed: 1 }
  | { changed: false; reason: 'not-found' | 'not-present' } {
  const current = readClaudeMd(folderPath);
  if (current.length === 0 || !current.includes(command)) {
    return { changed: false, reason: 'not-present' };
  }

  // Try the inserted pattern first.
  const anchored = '\n\n' + command + '\n';
  if (current.includes(anchored)) {
    const next = current.replace(anchored, '');
    writeClaudeMd(folderPath, next);
    return { changed: true, removed: 1 };
  }

  // Also try the single-newline form, in case the user edited surrounding
  // whitespace or the block was at the start of the file.
  const half = '\n\n' + command;
  if (current.endsWith(half)) {
    const next = current.slice(0, -half.length) + '\n';
    writeClaudeMd(folderPath, next);
    return { changed: true, removed: 1 };
  }

  // Exact substring fallback — may leave orphaned blank lines, which the
  // user accepted as the cost of "exact text match" semantics.
  if (current.includes(command)) {
    const next = current.replace(command, '');
    writeClaudeMd(folderPath, next);
    return { changed: true, removed: 1 };
  }

  return { changed: false, reason: 'not-found' };
}

// ── Shape helpers ────────────────────────────────────────────────────────────

/** Attach `inserted: boolean` to each prompt based on a claudeMd snapshot. */
export function annotateInserted(
  prompts: AgentPrompt[],
  claudeMd: string,
): Array<AgentPrompt & { inserted: boolean }> {
  return prompts.map((p) => ({ ...p, inserted: claudeMd.includes(p.command) }));
}

/** Validate label + command payload; returns null on success or an error message. */
export function validatePromptInput(
  body: Partial<AgentPrompt>,
): { label: string; command: string } | string {
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const command = typeof body.command === 'string' ? body.command : '';
  if (!label) return 'label is required';
  if (label.length > 100) return 'label must be ≤100 characters';
  if (!command.trim()) return 'command is required';
  if (command.length > 8000) return 'command must be ≤8000 characters';
  return { label, command };
}

// Re-export for route handler convenience
export { claudeMdPath };

// Suppress unused-import warning when `os` is only conditionally referenced in
// future extensions (kept imported for parity with other helper modules).
void os;
