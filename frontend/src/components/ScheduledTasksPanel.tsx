import { useState, useEffect, useCallback, useRef } from 'react';
import { Clock, RefreshCw, Repeat, Timer, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getScheduledTasks, ScheduledTask } from '@/lib/api';
import { cn } from '@/lib/utils';

function formatRelative(ts: number | null): string {
  if (!ts) return '-';
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const past = diff < 0;
  const sec = Math.round(abs / 1000);
  if (sec < 60) return past ? `${sec} 秒前` : `${sec} 秒后`;
  const min = Math.round(sec / 60);
  if (min < 60) return past ? `${min} 分钟前` : `${min} 分钟后`;
  const hr = Math.round(min / 60);
  if (hr < 24) return past ? `${hr} 小时前` : `${hr} 小时后`;
  const day = Math.round(hr / 24);
  return past ? `${day} 天前` : `${day} 天后`;
}

function formatAbsolute(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatDelaySeconds(s: number): string {
  if (s < 60) return `${s} 秒后`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} 分钟后`;
  const hr = Math.round((min / 60) * 10) / 10;
  return `${hr} 小时后`;
}

interface ScheduledTasksPanelProps {
  projectId: string;
}

export function ScheduledTasksPanel({ projectId }: ScheduledTasksPanelProps) {
  const [tasks, setTasks] = useState<ScheduledTask[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const mountedRef = useRef(true);

  const reqIdRef = useRef(0);
  const refresh = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const { tasks: t } = await getScheduledTasks(projectId);
      if (!mountedRef.current || myReq !== reqIdRef.current) return;
      setTasks(t);
    } catch (e) {
      if (!mountedRef.current || myReq !== reqIdRef.current) return;
      setError((e as Error).message);
      setTasks([]);
    } finally {
      if (mountedRef.current && myReq === reqIdRef.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const poll = setInterval(() => { void refresh(); }, 30_000);
    const ticker = setInterval(() => setTick((x) => x + 1), 1000);
    return () => {
      mountedRef.current = false;
      clearInterval(poll);
      clearInterval(ticker);
    };
  }, [refresh]);

  return (
    <div className="h-full flex flex-col bg-muted text-foreground overflow-hidden">
      <div className="flex-shrink-0 px-3 py-2 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Clock className="size-4" />
          <span>已排程任务</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => { void refresh(); }}
          title="刷新"
          aria-label="刷新"
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
        <div className="rounded-md bg-muted-foreground/5 px-2 py-1.5 text-[11px] text-muted-foreground flex items-start gap-1.5">
          <Info className="size-3 mt-0.5 shrink-0" />
          <span className="leading-snug">
            best-effort 重建：从 session JSONL 反推「Claude 创建过的 schedule」，
            <strong className="text-foreground/80">不是</strong>权威活动列表。已触发 / 已删除 无法直接观测。
          </span>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 text-destructive p-2 text-xs">
            {error}
          </div>
        )}

        {!error && tasks && tasks.length === 0 && !loading && (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            <p>本项目最近 7 天没有创建过 schedule。</p>
            <p className="mt-2 leading-relaxed">
              一次性 ScheduleWakeup 触发时间过了的会被隐藏（认为已触发）；
              CronCreate 仅显示 7 天内创建的（与 Claude 自动过期窗口对齐）。
            </p>
          </div>
        )}

        {tasks && tasks.map((t) => {
          const nextMs = t.nextFireAt ? Date.parse(t.nextFireAt) : null;
          const isRecurring = t.type === 'CronCreate' && (t.recurring || /[,*\/-]/.test(t.cron ?? ''));
          const triggerSpec =
            t.type === 'ScheduleWakeup' && t.delaySeconds !== null
              ? formatDelaySeconds(t.delaySeconds)
              : t.cron ?? '?';
          return (
            <div
              key={`${t.sessionId}:${t.id}`}
              className="rounded-md border border-border bg-background px-2.5 py-2 text-xs"
            >
              <div className="flex items-start gap-2">
                <div className="shrink-0 mt-0.5 text-muted-foreground">
                  {isRecurring ? <Repeat className="size-3.5" /> : <Timer className="size-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1 mb-1">
                    <span className="text-[10px] font-mono px-1.5 rounded bg-muted-foreground/10 text-muted-foreground">
                      {t.type === 'ScheduleWakeup' ? 'SW' : 'CC'}
                    </span>
                    {t.durable && (
                      <span className="text-[10px] px-1.5 rounded bg-primary/10 text-primary">durable</span>
                    )}
                    <code className="text-[10px] bg-muted-foreground/10 px-1 rounded font-mono">
                      {triggerSpec}
                    </code>
                  </div>

                  <div className="font-medium text-foreground line-clamp-2 leading-snug">
                    {t.prompt.trim() || '(无 prompt)'}
                  </div>

                  {t.reason && (
                    <div className="mt-0.5 text-muted-foreground line-clamp-1 italic text-[11px]">
                      reason: {t.reason}
                    </div>
                  )}

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    {nextMs !== null && (
                      <span title={formatAbsolute(nextMs)}>
                        下次: <span className="text-foreground/90">{formatRelative(nextMs)}</span>
                      </span>
                    )}
                    <span title={formatAbsolute(t.createdAt)}>
                      创建: {formatRelative(t.createdAt)}
                    </span>
                    <span className="font-mono text-muted-foreground/70">
                      {t.sessionId.slice(0, 8)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {loading && !tasks && (
          <div className="space-y-1.5">
            {[0, 1].map((i) => (
              <div key={i} className="rounded-md border border-border bg-background px-2.5 py-2 h-16 animate-pulse" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
