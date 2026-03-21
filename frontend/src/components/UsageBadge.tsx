import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { getUsage, refreshUsage, UsageData, UsageBucket } from '@/lib/api';
import { cn } from '@/lib/utils';

function formatReset(isoString?: string): string {
  if (!isoString) return '';
  const diff = new Date(isoString).getTime() - Date.now();
  if (diff <= 0) return '即将重置';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

function UsageItem({ label, bucket }: { label: string; bucket?: UsageBucket }) {
  if (!bucket || bucket.utilization === undefined) return null;

  const v = bucket.utilization;
  const color =
    v < 50 ? 'text-green-400' :
    v < 80 ? 'text-yellow-400' :
    'text-red-400';

  const resetStr = formatReset(bucket.resetAt);

  return (
    <span className="text-muted-foreground whitespace-nowrap">
      {label}{' '}
      <span className={cn('font-medium', color)}>{v}%</span>
      {resetStr && (
        <span className="text-muted-foreground/70 ml-0.5">({resetStr})</span>
      )}
    </span>
  );
}

export function UsageBadge({ className }: { className?: string }) {
  const [usage, setUsage] = useState<UsageData | null | 'loading'>('loading');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const load = async () => {
      try { setUsage(await getUsage()); } catch { setUsage(null); }
    };
    void load();
    const interval = setInterval(() => void load(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { setUsage(await refreshUsage()); } catch { setUsage(null); }
    finally { setRefreshing(false); }
  };

  if (usage === 'loading') return null;
  if (!usage) return null;

  const has5h = !!usage.fiveHour;
  const has7d = !!usage.sevenDay;
  const has7dSonnet = !!usage.sevenDaySonnet;
  const has7dOpus = !!usage.sevenDayOpus;
  const hasAny = has5h || has7d || has7dSonnet || has7dOpus;

  return (
    <div className={cn('flex items-center gap-1.5 text-xs', className)}>
      {usage.planName && (
        <span className="font-medium text-foreground bg-muted border border-border px-2 py-0.5 rounded-full">
          {usage.planName}
        </span>
      )}
      {hasAny && (
        <>
          <span className="text-muted-foreground/50">|</span>
          <UsageItem label="5h" bucket={usage.fiveHour} />
          {has7d && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <UsageItem label="7d" bucket={usage.sevenDay} />
            </>
          )}
          {has7dSonnet && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <UsageItem label="7d Sonnet" bucket={usage.sevenDaySonnet} />
            </>
          )}
          {has7dOpus && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <UsageItem label="7d Opus" bucket={usage.sevenDayOpus} />
            </>
          )}
        </>
      )}
      <button
        onClick={() => void handleRefresh()}
        className="text-muted-foreground hover:text-foreground transition-colors"
        title="刷新用量信息"
      >
        <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} />
      </button>
    </div>
  );
}
