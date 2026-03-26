import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getSharedSession, Session } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Bot, User } from 'lucide-react';

export function ShareViewPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [projectName, setProjectName] = useState<string>('');

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    getSharedSession(token)
      .then(({ session, projectName }) => {
        setSession(session);
        setProjectName(projectName);
      })
      .catch((err: Error) => setError(err.message || '链接无效或已过期'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <span className="text-muted-foreground text-sm">加载中…</span>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-2">
          <p className="text-foreground font-medium">无法加载会话</p>
          <p className="text-muted-foreground text-sm">{error ?? '链接无效或已过期'}</p>
        </div>
      </div>
    );
  }

  const sessionDate = new Date(session.startedAt).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-foreground">{projectName}</h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
            <span>{sessionDate}</span>
            <span>·</span>
            <span>{session.messageCount} 条消息</span>
          </div>
        </div>

        {/* Messages */}
        <div className="space-y-4">
          {session.messages.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">本次会话暂无记录</p>
          )}
          {session.messages.map((msg, i) => (
            <div key={i} className={cn('flex gap-2.5', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
              <div className={cn(
                'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5',
                msg.role === 'user' ? 'bg-blue-500/10' : 'bg-muted'
              )}>
                {msg.role === 'user'
                  ? <User className="h-3.5 w-3.5 text-blue-400" />
                  : <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                }
              </div>
              <div className={cn(
                'max-w-[85%] text-sm rounded-lg px-3 py-2 whitespace-pre-wrap break-words',
                msg.role === 'user'
                  ? 'bg-blue-500/10 text-blue-400'
                  : 'bg-muted text-foreground'
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
