import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  getMemoryPoolStatus,
  initMemoryPool,
  getMemoryPoolIndex,
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
  maintain: '请执行记忆池维护：读取 .memory-pool/QUICK-REF.md，然后执行衰减计算、分化判定、融合检查，最后更新 index.json',
  load: '请读取 .memory-pool/index.json 和活跃层记忆球，将重要记忆纳入当前上下文',
  save: '请从我们当前的对话中提取值得记忆的信息，按照 .memory-pool/QUICK-REF.md 的规范存入记忆池',
  general: '请读取 .memory-pool/QUICK-REF.md，对记忆池执行你认为合适的操作',
} as const;

interface MemoryPoolPanelProps {
  projectId: string;
  onSend?: (text: string) => void;
  onBallClick?: (ball: MemoryPoolBall, allBalls: MemoryPoolBall[]) => void;
}

export function MemoryPoolPanel({ projectId, onSend, onBallClick }: MemoryPoolPanelProps) {
  const [status, setStatus] = useState<MemoryPoolStatus | null>(null);
  const [index, setIndex] = useState<MemoryPoolIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [initLoading, setInitLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const s = await getMemoryPoolStatus(projectId);
      setStatus(s);
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

  // Poll index every 5s when initialized
  useEffect(() => {
    if (!status?.initialized) return;

    const poll = () => fetchIndex();
    pollRef.current = setInterval(poll, 15000);

    const onVisChange = () => {
      if (document.hidden) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      } else {
        poll();
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

  const sendCommand = (action: keyof typeof COMMANDS) => {
    if (onSend) {
      onSend(COMMANDS[action] + '\r');
      toast.success('指令已发送到终端');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-xs text-muted-foreground">加载中...</div>;
  }

  // Not initialized: show init button
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

  // Initialized: show ball list
  const balls = index?.balls ?? [];
  const activeCapacity = status.state?.active_capacity ?? 20;
  const activeBalls = balls.slice(0, activeCapacity);
  const deepBalls = balls.slice(activeCapacity);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-3 pt-2 pb-1 flex items-center justify-between">
        <span className="font-medium text-xs text-foreground">记忆池</span>
        <span className="text-[10px] text-muted-foreground">
          t={status.state?.t ?? 0} · {balls.length} balls
        </span>
      </div>

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
      </div>

      {/* Ball list */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
        {activeBalls.length > 0 && (
          <>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">活跃层</div>
            {activeBalls.map((ball) => (
              <BallCard key={ball.id} ball={ball} onClick={() => onBallClick?.(ball, balls)} />
            ))}
          </>
        )}
        {deepBalls.length > 0 && (
          <>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-3 mb-1">深层</div>
            {deepBalls.map((ball) => (
              <BallCard key={ball.id} ball={ball} deep onClick={() => onBallClick?.(ball, balls)} />
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
        <span className={cn('text-[10px] px-1 py-px rounded text-white', colors.bg)}>{ball.type}</span>
        <span className={cn('text-[10px] font-medium', colors.text)}>B {ball.buoyancy.toFixed(1)}</span>
      </div>
      <div className="text-[11px] text-foreground leading-tight line-clamp-2">{ball.summary}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">
        H={ball.H} · t={ball.t_last}{ball.links.length > 0 ? ` · ${ball.links.length} links` : ''}
      </div>
    </div>
  );
}
