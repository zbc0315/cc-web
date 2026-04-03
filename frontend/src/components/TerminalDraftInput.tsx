import { useState, useRef, useCallback, useEffect } from 'react';
import { SendHorizonal, StopCircle, Sparkles, ChevronDown, Mic } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { getToolModel, getToolModels, getToolSkills, type ClaudeSkillsData, type ClaudeSkillItem, type ToolModel } from '@/lib/api';
import { STORAGE_KEYS, getStorage, setStorage, removeStorage } from '@/lib/storage';
import { cn } from '@/lib/utils';

// Web Speech API — not all browsers ship types
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

function displayModelName(model: string, models: ToolModel[]): string {
  const m = model.toLowerCase();
  for (const tm of models) {
    if (m.includes(tm.key)) return tm.label;
  }
  return model;
}

interface ClaudeSkillsPanelProps {
  data: ClaudeSkillsData;
  onCommand: (command: string) => void;
}

function ClaudeSkillsPanel({ data, onCommand }: ClaudeSkillsPanelProps) {
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
    <div className="flex flex-col max-h-[300px]">
      {tabs.length > 1 && (
        <div className="flex items-center gap-0.5 px-2 pt-1.5 pb-1 border-b border-border/50 flex-wrap">
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
      <div className="overflow-y-auto flex-1 py-1">
        {currentItems.map((item) => {
          const used = usedIds.has(item.command);
          return (
            <button
              key={item.command}
              onClick={() => handleClick(item)}
              className={cn(
                'w-full flex items-baseline gap-3 px-3 py-1.5 text-left transition-colors group',
                used
                  ? 'bg-muted/30 hover:bg-muted/50'
                  : 'bg-blue-500/10 hover:bg-blue-500/20',
              )}
            >
              <span
                className={cn(
                  'font-mono text-xs shrink-0 min-w-[80px]',
                  used
                    ? 'text-muted-foreground/60 group-hover:text-muted-foreground'
                    : 'text-blue-400/80 group-hover:text-blue-400',
                )}
              >
                {item.command}
              </span>
              <span
                className={cn(
                  'text-xs truncate',
                  used
                    ? 'text-muted-foreground/50 group-hover:text-muted-foreground/70'
                    : 'text-muted-foreground/70 group-hover:text-muted-foreground',
                )}
              >
                {item.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface ModelPanelProps {
  currentModel: string;
  models: ToolModel[];
  onSelect: (model: string) => void;
}

function ModelPanel({ currentModel, models, onSelect }: ModelPanelProps) {
  const normalized = currentModel.toLowerCase();
  return (
    <div className="py-1 min-w-[120px]">
      {models.map(({ key, label }) => {
        const active = normalized.includes(key);
        return (
          <button
            key={key}
            onClick={() => onSelect(key)}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
              active
                ? 'bg-blue-500/20 text-blue-400'
                : 'text-muted-foreground/70 hover:text-foreground hover:bg-muted/50',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full shrink-0',
                active ? 'bg-blue-400' : 'border border-muted-foreground/30',
              )}
            />
            {label}
          </button>
        );
      })}
    </div>
  );
}

export interface FloatPosition { x: number; y: number }

interface TerminalDraftInputProps {
  projectId: string;
  cliTool?: string;
  onSend: (text: string) => void;
  readOnly?: boolean;
  displayMode: 'bottom' | 'float';
  floatPosition?: FloatPosition;
  onFloatPositionChange?: (pos: FloatPosition) => void;
}

export function TerminalDraftInput({ projectId, cliTool = 'claude', onSend, readOnly, displayMode, floatPosition, onFloatPositionChange }: TerminalDraftInputProps) {
  const isFloat = displayMode === 'float';
  const maxHeight = isFloat ? 300 : 160;
  const initialHeight = isFloat ? 120 : 84;

  const storageKey = STORAGE_KEYS.terminalDraft(projectId);
  const [value, setValue] = useState(() => getStorage(storageKey, ''));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 'skills' | 'model' | null — only one panel open at a time
  const [activePanel, setActivePanel] = useState<'skills' | 'model' | null>(null);

  const [skillsData, setSkillsData] = useState<ClaudeSkillsData | null>(null);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const skillsLoadingRef = useRef(false);

  const modelStorageKey = STORAGE_KEYS.projectModel(projectId);
  const [currentModel, setCurrentModel] = useState(() => getStorage(modelStorageKey, ''));
  const [availableModels, setAvailableModels] = useState<ToolModel[]>([]);
  const [modelLoaded, setModelLoaded] = useState(false);

  // Fetch available models + current model from adapter (once per cliTool change)
  const modelFetchedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    modelFetchedRef.current = false;
    const savedModel = getStorage(modelStorageKey, '');
    Promise.all([
      getToolModels(cliTool),
      savedModel ? Promise.resolve(null) : getToolModel(cliTool),
    ])
      .then(([models, modelResult]) => {
        if (cancelled) return;
        modelFetchedRef.current = true;
        setAvailableModels(models);
        if (modelResult && modelResult.model) {
          setCurrentModel(modelResult.model);
          setStorage(modelStorageKey, modelResult.model);
        } else if (!savedModel && models.length > 0) {
          setCurrentModel(models[0].key);
          setStorage(modelStorageKey, models[0].key);
        }
      })
      .catch(() => { /* graceful degradation — no models available */ })
      .finally(() => { if (!cancelled) setModelLoaded(true); });
    return () => { cancelled = true; };
  }, [cliTool, modelStorageKey]);

  // Auto-focus on mount (fires on every mode transition because TerminalView uses key={draftMode})
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

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

  // Auto-resize textarea height to content
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
  }, [maxHeight]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setValue(text);
    if (text) {
      setStorage(storageKey, text);
    } else {
      removeStorage(storageKey);
    }
    adjustHeight();
  };

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || readOnly) return;
    const toType = trimmed.replace(/\n/g, '\r');
    onSend(toType);
    onSend('\r');
    setValue('');
    removeStorage(storageKey);
    if (textareaRef.current) textareaRef.current.style.height = initialHeight + 'px';
  }, [value, readOnly, onSend, storageKey, initialHeight]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    handleVoiceKeyDown(e);
  };

  const handleCommand = useCallback(
    (command: string) => {
      if (readOnly) return;
      onSend(command.replace(/\n/g, '\r'));
      onSend('\r');
      setActivePanel(null);
    },
    [readOnly, onSend],
  );

  const handleToggleSkills = useCallback(async () => {
    if (activePanel === 'skills') {
      setActivePanel(null);
      return;
    }
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
    if (readOnly) return;
    setActivePanel((prev) => (prev === 'model' ? null : 'model'));
  }, [readOnly]);

  const handleModelSelect = useCallback(
    (model: string) => {
      setCurrentModel(model);
      setStorage(modelStorageKey, model);
      onSend(`/model ${model}`);
      onSend('\r');
      setActivePanel(null);
    },
    [modelStorageKey, onSend],
  );

  // ── Drag logic (float mode only) ─────────────────────────────────────────
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (!isFloat || !floatPosition) return;
    // Only start drag from the toolbar area (not textarea/buttons)
    const target = e.target as HTMLElement;
    if (target.closest('textarea') || target.closest('button')) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: floatPosition.x, originY: floatPosition.y };

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      const nx = Math.max(0, Math.min(window.innerWidth - 200, dragRef.current.originX + dx));
      const ny = Math.max(0, Math.min(window.innerHeight - 80, dragRef.current.originY + dy));
      if (containerRef.current) {
        containerRef.current.style.left = nx + 'px';
        containerRef.current.style.top = ny + 'px';
      }
    };

    const handleUp = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      const nx = Math.max(0, Math.min(window.innerWidth - 200, dragRef.current.originX + dx));
      const ny = Math.max(0, Math.min(window.innerHeight - 80, dragRef.current.originY + dy));
      dragRef.current = null;
      onFloatPositionChange?.({ x: nx, y: ny });
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [isFloat, floatPosition, onFloatPositionChange]);

  // ── Voice-to-text (Web Speech API) ──────────────────────────────────────
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionCompat | null>(null);
  const spaceTriggeredRef = useRef(false); // whether space long-press started recognition

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
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
        setValue((prev) => {
          const next = prev + transcript;
          setStorage(storageKey, next);
          return next;
        });
        setTimeout(adjustHeight, 0);
      }
    };
    recognition.onerror = () => {
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
  }, [isListening, storageKey, adjustHeight]);

  const toggleListening = useCallback(() => {
    if (isListening) stopListening();
    else startListening();
  }, [isListening, startListening, stopListening]);

  // Long-press space: keydown starts 300ms timer, keyup before 300ms cancels
  const spaceLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (spaceLongPressTimer.current) clearTimeout(spaceLongPressTimer.current);
    };
  }, []);

  const handleVoiceKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.code === 'Space' && !e.repeat && !isListening && SpeechRecognitionCtor) {
      spaceTriggeredRef.current = false;
      spaceLongPressTimer.current = setTimeout(() => {
        spaceTriggeredRef.current = true;
        // Remove the space character typed during the hold
        setValue((prev) => {
          const trimmed = prev.endsWith(' ') ? prev.slice(0, -1) : prev;
          if (trimmed !== prev) setStorage(storageKey, trimmed);
          return trimmed;
        });
        startListening();
      }, 300);
    }
  }, [isListening, startListening, storageKey]);

  const handleVoiceKeyUp = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  const rootClassName = isFloat
    ? 'fixed z-50 w-[50vw] rounded-2xl border border-border shadow-2xl overflow-hidden'
    : 'absolute bottom-0 left-0 right-0 z-10 border-t border-border';

  const rootStyle = isFloat && floatPosition
    ? { left: floatPosition.x, top: floatPosition.y }
    : undefined;

  return (
    <motion.div
      ref={containerRef}
      className={rootClassName}
      style={rootStyle}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      onMouseDown={isFloat ? handleDragStart : undefined}
    >
      {/* Floating panel — skills or model — slides up above toolbar */}
      <AnimatePresence>
        {activePanel && (
          <motion.div
            key={activePanel}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="bg-background/95 backdrop-blur-sm border-b border-white/10"
          >
            {activePanel === 'skills' && skillsData && (
              <ClaudeSkillsPanel data={skillsData} onCommand={handleCommand} />
            )}
            {activePanel === 'model' && (
              <ModelPanel currentModel={currentModel} models={availableModels} onSelect={handleModelSelect} />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toolbar row — drag handle in float mode */}
      <div className={cn(
        'bg-background/80 backdrop-blur-sm px-2 py-0.5 flex items-center gap-1 border-b border-border/50',
        isFloat && 'cursor-grab active:cursor-grabbing',
      )}>
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
            title={`当前模型: ${currentModel}`}
          >
            {displayModelName(currentModel, availableModels)}
            <ChevronDown className={cn('h-3 w-3 transition-transform', activePanel === 'model' && 'rotate-180')} />
          </button>
        )}
      </div>

      {/* Input row */}
      <div className="bg-background/80 backdrop-blur-sm px-2 py-2 flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onKeyUp={handleVoiceKeyUp}
          readOnly={readOnly}
          rows={2}
          placeholder={readOnly ? '只读模式' : '输入内容… Shift+Enter 发送，Enter 换行'}
          className={cn(
            'flex-1 resize-none bg-transparent font-mono text-foreground',
            'placeholder:text-muted-foreground/50 outline-none',
            'overflow-y-auto leading-6 py-1',
            isFloat
              ? 'text-lg min-h-[120px] max-h-[300px]'
              : 'text-base min-h-[84px] max-h-[160px]',
            readOnly && 'opacity-50 cursor-not-allowed',
          )}
          style={{ height: initialHeight + 'px' }}
        />
        <button
          onClick={() => !readOnly && onSend('\x03')}
          disabled={readOnly}
          className={cn(
            'flex-shrink-0 p-1.5 rounded transition-colors mb-0.5',
            !readOnly
              ? 'text-red-400/70 hover:text-red-400 hover:bg-muted'
              : 'text-muted-foreground/30 cursor-not-allowed',
          )}
          title="发送 Ctrl+C（中断）"
        >
          <StopCircle className="h-4 w-4" />
        </button>
        {SpeechRecognitionCtor && (
          <button
            onClick={toggleListening}
            disabled={readOnly}
            className={cn(
              'flex-shrink-0 p-1.5 rounded transition-colors mb-0.5',
              readOnly
                ? 'text-muted-foreground/30 cursor-not-allowed'
                : isListening
                  ? 'text-red-400 bg-red-500/20 animate-pulse'
                  : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted',
            )}
            title={isListening ? '停止录音' : '语音输入（也可长按空格键）'}
          >
            <Mic className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={handleSend}
          disabled={!value.trim() || readOnly}
          className={cn(
            'flex-shrink-0 p-1.5 rounded transition-colors mb-0.5',
            value.trim() && !readOnly
              ? 'text-blue-400 hover:text-blue-300 hover:bg-muted'
              : 'text-muted-foreground/30 cursor-not-allowed',
          )}
          title="发送 (Shift+Enter)"
        >
          <SendHorizonal className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  );
}
