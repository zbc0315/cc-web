import { useState } from 'react';
import { Workflow, X, Pause } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { abortFlow } from './api';
import type { FlowState } from './types';

interface Props {
  projectId: string;
  state: FlowState | null;
  onActioned: () => void;
}

function statusLabel(state: FlowState): string {
  if (state.status === 'running') return '运行中';
  if (state.status === 'paused') {
    if (state.pauseReason === 'awaiting-user-input') return '等待用户输入';
    if (state.pauseReason === 'timeout') return '超时（暂停）';
    if (state.pauseReason === 'max-retries-exceeded') return '回边耗尽（暂停）';
    if (state.pauseReason === 'user-file-read-error') return '用户文件读取失败（暂停）';
    if (state.pauseReason === 'llm-file-read-error') return 'LLM 产物读取失败（暂停）';
    return '已暂停';
  }
  return state.status;
}

/** Thin banner shown above the project content when a flow is active.
 *  Hidden when no flow is running OR run finalized (completed/failed/aborted). */
export function FlowStatusBar({ projectId, state, onActioned }: Props) {
  const [busy, setBusy] = useState(false);
  if (!state || (state.status !== 'running' && state.status !== 'paused')) return null;

  const loopHits = state.currentNodeId !== null ? state.loopCounters[state.currentNodeId] : undefined;

  const handleAbort = async () => {
    setBusy(true);
    try {
      await abortFlow(projectId);
      onActioned();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '中止失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border bg-accent/40">
      <Workflow className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
      <span className="font-medium">任务流 · {statusLabel(state)}</span>
      {state.currentNodeId !== null && (
        <span className="text-muted-foreground">
          节点 <span className="font-mono">#{state.currentNodeId}</span>
        </span>
      )}
      {loopHits != null && loopHits > 0 && (
        <span className="text-muted-foreground">回边 {loopHits} 次</span>
      )}
      {state.status === 'paused' && (
        <Pause className="h-3 w-3 text-amber-500" />
      )}
      <div className="flex-1" />
      <Button size="sm" variant="ghost" onClick={handleAbort} disabled={busy} className="h-6 px-2 text-xs">
        <X className="h-3 w-3 mr-1" /> 中止
      </Button>
    </div>
  );
}
