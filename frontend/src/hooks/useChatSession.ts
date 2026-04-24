import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { startProject } from '@/lib/api';
import { formatChatContent } from '@/lib/chatUtils';
import type { ChatMessage } from '@/lib/websocket';
import { toast } from 'sonner';
import type { Project } from '@/types';
import { bracketedPaste } from '@/lib/ptyPaste';
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
  /** Send a message through the WS with queue + wake flow.
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
  isWaking: boolean;
  isRunning: boolean;
}

/** Max number of un-flushed messages held while WS is disconnected or the
 *  project is still waking up. Caps unbounded growth if a wake fails. */
const PENDING_QUEUE_CAP = 20;

/** A pending send (status='sent' or 'queued') expires after this many ms if
 *  the CLI never echoes the user message back in its JSONL. Resolves as
 *  `'failed'` so the UI restores the text to the input box (UX spec: "没进
 *  入 CLI 则输入框保留消息"). 30s covers Claude's cold-start-to-first-token
 *  latency with margin — well past the wake timeout (10s) so wake-path
 *  failures still surface via `failAllPending`. */
const SEND_TIMEOUT_MS = 30000;

/** Per-send bookkeeping. Lives in `pendingSendsRef` from the moment the
 *  caller awaits `sendMessage` until one of three terminal events fires:
 *    - `status === 'queued'` and WS reconnects / project wakes → drain
 *      effect calls `performSend`, flips status to 'sent'
 *    - `status === 'sent'` and the CLI echoes the user message → echo
 *      consume effect resolves('delivered') and removes this pending
 *    - 30s timer fires before echo arrives → resolve('failed'), remove
 *
 *  `id` is assigned by the client; `displayId` points at the optimistic
 *  user bubble that was appended to displayMessages when performSend ran,
 *  so failed sends can retract the bubble cleanly. */
interface PendingSend {
  id: string;
  text: string;
  isSlashCommand: boolean;
  status: 'queued' | 'sent';
  displayId?: string;
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

  // ── Pending sends + echo-dedup (single source of truth) ──
  // `pendingSendsRef` holds every in-flight send from the moment the
  // caller awaits `sendMessage` until the CLI echoes the user message
  // back (→ resolve 'delivered') or the 30s timer fires (→ resolve
  // 'failed'). Replaces the old split between `pendingQueueRef` (queued)
  // and `recentSentRef: string[]` (sent, text-only) — two stores were
  // hard to keep coherent and meant the 'sent' side had no resolve
  // channel, forcing v-d to rely on ws.send-succeeded as delivered.
  // Now every pending carries id / status / resolve / timer / displayId,
  // so echo-matching flips status 'sent' → resolved and retracts the
  // optimistic bubble on failed timeouts.
  const pendingSendsRef = useRef<PendingSend[]>([]);
  const pendingIdRef = useRef(0);
  const nextPendingId = useCallback(() => `p${++pendingIdRef.current}`, []);
  const liveReceivedRef = useRef(false);

