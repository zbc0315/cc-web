import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Menu, Send, Globe, Bookmark, ChevronDown, ChevronUp } from 'lucide-react';
import { AssistantMessageContent } from '@/components/AssistantMessageContent';
import { cn } from '@/lib/utils';
import { Project } from '@/types';
import { getGlobalShortcuts, getProjectShortcuts, GlobalShortcut, ProjectShortcut } from '@/lib/api';
import { useMonitorWebSocket, ChatMessage, ContextUpdate } from '@/lib/websocket';
import { useChatSession } from '@/hooks/useChatSession';

const HISTORY_PAGE = 20;

interface MobileChatViewProps {
  project: Project;
  onBack: () => void;
  onOpenPanel: () => void;
  onContextUpdate?: (data: ContextUpdate) => void;
}

export function MobileChatView({ project, onBack, onOpenPanel, onContextUpdate }: MobileChatViewProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Bridge WS chat_message events into liveMessages[] for useChatSession to consume
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const handleChatMessage = useCallback((msg: ChatMessage) => {
    setLiveMessages((prev) => [...prev, msg]);
  }, []);

  const setStateRef = useRef<((s: 'stopped' | 'waking' | 'live' | 'error') => void) | null>(null);
  const handleWsStatus = useCallback((status: 'running' | 'stopped' | 'restarting') => {
    if (status === 'stopped') setStateRef.current?.('stopped');
  }, []);

  const { sendInput: wsSendInput, connected: wsConnected } = useMonitorWebSocket({
    projectId: project.id,
    enabled: true, // always connect; useChatSession gates sends on `connected`
    onChatMessage: handleChatMessage,
    onStatusChange: handleWsStatus,
    onContextUpdate,
  });

  const {
    state, setState, messages, hasMoreHistory, loadMoreHistory, sendMessage, isWaking,
  } = useChatSession({
    project,
    liveMessages,
    ws: { send: wsSendInput, connected: wsConnected },
    historyLimit: HISTORY_PAGE,
  });
  setStateRef.current = setState;

  // Clear the live buffer on WS reconnect-style reset so useChatSession
  // can re-consume replay without duplicates. Deliberate: mobile uses
  // useMonitorWebSocket which doesn't expose a direct onConnected reset.
  // Derived trigger: when wsConnected flips false → true we clear.
  const prevConnectedRef = useRef(wsConnected);
  useEffect(() => {
    if (!prevConnectedRef.current && wsConnected) {
      setLiveMessages([]);
    }
    prevConnectedRef.current = wsConnected;
  }, [wsConnected]);

  // Compute latest assistant index for isLatest prop (enables streaming UI hint)
  const latestAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  })();

  // ── Shortcuts ──
  const [globalShortcuts, setGlobalShortcuts] = useState<GlobalShortcut[]>([]);
  const [projectShortcuts, setProjectShortcuts] = useState<ProjectShortcut[]>([]);
  const [expandedPanel, setExpandedPanel] = useState<'global' | 'project' | null>(null);

  useEffect(() => {
    getGlobalShortcuts().then(setGlobalShortcuts).catch(() => {});
    getProjectShortcuts(project.id).then(setProjectShortcuts).catch(() => {});
  }, [project.id]);

  // Preserve scroll position when "load earlier" prepends new content to the top
  const handleLoadMore = useCallback(async () => {
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    await loadMoreHistory();
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - prevHeight;
    });
  }, [loadMoreHistory]);

  // Auto-scroll on new messages. Separate effect for initial history to
  // only jump-to-bottom on first paint (not on "load earlier").
  const prevMessageCountRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = messages.length > prevMessageCountRef.current;
    const isFirst = prevMessageCountRef.current === 0 && messages.length > 0;
    prevMessageCountRef.current = messages.length;
    if (isFirst) {
      el.scrollTo({ top: el.scrollHeight });
    } else if (grew) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    sendMessage(text);
  }, [input, sendMessage]);

  const handleShortcut = useCallback((command: string) => {
    setExpandedPanel(null);
    sendMessage(command);
  }, [sendMessage]);

  const isRunning = state === 'live';

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
        <button onClick={onOpenPanel} className="text-muted-foreground active:text-foreground p-1">
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {/* Load more history */}
        {hasMoreHistory && (
          <div className="flex justify-center pb-1">
            <button
              onClick={() => { void handleLoadMore(); }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs text-muted-foreground border border-border active:bg-accent transition-colors"
            >
              <ChevronUp className="h-3 w-3" />
              加载更早消息
            </button>
          </div>
        )}
        {messages.map((msg, i) => {
          const isUser = msg.role === 'user';
          return (
            <div key={msg.id} className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[85%] rounded-xl px-3 py-2 break-words text-sm leading-relaxed',
                isUser
                  ? 'bg-blue-500/15 text-foreground border border-blue-500/20 rounded-br-sm whitespace-pre-wrap'
                  : 'bg-secondary text-secondary-foreground border border-border rounded-bl-sm',
              )}>
                {isUser ? msg.content : (
                  <AssistantMessageContent
                    content={msg.content}
                    isLatest={i === latestAssistantIdx}
                  />
                )}
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

      {/* Shortcuts panel (expanded) */}
      {expandedPanel && (
        <div className="border-t border-border max-h-48 overflow-y-auto shrink-0">
          <div className="px-3 py-2 space-y-1">
            {(expandedPanel === 'global' ? globalShortcuts : projectShortcuts).map((s) => (
              <button
                key={s.id}
                onClick={() => handleShortcut(s.command)}
                disabled={isWaking}
                className={cn('w-full text-left rounded-md px-2.5 py-2 text-sm active:bg-accent transition-colors border border-border/50', isWaking && 'opacity-50 cursor-not-allowed')}
              >
                <div className="font-medium text-xs">{s.label}</div>
                <div className="text-[11px] text-muted-foreground font-mono truncate">{s.command}</div>
              </button>
            ))}
            {(expandedPanel === 'global' ? globalShortcuts : projectShortcuts).length === 0 && (
              <div className="text-center text-muted-foreground text-xs py-3">
                暂无快捷命令
              </div>
            )}
          </div>
        </div>
      )}

      {/* Shortcuts bar */}
      {(globalShortcuts.length > 0 || projectShortcuts.length > 0) && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-border shrink-0">
          <button
            onClick={() => setExpandedPanel((p) => p === 'global' ? null : 'global')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors',
              expandedPanel === 'global'
                ? 'bg-blue-500/15 text-blue-500'
                : 'text-muted-foreground active:bg-accent',
            )}
          >
            <Globe className="h-3 w-3" />
            全局
            {expandedPanel === 'global' && <ChevronDown className="h-3 w-3" />}
          </button>
          <button
            onClick={() => setExpandedPanel((p) => p === 'project' ? null : 'project')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors',
              expandedPanel === 'project'
                ? 'bg-blue-500/15 text-blue-500'
                : 'text-muted-foreground active:bg-accent',
            )}
          >
            <Bookmark className="h-3 w-3" />
            项目
            {expandedPanel === 'project' && <ChevronDown className="h-3 w-3" />}
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-border px-3 py-2 shrink-0" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
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
