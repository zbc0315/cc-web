import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  getMemoryPoolStatus,
  initMemoryPool,
  getMemoryPoolIndex,
  upgradeMemoryPool,
  syncGlobalPool,
  updateSurfaceWidth,
  MemoryPoolStatus,
  MemoryPoolIndex,
  MemoryPoolBall,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  feedback: { bg: 'bg-blue-500', text: 'text-blue-400', border: 'border-blue-500/30' },
  user: { bg: 'bg-green-500', text: 'text-green-400', border: 'border-green-500/30' },
  project: { bg: 'bg-yellow-500', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  reference: { bg: 'bg-purple-500', text: 'text-purple-400', border: 'border-purple-500/30' },
};

const COMMANDS = {
  maintain: '请读取 .memory-pool/QUICK-REF.md，然后调用 POST /maintenance 获取维护建议并执行',
  load: '请调用 GET /api/memory-pool/{projectId}/surface 获取活跃层记忆，将重要记忆纳入当前上下文',
  save: '请从我们当前的对话中提取值得记忆的信息，通过 POST /balls API 存入记忆池',
  general: '请读取 .memory-pool/QUICK-REF.md，对记忆池执行你认为合适的操作',
} as const;

interface MemoryPoolPanelProps {
  projectId: string;
  onSend?: (text: string) => void;
  onBallClick?: (ball: MemoryPoolBall, allBalls: MemoryPoolBall[], activeCapacity: number) => void;
}

