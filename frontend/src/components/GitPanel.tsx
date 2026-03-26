import { useState, useEffect, useCallback } from 'react';
import { GitBranch, RefreshCw, Plus, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { getGitStatus, getGitDiff, gitAdd, gitCommit, GitStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

interface GitPanelProps {
  projectId: string;
}

export function GitPanel({ projectId }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await getGitStatus(projectId));
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const showDiff = async (file?: string) => {
    try {
      const { diff: d } = await getGitDiff(projectId, file);
      setDiff(d || '(no diff)');
      setDiffFile(file ?? 'all changes');
    } catch {
      toast.error('获取 diff 失败');
    }
  };

  const handleAdd = async (file: string) => {
    try {
      await gitAdd(projectId, [file]);
      toast.success(`已暂存 ${file}`);
      await refresh();
    } catch {
      toast.error('git add 失败');
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) return;
    setCommitting(true);
    try {
      await gitCommit(projectId, commitMsg);
      toast.success('提交成功');
      setCommitMsg('');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交失败');
    } finally {
      setCommitting(false);
    }
  };

  if (!status && loading) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground/50 text-xs">
        <GitBranch className="h-5 w-5" />
        <p>加载中…</p>
      </div>
    );
  }

  if (!status || !status.isRepo) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground/50 text-xs">
        <GitBranch className="h-5 w-5" />
        <p>{!status ? '加载失败' : '非 Git 仓库'}</p>
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => void refresh()}>重试</Button>
      </div>
    );
  }

  const allChanged = [...(status.modified ?? []), ...(status.deleted ?? [])];
  const staged = status.staged ?? [];
  const untracked = status.untracked ?? [];

  return (
    <div className="flex flex-col h-full overflow-y-auto p-2 space-y-2 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-muted-foreground font-medium">
          <GitBranch className="h-3 w-3" />
          <span>{status.branch}</span>
          {(status.ahead ?? 0) > 0 && <span className="text-blue-400">↑{status.ahead}</span>}
          {(status.behind ?? 0) > 0 && <span className="text-yellow-400">↓{status.behind}</span>}
        </div>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
        </Button>
      </div>

      {/* Staged */}
      {staged.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-1 font-medium">已暂存 ({staged.length})</div>
          {staged.map((f) => (
            <div key={f} className="flex items-center gap-1 py-0.5 px-1 rounded hover:bg-muted">
              <Check className="h-2.5 w-2.5 text-green-500 flex-shrink-0" />
              <button className="flex-1 text-left truncate text-green-400" onClick={() => void showDiff(f)}>{f}</button>
            </div>
          ))}
        </div>
      )}

      {/* Modified/Deleted */}
      {allChanged.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-1 font-medium">未暂存 ({allChanged.length})</div>
          {allChanged.map((f) => (
            <div key={f} className="flex items-center gap-1 py-0.5 px-1 rounded hover:bg-muted">
              <button
                className="flex-shrink-0 h-4 w-4 flex items-center justify-center rounded hover:bg-green-500/20 text-muted-foreground hover:text-green-400"
                title="git add"
                onClick={() => void handleAdd(f)}
              >
                <Plus className="h-2.5 w-2.5" />
              </button>
              <button className="flex-1 text-left truncate text-yellow-400" onClick={() => void showDiff(f)}>{f}</button>
            </div>
          ))}
        </div>
      )}

      {/* Untracked */}
      {untracked.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-1 font-medium">未跟踪 ({untracked.length})</div>
          {untracked.map((f) => (
            <div key={f} className="flex items-center gap-1 py-0.5 px-1 rounded hover:bg-muted">
              <button
                className="flex-shrink-0 h-4 w-4 flex items-center justify-center rounded hover:bg-green-500/20 text-muted-foreground hover:text-green-400"
                title="git add"
                onClick={() => void handleAdd(f)}
              >
                <Plus className="h-2.5 w-2.5" />
              </button>
              <span className="flex-1 truncate text-muted-foreground">{f}</span>
            </div>
          ))}
        </div>
      )}

      {/* Nothing to commit */}
      {allChanged.length === 0 && staged.length === 0 && untracked.length === 0 && (
        <p className="text-muted-foreground/50 text-center py-4">工作区干净</p>
      )}

      {/* Commit section */}
      {staged.length > 0 && (
        <div className="space-y-1.5 pt-1 border-t border-border">
          <Input
            placeholder="提交消息…"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) void handleCommit(); }}
            className="h-7 text-xs"
          />
          <Button
            size="sm"
            className="w-full h-7 text-xs"
            onClick={() => void handleCommit()}
            disabled={!commitMsg.trim() || committing}
          >
            {committing ? '提交中…' : `提交 (${staged.length} 文件)`}
          </Button>
        </div>
      )}

      {/* Diff overlay */}
      {diff !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setDiff(null)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative z-10 w-[700px] max-w-[95vw] max-h-[80vh] flex flex-col bg-background border border-border rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 h-10 border-b border-border text-sm font-medium flex-shrink-0">
              <span className="truncate text-muted-foreground">{diffFile}</span>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => setDiff(null)}>✕</button>
            </div>
            <pre className="flex-1 overflow-auto p-3 text-[11px] font-mono whitespace-pre leading-relaxed">
              {diff.split('\n').map((line, i) => (
                <span
                  key={i}
                  className={cn(
                    'block',
                    line.startsWith('+') && !line.startsWith('+++') && 'text-green-400 bg-green-400/5',
                    line.startsWith('-') && !line.startsWith('---') && 'text-red-400 bg-red-400/5',
                    line.startsWith('@@') && 'text-blue-400',
                  )}
                >{line}</span>
              ))}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
