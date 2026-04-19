import * as fs from 'fs';
import * as path from 'path';
import { readClaudeMd, writeClaudeMd } from './agent-prompts';

/**
 * Memory Prompts — filesystem-backed prompt snippets located at
 * `<project>/.ccweb/memory/*.md`, toggleable into CLAUDE.md with
 * `START <name>` / `END <name>` markers (bare-text, one per line) surrounding
 * the inserted body.
 *
 * Design deltas from Agent Prompts:
 * - Content source is the filesystem (the user maintains the md files
 *   externally); no in-app editor, no share, no delete.
 * - Inserted block is bracket-marked by filename, so the remove path is
 *   deterministic (no "try three text-match levels" fallback).
 * - Only one copy of each memory block can be inserted at a time — a second
 *   insert is idempotent (refreshes in place rather than appending twice).
 */

export interface MemoryPromptItem {
  filename: string;   // "my-memory.md"
  name: string;       // "my-memory" (filename without .md)
  preview: string;    // first non-empty line, trimmed, up to ~200 chars
  inserted: boolean;  // whether a START <name> / END <name> block exists in CLAUDE.md
}

function memoryDir(folderPath: string): string {
  return path.join(folderPath, '.ccweb', 'memory');
}

/** The START/END markers are emitted as plain-text lines — the user asked
 *  for this exact format so they remain easily searchable in CLAUDE.md. */
function markerStart(name: string): string { return `START ${name}`; }
function markerEnd(name: string): string { return `END ${name}`; }

/** Escape user-supplied memory name for use inside a RegExp. */
function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex matching one complete `START <name>\n<body>\nEND <name>` block,
 *  including any immediately surrounding blank lines, so removal collapses
 *  the space cleanly. */
function blockRegex(name: string): RegExp {
  const n = reEscape(name);
  // Eats: optional leading \n+, START <name> line, any body (non-greedy),
  //       END <name> line, optional trailing \n+.
  return new RegExp(`\\n*^START ${n}$[\\s\\S]*?^END ${n}$\\n*`, 'm');
}

function previewOf(content: string): string {
  const line = content.split('\n').find((l) => l.trim()) ?? '';
  return line.trim().slice(0, 200);
}

// ── Listing ─────────────────────────────────────────────────────────────────

export function listMemoryPrompts(folderPath: string): MemoryPromptItem[] {
  const dir = memoryDir(folderPath);
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return []; // dir missing is normal
  }
  const claudeMd = readClaudeMd(folderPath);
  const out: MemoryPromptItem[] = [];
  for (const filename of files) {
    const name = filename.replace(/\.md$/, '');
    const filePath = path.join(dir, filename);
    // Skip symlinks to protect against a file in memory/ pointing at /etc etc.
    let stat: fs.Stats | undefined;
    try { stat = fs.lstatSync(filePath); } catch { continue; }
    if (!stat || !stat.isFile()) continue;
    let preview = '';
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      preview = previewOf(content);
    } catch { /* unreadable — still list it with empty preview */ }
    const inserted = blockRegex(name).test(claudeMd);
    out.push({ filename, name, preview, inserted });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ── Toggle ──────────────────────────────────────────────────────────────────

export type ToggleAction = 'insert' | 'remove';

export interface ToggleResult {
  ok: boolean;
  changed: boolean;
  inserted: boolean;   // final state
  reason?: string;
}

export function toggleMemoryPrompt(
  folderPath: string,
  filename: string,
  action: ToggleAction,
): ToggleResult {
  // Guard filename — reject anything that could escape memory/ via the name.
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
    return { ok: false, changed: false, inserted: false, reason: 'invalid-filename' };
  }
  if (!filename.endsWith('.md')) {
    return { ok: false, changed: false, inserted: false, reason: 'not-md' };
  }
  const name = filename.replace(/\.md$/, '');
  const filePath = path.join(memoryDir(folderPath), filename);

  let claudeMd = readClaudeMd(folderPath);
  const re = blockRegex(name);
  const currentlyInserted = re.test(claudeMd);

  if (action === 'remove') {
    if (!currentlyInserted) {
      return { ok: true, changed: false, inserted: false, reason: 'not-present' };
    }
    claudeMd = claudeMd.replace(re, '\n\n');
    // Collapse any runs of 3+ blank lines left behind into 2
    claudeMd = claudeMd.replace(/\n{3,}/g, '\n\n');
    writeClaudeMd(folderPath, claudeMd);
    return { ok: true, changed: true, inserted: false };
  }

  // Insert (or refresh in place).  Symlink guard mirrors `listMemoryPrompts`
  // so a client can't bypass the list's lstat filter by posting a filename
  // not currently in the list — e.g. an attacker placing `evil.md → /etc/...`
  // and toggling it directly would otherwise leak the target into CLAUDE.md.
  let stat: fs.Stats | undefined;
  try { stat = fs.lstatSync(filePath); } catch {
    return { ok: false, changed: false, inserted: false, reason: 'file-not-found' };
  }
  if (!stat.isFile()) {
    return { ok: false, changed: false, inserted: false, reason: 'not-regular-file' };
  }
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { ok: false, changed: false, inserted: false, reason: 'file-not-found' };
  }
  // Normalize leading + trailing newlines so START/END aren't visually
  // glued to whatever the body happens to start/end with, and emit a blank
  // line BETWEEN the marker and the body on both sides — user-requested
  // format: START and END each stand alone, separated from surrounding
  // content (and from the body) by an empty line.
  const body = content.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
  const block = `${markerStart(name)}\n\n${body}\n\n${markerEnd(name)}`;

  if (currentlyInserted) {
    // Refresh: replace existing block with fresh content (content file may
    // have been edited since last insert).
    claudeMd = claudeMd.replace(re, `\n\n${block}\n\n`);
    claudeMd = claudeMd.replace(/\n{3,}/g, '\n\n');
    writeClaudeMd(folderPath, claudeMd);
    return { ok: true, changed: true, inserted: true, reason: 'refreshed' };
  }

  // Append with separating blank line if CLAUDE.md doesn't already end with one
  const sep = claudeMd.length === 0 ? '' : claudeMd.endsWith('\n\n') ? '' : claudeMd.endsWith('\n') ? '\n' : '\n\n';
  claudeMd = claudeMd + sep + block + '\n';
  writeClaudeMd(folderPath, claudeMd);
  return { ok: true, changed: true, inserted: true };
}
