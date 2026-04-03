/**
 * POST /api/hooks — receives Claude Code lifecycle hook events.
 * Localhost only (isLocalRequest). No JWT auth needed.
 *
 * Body: { event: string, tool?: string, dir: string, session?: string }
 *
 * Event handling (order matters for Stop):
 *   PreToolUse   → update semanticStatus immediately (NO triggerRead — JSONL not written yet)
 *   PostToolUse  → triggerRead (JSONL now has tool result)
 *   Stop         → clearSemanticStatus first, then triggerRead (read final text without re-setting phase)
 */

import { Router, Request, Response } from 'express';
import * as path from 'path';
import { isLocalRequest } from '../auth';
import { getProjects, getProject } from '../config';
import { sessionManager } from '../session-manager';
import { notifyService } from '../notify-service';

const router = Router();

interface HookBody {
  event?: string;
  tool?: string;
  dir?: string;
  session?: string;
}

function findProjectByDir(dir: string): string | null {
  const projects = getProjects();
  const resolved = path.resolve(dir);
  const match = projects.find((p) => path.resolve(p.folderPath) === resolved);
  return match?.id ?? null;
}

router.post('/', (req: Request, res: Response): void => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const { event, tool, dir } = req.body as HookBody;

  if (!event || !dir) {
    res.status(400).json({ error: 'Missing event or dir' });
    return;
  }

  const projectId = findProjectByDir(dir);
  if (!projectId) {
    // Hook fired from a claude session not managed by ccweb — silently ignore
    res.json({ ok: true });
    return;
  }

  switch (event) {
    case 'PreToolUse':
      // Update semantic status immediately from CLAUDE_TOOL_NAME env var.
      // Do NOT call triggerRead here — JSONL hasn't been written yet.
      sessionManager.handleHookPreTool(projectId, tool ?? '');
      break;

    case 'PostToolUse':
      // JSONL now contains the tool result block — trigger a read.
      sessionManager.triggerRead(projectId);
      break;

    case 'Stop':
      // Clear semantic status FIRST (so any subsequent JSONL read won't re-emit a stale phase).
      // Then read the final text block from JSONL.
      sessionManager.clearSemanticStatus(projectId);
      sessionManager.triggerRead(projectId);
      // Fire notification 300ms after Stop so JSONL has been read
      setTimeout(() => {
        const p = getProject(projectId);
        if (p) void notifyService.onProjectStopped(projectId, p.name);
      }, 300).unref();
      break;

    default:
      break;
  }

  res.json({ ok: true });
});

export default router;
