import { useEffect, useRef } from 'react';
import { recordDevTime } from '@/lib/api';

const BEAT_MS = 30_000;      // flush accumulated dwell time every 30s
const MAX_BEAT_S = 120;      // ignore implausibly long gaps (sleep/clock jump)

/**
 * Tracks how long the user stays on a project detail page and reports it to the
 * backend in periodic best-effort beats. Counts time ONLY while the page is
 * visible (Page Visibility API): switching tabs, minimizing, or unmounting
 * flushes the pending elapsed time and pauses the clock.
 */
export function useDevTimeTracker(projectId: string | undefined): void {
  // 0 = not currently counting; otherwise the epoch-ms of the last flush.
  const lastRef = useRef(0);

  useEffect(() => {
    if (!projectId) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const isVisible = () => document.visibilityState === 'visible';

    const flush = () => {
      if (lastRef.current === 0) return;
      const now = Date.now();
      const secs = Math.round((now - lastRef.current) / 1000);
      lastRef.current = now;
      if (secs >= 1) void recordDevTime(projectId, Math.min(secs, MAX_BEAT_S)).catch(() => {});
    };

    const start = () => {
      if (lastRef.current !== 0) return;
      lastRef.current = Date.now();
      timer = setInterval(flush, BEAT_MS);
    };

    const stop = () => {
      flush();
      if (timer) { clearInterval(timer); timer = null; }
      lastRef.current = 0;
    };

    const onVisibility = () => { if (isVisible()) start(); else stop(); };

    if (isVisible()) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [projectId]);
}
