import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { startProject } from '@/lib/api';
import { formatChatContent } from '@/lib/chatUtils';
import type { ChatMessage } from '@/lib/websocket';
import { toast } from 'sonner';
import type { Project } from '@/types';
import { useChatHistory, type ChatMsg } from './useChatHistory';

export type ChatState = 'stopped' | 'waking' | 'live' | 'error';

export interface ChatSessionWs {
  send: (data: string) => void;
  connected: boolean;
}

interface UseChatSessionOptions {
  project: Project;
  /** Live-message stream from the WS (`chat_message` events), lifted by the
   *  parent since it owns the WS hook (desktop: `useProjectWebSocket`;
   *  mobile/monitor: `useMonitorWebSocket`). */
  liveMessages: ChatMessage[];
  /** Outbound WS interface: just `send(data)` + current `connected` state.
   *  `connected` is read in an effect to drain the pending queue. */
  ws: ChatSessionWs;
  /** Initial page size and each load-more batch size. Default 20. */
  historyLimit?: number;
  /** Max displayMessages kept in memory. Default 50. */
  liveWindow?: number;
  /** Disable history loads (monitor with zero history may set false). Default true. */
  historyEnabled?: boolean;
}

export interface UseChatSessionResult {
  state: ChatState;
  setState: React.Dispatch<React.SetStateAction<ChatState>>;
  /** `[...historyMessages, ...displayMessages]` — the rendered list. */
  messages: ChatMsg[];
  historyMessages: ChatMsg[];
  displayMessages: ChatMsg[];
  setDisplayMessages: React.Dispatch<React.SetStateAction<ChatMsg[]>>;
  hasMoreHistory: boolean;
  /** Prepend next older batch. Callers can wrap with scroll-preservation. */
  loadMoreHistory: () => Promise<void>;
  reloadHistory: () => Promise<void>;
  /** Mutable ref flipped to true when any live WS message arrives. Consumers
   *  can use this to implement the 3-second live-fallback pattern. */
  liveReceivedRef: React.MutableRefObject<boolean>;
  /** Send a message through the WS with queue + retry + wake flow. */
  sendMessage: (text: string) => void;
  /** Append a user-bubble without sending — e.g. the parent sends via a
   *  separate channel (shortcut panel) and just wants the UI to show it. */
  appendUserMessage: (text: string) => void;
  /** Kill any armed send-retry. Rare — exposed for parent-driven flows. */
  clearSendRetry: () => void;
  isWaking: boolean;
  isRunning: boolean;
}

/** Max number of un-flushed messages held while WS is disconnected or the
 *  project is still waking up. Caps unbounded growth if a wake fails. */
const PENDING_QUEUE_CAP = 20;

/**
 * Phase 1b of chat unification: extracts the state machine + send queue +
 * condition-driven retry + wake flow that was previously duplicated across
 * ChatOverlay, MobileChatView, and MonitorPane. Consumers own rendering and
 * any mode-specific UI (approval cards, activity bubbles, skills panel).
 */
