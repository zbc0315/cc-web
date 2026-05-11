import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { abortFlow, resumeFlow } from './api';
import type { FlowState, PauseReason } from './types';

interface Props {
  projectId: string;
  open: boolean;
  state: FlowState | null;
  onActioned: () => void;
}

function reasonTitle(r: PauseReason): string {
  switch (r) {
    case 'timeout': return '节点超时';
    case 'max-retries-exceeded': return '回边重试次数耗尽';
    case 'user-file-read-error': return '用户提供的文件读取失败';
    case 'llm-file-read-error': return 'LLM 产物文件读取失败';
    case 'user-paused': return '已暂停';
    default: return '任务流已暂停';
  }
}

function reasonHint(r: PauseReason): string {
  switch (r) {
    case 'timeout': return '继续 = 重新发送 prompt 并重新计时。中止 = 终结任务流。';
    case 'max-retries-exceeded': return '继续 = 重置该节点的回边计数，再给 maxRetries 次机会。中止 = 终结。';
    case 'user-file-read-error': return '修复文件后点继续重试读取。中止 = 终结。';
    case 'llm-file-read-error': return '继续 = 重新执行该节点（错误会塞进下次 prompt 提示 LLM 修复）。中止 = 终结。';
    default: return '';
  }
}

export function FlowErrorDialog({ projectId, open, state, onActioned }: Props) {
  const [busy, setBusy] = useState(false);
  if (!state) return null;

  const handleResume = async () => {
    setBusy(true);
    try {
      await resumeFlow(projectId);
      onActioned();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '继续失败');
    } finally {
      setBusy(false);
    }
  };

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
    <Dialog open={open} onOpenChange={() => { /* modal — only buttons close it */ }}>
      <DialogContent
        className="max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            {reasonTitle(state.pauseReason)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">{reasonHint(state.pauseReason)}</p>
          {state.pauseDetail && (
            <pre className="rounded-md border border-border bg-muted p-2 text-xs whitespace-pre-wrap break-words font-mono max-h-48 overflow-y-auto">
              {state.pauseDetail}
            </pre>
          )}
          {state.currentNodeId !== null && (
            <p className="text-xs text-muted-foreground">
              当前节点 <span className="font-mono">#{state.currentNodeId}</span>
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={handleAbort} disabled={busy} variant="ghost" size="sm">中止</Button>
          <Button onClick={handleResume} disabled={busy} size="sm">继续</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
