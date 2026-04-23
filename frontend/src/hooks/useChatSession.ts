import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { startProject } from '@/lib/api';
import { formatChatContent } from '@/lib/chatUtils';
import type { ChatMessage } from '@/lib/websocket';
import { toast } from 'sonner';
import type { Project } from '@/types';
import { useChatHistory, type ChatMsg } from './useChatHistory';

export type ChatState = 'stopped' | 'waking' | 'live' | 'error';
export type SendResult = 'delivered' | 'failed';

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
  /** Send a message through the WS with queue + retry + wake flow.
   *  Resolves to `'delivered'` when the bytes are actually written to the
   *  WS (from a live+connected session, or after queue drain once wake
   *  completes). Resolves to `'failed'` when the 5s send timeout fires
   *  while the message is still queued, when the wake path errors/times
   *  out, or when the queue cap drops the oldest entry.
   *
   *  IMPORTANT: the user bubble is appended ONLY when the send actually
   *  happens — a queued message that never leaves the client shows no
   *  bubble and no terminal echo. Callers can use the resolved value to
   *  decide whether to clear their input field. */
  sendMessage: (text: string) => Promise<SendResult>;
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

/** A queued send expires after this many ms if it hasn't reached the wire.
 *  Expiry resolves the caller's promise with `'failed'` so the UI can
 *  restore the text to the input box. Matches the UX spec: "没进入 CLI 则
 *  输入框保留消息". Wake flow has a 10s timeout — messages fail independently
 *  at 5s, which is the intended behavior. */
const SEND_TIMEOUT_MS = 5000;

/** Per-enqueue bookkeeping so drain/timeout/wake-failure paths can resolve
 *  the correct caller's promise. */
