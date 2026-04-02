// frontend/src/components/PlanPanel.tsx
import { useState, useEffect, useCallback } from 'react';
import { Play, Pause, Square, RotateCcw, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  getPlanStatus, initPlanControl, checkPlanSyntax,
  startPlan, pausePlan, resumePlan, stopPlan, getPlanTree,
  type PlanStatusResponse, type PlanCheckResponse, type PlanTreeNode,
} from '@/lib/api';
import { TaskTree } from './TaskTree';

interface PlanPanelProps {
  projectId: string;
  projectPath: string;
  // WS event data (passed from parent that owns WS connection)
  planStatus?: { status: string; executed_tasks: number; estimated_tasks: number; current_line: number } | null;
  planNodeUpdate?: { node_id: string; status: string; summary: string | null } | null;
  planReplan?: boolean; // true when replan event fires, triggers tree refetch
}

export function PlanPanel({ projectId, planStatus, planNodeUpdate, planReplan }: PlanPanelProps) {
  const [status, setStatus] = useState<PlanStatusResponse | null>(null);
  const [checkResult, setCheckResult] = useState<PlanCheckResponse | null>(null);
  const [tree, setTree] = useState<PlanTreeNode[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch initial status and tree
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getPlanStatus(projectId);
        if (!cancelled) setStatus(s);
        if (s.hasMainPc) {
          const t = await getPlanTree(projectId);
          if (!cancelled) setTree(t.tree);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // Update tree from WS node updates (local patch, no refetch)
  useEffect(() => {
    if (!planNodeUpdate) return;
    setTree(prev => {
      if (!prev) return prev;
      return patchTreeNodeStatus(prev, planNodeUpdate.node_id, planNodeUpdate.status);
    });
  }, [planNodeUpdate]);

  // Update status from WS
  useEffect(() => {
    if (!planStatus) return;
    setStatus(prev => prev ? {
      ...prev,
      state: prev.state ? { ...prev.state, ...planStatus } : {
        status: planStatus.status,
        current_line: planStatus.current_line,
        executed_tasks: planStatus.executed_tasks,
        estimated_tasks: planStatus.estimated_tasks,
      },
    } : prev);
  }, [planStatus]);

  // Refetch tree on replan
  useEffect(() => {
    if (!planReplan) return;
    getPlanTree(projectId).then(t => setTree(t.tree)).catch(() => {});
  }, [planReplan, projectId]);

  const handleInit = useCallback(async () => {
    setLoading(true);
    try {
      await initPlanControl(projectId);
      const s = await getPlanStatus(projectId);
      setStatus(s);
      toast.success('Plan Control 已初始化');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const handleCheck = useCallback(async () => {
    setLoading(true);
    try {
      const result = await checkPlanSyntax(projectId);
      setCheckResult(result);
      if (result.valid) {
        toast.success('语法检查通过');
        const t = await getPlanTree(projectId);
        setTree(t.tree);
      } else {
        toast.error(`${result.errors.length} 个语法错误`);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const handleStart = useCallback(async () => {
    try {
      await startPlan(projectId);
      const s = await getPlanStatus(projectId);
      setStatus(s);
    } catch (err) { toast.error((err as Error).message); }
  }, [projectId]);

  const handlePause = useCallback(async () => {
    try { await pausePlan(projectId); } catch (err) { toast.error((err as Error).message); }
  }, [projectId]);

  const handleResume = useCallback(async () => {
    try {
      await resumePlan(projectId);
      const s = await getPlanStatus(projectId);
      setStatus(s);
    } catch (err) { toast.error((err as Error).message); }
  }, [projectId]);

  const handleStop = useCallback(async () => {
    try { await stopPlan(projectId); } catch (err) { toast.error((err as Error).message); }
  }, [projectId]);

  const state = status?.state;
  const planStatusStr = state?.status ?? (status?.hasMainPc ? 'ready' : status?.initialized ? 'editing' : 'none');

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex-none h-8 flex items-center gap-1 px-2 border-b border-border text-xs">
        {planStatusStr === 'none' && (
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={handleInit} disabled={loading}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            初始化
          </Button>
        )}
        {(planStatusStr === 'editing' || planStatusStr === 'ready') && (
          <>
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={handleCheck} disabled={loading}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle className="h-3 w-3 mr-1" />}
              检查
            </Button>
            {checkResult?.valid && (
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={handleStart}>
                <Play className="h-3 w-3 mr-1" />启动
              </Button>
            )}
          </>
        )}
        {(planStatusStr === 'running' || planStatusStr === 'waiting') && (
          <>
            <span className="text-muted-foreground">
              已完成 {state?.executed_tasks ?? 0}（≥{state?.estimated_tasks ?? 0}）
            </span>
            <div className="flex-1" />
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={handlePause}>
              <Pause className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={handleStop}>
              <Square className="h-3 w-3" />
            </Button>
          </>
        )}
        {(planStatusStr === 'paused' || planStatusStr === 'stopped') && (
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={handleResume}>
            <RotateCcw className="h-3 w-3 mr-1" />继续
          </Button>
        )}
        {planStatusStr === 'completed' && (
          <span className="text-green-500 flex items-center gap-1">
            <CheckCircle className="h-3 w-3" /> 已完成
          </span>
        )}
      </div>

      {/* Error list */}
      {checkResult && !checkResult.valid && (
        <div className="flex-none max-h-24 overflow-y-auto px-2 py-1 border-b border-border bg-red-500/5">
          {checkResult.errors.map((e, i) => (
            <div key={i} className="text-[10px] text-red-400 flex gap-1">
              <AlertCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
              <span>第{e.line}行: {e.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Task Tree */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tree ? (
          <TaskTree tree={tree} currentLine={state?.current_line ?? null} />
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            {!status?.initialized ? '点击"初始化"开始' : !status?.hasMainPc ? '等待 AI 编写计划...' : '点击"检查"查看任务树'}
          </div>
        )}
      </div>
    </div>
  );
}

/** Patch a single node's status in the tree (in-place clone). */
function patchTreeNodeStatus(tree: PlanTreeNode[], nodeId: string, status: string): PlanTreeNode[] {
  return tree.map(node => {
    if (node.node_id === nodeId) {
      return { ...node, status: status as PlanTreeNode['status'] };
    }
    if (node.children.length > 0) {
      return { ...node, children: patchTreeNodeStatus(node.children, nodeId, status) };
    }
    return node;
  });
}
