/**
 * SessionManager — reads conversation history directly from the CLI's
 * native JSONL files (e.g. ~/.claude/projects/{encoded-path}/{uuid}.jsonl).
 *
 * No PTY parsing, no ANSI stripping, no heuristics. The JSONL is the single
 * source of truth; ccweb maintains no separate conversation store.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { getProject } from './config';
import { getAdapter } from './adapters';
import type { CliTool } from './types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatBlockItem {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  /** Legacy string form; always populated for backwards compat. For tool_use
   *  it's still `name(args-truncated)`. Rich renderers should prefer `tool` /
   *  `input` / `output` below when present. */
  content: string;
  /** tool_use: tool name (`Bash`, `Edit`, `TodoWrite`, …). */
  tool?: string;
  /** tool_use: structured input with deep string values capped at ~4KB to
   *  protect WS payload size.  Object shape preserved so the frontend can
   *  render tool-specific UIs (TodoWrite checklist, Edit diff, etc.). */
  input?: unknown;
  /** tool_result: full-ish text (up to ~4KB) — `content` keeps the short
   *  legacy truncation for callers that serialize to markdown fences. */
  output?: string;
}

export interface ChatBlock {
  /** Stable block id for dedup between WS replay and HTTP history. Derived
   *  from sha1(jsonlPath + source) so it's idempotent across restarts and
   *  unique per entry. Optional on older code paths; always populated by
   *  session-manager. */
  id?: string;
  role: 'user' | 'assistant';
  timestamp: string;
  blocks: ChatBlockItem[];
}

/** Generate a stable 16-hex-char id for a chat block.
 *  `source` is the original JSONL line for line-based tools (Claude/Codex),
 *  or `timestamp + JSON.stringify(blocks)` for whole-file tools (Gemini). */
function makeBlockId(jsonlPath: string, source: string): string {
  return crypto.createHash('sha1').update(jsonlPath + '\0' + source).digest('hex').slice(0, 16);
}

// ── Semantic status (derived from JSONL content blocks) ─────────────────────

export type SemanticPhase = 'thinking' | 'tool_use' | 'tool_result' | 'text';

export interface SemanticStatus {
  phase: SemanticPhase;
  detail?: string;      // e.g. tool name for tool_use
  updatedAt: number;    // epoch ms
}

// ── Per-project watcher state ─────────────────────────────────────────────────

interface WatchState {
  folderPath: string;      // project folder (for adapter.getSessionDir)
  cliTool: CliTool;        // which CLI tool this project uses
  jsonlPath: string | null; // tool's session file we're tailing
  fileOffset: number;      // bytes read so far
  startedAt: number;       // epoch ms when terminal started
  retryChainActive?: boolean; // true while a jsonl-discovery retry chain is in flight
}

// ── SessionManager ────────────────────────────────────────────────────────────

class SessionManager extends EventEmitter {
  private watchers = new Map<string, WatchState>();
  private chatListeners = new Map<string, Set<(msg: ChatBlock) => void>>();
  private semanticStatus = new Map<string, SemanticStatus>();

  constructor() {
    super();
  }

  getSemanticStatus(projectId: string): SemanticStatus | null {
    return this.semanticStatus.get(projectId) ?? null;
  }

  getAllSemanticStatus(): Record<string, SemanticStatus> {
    const result: Record<string, SemanticStatus> = {};
    for (const [id, status] of this.semanticStatus) {
      result[id] = status;
    }
    return result;
  }

  /** Return the JSONL file path currently being tailed for this project. */
  getJsonlPath(projectId: string): string | null {
    return this.watchers.get(projectId)?.jsonlPath ?? null;
  }

