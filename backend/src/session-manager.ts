/**
 * SessionManager — reads conversation history directly from Claude Code's
 * native JSONL files at ~/.claude/projects/{encoded-path}/{sessionId}.jsonl
 *
 * No PTY parsing, no ANSI stripping, no heuristics needed.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { DATA_DIR, ccwebSessionsDir, getProject } from './config';
import { getAdapter } from './adapters';
import type { CliTool } from './types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface Session {
  id: string;
  projectId: string;
  startedAt: string;
  messages: SessionMessage[];
}

// JSONL record types moved to adapters/claude-adapter.ts

export interface ChatBlockItem {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  content: string;
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

// ── Path helpers ─────────────────────────────────────────────────────────────

const LEGACY_SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

/** New location: {folderPath}/.ccweb/sessions/ */
function projectSessionsDir(folderPath: string): string {
  return ccwebSessionsDir(folderPath);
}

function projectSessionFile(folderPath: string, sessionId: string): string {
  return path.join(projectSessionsDir(folderPath), `${sessionId}.json`);
}

/** Legacy location: data/sessions/{projectId}/ */
function legacySessionsDir(projectId: string): string {
  return path.join(LEGACY_SESSIONS_DIR, projectId);
}

function legacySessionFile(projectId: string, sessionId: string): string {
  return path.join(legacySessionsDir(projectId), `${sessionId}.json`);
}

// ── Per-project watcher state ─────────────────────────────────────────────────

interface WatchState {
  sessionId: string;       // our session ID
  folderPath: string;      // project folder (for .ccweb/ storage)
  cliTool: CliTool;        // which CLI tool this project uses
  jsonlPath: string | null; // tool's session file we're tailing
  fileOffset: number;      // bytes read so far
  startedAt: number;       // epoch ms when terminal started
  retrying?: boolean;      // true while a retry chain is in-flight
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

