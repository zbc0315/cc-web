/**
 * SessionManager — reads conversation history directly from Claude Code's
 * native JSONL files at ~/.claude/projects/{encoded-path}/{sessionId}.jsonl
 *
 * No PTY parsing, no ANSI stripping, no heuristics needed.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { DATA_DIR, ccwebSessionsDir, getProject } from './config';

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

// ── JSONL record types (Claude Code internal format) ─────────────────────────

interface ContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | string;
  text?: string;
  thinking?: string;   // thinking blocks use 'thinking' field, not 'text'
  content?: string;    // tool_result blocks use 'content' field
}

interface ClaudeRecord {
  type: 'user' | 'assistant' | string;
  uuid?: string;
  timestamp?: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
}

export interface ChatBlockItem {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  content: string;
}

export interface ChatBlock {
  role: 'user' | 'assistant';
  timestamp: string;
  blocks: ChatBlockItem[];
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

/** Convert /abs/path → -abs-path (Claude Code project dir naming) */
function encodeProjectPath(folderPath: string): string {
  // Claude Code replaces '/', spaces, and underscores with '-'
  return folderPath.replace(/[\/ _]/g, '-');
}

function claudeProjectDir(folderPath: string): string {
  return path.join(os.homedir(), '.claude', 'projects', encodeProjectPath(folderPath));
}

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

// ── Content extraction ────────────────────────────────────────────────────────

function extractText(content: string | ContentBlock[] | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content.trim();
  return content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!.trim())
    .join('\n')
    .trim();
}

function isInternalUserMessage(content: string): boolean {
  // Skip slash commands and internal messages
  return content.startsWith('<command-') || content.startsWith('/');
}

// ── Per-project watcher state ─────────────────────────────────────────────────

interface WatchState {
  sessionId: string;       // our session ID
  folderPath: string;      // project folder (for .ccweb/ storage)
  jsonlPath: string | null; // Claude's JSONL file we're tailing
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

  /** Return all parsed ChatBlocks from the current JSONL file (for replay on chat_subscribe). */
  getChatHistory(projectId: string): ChatBlock[] {
    const state = this.watchers.get(projectId);
    if (!state?.jsonlPath) return [];

    try {
      const content = fs.readFileSync(state.jsonlPath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      const blocks: ChatBlock[] = [];
      for (const line of lines) {
        const block = this.parseLineBlocks(line);
        if (block) blocks.push(block);
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
  startSession(projectId: string, folderPath: string): void {
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
      state.jsonlPath = this.findJsonl(state.folderPath, state.startedAt);
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
            s.jsonlPath = this.findJsonl(s.folderPath, s.startedAt);
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

  /** Find the newest JSONL created after startedAt in Claude's project dir */
  private findJsonl(folderPath: string, startedAt: number): string | null {
    const dir = claudeProjectDir(folderPath);
    if (!fs.existsSync(dir)) return null;

    try {
      const files = fs.readdirSync(dir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
        .filter(({ mtime }) => mtime >= startedAt - 5000) // 5s grace
        .sort((a, b) => b.mtime - a.mtime);

      return files.length > 0 ? path.join(dir, files[0].f) : null;
    } catch {
      return null;
    }
  }

  /** Read any new lines from the JSONL file and extract messages */
  private readNewLines(projectId: string, state: WatchState): void {
    if (!state.jsonlPath) return;

    let fd: number | null = null;
    try {
      const stat = fs.statSync(state.jsonlPath);
      if (stat.size <= state.fileOffset) return; // nothing new

      fd = fs.openSync(state.jsonlPath, 'r');
      const toRead = stat.size - state.fileOffset;
      const buf = Buffer.alloc(toRead);
      fs.readSync(fd, buf, 0, toRead, state.fileOffset);
      state.fileOffset = stat.size;

      const lines = buf.toString('utf-8').split('\n').filter((l) => l.trim());
      let changed = false;

      const newMsgs: SessionMessage[] = [];
      for (const line of lines) {
        const msg = this.parseLine(line);
        if (msg) newMsgs.push(msg);
      }

      if (newMsgs.length > 0) {
        this.appendMessages(state.folderPath, state.sessionId, newMsgs);
        changed = true;
      }

      // Emit to chat listeners + update semantic status
      for (const line of lines) {
        const block = this.parseLineBlocks(line);
        if (block) {
          // Update semantic status from the last block of assistant messages
          if (block.role === 'assistant' && block.blocks.length > 0) {
            const lastBlock = block.blocks[block.blocks.length - 1];
            const detail = lastBlock.type === 'tool_use'
              ? lastBlock.content.split('(')[0]  // extract tool name
              : undefined;
            const newStatus: SemanticStatus = {
              phase: lastBlock.type,
              detail,
              updatedAt: Date.now(),
            };
            this.semanticStatus.set(projectId, newStatus);
            this.emit('semantic', { projectId, status: newStatus });
          }
          // Push to chat listeners
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

  private parseLine(line: string): SessionMessage | null {
    let record: ClaudeRecord;
    try { record = JSON.parse(line) as ClaudeRecord; } catch { return null; }

    // User message
    if (record.type === 'user' && record.message?.role === 'user') {
      const text = extractText(record.message.content);
      if (!text || isInternalUserMessage(text)) return null;
      return { role: 'user', content: text, timestamp: record.timestamp ?? new Date().toISOString() };
    }

    // Assistant message — only keep text blocks, skip thinking/tool_use
    if (record.type === 'assistant' && record.message?.role === 'assistant') {
      const text = extractText(record.message.content);
      if (!text || text.length < 5) return null;
      return { role: 'assistant', content: text, timestamp: record.timestamp ?? new Date().toISOString() };
    }

    return null;
  }

  private parseLineBlocks(line: string): ChatBlock | null {
    let record: ClaudeRecord;
    try { record = JSON.parse(line) as ClaudeRecord; } catch { return null; }
    const ts = record.timestamp ?? new Date().toISOString();

    if (record.type === 'user' && record.message?.role === 'user') {
      const text = extractText(record.message.content);
      if (!text || isInternalUserMessage(text)) return null;
      return { role: 'user', timestamp: ts, blocks: [{ type: 'text', content: text }] };
    }

    if (record.type === 'assistant' && record.message?.role === 'assistant') {
      const content = record.message.content;
      if (!content) return null;
      if (typeof content === 'string') {
        const trimmed = content.trim();
        return trimmed ? { role: 'assistant', timestamp: ts, blocks: [{ type: 'text', content: trimmed }] } : null;
      }
      const blocks: ChatBlockItem[] = [];
      for (const b of content) {
        if (b.type === 'text' && b.text?.trim()) {
          blocks.push({ type: 'text', content: b.text.trim() });
        } else if (b.type === 'thinking') {
          const text = (b as any).thinking ?? b.text;
          if (text?.trim()) blocks.push({ type: 'thinking', content: text.trim() });
        } else if (b.type === 'tool_use') {
          const name = (b as any).name ?? 'tool';
          const input = (b as any).input ? JSON.stringify((b as any).input).slice(0, 200) : '';
          blocks.push({ type: 'tool_use', content: `${name}(${input})` });
        } else if (b.type === 'tool_result') {
          const text = (b as any).content ?? b.text;
          if (text?.trim()) blocks.push({ type: 'tool_result', content: typeof text === 'string' ? text.trim() : JSON.stringify(text).slice(0, 200) });
        }
      }
      return blocks.length > 0 ? { role: 'assistant', timestamp: ts, blocks } : null;
    }

    return null;
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
