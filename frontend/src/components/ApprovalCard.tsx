import { useState } from 'react';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { decideApproval } from '@/lib/api';
import { toast } from 'sonner';

export interface ApprovalCardData {
  projectId: string;
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  sessionId: string;
  createdAt: number;
}

interface ApprovalCardProps {
  approval: ApprovalCardData;
  onResolved: (toolUseId: string) => void;
}

function summarizeInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') return JSON.stringify(input ?? '').slice(0, 200);
  const obj = input as Record<string, unknown>;
  if (toolName === 'Bash' && typeof obj.command === 'string') return obj.command.slice(0, 400);
  if ((toolName === 'Edit' || toolName === 'Write') && typeof obj.file_path === 'string') return String(obj.file_path);
  if (toolName === 'Read' && typeof obj.file_path === 'string') return String(obj.file_path);
  if (toolName === 'WebFetch' && typeof obj.url === 'string') return String(obj.url);
  // Fallback: compact JSON
  try { return JSON.stringify(obj).slice(0, 400); } catch { return '…'; }
}

export function ApprovalCard({ approval, onResolved }: ApprovalCardProps) {
  const [pending, setPending] = useState<'allow' | 'deny' | null>(null);
  const summary = summarizeInput(approval.toolName, approval.toolInput);

  const act = async (behavior: 'allow' | 'deny') => {
    if (pending) return;
    setPending(behavior);
    try {
      await decideApproval(approval.projectId, approval.toolUseId, behavior);
      onResolved(approval.toolUseId);
    } catch (err) {
      toast.error(`审批失败: ${err instanceof Error ? err.message : String(err)}`);
      setPending(null);
    }
  };

  return (
    <div className="flex justify-center">
      <div
        className="max-w-[90%] w-full rounded-2xl px-4 py-3 border border-amber-500/40 bg-amber-500/10 backdrop-blur-md"
        style={{ boxShadow: '0 4px 14px rgba(245,158,11,0.18), inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.05)' }}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0" />
          <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
            Claude 请求权限 · <span className="font-mono">{approval.toolName}</span>
          </span>
        </div>
        <pre className="text-xs text-foreground/90 bg-background/50 rounded px-2 py-1.5 mb-2 whitespace-pre-wrap break-all max-h-32 overflow-y-auto font-mono">
{summary}
        </pre>
        <div className="flex items-center gap-2 justify-end">
          <button
            disabled={pending !== null}
            onClick={() => void act('deny')}
            className={cn(
              'flex items-center gap-1 px-3 py-1 rounded text-xs border transition-colors',
              'border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-50',
            )}
          >
            {pending === 'deny' && <Loader2 className="h-3 w-3 animate-spin" />}
            拒绝
          </button>
          <button
            disabled={pending !== null}
            onClick={() => void act('allow')}
            className={cn(
              'flex items-center gap-1 px-3 py-1 rounded text-xs border transition-colors',
              'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50',
            )}
          >
            {pending === 'allow' && <Loader2 className="h-3 w-3 animate-spin" />}
            允许
          </button>
        </div>
      </div>
    </div>
  );
}