  /** Return all parsed ChatBlocks from the current session file (for replay on chat_subscribe). */
  getChatHistory(projectId: string): ChatBlock[] {
    const state = this.watchers.get(projectId);
    if (!state?.jsonlPath) return [];

    const adapter = getAdapter(state.cliTool);
    try {
      const content = fs.readFileSync(state.jsonlPath, 'utf-8');

      // Whole-file JSON tools (e.g. Gemini): parse entire file at once
      if (typeof adapter.parseSessionFile === 'function') {
        const blocks = adapter.parseSessionFile(content);
        return blocks.map((b) => ({
          ...b,
          id: b.id ?? makeBlockId(state.jsonlPath!, b.timestamp + '|' + JSON.stringify(b.blocks)),
        }));
      }

      // JSONL tools (Claude, Codex): parse line by line
      const lines = content.split('\n').filter((l) => l.trim());
      const blocks: ChatBlock[] = [];
      for (const line of lines) {
        const block = adapter.parseLineBlocks(line);
        if (block) blocks.push({ ...block, id: makeBlockId(state.jsonlPath, line) });
      }
      return blocks;
    } catch {
      return [];
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

  /** Call when a new PTY starts for a project */
  startSession(projectId: string, folderPath: string, cliTool: CliTool = 'claude'): void {
    // Stop any previous watcher
    this.stopWatcher(projectId);

    const sessionId = `${Date.now()}-${uuidv4().slice(0, 8)}`;
    const startedAt = Date.now();

    // Create our session file in .ccweb/sessions/
    fs.mkdirSync(projectSessionsDir(folderPath), { recursive: true });
    const session: Session = { id: sessionId, projectId, startedAt: new Date(startedAt).toISOString(), messages: [] };
    fs.writeFileSync(projectSessionFile(folderPath, sessionId), JSON.stringify(session, null, 2), 'utf-8');

    const state: WatchState = {
      sessionId,
      folderPath,
      cliTool,
      jsonlPath: null,
      fileOffset: 0,
      startedAt,
    };
    this.watchers.set(projectId, state);

    // Prune old sessions (keep latest 20)
    this.pruneOldSessions(folderPath, projectId);

    console.log(`[SessionManager] Started session ${sessionId} for project ${projectId}`);
  }

  private pruneOldSessions(folderPath: string, projectId: string, keep = 20): void {
    const dirs = [projectSessionsDir(folderPath), legacySessionsDir(projectId)];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const files = fs.readdirSync(dir)
          .filter((f) => f.endsWith('.json'))
          .sort(); // session filenames start with timestamp, so sort = chronological
        if (files.length <= keep) continue;
        const toDelete = files.slice(0, files.length - keep);
        for (const f of toDelete) {
          try { fs.unlinkSync(path.join(dir, f)); } catch { /**/ }
        }
        console.log(`[SessionManager] Pruned ${toDelete.length} old sessions in ${dir}`);
      } catch { /**/ }
    }
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

  /** Called by hooks route on PostToolUse/Stop.
   *  Immediately reads any new lines from the JSONL file. */
  triggerRead(projectId: string): void {
    const state = this.watchers.get(projectId);
    if (!state) return;
    // If JSONL not found yet, retry up to 3 times (handles race where hook fires before first write)
    if (!state.jsonlPath) {
      state.jsonlPath = this.findJsonl(state.folderPath, state.startedAt, state.cliTool);
      if (!state.jsonlPath) {
        // Guard: skip if a retry chain is already running for this project
        if (state.retrying) return;
        state.retrying = true;
        const delays = [500, 1000, 2000];
        const retry = (attempt: number) => {
          setTimeout(() => {
            const s = this.watchers.get(projectId);
            if (!s) return;
            if (s.jsonlPath) { s.retrying = false; return; }
            s.jsonlPath = this.findJsonl(s.folderPath, s.startedAt, s.cliTool);
            if (s.jsonlPath) {
              s.retrying = false;
              s.fileOffset = 0;
              this.readNewLines(projectId, s);
            } else if (attempt + 1 < delays.length) {
              retry(attempt + 1);
            } else {
              s.retrying = false;
              console.warn(`[SessionManager] JSONL file not found for project ${projectId} after ${delays.length} retries — chat history unavailable`);
            }
          }, delays[attempt]);
        };
        retry(0);
        return;
      }
      state.fileOffset = 0;
    }
    this.readNewLines(projectId, state);
  }

  /** Called by hooks route on Stop — clears semantic status before reading final text. */
  clearSemanticStatus(projectId: string): void {
    if (!this.semanticStatus.has(projectId)) return;
    this.semanticStatus.delete(projectId);
    this.emit('semantic', { projectId, status: null });
  }

  /** Find the newest session file created after startedAt in the tool's session dir */
  private findJsonl(folderPath: string, startedAt: number, cliTool: CliTool = 'claude'): string | null {
    const adapter = getAdapter(cliTool);
    const dir = adapter.getSessionDir(folderPath);
    if (!dir || !fs.existsSync(dir)) return null;

    const ext = typeof adapter.getSessionFileExtension === 'function'
      ? adapter.getSessionFileExtension()
      : '.jsonl';

    try {
      const files = fs.readdirSync(dir)
        .filter((f) => f.endsWith(ext))
        .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
        .filter(({ mtime }) => mtime >= startedAt - 5000) // 5s grace
        .sort((a, b) => b.mtime - a.mtime);

      return files.length > 0 ? path.join(dir, files[0].f) : null;
    } catch {
      return null;
    }
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

      // Extract SessionMessages for our ccweb session file
      const newMsgs: SessionMessage[] = [];
      for (const block of blocks) {
        const text = block.blocks.filter(b => b.type === 'text').map(b => b.content).join('\n').trim();
        if (text) {
          newMsgs.push({ role: block.role, content: text, timestamp: block.timestamp });
        }
      }
      if (newMsgs.length > 0) {
        // Overwrite (not append) since we re-parsed the whole file
        this.overwriteMessages(state.folderPath, state.sessionId, newMsgs);
      }

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
      let changed = false;

      const newMsgs: SessionMessage[] = [];
      for (const line of lines) {
        const msg = adapter.parseLine(line);
        if (msg) newMsgs.push(msg);
      }

      if (newMsgs.length > 0) {
        this.appendMessages(state.folderPath, state.sessionId, newMsgs);
        changed = true;
      }

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

      if (changed) {
        console.log(`[SessionManager] Updated session ${state.sessionId}`);
      }
    } catch {
      // file may be temporarily locked or missing — try again next poll
    } finally {
      if (fd !== null) try { fs.closeSync(fd); } catch { /**/ }
    }
  }

