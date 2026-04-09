import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Project } from '@/types';
import { getConversations, getConversationDetail, startProject } from '@/lib/api';
import { useMonitorWebSocket, ChatMessage } from '@/lib/websocket';
import { formatChatContent } from '@/lib/chatUtils';
import { toast } from 'sonner';

type PaneState = 'stopped' | 'waking' | 'live' | 'error';

interface MonitorPaneProps {
  project: Project;
  externalStatus?: 'running' | 'stopped' | 'restarting';
  active?: boolean;
}

export const MonitorPane = React.memo(function MonitorPane({ project, externalStatus, active = false }: MonitorPaneProps) {
  const navigate = useNavigate();
  const [state, setState] = useState<PaneState>(
    project.status === 'running' ? 'live' : 'stopped',
  );
  const [messages, setMessages] = useState<{ role: string; content: string; ts: string }[]>([]);
  const [input, setInput] = useState('');
  const [flash, setFlash] = useState(false);
  const pendingInputRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load history from information system (used by both stopped and live fallback) ──
  const loadFromInformation = useCallback(async () => {
    try {
      const convs = await getConversations(project.id, 1);
      if (convs.length === 0) return;
      const detail = await getConversationDetail(project.id, convs[0].id, 'latest', 'user');
      const sections = detail.content.split(/(?=^## [UA]\d+)/m).filter(Boolean);
      const msgs: { role: string; content: string; ts: string }[] = [];
      for (const section of sections) {
        const match = section.match(/^## ([UA])(\d+).*\n/);
        if (!match) continue;
        const role = match[1] === 'U' ? 'user' : 'assistant';
        const body = section.slice(match[0].length).trim();
        if (body) msgs.push({ role, content: body, ts: '' });
      }
      setMessages(prev => prev.length === 0 ? msgs.slice(-4) : prev);
    } catch { /* silent */ }
  }, [project.id]);

  // Load for stopped projects
  useEffect(() => {
    if (state !== 'stopped') return;
    void loadFromInformation();
  }, [state, loadFromInformation]);

  // Fallback for live projects: if no chat_message after 3s, load from information
  const liveReceivedRef = useRef(false);
  useEffect(() => {
    if (state !== 'live') { liveReceivedRef.current = false; return; }
    const timer = setTimeout(() => {
      if (!liveReceivedRef.current) void loadFromInformation();
    }, 3000);
    return () => clearTimeout(timer);
  }, [state, loadFromInformation]);

  // ── External status changes (from dashboard WS) ──
  useEffect(() => {
    if (!externalStatus) return;
    if (externalStatus === 'running' && (state === 'stopped' || state === 'error')) {
      // Project started externally → jump to live
      setMessages([]);
      setState('live');
    } else if (externalStatus === 'stopped' && state === 'live') {
      setState('stopped');
    }
  }, [externalStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── WebSocket for live mode ──
  const handleChatMessage = useCallback((msg: ChatMessage) => {
    liveReceivedRef.current = true;
    const content = formatChatContent(msg.blocks);
    if (!content.trim()) return;
    setMessages(prev => {
      const next = [...prev, { role: msg.role, content, ts: msg.timestamp }];
      return next.slice(-4); // Keep last 2 rounds (U-A pairs)
    });
    // Flash border on new assistant message
    if (msg.role === 'assistant') {
      setFlash(true);
      setTimeout(() => setFlash(false), 1000);
    }
  }, []);

  const handleWsStatus = useCallback((status: 'running' | 'stopped' | 'restarting') => {
    if (status === 'stopped') {
      setState('stopped');
    }
  }, []);

  const { sendInput: wsSendInput } = useMonitorWebSocket({
    projectId: project.id,
    enabled: state === 'live' || state === 'waking',
    onChatMessage: handleChatMessage,
    onStatusChange: handleWsStatus,
  });

  // ── When entering live from waking, send pending input after delay ──
  useEffect(() => {
    if (state === 'live' && pendingInputRef.current) {
      const pending = pendingInputRef.current;
      pendingInputRef.current = null;
      // Wait 2s for CLI to initialize
      const timer = setTimeout(() => {
        wsSendInput(pending + '\r');
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [state, wsSendInput]);

  // ── Auto-scroll ──
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // ── Cleanup ──
  useEffect(() => {
    return () => {
      if (wakingTimerRef.current) clearTimeout(wakingTimerRef.current);
    };
  }, []);

  // ── Send handler ──
  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');

    if (state === 'live') {
      wsSendInput(text + '\r');
    } else if (state === 'stopped' || state === 'error') {
      // Auto-wake: start project then send
      pendingInputRef.current = text;
      setState('waking');
      startProject(project.id)
        .then(() => {
          // Wait for WS to connect and replay, then state will go to live
          setMessages([]);
          setState('live');
        })
        .catch((err) => {
          toast.error(`启动失败: ${err instanceof Error ? err.message : String(err)}`);
          setState('error');
          setInput(text); // Restore input
          pendingInputRef.current = null;
        });

      // Timeout fallback
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isRunning = state === 'live';
  const isStopped = state === 'stopped';
  const isWaking = state === 'waking';

  const pane = (
    <div
      className={cn(
        'flex flex-col h-full rounded-lg overflow-hidden bg-background transition-colors duration-300',
        active
          ? 'border-transparent bg-transparent shadow-none'
          : flash ? 'border border-blue-500' : 'border border-border',
        state === 'error' && 'border border-red-500/50',
      )}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-1 px-1.5 py-1.5 border-b border-border bg-muted/30 transition-colors"
      >
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0 cursor-grab active:cursor-grabbing" />
        <span
          className="font-medium text-sm truncate flex-1 cursor-pointer hover:text-blue-400 transition-colors"
          onClick={() => navigate(`/projects/${project.id}`)}
          title="打开项目详情"
        >{project.name}</span>
        <span className="text-[10px] text-muted-foreground font-mono">{project.cliTool ?? 'claude'}</span>
        <span className={cn(
          'w-2 h-2 rounded-full flex-shrink-0',
          isRunning ? 'bg-green-500' : isWaking ? 'bg-yellow-400 animate-pulse' : 'bg-zinc-400',
        )} />
      </div>

      {/* Messages — chat bubbles */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0 text-xs">
        {messages.map((msg, i) => {
          const isUser = msg.role === 'user';
          return (
            <div key={i} className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[85%] rounded-lg px-2.5 py-1.5 whitespace-pre-wrap break-words leading-relaxed',
                isUser
                  ? 'bg-blue-500/15 text-foreground border border-blue-500/20 rounded-br-sm dark:bg-blue-500/20 dark:border-blue-500/25'
                  : 'bg-secondary text-secondary-foreground border border-border rounded-bl-sm',
              )}>
                <div className="line-clamp-6">{msg.content}</div>
              </div>
            </div>
          );
        })}
        {isStopped && messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-muted-foreground/40 text-xs">
            无对话记录
          </div>
        )}
        {isWaking && (
          <div className="flex items-center justify-center h-full text-yellow-400 text-xs animate-pulse">
            启动中...
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border p-1.5">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isWaking}
          placeholder={
            isWaking ? '启动中...'
            : isStopped ? '输入命令（自动启动）... Shift+⏎'
            : '输入命令... Shift+⏎'
          }
          className={cn(
            'w-full bg-transparent text-xs font-mono outline-none placeholder:text-muted-foreground/40 px-1.5 py-1',
            isWaking && 'opacity-50 cursor-not-allowed',
          )}
        />
      </div>
    </div>
  );

  return active
    ? <div className="card-active-glow rounded-lg h-full">{pane}</div>
    : pane;
});
