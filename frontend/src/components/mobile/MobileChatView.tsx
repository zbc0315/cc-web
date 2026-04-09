import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, FolderOpen, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Project } from '@/types';
import { getConversations, getConversationDetail, startProject } from '@/lib/api';
import { useMonitorWebSocket, ChatMessage } from '@/lib/websocket';
import { formatChatContent } from '@/lib/chatUtils';
import { toast } from 'sonner';

type ChatState = 'stopped' | 'waking' | 'live' | 'error';

interface ChatMsg {
  role: string;
  content: string;
  ts: string;
}

interface MobileChatViewProps {
  project: Project;
  onBack: () => void;
  onOpenFiles: () => void;
}

export function MobileChatView({ project, onBack, onOpenFiles }: MobileChatViewProps) {
  const [state, setState] = useState<ChatState>(
    project.status === 'running' ? 'live' : 'stopped',
  );
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingInputRef = useRef<string | null>(null);
  const liveReceivedRef = useRef(false);
  const wakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load history from information API ──
  const loadFromInformation = useCallback(async () => {
    try {
      const convs = await getConversations(project.id, 1);
      if (convs.length === 0) return;
      const detail = await getConversationDetail(project.id, convs[0].id, 'latest', 'user');
      const sections = detail.content.split(/(?=^## [UA]\d+)/m).filter(Boolean);
      const msgs: ChatMsg[] = [];
      for (const section of sections) {
        const match = section.match(/^## ([UA])(\d+).*\n/);
        if (!match) continue;
        const role = match[1] === 'U' ? 'user' : 'assistant';
        const body = section.slice(match[0].length).trim();
        if (body) msgs.push({ role, content: body, ts: '' });
      }
      setMessages((prev) => (prev.length === 0 ? msgs.slice(-20) : prev));
    } catch { /* silent */ }
  }, [project.id]);

  // Load for stopped projects
  useEffect(() => {
    if (state !== 'stopped') return;
    void loadFromInformation();
  }, [state, loadFromInformation]);

  // 3s fallback for live projects
  useEffect(() => {
    if (state !== 'live') { liveReceivedRef.current = false; return; }
    const timer = setTimeout(() => {
      if (!liveReceivedRef.current) void loadFromInformation();
    }, 3000);
    return () => clearTimeout(timer);
  }, [state, loadFromInformation]);

  // ── External status sync ──
  useEffect(() => {
    if (project.status === 'running' && (state === 'stopped' || state === 'error')) {
      setMessages([]);
      setState('live');
    } else if (project.status === 'stopped' && state === 'live') {
      setState('stopped');
    }
  }, [project.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── WebSocket ──
  const handleChatMessage = useCallback((msg: ChatMessage) => {
    liveReceivedRef.current = true;
    const content = formatChatContent(msg.blocks);
    if (!content.trim()) return;
    setMessages((prev) => [...prev, { role: msg.role, content, ts: msg.timestamp }].slice(-50));
  }, []);

  const handleWsStatus = useCallback((status: 'running' | 'stopped' | 'restarting') => {
    if (status === 'stopped') setState('stopped');
  }, []);

  const { sendInput: wsSendInput } = useMonitorWebSocket({
    projectId: project.id,
    enabled: state === 'live' || state === 'waking',
    onChatMessage: handleChatMessage,
    onStatusChange: handleWsStatus,
  });

  // Send pending input after waking → live
  useEffect(() => {
    if (state === 'live' && pendingInputRef.current) {
      const pending = pendingInputRef.current;
      pendingInputRef.current = null;
      const timer = setTimeout(() => wsSendInput(pending + '\r'), 2000);
      return () => clearTimeout(timer);
    }
  }, [state, wsSendInput]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Cleanup
  useEffect(() => {
    return () => { if (wakingTimerRef.current) clearTimeout(wakingTimerRef.current); };
  }, []);

  // ── Send ──
  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');

    if (state === 'live') {
      wsSendInput(text + '\r');
    } else if (state === 'stopped' || state === 'error') {
      pendingInputRef.current = text;
      setState('waking');
      startProject(project.id)
        .then(() => {
          if (wakingTimerRef.current) clearTimeout(wakingTimerRef.current);
          setMessages([]); setState('live');
        })
        .catch((err) => {
          toast.error(`启动失败: ${err instanceof Error ? err.message : String(err)}`);
          setState('error');
          setInput(text);
          pendingInputRef.current = null;
        });
      wakingTimerRef.current = setTimeout(() => {
        if (pendingInputRef.current) {
          toast.error('启动超时（10s）');
          setState('error');
          setInput(pendingInputRef.current);
          pendingInputRef.current = null;
        }
      }, 10000);
    }
  }, [input, state, project.id, wsSendInput]);

  const isRunning = state === 'live';
  const isWaking = state === 'waking';

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-12 border-b border-border shrink-0">
        <button onClick={onBack} className="text-muted-foreground active:text-foreground p-1">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="font-medium text-sm truncate">{project.name}</span>
          <span className={cn(
            'w-2 h-2 rounded-full shrink-0',
            isRunning ? 'bg-green-500' : isWaking ? 'bg-yellow-400 animate-pulse' : 'bg-zinc-400',
          )} />
        </div>
        <button onClick={onOpenFiles} className="text-muted-foreground active:text-foreground p-1">
          <FolderOpen className="h-5 w-5" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {messages.map((msg, i) => {
          const isUser = msg.role === 'user';
          return (
            <div key={i} className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[85%] rounded-xl px-3 py-2 whitespace-pre-wrap break-words text-sm leading-relaxed',
                isUser
                  ? 'bg-blue-500/15 text-foreground border border-blue-500/20 rounded-br-sm'
                  : 'bg-secondary text-secondary-foreground border border-border rounded-bl-sm',
              )}>
                {msg.content}
              </div>
            </div>
          );
        })}

        {messages.length === 0 && state === 'stopped' && (
          <div className="flex items-center justify-center h-full text-muted-foreground/40 text-sm">
            暂无对话记录
          </div>
        )}

        {isWaking && (
          <div className="flex items-center justify-center py-4 text-yellow-400 text-sm animate-pulse">
            启动中...
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-border px-3 py-2 shrink-0" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={isWaking}
            placeholder={
              isWaking ? '启动中...'
              : state === 'stopped' ? '输入消息（自动启动）...'
              : '输入消息...'
            }
            rows={1}
            className={cn(
              'flex-1 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none',
              'focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50',
              'max-h-32 overflow-y-auto',
              isWaking && 'opacity-50 cursor-not-allowed',
            )}
            style={{ minHeight: '2.5rem' }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 128) + 'px';
            }}
          />
          <button
            onClick={handleSend}
            disabled={isWaking || !input.trim()}
            className={cn(
              'shrink-0 p-2 rounded-lg transition-colors',
              input.trim() ? 'text-blue-500 active:bg-blue-500/10' : 'text-muted-foreground/30',
            )}
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
