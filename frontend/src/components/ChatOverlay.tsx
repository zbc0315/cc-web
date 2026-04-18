import { forwardRef, useState, useEffect, useRef, useCallback, useImperativeHandle } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Send, StopCircle, Mic, Sparkles, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Project } from '@/types';
import { ChatMessage, ApprovalRequestEvent, ApprovalResolvedEvent, SemanticUpdate } from '@/lib/websocket';
import {
  getToolModel,
  getToolModels,
  getToolSkills,
  getPendingApprovals,
  type ClaudeSkillsData,
  type ClaudeSkillItem,
  type ToolModel,
} from '@/lib/api';
import { useChatSession } from '@/hooks/useChatSession';
import { useChatPinnedScroll } from '@/hooks/useChatPinnedScroll';
import { ApprovalCard, type ApprovalCardData } from '@/components/ApprovalCard';
import { AssistantMessageContent } from '@/components/AssistantMessageContent';
import { ScrollArea } from '@/components/ui/scroll-area';
import { STORAGE_KEYS, getStorage, setStorage, removeStorage } from '@/lib/storage';
import { toast } from 'sonner';

// ── Types ──

const HISTORY_PAGE = 20;

interface ChatOverlayProps {
  projectId: string;
  project: Project;
  liveMessages: ChatMessage[];
  approvalEvents?: (ApprovalRequestEvent | ApprovalResolvedEvent)[];
  semanticUpdate?: SemanticUpdate | null;
  wsConnected: boolean;
  onSend: (data: string) => void;
  onClose: () => void;
}

interface ActiveBubble {
  id: string;
  phase: 'thinking' | 'tool_use' | 'tool_result' | 'text';
  detail?: string;
}

function activityLabel(b: ActiveBubble): string {
  if (b.phase === 'thinking') return '思考中…';
  if (b.phase === 'tool_result') return '处理结果…';
  if (b.phase === 'tool_use') {
    const t = (b.detail || '').toLowerCase();
    if (t === 'bash') return '执行命令…';
    if (t === 'read') return '读取文件…';
    if (t === 'edit' || t === 'multiedit') return '编辑文件…';
    if (t === 'write') return '写入文件…';
    if (t === 'grep') return '搜索内容…';
    if (t === 'glob') return '匹配文件…';
    if (t === 'webfetch' || t === 'websearch') return '访问网络…';
    if (t === 'task') return '调度子任务…';
    if (t === 'todowrite') return '更新任务列表…';
    if (t === 'notebookedit') return '编辑 Notebook…';
    if (b.detail) return `调用 ${b.detail}…`;
    return '调用工具…';
  }
  return '工作中…';
}

export interface ChatOverlayHandle {
  appendUserMessage: (text: string) => void;
}

// ── Web Speech API types ──

