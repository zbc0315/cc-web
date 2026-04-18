import { Router, Request, Response } from 'express';
import { approvalManager, type ApprovalDecision } from '../approval-manager';
import { AuthRequest, authMiddleware } from '../auth';
import { getProject, isProjectOwner, isAdminUser } from '../config';

function canDecideApproval(projectId: string, username: string | undefined): boolean {
  if (isAdminUser(username)) return true;
  const project = getProject(projectId);
  if (!project) return false;
  if (isProjectOwner(project, username)) return true;
  const share = project.shares?.find((s) => s.username === username);
  return share?.permission === 'edit';
}

const router = Router();

// Hook-facing timeout. Chain: settings.json timeout=120s → hook script 112s → backend 110s.
// Backend must resolve first so the hook always gets a clean HTTP response; 10s cushion.
const HOOK_TIMEOUT_MS = 110_000;

/** Only accept hook requests from localhost loopback. */
function isLoopback(req: Request): boolean {
  const addr = req.socket.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function badSignature(req: Request, payload: string): boolean {
  const sig = (req.header('x-ccweb-signature') || '').trim();
  if (!sig) return true;
  return !approvalManager.verify(payload, sig);
}

/**
 * POST /api/hooks/approval-request
 * Called by ccweb-approval-hook.js. Blocks until the user decides or timeout.
 * Auth: loopback + HMAC signature of the raw JSON body.
 */
router.post('/hooks/approval-request', async (req: Request, res: Response): Promise<void> => {
  if (!isLoopback(req)) { res.status(403).json({ error: 'loopback only' }); return; }

  // Require exact raw bytes — never fall back to JSON.stringify (would silently mismatch HMAC).
  const rawBuf = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!rawBuf) { res.status(400).json({ error: 'raw body missing' }); return; }
  const raw = rawBuf.toString('utf-8');
  if (badSignature(req, raw)) { res.status(401).json({ error: 'bad signature' }); return; }

  const { projectId, toolUseId, toolName, toolInput, sessionId } = (req.body ?? {}) as {
    projectId?: string; toolUseId?: string; toolName?: string; toolInput?: unknown; sessionId?: string;
  };
  if (!projectId || !toolUseId || !toolName) {
    res.status(400).json({ error: 'projectId, toolUseId, toolName required' });
    return;
  }

  // If the hook client drops the TCP connection before we resolve, cancel the
  // pending entry so it doesn't linger in the UI until the 110s timeout.
  // NOTE: use `res.on('close')` NOT `req.on('close')` — the latter fires as soon
  // as the request body is fully received (Node >=16 auto-destroys IncomingMessage
  // after 'end'), which for our tiny POST happens before `register()` even resolves,
  // causing a spurious cancel on every request. `res.on('close')` only fires when
  // the underlying connection closes or after `res.end()`.
  let responded = false;
  res.on('close', () => {
    if (!responded) approvalManager.cancel(projectId, toolUseId, 'client disconnected');
  });

  const decision: ApprovalDecision = await approvalManager.register(
    { projectId, toolUseId, toolName, toolInput, sessionId: sessionId ?? '', createdAt: Date.now() },
    HOOK_TIMEOUT_MS,
  );

  responded = true;
  if (res.writableEnded || res.destroyed) return;
  res.json(decision);
});

/**
 * POST /api/approval/:requestId/decide
 * Called by the frontend when user clicks Allow/Deny.
 * Auth: JWT (applied at router mount level).
 * :requestId format is `projectId:toolUseId`.
 */
router.post('/approval/:projectId/:toolUseId/decide', authMiddleware, (req: AuthRequest, res: Response): void => {
  const { projectId, toolUseId } = req.params;
  if (!canDecideApproval(projectId, req.user?.username)) {
    res.status(403).json({ error: 'view-only collaborators cannot decide approvals' });
    return;
  }
  const { behavior, message } = (req.body ?? {}) as { behavior?: string; message?: string };
  if (behavior !== 'allow' && behavior !== 'deny') {
    res.status(400).json({ error: 'behavior must be allow or deny' });
    return;
  }
  const ok = approvalManager.decide(projectId, toolUseId, { behavior, message });
  if (!ok) { res.status(404).json({ error: 'request not found or already resolved' }); return; }
  res.json({ ok: true });
});

/**
 * GET /api/approval/:projectId/pending
 * Returns pending approvals for a project (for overlay reconnect).
 */
router.get('/approval/:projectId/pending', authMiddleware, (req: AuthRequest, res: Response): void => {
  const { projectId } = req.params;
  if (!canDecideApproval(projectId, req.user?.username)) {
    // view-only users shouldn't see tool inputs either
    res.json({ pending: [] });
    return;
  }
  res.json({ pending: approvalManager.listPending(projectId) });
});

export default router;
