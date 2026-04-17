import { forwardRef, useState, useEffect, useRef, useCallback, useMemo, useImperativeHandle, useLayoutEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Send, StopCircle, Mic, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { Project } from '@/types';
import { ChatMessage, ApprovalRequestEvent, ApprovalResolvedEvent } from '@/lib/websocket';
import {
  getConversations,
  getConversationDetail,
  startProject,
  getToolModel,
  getToolModels,
  getToolSkills,
  getPendingApprovals,
  type ClaudeSkillsData,
  type ClaudeSkillItem,
  type ToolModel,
} from '@/lib/api';
import { ApprovalCard, type ApprovalCardData } from '@/components/ApprovalCard';
import { formatChatContent } from '@/lib/chatUtils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { STORAGE_KEYS, getStorage, setStorage, removeStorage } from '@/lib/storage';
import { toast } from 'sonner';

// ── Types ──

type ChatState = 'stopped' | 'waking' | 'live' | 'error';
const HISTORY_PAGE = 20;

interface ChatMsg {
  id: string;
  role: string;
  content: string;
  ts: string;
}

interface ChatOverlayProps {
  projectId: string;
  project: Project;
  liveMessages: ChatMessage[];
  approvalEvents?: (ApprovalRequestEvent | ApprovalResolvedEvent)[];
  wsReadyTick: number;
  onSend: (data: string) => void;
  onClose: () => void;
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

export const ChatOverlay = forwardRef<ChatOverlayHandle, ChatOverlayProps>(function ChatOverlay({ projectId, project, liveMessages, approvalEvents, wsReadyTick, onSend, onClose }, ref) {
  const [state, setState] = useState<ChatState>(
    project.status === 'running' ? 'live' : 'stopped',
  );

  const prefersReducedMotion = useReducedMotion();

  // ── Approvals (Claude PermissionRequest) ──
  const [approvals, setApprovals] = useState<ApprovalCardData[]>([]);
  // Fetch any pending requests on mount AND on each WS (re)connect — WS reconnect
  // may have missed `approval_request` events that arrived while offline.
  useEffect(() => {
    let cancelled = false;
    if (project.cliTool !== 'claude') return;
    getPendingApprovals(projectId)
      .then((res) => { if (!cancelled) setApprovals(res.pending as ApprovalCardData[]); })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [projectId, project.cliTool, wsReadyTick]);
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

  // ── Messages ──
  const [displayMessages, setDisplayMessages] = useState<ChatMsg[]>([]);
  const recentSentRef = useRef<string[]>([]);
  const liveReceivedRef = useRef(false);
  const msgIdRef = useRef(0);
  const nextMsgId = useCallback(() => `m${++msgIdRef.current}`, []);

  // ── Send-retry: if CLI doesn't echo back within 3s, resend \r ──
  const sendRetryRef = useRef<{ timer: ReturnType<typeof setTimeout>; attempts: number } | null>(null);
  const clearSendRetry = useCallback(() => {
    if (sendRetryRef.current) {
      clearTimeout(sendRetryRef.current.timer);
      sendRetryRef.current = null;
    }
  }, []);

  // ── History pagination ──
  const allHistoryRef = useRef<ChatMsg[]>([]);
  const [historySlice, setHistorySlice] = useState<ChatMsg[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);

  const messages = useMemo(() => [...historySlice, ...displayMessages], [historySlice, displayMessages]);

  // ── Input ──
  const storageKey = STORAGE_KEYS.terminalDraft(projectId);
  const [input, setInput] = useState(() => getStorage(storageKey, ''));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const pendingQueueRef = useRef<string[]>([]);
  const wakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeIdRef = useRef(0);

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

  // ── Process live WS messages ──
  const prevLiveCountRef = useRef(0);
  useEffect(() => {
    // Reset on WS reconnect (parent clears chatMessages → length shrinks)
    if (liveMessages.length < prevLiveCountRef.current) {
      prevLiveCountRef.current = 0;
      recentSentRef.current = [];
    }
    if (liveMessages.length <= prevLiveCountRef.current) return;
    const newMsgs = liveMessages.slice(prevLiveCountRef.current);
    prevLiveCountRef.current = liveMessages.length;

    for (const msg of newMsgs) {
      liveReceivedRef.current = true;
      const content = formatChatContent(msg.blocks);
      if (!content.trim()) continue;
      // Any CLI response → clear retry timer
      clearSendRetry();
      if (msg.role === 'user') {
        const idx = recentSentRef.current.indexOf(content.trim());
        if (idx !== -1) {
          recentSentRef.current.splice(idx, 1);
          continue;
        }
      }
      setDisplayMessages((prev) => [...prev, { id: nextMsgId(), role: msg.role, content, ts: msg.timestamp }].slice(-50));
    }
  }, [liveMessages, clearSendRetry, nextMsgId]);

  // ── Load history from information API ──
  const displayCountRef = useRef(0);
  displayCountRef.current = displayMessages.length;

  const loadFromInformation = useCallback(async () => {
    try {
      const convs = await getConversations(projectId, 1);
      if (convs.length === 0) return;
      const detail = await getConversationDetail(projectId, convs[0].id, 'latest', 'user');
      const sections = detail.content.split(/(?=^## [UA]\d+)/m).filter(Boolean);
      const msgs: ChatMsg[] = [];
      for (const section of sections) {
        const match = section.match(/^## ([UA])(\d+).*\n/);
        if (!match) continue;
        const role = match[1] === 'U' ? 'user' : 'assistant';
        const body = section.slice(match[0].length).trim();
        if (body) msgs.push({ id: nextMsgId(), role, content: body, ts: '' });
      }
      if (displayCountRef.current === 0) {
        allHistoryRef.current = msgs;
        setHistorySlice(msgs.slice(-HISTORY_PAGE));
        setHasMoreHistory(msgs.length > HISTORY_PAGE);
      }
    } catch {
      toast.error('加载对话历史失败');
    }
  }, [projectId, nextMsgId]);

  const loadMoreHistory = useCallback(() => {
    const all = allHistoryRef.current;
    if (all.length === 0) return;
    const currentCount = historySlice.length;
    const newCount = Math.min(currentCount + HISTORY_PAGE, all.length);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    setHistorySlice(all.slice(-newCount));
    setHasMoreHistory(newCount < all.length);
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - prevHeight;
    });
  }, [historySlice.length]);

  // Load history on mount
  useEffect(() => {
    void loadFromInformation();
  }, [loadFromInformation]);

  // 3s fallback for live projects: if no WS messages arrive, load from API
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
      setDisplayMessages([]);
      setState('live');
    } else if (project.status === 'stopped' && state === 'live') {
      setState('stopped');
    }
  }, [project.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush pending queue when WS actually becomes ready
  useEffect(() => {
    if (wsReadyTick === 0) return; // skip initial mount
    if (pendingQueueRef.current.length === 0) return;
    const queue = [...pendingQueueRef.current];
    pendingQueueRef.current = [];
    for (const text of queue) {
      onSend(text.replace(/\n/g, '\r') + '\r');
    }
  }, [wsReadyTick, onSend]);

  // Auto-scroll only when near bottom (within 80px)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [displayMessages]);

  // Stick to bottom on initial history load. Content height can grow after
  // mount (markdown layout, async reflow inside Radix ScrollArea), so we
  // re-pin to the bottom across a short grace window until user scrolls away.
  const prevHistoryLenRef = useRef(0);
  const stickToBottomRef = useRef(false);
  useLayoutEffect(() => {
    if (prevHistoryLenRef.current === 0 && historySlice.length > 0) {
      stickToBottomRef.current = true;
      const pin = () => {
        if (!stickToBottomRef.current) return;
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      };
      pin();
      const rafs = [requestAnimationFrame(() => { pin(); requestAnimationFrame(pin); })];
      const timeouts = [100, 300, 800].map((ms) => setTimeout(pin, ms));
      const release = setTimeout(() => { stickToBottomRef.current = false; }, 1200);
      return () => {
        rafs.forEach(cancelAnimationFrame);
        timeouts.forEach(clearTimeout);
        clearTimeout(release);
      };
    }
    prevHistoryLenRef.current = historySlice.length;
  }, [historySlice]);
  // Release stick-to-bottom as soon as user scrolls manually
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = () => { stickToBottomRef.current = false; };
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchmove', onWheel, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchmove', onWheel);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    appendUserMessage: (text: string) => {
      const clean = text.replace(/\r$/, '');
      if (!clean) return;
      recentSentRef.current.push(clean);
      if (recentSentRef.current.length > 10) recentSentRef.current.shift();
      setDisplayMessages((prev) => [...prev, { id: nextMsgId(), role: 'user', content: clean, ts: new Date().toISOString() }].slice(-50));
    },
  }), [nextMsgId]);

  // Auto-focus on mount + Escape to close
  useEffect(() => {
    requestAnimationFrame(() => textareaRef.current?.focus());
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (wakingTimerRef.current) clearTimeout(wakingTimerRef.current);
      clearSendRetry();
    };
  }, [clearSendRetry]);

  // ── Send logic ──
  const sendToTerminal = useCallback((text: string) => {
    recentSentRef.current.push(text);
    if (recentSentRef.current.length > 10) recentSentRef.current.shift();
    setDisplayMessages((prev) => [...prev, { id: nextMsgId(), role: 'user', content: text, ts: new Date().toISOString() }].slice(-50));

    if (state === 'live') {
      // If queue is non-empty, WS may not be ready yet (just transitioned from waking)
      if (pendingQueueRef.current.length > 0) {
        pendingQueueRef.current.push(text);
      } else {
        onSend(text.replace(/\n/g, '\r') + '\r');
        // Start retry: if CLI doesn't echo back user message within 3s, resend \r
        clearSendRetry();
        const MAX_RETRY = 3;
        const startRetry = (attempt: number) => {
          if (attempt >= MAX_RETRY) return;
          const timer = setTimeout(() => {
            onSend('\r');
            startRetry(attempt + 1);
          }, 3000);
          sendRetryRef.current = { timer, attempts: attempt };
        };
        startRetry(0);
      }
    } else if (state === 'waking') {
      // WS may not be ready yet — queue for flush on wsReadyTick
      pendingQueueRef.current.push(text);
    } else if (state === 'stopped' || state === 'error') {
      pendingQueueRef.current.push(text);
      const thisWake = ++wakeIdRef.current;
      setState('waking');
      startProject(projectId)
        .then(() => {
          if (thisWake !== wakeIdRef.current) return;
          if (wakingTimerRef.current) clearTimeout(wakingTimerRef.current);
          setState('live');
        })
        .catch((err) => {
          if (thisWake !== wakeIdRef.current) return;
          toast.error(`启动失败: ${err instanceof Error ? err.message : String(err)}`);
          setState('error');
          pendingQueueRef.current = [];
        });
      wakingTimerRef.current = setTimeout(() => {
        if (thisWake !== wakeIdRef.current) return;
        if (pendingQueueRef.current.length > 0) {
          toast.error('启动超时（10s）');
          setState('error');
          pendingQueueRef.current = [];
        }
      }, 10000);
    }
  }, [state, projectId, onSend, nextMsgId, clearSendRetry]);

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

  const isRunning = state === 'live';
  const isWaking = state === 'waking';
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
      <ScrollArea className="flex-1 min-h-0" viewportRef={scrollRef}>
      <div
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
                    <div className="prose prose-sm dark:prose-invert max-w-none text-inherit [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_pre]:text-xs [&_pre]:my-1 [&_pre]:p-2 [&_pre]:rounded [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_hr]:my-2 [&_code]:text-xs [&_code]:px-1 [&_code]:rounded [&_table]:text-xs [&_a]:text-blue-400">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
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
