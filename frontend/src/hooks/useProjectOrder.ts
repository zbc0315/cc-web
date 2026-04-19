import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '@/types';
import { getProjectOrder, setProjectOrder as putProjectOrder } from '@/lib/api';

const CACHE_KEY = 'cc_project_order_cache';
const PUT_DEBOUNCE_MS = 400;

function loadCache(): string[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

function saveCache(order: string[]): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(order)); } catch { /* ignore quota */ }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Per-user project display order, shared across Dashboard / MonitorDashboard /
 * MobileProjectList.
 *
 * Semantics refined from a first pass that had two bugs the reviewer caught:
 *
 *   1. **Drop-on-contention** — `syncingRef` used to skip any write that came
 *      in while a PUT was in flight. Rapid drags lost updates silently.
 *      Now we coalesce via `pendingRef`: writes are debounced, and the most
 *      recent desired order always reaches the server.
 *
 *   2. **Hydration clobbering a local edit** — the initial server fetch used
 *      to unconditionally `setOrder(server)` on completion, overwriting any
 *      drag the user performed in the 50-500ms window before the response
 *      arrived. Now we track `hasLocalEdit`; if the user has edited locally
 *      before the hydration completes, the server response is ignored.
 *
 * `applyOrder(projects)` returns a sorted copy: ids in `order` come first in
 * saved order, ids not in `order` come after in original order.
 */
export function useProjectOrder() {
  const [order, setOrderState] = useState<string[]>(loadCache);

  const hasLocalEditRef = useRef(false);
  const pendingRef = useRef<string[] | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  // Refresh from server on mount — but only if the user hasn't already
  // edited locally (a drag between mount and server-response landing).
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    getProjectOrder()
      .then((serverOrder) => {
        if (cancelled || hasLocalEditRef.current) return;
        // Only replace state + cache if the server has an answer different
        // from what we already show — avoids a no-op render storm.
        setOrderState((prev) => (arraysEqual(prev, serverOrder) ? prev : serverOrder));
        saveCache(serverOrder);
      })
      .catch(() => { /* keep local cache */ });
    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  const flush = useCallback(async () => {
    // Serialize PUTs; when one returns, fire another if pending changed.
    while (pendingRef.current) {
      const toSend = pendingRef.current;
      pendingRef.current = null;
      inFlightRef.current = true;
      try {
        await putProjectOrder(toSend);
      } catch { /* server write failed — retained in local cache */ }
      inFlightRef.current = false;
      // If another write came in while we were sending, loop.
    }
  }, []);

  const commit = useCallback((next: string[]) => {
    hasLocalEditRef.current = true;
    setOrderState(next);
    saveCache(next);
    pendingRef.current = next;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      if (!mountedRef.current) return;
      if (!inFlightRef.current) void flush();
    }, PUT_DEBOUNCE_MS);
  }, [flush]);

  const applyOrder = useCallback(<T extends Project>(projects: T[]): T[] => {
    const idxMap = new Map(order.map((id, i) => [id, i]));
    return [...projects].sort((a, b) => {
      const ai = idxMap.get(a.id) ?? Infinity;
      const bi = idxMap.get(b.id) ?? Infinity;
      if (ai === bi) return 0;
      return ai - bi;
    });
  }, [order]);

  return useMemo(() => ({ order, setOrder: commit, applyOrder }), [order, commit, applyOrder]);
}
