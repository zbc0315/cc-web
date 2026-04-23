import { useState, useEffect, useCallback, useRef } from 'react';
import { Clock, RefreshCw, Repeat, Timer } from 'lucide-react';
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

interface ScheduledTasksPanelProps {
  projectId: string;
}

export function ScheduledTasksPanel({ projectId }: ScheduledTasksPanelProps) {
  const [tasks, setTasks] = useState<ScheduledTask[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { tasks: t } = await getScheduledTasks(projectId);
      if (!mountedRef.current) return;
      setTasks(t);
    } catch (e) {
      if (!mountedRef.current) return;
      setError((e as Error).message);
      setTasks([]);
    } finally {
      if (mountedRef.current) setLoading(false);
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
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 text-destructive p-2 text-xs">
            {error}
          </div>
        )}

        {!error && tasks && tasks.length === 0 && !loading && (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            <p>本项目暂无已排程任务</p>
            <p className="mt-2 leading-relaxed">
              仅显示 <code className="text-[10px] bg-muted-foreground/10 px-1 rounded">durable</code> 任务
              （Claude 通过 <code className="text-[10px] bg-muted-foreground/10 px-1 rounded">/loop</code> 或
              {' '}<code className="text-[10px] bg-muted-foreground/10 px-1 rounded">CronCreate&nbsp;durable:true</code> 创建的）。
            </p>
            <p className="mt-1 text-muted-foreground/70">session-only 任务在 CLI 内存中，此处不可见。</p>
          </div>
        )}

        {tasks && tasks.map((t) => {
          const nextMs = t.nextFireAt ? Date.parse(t.nextFireAt) : null;
          const lastMs = t.lastFiredAt ?? null;
          return (
            <div
              key={t.id}
              className="rounded-md border border-border bg-background px-2.5 py-2 text-xs"
            >
              <div className="flex items-start gap-2">
                <div className="shrink-0 mt-0.5 text-muted-foreground">
                  {t.recurring ? <Repeat className="size-3.5" /> : <Timer className="size-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground line-clamp-2 leading-snug">
                    {t.prompt.trim() || '(无 prompt)'}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
                    <code className="text-[10px] bg-muted-foreground/10 px-1 rounded font-mono">{t.cron}</code>
                    <span className="text-muted-foreground/50">·</span>
                    <span>{t.id.slice(0, 8)}</span>
                    {t.recurring && (
                      <>
                        <span className="text-muted-foreground/50">·</span>
                        <span>循环</span>
                      </>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    {nextMs !== null && (
                      <span title={formatAbsolute(nextMs)}>
                        下次: <span className="text-foreground/90">{formatRelative(nextMs)}</span>
                      </span>
                    )}
                    {lastMs !== null && (
                      <span title={formatAbsolute(lastMs)}>
                        上次: <span className="text-foreground/90">{formatRelative(lastMs)}</span>
                      </span>
                    )}
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