interface SpeechRecognitionResult { readonly [index: number]: SpeechRecognitionAlternative; readonly length: number }
interface SpeechRecognitionAlternative { readonly transcript: string; readonly confidence: number }
interface SpeechRecognitionResultList { readonly [index: number]: SpeechRecognitionResult; readonly length: number }
interface SpeechRecognitionEventCompat extends Event { readonly results: SpeechRecognitionResultList }
interface SpeechRecognitionCompat extends EventTarget {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((ev: SpeechRecognitionEventCompat) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void;
}
const SpeechRecognitionCtor: (new () => SpeechRecognitionCompat) | undefined =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : undefined;

// ── Sub-components (from TerminalDraftInput) ──

function displayModelName(model: string, models: ToolModel[]): string {
  const m = model.toLowerCase();
  for (const tm of models) {
    if (m.includes(tm.key)) return tm.label;
  }
  return model;
}

function ClaudeSkillsPanel({ data, onCommand }: { data: ClaudeSkillsData; onCommand: (cmd: string) => void }) {
  const tabs = [
    { key: 'builtin', label: '内置命令', items: data.builtin },
    ...(data.custom.length > 0 ? [{ key: 'custom', label: '自定义', items: data.custom }] : []),
    ...(data.mcp.length > 0 ? [{ key: 'mcp', label: 'MCP', items: data.mcp }] : []),
  ];
  const [activeTab, setActiveTab] = useState(tabs[0].key);
  const [usedIds, setUsedIds] = useState<Set<string>>(
    () => new Set(getStorage<string[]>(STORAGE_KEYS.usedSkills, [], true)),
  );

  const currentItems = tabs.find((t) => t.key === activeTab)?.items ?? [];

  const handleClick = (item: ClaudeSkillItem) => {
    onCommand(item.command);
    if (!usedIds.has(item.command)) {
      const next = new Set(usedIds);
      next.add(item.command);
      setUsedIds(next);
      setStorage(STORAGE_KEYS.usedSkills, [...next], true);
    }
  };

  return (
    <div className="flex flex-col max-h-[200px]">
      {tabs.length > 1 && (
        <div className="flex items-center gap-0.5 px-2 pt-1 pb-0.5 border-b border-border/50 flex-wrap">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'px-2 py-0.5 rounded text-xs transition-colors whitespace-nowrap',
                activeTab === tab.key
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted/50',
              )}
            >
              {tab.label} <span className="text-muted-foreground/40">{tab.items.length}</span>
            </button>
          ))}
        </div>
      )}
      <div className="overflow-y-auto flex-1 py-0.5">
        {currentItems.map((item) => {
          const used = usedIds.has(item.command);
          return (
            <button
              key={item.command}
              onClick={() => handleClick(item)}
              className={cn(
                'w-full flex items-baseline gap-3 px-3 py-1 text-left transition-colors group',
                used ? 'bg-muted/30 hover:bg-muted/50' : 'bg-blue-500/10 hover:bg-blue-500/20',
              )}
            >
              <span className={cn('font-mono text-xs shrink-0 min-w-[80px]', used ? 'text-muted-foreground/60' : 'text-blue-400/80')}>
                {item.command}
              </span>
              <span className={cn('text-xs truncate', used ? 'text-muted-foreground/50' : 'text-muted-foreground/70')}>
                {item.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModelPanel({ currentModel, models, onSelect }: { currentModel: string; models: ToolModel[]; onSelect: (m: string) => void }) {
  const normalized = currentModel.toLowerCase();
  return (
    <div className="py-0.5 min-w-[120px]">
      {models.map(({ key, label }) => {
        const active = normalized.includes(key);
        return (
          <button
            key={key}
            onClick={() => onSelect(key)}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-1 text-left text-sm transition-colors',
              active ? 'bg-blue-500/20 text-blue-400' : 'text-muted-foreground/70 hover:text-foreground hover:bg-muted/50',
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', active ? 'bg-blue-400' : 'border border-muted-foreground/30')} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── Main component ──

export const ChatOverlay = forwardRef<ChatOverlayHandle, ChatOverlayProps>(function ChatOverlay({ projectId, project, liveMessages, approvalEvents, semanticUpdate, wsConnected, onSend, onClose }, ref) {
  const prefersReducedMotion = useReducedMotion();

  // ── Approvals (Claude PermissionRequest) ──
  const [approvals, setApprovals] = useState<ApprovalCardData[]>([]);
  // Fetch any pending requests on mount AND on each WS (re)connect — WS reconnect
  // may have missed `approval_request` events that arrived while offline.
  useEffect(() => {
    if (!wsConnected) return;
    let cancelled = false;
    if (project.cliTool !== 'claude') return;
    getPendingApprovals(projectId)
      .then((res) => { if (!cancelled) setApprovals(res.pending as ApprovalCardData[]); })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [projectId, project.cliTool, wsConnected]);
  // Consume parent-delivered WS events
  const prevApprovalCountRef = useRef(0);
  useEffect(() => {
    const events = approvalEvents ?? [];
    if (events.length <= prevApprovalCountRef.current) {
      if (events.length < prevApprovalCountRef.current) prevApprovalCountRef.current = 0;
      else return;
    }
    for (let i = prevApprovalCountRef.current; i < events.length; i++) {
      const evt = events[i];
      if (evt.type === 'approval_request') {
        setApprovals((prev) => prev.some((a) => a.toolUseId === evt.toolUseId) ? prev : [...prev, {
          projectId: evt.projectId, toolUseId: evt.toolUseId, toolName: evt.toolName,
          toolInput: evt.toolInput, sessionId: evt.sessionId, createdAt: evt.createdAt,
        }]);
      } else if (evt.type === 'approval_resolved') {
        setApprovals((prev) => prev.filter((a) => a.toolUseId !== evt.toolUseId));
      }
    }
    prevApprovalCountRef.current = events.length;
  }, [approvalEvents]);
  const removeApproval = useCallback((toolUseId: string) => {
    setApprovals((prev) => prev.filter((a) => a.toolUseId !== toolUseId));
  }, []);

  // ── Activity bubble driven by semantic_update ──
  // Appears while the LLM is actively working (non-text phase), disappears as
  // soon as it begins streaming text or goes idle. Each new activation gets a
  // fresh id so the bubble re-animates in.
  const [activeBubble, setActiveBubble] = useState<ActiveBubble | null>(null);
  const bubbleSeqRef = useRef(0);
  useEffect(() => {
    const u = semanticUpdate;
    if (!u || !u.active || !u.semantic) { setActiveBubble(null); return; }
    const { phase, detail } = u.semantic;
    if (phase === 'text') { setActiveBubble(null); return; }
    setActiveBubble((prev) => {
      if (prev) return (prev.phase === phase && prev.detail === detail) ? prev : { ...prev, phase, detail };
      return { id: `ab${++bubbleSeqRef.current}`, phase, detail };
    });
  }, [semanticUpdate]);

  // ── Shared chat session state (state machine + send + history + retry) ──
  const {
    state, messages, hasMoreHistory,
    loadMoreHistory: loadMoreHistoryRaw,
    sendMessage, appendUserMessage: appendUserMessageFromHook,
    isWaking, isRunning,
  } = useChatSession({
    project,
    liveMessages,
    ws: { send: onSend, connected: wsConnected },
    historyLimit: HISTORY_PAGE,
  });

  const latestAssistantId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id;
    }
    return null;
  })();

  // ── Input ──
  const storageKey = STORAGE_KEYS.terminalDraft(projectId);
  const [input, setInput] = useState(() => getStorage(storageKey, ''));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Skills / Model panels ──
  const [activePanel, setActivePanel] = useState<'skills' | 'model' | null>(null);
  const [skillsData, setSkillsData] = useState<ClaudeSkillsData | null>(null);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const skillsLoadingRef = useRef(false);

  const modelStorageKey = STORAGE_KEYS.projectModel(projectId);
  const [currentModel, setCurrentModel] = useState(() => getStorage(modelStorageKey, ''));
  const [availableModels, setAvailableModels] = useState<ToolModel[]>([]);
  const [modelLoaded, setModelLoaded] = useState(false);

  const cliTool = project.cliTool ?? 'claude';

  // Fetch models (skip for terminal-only projects)
  useEffect(() => {
    if (cliTool === 'terminal') { setModelLoaded(true); return; }
    let cancelled = false;
    const savedModel = getStorage(modelStorageKey, '');
    Promise.all([
      getToolModels(cliTool),
      savedModel ? Promise.resolve(null) : getToolModel(cliTool),
    ])
      .then(([models, modelResult]) => {
        if (cancelled) return;
        setAvailableModels(models);
        if (modelResult?.model) {
          setCurrentModel(modelResult.model);
          setStorage(modelStorageKey, modelResult.model);
        } else if (!savedModel && models.length > 0) {
          setCurrentModel(models[0].key);
          setStorage(modelStorageKey, models[0].key);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setModelLoaded(true); });
    return () => { cancelled = true; };
  }, [cliTool, modelStorageKey]);

  // Close panel on outside click
  useEffect(() => {
    if (!activePanel) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setActivePanel(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [activePanel]);

  // Wrap loadMore to preserve scroll position when older messages prepend to the top
  const loadMoreHistory = useCallback(async () => {
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    await loadMoreHistoryRaw();
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - prevHeight;
    });
  }, [loadMoreHistoryRaw]);

  // ── Auto-scroll via shared hook: pin to bottom unless user has scrolled up ──
  const contentRef = useRef<HTMLDivElement>(null);
  const { pinnedRef } = useChatPinnedScroll(scrollRef, contentRef, [messages, activeBubble, approvals]);

  useImperativeHandle(ref, () => ({
    appendUserMessage: (text: string) => {
      pinnedRef.current = true;
      appendUserMessageFromHook(text);
    },
  }), [appendUserMessageFromHook]);

  // Auto-focus on mount + Escape to close
  useEffect(() => {
    requestAnimationFrame(() => textareaRef.current?.focus());
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  // ── Send: delegate to the shared useChatSession hook ──
  const sendToTerminal = useCallback((text: string) => {
    pinnedRef.current = true;
    sendMessage(text);
  }, [sendMessage]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    removeStorage(storageKey);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setActivePanel(null);
    sendToTerminal(text);
  }, [input, storageKey, sendToTerminal]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setInput(text);
    if (text) setStorage(storageKey, text);
    else removeStorage(storageKey);
    // Auto-resize
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [storageKey]);

  const handleCommand = useCallback((command: string) => {
    if (project._sharedPermission === 'view') return;
    setActivePanel(null);
    sendToTerminal(command);
  }, [project._sharedPermission, sendToTerminal]);

  const handleToggleSkills = useCallback(async () => {
    if (activePanel === 'skills') { setActivePanel(null); return; }
    if (!skillsLoaded && !skillsLoadingRef.current) {
      skillsLoadingRef.current = true;
      try {
        const data = await getToolSkills(cliTool);
        setSkillsData(data);
        setSkillsLoaded(true);
      } catch {
        setSkillsData({ builtin: [], custom: [], mcp: [] });
        setSkillsLoaded(true);
      } finally {
        skillsLoadingRef.current = false;
      }
    }
    setActivePanel('skills');
  }, [activePanel, skillsLoaded, cliTool]);

  const handleToggleModel = useCallback(() => {
    setActivePanel((prev) => (prev === 'model' ? null : 'model'));
  }, []);

  const handleModelSelect = useCallback((model: string) => {
    setCurrentModel(model);
    setStorage(modelStorageKey, model);
    setActivePanel(null);
    sendToTerminal(`/model ${model}`);
  }, [modelStorageKey, sendToTerminal]);

  // ── Voice input ──
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionCompat | null>(null);
  const spaceTriggeredRef = useRef(false);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
    spaceTriggeredRef.current = false;
  }, []);

  const startListening = useCallback(() => {
    if (!SpeechRecognitionCtor || isListening) return;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event: SpeechRecognitionEventCompat) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        setInput((prev) => {
          const next = prev + transcript;
          setStorage(storageKey, next);
          return next;
        });
        // Adjust textarea height after transcript appended
        setTimeout(() => {
          const el = textareaRef.current;
          if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }
        }, 0);
      }
    };
    recognition.onerror = (ev: any) => {
      const error = ev.error || 'unknown';
      const msgs: Record<string, string> = {
        'not-allowed': '麦克风权限被拒绝',
        'network': '语音识别需要联网',
        'no-speech': '未检测到语音',
        'audio-capture': '未找到麦克风',
        'aborted': '语音识别被中断',
      };
      toast.error(msgs[error] || `语音识别失败: ${error}`);
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening, storageKey]);

  const spaceLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (spaceLongPressTimer.current) clearTimeout(spaceLongPressTimer.current);
    };
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    // Space long-press for voice
    if (e.code === 'Space' && !e.repeat && !isListening && SpeechRecognitionCtor) {
      spaceTriggeredRef.current = false;
      spaceLongPressTimer.current = setTimeout(() => {
        spaceTriggeredRef.current = true;
        setInput((prev) => {
          const trimmed = prev.endsWith(' ') ? prev.slice(0, -1) : prev;
          if (trimmed !== prev) setStorage(storageKey, trimmed);
          return trimmed;
        });
        startListening();
      }, 300);
    }
  }, [handleSend, isListening, startListening, storageKey]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.code === 'Space') {
      if (spaceLongPressTimer.current) {
        clearTimeout(spaceLongPressTimer.current);
        spaceLongPressTimer.current = null;
      }
      if (spaceTriggeredRef.current) {
        e.preventDefault();
        stopListening();
      }
    }
  }, [stopListening]);

  const readOnly = project._sharedPermission === 'view';

  return (
    <motion.div
      ref={containerRef}
      /* bottom-7 matches TerminalView's h-7 status bar so usage+context footer stays visible */
      className="absolute left-0 right-0 top-0 bottom-7 z-40 flex flex-col overflow-hidden pointer-events-auto bg-background/55 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      {/* Messages */}
      <ScrollArea
        className="flex-1 min-h-0"
        viewportRef={scrollRef}
        viewportClassName="[&>div]:!block [&>div]:!w-full"
      >
      <div
        ref={contentRef}
        onMouseDown={(e) => { if (e.target === e.currentTarget) setActivePanel(null); }}
        className="px-4 py-3 space-y-2 min-h-full"
      >
        {hasMoreHistory && (
          <div className="flex justify-center pb-1">
            <button
              onClick={loadMoreHistory}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs text-muted-foreground bg-black/5 dark:bg-white/10 backdrop-blur-md border border-black/10 dark:border-white/15 shadow-sm hover:bg-black/10 dark:hover:bg-white/20 transition-colors"
            >
              <ChevronUp className="h-3 w-3" />
              加载更早消息
            </button>
          </div>
        )}
        <AnimatePresence initial={false}>
          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <motion.div
                key={msg.id}
                className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
                initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.3, y: 40 }}
                animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                transition={prefersReducedMotion ? { duration: 0.2 } : { type: 'spring', bounce: 0.45, duration: 0.55 }}
                style={{ transformOrigin: isUser ? 'bottom right' : 'bottom left' }}
              >
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3.5 py-2 break-words text-sm leading-relaxed backdrop-blur-md',
                    isUser
                      ? 'bg-blue-500/15 text-foreground border border-blue-500/25 rounded-br-md whitespace-pre-wrap'
                      : 'bg-black/5 dark:bg-white/10 text-secondary-foreground border border-black/10 dark:border-white/15 rounded-bl-md',
                  )}
                  style={{ boxShadow: isUser
                    ? '0 4px 12px rgba(59,130,246,0.15), inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -1px 0 rgba(0,0,0,0.05)'
                    : '0 4px 12px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.06)'
                  }}
                >
                  {isUser ? msg.content : (
                    <AssistantMessageContent
                      content={msg.content}
                      isLatest={msg.id === latestAssistantId}
                    />
                  )}
                </div>
              </motion.div>
            );
          })}
          {activeBubble && approvals.length === 0 && (
            <motion.div
              key={activeBubble.id}
              className="flex justify-start"
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 20 }}
              animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8, y: -6 }}
              transition={prefersReducedMotion ? { duration: 0.2 } : { type: 'spring', bounce: 0.4, duration: 0.45 }}
              style={{ transformOrigin: 'bottom left' }}
            >
              <div
                className="rounded-2xl rounded-bl-md px-3 py-1.5 bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/15 backdrop-blur-md flex items-center gap-2 text-xs text-muted-foreground"
                style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.06)' }}
              >
                <Loader2 className="h-3 w-3 animate-spin text-blue-400/80" />
                <span>{activityLabel(activeBubble)}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {messages.length === 0 && state === 'stopped' && (
          <div className="flex items-center justify-center h-full text-muted-foreground/40 text-sm">
            暂无对话记录
          </div>
        )}

        {isWaking && (
          <div className="flex items-center justify-center py-3 text-yellow-400 text-sm animate-pulse">
            启动中...
          </div>
        )}

        {approvals.map((a) => (
          <ApprovalCard key={a.toolUseId} approval={a} onResolved={removeApproval} />
        ))}
      </div>
      </ScrollArea>

      {/* Floating panels — skills / model (above toolbar) */}
      {activePanel === 'skills' && skillsData && (
        <div className="shrink-0 border-t border-blue-500/25 bg-blue-500/10 backdrop-blur-md">
          <ClaudeSkillsPanel data={skillsData} onCommand={handleCommand} />
        </div>
      )}
      {activePanel === 'model' && (
        <div className="shrink-0 border-t border-blue-500/25 bg-blue-500/10 backdrop-blur-md">
          <ModelPanel currentModel={currentModel} models={availableModels} onSelect={handleModelSelect} />
        </div>
      )}

      {/* Toolbar + Input area — full-width bottom band */}
      <div className="shrink-0 border-t border-blue-500/25 bg-blue-500/10 backdrop-blur-md">
        <div className="flex items-center gap-1 px-3 py-0.5">
          {!(skillsLoaded && skillsData && skillsData.builtin.length === 0 && skillsData.custom.length === 0 && skillsData.mcp.length === 0) && (
            <button
              onClick={() => void handleToggleSkills()}
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors',
                activePanel === 'skills'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted/50',
              )}
            >
              <Sparkles className="h-3 w-3" />
              Skills
            </button>
          )}
          {modelLoaded && currentModel && availableModels.length > 0 && (
            <button
              onClick={handleToggleModel}
              disabled={readOnly}
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors',
                activePanel === 'model'
                  ? 'bg-blue-500/20 text-blue-400'
                  : readOnly
                    ? 'text-muted-foreground/30 cursor-not-allowed'
                    : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted/50',
              )}
            >
              {displayModelName(currentModel, availableModels)}
              <ChevronDown className={cn('h-3 w-3 transition-transform', activePanel === 'model' && 'rotate-180')} />
            </button>
          )}
          <div className="flex-1" />
        </div>

        {/* Input area */}
        <div className="border-t border-blue-500/15 px-3 py-1.5">
        <div className="flex items-end gap-1.5">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            readOnly={readOnly}
            disabled={isWaking}
            rows={3}
            placeholder={
              readOnly ? '只读模式'
              : isWaking ? '启动中...'
              : state === 'stopped' ? '输入消息（自动启动）… Shift+Enter 发送'
              : '输入消息… Shift+Enter 发送'
            }
            className={cn(
              'flex-1 resize-none bg-transparent font-mono text-lg text-foreground select-text',
              'placeholder:text-muted-foreground/50 outline-none',
              'overflow-y-auto leading-7 py-1 min-h-[5.25rem] max-h-[200px]',
              (readOnly || isWaking) && 'opacity-50 cursor-not-allowed',
            )}
          />
          <button
            onClick={() => !readOnly && isRunning && onSend('\x03')}
            disabled={readOnly || !isRunning}
            className={cn(
              'shrink-0 p-1 rounded transition-colors',
              !readOnly && isRunning ? 'text-red-400/70 hover:text-red-400 hover:bg-muted' : 'text-muted-foreground/30 cursor-not-allowed',
            )}
            title="Ctrl+C"
          >
            <StopCircle className="h-3.5 w-3.5" />
          </button>
          {SpeechRecognitionCtor && (
            <button
              onClick={() => isListening ? stopListening() : startListening()}
              disabled={readOnly}
              className={cn(
                'shrink-0 p-1 rounded transition-colors',
                readOnly ? 'text-muted-foreground/30 cursor-not-allowed'
                  : isListening ? 'text-red-400 bg-red-500/20 animate-pulse'
                  : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted',
              )}
              title={isListening ? '停止录音' : '语音输入'}
            >
              <Mic className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={handleSend}
            disabled={!input.trim() || readOnly || isWaking}
            className={cn(
              'shrink-0 p-1 rounded transition-colors',
              input.trim() && !readOnly && !isWaking
                ? 'text-blue-400 hover:text-blue-300 hover:bg-muted'
                : 'text-muted-foreground/30 cursor-not-allowed',
            )}
            title="发送 (Shift+Enter)"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
        </div>
      </div>
    </motion.div>
  );
});
