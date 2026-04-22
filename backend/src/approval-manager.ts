/**
 * ApprovalManager — in-memory Claude Code PermissionRequest approval flow.
 *
 * Hook script (bin/ccweb-approval-hook.js) holds an HTTP POST open until the
 * user decides in the web UI; this manager bridges that POST to a WS event
 * and back to a Promise resolution.
 *
 * Security:
 *  - Shared HMAC secret at ~/.ccweb/approval-secret (mode 0600) verifies hook ↔ backend calls.
 *  - Hook HTTP is 127.0.0.1-only (enforced at route level) so LAN clients can't forge requests.
 *  - Frontend decide() goes through JWT-auth'd route.
 *
 * Claude-only on purpose (not a missed adapter abstraction):
 *   - Codex DOES have an approval system (`approval_policy = on-request`),
 *     but it is purely internal to the TUI — Codex does NOT emit external
 *     webhooks for pre-tool decisions, so ccweb cannot intercept. The only
 *     adapter surfaces are (a) MCP server wrapping or (b) the undocumented
 *     `--remote ws://...` TUI protocol, both of which are an order of
 *     magnitude more engineering than this module. Keeping this Claude-only
 *     is a cost decision, not "Codex lacks approval".
 *   - Gemini / OpenCode / Qwen likewise have no compatible webhook surface.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { modLogger } from './logger';

const log = modLogger('approval');

const SECRET_FILE = path.join(os.homedir(), '.ccweb', 'approval-secret');

export interface ApprovalRequest {
  projectId: string;
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  sessionId: string;
  createdAt: number;
}

export interface ApprovalDecision {
  behavior: 'allow' | 'deny';
  message?: string;
}

interface PendingEntry extends ApprovalRequest {
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

function loadOrCreateSecret(): string {
  if (fs.existsSync(SECRET_FILE)) {
    try {
      const existing = fs.readFileSync(SECRET_FILE, 'utf-8').trim();
      if (existing) return existing;
    } catch (err) {
      log.error({ err }, 'approval-secret exists but unreadable — refusing to regenerate (would break active hooks); fix permissions');
      throw err;
    }
  }
  const secret = crypto.randomBytes(32).toString('hex');
  const dir = path.dirname(SECRET_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SECRET_FILE, secret, { encoding: 'utf-8', mode: 0o600 });
  return secret;
}

class ApprovalManager {
  private pending = new Map<string, PendingEntry>();
  private secret: string;
  private listeners = new Set<(evt: ApprovalEvent) => void>();

  constructor() {
    this.secret = loadOrCreateSecret();
  }

  getSecretFile(): string { return SECRET_FILE; }

  sign(data: string): string {
    return crypto.createHmac('sha256', this.secret).update(data).digest('hex');
  }

  verify(data: string, signature: string): boolean {
    const expected = this.sign(data);
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from((signature || '').trim(), 'hex');
    if (a.length === 0 || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  private keyOf(projectId: string, toolUseId: string): string {
    return `${projectId}:${toolUseId}`;
  }

  /** Register a new pending approval. Resolves with the decision (or timeout deny). */
  register(req: ApprovalRequest, timeoutMs: number): Promise<ApprovalDecision> {
    const key = this.keyOf(req.projectId, req.toolUseId);
    if (this.pending.has(key)) {
      return Promise.resolve({ behavior: 'deny', message: 'Duplicate request' });
    }
    return new Promise<ApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        const entry = this.pending.get(key);
        if (!entry) return;
        this.pending.delete(key);
        this.emit({ type: 'approval_resolved', projectId: req.projectId, toolUseId: req.toolUseId, behavior: 'deny', reason: 'timeout' });
        resolve({ behavior: 'deny', message: 'Approval timeout' });
      }, timeoutMs);
      this.pending.set(key, { ...req, resolve, timer });
      this.emit({ type: 'approval_request', ...req });
    });
  }

  /** Resolve a pending request with a decision. Returns true if it existed. */
  decide(projectId: string, toolUseId: string, decision: ApprovalDecision): boolean {
    const key = this.keyOf(projectId, toolUseId);
    const entry = this.pending.get(key);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(key);
    entry.resolve(decision);
    this.emit({ type: 'approval_resolved', projectId, toolUseId, behavior: decision.behavior });
    return true;
  }

  /** Cancel a pending request (e.g. hook client disconnected). Resolves with a deny internally; no WS resolved event. */
  cancel(projectId: string, toolUseId: string, reason: string): boolean {
    const key = this.keyOf(projectId, toolUseId);
    const entry = this.pending.get(key);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(key);
    entry.resolve({ behavior: 'deny', message: reason });
    this.emit({ type: 'approval_resolved', projectId, toolUseId, behavior: 'deny', reason });
    return true;
  }

  /** List all pending approvals for a project (for UI reconnect). */
  listPending(projectId: string): ApprovalRequest[] {
    const out: ApprovalRequest[] = [];
    for (const entry of this.pending.values()) {
      if (entry.projectId === projectId) {
        const { resolve: _r, timer: _t, ...info } = entry;
        out.push(info);
      }
    }
    return out;
  }

  subscribe(fn: (evt: ApprovalEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(evt: ApprovalEvent): void {
    for (const fn of this.listeners) {
      try { fn(evt); } catch (err) { log.warn({ err }, 'approval listener error'); }
    }
  }
}

export type ApprovalEvent =
  | ({ type: 'approval_request' } & ApprovalRequest)
  | { type: 'approval_resolved'; projectId: string; toolUseId: string; behavior: 'allow' | 'deny'; reason?: string };

export const approvalManager = new ApprovalManager();
