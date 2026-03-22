import { getBackupConfig } from './config';
import { runBackupAll, ProgressCallback } from './engine';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startScheduler(onProgress?: ProgressCallback): void {
  stopScheduler();
  const config = getBackupConfig();
  if (!config.schedule.enabled) return;

  const intervalMs = config.schedule.intervalMinutes * 60 * 1000;
  console.log(`[Backup] Scheduler started: every ${config.schedule.intervalMinutes} minutes`);

  timer = setInterval(async () => {
    if (running) {
      console.log('[Backup] Skipping scheduled backup — previous one still running');
      return;
    }
    running = true;
    try {
      console.log('[Backup] Scheduled backup starting...');
      const results = await runBackupAll(onProgress);
      const ok = results.filter((r) => r.status === 'success').length;
      const fail = results.filter((r) => r.status === 'failed').length;
      console.log(`[Backup] Scheduled backup done: ${ok} success, ${fail} failed`);
    } catch (err) {
      console.error('[Backup] Scheduled backup error:', err);
    } finally {
      running = false;
    }
  }, intervalMs);
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[Backup] Scheduler stopped');
  }
}

export function restartScheduler(onProgress?: ProgressCallback): void {
  stopScheduler();
  startScheduler(onProgress);
}

export function isSchedulerRunning(): boolean {
  return timer !== null;
}
