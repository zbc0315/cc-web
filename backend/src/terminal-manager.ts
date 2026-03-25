import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { Project, CliTool } from './types';
import { getProjects, saveProject } from './config';
import { sessionManager } from './session-manager';

function buildCommand(tool: CliTool, permissionMode: 'limited' | 'unlimited', continueSession = false): string {
  const unlimited = permissionMode === 'unlimited';
  const cont = continueSession ? ' --continue' : '';
  switch (tool) {
    case 'claude':
      return unlimited ? `claude --dangerously-skip-permissions${cont}` : `claude${cont}`;
    case 'opencode':
      return unlimited ? `opencode --dangerously-skip-permissions${cont}` : `opencode${cont}`;
    case 'codex':
      return unlimited ? 'codex --ask-for-approval never --sandbox danger-full-access' : 'codex';
    case 'qwen':
      return unlimited ? 'qwen-code --yolo' : 'qwen-code';
  }
}

type RawBroadcastFn = (data: string) => void;

// Maximum scrollback buffer size per terminal (~5M characters)
const SCROLLBACK_MAX_CHARS = 5 * 1024 * 1024;

interface TerminalInstance {
  pty: pty.IPty;
  project: Project;
  intentionalStop: boolean;
  rawBroadcast: RawBroadcastFn;
  /** Raw PTY output kept in memory so reconnecting clients can replay terminal state. */
  scrollback: string;
  /** Epoch ms of the last PTY data chunk received. null = no data received yet. */
  lastActivityAt: number | null;
}

class TerminalManager extends EventEmitter {
  private terminals = new Map<string, TerminalInstance>();
  /** Pending auto-restart timers, keyed by projectId. Tracked separately so stop() can cancel them. */
  private restartTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Throttle activity emissions to max once per 500ms per project */
  private activityThrottles = new Map<string, number>();

  constructor() {
    super();
  }

  getOrCreate(project: Project, rawBroadcast: RawBroadcastFn = () => {}, continueSession = false): void {
    const existing = this.terminals.get(project.id);
    if (existing) {
      existing.rawBroadcast = rawBroadcast;
      return;
    }
    this.startTerminal(project, rawBroadcast, continueSession);
  }

  updateBroadcast(projectId: string, rawBroadcast: RawBroadcastFn): void {
    const instance = this.terminals.get(projectId);
    if (instance) instance.rawBroadcast = rawBroadcast;
  }

  /** Write raw keystrokes directly to the PTY. */
  writeRaw(projectId: string, data: string): void {
    this.terminals.get(projectId)?.pty.write(data);
  }

  /** Resize the PTY to match the browser terminal. */
  resize(projectId: string, cols: number, rows: number): void {
    const instance = this.terminals.get(projectId);
    if (!instance) return;
    try {
      instance.pty.resize(Math.max(cols, 10), Math.max(rows, 5));
    } catch (err) {
      console.error(`[TerminalManager] Resize error for ${projectId}:`, err);
    }
  }

  stop(projectId: string): void {
    // Cancel any pending auto-restart timer first
    const timer = this.restartTimers.get(projectId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.restartTimers.delete(projectId);
    }
    const instance = this.terminals.get(projectId);
    if (!instance) return;
    instance.intentionalStop = true;
    try { instance.pty.kill(); } catch { /* ignore */ }
    this.terminals.delete(projectId);
    // Clean up session watcher to prevent orphaned polling intervals
    sessionManager.stopWatcherForProject(projectId);
    instance.project.status = 'stopped';
    saveProject(instance.project);
  }

  /** Kill PTY without changing project status — used during update so resumeAll can restart with --continue. */
  killForUpdate(projectId: string): void {
    const timer = this.restartTimers.get(projectId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.restartTimers.delete(projectId);
    }
    const instance = this.terminals.get(projectId);
    if (!instance) return;
    instance.intentionalStop = true;
    try { instance.pty.kill(); } catch { /* ignore */ }
    this.terminals.delete(projectId);
    sessionManager.stopWatcherForProject(projectId);
    // Deliberately do NOT change project.status — keep it as 'running'
  }

  hasTerminal(projectId: string): boolean {
    return this.terminals.has(projectId);
  }