  /** Return all parsed ChatBlocks from the project's latest JSONL file.
   *
   *  Resolution order:
   *    1. Active watcher already has `jsonlPath` discovered via hooks → use it.
   *    2. Watcher exists but hasn't discovered the file yet → lazily scan the
   *       adapter's session dir, pick the latest JSONL, cache on the watcher.
   *    3. No watcher (stopped project, user just navigated in) → resolve
   *       project config on-the-fly and pick the latest JSONL. Do NOT
   *       persist to `this.watchers` because a watcher without a PTY
   *       would drift (no hooks, no triggerRead).
   *
   *  This indirection exists because chat history has to be loadable without
   *  a hook ever firing (e.g. immediately after ccweb restart — triggerRead
   *  only runs when Claude Code's hooks call `/api/hooks`).
   */
  getChatHistory(projectId: string): ChatBlock[] {
    const state = this.watchers.get(projectId);

    if (state) {
      if (!state.jsonlPath) {
        state.jsonlPath = this.findLatestJsonlForProject(state.folderPath, state.cliTool);
      }
      if (!state.jsonlPath) return [];
      return this.parseJsonlFile(state.jsonlPath, state.cliTool);
    }

    // No active watcher — fall back to project config for stopped projects
    const project = getProject(projectId);
    if (!project) {
      console.warn(`[SessionManager] getChatHistory(${projectId}): project not in registry`);
      return [];
    }
    const cliTool = project.cliTool ?? 'claude';
    const jsonlPath = this.findLatestJsonlForProject(project.folderPath, cliTool);
    if (!jsonlPath) {
      console.warn(`[SessionManager] getChatHistory(${projectId}): no JSONL found for ${project.folderPath} (${cliTool})`);
      return [];
    }
    return this.parseJsonlFile(jsonlPath, cliTool);
  }

  /** Parse a JSONL/JSON session file into ChatBlocks with stable ids. */
  private parseJsonlFile(jsonlPath: string, cliTool: CliTool): ChatBlock[] {
    const adapter = getAdapter(cliTool);
    try {
      const content = fs.readFileSync(jsonlPath, 'utf-8');

      // Whole-file JSON tools (e.g. Gemini): parse entire file at once
      if (typeof adapter.parseSessionFile === 'function') {
        const blocks = adapter.parseSessionFile(content);
        return blocks.map((b) => ({
          ...b,
          id: b.id ?? makeBlockId(jsonlPath, b.timestamp + '|' + JSON.stringify(b.blocks)),
        }));
      }

      // JSONL tools (Claude, Codex): parse line by line
      const lines = content.split('\n').filter((l) => l.trim());
      const blocks: ChatBlock[] = [];
      for (const line of lines) {
        const block = adapter.parseLineBlocks(line);
        if (block) blocks.push({ ...block, id: makeBlockId(jsonlPath, line) });
      }
      return blocks;
    } catch {
      return [];
    }
  }

