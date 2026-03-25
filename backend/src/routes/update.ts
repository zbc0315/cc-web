import { Router, Response } from 'express';
import { AuthRequest } from '../auth';
import { getProjects } from '../config';
import { terminalManager } from '../terminal-manager';
import { chatProcessManager } from '../chat-process-manager';

const router = Router();

const MEMORY_SAVE_COMMAND =
  '请更新与本项目相关的全部记忆、工作计划、已完成工作、未完成工作和后台任务\n';

// Idle = no PTY output for this many ms
const IDLE_THRESHOLD_MS = 5000;
const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 120000; // 2 minutes max per project

interface ProjectUpdateStatus {
  id: string;
  name: string;
  status: 'skipped' | 'command_sent' | 'waiting_idle' | 'stopped' | 'ready' | 'error';
  message?: string;
}

/**
 * GET /api/update/check-running
 * Returns list of running projects so the frontend can warn the user.
 */
router.get('/check-running', (_req: AuthRequest, res: Response): void => {
  const projects = getProjects();
  const running = projects.filter((p) => {
    if (p.status !== 'running') return false;
    return terminalManager.hasTerminal(p.id) || chatProcessManager.hasTerminal(p.id);
  });
  res.json({
    runningCount: running.length,
    projects: running.map((p) => ({ id: p.id, name: p.name, status: p.status })),
  });
});

/**
 * POST /api/update/prepare
 * For each running project:
 *   1. Send memory-save command to Claude
 *   2. Wait until Claude goes idle (no PTY output for IDLE_THRESHOLD_MS)
 *   3. Stop the terminal
 * Returns per-project status.
 */
router.post('/prepare', async (_req: AuthRequest, res: Response): Promise<void> => {
  const projects = getProjects();
  const running = projects.filter(
    (p) => p.status === 'running' && (terminalManager.hasTerminal(p.id) || chatProcessManager.hasTerminal(p.id))
  );

  if (running.length === 0) {
    res.json({ success: true, results: [], message: 'No running projects' });
    return;
  }

  const results: ProjectUpdateStatus[] = [];

  for (const project of running) {
    const status: ProjectUpdateStatus = {
      id: project.id,
      name: project.name,
      status: 'command_sent',
    };

    try {
      if (project.mode === 'chat') {
        // Chat mode has no PTY — stop directly (no memory-save command needed)
        chatProcessManager.stop(project.id);
        status.status = 'ready';
        status.message = 'Chat mode — stopped directly';
      } else {
        // 1. Send the memory-save command
        terminalManager.writeRaw(project.id, MEMORY_SAVE_COMMAND);
        status.status = 'waiting_idle';

        // 2. Wait for Claude to finish processing (go idle)
        const idle = await waitForIdle(project.id, IDLE_THRESHOLD_MS, MAX_WAIT_MS);
        if (!idle) {
          status.status = 'ready';
          status.message = 'Timed out waiting for idle — will resume after update';
        } else {
          status.status = 'ready';
          status.message = 'Memory saved — will resume after update';
        }

        // Do NOT stop terminals — they keep 'running' status so resumeAll()
        // can restart them with --continue after the server restarts.
      }
    } catch (err) {
      status.status = 'error';
      status.message = err instanceof Error ? err.message : 'Unknown error';
    }

    results.push(status);
  }

  res.json({ success: true, results });
});

/**
 * Wait until a terminal has been idle (no PTY output) for `idleMs` milliseconds.
 * Returns true if idle was detected, false if `timeoutMs` exceeded.
 */
function waitForIdle(projectId: string, idleMs: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;

    const check = () => {
      if (Date.now() > deadline) {
        resolve(false);
        return;
      }

      if (!terminalManager.hasTerminal(projectId)) {
        // Terminal already exited
        resolve(true);
        return;
      }

      const lastActivity = terminalManager.getLastActivityAt(projectId);
      if (lastActivity !== null && Date.now() - lastActivity >= idleMs) {
        resolve(true);
        return;
      }

      setTimeout(check, POLL_INTERVAL_MS);
    };

    // Give Claude a moment to start processing before checking idle
    setTimeout(check, 3000);
  });
}

export default router;
