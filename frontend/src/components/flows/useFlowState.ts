import { useCallback, useEffect, useRef, useState } from 'react';
import { getFlowState } from './api';
import type { FlowState } from './types';

const POLL_MS = 2000;

interface UseFlowState {
  state: FlowState | null;
  running: boolean;
  /** Force an immediate refetch — call after mutating actions (run / resume /
   *  abort / submitInput) so the UI updates without waiting for the next tick. */
  refresh: () => void;
}

/** Polls /api/projects/:id/flows/state on a 2s interval. Stops on unmount.
 *  Pauses while the document is hidden (saves bandwidth on background tabs
 *  and avoids drift when the user comes back).
 *
 *  Race-safe across projectId changes: a `pidRef` always tracks the latest
 *  projectId, so an in-flight fetch from an unmounted-but-resurrected effect
 *  cycle can't apply stale state to a different project. */
export function useFlowState(projectId: string | null): UseFlowState {
  const [state, setState] = useState<FlowState | null>(null);
  const [running, setRunning] = useState(false);
  const pidRef = useRef(projectId);
  pidRef.current = projectId;

  const fetchOnce = useCallback(async () => {
    const pid = pidRef.current;
    if (!pid) return;
    try {
      const r = await getFlowState(pid);
      // After await, compare to ref — if projectId changed during the
      // request, drop the result rather than apply stale data.
      if (pid !== pidRef.current) return;
      setState(r.state);
      setRunning(r.running);
    } catch {
      /* keep last known state */
    }
  }, []);

  useEffect(() => {
    if (!projectId) {
      setState(null);
      setRunning(false);
      return;
    }
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      void fetchOnce();
      timer = setInterval(() => { void fetchOnce(); }, POLL_MS);
    };
    const stop = () => {
      if (timer !== null) { clearInterval(timer); timer = null; }
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else if (!timer) start();
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [projectId, fetchOnce]);

  return { state, running, refresh: fetchOnce };
}
