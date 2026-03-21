import { useState, useEffect } from 'react';
import { ArrowLeft, MessageSquare, User, Bot } from 'lucide-react';
import { getSessions, getSession, SessionSummary, Session } from '@/lib/api';
import { cn } from '@/lib/utils';

interface HistoryPanelProps {
  projectId: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export function HistoryPanel({ projectId }: HistoryPanelProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void getSessions(projectId).then(setSessions).catch(() => setSessions([]));
  }, [projectId]);

  const openSession = async (id: string) => {
    setLoading(true);
    try {
      setSelected(await getSession(projectId, id));
    } finally {
      setLoading(false);
    }
  };

  // ── Session detail view ───────────────────────────────────────────────────
  if (selected) {
    return (
      <div className="h-full flex flex-col bg-background text-foreground">
        <div className="flex items-center gap-2 px-3 h-9 border-b border-border flex-shrink-0">
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setSelected(null)}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs text-muted-foreground truncate">{formatDate(selected.startedAt)}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-3 min-h-0">
          {selected.messages.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">本次会话暂无记录</p>
          )}
          {selected.messages.map((msg, i) => (
            <div key={i} className={cn('flex flex-col gap-1', msg.role === 'user' ? 'items-end' : 'items-start')}>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                {msg.role === 'user'
                  ? <><span>{formatDate(msg.timestamp)}</span><User className="h-2.5 w-2.5" /></>
                  : <><Bot className="h-2.5 w-2.5" /><span>{formatDate(msg.timestamp)}</span></>
                }
              </div>
              <div className={cn(
                'text-xs rounded px-2.5 py-2 max-w-full whitespace-pre-wrap break-words',
                msg.role === 'user'
                  ? 'bg-blue-600/20 text-blue-100 border border-blue-500/20'
                  : 'bg-muted text-foreground border border-border'
              )}>
                {msg.content}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Session list view ─────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      <div className="flex items-center px-3 h-9 border-b border-border flex-shrink-0">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">历史记录</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
        {sessions.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground/50">
            <MessageSquare className="h-5 w-5" />
            <p className="text-xs text-center">暂无历史记录</p>
          </div>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            disabled={loading}
            onClick={() => void openSession(s.id)}
            className={cn(
              'w-full text-left rounded px-3 py-2',
              'bg-muted hover:bg-accent',
              'border border-transparent hover:border-muted-foreground/30',
              'transition-colors text-xs text-foreground',
            )}
          >
            {formatDate(s.startedAt)}
          </button>
        ))}
      </div>
    </div>
  );
}
