import { useEffect, useRef, useCallback } from 'react';
import { getToken } from './api';

export interface ChatBlockItem {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  content: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  timestamp: string;
  blocks: ChatBlockItem[];
}

const WS_BASE = import.meta.env.DEV
  ? 'ws://localhost:3001'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

interface UseProjectWebSocketOptions {
  onTerminalData?: (data: string) => void;
  onStatus?: (status: string) => void;
  onConnected?: () => void;
  onChatMessage?: (msg: ChatMessage) => void;
}

type IncomingMessage =
  | { type: 'connected'; projectId: string }
  | { type: 'terminal_data'; data: string }
  | { type: 'terminal_subscribed' }
  | { type: 'status'; status: string }
  | { type: 'error'; message: string }
  | { type: 'chat_message'; role: string; timestamp: string; blocks: ChatBlockItem[] }
  | { type: string };

export function useProjectWebSocket(
  projectId: string,
  options: UseProjectWebSocketOptions
) {
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const mountedRef = useRef(true);
  const connectingRef = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Buffer a pending subscribe if terminal dimensions aren't ready yet when connected fires
  const pendingSubscribeRef = useRef(false);

  const rawSend = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
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
    rawSend({ type: 'terminal_input', data });
  }, [rawSend]);

  const sendTerminalResize = useCallback((cols: number, rows: number) => {
    rawSend({ type: 'terminal_resize', cols, rows });
  }, [rawSend]);

  const subscribeChatMessages = useCallback(() => {
    rawSend({ type: 'chat_subscribe' });
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
        case 'error':
          console.error('[WS] Server error:', (parsed as { type: 'error'; message: string }).message);
          break;
      }
    };

    ws.onclose = () => {
      connectingRef.current = false;
      wsRef.current = null;
      if (!mountedRef.current) return;
      if (retriesRef.current < MAX_RETRIES) {
        retriesRef.current++;
        setTimeout(connect, RETRY_DELAY_MS);
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
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  return { subscribeTerminal, sendTerminalInput, sendTerminalResize, subscribeChatMessages };
}

// ── Dashboard WebSocket (activity push) ─────────────────────────────────────

export interface ActivityUpdate {
  projectId: string;
  lastActivityAt: number;
  semantic?: {
    phase: 'thinking' | 'tool_use' | 'tool_result' | 'text';
    detail?: string;
    updatedAt: number;
  };
}

interface UseDashboardWebSocketOptions {
  onActivityUpdate: (update: ActivityUpdate) => void;
}

export function useDashboardWebSocket(options: UseDashboardWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const mountedRef = useRef(true);
  const connectingRef = useRef(false);
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
        const parsed = JSON.parse(event.data as string);
        if (parsed.type === 'activity_update') {
          optionsRef.current.onActivityUpdate(parsed as ActivityUpdate);
        }
      } catch { /**/ }
    };

    ws.onclose = () => {
      connectingRef.current = false;
      wsRef.current = null;
      if (!mountedRef.current) return;
      if (retriesRef.current < MAX_RETRIES) {
        retriesRef.current++;
        setTimeout(connect, RETRY_DELAY_MS);
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
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);
}
