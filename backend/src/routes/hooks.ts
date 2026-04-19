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

// ── Context data storage (per-project, in-memory) ──
export interface ContextData {
  usedPercentage: number;
  remainingPercentage: number;
  contextWindowSize: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  updatedAt: number;
}
const contextDataMap = new Map<string, ContextData>();
export function getContextData(projectId: string): ContextData | null {
  return contextDataMap.get(projectId) ?? null;
}

// Callback to broadcast context update to project WS clients
let broadcastContextUpdate: ((projectId: string, data: ContextData) => void) | null = null;
export function setBroadcastContextUpdate(fn: (projectId: string, data: ContextData) => void): void {
  broadcastContextUpdate = fn;
}

const router = Router();

interface HookBody {
  event?: string;
  tool?: string;
  dir?: string;
  session?: string;
}

/**
 * Resolve which registered project a hook invocation belongs to.
 * Matches semantics with `bin/ccweb-approval-hook.js#resolveProjectId`:
 *   1. exact folderPath match (after path.resolve)
 *   2. otherwise longest-prefix match — user may run Claude from a sub-directory
 *      (e.g. `~/Projects/X/src`), in which case the PreToolUse hook's $CLAUDE_PROJECT_DIR
 *      is the sub-directory, not the project root. Without prefix fallback, hooks
 *      from sub-directories silently drop on the floor and chat history never updates.
 */
function findProjectByDir(dir: string): string | null {
  const projects = getProjects();
  const resolved = path.resolve(dir);
  let bestId: string | null = null;
  let bestLen = -1;
  for (const p of projects) {
    const proj = path.resolve(p.folderPath);
    if (proj === resolved) return p.id;
    if (resolved.startsWith(proj + path.sep) && proj.length > bestLen) {
      bestId = p.id;
      bestLen = proj.length;
    }
  }
  return bestId;
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
      // Retry to catch late-flushed final text (Claude may not have flushed JSONL
      // at the exact moment Stop hook fires — without these retries, the last
      // assistant message appears only when the next turn starts).
      setTimeout(() => sessionManager.triggerRead(projectId), 300);
      setTimeout(() => sessionManager.triggerRead(projectId), 1500);
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

// ── POST /api/hooks/context — receive status line context data ──
router.post('/context', (req: Request, res: Response): void => {
  if (!isLocalRequest(req)) { res.status(403).json({ error: 'Forbidden' }); return; }

  const { dir, context_window } = req.body as {
    dir?: string;
    context_window?: {
      used_percentage?: number;
      remaining_percentage?: number;
      context_window_size?: number;
      current_usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };
  };

  if (!dir || !context_window) { res.json({ ok: true }); return; }

  const projectId = findProjectByDir(dir);
  if (!projectId) { res.json({ ok: true }); return; }

  const data: ContextData = {
    usedPercentage: context_window.used_percentage ?? 0,
    remainingPercentage: context_window.remaining_percentage ?? 100,
    contextWindowSize: context_window.context_window_size ?? 0,
    inputTokens: context_window.current_usage?.input_tokens ?? 0,
    outputTokens: context_window.current_usage?.output_tokens ?? 0,
    cacheCreationTokens: context_window.current_usage?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: context_window.current_usage?.cache_read_input_tokens ?? 0,
    updatedAt: Date.now(),
  };

  contextDataMap.set(projectId, data);
  broadcastContextUpdate?.(projectId, data);

  res.json({ ok: true });
});

export default router;
