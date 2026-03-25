import { useState, useRef, KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Send, Square } from 'lucide-react';

interface ChatInputBarProps {
  onSend: (text: string) => void;
  onInterrupt: () => void;
  isGenerating: boolean;
  disabled?: boolean;
}

export function ChatInputBar({ onSend, onInterrupt, isGenerating, disabled }: ChatInputBarProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled || isGenerating) return;
    onSend(trimmed);
    setText('');
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t bg-background p-3 flex gap-2 items-end">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="发送消息… (Enter 发送，Shift+Enter 换行)"
        className="flex-1 resize-none min-h-[60px] max-h-[200px] text-sm rounded-md border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
        disabled={disabled || isGenerating}
        rows={2}
      />
      {isGenerating ? (
        <Button size="sm" variant="destructive" onClick={onInterrupt} title="中断生成" className="shrink-0">
          <Square className="h-4 w-4" />
        </Button>
      ) : (
        <Button size="sm" onClick={handleSend} disabled={!text.trim() || disabled} className="shrink-0">
          <Send className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