  /** Return the accumulated raw scrollback for a project (for replay on reconnect). */
  getScrollback(projectId: string): string {
    return this.terminals.get(projectId)?.scrollback ?? '';
  }

  /** Return epoch ms of last PTY data, or null if no terminal / never had data. */
  getLastActivityAt(projectId: string): number | null {
    const instance = this.terminals.get(projectId);
    return instance ? instance.lastActivityAt : null;
  }

  /** Return activity map for all running terminals: projectId → lastActivityAt ms. */
  getAllActivity(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [id, instance] of this.terminals) {
      if (instance.lastActivityAt !== null) {
        result[id] = instance.lastActivityAt;
      }
    }
    return result;
  }

  resumeAll(): void {
    for (const project of getProjects()) {
      if (project.status === 'running' || project.status === 'restarting') {
        console.log(`[TerminalManager] Resuming project: ${project.name} (${project.id}) with --continue`);
        this.startTerminal(project, () => {}, true);
      }
    }
  }

  private startTerminal(project: Project, rawBroadcast: RawBroadcastFn, continueSession = false): void {
    const command = buildCommand(project.cliTool ?? 'claude', project.permissionMode, continueSession);

    console.log(`[TerminalManager] Starting terminal for project ${project.id}: ${command}`);

    let ptyProcess: pty.IPty;
    try {
      const userShell = process.env.SHELL || '/bin/zsh';
      ptyProcess = pty.spawn(userShell, ['-ilc', command], {
        name: 'xterm-256color',
        cols: 80,   // conservative default; resized to browser width on first subscribe
        rows: 24,
        cwd: project.folderPath,
        env: { ...process.env } as { [key: string]: string },
      });
    } catch (err) {
      console.error(`[TerminalManager] Failed to spawn PTY for ${project.id}:`, err);
      project.status = 'stopped';
      saveProject(project);
      return;
    }

    const instance: TerminalInstance = {
      pty: ptyProcess,
      project,
      intentionalStop: false,
      rawBroadcast,
      scrollback: '',
      lastActivityAt: null,
    };

    this.terminals.set(project.id, instance);
    project.status = 'running';
    saveProject(project);
    sessionManager.startSession(project.id, project.folderPath);

    ptyProcess.onData((data: string) => {
      const now = Date.now();
      instance.lastActivityAt = now;
      // Append to scrollback, trimming from front if over cap
      instance.scrollback += data;
      if (instance.scrollback.length > SCROLLBACK_MAX_CHARS) {
        instance.scrollback = instance.scrollback.slice(
          instance.scrollback.length - SCROLLBACK_MAX_CHARS
        );
      }
      // Forward to all live terminal clients
      instance.rawBroadcast(data);
      // Emit activity event (throttled to 500ms per project)
      const lastEmit = this.activityThrottles.get(project.id) ?? 0;
      if (now - lastEmit >= 500) {
        this.activityThrottles.set(project.id, now);
        this.emit('activity', { projectId: project.id, lastActivityAt: now });
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      console.log(`[TerminalManager] Terminal exited for ${project.id} (code: ${exitCode})`);
      this.handleExit(project.id);
    });
  }

  private handleExit(projectId: string): void {
    const instance = this.terminals.get(projectId);
    if (!instance || instance.intentionalStop) {
      this.terminals.delete(projectId);
      return;
    }

    const { project, rawBroadcast } = instance;
    this.terminals.delete(projectId);

    project.status = 'restarting';
    saveProject(project);
    rawBroadcast('\r\n\x1b[33m[Terminal exited — restarting with --continue in 3 s…]\x1b[0m\r\n');

    console.log(`[TerminalManager] Auto-restarting terminal for ${projectId} with --continue in 3s...`);
    const timer = setTimeout(() => {
      this.restartTimers.delete(projectId);
      // Only restart if stop() hasn't been called during the delay
      if (!this.terminals.has(projectId) && !this.restartTimers.has(projectId)) {
        this.startTerminal(project, rawBroadcast, true);
      }
    }, 3000);
    this.restartTimers.set(projectId, timer);
  }
}

export const terminalManager = new TerminalManager();
