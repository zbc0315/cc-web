import { useEffect, useRef, useCallback, useState } from 'react';
import { getToken } from './api';

export interface ChatBlockItem {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  /** Legacy string form; always populated.  Rich renderers should prefer
   *  structured `tool` / `input` / `output` below when present. */
  content: string;
  /** tool_use: tool name (`Bash`, `Edit`, `TodoWrite`, …). */
  tool?: string;
  /** tool_use: structured input, deep strings capped at ~4KB. */
  input?: unknown;
  /** tool_result: full-ish text up to ~4KB. */
  output?: string;
}

export interface ChatMessage {
  /** Stable block id for dedup between WS replay and HTTP history.
   *  Populated by session-manager from v2026.4.19-o onward. Optional for
   *  backward compatibility with older backends during rolling upgrades. */
  id?: string;
  role: 'user' | 'assistant';
  timestamp: string;
  blocks: ChatBlockItem[];
}

const WS_BASE = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;
const RETRY_JITTER_MS = 2000;

/**
 * Reconnect delay with linear cap + uniform jitter, shared by every WS hook
 * in this module so cross-hook reconnect storms (when a backend restart drops
 * many sockets at once) don't all fire on the same millisecond. Mirrors the
 * monitor WS pattern that was previously inlined only there.
 *
 * `retries` is 1-based: the FIRST reconnect after a drop has retries=1.
 * Linear because we don't expect a flapping server — exponential would just
 * make recovery from a single hiccup feel slow without measurable benefit.
 */
function reconnectDelayMs(retries: number): number {
  const base = RETRY_DELAY_MS * Math.min(retries, 4); // grows 3s → 12s, then capped
  return base + Math.random() * RETRY_JITTER_MS;
}

