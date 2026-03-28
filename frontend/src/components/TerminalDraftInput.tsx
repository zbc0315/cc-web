import { useState, useRef, useCallback } from 'react';
import { SendHorizonal } from 'lucide-react';
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
    // Send to PTY: replace textarea newlines with \r for proper PTY handling, then \r to execute
    const toSend = value.replace(/\n/g, '\r') + '\r';
    onSend(toSend);
    setValue('');
    removeStorage(storageKey);
    // Reset height
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [value, readOnly, onSend, storageKey]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-white/10">
      <div className="bg-background/80 backdrop-blur-sm px-2 py-2 flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          readOnly={readOnly}
          rows={1}
          placeholder={readOnly ? '只读模式' : '输入内容… Enter 发送，Shift+Enter 换行'}
          className={cn(
            'flex-1 resize-none bg-transparent text-sm font-mono text-foreground',
            'placeholder:text-muted-foreground/50 outline-none',
            'min-h-[28px] max-h-[160px] overflow-y-auto leading-5 py-1',
            readOnly && 'opacity-50 cursor-not-allowed',
          )}
          style={{ height: 'auto' }}
        />
        <button
          onClick={handleSend}
          disabled={!value.trim() || readOnly}
          className={cn(
            'flex-shrink-0 p-1.5 rounded transition-colors mb-0.5',
            value.trim() && !readOnly
              ? 'text-blue-400 hover:text-blue-300 hover:bg-white/10'
              : 'text-muted-foreground/30 cursor-not-allowed',
          )}
          title="发送 (Enter)"
        >
          <SendHorizonal className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