  // ── Consume live WS messages ──
  const prevLiveCountRef = useRef(0);
  useEffect(() => {
    // Reset the "how many liveMessages have we already consumed" pointer
    // on WS reconnect (parent clears the array → length shrinks). We
    // deliberately do NOT clear pendingSendsRef here — in-flight sends
    // should survive reconnection and still match their JSONL echo when
    // the server replays `chat_subscribe`. Previous code nuked the echo
    // ring here, turning every in-flight message into a zombie timing
    // out at 30s.
    if (liveMessages.length < prevLiveCountRef.current) {
      prevLiveCountRef.current = 0;
    }
    if (liveMessages.length <= prevLiveCountRef.current) return;
    const newMsgs = liveMessages.slice(prevLiveCountRef.current);
    prevLiveCountRef.current = liveMessages.length;

    for (const msg of newMsgs) {
      liveReceivedRef.current = true;
      const content = formatChatContent(msg.blocks);
      if (!content.trim()) continue;
      if (msg.role === 'user') {
        // Own-echo: find the earliest `status='sent'` pending whose
        // text matches this echo. Matching is by content (CLI doesn't
        // know our client-side ids), but we store the pending under a
        // unique id so the resolve/timer/displayId are safely routed
        // back to the correct awaiter even with duplicate-text sends.
        const trimmed = content.trim();
        const idx = pendingSendsRef.current.findIndex(
          (p) => p.status === 'sent' && p.text.trim() === trimmed,
        );
        if (idx !== -1) {
          const match = pendingSendsRef.current[idx];
          pendingSendsRef.current.splice(idx, 1);
          if (match.timer) { clearTimeout(match.timer); match.timer = null; }
          // Rewrite the optimistic bubble's id to the backend block id
          // so future WS replay dedupes against it. Without this, a
          // reconnect that replays this same user message would fall
          // through to the `setDisplayMessages` branch below and
          // double-render the user bubble.
          if (match.displayId && msg.id) {
            const serverId = msg.id;
            setDisplayMessages((prev) =>
              prev.map((b) => b.id === match.displayId ? { ...b, id: serverId } : b),
            );
          }
          match.resolve('delivered');
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
  }, [liveMessages, nextMsgId, liveWindow]);

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

  // ── Wake state ──
  const wakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeIdRef = useRef(0);

  /** Retract an optimistic user bubble whose pending send has failed, so
   *  the input-field refill the caller does on 'failed' isn't visually
   *  duplicated by a ghost bubble sitting in chat history. */
  const retractBubble = useCallback((displayId: string | undefined) => {
    if (!displayId) return;
    setDisplayMessages((prev) => prev.filter((b) => b.id !== displayId));
  }, []);

  /** Resolve every pending send as failed and retract any optimistic
   *  bubbles. Called from wake failure / wake timeout, plus unmount
   *  cleanup. */
  const failAllPending = useCallback(() => {
    const sends = pendingSendsRef.current;
    pendingSendsRef.current = [];
    for (const p of sends) {
      if (p.timer) { clearTimeout(p.timer); p.timer = null; }
      if (p.status === 'sent') retractBubble(p.displayId);
      p.resolve('failed');
    }
  }, [retractBubble]);

  /** Transition a pending send from 'queued' to 'sent': append the
   *  optimistic user bubble, write bytes to the PTY. The pending's
   *  30s timer is already armed by `sendMessage`; `performSend`
   *  doesn't restart it. If the CLI echoes back within 30s, echo
   *  consume resolves 'delivered'; if not, timer fires 'failed' and
   *  the bubble is retracted.
   *
   *  Bracketed-paste wrapper for normal text so Ink's paste heuristic
   *  treats the body as paste (internal \r = soft newlines) and the
   *  trailing \r outside the markers as the Enter keypress that
   *  actually submits. Raw text+\r for slash commands because Claude's
   *  `/` picker parses char-by-char and doesn't understand bracketed-
   *  paste blocks. */
  const performSend = useCallback((pending: PendingSend) => {
    const displayId = nextMsgId();
    pending.displayId = displayId;
    pending.status = 'sent';
    setDisplayMessages((prev) => [...prev, {
      id: displayId,
      role: 'user' as const,
      content: pending.text,
      ts: new Date().toISOString(),
    }].slice(-liveWindow));
    ws.send(
      pending.isSlashCommand
        ? (pending.text.replace(/\n/g, '\r') + '\r')
        : bracketedPaste(pending.text),
    );
  }, [ws, nextMsgId, liveWindow]);

  // ── Flush queued sends when WS connected AND project is live ──
  //   Covers (a) initial-mount CONNECTING race, (b) mid-session reconnect,
  //   (c) stopped→waking→live. Each drained 'queued' pending transitions
  //   to 'sent' via performSend; the 30s timer armed by sendMessage keeps
  //   running, so slow wake → fast-drain + normal echo still resolves
  //   'delivered' in the echo-consume effect above.
  useEffect(() => {
    if (!ws.connected) return;
    if (state !== 'live') return;
    const queued = pendingSendsRef.current.filter((p) => p.status === 'queued');
    if (queued.length === 0) return;
    for (const p of queued) {
      performSend(p);
      // Slash commands never produce a JSONL user-echo; there's nothing
      // for echo consume to match. Resolve immediately after writing
      // bytes and splice out of the pending ring — otherwise the 30s
      // timer would falsely fire 'failed' on a successfully-sent
      // slash command. `sendMessage` handles the live+connected case
      // synchronously; this branch handles the post-drain (wake) case.
      if (p.isSlashCommand) {
        const idx = pendingSendsRef.current.indexOf(p);
        if (idx !== -1) pendingSendsRef.current.splice(idx, 1);
        if (p.timer) { clearTimeout(p.timer); p.timer = null; }
        p.resolve('delivered');
      }
    }
  }, [ws.connected, state, performSend]);

  // Cleanup — on unmount, clear every pending's 30s timer and resolve
  // as 'failed' so awaiters (handleSend's post-await setSending(false))
  // run instead of leaking timers + Promise closures for up to 30s
  // after the component is gone. React 18 silently ignores setState
  // on unmounted components, so resolving here is safe.
  useEffect(() => {
    return () => {
      if (wakingTimerRef.current) clearTimeout(wakingTimerRef.current);
      for (const p of pendingSendsRef.current) {
        if (p.timer) { clearTimeout(p.timer); p.timer = null; }
        p.resolve('failed');
      }
      pendingSendsRef.current = [];
    };
  }, []);

  // ── sendMessage (Promise-returning) ──
  //
  // Behavior (matches UX spec "消息没进入 CLI 则输入框保留内容"):
  //   1. Create pending with status='queued' + 30s timer + optimistic
  //      bubble will be appended when performSend fires.
  //   2. live + ws.connected → performSend immediately (status → 'sent',
  //      bytes written). The 30s timer keeps ticking.
  //   3. waking / stopped / error / disconnected → pending sits in
  //      'queued' state; drain effect picks it up when state flips to
  //      live + ws.connected.
  //   4. CLI echoes user message in JSONL → echo consume effect
  //      resolves 'delivered' and splices the pending.
  //   5. 30s timer fires before echo → resolve 'failed', splice pending,
  //      retract optimistic bubble. Caller's handleSend sees 'failed'
  //      and refills the input.
  //   6. stopped/error state also triggers a fresh wake; wake-catch /
  //      10s wake-timeout → failAllPending.
  //
  // Slash commands (/model, /clear, /compact, plugin commands, …) are
  // handled by Claude TUI internally and NEVER produce a JSONL user-
  // echo — there's no echo to resolve on. For slash commands, resolve
  // 'delivered' synchronously right after ws.send (best signal we have);
  // they skip the 30s timer arm.
  const sendMessage = useCallback((text: string): Promise<SendResult> => {
    return new Promise<SendResult>((resolve) => {
      const isSlashCommand = text.trimStart().startsWith('/');

      // Drop oldest if cap exceeded, so a pathological sender can't grow
      // the ring without bound during a long WS outage.
      if (pendingSendsRef.current.length >= PENDING_QUEUE_CAP) {
        const dropped = pendingSendsRef.current.shift();
        if (dropped) {
          if (dropped.timer) clearTimeout(dropped.timer);
          if (dropped.status === 'sent') retractBubble(dropped.displayId);
          dropped.resolve('failed');
        }
      }

      const pending: PendingSend = {
        id: nextPendingId(),
        text,
        isSlashCommand,
        status: 'queued',
        resolve,
        timer: null,
      };
      pendingSendsRef.current.push(pending);

      // Slash commands: no echo to wait for. Send + resolve immediately
      // if possible, no 30s timer.
      if (isSlashCommand) {
        if (state === 'live' && ws.connected) {
          performSend(pending);
          // Remove from pending ring — we won't wait for echo.
          const idx = pendingSendsRef.current.indexOf(pending);
          if (idx !== -1) pendingSendsRef.current.splice(idx, 1);
          resolve('delivered');
          return;
        }
        // Otherwise: let drain path handle it. But we still need to
        // resolve eventually; arm a short-ish timer so slash commands
        // don't hang the UI if wake fails.
        pending.timer = setTimeout(() => {
          const i = pendingSendsRef.current.indexOf(pending);
          if (i !== -1) pendingSendsRef.current.splice(i, 1);
          pending.timer = null;
          if (pending.status === 'sent') retractBubble(pending.displayId);
          resolve('failed');
        }, SEND_TIMEOUT_MS);
      } else {
        // Non-slash: arm the 30s wait-for-echo timer.
        pending.timer = setTimeout(() => {
          const i = pendingSendsRef.current.indexOf(pending);
          if (i !== -1) pendingSendsRef.current.splice(i, 1);
          pending.timer = null;
          if (pending.status === 'sent') retractBubble(pending.displayId);
          resolve('failed');
        }, SEND_TIMEOUT_MS);
      }


      if (state === 'live' && ws.connected) {
        performSend(pending);
        // For non-slash, leave pending in the ring; echo consume will
        // resolve 'delivered' and drop it. (Slash returned earlier.)
      } else if (state === 'waking' || state === 'live') {
        // Queued; drain effect will pick up when both conditions hold.
      } else /* stopped | error */ {
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
          if (pendingSendsRef.current.some((p) => p.status === 'queued')) {
            toast.error('启动超时（10s）');
            setState('error');
            failAllPending();
          }
        }, 10000);
      }
    });
  }, [state, ws, projectId, performSend, failAllPending, retractBubble, nextPendingId]);

  // ── appendUserMessage ──
  // Public helper that appends a user bubble without going through the
  // send pipeline. Intended for flows where the caller writes to the
  // PTY through some other channel and just wants the chat UI to show
  // the text. Currently exposed via ChatOverlay's imperative handle but
  // no in-tree caller actually invokes it — leaving it wired in case
  // future panels do. Registers a `status='sent'` pending with a no-op
  // resolve so the eventual JSONL echo isn't rendered as a duplicate.
  const appendUserMessage = useCallback((text: string) => {
    const clean = text.replace(/\r$/, '').trim();
    if (!clean) return;
    const displayId = nextMsgId();
    setDisplayMessages((prev) => [...prev, {
      id: displayId,
      role: 'user' as const,
      content: clean,
      ts: new Date().toISOString(),
    }].slice(-liveWindow));
    const ghost: PendingSend = {
      id: nextPendingId(),
      text: clean,
      isSlashCommand: false,
      status: 'sent',
      displayId,
      resolve: () => { /* external sender doesn't await */ },
      timer: setTimeout(() => {
        const i = pendingSendsRef.current.indexOf(ghost);
        if (i !== -1) pendingSendsRef.current.splice(i, 1);
        ghost.timer = null;
      }, SEND_TIMEOUT_MS),
    };
    pendingSendsRef.current.push(ghost);
  }, [nextMsgId, nextPendingId, liveWindow]);

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
    isWaking: state === 'waking',
    isRunning: state === 'live',
  };
}
