import { useState, useEffect, ReactNode } from 'react';
import { Cpu, MemoryStick, HardDrive, ArrowDown, ArrowUp } from 'lucide-react';
import { getHostStats, HostStats } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

const POLL_MS = 3000;

function pctColor(v: number): string {
  return v < 50 ? 'text-green-400' : v < 80 ? 'text-yellow-400' : 'text-red-400';
}

function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

function Metric({
  icon,
  value,
  color,
  title,
}: {
  icon: ReactNode;
  value: string;
  color?: string;
  title: string;
}) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap" title={title}>
      <span className="text-muted-foreground/70">{icon}</span>
      <span className={cn('font-medium tabular-nums', color)}>{value}</span>
    </span>
  );
}

export function HostStatsBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<HostStats | null | 'loading'>('loading');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const s = await getHostStats();
        if (!cancelled) setStats(s);
      } catch {
        if (!cancelled) setStats(null);
      }
    };
    void load();
    const interval = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (stats === 'loading' || !stats) return null;

  const uptimeH = Math.floor(stats.uptimeSec / 3600);
  const hostTitle = `${stats.hostname} · ${stats.platform} · ${stats.cores} ${t('dashboard.host_cores')} · ${t(
    'dashboard.host_uptime',
    { hours: uptimeH }
  )}`;

  return (
    <div className={cn('flex items-center gap-2.5 text-xs', className)} title={hostTitle}>
      <Metric
        icon={<Cpu className="h-3 w-3" />}
        value={`${stats.cpu}%`}
        color={pctColor(stats.cpu)}
        title={t('dashboard.host_cpu', { load: stats.loadAvg })}
      />
      <Metric
        icon={<MemoryStick className="h-3 w-3" />}
        value={`${stats.mem.percent}%`}
        color={pctColor(stats.mem.percent)}
        title={t('dashboard.host_mem', {
          used: formatBytes(stats.mem.used),
          total: formatBytes(stats.mem.total),
        })}
      />
      {stats.disk && (
        <Metric
          icon={<HardDrive className="h-3 w-3" />}
          value={`${stats.disk.percent}%`}
          color={pctColor(stats.disk.percent)}
          title={t('dashboard.host_disk', {
            used: formatBytes(stats.disk.used),
            total: formatBytes(stats.disk.total),
          })}
        />
      )}
      {stats.net && (
        <span className="flex items-center gap-1.5 whitespace-nowrap" title={t('dashboard.host_net')}>
          <span className="flex items-center gap-0.5 text-muted-foreground">
            <ArrowDown className="h-3 w-3" />
            <span className="font-medium tabular-nums">{formatRate(stats.net.rxBytesPerSec)}</span>
          </span>
          <span className="flex items-center gap-0.5 text-muted-foreground">
            <ArrowUp className="h-3 w-3" />
            <span className="font-medium tabular-nums">{formatRate(stats.net.txBytesPerSec)}</span>
          </span>
        </span>
      )}
    </div>
  );
}
