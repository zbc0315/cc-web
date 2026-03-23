import { useState, useRef, useEffect } from 'react';
import { Send, ChevronRight, Brain, Wrench, FileOutput } from 'lucide-react';
import { ChatMessage, ChatBlockItem } from '@/lib/websocket';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatViewProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  readOnly?: boolean;
}

function CollapsibleBlock({ icon: Icon, label, content }: { icon: typeof Brain; label: string; content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded mt-1.5">
      <button
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
        <Icon className="h-3 w-3" />
        <span className="truncate">{label}</span>
      </button>
      {open && (
        <pre className="px-3 pb-2 text-xs text-muted-foreground whitespace-pre-wrap break-words max-h-40 overflow-auto">
          {content}
        </pre>
      )}
    </div>
  );
}

function MessageBlocks({ blocks }: { blocks: ChatBlockItem[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'text') {
          return (
            <div key={i} className="prose dark:prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{b.content}</ReactMarkdown>
            </div>
          );
        }
        if (b.type === 'thinking') {
          return <CollapsibleBlock key={i} icon={Brain} label="Thinking..." content={b.content} />;
        }
        if (b.type === 'tool_use') {
          return <CollapsibleBlock key={i} icon={Wrench} label={b.content.split('(')[0]} content={b.content} />;
        }
        if (b.type === 'tool_result') {
          return <CollapsibleBlock key={i} icon={FileOutput} label="Result" content={b.content} />;
        }
        return null;
      })}
    </>
  );
}

export function ChatView({ messages, onSend, readOnly }: ChatViewProps) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    onSend(text + '\r');
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">等待对话...</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted'
              )}
            >
              <MessageBlocks blocks={msg.blocks} />
              <div className="text-[10px] opacity-50 mt-1">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {!readOnly && (
        <div className="border-t border-border p-3 flex gap-2 items-end flex-shrink-0">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); autoGrow(e.target); }}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            rows={1}
            className="flex-1 resize-none bg-muted rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            style={{ maxHeight: '120px' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="p-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors flex-shrink-0"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