export function MemoryPoolPanel({ projectId, onSend, onBallClick }: MemoryPoolPanelProps) {
  const [status, setStatus] = useState<MemoryPoolStatus | null>(null);
  const [index, setIndex] = useState<MemoryPoolIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [initLoading, setInitLoading] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [surfaceWidth, setSurfaceWidth] = useState(10000);
  const [surfaceWidthSaving, setSurfaceWidthSaving] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const s = await getMemoryPoolStatus(projectId);
      setStatus(s);
      if (s.state?.surface_width) setSurfaceWidth(s.state.surface_width);
      return s.initialized;
    } catch {
      return false;
    }
  }, [projectId]);

  const fetchIndex = useCallback(async () => {
    try {
      const data = await getMemoryPoolIndex(projectId);
      setIndex(data);
    } catch { /* pool may not exist */ }
  }, [projectId]);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const initialized = await fetchStatus();
      if (!cancelled && initialized) await fetchIndex();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId, fetchStatus, fetchIndex]);

  // Poll index every 15s when initialized
  useEffect(() => {
    if (!status?.initialized) return;

    const poll = () => fetchIndex();
    pollRef.current = setInterval(poll, 15000);

    const onVisChange = () => {
      if (document.hidden) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      } else {
        poll();
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(poll, 15000);
      }
    };
    document.addEventListener('visibilitychange', onVisChange);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, [status?.initialized, fetchIndex]);

  const handleInit = async () => {
    setInitLoading(true);
    try {
      await initMemoryPool(projectId);
      await fetchStatus();
      await fetchIndex();
    } catch (err: any) {
      console.error('Memory pool init failed:', err);
    } finally {
      setInitLoading(false);
    }
  };

  const handleUpgrade = async () => {
    setUpgradeLoading(true);
    try {
      const result = await upgradeMemoryPool(projectId);
      toast.success(`记忆池已更新到 v${result.version}`, {
        description: result.changes?.join(', '),
      });
      await fetchStatus();
      await fetchIndex();
    } catch (err: any) {
      toast.error('更新失败', { description: err.message });
    } finally {
      setUpgradeLoading(false);
    }
  };

  const handleSyncGlobal = async () => {
    setSyncLoading(true);
    try {
      const result = await syncGlobalPool();
      const parts = [];
      if (result.added > 0) parts.push(`新增 ${result.added}`);
      if (result.updated > 0) parts.push(`更新 ${result.updated}`);
      if (result.skipped > 0) parts.push(`跳过 ${result.skipped}`);
      if (result.orphaned > 0) parts.push(`孤儿 ${result.orphaned}`);
      toast.success('全局记忆池已更新', {
        description: parts.join(' · ') + (result.unreachable_projects.length > 0
          ? ` | 不可达: ${result.unreachable_projects.join(', ')}`
          : ''),
      });
    } catch (err: any) {
      toast.error('全局同步失败', { description: err.message });
    } finally {
      setSyncLoading(false);
    }
  };

  const handleSurfaceWidthSave = async () => {
    setSurfaceWidthSaving(true);
    try {
      const result = await updateSurfaceWidth(projectId, surfaceWidth);
      toast.success(`楔形宽度已更新: ${result.surface_balls} balls, ~${result.total_tokens} tokens`);
    } catch (err: any) {
      toast.error('更新失败', { description: err.message });
    } finally {
      setSurfaceWidthSaving(false);
    }
  };

  const sendCommand = (action: keyof typeof COMMANDS) => {
    if (onSend) {
      onSend(COMMANDS[action] + '\r');
      toast.success('指令已发送到终端');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-xs text-muted-foreground">加载中...</div>;
  }

  if (!status?.initialized) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
        <div className="text-3xl opacity-30">🧠</div>
        <p className="text-muted-foreground text-xs text-center">本项目尚未启用记忆池</p>
        <Button size="sm" onClick={handleInit} disabled={initLoading}>
          {initLoading ? '初始化中...' : '初始化记忆池'}
        </Button>
      </div>
    );
  }

  const balls = index?.balls ?? [];
  const activeCapacity = status.state?.active_capacity ?? 20;
  const activeBalls = balls.slice(0, activeCapacity);
  const deepBalls = balls.slice(activeCapacity);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-3 pt-2 pb-1 flex items-center justify-between">
        <span className="font-medium text-xs text-foreground">记忆池</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">
            t={status.state?.t ?? 0} · {balls.length} balls
          </span>
          <button
            onClick={() => setShowSettings((v) => !v)}
            className={cn(
              'text-[10px] px-1 py-0.5 rounded transition-colors',
              showSettings ? 'text-blue-400 bg-blue-500/10' : 'text-muted-foreground hover:text-foreground',
            )}
            aria-label="设置"
          >
            ⚙
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="flex-shrink-0 mx-3 mb-2 p-2 rounded border border-border bg-muted/20 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-muted-foreground whitespace-nowrap">楔形宽度</label>
            <input
              type="number"
              min={1000}
              max={100000}
              step={1000}
              value={surfaceWidth}
              onChange={(e) => setSurfaceWidth(Number(e.target.value))}
              className="flex-1 min-w-0 px-1.5 py-0.5 text-[10px] rounded border border-border bg-background text-foreground"
            />
            <span className="text-[9px] text-muted-foreground">tok</span>
            <button
              onClick={handleSurfaceWidthSave}
              disabled={surfaceWidthSaving}
              className="px-2 py-0.5 text-[10px] rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors disabled:opacity-50"
            >
              {surfaceWidthSaving ? '...' : '保存'}
            </button>
          </div>
          <p className="text-[9px] text-muted-foreground leading-tight">
            控制 surface.md 中浮出水面的记忆总 token 量。越大 → LLM 读取更多记忆，越小 → 更省 token。
          </p>
        </div>
      )}

      {/* Upgrade banner */}
      {status.needsUpgrade && (
        <div className="flex-shrink-0 mx-3 mb-2 px-2 py-1.5 rounded bg-orange-500/10 border border-orange-500/30 flex items-center justify-between">
          <span className="text-[10px] text-orange-400">记忆池格式需要更新</span>
          <button
            onClick={handleUpgrade}
            disabled={upgradeLoading}
            className="px-2 py-0.5 text-[10px] rounded bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 transition-colors disabled:opacity-50"
          >
            {upgradeLoading ? '更新中...' : '更新'}
          </button>
        </div>
      )}

      {/* Quick action buttons */}
      <div className="flex-shrink-0 px-3 pb-2 flex gap-1 flex-wrap">
        <button onClick={() => sendCommand('maintain')} className="px-2 py-0.5 text-[10px] rounded border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition-colors">
          整理
        </button>
        <button onClick={() => sendCommand('load')} className="px-2 py-0.5 text-[10px] rounded border border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors">
          读取
        </button>
        <button onClick={() => sendCommand('save')} className="px-2 py-0.5 text-[10px] rounded border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 transition-colors">
          保存
        </button>
        <button onClick={() => sendCommand('general')} className="px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:bg-muted/30 transition-colors">
          通用
        </button>
        {!status.needsUpgrade && (
          <button onClick={handleUpgrade} disabled={upgradeLoading} className="px-2 py-0.5 text-[10px] rounded border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-colors disabled:opacity-50">
            {upgradeLoading ? '更新中...' : '更新'}
          </button>
        )}
        <button onClick={handleSyncGlobal} disabled={syncLoading} className="px-2 py-0.5 text-[10px] rounded border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 transition-colors disabled:opacity-50">
          {syncLoading ? '同步中...' : '同步全局'}
        </button>
      </div>

      {/* Ball list */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
        {activeBalls.length > 0 && (
          <>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">活跃层</div>
            {activeBalls.map((ball) => (
              <BallCard key={ball.id} ball={ball} onClick={() => onBallClick?.(ball, balls, activeCapacity)} />
            ))}
          </>
        )}
        {deepBalls.length > 0 && (
          <>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-3 mb-1">深层</div>
            {deepBalls.map((ball) => (
              <BallCard key={ball.id} ball={ball} deep onClick={() => onBallClick?.(ball, balls, activeCapacity)} />
            ))}
          </>
        )}
        {balls.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-8">
            记忆池为空，在终端中与 AI 对话时会自动积累记忆
          </div>
        )}
      </div>
    </div>
  );
}

function BallCard({ ball, deep, onClick }: { ball: MemoryPoolBall; deep?: boolean; onClick?: () => void }) {
  const colors = TYPE_COLORS[ball.type] ?? TYPE_COLORS.reference;
  return (
    <div
      onClick={onClick}
      className={cn(
        'p-2 rounded-md cursor-pointer transition-colors border-l-2',
        deep ? 'bg-muted/20 opacity-50 hover:opacity-70' : 'bg-muted/40 hover:bg-muted/60',
        colors.border,
      )}
    >
      <div className="flex items-center justify-between mb-0.5">
        <div className="flex items-center gap-1">
          <span className={cn('text-[10px] px-1 py-px rounded text-white', colors.bg)}>{ball.type}</span>
          {ball.permanent && (
            <span className="text-[10px] px-1 py-px rounded bg-orange-500/20 text-orange-400">permanent</span>
          )}
        </div>
        <span className={cn('text-[10px] font-medium', colors.text)}>B {ball.buoyancy.toFixed(1)}</span>
      </div>
      <div className="text-[11px] text-foreground leading-tight line-clamp-2">{ball.summary}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">
        H={ball.H} · t={ball.t_last}{ball.diameter ? ` · ~${ball.diameter}tok` : ''}{ball.links.length > 0 ? ` · ${ball.links.length} links` : ''}
      </div>
    </div>
  );
}
