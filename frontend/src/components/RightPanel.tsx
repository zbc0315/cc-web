import { useState, useEffect } from 'react';
import { Bot, Brain, User, X } from 'lucide-react';
import { ShortcutPanel } from './ShortcutPanel';
import { GraphPreview } from './GraphPreview';
import { getSessions, getSession, SessionSummary, Session } from '@/lib/api';
import { cn } from '@/lib/utils';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function buildRecallText(session: Session): string {
  const lines = session.messages.map((m) =>
    `[${m.role === 'user' ? 'User' : 'Assistant'}]: ${m.content}`
  );
  return `这是我们上一次的聊天记录，请你回忆：\n\n${lines.join('\n\n')}`;
}

// ── Session Dialog ────────────────────────────────────────────────────────────

function SessionDialog({
  session,
  onClose,
  onRecall,
}: {
  session: Session;
  onClose: () => void;
  onRecall: (text: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative z-10 w-[600px] max-w-[90vw] max-h-[80vh] flex flex-col bg-background border border-border rounded-lg shadow-2xl">
        <div className="flex items-center justify-between px-4 h-11 border-b border-border flex-shrink-0">
          <span className="text-sm font-medium text-foreground">{formatDate(session.startedAt)}</span>
          <div className="flex items-center gap-2">
            <button
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              onClick={() => {
                onRecall(buildRecallText(session));
                onClose();
              }}
            >
              <Brain className="h-3 w-3" />
              回忆
            </button>
            <button
              className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {session.messages.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">本次会话暂无记录</p>
          )}
          {session.messages.map((msg, i) => (
            <div key={i} className={cn('flex gap-2.5', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
              <div className={cn(
                'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5',
                msg.role === 'user' ? 'bg-blue-600/20' : 'bg-muted'
              )}>
                {msg.role === 'user'
                  ? <User className="h-3 w-3 text-blue-400" />
                  : <Bot className="h-3 w-3 text-muted-foreground" />
                }
              </div>

              <div className={cn(
                'max-w-[85%] text-xs rounded-lg px-3 py-2 whitespace-pre-wrap break-words',
                msg.role === 'user'
                  ? 'bg-blue-600/20 text-blue-100 dark:text-blue-100 border border-blue-500/20'
                  : 'bg-muted text-foreground border border-border'
              )}>
                {msg.content}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── History Tab ───────────────────────────────────────────────────────────────

function HistoryTab({
  projectId,
  onSend,
}: {
  projectId: string;
  onSend: (text: string) => void;
}) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [openSession, setOpenSession] = useState<Session | null>(null);

  const visibleSessions = sessions.filter((s) => s.messageCount > 0);
  const recentId = visibleSessions.find((s) => !s.isCurrent)?.id;

  useEffect(() => {
    void getSessions(projectId).then(setSessions).catch(() => setSessions([]));
    const t = setInterval(() => {
      void getSessions(projectId).then(setSessions).catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [projectId]);

  const handleOpen = async (id: string) => {
    try {
      setOpenSession(await getSession(projectId, id));
    } catch { /* ignore */ }
  };

  const handleRecall = (text: string) => {
    onSend(text + '\r');
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0">
        {visibleSessions.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground/50">
            <Bot className="h-5 w-5" />
            <p className="text-xs text-center">暂无历史记录</p>
          </div>
        )}

        {visibleSessions.map((s) => {
          const isCurrent = s.isCurrent;
          const isRecent = !s.isCurrent && s.id === recentId;
          return (
            <div
              key={s.id}
              className={cn(
                'group rounded border bg-muted hover:border-muted-foreground/30 transition-colors',
                isCurrent ? 'border-blue-500/50' : 'border-border'
              )}
            >
              <button
                className="w-full text-left px-3 pt-2 pb-1"
                onClick={() => void handleOpen(s.id)}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-foreground">{formatDate(s.startedAt)}</span>
                  {isCurrent && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 leading-none">当前</span>
                  )}
                  {isRecent && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border leading-none">最近</span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{s.messageCount} 条消息</div>
              </button>

              <div className="px-3 pb-2 flex justify-end">
                <button
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-secondary hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      const full = await getSession(projectId, s.id);
                      handleRecall(buildRecallText(full));
                    } catch { /* ignore */ }
                  }}
                >
                  <Brain className="h-2.5 w-2.5" />
                  回忆
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {openSession && (
        <SessionDialog
          session={openSession}
          onClose={() => setOpenSession(null)}
          onRecall={handleRecall}
        />
      )}
    </>
  );
}

// ── RightPanel ────────────────────────────────────────────────────────────────

type Tab = 'shortcuts' | 'history' | 'graph';

const TAB_LABELS: Record<Tab, string> = {
  shortcuts: '快捷命令',
  history: '历史记录',
  graph: '图谱',
};

interface RightPanelProps {
  projectId: string;
  folderPath: string;
  onSend: (text: string) => void;
}

export function RightPanel({ projectId, folderPath, onSend }: RightPanelProps) {
  const [tab, setTab] = useState<Tab>('shortcuts');

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      <div className="flex border-b border-border flex-shrink-0">
        {(['shortcuts', 'history', 'graph'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'flex-1 text-xs py-2 font-medium transition-colors',
              tab === t
                ? 'text-foreground border-b-2 border-blue-500 -mb-px bg-muted/50'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'shortcuts' && <ShortcutPanel projectId={projectId} onSend={onSend} />}
      {tab === 'history' && <HistoryTab projectId={projectId} onSend={onSend} />}
      {tab === 'graph' && <GraphPreview folderPath={folderPath} />}
    </div>
  );
}
