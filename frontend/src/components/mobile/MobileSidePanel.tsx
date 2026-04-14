import { useState, useEffect } from 'react';
import { X, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getUsage, UsageData, UsageBucket } from '@/lib/api';
import { ContextUpdate } from '@/lib/websocket';
import { MobileFileBrowser } from './MobileFileBrowser';

// ── Usage helpers (same logic as UsageBadge) ──

function formatReset(isoString?: string): string {
  if (!isoString) return '';
  const diff = new Date(isoString).getTime() - Date.now();
  if (diff <= 0) return '即将重置';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

function utilColor(v: number): string {
  if (v < 50) return 'text-green-400';
  if (v < 80) return 'text-yellow-400';
  return 'text-red-400';
}

function barColor(v: number): string {
  if (v < 50) return 'bg-green-500';
  if (v < 80) return 'bg-yellow-500';
  return 'bg-red-500';
}

// ── Component ──

interface MobileSidePanelProps {
  projectName: string;
  cliTool: string;
  folderPath: string;
  contextData: ContextUpdate | null;
  onClose: () => void;
}

export function MobileSidePanel({ projectName, cliTool, folderPath, contextData, onClose }: MobileSidePanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['context', 'usage', 'files']));
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Load usage
  useEffect(() => {
    setUsageLoading(true);
    getUsage(cliTool).then(setUsage).catch(() => setUsage(null)).finally(() => setUsageLoading(false));
  }, [cliTool]);

  const refreshUsageData = async () => {
    setUsageLoading(true);
    try {
      const { refreshUsage } = await import('@/lib/api');
      setUsage(await refreshUsage(cliTool));
    } catch { /* */ }
    finally { setUsageLoading(false); }
  };

  const contextPct = contextData ? Math.round(contextData.usedPercentage) : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-12 border-b border-border shrink-0">
        <button onClick={onClose} className="text-muted-foreground active:text-foreground p-1">
          <X className="h-5 w-5" />
        </button>
        <span className="flex-1 font-medium text-sm truncate">{projectName}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── Context Usage ── */}
        <button onClick={() => toggle('context')} className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-border/50 active:bg-accent">
          {expanded.has('context') ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          <span className="text-sm font-medium">上下文</span>
          {contextPct !== null && (
            <span className={cn('text-xs font-mono ml-auto', utilColor(contextPct))}>{contextPct}%</span>
          )}
        </button>
        {expanded.has('context') && (
          <div className="px-4 py-3 border-b border-border/50">
            {contextPct !== null && contextData ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full transition-all', barColor(contextPct))} style={{ width: `${Math.min(contextPct, 100)}%` }} />
                  </div>
                  <span className={cn('text-xs font-mono w-10 text-right', utilColor(contextPct))}>{contextPct}%</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span>窗口大小</span>
                  <span className="text-right font-mono">{contextData.contextWindowSize >= 1_000_000 ? `${(contextData.contextWindowSize / 1_000_000).toFixed(1)}M` : `${Math.round(contextData.contextWindowSize / 1000)}K`}</span>
                  <span>输入 tokens</span>
                  <span className="text-right font-mono">{contextData.inputTokens.toLocaleString()}</span>
                  <span>输出 tokens</span>
                  <span className="text-right font-mono">{contextData.outputTokens.toLocaleString()}</span>
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground/50 text-center py-2">暂无数据</div>
            )}
          </div>
        )}

        {/* ── API Usage ── */}
        <div className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-border/50 cursor-pointer" role="button" tabIndex={0} onClick={() => toggle('usage')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle('usage'); }}>
          {expanded.has('usage') ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          <span className="text-sm font-medium">用量</span>
          <button
            onClick={(e) => { e.stopPropagation(); void refreshUsageData(); }}
            className="ml-auto text-muted-foreground active:text-foreground"
          >
            <RefreshCw className={cn('h-3 w-3', usageLoading && 'animate-spin')} />
          </button>
        </div>
        {expanded.has('usage') && (
          <div className="px-4 py-3 border-b border-border/50">
            {usage ? (
              <div className="space-y-2">
                {usage.planName && (
                  <div className="text-[11px] text-muted-foreground">Plan: <span className="font-medium text-foreground">{usage.planName}</span></div>
                )}
                <UsageBucketRow label="5h" bucket={usage.fiveHour} />
                <UsageBucketRow label="7d" bucket={usage.sevenDay} />
                {usage.sevenDaySonnet && <UsageBucketRow label="7d Sonnet" bucket={usage.sevenDaySonnet} />}
                {usage.sevenDayOpus && <UsageBucketRow label="7d Opus" bucket={usage.sevenDayOpus} />}
                {!usage.fiveHour && !usage.sevenDay && (
                  <div className="text-xs text-muted-foreground/50 text-center">暂无数据</div>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground/50 text-center py-2">
                {usageLoading ? '加载中...' : '暂无数据'}
              </div>
            )}
          </div>
        )}

        {/* ── Files ── */}
        <button onClick={() => toggle('files')} className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-border/50 active:bg-accent">
          {expanded.has('files') ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          <span className="text-sm font-medium">文件</span>
        </button>
        {expanded.has('files') && (
          <div className="h-[60vh]">
            <MobileFileBrowser rootPath={folderPath} onClose={() => toggle('files')} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Usage bucket row ──

function UsageBucketRow({ label, bucket }: { label: string; bucket?: UsageBucket }) {
  if (!bucket || bucket.utilization === undefined) return null;
  const v = bucket.utilization;
  const resetStr = formatReset(bucket.resetAt);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-16">{label}</span>
      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', barColor(v))} style={{ width: `${Math.min(v, 100)}%` }} />
      </div>
      <span className={cn('text-xs font-mono w-8 text-right', utilColor(v))}>{v}%</span>
      {resetStr && <span className="text-[10px] text-muted-foreground/60">{resetStr}</span>}
    </div>
  );
}
