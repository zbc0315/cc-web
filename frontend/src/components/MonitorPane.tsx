import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Project } from '@/types';
import { useMonitorWebSocket, ChatMessage } from '@/lib/websocket';
import { useChatSession } from '@/hooks/useChatSession';
import { useChatPinnedScroll } from '@/hooks/useChatPinnedScroll';
import { useEnterToSubmit } from '@/hooks/useEnterToSubmit';

interface MonitorPaneProps {
  project: Project;
  externalStatus?: 'running' | 'stopped' | 'restarting';
  active?: boolean;
}

export const MonitorPane = React.memo(function MonitorPane({ project, externalStatus, active = false }: MonitorPaneProps) {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [flash, setFlash] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Bridge WS chat_message events into liveMessages[] for the hook to consume
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const prevAssistantCountRef = useRef(0);

  const handleChatMessage = useCallback((msg: ChatMessage) => {
    setLiveMessages((prev) => {
      const next = [...prev, msg];
      return next.length > 200 ? next.slice(-200) : next;
    });
    // Flash on new assistant message
    if (msg.role === 'assistant') {
      setFlash(true);
      setTimeout(() => setFlash(false), 1000);
    }
  }, []);

  // Placeholder; actual setter bound after useChatSession below
  const handleWsStatus = useCallback((status: 'running' | 'stopped' | 'restarting') => {
    // Intentional: we rely on the hook's setState below, bound via setStateRef
    if (status === 'stopped') setStateRef.current?.('stopped');
  }, []);

  const { sendInput: wsSendInput, connected: wsConnected } = useMonitorWebSocket({
    projectId: project.id,
    enabled: true, // always try to connect for monitor view; hook gates on connected
    onChatMessage: handleChatMessage,
    onStatusChange: handleWsStatus,
  });

  const {
    state, setState, messages, hasMoreHistory: _hasMore, sendMessage, isRunning, isWaking,
  } = useChatSession({
    project,
    liveMessages,
    ws: { send: wsSendInput, connected: wsConnected },
    historyLimit: 4,
    liveWindow: 4,
  });
  void _hasMore;

  // Expose setState to handleWsStatus defined before the hook call
  const setStateRef = useRef(setState);
  setStateRef.current = setState;

  // Clear live buffer when state resets to stopped/waking → preserves no-redundant-messages on restart
  useEffect(() => {
    if (state === 'stopped') {
      setLiveMessages([]);
      prevAssistantCountRef.current = 0;
    }
  }, [state]);

  // Handle external status (from dashboard WS) — jump to live/stopped accordingly
  useEffect(() => {
    if (!externalStatus) return;
    if (externalStatus === 'running' && (state === 'stopped' || state === 'error')) {
      setLiveMessages([]);
      setState('live');
    } else if (externalStatus === 'stopped' && state === 'live') {
      setState('stopped');
    }
  }, [externalStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll: pin to bottom unless user scrolled up (<80px from bottom = pinned)
  useChatPinnedScroll(scrollRef, contentRef, [messages]);

  // Send handler — disabled-gray input until sendMessage resolves. 'delivered'
  // clears input; 'failed' keeps the text so the user can retry without
  // retyping (matches the spec across all three send surfaces).
  const [sending, setSending] = useState(false);
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    const result = await sendMessage(text);
    setSending(false);
    if (result === 'delivered') setInput('');
  }, [input, sending, sendMessage]);

  const handleKeyDown = useEnterToSubmit(handleSend, 'enter');

  const isStopped = state === 'stopped';
  // Monitor pane shows only the last 4 messages regardless of what the hook has
  const shown = messages.slice(-4);

  const pane = (
    <div
      className={cn(
        'flex flex-col h-full rounded-xl overflow-hidden bg-background transition-colors duration-300',
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 text-xs">
        <div ref={contentRef} className="p-2 space-y-2 min-h-full">
          {shown.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div key={msg.id} className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  'max-w-[85%] rounded-2xl px-2.5 py-1.5 whitespace-pre-wrap break-words leading-relaxed',
                  isUser
                    ? 'bg-blue-500/15 text-foreground border border-blue-500/20 rounded-br-sm dark:bg-blue-500/20 dark:border-blue-500/25'
                    : 'bg-secondary text-secondary-foreground border border-border rounded-bl-sm',
                )}>
                  <div className="line-clamp-6">{msg.content}</div>
                </div>
              </div>
            );
          })}
          {isStopped && shown.length === 0 && (
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
      </div>

      {/* Input */}
      <div className="border-t border-border p-1.5">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isWaking || sending}
          placeholder={
            isWaking ? '启动中...'
            : sending ? '发送中…'
            : isStopped ? '输入命令（自动启动）... Shift+⏎'
            : '输入命令... Shift+⏎'
          }
          className={cn(
            'w-full bg-transparent text-xs font-mono outline-none placeholder:text-muted-foreground/40 px-1.5 py-1',
            (isWaking || sending) && 'opacity-50 cursor-not-allowed',
          )}
        />
      </div>
    </div>
  );

  return active
    ? <div className="card-active-glow rounded-xl h-full">{pane}</div>
    : pane;
});
