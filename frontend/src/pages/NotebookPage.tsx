import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Notebook, Clock, ListTodo, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getDevTimeStats, type DevTimePeriod, type DevTimeStats } from '@/lib/api';
import { TodoView } from '@/components/TodoView';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

const IS_MOBILE_DEVICE =
  window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 768;

function useDuration() {
  const { t } = useTranslation();
  return (secs: number): string => {
    if (secs < 60) return `${secs}${t('notebook.u_s')}`;
    const m = Math.floor(secs / 60);
    if (m < 60) return `${m}${t('notebook.u_m')}`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${h}${t('notebook.u_h')}${rem}${t('notebook.u_m')}` : `${h}${t('notebook.u_h')}`;
  };
}

function DevTimeStatsView() {
  const { t } = useTranslation();
  const fmt = useDuration();
  const [period, setPeriod] = useState<DevTimePeriod>('day');
  const [stats, setStats] = useState<DevTimeStats | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: DevTimePeriod) => {
    setLoading(true);
    try {
      setStats(await getDevTimeStats(p));
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(period); }, [period, load]);

  const periods: DevTimePeriod[] = ['day', 'week', 'month'];
  const currentLabel = t(`notebook.current_${period}`);

  // Totals across all projects, per bucket, for the trend chart + headline.
  const bucketTotals = stats
    ? stats.buckets.map((_, i) => stats.projects.reduce((s, p) => s + p.values[i], 0))
    : [];
  const headline = bucketTotals.length ? bucketTotals[bucketTotals.length - 1] : 0;
  const maxBucket = Math.max(1, ...bucketTotals);
  const maxProjectVal = Math.max(
    1,
    ...(stats?.projects.flatMap((p) => p.values) ?? [])
  );

  return (
    <div>
      {/* Period toggle + refresh */}
      <div className="flex items-center gap-2 mb-5">
        <div className="flex rounded-lg border border-border p-0.5">
          {periods.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                'px-3 py-1 text-sm rounded-md transition-colors',
                period === p
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t(`notebook.period_${p}`)}
            </button>
          ))}
        </div>
        <Button variant="outline" size="icon" onClick={() => void load(period)} title={t('notebook.refresh')}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </Button>
      </div>

      {/* Headline: current bucket total across all projects */}
      <div className="rounded-xl border border-border bg-card p-4 mb-4">
        <div className="text-xs text-muted-foreground">{currentLabel}</div>
        <div className="mt-1 text-2xl font-semibold">{fmt(headline)}</div>
        {/* Trend across buckets */}
        <div className="mt-4 flex items-end gap-1 h-16">
          {stats?.buckets.map((b, i) => (
            <div key={b.key} className="flex-1 flex flex-col items-center justify-end h-full" title={`${b.label}: ${fmt(bucketTotals[i])}`}>
              <div
                className="w-full rounded-sm bg-primary/70"
                style={{ height: `${(bucketTotals[i] / maxBucket) * 100}%` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-1">
          {stats?.buckets.map((b) => (
            <div key={b.key} className="flex-1 text-center text-[10px] text-muted-foreground truncate">{b.label}</div>
          ))}
        </div>
      </div>

      {/* Per-project breakdown over the visible range */}
      <div className="space-y-2">
        {stats?.projects.map((p) => (
          <div key={p.projectId} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium truncate">{p.projectName}</span>
              <span className="shrink-0 text-sm text-muted-foreground">{fmt(p.total)}</span>
            </div>
            <div className="mt-2 flex items-end gap-0.5 h-8">
              {p.values.map((v, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-sm bg-primary/40"
                  style={{ height: `${Math.max(2, (v / maxProjectVal) * 100)}%` }}
                  title={`${stats.buckets[i].label}: ${fmt(v)}`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {stats && stats.projects.length === 0 && !loading && (
        <div className="text-center py-16 text-muted-foreground text-sm">{t('notebook.empty')}</div>
      )}
    </div>
  );
}

export function NotebookPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'devtime' | 'todos'>('devtime');

  return (
    <div className="min-h-screen bg-background">
      <header
        className="border-b sticky top-0 bg-background z-10"
        style={IS_MOBILE_DEVICE ? { paddingTop: 'env(safe-area-inset-top)' } : undefined}
      >
        <div className="w-full px-4 sm:px-6 h-14 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(IS_MOBILE_DEVICE ? '/mobile' : '/')}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t('notebook.back')}
          </Button>
          <div className="flex items-center gap-2">
            <Notebook className="h-5 w-5" />
            <span className="font-semibold text-lg">{t('notebook.title')}</span>
          </div>
        </div>
        {/* Sub-tabs */}
        <div className="w-full px-4 sm:px-6 flex gap-1 border-t border-border/60">
          <button
            onClick={() => setTab('devtime')}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium flex items-center gap-1.5',
              tab === 'devtime' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <Clock className="h-3.5 w-3.5" />
            {t('notebook.tab_devtime')}
          </button>
          <button
            onClick={() => setTab('todos')}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium flex items-center gap-1.5',
              tab === 'todos' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <ListTodo className="h-3.5 w-3.5" />
            {t('notebook.tab_todos')}
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        {tab === 'devtime' && <DevTimeStatsView />}
        {tab === 'todos' && <TodoView />}
      </main>
    </div>
  );
}
