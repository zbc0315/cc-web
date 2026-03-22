import * as pty from 'node-pty';
import { Project, CliTool } from './types';
import { getProjects, saveProject } from './config';
import { sessionManager } from './session-manager';

function buildCommand(tool: CliTool, permissionMode: 'limited' | 'unlimited'): string {
  const unlimited = permissionMode === 'unlimited';
  switch (tool) {
    case 'claude':
      return unlimited ? 'claude --dangerously-skip-permissions' : 'claude';
    case 'opencode':
      return unlimited ? 'opencode --dangerously-skip-permissions' : 'opencode';
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
  /** Epoch ms of the last PTY data chunk received. */
  lastActivityAt: number;
}

class TerminalManager {
  private terminals = new Map<string, TerminalInstance>();

  getOrCreate(project: Project, rawBroadcast: RawBroadcastFn = () => {}): void {
    const existing = this.terminals.get(project.id);
    if (existing) {
      existing.rawBroadcast = rawBroadcast;
      return;
    }
    this.startTerminal(project, rawBroadcast);
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
      result[id] = instance.lastActivityAt;
    }
    return result;
  }

  resumeAll(): void {
    for (const project of getProjects()) {
      if (project.status === 'running' || project.status === 'restarting') {
        console.log(`[TerminalManager] Resuming project: ${project.name} (${project.id})`);
        this.startTerminal(project, () => {});
      }
    }
  }

  private startTerminal(project: Project, rawBroadcast: RawBroadcastFn): void {
    const command = buildCommand(project.cliTool ?? 'claude', project.permissionMode);

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
      lastActivityAt: 0,
    };

    this.terminals.set(project.id, instance);
    project.status = 'running';
    saveProject(project);
    sessionManager.startSession(project.id, project.folderPath);

    ptyProcess.onData((data: string) => {
      instance.lastActivityAt = Date.now();
      // Append to scrollback, trimming from front if over cap
      instance.scrollback += data;
      if (instance.scrollback.length > SCROLLBACK_MAX_CHARS) {
        instance.scrollback = instance.scrollback.slice(
          instance.scrollback.length - SCROLLBACK_MAX_CHARS
        );
      }
      // Forward to all live terminal clients
      instance.rawBroadcast(data);
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
    rawBroadcast('\r\n\x1b[33m[Terminal exited — restarting in 3 s…]\x1b[0m\r\n');

    console.log(`[TerminalManager] Auto-restarting terminal for ${projectId} in 3s...`);
    setTimeout(() => this.startTerminal(project, rawBroadcast), 3000);
  }
}

export const terminalManager = new TerminalManager();
