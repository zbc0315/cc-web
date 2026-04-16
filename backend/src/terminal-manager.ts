import * as pty from 'node-pty';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { Project, CliTool } from './types';
import { getProjects, saveProject } from './config';
import { sessionManager } from './session-manager';
import { getAdapter } from './adapters';

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

const MAX_RESTART_RETRIES = 5;
const RESTART_BASE_DELAY_MS = 3000;

class TerminalManager extends EventEmitter {
  private terminals = new Map<string, TerminalInstance>();
  /** Pending auto-restart timers, keyed by projectId. Tracked separately so stop() can cancel them. */
  private restartTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Consecutive crash count per project for exponential backoff */
  private crashCounts = new Map<string, number>();
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
    this.activityThrottles.delete(projectId);
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
    this.activityThrottles.delete(projectId);
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

  /** Derive project status from in-memory state (not disk). Source of truth for running/restarting. */
  getProjectStatus(projectId: string): 'running' | 'restarting' | 'stopped' {
    if (this.terminals.has(projectId)) return 'running';
    if (this.restartTimers.has(projectId)) return 'restarting';
    return 'stopped';
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

  /** Return IDs of all projects that have a terminal (including those with no output yet). */
  getAllRunningIds(): string[] {
    return [...this.terminals.keys(), ...this.restartTimers.keys()];
  }

  resumeAll(): void {
    for (const project of getProjects()) {
      if (project.status === 'running' || project.status === 'restarting') {
        // Terminal-only projects: mark stopped instead of resuming (no session to continue)
        if (project.cliTool === 'terminal') {
          project.status = 'stopped';
          saveProject(project);
          continue;
        }
        console.log(`[TerminalManager] Resuming project: ${project.name} (${project.id}) with --continue`);
        this.startTerminal(project, () => {}, true);
      }
    }
  }

  private startTerminal(project: Project, rawBroadcast: RawBroadcastFn, continueSession = false): void {
    const adapter = getAdapter(project.cliTool ?? 'claude');
    const effectiveContinue = continueSession && adapter.supportsContinue();
    const command = adapter.buildCommand(project.permissionMode, effectiveContinue);

    console.log(`[TerminalManager] Starting terminal for project ${project.id}: ${command || '(bare shell)'}`);

    let ptyProcess: pty.IPty;
    try {
      const userShell = process.env.SHELL || (fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash');
      const env = { ...process.env } as { [key: string]: string };
      // Set COLORFGBG so Ink-based CLIs (Gemini, Codex) detect dark/light theme.
      // Default to dark; frontend sends /theme command on subscribe if different.
      if (!env.COLORFGBG) {
        env.COLORFGBG = '15;0'; // light fg on dark bg = dark theme
      }
      // Terminal-only projects: spawn a bare interactive shell (no CLI command)
      const args = command ? ['-ilc', command] : ['-il'];
      ptyProcess = pty.spawn(userShell, args, {
        name: 'xterm-256color',
        cols: 80,   // conservative default; resized to browser width on first subscribe
        rows: 24,
        cwd: project.folderPath,
        env,
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
    this.crashCounts.delete(project.id);
    project.status = 'running';
    saveProject(project);
    // Terminal-only projects have no session files to watch
    if (project.cliTool !== 'terminal') {
      sessionManager.startSession(project.id, project.folderPath, project.cliTool ?? 'claude');
    }

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
      // Terminal-only projects: all exits are intentional (no auto-restart)
      if (project.cliTool === 'terminal') {
        instance.intentionalStop = true;
      }
      this.handleExit(project.id);
    });
  }

  private handleExit(projectId: string): void {
    const instance = this.terminals.get(projectId);
    if (!instance || instance.intentionalStop) {
      this.terminals.delete(projectId);
      this.crashCounts.delete(projectId);
      return;
    }

    const { project, rawBroadcast } = instance;
    this.terminals.delete(projectId);

    // Exponential backoff: 3s, 6s, 12s, 24s, 48s — then give up
    const crashes = (this.crashCounts.get(projectId) ?? 0) + 1;
    this.crashCounts.set(projectId, crashes);

    if (crashes > MAX_RESTART_RETRIES) {
      console.error(`[TerminalManager] Project ${projectId} crashed ${crashes} times — giving up auto-restart`);
      project.status = 'stopped';
      saveProject(project);
      rawBroadcast(`\r\n\x1b[31m[Terminal crashed ${crashes} times — auto-restart disabled. Please restart manually.]\x1b[0m\r\n`);
      this.crashCounts.delete(projectId);
      return;
    }

    const adapter = getAdapter(project.cliTool ?? 'claude');
    const continueHint = adapter.supportsContinue() ? ' with --continue' : '';
    const delay = RESTART_BASE_DELAY_MS * Math.pow(2, crashes - 1);
    const delaySec = Math.round(delay / 1000);
    project.status = 'restarting';
    saveProject(project);
    rawBroadcast(`\r\n\x1b[33m[Terminal exited — restarting${continueHint} in ${delaySec}s… (attempt ${crashes}/${MAX_RESTART_RETRIES})]\x1b[0m\r\n`);

    console.log(`[TerminalManager] Auto-restarting terminal for ${projectId}${continueHint} in ${delaySec}s (attempt ${crashes}/${MAX_RESTART_RETRIES})...`);
    // Clear any existing restart timer to avoid double-restart on rapid crash loop
    const existing = this.restartTimers.get(projectId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.restartTimers.delete(projectId);
      if (!this.terminals.has(projectId)) {
        this.startTerminal(project, rawBroadcast, true);
      }
    }, delay);
    this.restartTimers.set(projectId, timer);
  }
}

export const terminalManager = new TerminalManager();