  private appendMessages(folderPath: string, sessionId: string, msgs: SessionMessage[]): void {
    const file = projectSessionFile(folderPath, sessionId);
    try {
      const session: Session = JSON.parse(fs.readFileSync(file, 'utf-8'));
      session.messages.push(...msgs);
      const tmpPath = file + `.tmp.${process.pid}`;
      fs.writeFileSync(tmpPath, JSON.stringify(session, null, 2), 'utf-8');
      fs.renameSync(tmpPath, file);
    } catch (err) {
      console.error(`[SessionManager] Failed to append messages to session ${sessionId}:`, err);
    }
  }

  /** Overwrite all messages (for whole-file JSON tools that re-parse the entire session) */
  private overwriteMessages(folderPath: string, sessionId: string, msgs: SessionMessage[]): void {
    const file = projectSessionFile(folderPath, sessionId);
    try {
      const session: Session = JSON.parse(fs.readFileSync(file, 'utf-8'));
      session.messages = msgs;
      const tmpPath = file + `.tmp.${process.pid}`;
      fs.writeFileSync(tmpPath, JSON.stringify(session, null, 2), 'utf-8');
      fs.renameSync(tmpPath, file);
    } catch (err) {
      console.error(`[SessionManager] Failed to overwrite messages for session ${sessionId}:`, err);
    }
  }

  // ── Query API ──────────────────────────────────────────────────────────────

  /** Resolve folderPath for a project — from active watcher or project config */
  private resolveFolderPath(projectId: string): string | null {
    const watcher = this.watchers.get(projectId);
    if (watcher) return watcher.folderPath;
    const project = getProject(projectId);
    return project?.folderPath ?? null;
  }

  /** Read session files from a directory */
  private readSessionsFromDir(dir: string, currentId: string | undefined): (Omit<Session, 'messages'> & { messageCount: number; isCurrent: boolean })[] {
    if (!fs.existsSync(dir)) return [];
    try {
      return fs.readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          try {
            const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as Session;
            return {
              id: s.id,
              projectId: s.projectId,
              startedAt: s.startedAt,
              messageCount: s.messages.length,
              isCurrent: s.id === currentId,
            };
          } catch { return null; }
        })
        .filter((s): s is Omit<Session, 'messages'> & { messageCount: number; isCurrent: boolean } => s !== null);
    } catch { return []; }
  }

  listSessions(projectId: string): (Omit<Session, 'messages'> & { messageCount: number; isCurrent: boolean })[] {
    const currentId = this.watchers.get(projectId)?.sessionId;
    const folderPath = this.resolveFolderPath(projectId);

    // Collect from .ccweb/sessions/ (primary) and legacy data/sessions/ (fallback)
    const results: (Omit<Session, 'messages'> & { messageCount: number; isCurrent: boolean })[] = [];
    const seenIds = new Set<string>();

    if (folderPath) {
      for (const s of this.readSessionsFromDir(projectSessionsDir(folderPath), currentId)) {
        results.push(s);
        seenIds.add(s.id);
      }
    }

    // Legacy fallback — include sessions not already in .ccweb/
    for (const s of this.readSessionsFromDir(legacySessionsDir(projectId), currentId)) {
      if (!seenIds.has(s.id)) {
        results.push(s);
      }
    }

    return results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** Validate sessionId to prevent path traversal */
  private isValidSessionId(sessionId: string): boolean {
    return /^[\w-]+$/.test(sessionId) && !sessionId.includes('..');
  }

  getSession(projectId: string, sessionId: string): Session | null {
    if (!this.isValidSessionId(sessionId)) return null;
    const folderPath = this.resolveFolderPath(projectId);

    // Try .ccweb/ first
    if (folderPath) {
      const file = projectSessionFile(folderPath, sessionId);
      try {
        if (fs.existsSync(file)) {
          return JSON.parse(fs.readFileSync(file, 'utf-8')) as Session;
        }
      } catch { /* fall through */ }
    }

    // Legacy fallback
    try {
      return JSON.parse(fs.readFileSync(legacySessionFile(projectId, sessionId), 'utf-8')) as Session;
    } catch { return null; }
  }
}

export const sessionManager = new SessionManager();