  /** Find the latest JSONL file for a project (single source of truth for
   *  both chat-history HTTP and hook-driven tail paths).
   *
   *  Strategy: pick the newest file (by mtime) in the adapter's session dir.
   *  For adapters that store sessions in a shared tree (e.g. Codex's
   *  date-partitioned dir), use `getSessionFilesForProject` to scope by cwd.
   *
   *  Deliberately has NO startedAt/recency filter — historical requirement
   *  was for "the file THIS session is writing", but that caused HTTP and
   *  WS paths to disagree on which file to read, breaking block-id dedup.
   *  Using "newest" works because Claude --continue updates the mtime of
   *  the continued file, and any new file it creates has the highest mtime.
   *  The caller (triggerRead) handles mid-session file switches by re-
   *  checking on each call.
   */
  private findLatestJsonlForProject(folderPath: string, cliTool: CliTool): string | null {
    const adapter = getAdapter(cliTool);

    if (typeof adapter.getSessionFilesForProject === 'function') {
      const files = adapter.getSessionFilesForProject(folderPath);
      if (files.length === 0) return null;
      try {
        return files
          .map((f) => ({ f, mtime: fs.statSync(f).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime)[0].f;
      } catch { return null; }
    }

    const dir = adapter.getSessionDir(folderPath);
    if (!dir || !fs.existsSync(dir)) return null;
    const ext = typeof adapter.getSessionFileExtension === 'function'
      ? adapter.getSessionFileExtension()
      : '.jsonl';
    try {
      const files = fs.readdirSync(dir)
        .filter((f) => f.endsWith(ext))
        .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      return files.length > 0 ? path.join(dir, files[0].f) : null;
    } catch {
      return null;
    }
  }

  registerChatListener(projectId: string, cb: (msg: ChatBlock) => void): void {
    if (!this.chatListeners.has(projectId)) this.chatListeners.set(projectId, new Set());
    this.chatListeners.get(projectId)!.add(cb);
  }

  unregisterChatListener(projectId: string, cb: (msg: ChatBlock) => void): void {
    const listeners = this.chatListeners.get(projectId);
    if (!listeners) return;
    listeners.delete(cb);
    if (listeners.size === 0) this.chatListeners.delete(projectId);
  }

  /** Call when a new PTY starts for a project. Registers a watcher so that
   *  subsequent hook-driven `triggerRead()` calls can tail the JSONL. */
  startSession(projectId: string, folderPath: string, cliTool: CliTool = 'claude'): void {
    this.stopWatcher(projectId);
    this.watchers.set(projectId, {
      folderPath,
      cliTool,
      jsonlPath: null,
      fileOffset: 0,
      startedAt: Date.now(),
    });
    console.log(`[SessionManager] Started watcher for project ${projectId}`);
  }

  /** Stop the session poller for a project (public for cleanup on terminal stop) */
  stopWatcherForProject(projectId: string): void {
    this.stopWatcher(projectId);
  }

  private stopWatcher(projectId: string): void {
    this.watchers.delete(projectId);
    this.semanticStatus.delete(projectId);
  }

  /** Called by hooks route on PreToolUse.
   *  Updates semantic status directly from env var — does NOT read JSONL
   *  (JSONL has not been written yet at this point). */
  handleHookPreTool(projectId: string, toolName: string): void {
    const newStatus: SemanticStatus = {
      phase: 'tool_use',
      detail: toolName || undefined,
      updatedAt: Date.now(),
    };
    this.semanticStatus.set(projectId, newStatus);
    this.emit('semantic', { projectId, status: newStatus });
  }

  /** Called by hooks route on PostToolUse/Stop. Discovers the latest JSONL
   *  file if not already cached, detects mid-session file switches (e.g.
   *  Claude --continue creating a fresh JSONL), then reads new content and
   *  emits block events to chat listeners. */
  triggerRead(projectId: string): void {
    const state = this.watchers.get(projectId);
    if (!state) return;

    // Re-check latest file each call: shares the single `findLatestJsonlForProject`
    // path with getChatHistory so HTTP and WS paths always agree on which file
    // is authoritative (→ consistent block ids → frontend dedup works).
    const latest = this.findLatestJsonlForProject(state.folderPath, state.cliTool);
    if (latest && latest !== state.jsonlPath) {
      state.jsonlPath = latest;
      state.fileOffset = 0;
    }

    if (!state.jsonlPath) {
      // Brand-new project or session dir not yet created — retry a few times.
      // Use `retryChainActive` only to avoid stacking MULTIPLE identical
      // findLatestJsonlForProject() disk scans when Stop hook's 300ms/1500ms
      // re-trigger chain arrives while the first retry chain hasn't finished.
      // Unlike the prior `state.retrying` guard, this does NOT short-circuit
      // a triggerRead that arrives AFTER jsonlPath is resolved — the check
      // above at line 264 handles that case synchronously.
      if (state.retryChainActive) return;
      state.retryChainActive = true;
      const delays = [500, 1000, 2000];
      const retry = (attempt: number) => {
        setTimeout(() => {
          const s = this.watchers.get(projectId);
          if (!s) return;
          if (s.jsonlPath) { s.retryChainActive = false; return; } // resolved by a concurrent trigger
          const later = this.findLatestJsonlForProject(s.folderPath, s.cliTool);
          if (later) {
            s.jsonlPath = later;
            s.fileOffset = 0;
            s.retryChainActive = false;
            this.readNewLines(projectId, s);
          } else if (attempt + 1 < delays.length) {
            retry(attempt + 1);
          } else {
            s.retryChainActive = false;
            console.warn(`[SessionManager] JSONL file not found for project ${projectId} after ${delays.length} retries — chat history unavailable`);
          }
        }, delays[attempt]);
      };
      retry(0);
      return;
    }
    this.readNewLines(projectId, state);
  }

  /** Called by hooks route on Stop — clears semantic status before reading final text. */
  clearSemanticStatus(projectId: string): void {
    if (!this.semanticStatus.has(projectId)) return;
    this.semanticStatus.delete(projectId);
    this.emit('semantic', { projectId, status: null });
  }

  /** Read new data from the session file and extract messages */
  private readNewLines(projectId: string, state: WatchState): void {
    if (!state.jsonlPath) return;

    const adapter = getAdapter(state.cliTool);

    // Whole-file JSON tools (e.g. Gemini): re-read entire file on each trigger
    if (typeof adapter.parseSessionFile === 'function') {
      this.readWholeFileSession(projectId, state, adapter);
      return;
    }

    // JSONL tools (Claude, Codex): incremental line-by-line reading
    this.readJsonlIncremental(projectId, state, adapter);
  }

  /** Read whole-file JSON session (Gemini etc.) — re-parse on each trigger, diff against last known state */
  private readWholeFileSession(projectId: string, state: WatchState, adapter: ReturnType<typeof getAdapter>): void {
    try {
      const stat = fs.statSync(state.jsonlPath!);
      if (stat.size <= state.fileOffset) return; // nothing new
      state.fileOffset = stat.size;

      const content = fs.readFileSync(state.jsonlPath!, 'utf-8');
      const blocks = adapter.parseSessionFile!(content);
      if (blocks.length === 0) return;

      // Emit latest blocks to chat listeners + update semantic status
      for (const block of blocks) {
        const blockWithId: ChatBlock = {
          ...block,
          id: block.id ?? makeBlockId(state.jsonlPath!, block.timestamp + '|' + JSON.stringify(block.blocks)),
        };
        if (blockWithId.role === 'assistant' && blockWithId.blocks.length > 0) {
          const lastBlock = blockWithId.blocks[blockWithId.blocks.length - 1];
          const detail = lastBlock.type === 'tool_use' ? lastBlock.content.split('(')[0] : undefined;
          const newStatus: SemanticStatus = { phase: lastBlock.type, detail, updatedAt: Date.now() };
          this.semanticStatus.set(projectId, newStatus);
          this.emit('semantic', { projectId, status: newStatus });
        }
        const listeners = this.chatListeners.get(projectId);
        if (listeners) {
          for (const cb of listeners) {
            try { cb(blockWithId); } catch { /**/ }
          }
        }
      }
    } catch {
      // file may be temporarily locked or missing
    }
  }

  /** Incremental JSONL reading (Claude, Codex) */
  private readJsonlIncremental(projectId: string, state: WatchState, adapter: ReturnType<typeof getAdapter>): void {
    let fd: number | null = null;
    try {
      const stat = fs.statSync(state.jsonlPath!);
      if (stat.size <= state.fileOffset) return; // nothing new

      fd = fs.openSync(state.jsonlPath!, 'r');
      const toRead = stat.size - state.fileOffset;
      const buf = Buffer.alloc(toRead);
      fs.readSync(fd, buf, 0, toRead, state.fileOffset);
      state.fileOffset = stat.size;

      const lines = buf.toString('utf-8').split('\n').filter((l) => l.trim());

      // Emit to chat listeners + update semantic status
      for (const line of lines) {
        const parsed = adapter.parseLineBlocks(line);
        if (parsed) {
          const block: ChatBlock = { ...parsed, id: makeBlockId(state.jsonlPath!, line) };
          if (block.role === 'assistant' && block.blocks.length > 0) {
            const lastBlock = block.blocks[block.blocks.length - 1];
            const detail = lastBlock.type === 'tool_use'
              ? lastBlock.content.split('(')[0]
              : undefined;
            const newStatus: SemanticStatus = {
              phase: lastBlock.type,
              detail,
              updatedAt: Date.now(),
            };
            this.semanticStatus.set(projectId, newStatus);
            this.emit('semantic', { projectId, status: newStatus });
          }
          const listeners = this.chatListeners.get(projectId);
          if (listeners) {
            for (const cb of listeners) {
              try { cb(block); } catch { /**/ }
            }
          }
        }
      }

    } catch {
      // file may be temporarily locked or missing — try again next poll
    } finally {
      if (fd !== null) try { fs.closeSync(fd); } catch { /**/ }
    }
  }

}

export const sessionManager = new SessionManager();
