import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ArrowLeft, Menu, Send, Globe, Bookmark, ChevronDown, ChevronUp } from 'lucide-react';
import { AssistantMessageContent } from '@/components/AssistantMessageContent';
import { cn } from '@/lib/utils';
import { Project } from '@/types';
import { getConversations, getConversationDetail, startProject, getGlobalShortcuts, getProjectShortcuts, GlobalShortcut, ProjectShortcut } from '@/lib/api';
import { useMonitorWebSocket, ChatMessage, ContextUpdate } from '@/lib/websocket';
import { formatChatContent } from '@/lib/chatUtils';
import { toast } from 'sonner';

type ChatState = 'stopped' | 'waking' | 'live' | 'error';
const HISTORY_PAGE = 20;

interface ChatMsg {
  id: string;
  role: string;
  content: string;
  ts: string;
}

interface MobileChatViewProps {
  project: Project;
  onBack: () => void;
  onOpenPanel: () => void;
  onContextUpdate?: (data: ContextUpdate) => void;
}

export function MobileChatView({ project, onBack, onOpenPanel, onContextUpdate }: MobileChatViewProps) {
  const [state, setState] = useState<ChatState>(
    project.status === 'running' ? 'live' : 'stopped',
  );
  const [liveMessages, setLiveMessages] = useState<ChatMsg[]>([]);
  const msgIdRef = useRef(0);
  const nextMsgId = useCallback(() => `m${++msgIdRef.current}`, []);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingInputRef = useRef<string | null>(null);
  const liveReceivedRef = useRef(false);
  const recentSentRef = useRef<string[]>([]);
  const wakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Incremented on each wake attempt; stale completions are ignored */
  const wakeIdRef = useRef(0);

  // ── History pagination ──
  const allHistoryRef = useRef<ChatMsg[]>([]);
  const [historySlice, setHistorySlice] = useState<ChatMsg[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);

  const messages = useMemo(() => [...historySlice, ...liveMessages], [historySlice, liveMessages]);
  const latestAssistantIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  }, [messages]);

  // ── Shortcuts ──
  const [globalShortcuts, setGlobalShortcuts] = useState<GlobalShortcut[]>([]);
  const [projectShortcuts, setProjectShortcuts] = useState<ProjectShortcut[]>([]);
  const [expandedPanel, setExpandedPanel] = useState<'global' | 'project' | null>(null);

  useEffect(() => {
    getGlobalShortcuts().then(setGlobalShortcuts).catch(() => {});
    getProjectShortcuts(project.id).then(setProjectShortcuts).catch(() => {});
  }, [project.id]);

  // ── Load history from information API ──
  const liveCountRef = useRef(0);
  liveCountRef.current = liveMessages.length;

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
        if (body) msgs.push({ id: nextMsgId(), role, content: body, ts: '' });
      }
      // Only set if no live messages yet (avoid overwriting active session)
      if (liveCountRef.current === 0) {
        allHistoryRef.current = msgs;
        setHistorySlice(msgs.slice(-HISTORY_PAGE));
        setHasMoreHistory(msgs.length > HISTORY_PAGE);
      }
    } catch {
      toast.error('加载对话历史失败');
    }
  }, [project.id, nextMsgId]);

  const loadMoreHistory = useCallback(() => {
    const all = allHistoryRef.current;
    if (all.length === 0) return;
    const currentCount = historySlice.length;
    const newCount = Math.min(currentCount + HISTORY_PAGE, all.length);
    // Save scroll position before prepending
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    setHistorySlice(all.slice(-newCount));
    setHasMoreHistory(newCount < all.length);
    // Restore scroll position after React renders
    requestAnimationFrame(() => {
      if (el) {
        const newHeight = el.scrollHeight;
        el.scrollTop += newHeight - prevHeight;
      }
    });
  }, [historySlice.length]);

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
      setLiveMessages([]);
      setState('live');
    } else if (project.status === 'stopped' && state === 'live') {
      setState('stopped');
    }
  }, [project.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Send-retry: if CLI doesn't echo back within 3s, resend \r ──
  const sendRetryRef = useRef<{ timer: ReturnType<typeof setTimeout>; attempts: number } | null>(null);

  const clearSendRetry = useCallback(() => {
    if (sendRetryRef.current) {
      clearTimeout(sendRetryRef.current.timer);
      sendRetryRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => () => clearSendRetry(), [clearSendRetry]);

  // ── WebSocket ──
  const handleChatMessage = useCallback((msg: ChatMessage) => {
    liveReceivedRef.current = true;
    const content = formatChatContent(msg.blocks);
    if (!content.trim()) return;
    if (msg.role === 'user') {
      // User-role chat message: only clear retry if it's OUR own echo coming back.
      // A stale user message (e.g. a delayed Stop hook re-read from the previous turn
      // or another session's message) must not prematurely cancel retry.
      const idx = recentSentRef.current.indexOf(content.trim());
      if (idx !== -1) {
        recentSentRef.current.splice(idx, 1);
        clearSendRetry();
        return;
      }
    } else if (msg.role === 'assistant') {
      // Assistant response = Claude processed our input → input was delivered.
      clearSendRetry();
    }
    setLiveMessages((prev) => [...prev, { id: nextMsgId(), role: msg.role, content, ts: msg.timestamp }].slice(-50));
  }, [clearSendRetry]);

  const handleWsStatus = useCallback((status: 'running' | 'stopped' | 'restarting') => {
    if (status === 'stopped') setState('stopped');
  }, []);

  const { sendInput: wsSendInput } = useMonitorWebSocket({
    projectId: project.id,
    enabled: state === 'live' || state === 'waking',
    onChatMessage: handleChatMessage,
    onStatusChange: handleWsStatus,
    onContextUpdate,
  });

  // Unified "send + retry \r" helper. Used by both live sends and post-wake flushes
  // so the stopped→live pending-flush path also gets \r retry protection (Claude
  // TUI may not be ready for input the instant startProject resolves).
  const sendWithRetry = useCallback((payload: string) => {
    wsSendInput(payload);
    clearSendRetry();
    // 4 × 2.5s = 10s window to catch stuck-in-input cases. Each retry fires a bare \r
    // to submit whatever's sitting in Claude's TUI input box. 2.5s first-retry is a
    // compromise: short enough to feel responsive, long enough that a cold Claude
    // first-token doesn't trigger a spurious \r into its stream.
    const MAX_RETRY = 4;
    const INTERVAL = 2500;
    const startRetry = (attempt: number) => {
      if (attempt >= MAX_RETRY) return;
      const timer = setTimeout(() => {
        wsSendInput('\r');
        startRetry(attempt + 1);
      }, INTERVAL);
      sendRetryRef.current = { timer, attempts: attempt };
    };
    startRetry(0);
  }, [wsSendInput, clearSendRetry]);

  // Send pending input after waking → live
  useEffect(() => {
    if (state === 'live' && pendingInputRef.current) {
      const pending = pendingInputRef.current;
      pendingInputRef.current = null;
      sendWithRetry(pending + '\r');
    }
  }, [state, sendWithRetry]);

  // Auto-scroll on new live messages or initial history load
  const prevHistoryLenRef = useRef(0);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [liveMessages]);
  useEffect(() => {
    // Scroll to bottom only on first history load (not on "load more")
    if (prevHistoryLenRef.current === 0 && historySlice.length > 0) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
    prevHistoryLenRef.current = historySlice.length;
  }, [historySlice]);

  // Cleanup
  useEffect(() => {
    return () => { if (wakingTimerRef.current) clearTimeout(wakingTimerRef.current); };
  }, []);

  // ── Unified send-to-terminal logic (handles live + waking + stopped) ──
  const sendToTerminal = useCallback((text: string) => {
    // Optimistic: show user message immediately, track for dedup (keep max 10)
    recentSentRef.current.push(text);
    if (recentSentRef.current.length > 10) recentSentRef.current.shift();
    setLiveMessages((prev) => [...prev, { id: nextMsgId(), role: 'user', content: text, ts: new Date().toISOString() }].slice(-50));

    if (state === 'live' || state === 'waking') {
      // live: WS ready or queue handles it; waking: WS connecting, queue holds it
      sendWithRetry(text + '\r');
    } else if (state === 'stopped' || state === 'error') {
      pendingInputRef.current = text;
      const thisWake = ++wakeIdRef.current;
      setState('waking');
      startProject(project.id)
        .then(() => {
          if (thisWake !== wakeIdRef.current) return; // stale wake, timeout already fired
          if (wakingTimerRef.current) clearTimeout(wakingTimerRef.current);
          setState('live');
        })
        .catch((err) => {
          if (thisWake !== wakeIdRef.current) return;
          toast.error(`启动失败: ${err instanceof Error ? err.message : String(err)}`);
          setState('error');
          pendingInputRef.current = null;
        });
      wakingTimerRef.current = setTimeout(() => {
        if (thisWake !== wakeIdRef.current) return;
        if (pendingInputRef.current) {
          toast.error('启动超时（10s）');
          setState('error');
          pendingInputRef.current = null;
        }
      }, 10000);
    }
  }, [state, project.id, sendWithRetry]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    sendToTerminal(text);
  }, [input, sendToTerminal]);

  const handleShortcut = useCallback((command: string) => {
    setExpandedPanel(null);
    sendToTerminal(command);
  }, [sendToTerminal]);

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
              onClick={loadMoreHistory}
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
