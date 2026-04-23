import { useState, useEffect, useCallback, useRef } from 'react';
import { Archive, RefreshCw, FileText, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  getSessionsBackupStatus,
  triggerSessionsBackup,
  SessionsBackupStatus,
} from '@/lib/api';
import { cn } from '@/lib/utils';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

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

function formatAbsolute(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

interface SessionsBackupPanelProps {
  projectId: string;
}

export function SessionsBackupPanel({ projectId }: SessionsBackupPanelProps) {
  const [status, setStatus] = useState<SessionsBackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const s = await getSessionsBackupStatus(projectId);
      if (!mountedRef.current) return;
      setStatus(s);
    } catch (e) {
      if (!mountedRef.current) return;
      setError((e as Error).message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [projectId]);

  const doBackup = useCallback(async () => {
    setTriggering(true);
    try {
      const r = await triggerSessionsBackup(projectId);
      if (!mountedRef.current) return;
      const parts: string[] = [];
      if (r.copied > 0) parts.push(`新增/更新 ${r.copied}`);
      if (r.deleted > 0) parts.push(`删除 ${r.deleted}`);
      if (r.skipped > 0) parts.push(`跳过 ${r.skipped}`);
      toast.success(`同步完成：${parts.join('·') || '无变化'}`);
      await refresh();
    } catch (e) {
      toast.error(`同步失败：${(e as Error).message}`);
    } finally {
      if (mountedRef.current) setTriggering(false);
    }
  }, [projectId, refresh]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const poll = setInterval(() => { void refresh(); }, 30_000);
    const ticker = setInterval(() => setTick((x) => x + 1), 5_000);
    return () => {
      mountedRef.current = false;
      clearInterval(poll);
      clearInterval(ticker);
    };
  }, [refresh]);

  const totalBytes = status?.files.reduce((acc, f) => acc + f.bytes, 0) ?? 0;

  return (
    <div className="h-full flex flex-col bg-muted text-foreground overflow-hidden">
      <div className="flex-shrink-0 px-3 py-2 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Archive className="size-4" />
          <span>聊天记录备份</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => { void refresh(); }}
          title="刷新"
          aria-label="刷新"
          disabled={loading}
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      <div className="flex-shrink-0 px-3 py-2 border-b border-border bg-background/40">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] text-muted-foreground min-w-0">
            <div>
              最后同步:{' '}
              <span
                className="text-foreground/90"
                title={status?.meta ? formatAbsolute(status.meta.lastBackupAt) : undefined}
              >
                {status?.meta ? formatRelative(status.meta.lastBackupAt) : '从未同步'}
              </span>
            </div>
            {status && (
              <div className="mt-0.5 text-muted-foreground/80">
                {status.files.length} 个文件 · {formatBytes(totalBytes)}
              </div>
            )}
          </div>
          <Button
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => { void doBackup(); }}
            disabled={triggering || !status?.supported}
          >
            {triggering ? '同步中…' : '立即同步'}
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 text-destructive p-2 text-xs flex items-start gap-2">
            <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {status && !status.supported && (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            <p>此项目使用 <code className="text-[10px] bg-muted-foreground/10 px-1 rounded">terminal</code> 模式，无聊天记录需备份。</p>
          </div>
        )}

        {status?.supported && status.files.length === 0 && !loading && !error && (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            <p>暂无已备份的聊天记录</p>
            <p className="mt-2 leading-relaxed text-muted-foreground/80">
              定时每 5 分钟同步一次，也可点击右上方"立即同步"手动触发。
            </p>
            <p className="mt-1 text-muted-foreground/70">
              备份路径: <code className="text-[10px] bg-muted-foreground/10 px-1 rounded break-all">{status.backupDir}</code>
            </p>
          </div>
        )}

        {status?.files.map((f) => (
          <div
            key={f.name}
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs flex items-center gap-2 hover:bg-accent/50 transition-colors"
          >
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[11px] text-foreground truncate" title={f.name}>
                {f.name}
              </div>
              <div className="text-muted-foreground/80 text-[10px] flex items-center gap-2">
                <span title={formatAbsolute(f.mtime)}>{formatRelative(f.mtime)}</span>
                <span className="text-muted-foreground/40">·</span>
                <span>{formatBytes(f.bytes)}</span>
              </div>
            </div>
          </div>
        ))}

        {loading && !status && (
          <div className="space-y-1">
            {[0, 1].map((i) => (
              <div key={i} className="rounded-md border border-border bg-background h-10 animate-pulse" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
