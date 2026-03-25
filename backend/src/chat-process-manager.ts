/**
 * ChatProcessManager — manages claude --print SDK subprocess per project.
 *
 * Key design notes:
 * - sessionManager.startSession() is called AFTER system.init is received,
 *   not immediately after spawn (JSONL file doesn't exist yet at spawn time).
 * - tool_result blocks appear in USER-role messages in SDK output, not assistant.
 * - hasTerminal() is the public API name (mirrors TerminalManager.hasTerminal).
 * - Crash restart uses 3s delay; interrupt restart is immediate (500ms).
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { Project } from './types';
import { saveProject } from './config';
import { sessionManager } from './session-manager';

export interface ChatStreamEvent {
  projectId: string;
  type: 'stream' | 'tool_start' | 'tool_end' | 'turn_end' | 'rate_limit' | 'status';
  delta?: string;
  contentType?: 'text' | 'thinking';
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: string;
  costUsd?: number;
  resetsAt?: number;
  status?: string;
}

interface ChatInstance {
  process: ChildProcess;
  project: Project;
  intentionalStop: boolean;
  lastActivityAt: number | null;
  sessionId: string | null;
  pendingToolName: string | null;
  lineBuffer: string;
}

class ChatProcessManager extends EventEmitter {
  private instances = new Map<string, ChatInstance>();
  private restartTimers = new Map<string, ReturnType<typeof setTimeout>>();

  start(project: Project, continueSession = false): void {
    this.stopInternal(project.id, false);

    const args = this.buildArgs(project, continueSession);
    const userShell = process.env.SHELL || '/bin/zsh';

    const proc = spawn(userShell, ['-ilc', args.join(' ')], {
      cwd: project.folderPath,
      env: { ...process.env } as Record<string, string>,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const instance: ChatInstance = {
      process: proc,
      project,
      intentionalStop: false,
      lastActivityAt: null,
      sessionId: null,
      pendingToolName: null,
      lineBuffer: '',
    };

    this.instances.set(project.id, instance);
    project.status = 'running';
    saveProject(project);
    // NOTE: sessionManager.startSession() is called later, when system.init arrives

    proc.stdout?.on('data', (chunk: Buffer) => {
      instance.lastActivityAt = Date.now();
      const text = chunk.toString('utf-8');

      // Auto-respond to Claude's workspace trust prompt (non-TTY: raw text on stdout)
      if (text.includes('Yes, I trust this folder') || text.includes('Quick safety check')) {
        try { proc.stdin?.write('1\n'); } catch { /**/ }
        return;
      }

      instance.lineBuffer += text;
      const lines = instance.lineBuffer.split('\n');
      instance.lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) this.parseLine(project.id, instance, trimmed);
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      console.error(`[ChatProcess ${project.id}] stderr:`, data.toString().slice(0, 200));
    });

    proc.on('exit', (code) => {
      console.log(`[ChatProcess] Exit for ${project.id}, code: ${code}`);
      this.handleExit(project.id);
    });

    console.log(`[ChatProcessManager] Started for project ${project.id}`);
  }

  stop(projectId: string): void {
    this.stopInternal(projectId, true);
  }

  /** Interrupt current generation and immediately restart with --continue */
  interrupt(projectId: string): void {
    const instance = this.instances.get(projectId);
    if (!instance) return;
    // Mark intentionalStop so handleExit doesn't trigger crash-restart
    instance.intentionalStop = true;
    try { instance.process.kill('SIGINT'); } catch { /**/ }
    this.instances.delete(projectId);

    this.emit('event', { projectId, type: 'status', status: 'restarting' } as ChatStreamEvent);

    // Immediate restart (no 3s delay — user-initiated, not a crash)
    setTimeout(() => {
      this.start(instance.project, true);
    }, 500);
  }

  sendMessage(projectId: string, text: string): boolean {
    const instance = this.instances.get(projectId);
    if (!instance?.process.stdin) return false;
    const msg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: text },
    }) + '\n';
    try {
      instance.process.stdin.write(msg);
      return true;
    } catch {
      return false;
    }
  }

  /** Named hasTerminal for API consistency with TerminalManager */
  hasTerminal(projectId: string): boolean {
    return this.instances.has(projectId);
  }

  /** Stop all running chat processes — called on server shutdown. */
  stopAll(): void {
    for (const projectId of [...this.instances.keys()]) {
      this.stopInternal(projectId, false);
    }
    for (const timer of this.restartTimers.values()) clearTimeout(timer);
    this.restartTimers.clear();
  }

  getLastActivityAt(projectId: string): number | null {
    return this.instances.get(projectId)?.lastActivityAt ?? null;
  }

  private stopInternal(projectId: string, updateStatus: boolean): void {
    const timer = this.restartTimers.get(projectId);
    if (timer) { clearTimeout(timer); this.restartTimers.delete(projectId); }

    const instance = this.instances.get(projectId);
    if (!instance) return;

    instance.intentionalStop = true;
    try { instance.process.kill('SIGTERM'); } catch { /**/ }
    this.instances.delete(projectId);
    sessionManager.stopWatcherForProject(projectId);

    if (updateStatus) {
      instance.project.status = 'stopped';
      saveProject(instance.project);
    }
  }

  private buildArgs(project: Project, continueSession: boolean): string[] {
    const args = [
      'claude',
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
    ];
    if (continueSession) args.push('--continue');
    if (project.permissionMode === 'unlimited') args.push('--dangerously-skip-permissions');
    return args;
  }

  private parseLine(projectId: string, instance: ChatInstance, line: string): void {
    let record: Record<string, unknown>;
    try { record = JSON.parse(line) as Record<string, unknown>; } catch { return; }

    const type = record.type as string;

    // ── system.init: call startSession now (JSONL file is about to be created) ──
    if (type === 'system' && (record.subtype as string) === 'init') {
      instance.sessionId = (record.session_id as string) ?? null;
      sessionManager.startSession(instance.project.id, instance.project.folderPath);
      return;
    }

    // ── assistant messages: text, thinking, tool_use blocks ──
    if (type === 'assistant') {
      const msg = record.message as { content?: unknown[] } | undefined;
      for (const block of (msg?.content ?? []) as Record<string, unknown>[]) {
        const btype = block.type as string;

        if (btype === 'text') {
          const text = (block.text as string) ?? '';
          if (text) {
            this.emit('event', { projectId, type: 'stream', delta: text, contentType: 'text' } as ChatStreamEvent);
          }
        } else if (btype === 'thinking') {
          const thinking = (block.thinking as string) ?? '';
          if (thinking) {
            this.emit('event', { projectId, type: 'stream', delta: thinking, contentType: 'thinking' } as ChatStreamEvent);
          }
        } else if (btype === 'tool_use') {
          const name = (block.name as string) ?? 'tool';
          instance.pendingToolName = name;
          this.emit('event', { projectId, type: 'tool_start', toolName: name, toolInput: block.input } as ChatStreamEvent);
        }
      }
      return;
    }

    // ── user messages: tool_result blocks (SDK returns tool results as user-role messages) ──
    if (type === 'user') {
      const msg = record.message as { role?: string; content?: unknown[] } | undefined;
      if (msg?.role !== 'tool') return; // only process tool result messages
      for (const block of (msg?.content ?? []) as Record<string, unknown>[]) {
        if ((block.type as string) === 'tool_result') {
          const content = block.content;
          const output = typeof content === 'string' ? content : JSON.stringify(content).slice(0, 500);
          this.emit('event', {
            projectId,
            type: 'tool_end',
            toolName: instance.pendingToolName ?? 'tool',
            toolOutput: output,
          } as ChatStreamEvent);
          instance.pendingToolName = null;
        }
      }
      return;
    }

    // ── result: turn complete ──
    if (type === 'result') {
      this.emit('event', { projectId, type: 'turn_end', costUsd: (record.total_cost_usd as number) ?? 0 } as ChatStreamEvent);
      return;
    }

    // ── rate_limit_event ──
    if (type === 'rate_limit_event') {
      const info = record.rate_limit_info as { resetsAt?: number } | undefined;
      if (info?.resetsAt) {
        this.emit('event', { projectId, type: 'rate_limit', resetsAt: info.resetsAt } as ChatStreamEvent);
      }
    }
  }

  private handleExit(projectId: string): void {
    const instance = this.instances.get(projectId);
    if (!instance || instance.intentionalStop) {
      this.instances.delete(projectId);
      return;
    }

    const { project } = instance;
    this.instances.delete(projectId);

    project.status = 'restarting';
    saveProject(project);
    this.emit('event', { projectId, type: 'status', status: 'restarting' } as ChatStreamEvent);

    console.log(`[ChatProcessManager] Auto-restarting ${projectId} with --continue in 3s...`);
    const timer = setTimeout(() => {
      this.restartTimers.delete(projectId);
      if (!this.instances.has(projectId)) this.start(project, true);
    }, 3000);
    this.restartTimers.set(projectId, timer);
  }
}

export const chatProcessManager = new ChatProcessManager();
