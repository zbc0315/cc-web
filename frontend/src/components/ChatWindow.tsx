import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConversationMessage } from '@/types';
import { cn } from '@/lib/utils';

interface ChatWindowProps {
  projectId: string;
  // State owned by ProjectPage so it survives view-mode switches
  externalMessages: ConversationMessage[];
  externalStreamingContent: string;
  sendInput: (content: string) => void;
}

// Simple markdown-like rendering: bold **text**, inline code `text`, code blocks ```...```
function renderContent(content: string): React.ReactNode {
  const codeBlockRegex = /```[\s\S]*?```/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyCounter = 0;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(renderInline(content.slice(lastIndex, match.index), keyCounter++));
    }
    const codeContent = match[0].replace(/^```[^\n]*\n?/, '').replace(/```$/, '');
    parts.push(
      <pre
        key={keyCounter++}
        className="bg-zinc-900 text-zinc-100 rounded-md p-3 my-2 overflow-x-auto text-xs font-mono whitespace-pre"
      >
        {codeContent}
      </pre>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push(renderInline(content.slice(lastIndex), keyCounter++));
  }

  return <>{parts}</>;
}

function renderInline(text: string, keyBase: number): React.ReactNode {
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(<span key={`${keyBase}-${i++}`}>{text.slice(last, match.index)}</span>);
    }
    const m = match[0];
    if (m.startsWith('**')) {
      parts.push(<strong key={`${keyBase}-${i++}`}>{m.slice(2, -2)}</strong>);
    } else {
      parts.push(
        <code key={`${keyBase}-${i++}`} className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-xs font-mono">
          {m.slice(1, -1)}
        </code>
      );
    }
    last = match.index + m.length;
  }

  if (last < text.length) {
    parts.push(<span key={`${keyBase}-${i++}`}>{text.slice(last)}</span>);
  }

  return (
    <span key={keyBase} style={{ whiteSpace: 'pre-wrap' }}>
      {parts}
    </span>
  );
}

function StreamingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
      <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
      <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" />
    </div>
  );
}

export function ChatWindow({
  externalMessages,
  externalStreamingContent,
  sendInput,
}: ChatWindowProps) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = externalStreamingContent.length > 0;

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [externalMessages, externalStreamingContent, scrollToBottom]);

  const handleSend = useCallback(() => {
    const content = input.trim();
    if (!content) return;
    setInput('');
    sendInput(content);
  }, [input, sendInput]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <ScrollArea className="flex-1 px-4 py-4">
        <div className="space-y-4 max-w-4xl mx-auto">
          {externalMessages.length === 0 && !isStreaming && (
            <div className="text-center text-muted-foreground text-sm py-12">
              No messages yet. Start a conversation with Claude.
            </div>
          )}
          {externalMessages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* Streaming ghost message */}
          {isStreaming && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-lg px-4 py-3 bg-zinc-100 dark:bg-zinc-800 font-mono text-sm">
                {externalStreamingContent ? (
                  <div style={{ whiteSpace: 'pre-wrap' }}>{externalStreamingContent}</div>
                ) : (
                  <StreamingDots />
                )}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t px-4 py-3 bg-background">
        <div className="flex gap-2 max-w-4xl mx-auto">
          <textarea
            ref={textareaRef}
            className={cn(
              'flex-1 min-h-[44px] max-h-40 rounded-md border border-input bg-background px-3 py-2 text-sm',
              'ring-offset-background placeholder:text-muted-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'resize-none'
            )}
            placeholder="Message Claude... (Enter to send, Shift+Enter for newline)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim()}
            size="icon"
            className="flex-shrink-0 self-end"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-4 py-3 text-sm',
          isUser
            ? 'bg-zinc-700 text-white'
            : 'bg-zinc-100 dark:bg-zinc-800 font-mono'
        )}
      >
        {isUser ? (
          <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
        ) : (
          renderContent(message.content)
        )}
        <div
          className={cn(
            'text-xs mt-1.5',
            isUser ? 'text-zinc-300' : 'text-muted-foreground'
          )}
        >
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