export function useChatSession({
  project,
  liveMessages,
  ws,
  historyLimit = 20,
  liveWindow = 50,
  historyEnabled = true,
}: UseChatSessionOptions): UseChatSessionResult {
  const projectId = project.id;

  // ── State machine ──
  const [state, setState] = useState<ChatState>(
    project.status === 'running' ? 'live' : 'stopped',
  );

  // ── History delegated to useChatHistory ──
  const {
    history: historyMessages,
    hasMore: hasMoreHistory,
    reload: reloadHistory,
    loadMore: loadMoreHistory,
  } = useChatHistory({ projectId, historyLimit, enabled: historyEnabled });

  // ── Live message state ──
  const [displayMessages, setDisplayMessages] = useState<ChatMsg[]>([]);
  const msgIdRef = useRef(0);
  const nextMsgId = useCallback(() => `m${++msgIdRef.current}`, []);

  // ── Send-retry bookkeeping ──
  const sendRetryRef = useRef<{ timer: ReturnType<typeof setTimeout>; attempts: number } | null>(null);
  const clearSendRetry = useCallback(() => {
    if (sendRetryRef.current) {
      clearTimeout(sendRetryRef.current.timer);
      sendRetryRef.current = null;
    }
  }, []);

  // ── Echo-dedup ring ──
  const recentSentRef = useRef<string[]>([]);
  const liveReceivedRef = useRef(false);

  // ── Consume live WS messages ──
  const prevLiveCountRef = useRef(0);
  useEffect(() => {
    // Reset on WS reconnect (parent clears liveMessages → length shrinks)
    if (liveMessages.length < prevLiveCountRef.current) {
      prevLiveCountRef.current = 0;
      recentSentRef.current = [];
    }
    if (liveMessages.length <= prevLiveCountRef.current) return;
    const newMsgs = liveMessages.slice(prevLiveCountRef.current);
    prevLiveCountRef.current = liveMessages.length;

    for (const msg of newMsgs) {
      liveReceivedRef.current = true;
      const content = formatChatContent(msg.blocks);
      if (!content.trim()) continue;
      if (msg.role === 'user') {
        // Own-echo: stop the retry loop, don't render (already shown optimistically)
        const idx = recentSentRef.current.indexOf(content.trim());
        if (idx !== -1) {
          recentSentRef.current.splice(idx, 1);
          clearSendRetry();
          continue;
        }
      }
      setDisplayMessages((prev) => {
        // Dedup by backend block id (against WS replay overlapping history)
        if (msg.id && prev.some((p) => p.id === msg.id)) return prev;
        const next: ChatMsg = {
          id: msg.id ?? nextMsgId(),
          role: msg.role,
          content,
          blocks: msg.blocks,
          ts: msg.timestamp,
        };
        return [...prev, next].slice(-liveWindow);
      });
    }
  }, [liveMessages, nextMsgId, liveWindow, clearSendRetry]);

  // ── 3s fallback when live but nothing streamed ──
  useEffect(() => {
    if (state !== 'live') { liveReceivedRef.current = false; return; }
    const timer = setTimeout(() => {
      if (!liveReceivedRef.current) void reloadHistory();
    }, 3000);
    return () => clearTimeout(timer);
  }, [state, reloadHistory]);

  // ── External status sync ──
  useEffect(() => {
    if (project.status === 'running' && (state === 'stopped' || state === 'error')) {
      setDisplayMessages([]);
      setState('live');
    } else if (project.status === 'stopped' && state === 'live') {
      setState('stopped');
    }
  }, [project.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Queue + wake state ──
  const pendingQueueRef = useRef<string[]>([]);
  const wakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeIdRef = useRef(0);

  // Arm condition-driven retry for a just-sent `text`. Keeps firing bare \r
  // every 3s until Claude echoes the text back (drop from recentSentRef) or
  // the 20-attempt cap is hit. Required because Claude's TUI may be mid-boot
  // and swallow the first Enter silently.
  const armRetry = useCallback((lastText: string) => {
    clearSendRetry();
    const INTERVAL = 3000;
    const MAX_ATTEMPTS = 20;
    const fire = (attempt: number) => {
      const timer = setTimeout(() => {
        if (!recentSentRef.current.includes(lastText)) {
          sendRetryRef.current = null;
          return;
        }
        if (attempt >= MAX_ATTEMPTS) {
          const idx = recentSentRef.current.indexOf(lastText);
          if (idx !== -1) recentSentRef.current.splice(idx, 1);
          sendRetryRef.current = null;
          return;
        }
        ws.send('\r');
        fire(attempt + 1);
      }, INTERVAL);
      sendRetryRef.current = { timer, attempts: attempt };
    };
    fire(0);
  }, [clearSendRetry, ws]);

  // ── Flush queue when WS connected AND project is live ──
  //   Covers (a) initial-mount CONNECTING race, (b) mid-session reconnect,
  //   (c) stopped→waking→live (WS stays open; state transition triggers drain).
  useEffect(() => {
    if (!ws.connected) return;
    if (state !== 'live') return;
    if (pendingQueueRef.current.length === 0) return;
    const queue = [...pendingQueueRef.current];
    pendingQueueRef.current = [];
    for (const text of queue) {
      ws.send(text.replace(/\n/g, '\r') + '\r');
    }
    armRetry(queue[queue.length - 1]);
  }, [ws.connected, state, ws, armRetry]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (wakingTimerRef.current) clearTimeout(wakingTimerRef.current);
      clearSendRetry();
    };
  }, [clearSendRetry]);

  // Helper: enqueue with cap; drops oldest if saturated
  const enqueueBounded = useCallback((text: string) => {
    if (pendingQueueRef.current.length >= PENDING_QUEUE_CAP) {
      pendingQueueRef.current.shift();
    }
    pendingQueueRef.current.push(text);
  }, []);

  // ── sendMessage ──
  const sendMessage = useCallback((text: string) => {
    recentSentRef.current.push(text);
    if (recentSentRef.current.length > 10) recentSentRef.current.shift();
    setDisplayMessages((prev) => [...prev, {
      id: nextMsgId(),
      role: 'user' as const,
      content: text,
      ts: new Date().toISOString(),
    }].slice(-liveWindow));

    if (state === 'live') {
      if (!ws.connected || pendingQueueRef.current.length > 0) {
        enqueueBounded(text);
      } else {
        ws.send(text.replace(/\n/g, '\r') + '\r');
        armRetry(text);
      }
    } else if (state === 'waking') {
      enqueueBounded(text);
    } else if (state === 'stopped' || state === 'error') {
      enqueueBounded(text);
      const thisWake = ++wakeIdRef.current;
      setState('waking');
      startProject(projectId)
        .then(() => {
          if (thisWake !== wakeIdRef.current) return;
          if (wakingTimerRef.current) clearTimeout(wakingTimerRef.current);
          setState('live');
        })
        .catch((err) => {
          if (thisWake !== wakeIdRef.current) return;
          toast.error(`启动失败: ${err instanceof Error ? err.message : String(err)}`);
          setState('error');
          pendingQueueRef.current = [];
        });
      wakingTimerRef.current = setTimeout(() => {
        if (thisWake !== wakeIdRef.current) return;
        if (pendingQueueRef.current.length > 0) {
          toast.error('启动超时（10s）');
          setState('error');
          pendingQueueRef.current = [];
        }
      }, 10000);
    }
  }, [state, ws, projectId, nextMsgId, liveWindow, armRetry, enqueueBounded]);

  // ── appendUserMessage (external-source echo, no send) ──
  const appendUserMessage = useCallback((text: string) => {
    const clean = text.replace(/\r$/, '').trim();
    if (!clean) return;
    recentSentRef.current.push(clean);
    if (recentSentRef.current.length > 10) recentSentRef.current.shift();
    setDisplayMessages((prev) => [...prev, {
      id: nextMsgId(),
      role: 'user' as const,
      content: clean,
      ts: new Date().toISOString(),
    }].slice(-liveWindow));
  }, [nextMsgId, liveWindow]);

  // ── Merged messages (history + live, deduped by id) ──
  //
  // WS replay (the last N blocks) and HTTP history (the last M blocks) overlap
  // on their newest entries. Both populate different arrays, so without id-
  // based dedup here, long conversations show duplicate bubbles. Strategy:
  // keep all live entries (they reflect the most recent state) and only
  // include history items whose id is not already covered live.
  const messages = useMemo(() => {
    const liveIds = new Set<string>();
    for (const m of displayMessages) if (m.id) liveIds.add(m.id);
    const uniqueHistory = historyMessages.filter((h) => !h.id || !liveIds.has(h.id));
    return [...uniqueHistory, ...displayMessages];
  }, [historyMessages, displayMessages]);

  return {
    state,
    setState,
    messages,
    historyMessages,
    displayMessages,
    setDisplayMessages,
    hasMoreHistory,
    loadMoreHistory,
    reloadHistory,
    liveReceivedRef,
    sendMessage,
    appendUserMessage,
    clearSendRetry,
    isWaking: state === 'waking',
    isRunning: state === 'live',
  };
}