interface PendingSend {
  text: string;
  isSlashCommand: boolean;
  resolve: (result: SendResult) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

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
  //
  // Bracketed-paste helper. Claude Code (Ink-based TUI) uses paste heuristics
  // to distinguish "user typed" from "user pasted" — for pasted content the
  // `\r` characters are interpreted as embedded newlines, not as "submit".
  // Without explicit markers, sending `text + '\r'` in a single PTY write
  // makes Claude's heuristic flag the whole burst as paste and swallow the
  // terminating `\r` as a newline → the message sits in Claude's input box
  // with an extra blank line and never submits. Reproduced in a sandbox
  // ccweb against the Claude CLI's OAuth-prompt state (same paste-handling
  // code path as live prompt input); Claude 2.1.108+ supports bracketed paste.
  // Wrapping with `\x1b[200~...\x1b[201~` tells Claude unambiguously "this is
  // a paste block"; the bare `\r` AFTER `\x1b[201~` is a separate key press
  // and triggers submit. Applies to both live and queue-flush send paths.
  //
  // We also strip any embedded `\x1b[20[01]~` bytes the user happens to have
  // in their text: if left in, they would close the paste mode early and the
  // tail would be parsed as raw keystrokes — a real (if narrow) bug if the
  // user types terminal escape sequences into chat.
  const bracketedPaste = (text: string): string => {
    const body = text.replace(/\x1b\[20[01]~/g, '').replace(/\n/g, '\r');
    return '\x1b[200~' + body + '\x1b[201~\r';
  };

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
  const pendingQueueRef = useRef<PendingSend[]>([]);
  const wakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeIdRef = useRef(0);

  /** Resolve every pending send as failed. Called from wake failure / wake
   *  timeout so the UI can restore the un-sent text to the input field. */
  const failAllPending = useCallback(() => {
    const queue = pendingQueueRef.current;
    pendingQueueRef.current = [];
    for (const p of queue) {
      if (p.timer) { clearTimeout(p.timer); p.timer = null; }
      p.resolve('failed');
    }
  }, []);

  // Arm condition-driven retry for a just-sent `text`. Keeps firing bare \r
  // every 3s until Claude echoes the text back (drop from recentSentRef) or
  // the 20-attempt cap is hit. Required because Claude's TUI may be mid-boot
  // and swallow the first Enter silently.
  // Single rolling retry watcher: one timer that keeps firing \r as long as
  // ANY text is still waiting for its own-echo in recentSentRef. Replaces the
  // previous "per-call arm with lastText" design, which was broken for quickly
  // queued shortcut chains (each new send cleared the prior text's retry, so
  // only the most recent message was actually protected).
  //
  // Stop conditions:
  //   - recentSentRef becomes empty (everything echoed)
  //   - attempts reach cap (swallowed messages stay swallowed — surface to UI
  //     in a future iteration; for now drop their tracking to avoid leaks)
  const armRetry = useCallback(() => {
    if (sendRetryRef.current) return; // already armed and watching the list
    const INTERVAL = 3000;
    const MAX_ATTEMPTS = 20;
    const fire = (attempt: number) => {
      const timer = setTimeout(() => {
        if (recentSentRef.current.length === 0) {
          sendRetryRef.current = null;
          return;
        }
        if (attempt >= MAX_ATTEMPTS) {
          // Give up — clear the list so future sends can arm a fresh retry
          recentSentRef.current = [];
          sendRetryRef.current = null;
          return;
        }
        ws.send('\r');
        fire(attempt + 1);
      }, INTERVAL);
      sendRetryRef.current = { timer, attempts: attempt };
    };
    fire(0);
  }, [ws]);

  /** Perform a real send now (caller guarantees ws.connected && state='live').
   *  - adds the text to the echo-dedup ring (non-slash only)
   *  - appends the user bubble to displayMessages (optimistic render)
   *  - writes to the PTY (bracketed-paste for normal text, raw for /commands)
   *  - arms the retry watcher (non-slash only) */
  const performSend = useCallback((text: string, isSlashCommand: boolean) => {
    if (!isSlashCommand) {
      recentSentRef.current.push(text);
      if (recentSentRef.current.length > 10) recentSentRef.current.shift();
    }
    setDisplayMessages((prev) => [...prev, {
      id: nextMsgId(),
      role: 'user' as const,
      content: text,
      ts: new Date().toISOString(),
    }].slice(-liveWindow));
    ws.send(isSlashCommand ? (text.replace(/\n/g, '\r') + '\r') : bracketedPaste(text));
    if (!isSlashCommand) armRetry();
  }, [ws, nextMsgId, liveWindow, armRetry]);

  // ── Flush queue when WS connected AND project is live ──
  //   Covers (a) initial-mount CONNECTING race, (b) mid-session reconnect,
  //   (c) stopped→waking→live (WS stays open; state transition triggers drain).
  //   Each drained message also resolves its caller's promise as 'delivered'.
  useEffect(() => {
    if (!ws.connected) return;
    if (state !== 'live') return;
    if (pendingQueueRef.current.length === 0) return;
    const queue = [...pendingQueueRef.current];
    pendingQueueRef.current = [];
    for (const p of queue) {
      if (p.timer) { clearTimeout(p.timer); p.timer = null; }
      performSend(p.text, p.isSlashCommand);
      p.resolve('delivered');
    }
  }, [ws.connected, state, performSend]);

  // Cleanup — on unmount, clear every per-pending 5s timer and resolve
  // each pending send as `'failed'` so awaiters (handleSend's post-await
  // `setSending(false)`) run instead of leaking timers + Promise closures
  // for up to SEND_TIMEOUT_MS after the component is gone. React 18
  // silently ignores setState on an unmounted component, so resolving here
  // is safe and gives cleaner semantics than orphaning the promises.
  useEffect(() => {
    return () => {
      if (wakingTimerRef.current) clearTimeout(wakingTimerRef.current);
      clearSendRetry();
      for (const p of pendingQueueRef.current) {
        if (p.timer) { clearTimeout(p.timer); p.timer = null; }
        p.resolve('failed');
      }
      pendingQueueRef.current = [];
    };
  }, [clearSendRetry]);

  // ── sendMessage (Promise-returning) ──
  //
  // Behavior (matches UX spec "消息没进入 CLI 则输入框保留内容"):
  //   · live + ws.connected + empty queue → performSend immediately → delivered
  //   · otherwise → enqueue, start 5s timer
  //     - queue drained by effect above (wake completes / ws reconnects) → delivered
  //     - 5s timer fires first → failed (message removed from queue, no bubble)
  //     - wake catches error / 10s wake timeout → failAllPending → failed
  //   · state=stopped|error triggers a fresh wake while the message sits in queue
  //
  // Slash commands (/model, /clear, /compact, plugin commands, …) are handled
  // by Claude TUI internally and NEVER produce a JSONL user-echo — they skip
  // recentSentRef / armRetry and use raw `text + \r` instead of bracketed
  // paste (Claude's `/` picker parses char-by-char, can't handle paste blocks).
  // See CLAUDE.md #36 and 2026-04-19 "Slash 命令不 echo" in 历史教训.md.
  const sendMessage = useCallback((text: string): Promise<SendResult> => {
    return new Promise<SendResult>((resolve) => {
      const isSlashCommand = text.trimStart().startsWith('/');

      const enqueue = () => {
        if (pendingQueueRef.current.length >= PENDING_QUEUE_CAP) {
          const dropped = pendingQueueRef.current.shift();
          if (dropped) {
            if (dropped.timer) clearTimeout(dropped.timer);
            dropped.resolve('failed');
          }
        }
        const pending: PendingSend = { text, isSlashCommand, resolve, timer: null };
        pendingQueueRef.current.push(pending);
        pending.timer = setTimeout(() => {
          const i = pendingQueueRef.current.indexOf(pending);
          if (i >= 0) pendingQueueRef.current.splice(i, 1);
          pending.timer = null;
          resolve('failed');
        }, SEND_TIMEOUT_MS);
      };

      if (state === 'live') {
        if (!ws.connected || pendingQueueRef.current.length > 0) {
          enqueue();
        } else {
          performSend(text, isSlashCommand);
          resolve('delivered');
        }
      } else if (state === 'waking') {
        enqueue();
      } else /* stopped | error */ {
        enqueue();
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
            failAllPending();
          });
        wakingTimerRef.current = setTimeout(() => {
          if (thisWake !== wakeIdRef.current) return;
          if (pendingQueueRef.current.length > 0) {
            toast.error('启动超时（10s）');
            setState('error');
            failAllPending();
          }
        }, 10000);
      }
    });
  }, [state, ws, projectId, performSend, failAllPending]);

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
