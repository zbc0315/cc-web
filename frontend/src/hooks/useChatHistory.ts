import { useState, useEffect, useRef, useCallback } from 'react';
import { getChatHistory } from '@/lib/api';
import type { ChatBlockItem, ChatMessage } from '@/lib/websocket';
import { formatChatContent } from '@/lib/chatUtils';

/**
 * Unified chat message shape used by the message list.
 * - `id` is the stable backend block id (sha1 of jsonl path + line) when
 *   available; falls back to a local counter for very old backends.
 * - `content` is pre-formatted markdown (text blocks + fenced non-text blocks)
 *   for immediate rendering by AssistantMessageContent.
 * - `blocks` is retained for future block-aware rendering (Phase 4).
 */
export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  blocks?: ChatBlockItem[];
  ts: string;
}

export function toChatMsg(m: ChatMessage, fallbackId: () => string): ChatMsg {
  return {
    id: m.id ?? fallbackId(),
    role: m.role,
    content: formatChatContent(m.blocks),
    blocks: m.blocks,
    ts: m.timestamp,
  };
}

interface UseChatHistoryOptions {
  projectId: string;
  /** Initial page size and each load-more batch size. Default 20. */
  historyLimit?: number;
  /** When false the hook is quiescent (no fetches). Default true. */
  enabled?: boolean;
}

interface UseChatHistoryResult {
  history: ChatMsg[];
  hasMore: boolean;
  isLoading: boolean;
  /** Replace the history with a fresh latest-N fetch (e.g. on WS reconnect
   *  or 3-second live-fallback). Safe to call anytime. */
  reload: () => Promise<void>;
  /** Prepend the next older batch (for "load earlier messages" button). */
  loadMore: () => Promise<void>;
}

/**
 * Phase 1a of chat unification: load-and-paginate ChatMsg[] from
 * GET /api/projects/:id/chat-history. Shared by ChatOverlay (desktop),
 * MobileChatView (mobile), and MonitorPane (monitor).
 *
 * Consumers own the "when to reload" logic (on WS reconnect, on 3-second
 * live-fallback, on project wake, etc.) — the hook just exposes reload().
 */
export function useChatHistory({
  projectId,
  historyLimit = 20,
  enabled = true,
}: UseChatHistoryOptions): UseChatHistoryResult {
  const [history, setHistory] = useState<ChatMsg[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Fallback id for pre-Phase-2 backends that don't populate block.id.
  // Also ensures local-session-only stability if the server response is
  // temporarily missing ids.
  const fallbackIdRef = useRef(0);
  const nextFallbackId = useCallback(() => `h${++fallbackIdRef.current}`, []);

  // Track the latest projectId/enabled to make stale-response handling explicit
  // when the hook re-runs with new inputs.
  const activeRef = useRef({ projectId, enabled });
  activeRef.current = { projectId, enabled };

  const reload = useCallback(async () => {
    if (!activeRef.current.enabled) return;
    const pid = activeRef.current.projectId;
    setIsLoading(true);
    try {
      const res = await getChatHistory(pid, { limit: historyLimit });
      // Stale check: projectId changed during the fetch
      if (activeRef.current.projectId !== pid) return;
      const msgs: ChatMsg[] = [];
      for (const b of res.blocks) {
        const cm = toChatMsg(b, nextFallbackId);
        if (!cm.content.trim()) continue;
        msgs.push(cm);
      }
      setHistory(msgs);
      setHasMore(res.hasMore);
    } catch {
      // Best-effort: surface silently, don't trash existing history
    } finally {
      setIsLoading(false);
    }
  }, [historyLimit, nextFallbackId]);

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading || history.length === 0) return;
    if (!activeRef.current.enabled) return;
    const pid = activeRef.current.projectId;
    const oldest = history[0];
    // Only id-backed cursors are supported server-side; skip if missing
    // (happens only with pre-Phase-2 fallback ids).
    if (!oldest.id || oldest.id.startsWith('h')) return;
    setIsLoading(true);
    try {
      const res = await getChatHistory(pid, { limit: historyLimit, before: oldest.id });
      if (activeRef.current.projectId !== pid) return;
      const older: ChatMsg[] = [];
      for (const b of res.blocks) {
        const cm = toChatMsg(b, nextFallbackId);
        if (!cm.content.trim()) continue;
        older.push(cm);
      }
      setHistory((prev) => [...older, ...prev]);
      setHasMore(res.hasMore);
    } catch {
      // Ignore
    } finally {
      setIsLoading(false);
    }
  }, [historyLimit, hasMore, isLoading, history, nextFallbackId]);

  // Initial load when the hook becomes enabled or the projectId changes.
  useEffect(() => {
    if (!enabled) return;
    void reload();
    // reload is stable modulo historyLimit, which doesn't change at runtime
    // in our usage; keep deps tight to avoid re-fetch loops on history updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, enabled]);

  return { history, hasMore, isLoading, reload, loadMore };
}
