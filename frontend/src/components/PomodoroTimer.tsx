import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getStorage, STORAGE_KEYS } from '@/lib/storage';

export interface PomodoroConfig {
  workMinutes: number;
  breakMinutes: number;
}

export const DEFAULT_POMODORO_CONFIG: PomodoroConfig = {
  workMinutes: 30,
  breakMinutes: 5,
};

export function getPomodoroConfig(): PomodoroConfig {
  return getStorage<PomodoroConfig>(STORAGE_KEYS.pomodoroConfig, DEFAULT_POMODORO_CONFIG, true);
}

type Phase = 'work' | 'break';

function notify(message: string) {
  if (Notification.permission === 'granted') {
    new Notification('番茄钟', { body: message, icon: '/favicon.ico' });
  }
}

export function PomodoroTimer() {
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase>('work');
  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    const cfg = getPomodoroConfig();
    return cfg.workMinutes * 60;
  });

  const switchPhase = useCallback((nextPhase: Phase) => {
    const cfg = getPomodoroConfig();
    setPhase(nextPhase);
    setSecondsLeft(nextPhase === 'work' ? cfg.workMinutes * 60 : cfg.breakMinutes * 60);
    notify(nextPhase === 'break' ? '休息一下 ☕' : '该工作了 💻');
  }, []);

  // setTimeout-based countdown — re-runs each second
  useEffect(() => {
    if (!running) return;
    if (secondsLeft === 0) {
      switchPhase(phase === 'work' ? 'break' : 'work');
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [running, secondsLeft, phase, switchPhase]);

  const toggle = () => {
    if (!running) {
      // Reset to fresh work phase and request notification permission
      const cfg = getPomodoroConfig();
      setPhase('work');
      setSecondsLeft(cfg.workMinutes * 60);
      if (Notification.permission === 'default') {
        void Notification.requestPermission();
      }
    } else {
      // Stop and reset
      const cfg = getPomodoroConfig();
      setPhase('work');
      setSecondsLeft(cfg.workMinutes * 60);
    }
    setRunning((prev) => !prev);
  };

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return (
    <>
      <button
        onClick={toggle}
        className={cn(
          'p-1 rounded transition-colors',
          running
            ? phase === 'work'
              ? 'text-red-500 bg-red-500/10 hover:bg-red-500/20'
              : 'text-green-500 bg-green-500/10 hover:bg-green-500/20'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        )}
        title={running ? (phase === 'work' ? `工作中 ${timeStr} — 点击停止` : `休息中 ${timeStr} — 点击停止`) : '启动番茄钟'}
      >
        <Timer className="h-4 w-4" />
      </button>

      {running &&
        createPortal(
          <div
            className="fixed inset-0 flex flex-col items-center justify-center pointer-events-none z-40 select-none"
            style={{ opacity: phase === 'work' ? 0.8 : 0.5 }}
          >
            <div
              className={cn(
                'font-mono font-bold tabular-nums leading-none',
                phase === 'work' ? 'text-foreground' : 'text-blue-400 dark:text-blue-300'
              )}
              style={{ fontSize: 'clamp(72px, 18vw, 220px)' }}
            >
              {timeStr}
            </div>
            <div
              className="mt-3 text-muted-foreground font-medium tracking-widest uppercase"
              style={{ fontSize: 'clamp(12px, 1.5vw, 20px)' }}
            >
              {phase === 'work' ? '专注工作' : '休息一下'}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
