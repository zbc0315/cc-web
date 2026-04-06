import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Project } from '@/types';
import { getConversations, getConversationDetail, startProject } from '@/lib/api';
import { useMonitorWebSocket, ChatMessage } from '@/lib/websocket';
import { toast } from 'sonner';

type PaneState = 'stopped' | 'waking' | 'live' | 'error';

interface MonitorPaneProps {
  project: Project;
  externalStatus?: 'running' | 'stopped' | 'restarting';
}

function formatChatContent(blocks: ChatMessage['blocks']): string {
  return blocks
    .filter(b => b.type === 'text' || b.type === 'tool_use' || b.type === 'tool_result')
    .map(b => {
      if (b.type === 'tool_use') {
        const truncated = b.content.length > 60 ? b.content.slice(0, 60) + '...' : b.content;
        return `[工具] ${truncated}`;
      }
      if (b.type === 'tool_result') {
        const truncated = b.content.length > 80 ? b.content.slice(0, 80) + '...' : b.content;
        return `→ ${truncated}`;
      }
      return b.content;
    })
    .join('\n');
}

export const MonitorPane = React.memo(function MonitorPane({ project, externalStatus }: MonitorPaneProps) {
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

  // ── Load history for stopped projects from information system ──
  useEffect(() => {
    if (state !== 'stopped') return;
    let cancelled = false;
    // Get most recent conversation from information system, parse v0.md
    getConversations(project.id, 1).then(async (convs) => {
      if (cancelled || convs.length === 0) return;
      try {
        const detail = await getConversationDetail(project.id, convs[0].id, 'latest', 'user');
        if (cancelled) return;
        // Parse ## U{n} / ## A{n} sections into messages
        const sections = detail.content.split(/(?=^## [UA]\d+)/m).filter(Boolean);
        const msgs: { role: string; content: string; ts: string }[] = [];
        for (const section of sections) {
          const match = section.match(/^## ([UA])(\d+).*\n/);
          if (!match) continue;
          const role = match[1] === 'U' ? 'user' : 'assistant';
          const body = section.slice(match[0].length).trim();
          if (body) msgs.push({ role, content: body, ts: '' });
        }
        // Keep last 20 messages
        setMessages(msgs.slice(-20));
      } catch { /* silent */ }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [project.id, state]);

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
    const content = formatChatContent(msg.blocks);
    if (!content.trim()) return;
    setMessages(prev => {
      const next = [...prev, { role: msg.role, content, ts: msg.timestamp }];
      return next.length > 50 ? next.slice(-50) : next;
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

  return (
    <div
      className={cn(
        'flex flex-col border rounded-lg overflow-hidden bg-background transition-colors duration-300',
        flash ? 'border-blue-500' : 'border-border',
        state === 'error' && 'border-red-500/50',
      )}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => navigate(`/projects/${project.id}`)}
        title="打开项目详情"
      >
        <span className="font-medium text-sm truncate flex-1">{project.name}</span>
        <span className="text-[10px] text-muted-foreground font-mono">{project.cliTool ?? 'claude'}</span>
        <span className={cn(
          'w-2 h-2 rounded-full flex-shrink-0',
          isRunning ? 'bg-green-500' : isWaking ? 'bg-yellow-400 animate-pulse' : 'bg-zinc-400',
        )} />
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0 text-xs">
        {isStopped && messages.length > 0 && (
          <div className="text-[10px] text-muted-foreground/50 mb-1">最近对话</div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={cn(
            'leading-relaxed whitespace-pre-wrap break-words',
            msg.role === 'user'
              ? 'text-muted-foreground/60 pl-2 border-l border-muted-foreground/20'
              : 'text-foreground',
          )}>
            {msg.content}
          </div>
        ))}
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
});
