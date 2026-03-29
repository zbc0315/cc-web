import { useState, useRef, useCallback } from 'react';
import { SendHorizonal, StopCircle } from 'lucide-react';
import { STORAGE_KEYS, getStorage, setStorage, removeStorage } from '@/lib/storage';
import { cn } from '@/lib/utils';

interface TerminalDraftInputProps {
  projectId: string;
  onSend: (text: string) => void;
  readOnly?: boolean;
}

export function TerminalDraftInput({ projectId, onSend, readOnly }: TerminalDraftInputProps) {
  const storageKey = STORAGE_KEYS.terminalDraft(projectId);
  const [value, setValue] = useState(() => getStorage(storageKey, ''));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea height to content (max ~160px / ~6 lines)
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setValue(text);
    // Persist every keystroke
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
    // Send text and Enter as separate PTY writes — matches how xterm sends keystrokes one at a time
    const toType = value.replace(/\n/g, '\r');
    onSend(toType);
    onSend('\r');
    setValue('');
    removeStorage(storageKey);
    // Reset height to initial
    if (textareaRef.current) textareaRef.current.style.height = '84px';
  }, [value, readOnly, onSend, storageKey]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter sends; plain Enter inserts newline
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-white/10">
      {/* Toolbar row */}
      <div className="bg-background/80 backdrop-blur-sm px-2 py-0.5 flex items-center gap-1 border-b border-white/5">
        {/* Skills button — placeholder for Task 2 */}
        <span className="text-xs text-muted-foreground/40 select-none">toolbar</span>
      </div>
      {/* Input row (unchanged) */}
      <div className="bg-background/80 backdrop-blur-sm px-2 py-2 flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          readOnly={readOnly}
          rows={2}
          placeholder={readOnly ? '只读模式' : '输入内容… Shift+Enter 发送，Enter 换行'}
          className={cn(
            'flex-1 resize-none bg-transparent text-sm font-mono text-foreground',
            'placeholder:text-muted-foreground/50 outline-none',
            'min-h-[84px] max-h-[160px] overflow-y-auto leading-5 py-1',
            readOnly && 'opacity-50 cursor-not-allowed',
          )}
          style={{ height: '84px' }}
        />
        <button
          onClick={() => !readOnly && onSend('\x03')}
          disabled={readOnly}
          className={cn(
            'flex-shrink-0 p-1.5 rounded transition-colors mb-0.5',
            !readOnly
              ? 'text-red-400/70 hover:text-red-400 hover:bg-white/10'
              : 'text-muted-foreground/30 cursor-not-allowed',
          )}
          title="发送 Ctrl+C（中断）"
        >
          <StopCircle className="h-4 w-4" />
        </button>
        <button
          onClick={handleSend}
          disabled={!value.trim() || readOnly}
          className={cn(
            'flex-shrink-0 p-1.5 rounded transition-colors mb-0.5',
            value.trim() && !readOnly
              ? 'text-blue-400 hover:text-blue-300 hover:bg-white/10'
              : 'text-muted-foreground/30 cursor-not-allowed',
          )}
          title="发送 (Shift+Enter)"
        >
          <SendHorizonal className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