export interface ContextUpdate {
  usedPercentage: number;
  remainingPercentage: number;
  contextWindowSize: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface SemanticStatus {
  phase: 'thinking' | 'tool_use' | 'tool_result' | 'text';
  detail?: string;
  updatedAt: number;
}

export interface SemanticUpdate {
  active: boolean;
  semantic?: SemanticStatus;
}

export interface ApprovalRequestEvent {
  type: 'approval_request';
  projectId: string;
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  sessionId: string;
  createdAt: number;
}

export interface ApprovalResolvedEvent {
  type: 'approval_resolved';
  projectId: string;
  toolUseId: string;
  behavior: 'allow' | 'deny';
  reason?: string;
}

interface UseProjectWebSocketOptions {
  onTerminalData?: (data: string) => void;
  onStatus?: (status: string) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onChatMessage?: (msg: ChatMessage) => void;
  onProjectStopped?: (projectId: string, projectName: string) => void;
  onContextUpdate?: (data: ContextUpdate) => void;
  onSemanticUpdate?: (data: SemanticUpdate) => void;
  onApprovalRequest?: (evt: ApprovalRequestEvent) => void;
  onApprovalResolved?: (evt: ApprovalResolvedEvent) => void;
}

type IncomingMessage =
  | { type: 'connected'; projectId: string }
  | { type: 'terminal_data'; data: string }
  | { type: 'terminal_subscribed' }
  | { type: 'status'; status: string }
  | { type: 'error'; message: string }
  | { type: 'chat_message'; role: string; timestamp: string; blocks: ChatBlockItem[] }
  | { type: 'project_stopped'; projectId: string; projectName: string }
  | { type: string };

export function useProjectWebSocket(
  projectId: string,
  options: UseProjectWebSocketOptions
) {
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const mountedRef = useRef(true);
  const connectingRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Exposed readiness state so consumers (useChatSession etc.) can gate sends
  // on current WS availability rather than re-deriving from event callbacks.
  // `connected` flips with actual WS open/close; `readyTick` increments on each
  // new 'connected' event (useful as an effect trigger — e.g. re-fetch pending
  // approvals on every reconnect).
  const [connected, setConnected] = useState(false);
  const [readyTick, setReadyTick] = useState(0);

  // Buffer a pending subscribe if terminal dimensions aren't ready yet when connected fires
  const pendingSubscribeRef = useRef(false);
  // Queue for terminal_input payloads that arrive while the socket is still
  // CONNECTING (or transiently closed between reconnects). Without this, callers
  // that hit `sendTerminalInput` in the first ~50-500ms after mount would have
  // their keystrokes silently dropped (CLAUDE.md #26 pattern).
  const pendingInputQueueRef = useRef<string[]>([]);

  const rawSend = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const flushInputQueue = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    while (pendingInputQueueRef.current.length > 0) {
      const data = pendingInputQueueRef.current.shift()!;
      wsRef.current.send(JSON.stringify({ type: 'terminal_input', data }));
    }
  }, []);

  /** Call this once the terminal has been fitted and you have accurate cols/rows. */
  const subscribeTerminal = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'terminal_subscribe', cols, rows }));
      pendingSubscribeRef.current = false;
    } else {
      // WebSocket not open yet — will retry once connected
      pendingSubscribeRef.current = true;
    }
  }, []);

  const sendTerminalInput = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'terminal_input', data }));
    } else {
      pendingInputQueueRef.current.push(data);
    }
  }, []);

  const sendTerminalResize = useCallback((cols: number, rows: number) => {
    rawSend({ type: 'terminal_resize', cols, rows });
  }, [rawSend]);

  const subscribeChatMessages = useCallback(() => {
    // Limit WS replay to the last 50 blocks — the frontend's useChatHistory
    // loads the full paginated history via HTTP, so full replay is redundant.
    // Backend defaults to MAX_SAFE_INTEGER when `replay` is omitted (back-compat
    // with pre-v-o clients that relied on WS for history), so we opt-in here.
    rawSend({ type: 'chat_subscribe', replay: 50 });
  }, [rawSend]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (connectingRef.current) return; // prevent multiple simultaneous connections

    const token = getToken();
    if (!token) {
      window.location.href = '/login';
      return;
    }

    connectingRef.current = true;
    const ws = new WebSocket(`${WS_BASE}/ws/projects/${projectId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      connectingRef.current = false;
      retriesRef.current = 0;
      ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (event: MessageEvent) => {
      let parsed: IncomingMessage;
      try {
        parsed = JSON.parse(event.data as string) as IncomingMessage;
      } catch {
        return;
      }

      switch (parsed.type) {
        case 'connected':
          // Notify the caller; they will call subscribeTerminal() with current dimensions.
          // This also covers the case where subscribeTerminal() was called before the
          // socket was open (pendingSubscribeRef.current), since onConnected triggers
          // the caller to re-invoke subscribeTerminal with fresh dimensions.
          pendingSubscribeRef.current = false;
          setConnected(true);
          setReadyTick((t) => t + 1);
          flushInputQueue();
          optionsRef.current.onConnected?.();
          break;
        case 'terminal_data':
          optionsRef.current.onTerminalData?.((parsed as { type: 'terminal_data'; data: string }).data);
          break;
        case 'status':
          optionsRef.current.onStatus?.((parsed as { type: 'status'; status: string }).status);
          break;
        case 'chat_message': {
          const cm = parsed as { type: 'chat_message'; role: 'user' | 'assistant'; timestamp: string; blocks: ChatBlockItem[] };
          optionsRef.current.onChatMessage?.(cm);
          break;
        }
        case 'project_stopped': {
          const ps = parsed as { type: 'project_stopped'; projectId: string; projectName: string };
          optionsRef.current.onProjectStopped?.(ps.projectId, ps.projectName);
          break;
        }
        case 'context_update':
          optionsRef.current.onContextUpdate?.(parsed as unknown as ContextUpdate);
          break;
        case 'semantic_update':
          optionsRef.current.onSemanticUpdate?.(parsed as unknown as SemanticUpdate);
          break;
        case 'approval_request':
          optionsRef.current.onApprovalRequest?.(parsed as unknown as ApprovalRequestEvent);
          break;
        case 'approval_resolved':
          optionsRef.current.onApprovalResolved?.(parsed as unknown as ApprovalResolvedEvent);
          break;
        case 'error':
          console.error('[WS] Server error:', (parsed as { type: 'error'; message: string }).message);
          break;
      }
    };

    ws.onclose = () => {
      connectingRef.current = false;
      if (wsRef.current === ws) wsRef.current = null;
      setConnected(false);
      // Always notify disconnect so parent can clear wsConnected. Even on
      // unmount the parent's setState will no-op (component gone) or update
      // stale state harmlessly.
      optionsRef.current.onDisconnected?.();
      if (!mountedRef.current) return;
      if (retriesRef.current < MAX_RETRIES) {
        retriesRef.current++;
        retryTimerRef.current = window.setTimeout(connect, reconnectDelayMs(retriesRef.current));
      }
    };

    ws.onerror = (err) => {
      connectingRef.current = false;
      console.error('[WS] WebSocket error:', err);
    };
  }, [projectId]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      wsRef.current?.close();
      wsRef.current = null;
      // Drop queued keystrokes on unmount — new mount starts fresh.
      pendingInputQueueRef.current = [];
    };
  }, [connect]);

  return { subscribeTerminal, sendTerminalInput, sendTerminalResize, subscribeChatMessages, connected, readyTick };
}

// ── Dashboard WebSocket (activity push) ─────────────────────────────────────

export interface ActivityUpdate {
  projectId: string;
  lastActivityAt: number;
  active?: boolean; // server-side determination, avoids clock skew
  status?: 'running' | 'stopped' | 'restarting';
  semantic?: {
    phase: 'thinking' | 'tool_use' | 'tool_result' | 'text';
    detail?: string;
    updatedAt: number;
  };
}

interface UseDashboardWebSocketOptions {
  onActivityUpdate: (update: ActivityUpdate) => void;
  onProjectStopped?: (projectId: string, projectName: string) => void;
}

export function useDashboardWebSocket(options: UseDashboardWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const mountedRef = useRef(true);
  const connectingRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (connectingRef.current) return;

    const token = getToken();
    if (!token) return;

    connectingRef.current = true;
    const ws = new WebSocket(`${WS_BASE}/ws/dashboard`);
    wsRef.current = ws;

    ws.onopen = () => {
      connectingRef.current = false;
      retriesRef.current = 0;
      ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data as string) as Record<string, unknown>;
        if (parsed.type === 'activity_update') {
          optionsRef.current.onActivityUpdate(parsed as unknown as ActivityUpdate);
        } else if (parsed.type === 'project_stopped') {
          optionsRef.current.onProjectStopped?.(
            parsed.projectId as string,
            parsed.projectName as string
          );
        }
      } catch { /**/ }
    };

    ws.onclose = () => {
      connectingRef.current = false;
      if (wsRef.current === ws) wsRef.current = null;
      if (!mountedRef.current) return;
      if (retriesRef.current < MAX_RETRIES) {
        retriesRef.current++;
        retryTimerRef.current = window.setTimeout(connect, reconnectDelayMs(retriesRef.current));
      }
    };

    ws.onerror = (err) => {
      connectingRef.current = false;
      console.error('[DashboardWS] Error:', err);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);
}

// ── Sync events (rsync progress + start/done) ───────────────────────────────
//
// Opens its own /ws/dashboard connection so it works from both ProjectHeader
// (inside a project page, no existing dashboard WS around) and SyncSection
// (inside Settings, same). Callers filter events by `projectId` client-side
// — server broadcasts globally per-user. Events shape mirrors the backend
// `SyncEvent` union in `backend/src/sync-service.ts`.
//
// Tradeoff: adds one WS connection per subscribing component instance. For
// the two consumers today that's acceptable; if the count grows, promote to
// a module-level singleton with refcounted attach/detach.

export type SyncStartEvent = { type: 'sync.start'; kind: 'start'; username: string; projectId: string; direction: 'push' | 'pull'; leg: 'single' | 'bidi-push' | 'bidi-pull' };
export type SyncProgressEvent = { type: 'sync.progress'; kind: 'progress'; username: string; projectId: string; currentFile: string; filesTransferred: number };
export type SyncDoneEvent = { type: 'sync.done'; kind: 'done'; username: string; projectId: string; ok: boolean; filesTransferred: number; bytes: number; durationMs: number; reason?: string };
export type SyncWireEvent = SyncStartEvent | SyncProgressEvent | SyncDoneEvent;

interface UseSyncEventsOptions {
  onStart?: (e: SyncStartEvent) => void;
  onProgress?: (e: SyncProgressEvent) => void;
  onDone?: (e: SyncDoneEvent) => void;
}

export function useSyncEvents(options: UseSyncEventsOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const mountedRef = useRef(true);
  const connectingRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (connectingRef.current) return;
    const token = getToken();
    if (!token) return;

    connectingRef.current = true;
    const ws = new WebSocket(`${WS_BASE}/ws/dashboard`);
    wsRef.current = ws;

    ws.onopen = () => {
      connectingRef.current = false;
      retriesRef.current = 0;
      ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data as string) as { type?: string };
        if (!parsed.type || !parsed.type.startsWith('sync.')) return;
        if (parsed.type === 'sync.start') optionsRef.current.onStart?.(parsed as unknown as SyncStartEvent);
        else if (parsed.type === 'sync.progress') optionsRef.current.onProgress?.(parsed as unknown as SyncProgressEvent);
        else if (parsed.type === 'sync.done') optionsRef.current.onDone?.(parsed as unknown as SyncDoneEvent);
      } catch { /**/ }
    };

    ws.onclose = () => {
      connectingRef.current = false;
      if (wsRef.current === ws) wsRef.current = null;
      if (!mountedRef.current) return;
      if (retriesRef.current < MAX_RETRIES) {
        retriesRef.current++;
        retryTimerRef.current = window.setTimeout(connect, reconnectDelayMs(retriesRef.current));
      }
    };

    ws.onerror = () => { connectingRef.current = false; };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);
}

// ── Monitor WebSocket (chat-only, no terminal subscribe) ─────────────────────

interface UseMonitorWebSocketOptions {
  projectId: string;
  enabled: boolean; // only connect when true (e.g. project is running)
  onChatMessage: (msg: ChatMessage) => void;
  onStatusChange?: (status: 'running' | 'stopped' | 'restarting') => void;
  onContextUpdate?: (data: ContextUpdate) => void;
  onApprovalRequest?: (evt: ApprovalRequestEvent) => void;
  onApprovalResolved?: (evt: ApprovalResolvedEvent) => void;
  onSemanticUpdate?: (data: SemanticUpdate) => void;
}

export function useMonitorWebSocket({ projectId, enabled, onChatMessage, onStatusChange, onContextUpdate, onApprovalRequest, onApprovalResolved, onSemanticUpdate }: UseMonitorWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);
  const retriesRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const connectingRef = useRef(false);
  /** true after server sends 'connected' (auth + chat_subscribe done) */
  const readyRef = useRef(false);
  /** Queue of messages waiting for WS to become ready */
  const pendingQueueRef = useRef<string[]>([]);
  const optionsRef = useRef({ onChatMessage, onStatusChange, onContextUpdate, onApprovalRequest, onApprovalResolved, onSemanticUpdate });
  optionsRef.current = { onChatMessage, onStatusChange, onContextUpdate, onApprovalRequest, onApprovalResolved, onSemanticUpdate };

  // Exposed readiness state (mirror of readyRef for consumers that need a
  // React-reactive signal — e.g. useChatSession gates sends on `connected`).
  const [connected, setConnected] = useState(false);
  const [readyTick, setReadyTick] = useState(0);

  /** Flush all queued messages once WS is ready */
  const flushQueue = useCallback(() => {
    if (!readyRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    while (pendingQueueRef.current.length > 0) {
      const data = pendingQueueRef.current.shift()!;
      wsRef.current.send(JSON.stringify({ type: 'terminal_input', data }));
    }
  }, []);

  const sendInput = useCallback((data: string) => {
    if (readyRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'terminal_input', data }));
    } else {
      // WS not ready — queue for auto-flush when connected
      pendingQueueRef.current.push(data);
    }
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current || !enabled) return;
    if (connectingRef.current) return;
    const token = getToken();
    if (!token) return;

    connectingRef.current = true;
    readyRef.current = false;
    const ws = new WebSocket(`${WS_BASE}/ws/projects/${projectId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      connectingRef.current = false;
      retriesRef.current = 0;
      // Send auth first; chat_subscribe sent after 'connected' confirmation
      ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data as string);
        if (parsed.type === 'connected') {
          // Auth confirmed — subscribe with a bounded replay. Frontend pairs
          // this with a separate HTTP /chat-history call, so full WS replay
          // would just duplicate work. Backend defaults to MAX_SAFE_INTEGER
          // if `replay` is missing (preserves pre-v-o client behavior).
          ws.send(JSON.stringify({ type: 'chat_subscribe', replay: 50 }));
          readyRef.current = true;
          setConnected(true);
          setReadyTick((t) => t + 1);
          // Flush any messages queued while WS was connecting
          flushQueue();
        } else if (parsed.type === 'chat_message') {
          optionsRef.current.onChatMessage(parsed as ChatMessage);
        } else if (parsed.type === 'status' && parsed.status) {
          optionsRef.current.onStatusChange?.(parsed.status);
        } else if (parsed.type === 'project_stopped') {
          optionsRef.current.onStatusChange?.('stopped');
        } else if (parsed.type === 'context_update') {
          optionsRef.current.onContextUpdate?.(parsed as ContextUpdate);
        } else if (parsed.type === 'approval_request') {
          optionsRef.current.onApprovalRequest?.(parsed as unknown as ApprovalRequestEvent);
        } else if (parsed.type === 'approval_resolved') {
          optionsRef.current.onApprovalResolved?.(parsed as unknown as ApprovalResolvedEvent);
        } else if (parsed.type === 'semantic_update') {
          optionsRef.current.onSemanticUpdate?.(parsed as unknown as SemanticUpdate);
        }
      } catch { /**/ }
    };

    ws.onclose = () => {
      connectingRef.current = false;
      readyRef.current = false;
      setConnected(false);
      if (wsRef.current === ws) wsRef.current = null;
      if (!mountedRef.current || !enabled) return;
      if (retriesRef.current < MAX_RETRIES) {
        retriesRef.current++;
        retryTimerRef.current = window.setTimeout(connect, reconnectDelayMs(retriesRef.current));
      } else if (pendingQueueRef.current.length > 0) {
        // Retries exhausted — queued messages will never be delivered
        console.warn('[MonitorWS] Retries exhausted, dropping', pendingQueueRef.current.length, 'queued messages');
        pendingQueueRef.current = [];
      }
    };

    ws.onerror = () => { connectingRef.current = false; };
  }, [projectId, enabled, flushQueue]);

  // Separate unmount cleanup: only clear queue when component truly unmounts
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pendingQueueRef.current = [];
    };
  }, []);

  // Connection lifecycle: reconnect when connect/enabled changes
  // Queue is NOT cleared here — messages must survive reconnections
  useEffect(() => {
    retriesRef.current = 0;
    if (enabled) connect();
    return () => {
      readyRef.current = false;
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect, enabled]);

  return { sendInput, connected, readyTick };
}
