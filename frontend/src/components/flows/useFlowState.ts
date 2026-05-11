import { useEffect, useRef, useState } from 'react';
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
 *  and avoids drift when the user comes back). */
export function useFlowState(projectId: string | null): UseFlowState {
  const [state, setState] = useState<FlowState | null>(null);
  const [running, setRunning] = useState(false);
  const cancelledRef = useRef(false);

  const fetchOnce = async () => {
    if (!projectId || cancelledRef.current) return;
    try {
      const r = await getFlowState(projectId);
      if (cancelledRef.current) return;
      setState(r.state);
      setRunning(r.running);
    } catch {
      /* keep last known state */
    }
  };

  useEffect(() => {
    if (!projectId) {
      setState(null);
      setRunning(false);
      return;
    }
    cancelledRef.current = false;
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
      cancelledRef.current = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return { state, running, refresh: fetchOnce };
}
